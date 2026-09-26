# Browser Versus Unit Test Audit

Status: complete. Branch `e2e-unit-audit`, based on `macro-performance` at
`7ed917b`. Node 22.23.3.

Goal: make the Playwright suite smaller and faster by moving a browser test
to a unit or Worker-level test only where the move is clearly defensible,
without lowering the standard. The rule this audit applied is now in
`docs/code-spec.md` ("browser or unit").

## Rules applied

A browser test moved only when both held:

1. It checked logic, not the screen. Every moved test sent API requests
   (`page.request`, `postJson`, `load*Page`, or `fetch` inside
   `page.evaluate`) and asserted only on the JSON, or it imported a pure
   function. None of them read the DOM; the page was only setup (a reseed,
   `page.goto("/")` or an Imports page load in a `beforeEach`).
2. Every user workflow keeps at least one browser test that drives it end to
   end (see "Workflows still driven in the browser").

Kept in the browser regardless: focus and keyboard, layout, dialogs and
sheets, navigation and deep links, drafts, money privacy, loading, error and
retry states, timing and races, route warmup, and anything that needs the
real Worker, D1 and client together.

## Where the moved tests run

- `tests/support/worker-request.mjs` stands in for Playwright's
  `page.request` over the real Worker (`src/index.ts`) and a real local D1
  (Miniflare, `tests/support/d1-workspace.mjs`, the harness of the
  `atomic-writes-*` tests). `useSeededWorkerRequest()` seeds the demo
  household once per file (what `/api/demo/reseed` did before each browser
  test) and gives each test its own copy of that database. `evaluate` binds
  relative `fetch` calls to the Worker, as `page.evaluate` did from the page.
- The moved tests keep their requests and their Playwright `expect`
  assertions verbatim (Playwright's `expect` works under `node:test`), so the
  matchers and expected values are provably the same. A script compared the
  assertion statements of all 64 moved-and-kept test bodies with the base
  spec: 58 are byte-identical after `page` → `request`; the 6 auto-refresh
  cases changed only `expect(x).toBe(y)` to `assert.equal(x, y)` (strict
  equality on booleans and strings, same values). The shortcut 405 case keeps
  its three checks (status, `Allow` header, JSON body) with `node:assert`.
- Differences from the browser run, and why they do not matter here: the
  Worker runs in Node through `worker.fetch` instead of workerd behind Vite's
  proxy, and each test starts from a fresh copy of the seeded database
  instead of a reseed of the shared one. None of the moved tests touch a
  workerd-only API, the proxy or the client. The real workerd path is still
  exercised by every remaining browser test and by `api-performance.spec.js`,
  which loads every page API through `wrangler dev`.

## Moves

Time saved is each test's own duration in the before run (Playwright
includes its `beforeEach` hooks). Mutation IDs refer to the table in
"Mutation proof"; each moved test failed under the listed mutation.

