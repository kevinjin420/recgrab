// Slim floating status panel. The toolbar popup is the configurator; this panel
// is the at-a-glance, race-time status + quick kill switches (it stays visible
// after the popup closes). Bound to the current page's saved config.
(() => {
	const RG = window.RG;
	let root = null;

	function el(tag, props = {}, ...kids) {
		const n = document.createElement(tag);
		Object.entries(props).forEach(([k, v]) => {
			if (k === 'class') n.className = v;
			else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
			else n.setAttribute(k, v);
		});
		kids.forEach((c) => n.append(c?.nodeType ? c : document.createTextNode(String(c))));
		return n;
	}

	function render(state) {
		if (root) { update(state); return; }

		root = el('div', { id: 'rg-panel', class: 'rg-panel' });
		const head = el('div', { class: 'rg-panel-head' },
			el('span', { class: 'rg-dot', id: 'rg-dot' }),
			el('strong', {}, 'RecGrab'),
			el('button', { class: 'rg-min', title: 'Collapse', onclick: () => root.classList.toggle('rg-collapsed') }, '–')
		);

		const status = el('div', { class: 'rg-status', id: 'rg-status' }, 'Scanning…');

		const body = el('div', { class: 'rg-panel-body' },
			globalToggle('Extension on', 'enabled', state),
			globalToggle('Armed', 'armed', state, true),
			el('p', { class: 'rg-hint' }, 'On/Armed are global. Configure entry points, group size & dates from the toolbar popup.')
		);

		// --- Temporary diagnostics (debug "Book Now" not clicking) ---
		const logBox = el('pre', { class: 'rg-log', id: 'rg-log' }, '');
		const diag = el('div', { class: 'rg-diag', id: 'rg-diag' },
			el('div', { class: 'rg-diag-head' },
				el('strong', {}, 'Diagnostics'),
				el('button', { class: 'rg-min', title: 'Clear', onclick: () => { logBox.textContent = ''; } }, 'clear')
			),
			el('div', { class: 'rg-diag-btns' },
				el('button', { class: 'rg-btn', onclick: diagInspect }, 'Inspect'),
				el('button', { class: 'rg-btn', onclick: diagTarget }, 'Find target'),
				el('button', { class: 'rg-btn', onclick: diagBookNow }, 'Click Book Now')
			),
			logBox
		);

		root.append(head, status, body, diag);
		document.body.appendChild(root);
		update(state);

		window.addEventListener('rg:status', (e) => setStatus(e.detail));
		window.addEventListener('rg:matchcount', (e) => {
			const { matched, totalRows } = e.detail;
			setStatus(`${matched} open match${matched === 1 ? '' : 'es'} · ${totalRows} rows`);
		});
		window.addEventListener('rg:log', (e) => logLine(e.detail));
	}

	function logLine(text) {
		const box = document.getElementById('rg-log');
		if (!box) return;
		const ts = new Date().toLocaleTimeString();
		box.textContent += `[${ts}] ${text}\n`;
		box.scrollTop = box.scrollHeight;
	}

	// Report every "Book Now" candidate auto-grab can see right now.
	function diagInspect() {
		const all = RG.autograb.findAllBookNow();
		logLine(`Book Now candidates: ${all.length}`);
		all.forEach((btn, i) => {
			const r = btn.getBoundingClientRect();
			const s = getComputedStyle(btn);
			const disabledClass = /sarsa-button-disabled/.test(btn.className || '');
			const vis = r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
			logLine(`  #${i}: vis=${vis} disabledProp=${!!btn.disabled} ariaDis=${btn.getAttribute('aria-disabled')} disClass=${disabledClass}`);
			logLine(`       rect top=${Math.round(r.top)} left=${Math.round(r.left)} ${Math.round(r.width)}x${Math.round(r.height)} (vh=${window.innerHeight}) class="${(btn.className || '').slice(0, 60)}"`);
		});
		const chosen = RG.autograb.findBookNow();
		logLine(`  -> chosen index: ${all.indexOf(chosen)}`);
		const sel = document.querySelector('.selection-information');
		logLine(`  selection-information: ${sel ? '"' + (sel.textContent || '').replace(/\s+/g, ' ').trim() + '"' : '(none)'}`);
	}

	// Report the best grab target for the current saved config.
	async function diagTarget() {
		const cfg = await RG.getConfig();
		const g = await RG.getGlobals();
		const range = RG.autograb.currentGridDateRange();
		logLine(`globals: on=${g.enabled} armed=${g.armed}`);
		logLine(`config: group=${cfg.groupSize} watch=[${(cfg.watchlist || []).join(',')}] date=${cfg.targetDate || '(none)'}`);
		logLine(`visible dates: ${range.start || '?'} → ${range.end || '?'} (${range.dates.length} columns)`);
		logLine(`page date: ${RG.autograb.currentPageDate() || '(none)'}`);
		const t = RG.autograb.findGrabTarget(cfg);
		if (!t) { logLine('grab target: none (no matching open cell for current filters)'); return; }
		logLine(`grab target: ${t.row.name} · ${t.date.iso} · ${t.date.remaining} spots · btnDisabled=${!!t.date.btnEl.disabled}`);
	}

	// Manually drive the Book Now click path and report the outcome.
	async function diagBookNow() {
		logLine('manual: clicking Book Now…');
		const ok = await RG.autograb.clickBookNow({ timeout: 4000 });
		logLine('manual: clickBookNow -> ' + (ok ? 'CLICKED' : 'failed (see above)'));
	}

	function globalToggle(label, key, state, danger) {
		const input = el('input', { type: 'checkbox' });
		input.checked = !!state[key];
		input.dataset.gkey = key;
		input.addEventListener('change', () => {
			// Turning the extension off also disarms.
			const patch = { [key]: input.checked };
			if (key === 'enabled' && !input.checked) patch.armed = false;
			RG.setGlobals(patch);
		});
		return el('label', { class: 'rg-row rg-toggle' + (danger ? ' rg-danger' : ''), 'data-row': key },
			input, el('span', {}, label));
	}

	function update(state) {
		if (!root) return;
		root.querySelectorAll('input[type="checkbox"][data-gkey]').forEach((i) => {
			i.checked = !!state[i.dataset.gkey];
		});
		// Gray out + disable Armed when the extension is off.
		const armedInput = root.querySelector('input[data-gkey="armed"]');
		const armedRow = root.querySelector('[data-row="armed"]');
		if (armedInput) armedInput.disabled = !state.enabled;
		if (armedRow) armedRow.classList.toggle('rg-disabled', !state.enabled);
		const dot = document.getElementById('rg-dot');
		if (dot) {
			dot.classList.toggle('rg-dot-armed', !!(state.enabled && state.armed));
			dot.classList.toggle('rg-dot-off', !state.enabled);
		}
	}

	function setStatus(text) {
		const s = document.getElementById('rg-status');
		if (s) s.textContent = text;
	}

	window.RG.panel = { render, update, setStatus };
})();
