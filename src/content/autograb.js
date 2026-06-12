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

	// Activate the button once with coordinates that react-aria's usePress accepts.
	function pressBtn(btn) {
		try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
		try { btn.focus({ preventScroll: true }); } catch {}
		if (RG.autofill && RG.autofill.press) RG.autofill.press(btn);
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

	function addDays(iso, delta) {
		const [year, month, day] = iso.split('-').map(Number);
		const d = new Date(year, month - 1, day);
		d.setDate(d.getDate() + delta);
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	function pageDateForTarget(iso) {
		return addDays(iso, -4);
	}

	function navigateToDate(iso) {
		const pageIso = pageDateForTarget(iso);
		if (currentPageDate() === pageIso) {
			RG.log('date navigation pending; already on page date', pageIso, 'for target', iso);
			return false;
		}
		const url = new URL(location.href);
		url.searchParams.set('date', pageIso);
		if (url.toString() === location.href) return false;
		RG.log('navigating availability date', currentPageDate(), '->', pageIso, 'for target', iso);
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

	// After a date cell is selected, wait for "Book Now" to enable, then click it once.
	async function clickBookNow({ timeout = 8000 } = {}) {
		const btn = await waitForEnabledBookNow(timeout);
		if (!btn) {
			RG.log('"Book Now" never enabled within', timeout, 'ms — selection may not have registered');
			return false;
		}
		RG.log('clicking "Book Now"');
		pressBtn(btn);
		await RG.sleep(450);
		// If the page navigated away or the button is gone/disabled, treat as success.
		if (!document.contains(btn) || !isEnabled(findBookNow() || btn)) {
			RG.log('"Book Now" click registered');
			return true;
		}
		RG.log('"Book Now" press did not appear to take');
		return false;
	}

	// Press a date cell, then confirm selection by waiting for Book Now to enable.
	async function selectDateCell(btnEl) {
		if (!btnEl || !document.contains(btnEl)) return false;
		RG.log('selecting date cell');
		pressBtn(btnEl);
		return !!(await waitForEnabledBookNow(2500));
	}

	const targetDate = (config) => config.targetDate || '';

	// Find the best matching open cell across watched rows for one visible target date.
	function findGrabTarget(config, targetIso = null) {
		const scan = RG.scanGrid();
		if (!scan) return null;
		const target = targetIso || targetDate(config);

		for (const row of scan.rows) {
			if (!RG.matchesWatchlist(row, config.watchlist)) continue;
			for (const d of row.dates) {
				if (target && d.iso !== target) continue;
				if (RG.filter.isMatch(d, config) && d.btnEl && !d.btnEl.disabled) {
					return { row, date: d, key: `${row.id}|${d.iso}` };
				}
			}
		}
		return null;
	}

	let booking = false; // re-entrancy guard while a grab is in flight

	const hasTargets = (c) => !!((c.watchlist && c.watchlist.length) && targetDate(c));

	// NOTE: arming is governed globally (main.js starts/stops us on the global
	// `enabled`+`armed` flags), so we don't check per-page enable here. We only
	// guard against running with no targeting configured (would match every row).
	async function tick(config) {
		if (!hasTargets(config) || booking) return;

		if (config.groupSize &&
				RG.autofill.readCurrentFromTrigger() !== config.groupSize) {
			await RG.autofill.setGroupSize(config.groupSize);
		}

		const targetIso = targetDate(config);
		if (!isDateVisible(targetIso)) {
			if (currentPageDate() === pageDateForTarget(targetIso)) {
				const visible = await waitForDateVisible(targetIso, 2500);
				if (visible) return tick(config);
				RG.log('waiting for target date window', targetIso);
			} else {
				navigateToDate(targetIso);
			}
			return;
		}

		const target = findGrabTarget(config, targetIso);
		if (!target) {
			return;
		}
		if (target.key === lastClickKey) return; // don't spam the same cell

		lastClickKey = target.key; // do not click the same cell again unless targeting changes
		booking = true;
		RG.log('auto-grab target', target.key, `${target.date.remaining} spots — booking`);

		const selected = await selectDateCell(target.date.btnEl);
		const booked = selected && await clickBookNow();
		if (!selected) {
			RG.log('date selection did not register');
		}

		// Stay armed: auto-grab keeps watching until the user turns it off.
		booking = false;
		notify(booked
			? `RecGrab grabbed ${target.row.name} on ${target.date.iso} — Book Now clicked. Finish checkout to confirm. (Auto-grab still on.)`
			: `RecGrab saw ${target.row.name} on ${target.date.iso} but couldn't lock it in.`);
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
		pageDateForTarget,
		resetClickGuard: () => (lastClickKey = null)
	};
})();