| Browser test (base line) | What it checked | Covered now in | Mutation | Time saved |
| --- | --- | --- | --- | ---: |
| `import-ledger-flow.spec.js:514` preview flags unknown accounts from the CSV input | preview reports an unknown CSV account | `tests/import-commit-api.test.mjs` | I1 | 0.88 s |
| `import-ledger-flow.spec.js:530` statement mismatch preview explains period ledger rows and skipped statement rows | mismatch breakdown totals, 10 period rows, suspected cause, deterministic import explanation | `tests/statement-reconciliation-api.test.mjs` | I28 | 0.89 s |
| `import-ledger-flow.spec.js:630` UOB PDF foreign-currency descriptions certify matching provisional card rows | PDF row with a USD amount in the text certifies the provisional row | `tests/statement-reconciliation-api.test.mjs` | I30 | 0.83 s |
| `import-ledger-flow.spec.js:693` repeated UOB PDF card rows certify more than three matching provisional rows | four repeated PDF rows certify four distinct provisional rows | `tests/statement-reconciliation-api.test.mjs` | I29, I30 | 0.81 s |
| `import-ledger-flow.spec.js:1222` expense and income headers auto-map without manual mapping | expense/income columns map to entry types without manual mapping | `tests/import-commit-api.test.mjs` | I9 | 0.81 s |
| `import-ledger-flow.spec.js:1482` committed import can be rolled back and disappears from entries and import history | rollback removes the entry, restores Summary spend, marks history rolled_back | `tests/import-commit-api.test.mjs` | I31 | 1.00 s |
| `import-ledger-flow.spec.js:1572` February PDF preview matches cleanly after the January rollback | after a first-statement rollback the next statement still matches | `tests/import-commit-api.test.mjs` | I32 | 0.92 s |
| `import-ledger-flow.spec.js:1671` re-importing the same January PDF after rollback does not hit the import id uniqueness guard | a rolled-back file can be committed again (created true) | `tests/import-commit-api.test.mjs` | I11, I31 | 0.85 s |
| `import-ledger-flow.spec.js:1708` rolling back a middle statement blocks later statements until the missing month is restored | rolling back a middle statement flags missing_prior_statement and a chain gap | `tests/import-commit-api.test.mjs` | I12 | 0.80 s |
| `import-ledger-flow.spec.js:1929` statement preview can certify midcycle rows and still save the checkpoint | statement certifies a mid-cycle row; checkpoint saves with and without account id | `tests/statement-reconciliation-api.test.mjs` | I30 | 0.81 s |
| `import-ledger-flow.spec.js:2082` statement preview certifies repeated same-merchant rows against unique ledger targets | repeated same-merchant rows certify unique ledger targets | `tests/statement-reconciliation-api.test.mjs` | I29, I30 | 0.76 s |
| `import-ledger-flow.spec.js:2155` statement balance can certify a near-match provisional row when amount clears the velocity rule | near-match certification when the amount clears the velocity rule | `tests/statement-reconciliation-api.test.mjs` | I15, I30 | 0.77 s |
| `import-ledger-flow.spec.js:2272` low-value near matches beyond two days stay out of the reconciliation lane | low-value rows more than two days apart are not matched | `tests/statement-reconciliation-api.test.mjs` | I2, I25 | 0.78 s |
| `import-ledger-flow.spec.js:2346` midcycle Citi activity skips an already certified statement row with a different activity date | mid-cycle Citi row skips a certified statement row (reason text) | `tests/statement-reconciliation-api.test.mjs` | I9, I15, I26 | 0.78 s |
| `import-ledger-flow.spec.js:2416` OCBC 360 activity after a statement uses value dates and preserves the matched statement checkpoint | OCBC 360 activity after a statement: value date, certified skip, checkpoint delta 0 | `tests/import-commit-api.test.mjs` | I9, I26, I33 | 0.88 s |
| `import-ledger-flow.spec.js:2537` mid-cycle imports do not match imported provisional rows, but PDFs still can promote them | mid-cycle import does not match imported provisional rows; a PDF can | `tests/import-commit-api.test.mjs` | I3, I30, I34 | 0.94 s |
| `import-ledger-flow.spec.js:2690` current-activity import promotes shortcut rows with compact merchant aliases | current-activity CSV promotes a manual row by compact merchant alias | `tests/import-commit-api.test.mjs` | I4, I7 | 0.94 s |
| `import-ledger-flow.spec.js:2742` compact Citi PDF merchant text can still promote the spaced mid-cycle CSV row | compact Citi PDF text promotes the spaced CSV row | `tests/import-commit-api.test.mjs` | I30 | 0.99 s |
| `import-ledger-flow.spec.js:2856` certified PDF hash does not suppress a later statement row when the bank-cleared dates differ | a certified PDF hash does not suppress a later row with other cleared dates | `tests/statement-reconciliation-api.test.mjs` | I9 | 0.87 s |
| `import-ledger-flow.spec.js:2953` promoting a manual provisional row applies both official statement date lanes | promotion then certification set both date lanes (dates and statuses) | `tests/import-commit-api.test.mjs` | I7, I23, I30 | 0.99 s |
| `import-ledger-flow.spec.js:3399` statement preview excludes rows whose post date lands after the statement end | a row posted after the statement end is excluded (projected 0, delta 0) | `tests/statement-certified-rows-api.test.mjs` | I33 | 1.30 s |
| `import-ledger-flow.spec.js:3494` posted-date corrections defer legitimate ledger rows out of the current statement | posted-date corrections move rows out of the statement (-1850 to 0) | `tests/statement-certified-rows-api.test.mjs` | I14, I33 | 1.10 s |
| `import-ledger-flow.spec.js:3589` already certified statement rows retain ledger comparison details | already certified row is skipped and keeps its exact ledger match | `tests/statement-certified-rows-api.test.mjs` | I6 | 0.97 s |
| `import-ledger-flow.spec.js:3675` remapped certified row is prioritized when it matches the statement mismatch | remapped certified row explaining the mismatch is called out | `tests/statement-certified-rows-api.test.mjs` | I6, I16 | 0.92 s |
| `import-ledger-flow.spec.js:3772` matched remapped certified row is hidden from already covered rows | matched remapped certified row is hidden from covered rows | `tests/statement-certified-rows-api.test.mjs` | I6 | 0.93 s |
| `import-ledger-flow.spec.js:3867` same-amount certified rows do not falsely prioritize an ambiguous match | same-amount certified rows are not falsely prioritized | `tests/statement-certified-rows-api.test.mjs` | I6, I16 | 0.87 s |
| `import-ledger-flow.spec.js:3992` current-period PDF row auto-resolves when prior matched checkpoint owns the earlier certified row | current-period row imports when the prior matched checkpoint owns the earlier row | `tests/statement-certified-rows-api.test.mjs` | I35 | 0.94 s |
| `import-ledger-flow.spec.js:4103` outside-period certified match stays a conflict when the immediate previous checkpoint is not matched | outside-period certified row with an unmatched prior checkpoint stays included, not a conflict | `tests/statement-certified-rows-api.test.mjs` | I34, I35 | 0.89 s |
| `import-ledger-flow.spec.js:4213` user can explicitly include a certified PDF duplicate and keep it included on refresh | an explicit include of a certified duplicate survives refresh | `tests/statement-certified-rows-api.test.mjs` | I6, I9, I19 | 0.84 s |
| `import-ledger-flow.spec.js:4330` wrong-card remap stays mismatched and does not resolve the certified row | a wrong-card remap stays mismatched | `tests/statement-certified-rows-api.test.mjs` | I20 | 0.90 s |
| `import-preview-auto-refresh.spec.js:9` statement preview auto-refresh key is empty for non-statement drafts | auto-refresh key is empty for CSV drafts | `tests/import-preview-auto-refresh.test.mjs` | AR1 | 0.00 s |
| `import-preview-auto-refresh.spec.js:35` statement preview auto-refresh waits for the preview to settle | waits 2 s after a preview lands | `tests/import-preview-auto-refresh.test.mjs` | AR2 | 0.00 s |
| `import-preview-auto-refresh.spec.js:49` statement preview auto-refresh is throttled per draft key | 15 s cooldown per draft key | `tests/import-preview-auto-refresh.test.mjs` | AR3 | 0.00 s |
| `import-preview-auto-refresh.spec.js:63` statement preview auto-refresh re-runs when a visible statement draft is stale | re-runs for a stale visible draft | `tests/import-preview-auto-refresh.test.mjs` | AR5 | 0.00 s |
| `import-preview-auto-refresh.spec.js:77` statement preview auto-refresh is blocked while the draft has active workflow edits | blocked by a workflow lock | `tests/import-preview-auto-refresh.test.mjs` | AR4 | 0.00 s |
| `import-preview-auto-refresh.spec.js:92` statement preview auto-refresh failures preserve the current preview | only an auto refresh failure keeps the preview | `tests/import-preview-auto-refresh.test.mjs` | AR6 | 0.00 s |
| `splits-travel-currency.spec.js:5` travel group keeps foreign amount and matches a later home-currency transfer with explicit FX | JPY expense keeps currency; checkpoint matched to an SGD transfer with FX | `tests/splits-api.test.mjs` | S1, S15 | 0.87 s |
| `splits-travel-currency.spec.js:51` active simplified settlements are independent per currency | one active checkpoint per currency; duplicate JPY rejected | `tests/splits-api.test.mjs` | S2, S15 | 0.84 s |
| `splits-travel-currency.spec.js:79` a group settlement closes only that group and creates no simplified checkpoint | a group settlement closes only that group's batch | `tests/splits-api.test.mjs` | S3 | 0.85 s |
| `splits-travel-currency.spec.js:106` foreign pending card expense links to final SGD evidence without changing its JPY shares | foreign card expense links to SGD evidence, keeps JPY shares | `tests/splits-api.test.mjs` | S4, S15 | 0.86 s |
| `splits-travel-currency.spec.js:150` ledger entries cannot be inserted directly into a group with another currency | an SGD entry cannot join a JPY group | `tests/splits-api.test.mjs` | S5, S15 | 0.80 s |
| `splits-travel-currency.spec.js:166` foreign group settle-up links to an imported SGD transfer with certified FX evidence | foreign settle-up links to an SGD transfer with FX | `tests/splits-api.test.mjs` | S6, S15 | 0.85 s |
| `splits-travel-currency.spec.js:201` holiday cash and bank/card groups keep purchase sources separate | Cash-only and Bank/card groups reject the other source | `tests/splits-api.test.mjs` | S7 | 0.92 s |
| `splits-activity-history.spec.js:5` deleted split expenses remain in history and restore with their original record | a deleted expense stays in history and restores with its record | `tests/splits-api.test.mjs` | S8, S13, S15 | 0.69 s |
| `splits-activity-history.spec.js:38` restoring an already active split is rejected instead of duplicating it | restoring an active split or an unknown kind is rejected (400) | `tests/splits-api.test.mjs` | S9, S10 | 0.33 s |
| `splits-page-payload.spec.js:16` the Splits page month slice is the month plus exactly the month's transfers | Splits month slice is exactly the month's transfers, equal to Entries' | `tests/splits-api.test.mjs` | S11 | 0.41 s |
| `splits-viewer-amounts.spec.js:5` split activity uses the borrowed amount for both borrower and lender views | borrower and lender see the borrowed amount with their label | `tests/splits-api.test.mjs` | S12 | 0.74 s |
| `splits-create-expense.spec.js:5` creating a split expense shows the row immediately and persists it | a created split expense is listed with its note (renamed: it never checked the row display) | `tests/splits-api.test.mjs` | S13 | 0.59 s |
| `entries-add-to-splits.spec.js:418` equal split amounts keep the odd cent on the deterministic remainder share | odd cent goes to the remainder share (6999/7000) | `tests/splits-api.test.mjs` | S14 | 0.66 s |
| `entries-add-to-splits.spec.js:453` entries totals strip follows the current person's shared percentage | viewer amount follows the updated split percentage (renamed: it never read the totals strip) | `tests/page-dto-api.test.mjs` | D5b | 0.65 s |
| `entries-add-to-splits.spec.js:507` shared entry rows show full amount collapsed and expanded in person view | shared entry DTO: share and total per person, full amount for household (renamed: it never read the row) | `tests/page-dto-api.test.mjs` | D5b | 0.61 s |
| `app-shell.spec.js:71` app shell request stays shell-only | /api/app-shell carries no accounts, categories or page DTOs | `tests/page-dto-api.test.mjs` | D1 | 0.38 s |
| `app-shell.spec.js:89` reference data owns lightweight account and category lists | reference data accounts carry no checkpoint history | `tests/page-dto-api.test.mjs` | D2 | 0.38 s |
| `reseed-contract.spec.js:5` demo reseed is idempotent and restores expected baseline data | reseed is idempotent and leaves the demo non-empty | `tests/page-dto-api.test.mjs` | D3 | 0.82 s |
| `month-page.spec.js:290` planned item actuals only appear when they are backed by linked current-month entries | planned items show actuals only from linked entries | `tests/month-actuals-api.test.mjs` | M1 | 0.73 s |
| `month-page.spec.js:780` new direct ledger expense updates the matching budget bucket actual in direct and direct+shared scopes | a direct expense moves direct and combined budget actuals, not shared | `tests/month-actuals-api.test.mjs` | M2 | 1.40 s |
| `month-page.spec.js:805` planned items stay at zero until linked, then absorb linked actuals and release the bucket total | linked planned item absorbs 1500 and releases the bucket | `tests/month-actuals-api.test.mjs` | M1, M3 | 1.30 s |
| `month-page.spec.js:865` linked shared planned items use the viewer split amount instead of the household total | linked shared planned item uses each viewer's share (2000/500/1500) | `tests/month-actuals-api.test.mjs` | D5b | 1.40 s |
| `month-page.spec.js:1087` offsetting income reduces the matching budget bucket actual | offsetting income reduces the bucket actual | `tests/month-actuals-api.test.mjs` | M5 | 1.20 s |
| `settings-reference-data.spec.js:43` shortcut direct-create route rejects every non-POST request | shortcut create route answers GET with 405, Allow: POST and the JSON error | `tests/shortcut-gateway.test.mjs` | X1 | 0.33 s |
| `settings-reference-data.spec.js:54` category rule CRUD stays inside the settings page DTO | category rule create and delete through the Settings DTO | `tests/page-dto-api.test.mjs` | D6 | 0.37 s |
| `settings-reference-data.spec.js:82` optional AI category suggestions leave the existing rule queue unchanged when AI is unavailable | AI suggestions unavailable: proposed 0, queue unchanged | `tests/page-dto-api.test.mjs` | D7 | 0.46 s |
| `settings-reference-data.spec.js:276` account rename updates reference data plus summary and entries downstream DTOs | account rename reaches reference data, account pills and Entries | `tests/page-dto-api.test.mjs` | D8 | 0.40 s |
| `settings-reference-data.spec.js:670` category rename refreshes reference data plus month and summary downstream DTOs | category rename reaches reference data, Month and the Summary donut | `tests/page-dto-api.test.mjs` | D9 | 0.43 s |
| `summary-workflow.spec.js:15` summary month note edits refresh the summary and month DTOs | a household month note reaches the Summary and Month DTOs | `tests/page-dto-api.test.mjs` | D4b | 0.52 s |
| `financial-insight.spec.js:18` the insight endpoint falls back to computed wording when the Worker AI binding is absent | insight endpoint falls back to computed wording without the AI binding | `tests/ai-assistance-routes.test.mjs` (existing test, same facts and assertions; browser copy deleted) | X2 | 0.49 s |
| **66 tests** | | | | **48.2 s** |

