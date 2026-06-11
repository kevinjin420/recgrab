// Toolbar popup: scans the active recreation.gov availability page, lets the
// user pick entry points / group size / target dates, and auto-saves the config
// keyed by permit/campground ID. The content script reacts to storage changes
// and applies filtering/highlighting live.

const DEFAULTS = {
	label: '', watchlist: [], groupSize: null,
	hideNonMatchingRows: true, hideRowsWithNoMatch: false,
	dimUnavailable: true, highlightMatches: true,
	targetDates: [], autoGrabIntervalMs: 3000, updatedAt: 0
};

const BOOLS = ['highlightMatches', 'hideNonMatchingRows', 'hideRowsWithNoMatch', 'dimUnavailable'];

const $ = (id) => document.getElementById(id);

const state = { tabId: null, scan: null, key: null, cfg: { ...DEFAULTS } };

// ---- storage (per-context) ----
async function getConfigs() {
	return (await chrome.storage.sync.get('configs')).configs || {};
}
function normalizeConfig(raw = {}) {
	const cfg = { ...DEFAULTS };
	for (const k of ['label', 'watchlist', 'groupSize', 'hideNonMatchingRows',
			'hideRowsWithNoMatch', 'dimUnavailable', 'highlightMatches', 'targetDates',
			'autoGrabIntervalMs', 'updatedAt']) {
		if (raw[k] !== undefined) cfg[k] = raw[k];
	}
	return cfg;
}
async function loadConfig(key) {
	const all = await getConfigs();
	return normalizeConfig(all[key]);
}
let saveTimer;
function persist() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(async () => {
		const all = await getConfigs();
		all[state.key] = { ...normalizeConfig(state.cfg), updatedAt: Date.now() };
		await chrome.storage.sync.set({ configs: all });
	}, 200);
}

// ---- global flags (universal: master on/off + armed) ----
async function getGlobals() {
	const s = await chrome.storage.sync.get(['enabled', 'armed']);
	return { enabled: s.enabled !== false, armed: !!s.armed };
}
async function setGlobals(patch) {
	await chrome.storage.sync.set(patch);
}
function applyGlobalsUI(g) {
	$('gEnabled').checked = g.enabled;
	$('gArmed').checked = g.armed;
	$('gArmed').disabled = !g.enabled;
	$('armWrap').classList.toggle('disabled', !g.enabled);
}
// Header toggles work on EVERY page (even non-rec.gov), so wire them up front
// and independently of the page scan — that's what lets you disarm from anywhere.
async function wireGlobals() {
	applyGlobalsUI(await getGlobals());
	$('gEnabled').addEventListener('change', async () => {
		const enabled = $('gEnabled').checked;
		const patch = { enabled };
		if (!enabled) patch.armed = false; // off disarms
		await setGlobals(patch);
		applyGlobalsUI(await getGlobals());
	});
	$('gArmed').addEventListener('change', async () => {
		await setGlobals({ armed: $('gArmed').checked });
		applyGlobalsUI(await getGlobals());
	});
	chrome.storage.onChanged.addListener((c, a) => {
		if (a === 'sync' && (c.enabled || c.armed)) getGlobals().then(applyGlobalsUI);
	});
}

// ---- messaging ----
async function send(type, extra = {}) {
	return chrome.tabs.sendMessage(state.tabId, { type, ...extra });
}

// ---- boot ----
async function init() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	state.tabId = tab?.id;

	if (!tab || !/^https:\/\/www\.recreation\.gov\//.test(tab.url || '')) {
		return showState('Open a Recreation.gov availability page, then click RecGrab.');
	}

	let scan;
	try {
		scan = await send('rg:scan');
	} catch {
		return showState('Loading… reopen RecGrab once the page has finished loading.', true);
	}

	if (!scan || !scan.id) {
		return showState('This isn\'t a permit/campground availability page. Open one and try again.');
	}
	if (!scan.ready) {
		return showState('Couldn\'t find the availability grid. Make sure it\'s visible, then scan.', true);
	}

	state.scan = scan;
	state.key = scan.context;
	state.cfg = await loadConfig(scan.context);
	// Default the label + group size from the page on first run.
	if (!state.cfg.label) state.cfg.label = scan.label;
	if (state.cfg.groupSize == null && scan.currentGroupSize) state.cfg.groupSize = scan.currentGroupSize;

	render();
}

