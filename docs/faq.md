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

Monthly planning is person-based first. The primary person and partner can have
different month plans, and the household month view should be derived by
combining those plans, not by maintaining a separate duplicate household plan.

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

[https://<your-worker-host>](https://<your-worker-host>)

It uses the Cloudflare D1 database `monies-map`.
The Worker is configured as a single-page app, so refreshing nested routes such
as `/entries` should reload the React app instead of returning a Cloudflare 404.

Before using real household data, protect the Worker with Cloudflare Access.
The fastest setup is one-time PIN email auth, restricted to:

- primary household email
- partner household email

Google login can be added later by configuring Google as a Cloudflare Zero Trust
identity provider and keeping the same email allowlist.

## How do I deploy to production?

Use the Cloudflare deploy steps in
[`README.md`](../README.md#cloudflare-deploy).
The routine path is to use Node 22, then run `npm run deploy`. If the app change
depends on a schema update, run `npm run db:migrate:remote` before deploy.

## What does the demo assume right now?

Fresh databases start in empty-state mode. That blank slate keeps only reference
data: the household record, the two default people, and the category catalog.
There are no demo accounts, entries, imports, statement checkpoints, month plan
rows, snapshots, split records, or balances in the ledger until you add or
import them.

When you use `Enter empty state` from Settings, the app waits for the reset
request to finish, reloads the bootstrap data, and checks that accounts are gone
before closing the confirmation. If accounts still appear, refresh the page and
confirm the reset ran against the same database as the app you are viewing.

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

Click or tap a current split row to edit it in place. The row is replaced by
the form so you can change the category, people, amount, group, note, or
settlement details without opening a separate popover. Delete and linked-entry
editing live inside that inline form so the row itself stays easy to scan.
Deleting asks for confirmation before removing the split record. If that split
was linked to an imported bank entry, the bank entry stays in `Entries`; only
the sharing record is removed.

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
- `Baby & Kids` — icon `baby` — color `#7EBDC2`
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
If a shared dining row is split 55/45, the primary person should see the 55%
subtotal and the partner should see the 45% subtotal. The full shared
transaction can still be shown alongside it for context.

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

Yes, if the ledger is complete from a known starting point. The app does not
connect directly to the bank, so it can only prove balances from rows you have
entered or imported.

### What the wallet balance means

Each account balance is calculated as:

- opening balance
- plus income and transfer-ins
- minus expenses and transfer-outs

This makes the app internally consistent. It can still differ from the bank if
rows are missing, duplicated, assigned to the wrong account, or marked with the
wrong direction.

### What statement checkpoints do

A statement checkpoint is the bank's closing balance for one account and one
statement period. Use it as the proof that the app ledger agrees with the bank.

- For bank accounts, this is usually a clean monthly period.
- For credit cards, use the bank-facing positive amount owed. The app converts
  it to the internal liability-negative balance for comparison.
- If statement start/end dates are blank, the app treats the checkpoint as a
  calendar month-end.
- If start/end dates are filled, the app compares only that statement cycle.

Account health then shows whether the latest checkpoint is matched, off by a
delta, or missing. If there is a delta, you can download a CSV of the checkpoint
period to inspect the ledger rows that make up the balance.

### What to check when a balance looks wrong

Start with the account card in Settings:

1. Check whether the account has the right opening balance.
2. Check whether the latest statement checkpoint exists.
3. Check whether there are unresolved transfers.
4. Check recent imports and overlap warnings.
5. Use Compare statement if the mismatch belongs to a specific bank statement.

The comparison tool treats the PDF as evidence, not as a new import. It shows
which statement rows already match the ledger, which rows are missing, which
ledger rows are extra, and whether there are likely duplicates or direction
mistakes. Missing statement rows can be added from there, and direction mistakes
can be fixed inline without reuploading the PDF.

### How duplicates and overlaps help

Import previews warn about duplicate-looking rows before commit. They also warn
when the current preview overlaps a previous completed import for the same
account and date range.

- Duplicate warnings help prevent the same row from entering the ledger twice.
- If two accounts share a name, choose the owner-qualified account in the import
  mapping. Overlap checks use that selected account, not just the display name.
- Overlap warnings are date-range warnings; they do not remove rows by
  themselves.
- Marking an overlap as reviewed only hides the warning.
- Exact and near matches use amount, account, date proximity, and description
  similarity.

The Entries page keeps `Spend` as category expense only. It also shows
`Outflow`, which includes expenses plus transfer-outs, so transfers are visible
without being mixed into category spending.

## How do I import real bank activity?

Use Imports when you want bank or card rows to become ledger entries. Use
Settings -> Compare statement when you already have rows in the ledger and only
want to investigate a statement mismatch.

### Supported files

The app currently supports:

- CSV files or pasted CSV text
- supported PDF statements
- supported UOB One current-transaction `.xls` exports
- supported Citibank credit-card current-activity `.csv` exports, when the
  selected default account is a Citibank credit card

Supported PDF parsers include:

- UOB credit-card statements
- UOB One savings statements
- Citibank Rewards statements
- Citibank Miles statements
- OCBC 365 credit-card statements with embedded text
- OCBC 360 account statements with embedded text

### Category matching during preview

The import preview uses editable merchant rules from Settings to categorize
future rows before commit. If a rule matches, it can correct the parser's first
guess. This is for repeated bank text such as `TADA`, `SHOPEE`,
`AMAZON`, `AMZON`, `JALAIRLINE`,
`SINGLIFE`, `GOLDENVILLAGE`, `JOSEPHPRINCE`, `GOPAY-GOJEK`, `AXSPTELTD`,
`KEPPEL ELECTRIC`, `M1LIMITED`, `INCOMEINSURANCE`, `INLAND REVENUE`, `IRAS`,
`GIRO` plus `HDB`, and card conversion-fee descriptions.
Transfer-looking card rows such as `TSFTO...6349` are treated as transfers, not
normal expenses.

Use Settings -> Category matching to add or adjust rules. Rules apply to future
previews and can override a parser guess; they do not rewrite older ledger rows
that you already reviewed and committed.

How rules match:

- Capitalization does not matter.
- Spaces and punctuation do not matter.
- A specific merchant name can match any part of the bank text.
- Use commas when a row should contain a few separate words before it matches.
  For example, `paynow-fast, lunch` only matches a bank row that contains both
  `paynow-fast` and `lunch`, so it can categorize lunch PayNow rows without
  categorizing every PayNow row as food.
- Very short names only match when they appear as their own word, so a rule like
  `GV` does not accidentally match every word containing those letters.
- Lower priority numbers are checked first.

### What do category match suggestions mean?

If you keep changing similar merchant rows to the same category, the app does
not create a rule by itself. It creates a pending suggestion.

You will see a small number badge on Settings when suggestions are waiting. Use
that badge, or open Settings -> Category matching, to review them.

For each suggestion, choose one action:

1. Add rule if the merchant text is specific enough.
2. Edit first if the suggested text is too broad or too narrow.
3. Ignore if you do not want the app to remember that pattern.

Accepted suggestions apply to future import previews. They do not change older
entries automatically.

### If this is your first account setup

1. Create the account in Settings.
2. Enter the opening balance from just before your first trusted statement
   period.
3. Import the first statement or compare it against existing rows.
4. Review account mapping, ownership, categories, transfers, splits, duplicates,
   and statement balance check.
5. Commit the import once the rows look right.
6. Save the statement checkpoint when the ledger matches the bank statement.

For credit cards, the account card displays owed balances as negative
liabilities, but the statement checkpoint field should use the positive amount
owed printed by the bank.

### If you add splits after a fresh statement import

Splits are a household sharing layer on top of ledger rows. They do not replace
the bank row.

Best option:

1. Import the statement first.
2. Commit the clean bank rows.
3. Open the expense entry that should be shared.
4. Use `Add to splits` from the entry editor.
5. Adjust payer, people, split percentage, group, category, and notes.

That keeps the bank ledger complete while also recording who owes whom. The
original entry remains traceable to the import batch, and the split record points
back to the ledger entry.

If you manually create a split before the bank row exists, it is still useful as
a reminder, but it is not yet matched to the ledger. When the bank row arrives,
use the split match prompts to link the split to the imported entry instead of
creating another split.

### If you are updating mid-month

Use a current-transaction export as a working ledger update.

Example: download a UOB One `.xls` activity export or a Citi card activity
`.csv` for the current period, choose the matching account in the import form,
import it, review the rows, and commit them. Those rows can then be used for
Month, Entries, Splits, transfer matching, and category cleanup before the
statement closes.

Mid-month rows are useful, but they are not final proof. The final proof is still
the next statement checkpoint.

### If you import UOB `.xls` or Citi `.csv` after adding manual splits

Import the activity file normally, but review duplicates and split matches before
commit.

What should happen:

1. The import preview warns about duplicate-looking rows already in the ledger.
2. Rows that are genuinely new can be committed.
3. Rows that duplicate existing ledger entries should be removed from the
   preview before commit.
4. If an imported row looks like a manually entered split expense, link the split
   to the ledger entry after import instead of keeping two separate records.

The import does not automatically replace manual split records. That is
intentional. A split can be a household agreement, while the imported row is the
bank evidence. The safe workflow is to import the bank row once, then link or
adjust the split.

### If a mid-cycle import already covers part of the next statement

Use the statement period printed by the bank, not just the calendar month.

Best option:

1. Keep the mid-cycle import rows if they are real bank activity.
2. When the statement arrives, compare the statement against the committed
   ledger first.
3. If the comparison says a row is already matched, do not import that row again.
4. If the comparison says a statement row is missing, add or import only that
   missing row.
5. If the comparison shows a ledger row with the opposite direction, edit that
   row instead of adding another row.

This is why statement comparison exists. It lets you prove whether the
mid-cycle rows already satisfy the statement before you commit more rows.

### If a statement arrives later

When the statement is ready, do this before importing duplicate rows:

1. Check the statement period for that specific account.
2. Compare the statement against the committed ledger if rows were already
   imported mid-cycle.
3. Review missing rows, extra rows, direction mistakes, and duplicate-looking
   rows.
4. Import only rows that are truly missing, or remove duplicate preview rows
   before commit.
5. Save the statement checkpoint once the ledger matches the statement balance.

Cutoffs are per account. A Citi Rewards cutoff should not be reused for Citi
Miles, and a UOB card statement cycle should not be reused for UOB One savings.

### After statement reconciliation

When the checkpoint matches, treat that account and period as closed.

Good follow-up work:

1. Resolve transfer links.
2. Link any unmatched split expenses or settlements to their bank rows.
3. Clean categories and ownership.
4. Leave the import batch in history so it can be rolled back if it was wrong.

Avoid editing old reconciled rows unless you are fixing a known mistake. If you
do edit one, recheck the statement checkpoint because the saved balance may move
from matched to mismatched.

### Two-month example

Month 1:

1. Create the account.
2. Set the opening balance from before the first statement's activity.
3. Import or compare the first statement.
4. Commit clean rows.
5. Save the checkpoint once the statement balance matches.

Month 2:

1. Import mid-cycle activity only after the latest statement cutoff.
2. Use those rows for planning and cleanup during the month.
3. When the statement arrives, compare it to the committed ledger.
4. Remove duplicate preview rows or add missing rows.
5. Save the new checkpoint when the balance matches.

For example, if a Citi Rewards statement last included 8 Apr 2026, then a
1 Apr to 13 Apr activity export should only contribute 9 Apr onward rows. Rows
from 1 Apr to 8 Apr already belong to the closed statement.

### Two-month example with splits

Month 1:

1. Create the account and enter the opening balance from before the first
   statement period.
2. Import the first PDF statement.
3. Commit the bank rows.
4. Add splits from the committed entries that should be shared.
5. Save the statement checkpoint once the bank balance matches.

Month 2:

1. Import a mid-cycle UOB `.xls` or Citi `.csv` activity file.
2. Remove any preview rows that duplicate closed Month 1 rows.
3. Commit only new bank rows.
4. Add or link splits for shared spending during the month.
5. When the Month 2 statement arrives, compare it against the ledger.
6. Add only missing statement rows, fix direction mistakes, and remove
   duplicates.
7. Save the Month 2 checkpoint once the statement balance matches.

The user goal is not to import every file blindly. The goal is to have one bank
ledger row per real bank transaction, with splits linked to those rows where
household sharing matters.

### What you review before commit

Before committing, check:

- account mapping
- duplicate rows
- overlap warnings
- row date, description, amount, and type
- category and ownership
- transfer direction
- statement checkpoint fields for supported PDFs
- statement balance check for supported PDFs

Successful commits reset the import composer. Use Start over anytime to clear
the current draft without refreshing the page.

### Notes on supported statement parsers

- CSV can use one signed `amount` column or separate `expense` and `income`
  columns.
- UOB credit-card PDFs use post date as the ledger date and keep transaction
  date in the row note.
- UOB One savings PDFs use the statement period and running balances to validate
  withdrawal/deposit direction.
- Citibank card PDFs use layout-aware parsing for compact card-section rows.
- Citibank current-activity CSV files are headerless, so the app only applies
  the Citi activity parser when the selected default account is a Citibank
  credit card and the file name matches the Citi activity export pattern. The
  trailing card number is reduced to the last four digits in the note.
- OCBC 365 card PDFs use the printed statement date, subtotal, and total amount
  due.
- OCBC 360 account PDFs use the monthly period, running balances, and balance
  carried forward.

For supported PDFs, the browser extracts statement text locally and turns it
into reviewable rows. If the PDF creates statement checkpoints, those fields are
editable before commit.

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