## Mutation proof

Each mutation was applied alone to the source, the new unit files for that
area were run, the failing tests recorded, and the source restored (the
throwaway runner was not committed). I35 removes two guards together
because either one alone keeps its test green. Mutations that failed no
moved test are listed at the end.

| ID | Source | Mutation | Moved tests that failed |
| --- | --- | --- | --- |
| AR1 | `src/client/import-preview-auto-refresh.js` | auto-refresh key built for CSV drafts too | 1: statement preview auto-refresh key is empty for non-statement drafts |
| AR2 | `src/client/import-preview-auto-refresh.js` | no settle grace after a preview lands | 1: statement preview auto-refresh waits for the preview to settle |
| AR3 | `src/client/import-preview-auto-refresh.js` | no per-key cooldown | 1: statement preview auto-refresh is throttled per draft key |
| AR4 | `src/client/import-preview-auto-refresh.js` | workflow lock ignored | 1: statement preview auto-refresh is blocked while the draft has active workflow edits |
| AR5 | `src/client/import-preview-auto-refresh.js` | stale drafts never re-run | 1: statement preview auto-refresh re-runs when a visible statement draft is stale |
| AR6 | `src/client/import-preview-auto-refresh.js` | a manual refresh failure also keeps the old preview | 1: statement preview auto-refresh failures preserve the current preview |
| I1 | `src/domain/app-repository-import-preview.ts` | unknown CSV account not reported | 1: preview flags unknown accounts from the CSV input |
| I2 | `src/domain/app-repository-import-preview.ts` | velocity rule off (any day distance matches) | 1: low-value near matches beyond two days stay out of the reconciliation lane |
| I3 | `src/domain/app-repository-import-preview.ts` | mid-cycle sources may match imported provisional rows | 1: mid-cycle imports do not match imported provisional rows, but PDFs still can promote them |
| I4 | `src/domain/app-repository-import-preview.ts` | compact merchant alias no longer boosts a manual match | 1: current-activity import promotes shortcut rows with compact merchant aliases |
| I6 | `src/domain/app-repository-import-preview.ts` | already certified statement row imported again | 5: already certified statement rows retain ledger comparison details; remapped certified row is prioritized when it matches the statement mismatch; matched remapped certified row is hidden from already covered rows; same-amount certified rows do not falsely prioritize an ambiguous match; user can explicitly include a certified PDF duplicate and keep it included on refresh |
| I7 | `src/domain/app-repository-import-preview.ts` | current-activity CSV never promotes a manual row | 2: current-activity import promotes shortcut rows with compact merchant aliases; promoting a manual provisional row applies both official statement date lanes |
| I9 | `src/domain/app-repository-helpers.ts` | income column not read as an amount | 5: expense and income headers auto-map without manual mapping; OCBC 360 activity after a statement uses value dates and preserves the matched statement checkpoint; user can explicitly include a certified PDF duplicate and keep it included on refresh; midcycle Citi activity skips an already certified statement row with a different activity date; certified PDF hash does not suppress a later statement row when the bank-cleared dates differ |
| I11 | `src/domain/app-repository-import-commit.ts` | a rolled-back import id cannot be reused | 1: re-importing the same January PDF after rollback does not hit the import id uniqueness guard |
| I12 | `src/domain/app-repository-import-commit.ts` | rolling back a middle statement records no chain break | 1: rolling back a middle statement blocks later statements until the missing month is restored |
| I14 | `src/domain/app-repository-import-preview.ts` | ledger rows use the transaction date, not the post date, for the statement period | 1: posted-date corrections defer legitimate ledger rows out of the current statement |
| I15 | `src/domain/import-preview-match-policy.js` | standard match window cut to one day | 2: statement balance can certify a near-match provisional row when amount clears the velocity rule; midcycle Citi activity skips an already certified statement row with a different activity date |
| I16 | `src/domain/app-repository-import-preview.ts` | the certified row explaining a mismatch is not called out | 2: remapped certified row is prioritized when it matches the statement mismatch; same-amount certified rows do not falsely prioritize an ambiguous match |
| I19 | `src/domain/app-repository-import-preview.ts` | an explicit include of a certified duplicate is overridden | 1: user can explicitly include a certified PDF duplicate and keep it included on refresh |
| I20 | `src/domain/app-repository-import-preview.ts` | a candidate on another card matches | 1: wrong-card remap stays mismatched and does not resolve the certified row |
| I23 | `src/domain/app-repository-import-commit.ts` | promotion leaves the bank-cleared date empty | 1: promoting a manual provisional row applies both official statement date lanes |
| I25 | `src/domain/import-preview-match-policy.js` | low-value match window widened to a month | 1: low-value near matches beyond two days stay out of the reconciliation lane |
| S1 | `src/domain/app-repository-splits.ts` | FX conversion of a checkpoint match drops the amount | 1: travel group keeps foreign amount and matches a later home-currency transfer with explicit FX |
| S2 | `src/domain/app-repository-splits.ts` | active checkpoint check ignores currency | 1: active simplified settlements are independent per currency |
| S3 | `src/domain/app-repository-split-batches.ts` | a group settlement closes every open batch | 1: a group settlement closes only that group and creates no simplified checkpoint |
| S4 | `src/domain/app-repository-splits.ts` | foreign expense match not flagged for FX review | 1: foreign pending card expense links to final SGD evidence without changing its JPY shares |
| S5 | `src/domain/app-repository-splits.ts` | group currency not enforced | 1: ledger entries cannot be inserted directly into a group with another currency |
| S6 | `src/domain/app-repository-splits.ts` | foreign settle-up match not flagged for FX review | 1: foreign group settle-up links to an imported SGD transfer with certified FX evidence |
| S7 | `src/domain/app-repository-splits.ts` | Cash-only group accepts card purchases | 1: holiday cash and bank/card groups keep purchase sources separate |
| S8 | `src/domain/app-repository-splits.ts` | restore leaves the record deleted | 1: deleted split expenses remain in history and restore with their original record |
| S9 | `src/domain/app-repository-splits.ts` | restoring an active split is allowed | 1: restoring an already active split is rejected instead of duplicating it |
| S10 | `src/index.ts` | unknown history record kind accepted | 1: restoring an already active split is rejected instead of duplicating it |
| S11 | `src/domain/pages/splits-page.ts` | Splits month slice sends every entry | 1: the Splits page month slice is the month plus exactly the month's transfers |
| S12 | `src/domain/splits-projection.ts` | lender and borrower labels swapped | 1: split activity uses the borrowed amount for both borrower and lender views |
| S13 | `src/domain/app-repository-splits.ts` | a new split expense drops its note | 2: deleted split expenses remain in history and restore with their original record; a created split expense is on the Splits page with its note |
| S14 | `src/domain/split-allocation.ts` | odd cent goes to the first share | 1: equal split amounts keep the odd cent on the deterministic remainder share |
| S15 | `src/domain/split-currency.ts` | foreign currencies collapse to SGD | 6: travel group keeps foreign amount and matches a later home-currency transfer with explicit FX; active simplified settlements are independent per currency; foreign pending card expense links to final SGD evidence without changing its JPY shares; ledger entries cannot be inserted directly into a group with another currency; foreign group settle-up links to an imported SGD transfer with certified FX evidence; deleted split expenses remain in history and restore with their original record |
| M1 | `src/domain/month-projection.ts` | unlinked planned items show their plan as actual | 2: planned item actuals only appear when they are backed by linked current-month entries; planned items stay at zero until linked, then absorb linked actuals and release the bucket total |
| M2 | `src/domain/month-projection.ts` | person shared scope includes direct rows | 1: new direct ledger expense updates the matching budget bucket actual in direct and direct+shared scopes |
| M3 | `src/domain/month-projection.ts` | linked planned-item expenses also count in the bucket | 1: planned items stay at zero until linked, then absorb linked actuals and release the bucket total |
| M5 | `src/domain/month-projection.ts` | offsetting income does not reduce the bucket | 1: offsetting income reduces the matching budget bucket actual |
| D1 | `src/domain/app-shell.ts` | app shell carries an accounts list | 1: app shell request stays shell-only |
| D2 | `src/domain/app-shell-dto.ts` | reference data carries checkpoint history | 1: reference data owns lightweight account and category lists |
| D3 | `src/domain/demo-settings.ts` | reseed leaves the empty state on | 1: demo reseed is idempotent and restores expected baseline data |
| D6 | `src/domain/app-repository-category-match-rules.ts` | rule delete removes nothing | 1: category rule CRUD stays inside the settings page DTO |
| D7 | `src/server/ai-assistance-routes.ts` | category suggestions claim AI is available | 1: optional AI category suggestions leave the existing rule queue unchanged when AI is unavailable |
| D8 | `src/domain/app-repository-settings.ts` | account rename truncates the name | 1: account rename updates reference data plus summary and entries downstream DTOs |
| D9 | `src/domain/app-repository-categories.ts` | category rename truncates the name | 1: category rename refreshes reference data plus month and summary downstream DTOs |
| X1 | `src/index.ts` | 405 without the Allow header | 1: shortcut direct-create route rejects every non-POST request |
| X2 | `src/server/ai-assistance-routes.ts` | insight fallback drops the computed wording | 1: with AI turned off or the binding missing, the insight falls back to computed wording |
| D4b | `src/domain/app-repository-month-commands.ts` | a new month note is stored under the wrong scope | 1: summary month note edits refresh the summary and month DTOs |
| D5b | `src/domain/month-projection.ts` | a split-linked shared entry shows the full amount to a person | 3: linked shared planned items use the viewer split amount instead of the household total; a shared entry's viewer amount follows each person's share after the split percentage changes; a shared entry carries the viewer share and the full total in a person view, and the full amount for the household |
| I26 | `src/domain/import-preview-match-policy.js` | a certified statement row is not suppressed inside the certified date window | 2: OCBC 360 activity after a statement uses value dates and preserves the matched statement checkpoint; midcycle Citi activity skips an already certified statement row with a different activity date |
| I28 | `src/domain/app-repository-import-preview.ts` | mismatch explanation drops the period ledger rows cause | 1: statement mismatch preview explains period ledger rows and skipped statement rows |
| I29 | `src/domain/app-repository-import-preview.ts` | a claimed ledger target is not reserved for later rows | 2: repeated UOB PDF card rows certify more than three matching provisional rows; statement preview certifies repeated same-merchant rows against unique ledger targets |
| I30 | `src/domain/app-repository-import-preview.ts` | a statement row no longer targets the provisional row it certifies | 8: mid-cycle imports do not match imported provisional rows, but PDFs still can promote them; compact Citi PDF merchant text can still promote the spaced mid-cycle CSV row; promoting a manual provisional row applies both official statement date lanes; UOB PDF foreign-currency descriptions certify matching provisional card rows; repeated UOB PDF card rows certify more than three matching provisional rows; statement preview can certify midcycle rows and still save the checkpoint; statement preview certifies repeated same-merchant rows against unique ledger targets; statement balance can certify a near-match provisional row when amount clears the velocity rule |
| I31 | `src/domain/app-repository-import-commit.ts` | rollback leaves the import marked completed | 2: committed import can be rolled back and disappears from entries and import history; re-importing the same January PDF after rollback does not hit the import id uniqueness guard |
| I32 | `src/domain/app-repository-import-commit.ts` | rolling back a first statement records a chain break | 1: February PDF preview matches cleanly after the January rollback |
| I33 | `src/domain/app-repository-helpers.ts` | rows cleared after the statement end count toward it | 3: OCBC 360 activity after a statement uses value dates and preserves the matched statement checkpoint; statement preview excludes rows whose post date lands after the statement end; posted-date corrections defer legitimate ledger rows out of the current statement |
| I34 | `src/domain/app-repository-import-preview.ts` | same-description rows days apart suppressed as exact duplicates | 2: mid-cycle imports do not match imported provisional rows, but PDFs still can promote them; outside-period certified match stays a conflict when the immediate previous checkpoint is not matched |
| I35 | `src/domain/app-repository-import-preview.ts` | same-description rows days apart suppressed as duplicates, and the prior-checkpoint rescue removed (two guards together) | 2: current-period PDF row auto-resolves when prior matched checkpoint owns the earlier certified row; outside-period certified match stays a conflict when the immediate previous checkpoint is not matched |