function showState(text, showRetry = false) {
	$('config').hidden = true;
	$('footer').hidden = true;
	$('stateMsg').hidden = false;
	$('stateText').textContent = text;
	$('retryBtn').hidden = !showRetry;
}

// ---- render ----
function render() {
	$('stateMsg').hidden = true;
	$('config').hidden = false;
	$('footer').hidden = false;

	BOOLS.forEach((k) => ($(k).checked = !!state.cfg[k]));
	$('groupSize').value = state.cfg.groupSize ?? '';

	// Unset state: recreation.gov hides availability until a group size is set.
	const needs = !!state.scan.needsGroupSize;
	$('unsetBanner').hidden = !needs;
	if (needs) $('bGroupSize').value = state.cfg.groupSize ?? state.scan.currentGroupSize ?? 2;

	renderEntryPoints();
	renderDates();
}

function renderEntryPoints(filterText = '') {
	const list = $('epList');
	list.innerHTML = '';
	const q = filterText.trim().toLowerCase();
	const items = state.scan.entryPoints.filter((ep) =>
		!q || ep.name.toLowerCase().includes(q) || ep.id.includes(q) || ep.area.toLowerCase().includes(q));

	if (!items.length) {
		const msg = state.scan.entryPoints.length === 0
			? 'Set a group size above to load entry points.'
			: 'No entry points match your search.';
		list.innerHTML = `<div class="ep-empty">${msg}</div>`;
		return;
	}

	items.forEach((ep) => {
		const checked = state.cfg.watchlist.includes(ep.id);
		const open = qualifiedOpen(ep);
		const row = document.createElement('label');
		row.className = 'ep-item' + (checked ? ' checked' : '');
		row.innerHTML = `
			<input type="checkbox" ${checked ? 'checked' : ''} />
			<span class="ep-main">
				<span class="ep-name"></span>
				<span class="ep-meta"></span>
			</span>
			<span class="ep-badge ${open.count ? 'has-open' : ''}"></span>`;
		row.querySelector('.ep-name').textContent = ep.name || `#${ep.id}`;
		row.querySelector('.ep-meta').textContent =
			`${ep.area ? ep.area + ' · ' : ''}ID ${ep.id}${ep.maxRemaining ? ` · max ${ep.maxRemaining}` : ''}`;
		row.querySelector('.ep-badge').textContent = open.count ? `${open.count} open` : 'none';
		row.querySelector('input').addEventListener('change', (e) => {
			row.classList.toggle('checked', e.target.checked);
			toggleWatch(ep.id, e.target.checked);
		});
		list.appendChild(row);
	});
}

function qualifiedOpen(ep) {
	const min = state.cfg.groupSize || 1;
	const spots = ep.openSpots || (ep.openDates || []).map(() => ({ remaining: ep.maxRemaining }));
	const qualifying = spots.filter((d) => d.remaining == null || d.remaining >= min);
	return {
		count: qualifying.length,
		maxRemaining: qualifying.reduce((m, d) => Math.max(m, d.remaining ?? 0), 0)
	};
}

function toggleWatch(id, on) {
	const set = new Set(state.cfg.watchlist);
	on ? set.add(id) : set.delete(id);
	state.cfg.watchlist = [...set];
	persist();
}

