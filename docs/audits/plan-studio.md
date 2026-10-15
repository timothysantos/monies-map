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

## v2 (2026-10-15)

Owner feedback on v1, approved to build and deploy without a review round:
(a) a useful-info popover on every slider, (b) the big picture full width with
the two cards side by side under it, (c) the sliders and the plan tables
merged into one list with a Studio | Tables switch, (d) one list grouped by
what the money does instead of "planned items" and "budget buckets", (e)
Planned in by income row and a quiet line for money that arrived beyond the
plan. In October the demo and prod plan reads "The plan doesn't add up" because
the owner changed a bill: that is genuine and unchanged (f).

### Decisions

| Question | Decision |
| --- | --- |
| Reaching notes, details, matching and removing from Studio | A row menu (the `...` button), not a jump to Tables: Edit note, Edit details (the plan-row sheet: name, category, date, account, note), Match entries (dated lines), Remove line (asks first). Least clutter: one 44px button per row, nothing else added to it. Adding is a button in the Money in and Spend group headers (Add income, Add a line). The entries behind a line open from its status line, as every figure does. Tables stays for sorting and a look at everything at once |
| Studio to Tables with unsaved edits | Kept, not asked: Studio stays mounted (hidden) once shown, so the held changes, Undo stack and locks survive, and a dot on Studio says changes are held. Save plan still lives in Studio. Tested |
| Where the mode is remembered | Per login on the app shell (`planMode`, `POST /api/viewer-preferences/plan-mode`), stored beside the lead view in the same hashed-email settings row, with the device's storage as the first-paint cache and as the store without a login (demo, local dev). Studio is the default |
| New line's section | Dated is a planned item, undated a budget bucket (`plan-line-section.js`); an Investments category or the label Savings lands in Invest or Save by the existing `planJob` rule. Add a line opens the existing plan-row sheet, narrowed to the middle of a wide screen |
| Empty month | Only the tables (nothing for Studio to show; its first line is added there) |
| Extra income | Actual income less planned money in, from the lead's figures. Add to Savings raises the largest unlocked Savings row by that amount through the one Save plan request. Planned money in is not raised, so Left over falls by the amount: the confirm says so. The line and the button are absent when nothing arrived beyond the plan, with money hidden, and (the button) in the household view |
| Pace in the popover | `ahead`, `on pace`, `behind` against the row's own pace (due date for a dated line, a straight line otherwise), margin the larger of $40 and 8% of the plan; none for income, saving or a month that is not the current one |

### Layout (measured, px; studio width 1,122 at 1280, 1440 and 1920 as the page is capped)

| Width | Big picture | Cards (pace / what if) | List columns, left / right |
| --- | --- | --- | --- |
| 1280, 1440, 1920, demo rows | 1122 (full) | 554 x 415 and 554 x 415, same top | 2564 / 2556 (8 px) |
| 1280, 1440, 1920, 16 more rows | 1122 | the same | 3876 / 3868 (8 px) |
| 390 (phone) | 366 (full) | 366 x 313, then 366 x 415 under it | one column |

`tests/e2e/plan-studio-layout.spec.js` asserts, at 1280, 1440 and 1920 px: the
big picture spans the studio, the two cards start together, are as tall and as
wide as each other and together as wide as the studio, the list sits under
them, and its two columns end within 20% of each other (the v1 checks, still
red on the mockup's lanes); at 390 px: the cards stack, every row spans one
column and nothing scrolls sideways; in the household view the lone card
spans the row.

### Loading and data

- First screen: `check:bundle` unchanged in kind and never raised. The entry
  chunk grew by 115 B gzip (`publishAppShell`, `app-shell-watch.js`): the
  Month route's own mode store listens for the shell instead of the shell
  reaching it. Month's code for the switch and for adding a line (the Studio |
  Tables copy, `plan-line-section.js`) is small and separate from the studio:
  Simple view still loads no studio code (`plan-studio.spec.js` fails on any
  `plan-studio` request except the add-line copy).
- Plan Studio chunk: JS 45.5 kB (14.3 kB gzip), CSS 16.5 kB (3.7 kB gzip).
- Payload: the Month page DTO gains `history` on plan and income rows that an
  earlier month also had. Demo September 2025 (12 rows): +331 B (15,168 to
  15,499 B), person view +265 B. May 2026 (no tracked months before it) is
  unchanged at 32,280 B against the 32,259 B budget, and
  `api-payload-budget.json` is untouched. The handler reads at most three
  tracked months before the page's month (one entries range read, one plan-row
  and one income read per month, in parallel): about 28 ms against 12 ms
  warm on the demo for a month with history. Real-data handler time grows with
  the month's entry count; `test:performance` was not run (see below).
