// Orchestrator: wires per-context config + DOM observation to the filter /
// autofill / autograb modules, and answers messages from the popup.
// Loaded last so window.RG.* are all defined.
(() => {
	const RG = window.RG;
	const ctx = RG.pageContext();

	let config = null;
	let globals = { enabled: true, armed: false };
	let grabbing = false;
	let debounceTimer = null;

	// Effective config passed downstream: per-page settings + the global on/off.
	function eff() { return { ...config, enabled: globals.enabled }; }
	function panelState() { return { enabled: globals.enabled, armed: globals.armed }; }
	function hasTargets() {
		return !!((config.watchlist && config.watchlist.length) &&
			config.targetDate);
	}

	// Start/stop auto-grab based on the global flags + whether this page has
	// anything configured to grab. Called whenever globals or config change.
	function refreshAutograb() {
		const shouldRun = globals.enabled && globals.armed && hasTargets();
		if (shouldRun && !grabbing) { grabbing = true; RG.autograb.start(eff()); }
		else if (!shouldRun && grabbing) { grabbing = false; RG.autograb.stop(); }
	}

	function rerun() {
		if (!config) return;
		const result = RG.filter.apply(eff());
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
			case 'rg:navigateDate':
				sendResponse({ ok: true, navigated: RG.autograb.navigateToDate(msg.iso) });
				return;
			case 'rg:reapply':
				RG.getConfig().then((c) => { config = c; rerun(); sendResponse({ ok: true }); });
				return true;
			case 'rg:ping':
				sendResponse({ ok: true, context: RG.contextKey(), ready: !!RG.scanGrid() });
				return;
		}
	}); } catch {}

	function maybeAutoSetGroup() {
		if (globals.enabled && config.groupSize &&
			RG.autofill.readCurrentFromTrigger() !== config.groupSize) {
			RG.autofill.setGroupSize(config.groupSize).then((r) => RG.log('group size', r));
		}
	}

	async function boot() {
		config = await RG.getConfig();
		globals = await RG.getGlobals();

		if (!ctx.isAvailabilityPage) {
			RG.log('not an availability page; messaging only');
			return;
		}

		await RG.panel.render(panelState());
		observeGrid();
		rerun();
		maybeAutoSetGroup();
		refreshAutograb();

		// Per-page config changed (popup edits): re-decorate + re-evaluate grab.
		RG.onConfigChange((next) => {
			const prevSize = config.groupSize;
			config = next;
			RG.autograb.resetClickGuard();
			rerun();
			if (next.groupSize !== prevSize) maybeAutoSetGroup();
			refreshAutograb();
		});

		// Global on/off or armed changed (this or any other tab/popup).
		RG.onGlobalsChange(async () => {
			globals = await RG.getGlobals();
			RG.autograb.resetClickGuard();
			rerun();
			RG.panel.update(panelState());
			if (globals.enabled) maybeAutoSetGroup();
			refreshAutograb();
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
