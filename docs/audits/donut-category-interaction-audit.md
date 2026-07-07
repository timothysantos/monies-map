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
- The first Entries breakdown card layout forced two columns inside a narrow side panel and kept action buttons beside the copy. On desktop this could collapse category names and amounts into unreadable vertical wrapping.
- The duplicate/overlap rule `Ignore` action needed a stable summary layout so it stayed aligned with the issue copy on desktop and stacked predictably on mobile.

## Decisions

- Category rows/cards toggle donut visibility by default on every donut surface.
- Navigation/filter actions are separate compact controls:
  - Summary uses an icon action to open matching Entries.
  - Entries uses a separate `Filter`/`Filtered` action to add or remove that category from the URL-backed filter.
- Entries category filtering is multi-select and remains encoded as repeated `entry_category` parameters for route compatibility.
- Chart hiding is local UI state and does not mutate route filters or server data.
- Entries breakdown cards use a responsive minimum card width and place chart/filter controls below the category copy, so the text owns the readable width before actions are rendered.
- Duplicate-rule issue summaries use a two-column desktop layout with the `Ignore` action in the action column, then collapse to one column on mobile.

## Tests

- Unit coverage validates multi-category entry filtering and filter counts.
- Unit coverage keeps donut visibility immutable and total recalculation stable.
- E2E coverage confirms Entries category pills can hide chart categories while the category dropdown/filter remains multi-select.
- E2E layout coverage guards against compressed Entries breakdown cards and misaligned duplicate-rule Ignore actions.
