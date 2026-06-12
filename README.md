 # RecGrab — Recreation.gov Availability Helper

A Manifest V3 Chrome extension that makes Recreation.gov **Detailed Availability**
grids (wilderness permits and campgrounds) easier to scan and act on:

1. **Filter** the grid down to only the entry points / sites you care about.
2. **Highlight** open dates that have enough spots for your group.
3. **Auto-set** the group size (number of people).
4. **Assist-click** an open date on a target date (opens it for you — you finish the booking).

It was built against a capture of
`/permits/445859/registration/detailed-availability` (Yosemite Wilderness
Permits) but the selectors are generic to Recreation.gov's "sarsaparilla" grid,
so it also works on campground detailed-availability pages. The popup UI mirrors
recreation.gov's own palette and Open Sans typography.

## Usage flow

1. Navigate to a permit/campground **Detailed Availability** page.
2. Click the **RecGrab** toolbar icon. The popup **scans the page** and lists the
   real entry points with live open-spot counts.
3. Pick the entry points to watch, set your group size, choose highlight options,
   and select the target date.
4. Per-page settings **auto-save to `chrome.storage.sync`, keyed by the permit/
   campground ID** (e.g. `permits:445859`) — stable across visits even though the
   URL's `?date=&type=` params change.
5. **On** and **Armed** are two global switches in the popup header (and the
   floating panel). They are **universal** — stored as top-level sync flags — so
   you can arm on one page and **disarm from any other page/tab**. `Armed` is
   grayed out while the extension is **Off**, and turning **Off** also disarms.
6. Next time you open a saved page, the config loads automatically and the content
   script applies your filtering/highlighting (and group size). If globally
   **Armed**, any saved page with target entry points and a target date auto-grabs.

### First-visit "unset" state

When no group size is set, recreation.gov shows the placeholder **"Add Group
Members…"** and **hides all availability** (the grid renders headers only — no
entry-point rows). RecGrab detects this (`scanOptions().needsGroupSize`) and the
popup shows a **"Set a group size to load availability"** banner with its own
stepper + **Set & load** button. Clicking it sets the group size on the page and
auto-rescans until the entry points appear. A saved group size is always applied
automatically on later visits, so the grid unlocks itself.

> ⚠️ **Use responsibly.** This is a convenience/accessibility helper, not a bot.
> When armed, auto-grab selects a matching date and clicks **Book Now** to lock
> the slot, then **stays armed until you turn it off** (here or from any page). It
> never touches reCAPTCHA, the cart, payment, or final purchase — you finish
> checkout. Rapid automated booking can violate Recreation.gov's Terms of Service
> and may get your account blocked. Keep the interval reasonable and don't hammer
> the site.

---

## Build & install (developer mode)

