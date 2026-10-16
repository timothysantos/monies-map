# Phone island context closure audit

Owner contract: the existing phone island names Entries filters and offers
Clear. Default scope wording gives way on the same row without changing height;
a non-default scope stays visible. Person and month controls remain reachable.
Clear resets every narrowing while preserving person, month and scope. A polite
status, 44px targets, truncated summary, restored scope wording and stable list
position are required. Month return and Splits search clear reuse existing flows.

## Boundaries checked

- Entries' URL filters and existing filtered rows produce the summary and count;
  no copied server state, query, DTO, persistence or AI changes.
- `entriesMobileFilterProps` remains the panel-to-shell publication. Its equality
  check includes the context text, so a changed result count reaches the island.
- The context buttons share the lazy mobile context sheet chunk. Initial bundle
  and CSS limits remain unchanged. No new warmup or speculative read.
- The same reset removes figure and multi-month bounds as well as category,
  account, type, search, amount, entry ids, investment-move and Ask parameters.
- The existing sheet is reused; tapping the summary scrolls to its filters.
- Nearby floating controls lift only for a non-default scope's stacked context;
  context changes never alter list padding. The default island stays 48px high.
- Month returns only when the current month belongs to the displayed range;
  All months has no added context. Splits clears search in place, keeping group.
- Desktop, Plan Studio content and Ask have no new controls.

## Runtime findings and proof

The inherited unfinished implementation formatted an empty Summary month on
Entries, crashing the screen. The browser reproduced it before the guard was
added. The first tests also assumed demo rows that did not exist; the count and
scroll scenarios now create explicit direct-owned Entries through the API.

The review screenshots also exposed a past-month return button pushing the
next arrow outside the island (399px against a 378px edge). A failing browser
containment assertion proved it before the return action was allowed to wrap
its full wording within the existing 44px row.

The scrolled-list test walks through rows before measuring, allowing existing
`content-visibility` estimates to become rendered heights. A direct jump had
mixed estimated and rendered heights. With rows rendered, applying a permissive
amount limit leaves row positions and scroll offset unchanged within 1px.

Tests: `entries-island-context.test.mjs`, `mobile-context-line-dom.test.mjs`,
`e2e/island-context.spec.js`, and the existing `e2e/splits-group-strip.spec.js`.
The Splits Clear browser test failed on the old group bar before implementation.

Review captures: `node scripts/capture-island-context.mjs` produces 30 screenshots
and an HTML gallery in `test-results/island-context-review`, using isolated local
D1, demo records, 390px width, 70s light/dark and 60s Mod light. It waits for the
lazy context body and disables motion for readable stills. Guide screenshots
were regenerated for phone Entries, From Ask, Month and Summary; only the From
Ask image changed. User/developer guides, design, architecture, scenario catalog
and affected flow docs describe the final behavior.

## Validation

Pending final merge gates and full browser suite. No completion or deployment
claim until those results are recorded.
