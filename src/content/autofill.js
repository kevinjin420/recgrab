// Auto-set the "Group Members" / number-of-people counter.
//
// The popup renders on demand and its internal markup isn't in the static
// capture, so this converges robustly: read current value, find the stepper
// input or +/- buttons, and drive them toward the target.
(() => {
	const RG = window.RG;

	// The trigger label reads like "3 Group Members" / "2 Guests".
	function readCurrentFromTrigger() {
		const t = document.querySelector(RG.SEL.guestTrigger);
		if (!t) return null;
		const m = (t.textContent || '').match(/(\d+)/);
		return m ? parseInt(m[1], 10) : null;
	}

	function findStepperButtons(popup) {
		const buttons = [...popup.querySelectorAll('button')];
		const inc = buttons.find((b) => /add|increase|increment|plus|\+|more/i.test(
			(b.getAttribute('aria-label') || '') + ' ' + b.className
		)) || buttons.find((b) => b.querySelector('use[href*="add"], use[href*="plus"]'));
		const dec = buttons.find((b) => /remove|decrease|decrement|minus|subtract|fewer/i.test(
			(b.getAttribute('aria-label') || '') + ' ' + b.className
		)) || buttons.find((b) => b.querySelector('use[href*="subtract"], use[href*="minus"], use[href*="remove"]'));
		return { inc, dec };
	}

	async function setGroupSize(target, { maxSteps = 60 } = {}) {
		target = parseInt(target, 10);
		if (!Number.isFinite(target) || target < 1) return { ok: false, reason: 'bad-target' };

		const trigger = document.querySelector(RG.SEL.guestTrigger);
		if (!trigger) return { ok: false, reason: 'no-trigger' };

		if (readCurrentFromTrigger() === target) return { ok: true, value: target };

		if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
		let popup;
		try {
			popup = await RG.waitFor(RG.SEL.guestPopup + ' button, ' + RG.SEL.guestPopup + ' input',
				{ timeout: 4000 });
			popup = document.querySelector(RG.SEL.guestPopup);
		} catch {
			return { ok: false, reason: 'popup-timeout' };
		}

		// Preferred path: a real number input we can set directly.
		const numInput = popup.querySelector('input[type="number"], input[inputmode="numeric"]');
		if (numInput) {
			RG.setReactInputValue(numInput, String(target));
			await RG.sleep(150);
			if (readCurrentFromTrigger() === target) {
				closePopup(trigger, popup);
				return { ok: true, value: target, via: 'input' };
			}
		}

		// Fallback: drive the +/- stepper.
		const { inc, dec } = findStepperButtons(popup);
		let steps = 0;
		while (steps++ < maxSteps) {
			const cur = readCurrentFromTrigger();
			if (cur == null) break;
			if (cur === target) break;
			const btn = cur < target ? inc : dec;
			if (!btn || btn.disabled) break;
			btn.click();
			await RG.sleep(80);
		}

		const final = readCurrentFromTrigger();
		closePopup(trigger, popup);
		return { ok: final === target, value: final, via: 'stepper' };
	}

	function closePopup(trigger, popup) {
		const done = popup && [...popup.querySelectorAll('button')]
			.find((b) => /done|apply|close|update/i.test(b.textContent || ''));
		if (done) { done.click(); return; }
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		if (trigger.getAttribute('aria-expanded') === 'true') trigger.click();
	}

	window.RG.autofill = { setGroupSize, readCurrentFromTrigger };
})();
