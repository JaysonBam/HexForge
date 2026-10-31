# Printing appearance review

The dark theme uses the Bookings palette (`#0f172a` canvas, `#1e293b` panels, `#334155` borders) with HexForge's existing gold identity and coloured workflow lanes.

## Local visual fixture

Run from the repository root:

```sh
npm run build:web
node web/qa/theme-preview.mjs
```

Open `http://127.0.0.1:5197`. The fixture renders the actual app, route components, providers, and production CSS. Authentication and data are replaced only in this QA entry; it is never imported by the production app. Requests are handled locally, desktop actions are disabled, and no live records or emails are changed. Restart after source changes, or run `node web/qa/theme-preview.mjs --build-only` after building.

Sample projects: `REVIEW`, `QUEUE`, `ACTIVE`, `COLLECT`, `QUOTE`, `CLOSED`, `CANCEL`, `EMPTY`. `?empty=1`, `?loading=1`, and `?failure=1` exercise empty/loading/error states. `?helper=connected`, `?helper=ambiguous`, and `?helper=root` exercise the optional local-file panel.

## Reviewed display inventory

| Display | Review |
| --- | --- |
| Home, search, counters, three lanes, empty lanes and load errors | Pass; quieter surface hierarchy and two-column phone counters. |
| Projects, state filter, collection report and empty results | Pass; readable rows, coloured status badges and themed popovers. |
| New project, student/academic/payment fields, Gmail picker | Pass after replacing the bright header gradient with slate. |
| Project overview, progress, blockers, archive/delete/revive | Pass; distinct warning/error tones and restrained borders. |
| Parts, expanded primary/secondary materials, verification and failed-save feedback | Pass; dark controls, legible labels and totals. |
| Payments, issued/draft/outdated/unissued quotes, receipt/override and communication | Pass; table hierarchy and amber informational states remain clear. |
| Production and start/finish/fail/requeue/release dialogs | Pass; lane colours, job details, controls and prompts remain distinct. |
| Collection, paid/blocked states, collected/uncollected parts | Pass; receipt and handover states remain clear. |
| Notes (empty/populated), Messages (linked/unlinked), Timeline | Pass; coherent drawers, editable surfaces and focus treatment. |
| Gmail reply editor, settings template editor and global signature | Pass; dark toolbars and token chips; highlights use dark text for contrast. |
| Settings appearance, suggestions, modules, filament prices, Gmail connection | Pass; controls fit down to 320px. |
| File connection popover, file list, ambiguous folders, unavailable workflow folders | Pass; phone popover stays inside the viewport. |
| Account menu, login, About, Privacy and Terms | Pass; public-page surfaces match the workspace and sign-in retains its photographic design. |
| Loading skeletons and missing project | Pass; themed loading and clear recovery actions. |

Review widths: 320, 393, 1024, 1280 and 1440px. Screenshots and DOM snapshots were captured through the browser; geometry checks found no viewport overflow, header collision or off-screen header control in the final captures. Each screenshot was visually inspected in contact sheets, with enlarged checks for changed areas. Screenshot evidence is stored in the task's `output/printing-dark-mode/` artifact directory, including `audit.json` and `review.md`.

## Refinements made during review

- Wrap the header safely, collapse project navigation labels before they collide, and measure header height for the project rail.
- Reset the workspace scroller when changing route or workflow tab, so phone navigation starts at the top.
- Reduce the narrow-phone primary action to an accessible icon button, and keep the theme choices inside their panel.
- Use two columns for phone summary counters and an identifiable file icon for the compact file control.
- Anchor the phone file-settings popover below the header with viewport-safe margins.
- Remove the white centre of the intake/detail gradient in dark mode and align public reading panels with workspace panels.

## Validation

- `npm run build:web`: production TypeScript and Vite build passed.
- `npm run test:web`: 109 tests passed, including five tests of the actual first-paint theme bootstrap (saved preferences, both system schemes, invalid values and blocked storage).
- Browser checks: header toggle, System/Light/Dark controls, reload persistence, cross-tab synchronisation, light-mode Home/Settings/Production, and responsive route/tab navigation.
- Dark utilities and dark palette overrides are screen-only. Print uses the light palette and light native controls; generated quote PDFs are independent of the screen theme.

The visual review uses representative sample data. It does not exercise live Gmail sending, physical printer operation, or real filesystem actions.
