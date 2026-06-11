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

	// After a date cell is selected, wait for "Book Now" to enable, then click it.
	async function clickBookNow({ timeout = 8000 } = {}) {
		const t0 = Date.now();
		let logged = 0;
		while (Date.now() - t0 < timeout) {
			const btn = findBookNow();
			if (isEnabled(btn)) {
				RG.log('auto-grab clicking "Book Now"');
				pressBtn(btn);
				return true;
			}
			const elapsed = Date.now() - t0;
			if (elapsed - logged >= 1500) {
				logged = elapsed;
				RG.log('auto-grab waiting for "Book Now"…',
					btn ? `(found but disabled)` : '(not found yet)');
			}
			await RG.sleep(150);
		}
		RG.log('auto-grab: "Book Now" never enabled within', timeout, 'ms — finish manually');
		return false;
	}

	// Find the best matching open cell across watched rows + target dates.
	function findGrabTarget(config) {
		const scan = RG.scanGrid();
		if (!scan) return null;
		const targets = (config.targetDates || []).filter(Boolean);

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

	async function tick(config) {
		if (!config.enabled || !config.autoGrab) return;

		if (config.autoSetGroupSize && config.groupSize &&
				RG.autofill.readCurrentFromTrigger() !== config.groupSize) {
			await RG.autofill.setGroupSize(config.groupSize);
		}

		const target = findGrabTarget(config);
		if (!target) return;
		if (target.key === lastClickKey) return; // don't spam the same cell

		lastClickKey = target.key;
		RG.log('auto-grab clicking', target.key, `${target.date.remaining} spots`);
		// Stop the loop first so the interval can't re-fire while we book.
		stop();
		pressBtn(target.date.btnEl);
		await RG.sleep(250);

		// Lock in the spot by clicking "Book Now" once it enables.
		const booked = await clickBookNow();

		await RG.setConfig({ autoGrab: false });
		notify(booked
			? `RecGrab grabbed ${target.row.name} on ${target.date.iso} — Book Now clicked. Finish checkout to confirm.`
			: `RecGrab opened ${target.row.name} on ${target.date.iso}, but "Book Now" didn't enable. Finish manually.`);
	}

	function notify(msg) {
		try { chrome.runtime.sendMessage({ type: 'rg-notify', msg }); } catch {}
		window.dispatchEvent(new CustomEvent('rg:status', { detail: msg }));
	}

	function start(config) {
		stop();
		if (!config.autoGrab) return;
		timer = setInterval(() => RG.getConfig().then(tick), config.autoGrabIntervalMs || 4000);
		tick(config);
	}

	function stop() {
		if (timer) { clearInterval(timer); timer = null; }
	}

	window.RG.autograb = { start, stop, tick, findGrabTarget, findBookNow, findAllBookNow, clickBookNow, pressBtn, resetClickGuard: () => (lastClickKey = null) };
})();
