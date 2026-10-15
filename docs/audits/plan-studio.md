# Plan Studio audit (2026-10-15)

Owner decision (Tim): build direction A (Waterfall) with every part of it, add
C's "What if I save more?", fix the waterfall's column imbalance, and give every
row slider fine control and a tap-to-type amount. Approved to ship without a
further review round. Design: `design.md` "Plan Studio"; terms: `DOMAIN.md`
"Plan Studio"; flow: `docs/flows/month-flow.md`. The approved mockups are on
branch `origin/plan-studio-mockups` under `docs/proposals/plan-studio/`.

## What shipped

- Big picture: the bar (Spend, Save, Invest, Left over, a "Planned in" line, a
  hatched spill when the plan puts out more than comes in), the plan balance
  headline with a one-tap fix, draggable lines (keyboard too), a job opens to
  one slice per category.
- How the month is going: money in and spent bars, the plan line, "Usual by
  today" (bills and rent by due date, flexible budgets on a straight line) and
  the verdict (On track, A bit ahead of pace, Over plan).
- Rows: every income row, planned item and budget bucket has a slider with a
  step that grows with the amount ($5, $10, $50, $100), fine control (Shift or
  Alt while dragging, press and hold on touch, nudge buttons of one step, keys),
  lock, "Take from", and a tap-to-type amount popover (a bottom sheet on a
  phone) with chips, the change from saved and Reset to saved.
- Held changes with one Undo stack, Reset to saved and Save plan (one
  all-or-nothing request).
- What if I save more?: slider and exact amount, where the money would come
  from, the resulting save total and plan balance, Apply to plan, Cancel.
- Balanced columns (below).

## Decisions

| Question | Decision |
| --- | --- |
| Save shows | Money kept so far (the lead's Saved), worded "Kept $x more than the target so far" / "$x still to keep" |
| Slider takes money from | Left over by default; a row can be locked; "Take from" picks another category |
| When changes apply | On Save plan, with Undo and Reset to saved |
| Shared rows | The whole row is edited; each person's part is shown from the row's own split |
| Pace | Due date for bills and rent, straight line for the rest |
| Household view | Read only, as its plan tables are (the combined line is made of two stored rows) |

## Changed from the mockup

- The plan tables stay below the studio: they are where notes, accounts,
  matching entries, adding and removing a line live. The studio is the first
  stop, not a replacement.
- No "Room to spend $x a day": a per-day figure reads as a safe-to-spend
  promise, which Money insights never give (AGENTS.md).
- No Everyone/Tim/Joyce filter in the toolbar: the page's own view and scope
  pickers already do that.
- Income rows have no pace tick (income arrives when it arrives).
- Notices are an inline status line, not a toast.
- Rings (B) were not built (the mockup's own phase 3 option).

## Balanced columns

The mockup's lanes (cards left, every row right) leave the left lane with
unused space beside a long right lane. The studio lays its cards and each job's
rows out in two CSS columns (`column-count: 2`, `break-inside: avoid` on every
card and row) that the browser balances by height, from a 860 px studio width;
one column below. Row and card heights do not depend on the amounts, so rows do
not hop columns while a slider moves. Measured (1440 px; the same at 1280 and
1920 px because the page is 1,200 px wide at most), lane or column height in px:

| Month | Mockup lanes, left / right | Balanced columns, left / right | Difference |
| --- | --- | --- | --- |
| Demo rows (30 rows) | 1084 / 4448 | 2740 / 2796 | 56 px (2%) |
| 16 more rows in Spend | 1084 / 6752 | 3892 / 3948 | 56 px (1.4%) |

`tests/e2e/plan-studio-layout.spec.js` asserts at 1280, 1440 and 1920 px, with
the demo seed and with 16 more rows, that the columns end within 20% of each
other and the gap under the shorter one is less than the tallest block; that no
card or row is split; and, as a negative, that the same check fails on the
mockup's lanes. Screenshots: `docs/audits/plan-studio/layout-before-*.png`,
`layout-after-*.png`.

## Loading and data

- First screen: unchanged (only the lazy Month route's files changed).
  `check:bundle`: 169,524 B JS gzip, 22,442 B CSS gzip, 7 files, inside the
  budget (163,326 / 24,197 with 5% headroom); no budget raised.
- Plan Studio is its own chunk: `plan-studio-*.js` 46.5 kB, 15.1 kB gzip, and
  `plan-studio-*.css` 14.5 kB, 3.3 kB gzip. `month-panel` grew by under 1 kB.
  Simple view never requests it (`plan-studio.spec.js`). An empty month neither
  loads it nor holds space.
- Payload: none. The studio reads the Month page DTO (no new field);
  `tests/e2e/api-payload-budget.json` untouched and `api-performance.spec.js`
  passes.
- Writes: the existing `applyMonthPlanChanges` (one `db.batch()`, refresh
  marker, 409 on a changed row); `tests/atomic-writes-plan-studio.test.mjs`
  adds `failingStatement`, conflict and shared-split cases for this use.

## Tests

- `tests/plan-studio-model.test.mjs`, `plan-studio-edit.test.mjs`,
  `plan-studio-slider.test.mjs`: jobs, totals, over-allocation and its fix,
  pace by due date and straight line, verdicts, row statuses, shared halves,
  step function, snapping, fine drag, keys, typed amounts, take-from, locks,
  job and line moves, what-if, Undo stack, save changes.
- `tests/plan-studio-dom.test.mjs`: slider semantics, popover body, bar, what-if
  card, hidden money.
- `tests/e2e/plan-studio.spec.js` (desktop, phone, hidden money, reduced
  motion, read-only household, Simple), `plan-studio-layout.spec.js`.
- Updated: `tests/e2e/lead-simple-view.spec.js` (an empty month holds no
  studio space).

## Screenshots

`docs/audits/plan-studio/`: `before-phone.png`, `before-desktop.png`,
`after-desktop-plan-light.png`, `after-desktop-plan-dark.png`,
`after-phone-plan-light.png`, `after-phone-plan-dark.png`,
`after-desktop-popover.png`, `after-phone-sheet.png`,
`after-desktop-what-if.png`, `after-desktop-simple.png`,
`after-phone-simple.png`, the layout pairs above.

## Not run

WebKit e2e (`test:e2e:webkit`), `test:performance`, the full e2e suite (targeted
specs plus the smoke bundle only), a real iPhone for the touch long-press and
vibration.
