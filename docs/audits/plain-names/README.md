# Plain names (owner approved, 2026-10-15)

Six screen names a non-technical reader stops on were renamed, with every
singular, plural and case variant, and the old names are now rejected by lint
(`src/domain/retired-names.ts`). Storage and code identifiers (`budget_buckets`,
`planned_items`, `money-jobs-*` files, routes, test ids) did not change.

| Where | Before | After |
| --- | --- | --- |
| Month lead, Remaining budget line | To allocate / Overplanned | Not planned yet / Planned more than you earn |
| Month lead popover (positive) | ...give the remaining budget a job. | ...say where the rest should go. |
| Month and Summary lead, list label | Money jobs | Where your money goes |
| Lead line under the savings bar | 3 of 4 money jobs done (so far) | 3 of 4 things on track (so far) |
| Month list, section heading | Budget Buckets | Monthly budget |
| Month list, section heading | Planned Items | Bills and dated payments |
| Month list, buttons and sheets | + Add budget bucket / Edit budget bucket / New budget bucket. | + Add monthly budget / Edit monthly budget / New monthly budget. |
| Month list, buttons and sheets | + Add planned item / Edit planned item / New planned item. | + Add bill or dated payment / Edit bill or dated payment / New bill or dated payment. |
| Row sheet kind | Budget bucket / Planned item | Monthly budget / Bill or dated payment |
| Match dialog and sheet | Match planned item, Close planned item matching, this planned item | Match bill or dated payment, Close bill or dated payment matching, this bill or dated payment |
| Match dialog note | Budget buckets still use category totals. | Monthly budgets still use category totals. |
| Month Simple hint | ...set budgets and planned items for this month. | ...set monthly budgets and dated payments for this month. |
| Summary accounts group | Wallets in view | The accounts shown |
| Investment statement line | Worth $X on <date>, from its statement | $X on <date>, as the statement says |
| Summary notes line | Budget buckets are the flexible layer... | Monthly budgets are the flexible layer... |
| Link error and Ask refusal | Only planned items can be linked to entries. / Only a planned item can link to entries... | Only bills and dated payments can be linked to entries. / Only a bill or dated payment can link to entries... |
| Demo notes | ...planned item(s) | ...dated payment(s) / ...payment |

Choices: "N of 4 things on track so far" for the old "N of 4 money jobs done so
far"; "Monthly budget" is the section heading as approved; the matching and
add/edit controls follow the heading so a person sees one name per thing.

Screenshots (demo data, Aug 2026, Ethan; desktop 1280x800 and an iPhone 13
profile): `before-*` is origin/master before this change, `after-*` after it.
`month-lead-plan` and `month-lead-simple`, `month-list-headings` (Monthly
budget and Bills and dated payments), `summary-accounts`. The demo household
has no investment statement, so the investment line is shown only by the
iFAST and StashAway import specs, which assert the new wording.
