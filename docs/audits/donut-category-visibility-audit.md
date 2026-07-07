# Donut Category Visibility Audit

Date: 2026-07-07

## Summary

The app has two donut chart surfaces:

- Summary spending mix in `src/client/summary-panel.jsx`
- Splits breakdown in `src/client/splits-breakdown-section.jsx`

Both now use local category visibility toggles. Category cards start shown,
clicking a card hides that category from the donut, and a reset action restores
all hidden categories.

## UX Decision

Use shown/hidden toggles instead of one-off filtering:

- The category rows remain visible while hidden, so the user can restore them.
- The chart redraws from memoized visible rows without refetching server data.
- Recharts animation is already disabled, so repeated toggles do not queue
  expensive animated redraws.
- Summary keeps entry drilldown as an explicit `View entries` action so category
  visibility and navigation are not overloaded on the same click.

## Tests

- `tests/donut-visibility.test.mjs` covers hidden-set toggling, immutable set
  behavior, visible row filtering, and visible total recomputation.
