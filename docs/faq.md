# FAQ

This is a living FAQ for Monie's Map.
It should be updated whenever setup, workflow, scope, or user-facing behavior
changes.

## What is Monie's Map?

Monie's Map is a household finance app for planning and tracking money across
multiple bank accounts, credit cards, personal expenses, shared expenses,
transfers, and monthly notes in one system.

The core questions behind the app are:

- what did I intend?
- what happened?
- was the difference justified?
- did that hurt savings?
- what assumption was wrong?

## What does the app include right now?

- summary dashboard
- monthly planning dashboard
- entries view
- splits view with group pills, manual split expenses, settle-up records, and a
  matches review mode
- manual single-entry creation from the entries view
- imports view
- FAQ view
- demo data shaped like the intended product and planning model
- a settings view for reseeding and refreshing the current demo bootstrap, plus
  editing household member display names
- React + Vite frontend talking to the existing Worker API
- category colors and icons as first-class metadata for charts and category cards

## What is the planning model?

The app separates a month into two layers:

- planned items
- budget buckets

Planned items are intentional commitments or recurring obligations. These are
the rows near the top of the month, such as savings, tax, subscriptions, house
loan, insurance, and other known items.

Budget buckets are flexible categories, such as food, groceries, transport, and
shopping. These are not supposed to predict every single merchant in advance.

Planned items and budget buckets match actuals differently. Planned items are
matched explicitly to one or more ledger entries, because several planned items
can share a category such as `Bills`. Budget buckets remain category-driven and
roll up the remaining actual expense entries for that category.

After a planned item is matched, the app remembers lightweight matching hints
from the linked ledger entries so future months can suggest likely matches. It
does not auto-link them yet; the user still confirms the matches.

Monthly planning is person-based first. Tim and Joyce can have different month
plans, and the household month view should be derived by combining those plans,
not by maintaining a separate duplicate household plan.

The point is not only to log transactions. The point is to compare plan versus
actual and understand why the month moved.

The Summary page defaults to the latest 12 available months. If a month has
ledger entries, its actual income and expense values are derived from completed
entries rather than waiting on a stale monthly snapshot row.

## Can I rename the household members?

Yes. The Settings page now lets you edit the two household member display names.
Those names flow through person views, entry ownership filters, and split
labels. In empty-state mode the app seeds neutral defaults instead of generic
placeholder labels.

## What does over-granular mean here?

Over-granular means planning too many unstable or one-off spending lines as if
they were fixed commitments.

Examples of over-granular planning:

- separate planned rows for lots of ad hoc shopping items
- budgeting individual restaurant visits instead of a food bucket
- creating many rows that change name or meaning every month

Based on the June to October sheets, the current approach already looks fairly
flexible. The top portion behaves like planned items, and the highlighted lower
section behaves like budget buckets. That is a reasonable structure to carry
into the app.

## What is still in progress?

- full D1-backed persistence for edits
- CSV import review and commit flow
- editing and saving changes
- Google login
- in-app AI analysis

## Where is the production app deployed?

The current Cloudflare Worker deployment is:

