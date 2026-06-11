// Watch the grid and assist clicking an open date cell for a watched entry
// point on a target date.
//
// SAFETY: this intentionally stops after opening the date (the step that adds
// it to a trip / shows the booking panel). It never advances through reCAPTCHA,
// payment, or final purchase. Treat it as a fast "click for me" helper, not a
// bot. Respect Recreation.gov's Terms of Service and rate limits.
(() => {
	const RG = window.RG;
	let timer = null;
	let lastClickKey = null;

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
		target.date.btnEl.click();

		// Stop the loop after a successful click so we don't keep firing while the
		// user reviews the booking panel. User can re-enable from the panel/popup.
		stop();
		await RG.setConfig({ autoGrab: false });
		notify(`RecGrab opened ${target.row.name} on ${target.date.iso}. Review & finish manually.`);
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

	window.RG.autograb = { start, stop, tick, findGrabTarget, resetClickGuard: () => (lastClickKey = null) };
})();
