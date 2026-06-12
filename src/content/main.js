// Orchestrator: wires per-context config + DOM observation to the filter /
// autofill / autograb modules, and answers messages from the popup.
// Loaded last so window.RG.* are all defined.
(() => {
	const RG = window.RG;
	const ctx = RG.pageContext();
	const ENABLE_FLOATING_PANEL = false;

	let config = null;
	let globals = { enabled: true, armed: false };
	let grabbing = false;
	let debounceTimer = null;
	let nativeControlsRoot = null;
	let nativeControlsShield = null;
	let nativeControlsTooltip = null;
	let nativeControlsTooltipTimer = null;

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
		const obs = new MutationObserver(() => {
			scheduleRerun();
			syncNativeControlsLock();
		});
		obs.observe(target, { childList: true, subtree: true });
	}

	function buttonText(btn) {
		return (btn?.textContent || '').replace(/\s+/g, ' ').trim();
	}

	function nativeDateNavButtons() {
		return [...document.querySelectorAll('button')].filter((btn) => {
			const text = buttonText(btn);
			return text.includes('Clear Dates') ||
				text.includes('Prev 5 Days') ||
				text.includes('Next 5 Days');
		});
	}

	function findNativeControlsRoot() {
		const dateInput = document.querySelector(RG.SEL.entryDateHidden);
		const guest = document.querySelector(RG.SEL.guestTrigger);
		const navButtons = nativeDateNavButtons();
		const anchor = dateInput || guest || navButtons[0];
		if (!anchor) return null;

		for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
			const hasDateOrGuest = !!(el.querySelector(RG.SEL.entryDateHidden) ||
				el.querySelector(RG.SEL.guestTrigger));
			const hasDateNav = navButtons.some((btn) => el.contains(btn));
			if (hasDateOrGuest && hasDateNav && !el.querySelector(RG.SEL.anyGrid)) return el;
		}
		return null;
	}

	function removeNativeControlsShield() {
		nativeControlsRoot = null;
		nativeControlsShield?.remove();
		nativeControlsShield = null;
		nativeControlsTooltip?.remove();
		nativeControlsTooltip = null;
		clearTimeout(nativeControlsTooltipTimer);
	}

	function ensureNativeControlsShield() {
		if (nativeControlsShield) return nativeControlsShield;

		nativeControlsShield = document.createElement('div');
		nativeControlsShield.className = 'rg-native-controls-shield';
		nativeControlsShield.setAttribute('role', 'button');
		nativeControlsShield.setAttribute('aria-label', 'Use the RecGrab extension to change booking details');

		for (const eventName of ['pointerdown', 'mousedown', 'touchstart']) {
			nativeControlsShield.addEventListener(eventName, (e) => {
				e.preventDefault();
				e.stopPropagation();
				const point = e.touches?.[0] || e;
				showNativeControlsTooltip(point.clientX, point.clientY);
			}, true);
		}
		nativeControlsShield.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			showNativeControlsTooltip(e.clientX, e.clientY);
		}, true);

		document.body.appendChild(nativeControlsShield);
		return nativeControlsShield;
	}

	function showNativeControlsTooltip(x, y) {
		if (!nativeControlsTooltip) {
			nativeControlsTooltip = document.createElement('div');
			nativeControlsTooltip.className = 'rg-native-controls-tooltip';
			nativeControlsTooltip.textContent = 'Use the RecGrab extension popup to change date and group size.';
			document.body.appendChild(nativeControlsTooltip);
		}

		const left = Math.min(Math.max(x + 12, 12), window.innerWidth - 280);
		const top = Math.min(Math.max(y + 12, 12), window.innerHeight - 72);
		nativeControlsTooltip.style.left = `${left}px`;
		nativeControlsTooltip.style.top = `${top}px`;
		nativeControlsTooltip.classList.add('rg-show');

		clearTimeout(nativeControlsTooltipTimer);
		nativeControlsTooltipTimer = setTimeout(() => {
			nativeControlsTooltip?.classList.remove('rg-show');
		}, 2200);
	}

	function positionNativeControlsShield(root) {
		const rect = root.getBoundingClientRect();
		const shield = ensureNativeControlsShield();
		shield.style.left = `${rect.left}px`;
		shield.style.top = `${rect.top}px`;
		shield.style.width = `${rect.width}px`;
		shield.style.height = `${rect.height}px`;
	}

	function syncNativeControlsLock() {
		document.querySelectorAll('.rg-native-controls-locked').forEach((el) => {
			el.classList.remove('rg-native-controls-locked');
			el.removeAttribute('aria-disabled');
		});
		if (!globals.enabled) {
			removeNativeControlsShield();
			return;
		}

		const root = findNativeControlsRoot();
		if (!root) {
			removeNativeControlsShield();
			return;
		}
		root.classList.add('rg-native-controls-locked');
		root.setAttribute('aria-disabled', 'true');
		nativeControlsRoot = root;
		positionNativeControlsShield(root);
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

	function maybeCenterTargetDate() {
		if (globals.enabled && config.targetDate) {
			RG.autograb.navigateToDate(config.targetDate);
		}
	}

	async function boot() {
		config = await RG.getConfig();
		globals = await RG.getGlobals();

		if (!ctx.isAvailabilityPage) {
			RG.log('not an availability page; messaging only');
			return;
		}

		if (ENABLE_FLOATING_PANEL) await RG.panel.render(panelState());
		observeGrid();
		window.addEventListener('scroll', () => syncNativeControlsLock(), { passive: true, capture: true });
		window.addEventListener('resize', () => syncNativeControlsLock(), { passive: true });
		rerun();
		maybeAutoSetGroup();
		maybeCenterTargetDate();
		syncNativeControlsLock();
		refreshAutograb();

		// Per-page config changed (popup edits): re-decorate + re-evaluate grab.
		RG.onConfigChange((next) => {
			const prevSize = config.groupSize;
			const prevTarget = config.targetDate;
			config = next;
			RG.autograb.resetClickGuard();
			rerun();
			if (next.groupSize !== prevSize) maybeAutoSetGroup();
			if (next.targetDate && next.targetDate !== prevTarget) maybeCenterTargetDate();
			syncNativeControlsLock();
			refreshAutograb();
		});

		// Global on/off or armed changed (this or any other tab/popup).
		RG.onGlobalsChange(async () => {
			globals = await RG.getGlobals();
			RG.autograb.resetClickGuard();
			rerun();
			if (ENABLE_FLOATING_PANEL) RG.panel.update(panelState());
			if (globals.enabled) maybeAutoSetGroup();
			syncNativeControlsLock();
			refreshAutograb();
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