Mutations that failed no moved test (the behaviour is held by another guard; a sharper mutation above covers each test):

- I5 (`src/domain/app-repository-import-preview.ts`): certified rows stay in the reconciliation lane
- I8 (`src/domain/app-repository-import-preview.ts`): a claimed ledger target can be matched twice
- I10 (`src/domain/app-repository-import-commit.ts`): rollback keeps the import's rows
- I13 (`src/domain/app-repository-helpers.ts`): foreign-currency amount kept in description matching
- I17 (`src/domain/app-repository-import-preview.ts`): no current-period replacement of a prior certified match
- I18 (`src/domain/app-repository-import-preview.ts`): an unmatched previous checkpoint still counts as matched
- I21 (`src/domain/app-repository-import-preview.ts`): a certified PDF hash always suppresses a later row
- I22 (`src/domain/app-repository-import-commit.ts`): a checkpoint without an account id is not resolved from the control rows
- I24 (`src/domain/app-repository-helpers.ts`): compact merchant text never counts as similar
- M4 (`src/domain/month-projection.ts`): linked shared planned items use the household total
- D4 (`src/domain/app-repository-month-commands.ts`): month note written to the wrong scope
- D5 (`src/domain/month-projection.ts`): a shared entry shows the full amount to a person
- I27 (`src/domain/app-repository-import-preview.ts`): compact description match no longer suppresses an exact duplicate

