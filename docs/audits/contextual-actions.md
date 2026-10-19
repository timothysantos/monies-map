# Contextual actions and test setup

Owner request (2026-10-16): protect sliders behind popups; expose useful phone
plan actions; make filter-summary activation contextual; shorten test waits
without dropping coverage.

## Pre-change boundaries

- Entries filters remain URL-owned. A summary opens the existing View and scope
  sheet; the person chip must carry no filter-opening intent.
- Sliders hold an unsaved plan and one history in Plan Studio. List edits use
  their existing save dialogs and have no equivalent unsaved history. The new
  island Undo must call the same slider history, never fabricate saved-edit undo.
- The shell owns a portal host only. Route code owns the mode action and Studio
  owns Undo; no new query, API, persistence, money calculation or AI behavior.
- Interactive amount/row popovers, pinned information and figure action menus
  need to consume dismissal taps. Hover, focus and active-drag information must
  remain passive so it can explain the control being used.
- Each persistence test uses real local D1. Only the immutable seed can be
  shared; database copies and custom fixture variables must remain isolated.

## Changes and regression proof

Seven browser regressions failed on the original application: search focus,
category opening, desktop row and amount popup dismissal, island Undo, figure
menu dismissal, and pinned-information dismissal. Header period and More pages
menus on Summary/Month also consume dismissal presses. The corrected assertions use
physical taps on background coordinates when a shield intentionally covers the
slider. The D1 sharing test failed on the original per-file template helper.

The visible filter line and sheet now share one lazy boundary, and filter-stack
mounting does not await a second import. Search focus occurs in the synchronous
tap commit. The sheet captures its target once, so editing filters does not
unexpectedly focus or open another control. The owner chip opens the sheet plainly.
An aggregate of more than two filters goes to the general filters area.

The phone island offers the other plan mode and Undo for editable held slider
changes. Default scope makes room on the same row; other scopes remain visible,
with actions above and clear of the privacy control. A past-month return also
keeps the plan actions above the crowded row. Disappearing Undo returns focus to
the mode action. The toolbar's original Save plan and history remain authoritative. A held-save
regression proves both island actions disable during saving and recover when
the save finishes.

## Repeated setup measurement

Node 22.23.3, same Mac, sequential runs, six identical persistence-test files,
39 tests in every run. Parent migration and seed time are included in the shared
measurements. Order alternated to reduce warm-cache bias. Every run passed.

| Round | Original per-file setup | One seed per run |
| --- | ---: | ---: |
| 1 | 47.764 s | 43.260 s |
| 2 | 47.440 s | 42.902 s |
| 3 | 47.295 s | 41.602 s |
| Median | 47.440 s | 42.902 s |

The measured sample improved by 9.6%. This is not a full-suite speed claim.
Files: `atomic-writes-plan-studio`, `atomic-writes-months`,
`atomic-writes-entries`, `atomic-writes-imports`, `atomic-writes-plan-draft`,
`app-data-reset` (all under `tests/`, `.test.mjs`).

`npm run test:unit` now migrates/seeds a fresh template, runs the same unit/parser
files, and removes the template after child completion. Each test still copies a
private database. Custom fixture vars take the original migration/seed path.
The sharing regression proves private writes, harmless per-file disposal and
custom-fixture isolation. No cached seed survives into the next test run.

Broad local suites run sequentially; focused checks come first and final gates
run once the coherent change is ready. The previous overlapping full browser
and unit runs caused substantial contention. The full gate and browser coverage
are retained. The fast loading, bounded-CSS, colour and guide contracts now
run before database-heavy tests in `verify`: the first closure run found an
outdated second-lazy-hop assertion and unbounded new `:has()` selectors. The
loading assertion now preserves the lazy shell boundary while allowing the
same-chunk focus path; the selectors use explicit two-level child paths.
Browser control actions have a 15-second ceiling, so a missing or
covered control does not consume the whole two-minute workflow timeout. Explicit
long API/import waits and the workflow timeout stay unchanged.

## Runtime review findings

The new shield initially shared a Radix portal with the popup content; runtime
caught its single-child requirement. The shield now has its own portal. Modal
regression tests also take geometry before opening because Radix intentionally
hides the background from role queries. The existing Simple-view loading test
caught an eager import of the Studio copy pool through island Undo; its label
now comes from the already-loaded Studio owner, preserving that boundary.
The review capture waits for the category list's lazy content, rather than
capturing its temporary empty loading area.

## Review and closure

(The one-off script was removed on 2026-10-20, see
`docs/audits/codex-polish-2/README.md`.)
`node scripts/capture-contextual-actions.mjs` produced the demo-only
390px gallery in `test-results/contextual-actions-review/`; `--before` captures
original states. Themes: 70s light, 70s dark and 60s Mod light. States include
sliders, changed plan/Undo, pinned information, row menu, List, non-default scope,
past month, search focus and category targeting.

The two Entries activation scenarios are tagged `@webkit` so the Safari-engine
phone check exercises the same focus and category behavior.

Release verification: strict TypeScript, client type checking and lint passed.
The first complete unit run passed 3,171 of 3,173 tests; its two failures were
source-contract checks for the lazy boundary and bounded CSS selectors. Both
were corrected, and all 24 fast contracts then passed. The focused browser run
passed 75 of 76 scenarios; the remaining physical-dismissal test was corrected
for the intentional shield and passed in a focused rerun. The save-in-flight
regression and functional category shortcut also passed their focused reruns.

On 16 October 2026 the owner explicitly requested shipping the completed work
while saving usage and permitted skipping heavier testing. The second full unit
run was stopped; the full browser suite and WebKit checks were deferred. This
release does not claim a completed `npm run verify` or full browser gate. Further
test optimization is paused. Production build and bundle budgets are checked
before release. The gallery contains before/after screenshots for all nine
states in the three themes above.