- Writes: unchanged for plans (the one `applyMonthPlanChanges`; extra income
  now sends an update and a create or update in the same request). The only new write is the display preference
  (`app_settings`, one batch statement, `failingStatement` tested).

### Decision changed (2026-10-15): Add to Savings counts the money in too

The first v2 action raised only Savings, so Planned in stayed the same and the
plan then read "The plan doesn't add up". Owner decision: the same tap does
both in the one Save plan request: Savings rises by $X (created when the
person has none) and the person's `Extra income` line (income, category
Income, the note and owner defaults of "Add income") rises by $X, or is
created at $X when there is none, never a second one. Planned in and Savings
both rise, Left over does not move, and the line goes because the unplanned
amount is actual income less planned money in (totals, never labels; an
Extra income row covers money that arrived under Salary). No server change:
`applyMonthPlanChanges` already takes `create` and `update` in one batch
(`tests/atomic-writes-extra-income.test.mjs`: both written, an existing line
raised, `failingStatement` on the split and on the row, a 409 refusing both,
an over-allocated month). Plan saves write no audit event (as for every Save
plan); the month refresh marker and snapshot refresh are the same. The action
is refused (no button) when every Savings line is locked or read only, or the
Extra income line cannot be edited; with hidden money and in the household
view there is no button, as before. Other held changes are saved with it.

Strings: title "Add $X to Savings?"; body "This adds $X to your Savings and
counts it as extra money in, so the plan still adds up."; buttons "Add to
Savings", "Cancel" (replaced: "Add to Savings" title, "Add $x to your Savings
plan? It goes from $a to $b.", "Left over would be $x, since planned money in
stays as it is."). Screenshots: `extra-before-confirm-desktop.png`,
`extra-after-confirm-desktop|phone.png`, `extra-after-result-desktop|phone.png`.

### Plain names (2026-10-15)

The Studio | Tables switch took a row of its own and its names meant nothing to
most people. It is now **Sliders | List**, named "How to show the plan", inside
the toolbar's row (after Undo and Discard changes on a phone, at the far right
on a wide screen; 44 px target). The stored values stay `studio` and `tables`,
so nobody's saved choice breaks. New rule in AGENTS.md (every visible name
understandable to a grandparent) and `tests/plan-studio-copy-lint.test.mjs`,
which walks every Plan Studio string and rejects studio, tables, bucket, mode,
DTO, job and plan line / plan row. Screenshots: `toolbar-before-desktop|phone.png`,
`toolbar-after-desktop|phone.png`.

| Before | After |
| --- | --- |
| Studio, Tables (label "Plan view") | Sliders, List (label "How to show the plan") |
| Studio, with changes not saved yet | Sliders, with changes not saved yet |
| Reset to saved (toolbar) | Discard changes |
| Reset to saved (amount popover) | Use the saved amount |
| Take from | Take money from |
| Planned in | Planned money in (also "Planned in, by source" became "Planned money in, by source") |
| Drag a line to move money between jobs. Tap a job to resize its categories. | Drag a line to move money between Spend, Save and Invest. Tap one to resize its categories. |
| ...between neighbours. | ...between the categories next to it. |
| Tap a job to see its categories. | Tap Spend, Save or Invest to see its categories. |
| All jobs | Whole plan |
| Every planned dollar has a job. | Every planned dollar is accounted for. |
| ...then give each dollar a job. | ...then decide where each dollar goes. |
| A bit ahead of pace / Ahead of pace (verdict, row status) | Spending a bit fast |
| Pace (popover heading) | Against the plan |
| On pace | On track |
| Ahead of pace, $x more than expected by today | Spending fast, $x more than expected by today |
| Behind pace, $x less than expected by today | Spending slowly, $x less than expected by today |
| Fine control | Small steps (hint: "...drag for small steps.") |
| Change this one in Tables. | To change this one, choose List. |
| Edit details | Edit name, date or category |
| Match entries | Pick matching entries |
| That is more than a plan line can hold. | That is more than one line can hold. |
| API error "Choose Studio or Tables." | "Choose Sliders or List." |

Kept as clear enough: Left over, Lock, Undo, Save plan, Remove line, On track,
Over plan.

Other screens' unclear names, proposed only (not changed):