Sources live in `public/` (static assets + `manifest.json`) and `src/` (scripts).
A build step assembles them into `dist/` and syncs the manifest version from
`package.json` (single source of truth). Tooling uses [Bun](https://bun.sh).

```bash
bun run build      # -> dist/  (load this in Chrome)
bun run release    # build + zip dist/ into ext.zip
```

1. Run `bun run build`.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the generated `dist/` folder.
5. Pin **RecGrab** to your toolbar.
6. Open a Recreation.gov detailed-availability page. A floating panel appears
   bottom-right, and the toolbar popup has the full settings.

> To bump the version, edit `version` in `package.json` only — the build writes
> it into `dist/manifest.json` for you.

## How it works

Recreation.gov is a React single-page app. RecGrab runs as a content script and:

- Reads the live grid via DOM selectors (no private API calls).
- Re-applies filtering/highlighting on every re-render through a `MutationObserver`.
- Drives React-controlled inputs with native value setters so React's state updates.
- Answers `rg:scan` / `rg:applyGroupSize` messages from the popup, which is how the
  popup pulls real entry points + dates and triggers the group-size autofill.

Config is **per page**: stored under `configs[<kind>:<id>]` in `chrome.storage.sync`.
The popup writes there; the content script subscribes via `storage.onChanged` and
re-applies live — so tweaking the popup updates the page highlighting instantly.

### Architecture

```
package.json                 build/release scripts + version source of truth
public/
  manifest.json              MV3 config, content-script + popup + worker wiring
  icons/                     generated placeholder icons
src/
  content/
    core.js     window.RG namespace: selectors, grid scanning + parsing,
                config storage, React input helper, waitFor/sleep utils
    filter.js   RG.filter — hide/dim/highlight rows & date cells
    autofill.js RG.autofill — open the guest counter and converge to group size
    autograb.js RG.autograb — navigate to the target date, click the first matching open cell, then Book Now
    panel.js    RG.panel — floating in-page control panel
    main.js     orchestrator: config + MutationObserver + SPA-nav handling
    content.css decorations (hide/dim/highlight) + panel styles
  popup/        toolbar settings UI (popup.html/css/js)
  background/
    service-worker.js  seeds defaults, badge state, notifications
dist/                        build output (gitignored) — load this in Chrome
```

### Key selectors (from the capture)

| Purpose | Selector |
| --- | --- |
| Availability grid | `div[data-component="Grid"][aria-label="Availability by Sites and Dates"]` |
| Row | `div[data-component="Row"][role="row"]` |
| Cell | `div[data-component="GridCell"]` (`.available` / `.unavailable` / `.not-yet-released`) |
| Date button | `button.rec-availability-date` (aria-label `"SAT 13\nPeople:  30 out of 30"`) |
| Entry-point name | `button` aria-label, e.g. `"Cathedral Lakes"` |
| Group size trigger | `#guest-counter` → popup `#guest-counter-popup` |
| Entry date | `#single-date-hidden` |

Row columns are `[ID][Entry Points][Area][date…]`. The date columns are mapped
to ISO dates by parsing the header row's screen-reader date labels
(`"Wednesday, June 10, 2026"`).

## Settings (in the popup)

| Setting | Effect |
| --- | --- |
| On (global) | Master switch for the whole extension; turning it off disarms |
| Armed (global) | Auto-grab is live on every saved page; grayed out while Off |
| Entry points | Checkbox list scanned from the page (name, area, ID, open count). All / None / Open-only shortcuts + search. Selection is stored as entry-point IDs |
| Group size | Number of people; stepper or type. Saved group sizes are always applied automatically when the page loads |
| Target date | The single date RecGrab navigates to before scanning/clicking |
| Hide unselected entry points | Collapse rows not in your selection |
| Flexible dates | Also mark other watched, bookable dates in the visible window as blue alternatives; auto-grab still uses the exact target date |
| Automatic highlighting | Watched, bookable target cells are green; flexible alternatives are blue; non-actionable cells are muted; available cells with too few spots are subtly amber |
| On (global) | Master on/off for the whole extension; toggling off disarms |
| Armed (global) | Auto-grab is live on every saved page; clicks the date cell then **Book Now**, stays armed until turned off |

## Limitations & notes

- **Booking completion is intentionally out of scope.** RecGrab opens a date and
  hands control back to you to handle date confirmation, captcha, and checkout.
- The guest-counter popup markup isn't in the static capture, so `autofill.js`
  uses a resilient strategy: prefer a number input, else read the popup's own
  value display, else count our own +/- clicks from an assumed 0 (this last part
  is what makes setting the count work from the "Add Group Members…" placeholder
  state, where the trigger shows no number). If Recreation.gov changes that
  widget, adjust `findStepperButtons()` / `readFromPopup()`.
- Selectors may drift if the site updates its design system. Update `SEL` in
  `core.js` if filtering stops matching.
- No analytics, no network calls, no data leaves your browser. Config is stored
  in `chrome.storage.sync`.

## Tweaking selectors quickly

Open DevTools on an availability page and run:

```js
window.RG.scanGrid()        // structured view of every row + date cell
window.RG.scanOptions()     // exactly what the popup consumes (entry points + dates)
window.RG.getConfig()       // current page's saved settings
window.RG.autofill.setGroupSize(4)
```