[https://monies-map.timsantos-accts.workers.dev](https://monies-map.timsantos-accts.workers.dev)

It uses the Cloudflare D1 database `monies-map`.
The Worker is configured as a single-page app, so refreshing nested routes such
as `/entries` should reload the React app instead of returning a Cloudflare 404.

Before using real household data, protect the Worker with Cloudflare Access.
The fastest setup is one-time PIN email auth, restricted to:

- `mr.timothysantos@gmail.com`
- `hellojoyceli@gmail.com`

Google login can be added later by configuring Google as a Cloudflare Zero Trust
identity provider and keeping the same email allowlist.

## How do I deploy to production?

Use the Cloudflare deploy steps in
[`README.md`](/Users/tim/22m/ai-projects/monies_map/README.md#cloudflare-deploy).
The routine path is to use Node 22, then run `npm run deploy`. If the app change
depends on a schema update, run `npm run db:migrate:remote` before deploy.

## What does the demo assume right now?

Fresh databases start in empty-state mode. That blank slate keeps only reference
data: the household record, the two default people, and the category catalog.
There are no demo accounts, entries, imports, statement checkpoints, month plan
rows, snapshots, split records, or balances in the ledger until you add or
import them.

The current demo uses a believable household scenario, but it only appears after
you explicitly reseed the demo from the in-app settings view. The default
category catalog persists through reseed, local wipes, and the empty-state path,
so imports still start from the same baseline set of categories, icons, and
colors. Some internal modules still use `demo` naming for the original seed
fixtures, but app totals are derived from D1 rows rather than hardcoded fixture
amounts.

## What is the Splits view for?

`Splits` is the shared-expense workspace.

It is intentionally separate from `Entries`:

- `Entries` is the bank and card ledger
- `Splits` is where manual shared expenses, named groups, settle-up records,
  and shared-expense matching live

That separation keeps the CSV import flow focused on ledger review instead of
mixing bank cleanup with Splitwise-style matching decisions.

The current `Splits` surface includes:

- `Non-group expenses` plus named group pills
- context-aware owed or owing copy on each pill
- entry counts on the pills
- a `Matches` pill that replaces the activity list with review candidates
- manual `Add expense` flow
- manual `Settle up` recording flow
- `Add to splits` from the entries editor for promoting a ledger expense into
  the shared-expense layer

Imported shared rows or transfer rows can then be matched later from `Matches`
instead of from the import screen itself.

`Splits` is driven by open unsettled batches, not by the month picker:

- each group has one current open batch
- recording `Settle up` closes that batch
- closed batches remain visible below as muted history
- a later expense can start a new current batch for the same group, even if the
  date is backdated

When you use `Add to splits` from the entries editor, the app treats the entry
owner or owning account as the payer. If the ledger row is still direct, it is
converted to shared first with a default `50/50` transaction split, then the
linked split expense is created under `Non-group expenses`.

## What are the default app categories?

The current default category catalog is:

- `Income` — icon `receipt` — color `#1F7A63`
- `Transfer` — icon `arrow-right-left` — color `#C97B47`
- `Savings` — icon `receipt` — color `#7C8791`
- `Investments` — icon `banknote` — color `#8FAE4B`
- `Salary` — icon `badge-dollar-sign` — color `#22B573`
- `Extra Income` — icon `banknote-arrow-up` — color `#D5A24B`
- `Other - Income` — icon `wallet-cards` — color `#B8875D`
- `Subscriptions MO` — icon `washing-machine` — color `#E96A7A`
- `Subscriptions YR` — icon `washing-machine` — color `#F08FA0`
- `Food & Drinks` — icon `utensils` — color `#F7A21B`
- `Shopping` — icon `shopping-bag` — color `#D4B35D`
- `Family & Personal` — icon `users` — color `#4F8FD6`
- `Home` — icon `house` — color `#F85A53`
- `Church` — icon `church` — color `#F062A6`
- `Tax` — icon `banknote` — color `#CC63D8`
- `Groceries` — icon `shopping-cart` — color `#F08B43`
- `Travel` — icon `plane` — color `#567CC9`
- `Loans` — icon `wallet-cards` — color `#A06C5B`
- `Sports & Hobbies` — icon `dumbbell` — color `#66D2CF`
- `Bills` — icon `lightbulb` — color `#62C7B2`
- `Education` — icon `graduation-cap` — color `#7D86F2`
- `Insurance` — icon `shield` — color `#5EA89B`
- `Fees` — icon `receipt` — color `#8B78E6`
- `Beauty` — icon `receipt` — color `#D56BDD`
- `Entertainment` — icon `clapperboard` — color `#FFA51A`
- `Healthcare` — icon `heart-pulse` — color `#D86B73`
- `Gifts` — icon `gift` — color `#C98A5A`
- `Other` — icon `wallet-cards` — color `#717379`
- `Public Transport` — icon `bus` — color `#56A4C9`
- `Taxi` — icon `car-front` — color `#BDD93C`

## Why does household monthly view behave differently from person view?

At the household level, `Direct ownership` is not very meaningful as a primary
planning lens. The household monthly view should focus on:

- `Combined`: both people's direct plans plus shared plans, merged into one
  household view
- `Shared`: shared-only planning rows

In person views, shared rows are supposed to be weighted to that person's split.
If a shared dining row is split 55/45, Tim should see the 55% subtotal and
Joyce should see the 45% subtotal. The full shared transaction can still be
shown alongside it for context.

## Why do notes matter so much?

The app should not treat notes as decoration. Notes explain why a month is
unusual, whether that was intentional, and whether the explanation matches the
data.

That matters even more for life changes and irregular periods, such as pregnancy,
birth, travel, medical expenses, family events, or seasonal commitments.

## Are category colors and icons just frontend decoration?

No. They should live in the data model so the donut chart, category cards, and
future reports all use the same category presentation. The UI can expose this
through an inline edit surface on the category icon instead of hiding it behind
an old-style settings page.

## Can I run it locally before Cloudflare?

Yes. Local development comes first. Review and iterate on the app locally
before wiring Cloudflare resources.

The current setup runs as two local processes during development:

- Vite for the frontend
- Wrangler for the Worker API

If the app sits on `Loading...` and the browser console shows `/api/bootstrap`
returning `500` plus a JSON parse error, the usual local cause is that Vite is
still running while the Worker API failed to start. This repo expects Node 22
for local scripts, so run `nvm use` from the repo root and restart
`npm run dev`.

## Can it know the real balance of each wallet?

It can compute a running wallet balance from the ledger, but only from what has
been imported locally.

Each account now has an opening balance. The displayed wallet total is:

- opening balance
- plus imported income
- plus transfer-ins
- minus expenses and transfer-outs

That makes balances internally consistent from a known starting point, but it
is still not the same as live bank sync. If imports are incomplete, the app can
still differ from the bank.

The app now supports statement checkpoints too. You can save a statement
closing balance for an account, and the latest checkpoint is compared against
the computed ledger. Statement start/end dates are optional: if they are blank,
the app treats the checkpoint as a normal calendar month-end; if they are
filled, the statement end date becomes the comparison cut-off for credit-card
cycles that include prior-month rows. When a start date is filled, the app
computes a baseline balance before that start date, then treats only start-to-end
transactions as the statement cycle movement. Account health then shows whether
the ledger matches, is off, or still needs a checkpoint. It also surfaces the
latest import time and any unresolved transfers that could make a balance look
wrong. If a checkpoint has a non-zero delta, you can download a CSV with the
baseline row and the completed ledger rows inside that statement cycle.
For credit cards, enter the statement as the bank-facing positive amount owed;
the app normalizes it to the internal liability-negative ledger convention for
comparison.

Transfers are included in wallet balance and checkpoint calculations. Transfer
ins increase the computed account balance, and transfer outs decrease it. The
Entries page keeps `Spend` as category expense only, then shows `Outflow` to
include expenses plus transfer-outs.

The import workflow now also flags possible duplicate rows already in the
ledger and warns when the preview overlaps the date range of previous completed
imports for the same accounts. Recent imports also show which completed batches
overlap, so a first import for a different card is not flagged just because the
dates cross. For supported PDFs, the preview also runs the statement balance
check before commit; duplicate and overlap warnings are separate guardrails for
catching common CSV and statement-import mistakes.

Those duplicate warnings are now a bit smarter than a raw exact hash check. The
app shows both exact matches and near matches based on amount, account, date
proximity, and description similarity so you can spot likely overlaps before
committing a CSV.

Settings also shows a lightweight recent activity log for balance-affecting
actions like imports, opening-balance edits, checkpoints, entry edits, and
transfer link changes.

Each account’s reconciliation dialog also keeps checkpoint history, so you can
review, edit, or delete more than the latest month-end proof. Unresolved
transfers now have a larger review surface in Settings that links back into
Entries for cleanup.

For an already-imported statement period with a mismatch, use Settings ->
Accounts and choose Compare statement on the mismatched account. The same link
is also available from the checkpoint history inside Reconcile; choosing it
closes the dialog and opens a full-width comparison section below the account
cards. Upload the bank statement there instead of importing it again. The
section shows the checkpoint period before upload, then fills the uploaded
statement period from the PDF after upload so you can confirm the right file and
date range are being compared. It also shows the mismatched amount from the
checkpoint delta. PDF comparison uses the same deterministic statement parser as
the Imports page, including account-section scoping for multi-card statements.
When a checkpoint has no explicit start date, the comparison uses the uploaded
PDF statement period when available, then falls back to the first day of the
checkpoint month so earlier ledger rows do not appear as statement differences.
The comparison treats the statement as evidence only: it matches statement rows
against the committed ledger rows for that checkpoint period, then lists rows
that are in the statement but not the ledger, rows that are in the ledger but
not the statement, and possible near matches. This is a better word than
“error” for the UI because the difference could be a missing row, duplicate
manual row, wrong account, posting-date shift, or period-boundary issue.
Near matches include same-amount rows with opposite income/expense direction,
because those explain a checkpoint delta without meaning the transaction is
actually absent from the ledger. The comparison also includes a duplicate check
for same-date, same-amount, same-description rows on both the uploaded statement
and the committed ledger, so a mismatch can be separated into missing rows,
extra rows, direction mistakes, and duplicate-looking rows.
Direction mistakes can be fixed inline from the comparison panel; the action
updates only the existing ledger row's type, direction, and category, then
updates the comparison result without requiring the statement PDF to be uploaded
again.
Rows that are present in the statement but missing from the ledger can be added
from that comparison section; the add-entry popover is prefilled from the
statement row and the compared account.

## Does it already support real CSV or PDF import?

Yes. The app supports CSV review, row-level cleanup, and commit into the
ledger. It also supports deterministic PDF statement import for UOB credit-card
statements, UOB One savings statements, and Citibank Rewards or Citibank Miles
credit-card statements. OCBC 365 credit-card statements and OCBC 360 account
statements are also supported when the PDF includes embedded text. UOB One
current-transaction `.xls` exports are supported as working ledger imports; they
create reviewable rows but do not create statement checkpoints.

The import workflow is:

1. Open Imports and paste CSV text, upload a CSV, drag a supported PDF
   statement, or drag a supported UOB current-transaction `.xls` export into the
   upload area.
2. For CSV, review the column mapping. The current import review supports either
   one signed `amount` column or separate `expense` and `income` columns.
3. For supported PDFs, the browser extracts statement text locally and converts
   it to the same reviewable rows as CSV. For supported UOB `.xls` current
   transaction exports, the browser reads the workbook locally and converts the
   posted activity into the same reviewable rows, without a checkpoint. The app
   shows upload status while it is reading, extracting, parsing, and preparing
   the preview.
4. Review statement account mapping. This matters when a statement label is
   ambiguous, such as UOB One bank account versus UOB One Card. The mapping
   applies to both the preview rows and any statement checkpoints generated from
   the PDF. Direct rows use the mapped account's owner when the account belongs
   to one person; the Default owner field is only the fallback for rows without a
   personally owned mapped account.
5. Review duplicate and overlap warnings. Duplicate-looking rows are highlighted
   directly in the preview table, and each preview row has a remove action so a
   known duplicate can be excluded before commit. Overlap is scoped by account
   and transaction coverage dates, not by the date the import batch was created.
   Marking an overlap as reviewed only hides the warning; it does not remove
   duplicate rows from the preview.
6. For supported PDFs, review the statement balance check. It compares the
   projected ledger balance after committing the preview rows against the
   detected statement balance through the statement end date. If the account
   mapping or checkpoint fields are edited, use Refresh check before commit.
7. Review or edit row-level values, then commit. Successful commits reset the
   composer so stale CSV/PDF content, upload status, checkpoint drafts, and
   preview rows do not remain on screen. Use Start over anytime to clear the
   current import draft without refreshing the page.

For mid-month tracking, use the current-transaction export as a working ledger
update. For example, download the UOB One `.xls` activity for the current month,
import it, review categories and transfers, and commit those rows so the Month
and Entries pages stay useful before the statement closes. Later, when the bank
statement is ready, use the statement PDF as reconciliation evidence first:
compare it against the committed ledger or import it only after reviewing
duplicate and overlap warnings. The app should preserve the rows you already
categorized, linked, split, or matched; the statement import/compare step is for
finding missing rows, wrong directions, duplicates, or period mistakes, then
saving the final statement checkpoint once the balance matches.

A two-month setup usually looks like this:

1. Create each account in Settings with its institution, owner, and account type.
2. Use the first statement you trust as the starting point. Enter the opening
   balance as the balance immediately before the first imported statement
   activity. For credit cards, the app displays owed balances as internal
   liability negatives, but statement checkpoint inputs should use the
   bank-facing positive amount owed.
3. Import or compare that first statement. Review account mapping, duplicates,
   ownership, categories, transfers, and splits, then commit the rows and save
   the statement checkpoint once the ledger matches the statement balance.
4. During the next month, import only current-transaction exports for new rows
   that happen after the latest statement cutoff for that specific account. For
   example, if a Citi Rewards statement's last included transaction is
   8 Apr 2026, a mid-cycle Citi Rewards export from 1 Apr to 13 Apr should only
   contribute 9 Apr onward rows. Rows from 1 Apr to 8 Apr already belong to the
   closed statement and should be treated as possible duplicates.
5. Keep using those mid-cycle rows for planning, splits, transfer matching, and
   category cleanup. They are real working ledger entries, not final proof.
6. When the second statement arrives, compare it to the committed ledger first.
   If the statement rows were already imported mid-cycle, the preview should
   highlight duplicates so they can be removed before commit, or the Settings
   comparison tool can show which ledger rows match, which are missing, which
   are extra, and whether any duplicate-looking rows exist.
7. Once the second statement balance matches, save the statement checkpoint.
   That checkpoint is the month-end proof that the working ledger now agrees
   with the bank for that account and statement period.

For credit cards and bank accounts, repeat the cutoff check per account. A Citi
Rewards cutoff date should not be reused for Citi Miles, and a UOB card cycle
should not be reused for a UOB One savings statement.

For CSV imports, the raw data can include:

- one signed `amount` column
- separate `expense` and `income` columns

You can also override the inferred entry type, amount, account, category,
owner, split, and note in the preview table before commit.

For supported PDFs, the browser extracts statement text and converts it to the
same reviewable rows as CSV. UOB credit-card PDFs are parsed from each card's
transaction-detail section, use post date as the ledger date, keep transaction
date in the row note, and must reconcile each card section against its previous
and total balance. UOB One savings PDFs use the statement period, running
balances, and ending balance to validate withdrawal/deposit direction.
Citibank Rewards and Citibank Miles PDFs use layout-aware statement text because
their transaction rows are printed as compact card-section lines. Parenthesized
amounts are treated as credits or payments, leading negative statement balances
are preserved as credit balances, and every card section must reconcile against
its previous balance and grand total before preview.
OCBC 365 card PDFs use the printed statement date, last-month balance, subtotal,
and total amount due. OCBC 360 account PDFs use the printed monthly period,
balance brought forward, running row balances, and balance carried forward; row
direction is derived from the running balance movement.

Supported PDF statements can also prefill statement checkpoints in the import
preview. Those checkpoint fields remain editable before commit, and the preview
checks whether committing the current rows would make the projected ledger match
the detected statement balance through the statement end date. Commit then saves
the checkpoints alongside the imported rows so account reconciliation updates
with the statement import.

## Are uploaded PDF statements stored?

No. Supported PDF statements are read by the browser so the app can extract text
and parse statement rows locally. The original PDF file is not uploaded as a
file to the backend and is not saved in app storage.

For import preview and statement comparison, the backend receives only the
parsed transaction rows, account mapping, and statement checkpoint fields needed
to run duplicate, overlap, comparison, and reconciliation checks. If the import
is committed, the app saves the resulting ledger transactions, import batch
metadata, and statement checkpoints. If the statement is only used in the
Settings comparison tool, it is treated as evidence for that comparison and is
not committed as a new import.

Refreshing the page or choosing Start over clears the in-browser draft state,
including the parsed rows produced from the PDF. The browser's selected local
file reference is not retained by the app after that draft is cleared.

Large import commits are written in protected chunks in production. There is not a
deliberate 125-row product limit, but the UI warns when a preview is large
because a rejected Cloudflare request should be retried as smaller batches
rather than leaving a partial ledger import.
