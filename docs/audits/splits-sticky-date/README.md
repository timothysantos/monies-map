# The pinned Splits date matches the pinned Entries date

Follows the owner-approved full-width Entries day header (84c20530,
`docs/audits/entries-sticky-date/`). The Splits day header used to pin at the
very top of the window, under the demo and local environment banner, and
turn into an inset rounded bar. It now pins like an Entries day:

- just below the environment banner (or the iPhone's top inset);
- a band the full width of the window in the Splits colour
  (`--splits-surface` at 92% with a 12 px blur, solid without blur support),
  a hairline at its foot, measured by the same `stuck-date-row.js`;
- the date, count and refresh button stay where they rest; same height, so
  nothing shifts;
- a row reached by keyboard stops clear of it (`scroll-margin-top`).

One difference from Entries, for contrast: the Splits date is white text at
88% on orange. Over the white rows under a 92% band that is 3.95:1 in 70s
Light, so while pinned the text goes to full strength (AA in every preset;
`tests/colour-contrast.test.mjs`).

Frames (demo banner added, 12 Jun with 12 rows, then 9 Jun):
`before-*-1-rest.png` / `after-*-1-rest.png` (unchanged at rest),
`*-2-pinned.png` (pinned), `*-3-handoff.png` (the next day taking over), for
desktop (1280) and phone (390).

Tests: `tests/e2e/splits-sticky-date.spec.js` (desktop and 390 px: band
spans the window, pins under the banner, the next day replaces it, no
overlap with the floating bar, tab bar, Ask field or round buttons, focus
not hidden; failed on the old rule), `tests/e2e/date-row-flat.spec.js`
(Splits now expects the band in 70s Light and Modern Dark).
