# Summary Flow

This doc describes the Summary page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/summary`

The route may include view, focus, and range parameters. `App.jsx` reads the URL
and keeps the selected Summary view in sync with browser location.

## State Flow

Summary state is split between:

- route state for the selected view and focus
- server state for the summary page DTO and account pills
- workflow state for note editing and drilldown return behavior

The page should preserve drilldown continuity without turning Summary into a
general routing controller.

## Data Flow

Summary data comes from:

- `GET /api/summary-page`
- `GET /api/summary-account-pills`

The page uses the summary page DTO for range metrics, category share, and
month cards. It uses the account-pill DTO for account health and drilldown.

## Ownership Notes

Summary owns:

- summary metrics
- summary account pills
- summary note edits
- category-card and month-card drilldowns

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep drilldown return behavior narrow and non-destructive

## Known Exceptions / Watch Areas

- explicit shell refresh is still available for named reference-data flows, but
  it is not the default Summary path
- summary account-pills remain a separate query surface and must stay aligned
  with note and drilldown behavior
