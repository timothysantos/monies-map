# Donut Category Interaction Audit

Date: 2026-07-07

## Surfaces Audited

- Summary Spending Mix: full-size donut plus category cards.
- Entries expense breakdown: compact donut plus category rows and URL-backed filters.
- Splits breakdown: compact donut plus category rows.

## Findings

- Summary category cards had two competing text actions in the same horizontal row. The secondary "View entries" action could overflow the card and collide with the chart visibility text on desktop and mobile.
- Entries used a different mental model from Summary/Splits: clicking a category row applied a single category filter instead of hiding/showing the category in the donut. That was confusing because the same visual affordance did different things.
- Entries also had a single-select category dropdown, which made it impossible to combine several category filters while separately hiding heavy categories from the chart.

## Decisions

- Category rows/cards toggle donut visibility by default on every donut surface.
- Navigation/filter actions are separate compact controls:
  - Summary uses an icon action to open matching Entries.
  - Entries uses a separate `Filter`/`Filtered` action to add or remove that category from the URL-backed filter.
- Entries category filtering is multi-select and remains encoded as repeated `entry_category` parameters for route compatibility.
- Chart hiding is local UI state and does not mutate route filters or server data.

## Tests

- Unit coverage validates multi-category entry filtering and filter counts.
- Unit coverage keeps donut visibility immutable and total recalculation stable.
- E2E coverage confirms Entries category pills can hide chart categories while the category dropdown/filter remains multi-select.
