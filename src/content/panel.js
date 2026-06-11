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

	function render(config) {
		if (root) { update(config); return; }

		root = el('div', { id: 'rg-panel', class: 'rg-panel' });
		const head = el('div', { class: 'rg-panel-head' },
			el('span', { class: 'rg-dot', id: 'rg-dot' }),
			el('strong', {}, 'RecGrab'),
			el('button', { class: 'rg-min', title: 'Collapse', onclick: () => root.classList.toggle('rg-collapsed') }, '–')
		);

		const status = el('div', { class: 'rg-status', id: 'rg-status' }, 'Scanning…');

		const body = el('div', { class: 'rg-panel-body' },
			quickToggle('Filtering', 'enabled', config),
			quickToggle('Auto-grab', 'autoGrab', config, true),
			el('p', { class: 'rg-hint' }, 'Configure entry points & group size from the toolbar popup.')
		);

		root.append(head, status, body);
		document.body.appendChild(root);

		window.addEventListener('rg:status', (e) => setStatus(e.detail));
		window.addEventListener('rg:matchcount', (e) => {
			const { matched, totalRows } = e.detail;
			setStatus(`${matched} open match${matched === 1 ? '' : 'es'} · ${totalRows} rows`);
		});
	}

	function quickToggle(label, key, config, danger) {
		const input = el('input', { type: 'checkbox' });
		input.checked = !!config[key];
		input.dataset.key = key;
		input.addEventListener('change', () => RG.setConfig({ [key]: input.checked }));
		return el('label', { class: 'rg-row rg-toggle' + (danger ? ' rg-danger' : '') },
			input, el('span', {}, label));
	}

	function update(config) {
		if (!root) return;
		root.querySelectorAll('input[type="checkbox"][data-key]').forEach((i) => {
			i.checked = !!config[i.dataset.key];
		});
		const dot = document.getElementById('rg-dot');
		if (dot) dot.classList.toggle('rg-dot-armed', !!config.autoGrab);
	}

	function setStatus(text) {
		const s = document.getElementById('rg-status');
		if (s) s.textContent = text;
	}

	window.RG.panel = { render, update, setStatus };
})();
