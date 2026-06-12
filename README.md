# RecGrab

Chrome extension for Recreation.gov availability pages. Filters the grid to entry points you care about, highlights open dates for your group size, and optionally clicks an open slot when it appears.

Runs entirely in your browser:
- no artificial API fetches
- auto-trigger stops at the "Book Now" button
- manual check out is required  

---

## Install

```bash
bun run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `dist/`
4. Pin **RecGrab** to your toolbar

---

## Use

1. Open a Recreation.gov **Detailed Availability** page (permit or campground).
2. Click the RecGrab toolbar icon.
3. Select entry points, set group size, pick a target date.
4. Toggle **On** to apply filtering and highlighting.
5. Toggle **Armed** to auto-click an open slot when it appears on the target date — you finish checkout.

Settings save per permit/campground and restore automatically on revisit.
