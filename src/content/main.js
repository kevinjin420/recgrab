// Orchestrator: wires per-context config + DOM observation to the filter /
// autofill / autograb modules, and answers messages from the popup.
// Loaded last so window.RG.* are all defined.
(() => {
	const RG = window.RG;
	const ctx = RG.pageContext();

	let config = null;
	let debounceTimer = null;

	function rerun() {
		if (!config) return;
		const result = RG.filter.apply(config);
		window.dispatchEvent(new CustomEvent('rg:matchcount', { detail: result }));
	}

	function scheduleRerun() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(rerun, 200);
	}

	function observeGrid() {
		const target = document.getElementById('recApp') || document.body;
		const obs = new MutationObserver(() => scheduleRerun());
		obs.observe(target, { childList: true, subtree: true });
	}

	// Popup <-> content messaging. Registered unconditionally so the popup can
	// talk to any recreation.gov tab, even non-availability pages. Wrapped because
	// an orphaned script (after an extension reload) can't register listeners.
	try { chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
		if (!msg || !msg.type) return;
		switch (msg.type) {
			case 'rg:scan':
				sendResponse(RG.scanOptions());
				return; // sync response
			case 'rg:applyGroupSize':
				RG.autofill.setGroupSize(msg.size).then((r) => sendResponse(r));
				return true; // async
			case 'rg:dumpPopup':
				RG.autofill.dumpPopup().then((html) => sendResponse({ html }));
				return true; // async
			case 'rg:reapply':
				RG.getConfig().then((c) => { config = c; rerun(); sendResponse({ ok: true }); });
				return true;
			case 'rg:ping':
				sendResponse({ ok: true, context: RG.contextKey(), ready: !!RG.scanGrid() });
				return;
		}
	}); } catch {}

	async function boot() {
		config = await RG.getConfig();

		if (!ctx.isAvailabilityPage) {
			RG.log('not an availability page; messaging only');
			return;
		}

		await RG.panel.render(config);
		observeGrid();
		rerun();

		if (config.enabled && config.autoSetGroupSize && config.groupSize) {
			RG.autofill.setGroupSize(config.groupSize).then((r) => RG.log('initial group size', r));
		}
		if (config.enabled && config.autoGrab) RG.autograb.start(config);

		RG.onConfigChange((next) => {
			const wasGrabbing = config.autoGrab;
			const prevSize = config.groupSize;
			config = next;
			RG.autograb.resetClickGuard();
			rerun();
			RG.panel.update(next);

			if (next.enabled && next.autoSetGroupSize && next.groupSize &&
				(next.groupSize !== prevSize || RG.autofill.readCurrentFromTrigger() !== next.groupSize)) {
				RG.autofill.setGroupSize(next.groupSize);
			}
			if (next.enabled && next.autoGrab && !wasGrabbing) RG.autograb.start(next);
			if ((!next.enabled || !next.autoGrab) && wasGrabbing) RG.autograb.stop();
		});
	}

	// Re-apply on SPA navigations (recreation.gov is a single-page app). Self-
	// destructs if this script gets orphaned by an extension reload.
	let lastPath = location.pathname;
	const navTimer = setInterval(() => {
		if (!RG.extAlive()) { clearInterval(navTimer); RG.autograb.stop(); return; }
		if (location.pathname !== lastPath) {
			lastPath = location.pathname;
			RG.log('SPA navigation ->', lastPath);
			RG.getConfig().then((c) => { config = c; rerun(); });
		}
	}, 1000);

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
