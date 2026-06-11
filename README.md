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
   real entry points (with live open-spot counts) and the visible date columns.
3. Pick the entry points to watch, set your group size, choose highlight options,
   and (optionally) select target dates and arm auto-grab.
4. Everything **auto-saves to `chrome.storage.sync`, keyed by the permit/campground
   ID** (e.g. `permits:445859`) — stable across visits even though the URL's
   `?date=&type=` params change.
5. Next time you open that page, the saved config loads automatically and the
   content script applies your filtering/highlighting (and group size / auto-grab
   if enabled). A small floating panel shows live status + quick kill switches.

> ⚠️ **Use responsibly.** This is a convenience/accessibility helper, not a bot.
> Auto-grab deliberately **stops after opening a date** and never touches
> reCAPTCHA, the cart, payment, or final purchase. Rapid automated booking can
> violate Recreation.gov's Terms of Service and may get your account blocked.
> Keep the auto-grab interval reasonable and don't hammer the site.

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
    autograb.js RG.autograb — poll grid, click first open target-date cell, stop
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
| Enable on this page | Master switch for this page's config |
| Entry points | Checkbox list scanned from the page (name, area, ID, open count). All / None / Open-only shortcuts + search. Selection is stored as entry-point IDs |
| Group size | Number of people; stepper or type. "Set on page" drives the guest counter now |
| Auto-set group size on load | Apply the group size automatically when the page loads |
| Highlight open matches | Pulsing outline on bookable cells meeting the spot threshold |
| Hide unselected rows | Collapse rows not in your selection |
| Hide selected rows with nothing open | Hide watched rows with no open date in view |
| Dim unavailable / not-released | De-emphasize cells you can't book |
| Min open spots | Threshold for what counts as a "match" |
| Target dates | Date chips scanned from the page; the dates auto-grab may click |
| Arm auto-grab | Poll + click the first open target-date cell for a selected row, then stop |

## Limitations & notes

- **Booking completion is intentionally out of scope.** RecGrab opens a date and
  hands control back to you to handle date confirmation, captcha, and checkout.
- The guest-counter popup markup isn't in the static capture, so `autofill.js`
  uses a resilient strategy (number input first, then +/- stepper, then close).
  If Recreation.gov changes that widget, adjust `findStepperButtons()`.
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