function renderDates() {
	const wrap = $('dateList');
	wrap.innerHTML = '';
	if (!state.scan.dates.length) {
		wrap.innerHTML = '<span class="date-list-empty">No date columns detected.</span>';
		return;
	}
	state.scan.dates.forEach((d) => {
		const on = state.cfg.targetDates.includes(d.iso);
		const chip = document.createElement('label');
		chip.className = 'date-chip' + (on ? ' checked' : '');
		chip.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} />
			<span class="dow">${d.weekday}</span><span class="dnum">${d.day}</span>`;
		chip.title = d.label;
		chip.querySelector('input').addEventListener('change', (e) => {
			const set = new Set(state.cfg.targetDates);
			e.target.checked ? set.add(d.iso) : set.delete(d.iso);
			state.cfg.targetDates = [...set];
			chip.classList.toggle('checked', e.target.checked);
			persist();
		});
		wrap.appendChild(chip);
	});
}

// ---- control wiring ----
function wire() {
	BOOLS.forEach((k) => $(k).addEventListener('change', () => {
		state.cfg[k] = $(k).checked;
		persist();
	}));

	$('groupSize').addEventListener('change', commitGroupSize);
	$('gsPlus').addEventListener('click', () => bumpGroup(1));
	$('gsMinus').addEventListener('click', () => bumpGroup(-1));

	$('epSearch').addEventListener('input', (e) => renderEntryPoints(e.target.value));
	$('selAll').addEventListener('click', () => bulkSelect('all'));
	$('selNone').addEventListener('click', () => bulkSelect('none'));
	$('selOpen').addEventListener('click', () => bulkSelect('open'));

	$('bPlus').addEventListener('click', () => bumpBanner(1));
	$('bMinus').addEventListener('click', () => bumpBanner(-1));
	$('loadBtn').addEventListener('click', loadAvailability);
	$('dumpLink').addEventListener('click', copyDiagnostics);
	$('retryBtn').addEventListener('click', init);
	$('saveBtn').addEventListener('click', () => window.close());
	$('clearBtn').addEventListener('click', clearConfig);
}

function commitGroupSize() {
	const n = parseInt($('groupSize').value, 10);
	state.cfg.groupSize = Number.isFinite(n) && n > 0 ? n : null;
	persist();
	renderEntryPoints($('epSearch').value);
}
function bumpGroup(delta) {
	const cur = parseInt($('groupSize').value, 10) || 0;
	const next = Math.max(1, cur + delta);
	$('groupSize').value = next;
	commitGroupSize();
}

function bulkSelect(mode) {
	if (mode === 'none') state.cfg.watchlist = [];
	else if (mode === 'all') state.cfg.watchlist = state.scan.entryPoints.map((e) => e.id);
	else if (mode === 'open') state.cfg.watchlist = state.scan.entryPoints.filter((e) => qualifiedOpen(e).count).map((e) => e.id);
	persist();
	renderEntryPoints($('epSearch').value);
}

// Opens the live guest popup, grabs its markup, and copies it to the clipboard
// so the exact (portal-rendered) structure can be shared for targeting.
async function copyDiagnostics() {
	const link = $('dumpLink');
	const orig = link.textContent;
	link.textContent = 'Reading popup…';
	try {
		const res = await send('rg:dumpPopup');
		const html = res?.html || '(no markup returned)';
		await navigator.clipboard.writeText(html);
		link.textContent = 'Copied — paste it to the developer';
	} catch {
		link.textContent = 'Couldn\'t read popup';
	}
	setTimeout(() => (link.textContent = orig), 2600);
}

function bumpBanner(delta) {
	const cur = parseInt($('bGroupSize').value, 10) || 0;
	$('bGroupSize').value = Math.max(1, cur + delta);
}

// Unset-state unlock: set the group size on the page, then poll until the grid
// renders its entry points and re-render the configurator.
async function loadAvailability() {
	const n = Math.max(1, parseInt($('bGroupSize').value, 10) || 2);
	state.cfg.groupSize = n;
	persist();
	const btn = $('loadBtn');
	const orig = btn.textContent;
	btn.disabled = true;
	btn.textContent = `Setting ${n}…`;
	try {
		await send('rg:applyGroupSize', { size: n });
	} catch {
		btn.disabled = false;
		btn.textContent = 'Page not ready';
		setTimeout(() => (btn.textContent = orig), 1500);
		return;
	}
	btn.textContent = 'Loading availability…';
	const ok = await rescanUntilReady();
	btn.disabled = false;
	btn.textContent = ok ? orig : 'Try again';
	setTimeout(() => (btn.textContent = orig), 1600);
}

async function rescanUntilReady(tries = 8, delay = 700) {
	for (let i = 0; i < tries; i++) {
		await new Promise((r) => setTimeout(r, delay));
		let scan;
		try { scan = await send('rg:scan'); } catch { continue; }
		if (scan) state.scan = scan;
		if (scan && scan.ready && scan.entryPoints.length) { render(); return true; }
	}
	render();
	return false;
}

async function clearConfig() {
	const all = await getConfigs();
	delete all[state.key];
	await chrome.storage.sync.set({ configs: all });
	state.cfg = { ...DEFAULTS, label: state.scan.label };
	if (state.scan.currentGroupSize) state.cfg.groupSize = state.scan.currentGroupSize;
	render();
}

wireGlobals();
init().then(wire);
