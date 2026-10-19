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
- Clear invokes the reset with an explicit period-reset flag; existing desktop
  Reset behavior is unchanged. Clear removes figure and multi-month bounds as well as category,
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
mixed estimated and rendered heights. With rows rendered, applying a category through the real View and scope
sheet in a month whose rows all match it leaves row positions and scroll
offset unchanged within 1px.

Tests: `entries-island-context.test.mjs`, `mobile-context-line-dom.test.mjs`,
`e2e/island-context.spec.js`, and the existing `e2e/splits-group-strip.spec.js`.
The Splits Clear browser test failed on the old group bar before implementation.

Review captures (the one-off script was removed on 2026-10-20, see
`docs/audits/codex-polish-2/README.md`): `node scripts/capture-island-context.mjs` produced 30 screenshots
and an HTML gallery in `test-results/island-context-review`, using isolated local
D1, demo records, 390px width, 70s light/dark and 60s Mod light. It waits for the
lazy context body and disables motion for readable stills. Guide screenshots
were regenerated for phone Entries, From Ask, Month and Summary; only the From
Ask image changed. User/developer guides, design, architecture, scenario catalog
and affected flow docs describe the final behavior.

The desktop period-preservation browser test failed on the inherited shared
reset before period clearing was limited to the island action.

## Existing failures outside this slice

The full browser run reproduces the existing Ask unsaved-card return-scroll
failure (`ask-search.spec.js:150`, card viewport ratio 0). The identical viewport
assertion also fails against starting commit `ef7caf18`, with application code
untouched. The cold baseline test setup seeds demo data before its first page
load; otherwise it first fails on cached initial household names (Partner versus
Joyce), before it can reach the scrolling assertion. No Ask implementation was
changed. The follow-up is recorded in `docs/known-coupling-targets.md`.

The three existing category-picker touch-scroll assertions also fail on unchanged
starting application commit `ef7caf18` (`picker-scroll.spec.js:181`, `:200`, `:209`),
with the last category outside the viewport. Their baseline tests were unmodified.
The shared picker is unchanged by this slice; its follow-up is recorded in the
coupling targets alongside Ask.

## Validation

- `npm run verify`: passed, including 3,172 unit/parser tests, strict and client
  TypeScript, zero lint errors, production build, bundle check and 99/99 smoke
  tests. The 20 pre-existing lint warnings remain.
- Focused island plus existing Splits group-strip suite: 25/25 passed.
- Final isolated rerun: 16/16 passed, including every island case with the
  strengthened real-sheet scroll scenario, the import owner case, and the
  Month add/edit sheet case. The import case's initial local Worker network
  failure and Month sheet failure did not reproduce; the Month case also
  passed in the final smoke bundle.
- Full Chromium suite, through the repository sharded runner with a separate
  report root: 977 selected, 967 passed, six failed, four existing skips. Four
  failures reproduce on starting application code (Ask and the three picker
  cases above); the other two passed in isolation. No island-contract failure.
- Initial bundle: seven JS files, 171,249 gzip JS bytes and 22,796 gzip CSS
  bytes. Existing budgets were not changed.
- Guides and flow docs match the implementation. Review captures cover 30
  states in light, dark and 60s Mod; regenerated guide captures changed only
  the phone From Ask picture and thumbnail.

Verdict: the island contract is complete and proven by real browser behavior.
The existing Ask and category-picker defects remain explicit follow-ups outside
this slice. No domain, persistence, API ownership or money-editing boundary was
changed. Deployment uses the exact pushed master commit after a fresh fetch;
no branch/stale-master override is permitted.