## Considered and kept in the browser

Candidates were found by scanning every spec for tests that never touch the
page (no `goto`, locator, keyboard, route mock or DOM `expect`) or touch it
only once or twice, then reading each one. These were considered and kept:

| Browser test | Why it stays in the browser |
| --- | --- |
| `api-performance.spec.js` "seeded page APIs stay below the slow-log budget", "page API responses stay within their size budget at demo scale" | API-only, but they measure the real `wrangler dev` Worker (the first `Server-Timing` `dur`, gzip bytes) against `api-payload-budget.json`; AGENTS.md names this spec as the payload gate. A Node run of the Worker would measure something else. |
| `import-ledger-flow.spec.js` "uploaded PDF uses statement reconciliation on the first preview request" | API setup, but the proof is the browser's own file upload, pdf.js text extraction and the first preview request it sends (a race), plus the rendered "certified by the statement" line. |
| `import-ledger-flow.spec.js` "official statement certifies shifted mid-cycle rows and supersedes absent provisional rows" | Mostly API assertions, but it ends by rolling back through the import card and the Confirm rollback dialog and then checks the restored rows. Splitting it would duplicate a 200-line setup; kept whole. |
| `import-ledger-flow.spec.js` "current-activity exact manual matches are shown as already handled" | API setup; the assertions are the rendered "Matched to ledger" state, the missing Exclude button and the two-date-lane sentence. |
| `import-ledger-flow.spec.js` "rolling back a PDF import invalidates cached entries before returning to the entries page" | Client cache invalidation across a navigation. |
| `import-ledger-flow.spec.js` mismatch UI cases (action guidance, cut-off rows, close-ready wording, restoring a covered row) | Mocked preview responses; the assertions are the rendered review surface and a confirmation dialog. |
| `import-ledger-flow.spec.js` resource-limit failures, OCR packages and image PDFs, pasted Citi CSV, final import loading, split-link cleanup, cross-tab alignment, multi-card statements, imported row edit | Error states, in-browser OCR, loading states, cross-tab behaviour or UI flows. |
| `entries-category-filter.spec.js` "daily net ignores matched transfers that stay inside the visible scope" | API setup, but the assertion is the rendered date header after an `entry_id` deep-link filter and the money reveal. The daily-net rule itself is already unit-tested (`entry-daily-net.test.mjs`). |
| `splits-settlement-checkpoint.spec.js`, `splits-settlement-lock.spec.js` | API setup; the assertions are the settle-up dialog, the lock notice, Undo simplification and the phone dialog. The lock rules also have Worker tests (`atomic-writes-split-checkpoint-lock.test.mjs`). |
| `splits-viewer-amounts.spec.js` tone colours, odd-cent recipient choice, closing a split opened from an Entries link | Rendering, editor controls and a deep link. |
| `month-page.spec.js` person switch, narrative note editor, budget row edit, keyboard row opening, match dialogs | Query identity on navigation, dialogs, keyboard and editing. |
| `financial-insight.spec.js` "hiding money aborts the request and makes no new one" | Money privacy and request abort. |
| `app-sync-subscription.spec.js`, `reference-data-owner.spec.js`, `route-data-owner.spec.js`, `summary-owner.spec.js`, `entries-data-owner.spec.js` | Cross-tab refresh and superseded-response races. |
| `route-warmup.spec.js`, `route-warmup-data.spec.js` (one or two page lines each) | Warmup timing, connection and data-saver gates. |
| `settings-reference-data.spec.js` duplicate-rule summary, transfers review, shortcut install and account priority, edit person on Enter | Rendered copy, new-tab flows, clipboard and keyboard. |
| `summary-workflow.spec.js` "summary controls stay usable on mobile" | Layout. |
| `app-dates.spec.js` | The Singapore day as the default in the rendered split dialogs and Entries composer. |
| `faq-content.spec.js`, `screen-error-boundary.spec.js`, `consistent-states.spec.js`, `app-shell-chrome.spec.js` | Rendered content, error boundaries, error and retry states. |