| Where | Now | Proposal |
| --- | --- | --- |
| Month lead | Overplanned / To allocate | Planned more than you earn / Not planned yet |
| Month lead and Summary | Money jobs | Where your money goes |
| Month plan list | + Add budget bucket, Edit budget bucket, Budget bucket (kind), New bucket | + Add monthly budget, Edit monthly budget, Monthly budget, New budget |
| Plan line link dialog | Budget buckets still use category totals. | Monthly budgets still use category totals. |
| Investment statement | Worth $X on <date>, from its statement | $X on <date>, as the statement says |
| Wallets in view | Wallets in view | The accounts shown |
| Plan list sections | Planned items | Bills and dated payments |

### Tests

- `tests/month-plan-history.test.mjs` (the tuple, matching, the Savings line,
  untracked months, equals last month's own page), `plan-studio-v2-model.test.mjs`
  (groups incl. dated spending and Savings or Investments from either section,
  due tag, popover facts, pace, effect on Left over, income segments, extra
  income, where a new line is stored), `plan-studio-v2-dom.test.mjs` (popover
  body, hidden money, due tag, menu, income strip and legend, the switch),
  `plan-mode.test.mjs`, `viewer-preferences.test.mjs` (plan mode per login,
  refusals, atomic).
- `tests/e2e/plan-studio-v2.spec.js` on desktop and a phone: the grouped list
  and due tag, popover on hover, focus, Escape, drag and the info button, no
  popover with money hidden, Studio to Tables keeps held changes, the mode is
  remembered, an empty month shows tables only, add a line (undated and dated)
  and where each is stored, the row menu (note, matching, remove with Cancel),
  Planned in by source, Add to Savings with Cancel and with confirm through
  one Save plan request, no line when nothing arrived beyond the plan, the
  household view read only, 44px targets.
- Updated: `plan-studio.spec.js` and `plan-studio-layout.spec.js` (Studio is
  chosen with `chooseStudio`; the row name is `.ps-row-label`; the Simple-view
  load check names the studio chunk), `playwright.config.js` (every test starts
  on Tables, like the Plan choice) and `helpers.js`.

### Strings (new or changed)

`copy/plan-studio-copy.js` and `copy/plan-studio-add-copy.js`:
Plan view, Studio, Tables, "Studio, with changes not saved yet"; group heads
"Money in", "Spend", "Save", "Invest" (unchanged) with "Add income", "Add a
line", "Add a line to Money in", "Add a spending, saving or investing line";
"due 2 Oct" (day and short month); menu "More for {line}", "Edit note", "Edit
details", "Match entries", "Remove line"; "Remove {line}", "Remove {line} from
this month's plan? The entries you have recorded stay where they are.",
"Remove line", "That line could not be removed. Nothing changed."; popover
"Details for {line}", "Last month", "Planned $x, spent $y", "Average", "spent
$x a month over 3 months", "No earlier month had this line.", "So far",
"spent $x, $y left" (or over, still to come, still to keep, still to move,
with received, kept, moved), "Pace", "On pace", "Ahead of pace, $x more than
expected by today", "Behind pace, $x less than expected by today", "Past its
due date, $x not paid yet", "If you save this", "+$40 → Left over $x"; "Planned
in", "Planned in by source"; extra income "You got $x that isn't in the plan",
"Add to Savings", "Add $x to your Savings plan? It goes from $a to $b.", "Left
over would be $x, since planned money in stays as it is.", "This also saves
your N other changes to the plan.", "Cancel", "Added to Savings and saved.",
"That could not be saved. Nothing changed."; the add-line sheet "Add a line",
"Spend, save or invest", "Due date (optional)"; changed: "Change this one in
Tables." (was "...in the plan list below."). Removed: the per-row "view the
entries behind" icon button (the status line opens them).

### Screenshots

`docs/audits/plan-studio-v2/`: `before-*` are v1 (desktop and phone, light and
dark); `after-desktop-studio-light|dark.png`, `after-phone-studio-light|dark.png`,
`after-desktop-popover.png`, `after-phone-popover.png`,
`after-desktop-tables.png`, `after-desktop-extra-income.png` (the confirm),
`after-desktop-row-menu.png`, `after-desktop-add-line.png`,
`after-phone-add-line.png`. In the Studio shots the extra Bonus line shares the
Salary category, so both income lines count the same entries; that is the demo
data, not the feature.

### Not run

WebKit e2e, `test:performance`, a real iPhone, the full e2e suite (targeted
specs, the Month-affected specs and the smoke bundle only).
