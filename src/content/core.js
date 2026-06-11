// RecGrab shared core. All content scripts in this extension run in the same
// isolated world and share globals, so everything hangs off window.RG.
//
// Storage model (chrome.storage.sync):
//   { configs: { "permits:445859": <PageConfig>, "camping/campgrounds:232447": ... } }
// Config is keyed by permit/campground ID (stable) rather than full URL, since
// the availability URL carries volatile ?date=&type= query params.
(() => {
	if (window.RG) return;

	// Per-page (per-context) config shape + defaults.
	const DEFAULT_CONFIG = {
		label: '',
		enabled: true,
		watchlist: [], // entry-point IDs (preferred) or name substrings
		groupSize: null, // desired "Group Members" count; null = leave alone
		hideNonMatchingRows: true,
		hideRowsWithNoMatch: false,
		dimUnavailable: true,
		highlightMatches: true,
		autoGrab: false,
		targetDates: [], // ISO dates auto-grab may click, e.g. ["2026-06-13"]
		autoGrabIntervalMs: 4000,
		updatedAt: 0
	};

	const SEL = {
		grid: 'div[data-component="Grid"][aria-label="Availability by Sites and Dates"]',
		anyGrid: 'div[data-component="Grid"].detailed-availability-grid-new',
		row: 'div[data-component="Row"][role="row"]',
		headerCell: 'div[data-component="GridHeaderCell"][role="columnheader"]',
		cell: 'div[data-component="GridCell"][role="gridcell"]',
		dateBtn: 'button.rec-availability-date',
		entryNameBtn: 'p.sarsa-text button.sarsa-button-link',
		guestTrigger: '#guest-counter',
		guestPopup: '#guest-counter-popup',
		entryDateHidden: '#single-date-hidden',
		bookNow: '.per-availability-book-now button.sarsa-button-primary'
	};

	function pageContext() {
		const m = location.pathname.match(/\/(permits|camping\/campgrounds)\/(\d+)/);
		return {
			kind: m ? m[1] : null,
			id: m ? m[2] : null,
			isAvailabilityPage: /detailed-availability|availability/.test(location.pathname)
		};
	}

	function contextKey(ctx = pageContext()) {
		return ctx.id ? `${ctx.kind}:${ctx.id}` : null;
	}

	function parsePeople(ariaLabel) {
		if (!ariaLabel) return null;
		const m = ariaLabel.match(/People:\s*(\d+)\s*out of\s*(\d+)/i);
		if (!m) return null;
		return { remaining: parseInt(m[1], 10), total: parseInt(m[2], 10) };
	}

	function cellState(cellEl) {
		if (cellEl.classList.contains('available')) return 'available';
		if (cellEl.classList.contains('not-yet-released')) return 'not-yet-released';
		if (cellEl.classList.contains('unavailable')) return 'unavailable';
		return 'unknown';
	}

	function isoFromDate(d) {
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	// Header row -> array mapping column index to ISO date (null for ID/name/area).
	function buildColumnDateMap(grid) {
		const headerRow = grid.querySelector(SEL.row);
		if (!headerRow) return [];
		const cells = [...headerRow.querySelectorAll(SEL.headerCell)];
		return cells.map((c) => {
			const sr = c.querySelector('.rec-sr-only');
			if (!sr) return null;
			const d = new Date(sr.textContent.trim());
			return isNaN(d.getTime()) ? null : isoFromDate(d);
		});
	}

	function readRow(rowEl, colDates) {
		const cells = [...rowEl.querySelectorAll(SEL.cell)];
		if (!cells.length) return null; // header row has no gridcells
		const id = (cells[0]?.textContent || '').trim();
		const nameBtn = cells[1]?.querySelector('button');
		const name = (nameBtn?.getAttribute('aria-label') || nameBtn?.textContent || '').trim();
		const area = (cells[2]?.textContent || '').trim();

		const dates = [];
		cells.forEach((cell, i) => {
			const iso = colDates[i];
			if (!iso) return;
			const btn = cell.querySelector(SEL.dateBtn);
			const people = parsePeople(btn?.getAttribute('aria-label'));
			dates.push({
				iso,
				cellEl: cell,
				btnEl: btn || null,
				state: cellState(cell),
				remaining: people ? people.remaining : null,
				total: people ? people.total : null
			});
		});
		return { rowEl, id, name, area, dates };
	}

	function matchesWatchlist(row, watchlist) {
		if (!watchlist || !watchlist.length) return true;
		return watchlist.some((w) => {
			const term = String(w).trim();
			if (!term) return false;
			if (term === row.id) return true;
			return row.name.toLowerCase().includes(term.toLowerCase());
		});
	}

	function setReactInputValue(el, value) {
		const proto = Object.getPrototypeOf(el);
		const desc = Object.getOwnPropertyDescriptor(proto, 'value');
		if (desc && desc.set) desc.set.call(el, value);
		else el.value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}

	function waitFor(selector, { root = document, timeout = 8000 } = {}) {
		return new Promise((resolve, reject) => {
			const found = root.querySelector(selector);
			if (found) return resolve(found);
			const obs = new MutationObserver(() => {
				const el = root.querySelector(selector);
				if (el) { obs.disconnect(); resolve(el); }
			});
			obs.observe(root === document ? document.documentElement : root, {
				childList: true, subtree: true
			});
			setTimeout(() => { obs.disconnect(); reject(new Error('waitFor timeout: ' + selector)); }, timeout);
		});
	}

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	// ---- Config storage (per-context) ----
	// During dev, reloading the extension orphans this content script: its
	// chrome.* handle is severed and calls throw "Extension context invalidated".
	// Guard every access so a stale script degrades gracefully instead of
	// spewing uncaught rejections (reloading the page re-injects a fresh script).
	function extAlive() {
		try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
	}

	async function getAllConfigs() {
		if (!extAlive()) return {};
		try {
			const stored = await chrome.storage.sync.get('configs');
			return stored.configs || {};
		} catch (e) {
			if (/context invalidated/i.test(e?.message || '')) return {};
			throw e;
		}
	}

	async function getConfig(key = contextKey()) {
		const all = await getAllConfigs();
		return { ...DEFAULT_CONFIG, ...(key ? all[key] : null) };
	}

	async function setConfig(patch, key = contextKey()) {
		if (!key || !extAlive()) return null;
		const all = await getAllConfigs();
		const next = { ...DEFAULT_CONFIG, ...(all[key] || {}), ...patch, updatedAt: Date.now() };
		all[key] = next;
		try { await chrome.storage.sync.set({ configs: all }); }
		catch (e) { if (!/context invalidated/i.test(e?.message || '')) throw e; }
		return next;
	}

	async function deleteConfig(key = contextKey()) {
		if (!key || !extAlive()) return;
		const all = await getAllConfigs();
		delete all[key];
		try { await chrome.storage.sync.set({ configs: all }); }
		catch (e) { if (!/context invalidated/i.test(e?.message || '')) throw e; }
	}

	// Fire cb with the merged config for the CURRENT context whenever configs change.
	function onConfigChange(cb) {
		if (!extAlive()) return;
		try {
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area !== 'sync' || !changes.configs) return;
				const key = contextKey();
				const all = changes.configs.newValue || {};
				cb({ ...DEFAULT_CONFIG, ...(key ? all[key] : null) });
			});
		} catch {}
	}

	// ---- Global flags (universal across all pages) ----
	// `enabled` = master on/off for the whole extension.
	// `armed`   = auto-grab is live. Stored as top-level sync keys so they can be
	// toggled from any page's popup and every tab reacts instantly.
	const GLOBAL_DEFAULTS = { enabled: true, armed: false };

	async function getGlobals() {
		if (!extAlive()) return { ...GLOBAL_DEFAULTS };
		try {
			const s = await chrome.storage.sync.get(['enabled', 'armed']);
			return { enabled: s.enabled !== false, armed: !!s.armed };
		} catch (e) {
			if (/context invalidated/i.test(e?.message || '')) return { ...GLOBAL_DEFAULTS };
			throw e;
		}
	}

	async function setGlobals(patch) {
		if (!extAlive()) return;
		try { await chrome.storage.sync.set(patch); }
		catch (e) { if (!/context invalidated/i.test(e?.message || '')) throw e; }
	}

	function onGlobalsChange(cb) {
		if (!extAlive()) return;
		try {
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area === 'sync' && (changes.enabled || changes.armed)) cb();
			});
		} catch {}
	}

	const log = (...args) => {
		console.debug('%c[RecGrab]', 'color:#466c04;font-weight:bold', ...args);
		// Mirror to the on-page diagnostics panel (best-effort).
		try {
			const line = args.map((a) =>
				typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
			).join(' ');
			window.dispatchEvent(new CustomEvent('rg:log', { detail: line }));
		} catch {}
	};

	// Current group-members count from the trigger label, or null if unset.
	function readGroupSize() {
		const t = document.querySelector(SEL.guestTrigger);
		if (!t) return null;
		const m = (t.textContent || '').match(/(\d+)/);
		return m ? parseInt(m[1], 10) : null;
	}

	// True when no group size is set yet ("Add Group Members..." placeholder).
	// In this state recreation.gov hides availability, so the grid has no rows.
	function isGuestPlaceholder() {
		const t = document.querySelector(SEL.guestTrigger);
		if (!t) return false;
		const base = t.closest('.sarsa-dropdown-base');
		if (base && base.classList.contains('is-placeholder')) return true;
		return !/\d/.test(t.textContent || '');
	}

	// Scan the live grid into structured rows.
	function scanGrid() {
		const grid = document.querySelector(SEL.grid) || document.querySelector(SEL.anyGrid);
		if (!grid) return null;
		const colDates = buildColumnDateMap(grid);
		const rows = [...grid.querySelectorAll(SEL.row)]
			.map((r) => readRow(r, colDates))
			.filter(Boolean);
		return { grid, colDates, rows };
	}

	// Best-effort page label (permit / campground name) for display in the popup.
	function pageLabel(ctx = pageContext()) {
		const candidates = [
			document.querySelector('nav[aria-label="Breadcrumb"] a:last-of-type'),
			document.querySelector('.breadcrumbs a:last-of-type'),
			document.querySelector('header h1, [data-component="Heading"] h1')
		];
		for (const el of candidates) {
			const t = (el?.textContent || '').trim();
			if (t && !/detailed availability/i.test(t)) return t;
		}
		const title = document.title.replace(/\s*[-|].*$/, '').trim();
		if (title && !/recreation\.gov/i.test(title)) return title;
		return ctx.id ? `${ctx.kind === 'permits' ? 'Permit' : 'Campground'} ${ctx.id}` : 'This page';
	}

	// Structured options for the popup configurator.
	function scanOptions() {
		const ctx = pageContext();
		const key = contextKey(ctx);
		const scan = scanGrid();
		if (!scan) return { ready: false, context: key, ...ctx, label: pageLabel(ctx) };

		const dates = scan.colDates
			.filter(Boolean)
			.map((iso) => {
				const d = new Date(iso + 'T00:00:00');
				return {
					iso,
					weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
					day: d.getDate(),
					label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
				};
			});

		const entryPoints = scan.rows.map((row) => {
			const open = row.dates.filter((d) => d.state === 'available');
			return {
				id: row.id,
				name: row.name,
				area: row.area,
				openCount: open.length,
				openDates: open.map((d) => d.iso),
				openSpots: open.map((d) => ({ iso: d.iso, remaining: d.remaining })),
				maxRemaining: open.reduce((m, d) => Math.max(m, d.remaining ?? 0), 0)
			};
		});

		const placeholder = isGuestPlaceholder();

		return {
			ready: true,
			context: key,
			kind: ctx.kind,
			id: ctx.id,
			isAvailabilityPage: ctx.isAvailabilityPage,
			label: pageLabel(ctx),
			currentGroupSize: readGroupSize(),
			guestPlaceholder: placeholder,
			// Availability is hidden until a group size is chosen; entry points
			// only render once it is. Either signal means "set group size first".
			needsGroupSize: placeholder || entryPoints.length === 0,
			dates,
			entryPoints
		};
	}

	window.RG = {
		DEFAULT_CONFIG, SEL, pageContext, contextKey, parsePeople, cellState,
		buildColumnDateMap, readRow, matchesWatchlist, setReactInputValue,
		waitFor, sleep, log, isoFromDate, readGroupSize, isGuestPlaceholder,
		getAllConfigs, getConfig, setConfig, deleteConfig, onConfigChange,
		getGlobals, setGlobals, onGlobalsChange,
		scanGrid, scanOptions, pageLabel, extAlive
	};

	log('core loaded', contextKey());
})();
