// Auto-set the "Group Members" counter.
//
// Confirmed popup structure (from capture-members), rendered inside
// #guest-counter-popup when open:
//   .rec-guest-counter-row
//     button[aria-label="Remove Peoples"]   (decrement; disabled at min)
//     input[name="numberField"]             (text input, pattern \d*, value "0")
//     button[aria-label="Add Peoples"]      (increment)
// It's a react-aria NumberField, so we drive the +/- buttons and read the input
// value each step, self-correcting any over/undershoot. Availability is hidden
// until this is set, so this is what unlocks the grid from the placeholder state.
(() => {
	const RG = window.RG;

	function readCurrentFromTrigger() {
		return RG.readGroupSize();
	}

	const visible = (el) => {
		if (!el) return false;
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	};

	// One clean activation with correct coordinates. react-aria's usePress checks
	// the pointer is still over the target on pointerup (via clientX/Y), so we
	// must supply the element center or it cancels the press.
	function press(el) {
		if (!el) return;
		const r = el.getBoundingClientRect();
		const o = {
			bubbles: true, cancelable: true, composed: true, view: window,
			clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
			button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true
		};
		try { el.dispatchEvent(new PointerEvent('pointerdown', o)); } catch { el.dispatchEvent(new MouseEvent('mousedown', o)); }
		el.dispatchEvent(new MouseEvent('mousedown', { ...o }));
		try { el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); } catch { el.dispatchEvent(new MouseEvent('mouseup', o)); }
		el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
		el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
	}

	// Detection keys off elements that only exist while the dropdown is open
	// (the counter row / number input), NOT the container's bounding box —
	// react-aria's dialog node is often 0x0 with absolutely-positioned content.
	function findOpenPopup() {
		const row = document.querySelector('.rec-guest-counter-row');
		if (row) return row.closest('#guest-counter-popup, [role="dialog"], .sarsa-dropdown-base-popup') || row.parentElement;
		const input = document.querySelector('input[name="numberField"]');
		if (input) return input.closest('#guest-counter-popup, [role="dialog"], .sarsa-dropdown-base-popup') || input.parentElement;
		const direct = document.querySelector(RG.SEL.guestPopup);
		if (direct && direct.querySelector('button, input')) return direct;
		return null;
	}

	async function waitForPopup(timeout = 3500) {
		const t0 = Date.now();
		while (Date.now() - t0 < timeout) {
			const p = findOpenPopup();
			if (p) return p;
			await RG.sleep(100);
		}
		return null;
	}

	// Open the dropdown once, verifying via aria-expanded / popup presence.
	async function openPopup() {
		const trigger = document.querySelector(RG.SEL.guestTrigger);
		if (!trigger) return { trigger: null, popup: null };
		if (trigger.getAttribute('aria-expanded') === 'true' || findOpenPopup()) {
			const p = await waitForPopup(1200);
			if (p) return { trigger, popup: p };
		}
		press(trigger);
		const p = await waitForPopup(1200);
		if (p) return { trigger, popup: p };
		return { trigger, popup: findOpenPopup() };
	}

	// Current count from the popup's number input (text input with digits).
	function readFromPopup(popup) {
		if (!popup) return null;
		const input = popup.querySelector('input[name="numberField"], .rec-guest-counter-row input, input[type="number"], input[inputmode="numeric"]');
		if (input) {
			const v = (input.value || '').replace(/\D/g, '');
			if (v !== '') return parseInt(v, 10);
		}
		const spin = popup.querySelector('[role="spinbutton"][aria-valuenow]');
		if (spin) return parseInt(spin.getAttribute('aria-valuenow'), 10);
		return null;
	}

	function findStepperButtons(popup) {
		const buttons = [...popup.querySelectorAll('button, [role="button"]')];
		const txt = (b) => ((b.getAttribute('aria-label') || '') + ' ' + b.className + ' ' + (b.textContent || ''));
		const icon = (b, ...frags) => frags.some((f) => b.querySelector(`use[href*="${f}"]`));
		const inc = buttons.find((b) => /\badd\b|increase|increment|\bplus\b|\bmore\b/i.test(txt(b)))
			|| buttons.find((b) => icon(b, 'add', 'plus'))
			|| buttons.find((b) => /^[+]$/.test((b.textContent || '').trim()));
		const dec = buttons.find((b) => /remove|decrease|decrement|minus|subtract|\bfewer\b/i.test(txt(b)))
			|| buttons.find((b) => icon(b, 'subtract', 'minus', 'remove'))
			|| buttons.find((b) => /^[-−–]$/.test((b.textContent || '').trim()));
		return { inc, dec };
	}

	async function setGroupSize(target, { maxSteps = 80 } = {}) {
		target = parseInt(target, 10);
		if (!Number.isFinite(target) || target < 1) return { ok: false, reason: 'bad-target' };

		if (readCurrentFromTrigger() === target) return { ok: true, value: target };

		const { trigger, popup } = await openPopup();
		if (!trigger) return { ok: false, reason: 'no-trigger' };
		if (!popup) return { ok: false, reason: 'popup-not-found' };

		// Drive the +/- buttons only. Each react-aria increment commits the value
		// immediately, so no blur/Enter is needed (and blurring would move focus
		// out of the FocusScope and close the popover before we finish).
		const { inc, dec } = findStepperButtons(popup);
		if (!inc && !dec) {
			commit(trigger, popup);
			return { ok: false, reason: 'no-stepper', hint: 'run RG.autofill.dumpPopup()' };
		}

		// Read the real value each iteration so any double-fire self-corrects.
		let steps = 0;
		let stalls = 0;
		let lastSeen = readFromPopup(popup) ?? readCurrentFromTrigger() ?? 0;
		while (steps++ < maxSteps) {
			const read = readFromPopup(popup) ?? readCurrentFromTrigger();
			const cur = read == null ? lastSeen : read;
			if (cur === target) break;
			const goUp = cur < target;
			const btn = goUp ? inc : dec;
			if (!btn || btn.disabled) break;
			press(btn);
			await RG.sleep(90);
			const after = readFromPopup(popup) ?? readCurrentFromTrigger();
			if (after != null && after === cur) {
				if (++stalls >= 3) {
					commit(trigger, popup);
					return { ok: false, reason: 'stepper-no-progress', value: cur, hint: 'run RG.autofill.dumpPopup()' };
				}
			} else {
				stalls = 0;
			}
			lastSeen = after == null ? cur + (goUp ? 1 : -1) : after;
		}

		const reached = readFromPopup(popup);
		commit(trigger, popup);
		await RG.sleep(200);
		const final = readCurrentFromTrigger() ?? reached ?? lastSeen;
		return { ok: final === target, value: final, via: 'stepper' };
	}

	// Close the dropdown so the SPA commits the selection and fetches availability.
	// Each increment already commits the number; closing finalizes the overlay.
	function commit(trigger, popup) {
		const actions = popup && (popup.closest('[data-component="DropdownBase-popup"]') || popup);
		const close = actions && [...actions.querySelectorAll('button')]
			.find((b) => /^(close|done|apply|update|save|confirm)$/i.test((b.textContent || '').trim()));
		if (close) { press(close); return; }
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		if (trigger && trigger.getAttribute('aria-expanded') === 'true') press(trigger);
	}

	async function dumpPopup() {
		const { popup } = await openPopup();
		const html = popup ? popup.outerHTML : '(popup not found — react-aria may mount elsewhere)';
		RG.log('GUEST POPUP MARKUP:\n', html);
		return html;
	}

	window.RG.autofill = {
		setGroupSize, readCurrentFromTrigger, readFromPopup, findStepperButtons,
		findOpenPopup, press, openPopup, dumpPopup
	};
})();