## Workflows still driven in the browser

| Workflow touched by a move | Browser tests that still drive it |
| --- | --- |
| CSV and PDF import preview, commit and certification | `import-ledger-flow.spec.js` (imported row edit through Entries, Month and Summary; final import; first-upload PDF preview; multi-card statements; mismatch review surfaces; exact manual match shown as handled), `import-inbox-navigation.spec.js`, `money-field-editability.spec.js` (preview amount) |
| Import rollback | `import-ledger-flow.spec.js` (PDF rollback invalidates cached entries; shifted mid-cycle rows rollback through the dialog) |
| Month budget and planned-item actuals | `month-page.spec.js` (budget row edit updates Month and Summary, actual drilldown on desktop and in the mobile sheet, planned-item matching dialogs and sheet) |
| Entries shared amounts | `entries-add-to-splits.spec.js` (shared scope from the linked split, adding to splits, category and note sync), `entries-linked-split-amount.spec.js` |
| Split activity, settlement, checkpoints, matching, editing | `splits-settlement*.spec.js`, `splits-review-matches.spec.js`, `splits-edit-expense.spec.js`, `splits-delete-expense.spec.js`, `splits-viewer-amounts.spec.js`, `splits-cross-tab-refresh.spec.js` |
| Settings rules, renames and shortcut | `settings-reference-data.spec.js` (rule save dialog, duplicate rule summary, edit person, shortcut settings) |
| Summary and Month notes | `month-page.spec.js` (desktop and mobile note edits), `summary-owner.spec.js`, `month-save-checks.spec.js` |
| App shell and reference data | `app-shell.spec.js` (route transitions, tab walk), `app-shell-chrome.spec.js`, `reference-data-owner.spec.js` |
| Demo reseed | every browser test reseeds through `/api/demo/reseed` |
| Optional AI insight fallback | `financial-insight.spec.js` (computed insights render without AI) |

