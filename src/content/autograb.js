// Watch the grid and assist clicking an open date cell for a watched entry
// point on a target date, then click "Book Now" to lock in the spot.
//
// SAFETY: this clicks the date cell and the "Book Now" button (which carries
// the selection into registration / cart). It never advances through reCAPTCHA,
// payment, or final purchase — the user still completes checkout. Treat it as a
// fast "grab the slot for me" helper, not a bot. Respect Recreation.gov's Terms
// of Service and rate limits.
(() => {
	const RG = window.RG;
	let timer = null;
	let lastClickKey = null;

	const isVisible = (b) => {
		if (!b) return false;
		const r = b.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return false;
		const s = getComputedStyle(b);
		return s.visibility !== 'hidden' && s.display !== 'none';
	};

	const isEnabled = (b) =>
		b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' &&
		!/sarsa-button-disabled/.test(b.className || '');

	// All "Book Now" candidates in the DOM (responsive layouts can render more
	// than one; some are hidden duplicates).
	//
	// IMPORTANT: .per-availability-book-now also contains the legend buttons
	// ("In-Station", "Lottery"), so we must match on the BUTTON TEXT being
	// exactly "Book Now" — not just any button inside that container.
	const isBookNowText = (b) => /^book now$/i.test((b.textContent || '').replace(/\s+/g, ' ').trim());

	function findAllBookNow() {
		const primary = [...document.querySelectorAll(RG.SEL.bookNow)].filter(isBookNowText);
		const byText = [...document.querySelectorAll('button, a[data-component="Button"]')].filter(isBookNowText);
		return [...new Set([...primary, ...byText])];
	}

	// The page-level "Book Now" CTA. Prefer the visible + enabled one, since
	// hidden duplicates won't react to clicks.
	function findBookNow() {
		const all = findAllBookNow();
		return all.find((b) => isVisible(b) && isEnabled(b))
			|| all.find((b) => isVisible(b))
			|| all[0] || null;
	}

	// Activate the button as robustly as possible: scroll it into view (usePress
	// rejects clicks whose clientX/Y aren't over the target), fire the react-aria
	// pointer sequence, AND a native .click() (covers plain React onClick).
	function pressBtn(btn) {
		try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
		try { btn.focus({ preventScroll: true }); } catch {}
		if (RG.autofill && RG.autofill.press) RG.autofill.press(btn);
		try { btn.click(); } catch {}
	}

	function visibleDates() {
		const scan = RG.scanGrid();
		return scan ? scan.colDates.filter(Boolean) : [];
	}

	function currentGridDateRange() {
		const dates = visibleDates();
		return { dates, start: dates[0] || null, end: dates[dates.length - 1] || null };
	}

	function isDateVisible(iso) {
		return visibleDates().includes(iso);
	}

	function currentPageDate() {
		const hidden = document.querySelector(RG.SEL.entryDateHidden)?.value;
		if (hidden) return hidden;
		return new URL(location.href).searchParams.get('date');
	}

	function navigateToDate(iso) {
		if (isDateVisible(iso)) return false;
		if (currentPageDate() === iso) {
			RG.log('date navigation pending; already on page date', iso);
			return false;
		}
		const url = new URL(location.href);
		url.searchParams.set('date', iso);
		if (url.toString() === location.href) return false;
		RG.log('navigating availability date', currentPageDate(), '->', iso);
		location.assign(url.toString());
		return true;
	}

	async function waitForDateVisible(iso, timeout = 9000) {
		const t0 = Date.now();
		while (Date.now() - t0 < timeout) {
			if (isDateVisible(iso)) return true;
			await RG.sleep(150);
		}
		return false;
	}

	// Wait until "Book Now" exists AND is enabled (i.e. a date selection has
	// actually registered). Returns the button or null on timeout.
	async function waitForEnabledBookNow(timeout = 4000) {
		const t0 = Date.now();
		let logged = 0;
		while (Date.now() - t0 < timeout) {
			const btn = findBookNow();
			if (isEnabled(btn)) return btn;
			const elapsed = Date.now() - t0;
			if (elapsed - logged >= 1200) {
				logged = elapsed;
				RG.log('waiting for "Book Now"…', btn ? '(found, still disabled)' : '(not in DOM yet)');
			}
			await RG.sleep(120);
		}
		return null;
	}

	// After a date cell is selected, wait for "Book Now" to enable, then click it.
	// Confirms the click "took" by checking the button leaves the enabled state
	// (selection consumed / navigation) and retries the press a couple times.
	async function clickBookNow({ timeout = 8000 } = {}) {
		const btn = await waitForEnabledBookNow(timeout);
		if (!btn) {
			RG.log('"Book Now" never enabled within', timeout, 'ms — selection may not have registered');
			return false;
		}
		for (let attempt = 1; attempt <= 3; attempt++) {
			RG.log(`clicking "Book Now" (attempt ${attempt})`);
			pressBtn(btn);
			await RG.sleep(450);
			// If the page navigated away or the button is gone/disabled, treat as success.
			if (!document.contains(btn) || !isEnabled(findBookNow() || btn)) {
				RG.log('"Book Now" click registered');
				return true;
			}
		}
		RG.log('"Book Now" press did not take after retries');
		return false;
	}

	// Press a date cell, then confirm selection by waiting for Book Now to enable.
	async function selectDateCell(btnEl, { tries = 3 } = {}) {
		for (let attempt = 1; attempt <= tries; attempt++) {
			if (!btnEl || !document.contains(btnEl)) return false;
			RG.log(`selecting date cell (attempt ${attempt})`);
			pressBtn(btnEl);
			const enabled = await waitForEnabledBookNow(2500);
			if (enabled) return true;
			RG.log('selection did not register; retrying');
			await RG.sleep(350);
		}
		return false;
	}

	function targetDates(config) {
		return [...new Set(config.targetDates || [])].filter(Boolean).sort();
	}

	const NAV_KEY = () => `rg-nav:${RG.contextKey() || location.pathname}`;
	const NAV_COOLDOWN_MS = 45000;

	function readNavState() {
		try {
			return JSON.parse(sessionStorage.getItem(NAV_KEY()) || '{}');
		} catch {
			return {};
		}
	}

	function writeNavState(state) {
		try { sessionStorage.setItem(NAV_KEY(), JSON.stringify(state)); } catch {}
	}

	const targetSignature = (targets) => targets.join('|');

	function navStateFor(targets) {
		const sig = targetSignature(targets);
		const state = readNavState();
		if (state.sig !== sig) return { sig, checked: [], cooldownUntil: 0 };
		return state;
	}

	function markChecked(dates, targets) {
		const state = navStateFor(targets);
		const checked = new Set(state.checked || []);
		dates.forEach((d) => checked.add(d));
		writeNavState({ ...state, checked: [...checked] });
	}

	function clearChecked() {
		writeNavState({ checked: [], cooldownUntil: 0 });
	}

	function nextNavigationDate(targets) {
		const state = navStateFor(targets);
		if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
			RG.log('date navigation cooldown active');
			return null;
		}
		const checked = new Set(state.checked || []);
		const unchecked = targets.filter((d) => !checked.has(d));
		if (!unchecked.length) {
			RG.log('checked all target date windows; cooling down');
			writeNavState({ ...state, checked: [], cooldownUntil: Date.now() + NAV_COOLDOWN_MS });
			return null;
		}
		const range = currentGridDateRange();
		if (!range.start || !range.end) return unchecked[0] || null;
		return unchecked.find((d) => d > range.end)
			|| unchecked.find((d) => d < range.start)
			|| unchecked[0] || null;
	}

	// Find the best matching open cell across watched rows for one visible target date.
	function findGrabTarget(config, targetIso = null) {
		const scan = RG.scanGrid();
		if (!scan) return null;
		const targets = targetIso ? [targetIso] : targetDates(config).filter((d) => scan.colDates.includes(d));

		for (const row of scan.rows) {
			if (!RG.matchesWatchlist(row, config.watchlist)) continue;
			for (const d of row.dates) {
				if (targets.length && !targets.includes(d.iso)) continue;
				if (RG.filter.isMatch(d, config) && d.btnEl && !d.btnEl.disabled) {
					return { row, date: d, key: `${row.id}|${d.iso}` };
				}
			}
		}
		return null;
	}

	let booking = false; // re-entrancy guard while a grab is in flight

	const hasTargets = (c) => !!((c.watchlist && c.watchlist.length) &&
		(c.targetDates && c.targetDates.length));

	// NOTE: arming is governed globally (main.js starts/stops us on the global
	// `enabled`+`armed` flags), so we don't check per-page enable here. We only
	// guard against running with no targeting configured (would match every row).
	async function tick(config) {
		if (!hasTargets(config) || booking) return;

		if (config.groupSize &&
				RG.autofill.readCurrentFromTrigger() !== config.groupSize) {
			await RG.autofill.setGroupSize(config.groupSize);
		}

		const targets = targetDates(config);
		const visibleTargets = targets.filter(isDateVisible);
		if (!visibleTargets.length) {
			const next = nextNavigationDate(targets);
			if (next) {
				if (currentPageDate() === next) {
					const visible = await waitForDateVisible(next, 2500);
					if (visible) return tick(config);
					RG.log('target page date did not become visible; trying next target', next);
					markChecked([next], targets);
					const alt = nextNavigationDate(targets);
					if (alt && alt !== next) navigateToDate(alt);
				} else {
					navigateToDate(next);
				}
			}
			return;
		}

		let target = null;
		for (const iso of visibleTargets) {
			target = findGrabTarget(config, iso);
			if (target) break;
		}
		if (!target) {
			markChecked(visibleTargets, targets);
			const next = nextNavigationDate(targets);
			if (next) navigateToDate(next);
			return;
		}
		if (!target) return;
		if (target.key === lastClickKey) return; // don't spam the same cell

		lastClickKey = target.key; // assume this cell is taken; reset on failure
		booking = true;
		RG.log('auto-grab target', target.key, `${target.date.remaining} spots — booking`);

		let booked = false;
		// Whole sequence retries: re-resolve fresh elements each attempt so a grid
		// re-render between selecting and booking can't strand us on a stale node.
		for (let attempt = 1; attempt <= 3 && !booked; attempt++) {
			const fresh = findGrabTarget(config, target.date.iso) || target;
			const selected = await selectDateCell(fresh.date.btnEl);
			if (!selected) {
				RG.log(`grab attempt ${attempt}: selection never registered`);
				await RG.sleep(400);
				continue;
			}
			booked = await clickBookNow();
			if (!booked) { RG.log(`grab attempt ${attempt}: Book Now failed`); await RG.sleep(500); }
		}

		// Stay armed: auto-grab keeps watching until the user turns it off.
		// On failure, clear the guard so the next tick retries this same cell.
		if (booked) clearChecked();
		if (!booked) lastClickKey = null;
		booking = false;
		notify(booked
			? `RecGrab grabbed ${target.row.name} on ${target.date.iso} — Book Now clicked. Finish checkout to confirm. (Auto-grab still on.)`
			: `RecGrab saw ${target.row.name} on ${target.date.iso} but couldn't lock it in — retrying.`);
	}

	function notify(msg) {
		try { chrome.runtime.sendMessage({ type: 'rg-notify', msg }); } catch {}
		window.dispatchEvent(new CustomEvent('rg:status', { detail: msg }));
	}

	async function start(config) {
		stop();
		if (!hasTargets(config)) return;
		// On a fresh page load the SPA grid renders late; poll for it so we don't
		// burn the first cycles (and so a slot already open on load is caught fast).
		const interval = config.autoGrabIntervalMs || 3000;
		timer = setInterval(() => RG.getConfig().then(tick), interval);
		// Kick a few quick ticks while the grid settles, then fall back to interval.
		for (let i = 0; i < 6; i++) {
			if (!timer) return; // stopped/booked
			await tick(await RG.getConfig());
			if (booking || !timer) return;
			await RG.sleep(700);
		}
	}

	function stop() {
		if (timer) { clearInterval(timer); timer = null; }
	}

	window.RG.autograb = {
		start, stop, tick, findGrabTarget, findBookNow, findAllBookNow,
		clickBookNow, selectDateCell, waitForEnabledBookNow, pressBtn,
		visibleDates, currentGridDateRange, isDateVisible, currentPageDate,
		navigateToDate, waitForDateVisible,
		resetClickGuard: () => (lastClickKey = null)
	};
})();