Gaps that were already there (the moved tests never drove these screens
either, so nothing was lost; they are follow-ups, not regressions): creating
a split expense through the dialog and saving it, foreign-currency travel
groups in the Splits UI, restoring a deleted split from the history view,
and the import preview auto-refresh as the Imports page actually runs it.

## Measurements

One full browser run before and one after, each alone on isolated ports
(Vite 5419, Wrangler 8819, inspector 9419, `--persist-to
.wrangler/state-audit`), one worker, from a temporary config that spreads
`playwright.config.js`.

| | Before (`7ed917b`) | After |
| --- | ---: | ---: |
| Browser tests | 318 passed in 56 files | 252 passed in 50 files |
| Playwright wall time | 12.9 min (778 s including server start) | 11.7 min (707 s) |
| Sum of per-test durations | 767.3 s | 698.3 s |
| Unit tests (`npm run test:unit`) | 621 passed, 91.7 s | 686 passed, 110.6 s |

- Browser: 66 fewer tests. The removed tests took 48.2 s in the before run;
  the wall-time difference is 71 s. The other 23 s is run-to-run noise: the
  252 tests that stayed took 719.0 s in the before run and 698.3 s after,
  and the before run overlapped for its last few minutes with unit test runs
  in this session. Count 48 s as the defensible saving (about 6%).
- Unit: 65 more tests (64 moved, plus the shortcut 405 case rewritten in
  `shortcut-gateway.test.mjs`; the financial-insight duplicate was
  deleted). The Worker-level files add about 19 s to `npm run test:unit`, because each test starts its own database
  and cold Worker initialization, and the longest new file sets the tail.
- Smoke (`npm run test:e2e:smoke` steps, isolated ports, after only): 15
  workflows in 18 processes, 88 tests passed, exit 0, 324 s. The moved tests
  that smoke used to run took about 38 s of test time before (30 import, 5
  Month, 5 Settings, 1 Summary, 3 Entries cases and the reseed file, which
  also paid its own server start), so `npm run verify` should get roughly
  15 to 25 s faster overall after the 19 s unit increase. The smoke run
  before the change was not measured, so this is an estimate from per-test
  durations, not a measurement.
- Coverage: every removed browser test is accounted for in the Moves table
  (64 moved with the same assertions, 1 rewritten with the same three
  checks, 1 deleted as an exact duplicate of an existing unit test), and each
  failed under a mutation of the code it protected.

Gates on the finished branch (before the final merge of `macro-performance`):
`npm run audit` 0 vulnerabilities; `typecheck` and `typecheck:client` clean;
`lint` 0 errors (30 existing `react-hooks/exhaustive-deps` warnings in
`src/client`, no source changed here); `test:unit` 686/686; `build` ok;
`check:bundle` ok (JS 173,359 gzip bytes against a 180,337 budget, CSS
33,435 against 31,961, inside the 5% allowance and unchanged by this work);
smoke 88/88; full browser suite 252/252.

## Follow-ups

- Add browser tests for the pre-existing UI gaps listed above (split
  expense created through the dialog, travel-currency groups, restore from
  split history, import preview auto-refresh on the Imports page).
- Mutation I10 (rollback keeps the import's rows) failed no test, before or
  after the move: the rolled-back status hides the rows from every page, so
  no page-level assertion notices rows left behind. The whole-database
  rollback checks in `atomic-writes-imports.test.mjs` are the place for that
  contract.
- Worker-level tests start a fresh Miniflare database per test and pay the
  cold schema initialization (about 0.5 s) on the first request, so a moved
  import test takes about 1.2 to 2 s in Node against about 0.9 s in the
  browser run. They run in parallel with the other unit files, so this adds
  little to `npm run test:unit` wall time (see Measurements).
