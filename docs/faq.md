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
- imports view with CSV, XLS, PDF preview, duplicate review, rollback history,
  and statement checkpoint saving
- FAQ view
- empty-state setup plus optional demo data shaped like the intended product and
  planning model
- a settings view for accounts, people, category rules, login identity links,
  unresolved transfers, balance activity, and demo reset/reseed tools
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

When the app is protected by Cloudflare Access, the first signed-in visit can
link that login to one household member. If the selected member still has a
neutral default name, the setup prompt lets you rename it at the same time.
After that, Splits opens on that person by default. The login menu also lets
you unregister the link or log out without changing any household finance data.

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

- more bank and card parser coverage
- more automated reconciliation help around unusual statement formats
- deeper split matching and settle-up workflows
- in-app AI analysis
- optional direct bank connections, if the product ever decides to support them

## How should I treat PDF statements versus mid-cycle exports?

Supported PDF statements are the strongest import source in the app. Treat them
like a bank-sync checkpoint for the account and statement period: the statement
certifies posted date, description, amount, direction, and ending balance after
the parser has reconciled the statement structure.

Mid-cycle CSV or XLS exports are still useful for keeping the working ledger
current, but they are provisional until the official statement arrives. When a
PDF statement row matches a provisional mid-cycle ledger row, the app promotes
the existing row instead of creating a duplicate. That preserves user-added
category choices, notes, ownership, splits, and links while updating the
bank-facing facts from the statement.

If the same official statement row has already been imported or previously
certified, the app treats it as already certified rather than asking for another
duplicate decision. Completed PDF statement imports are not rolled back like
ordinary working imports; use a replacement statement or an explicit adjustment
if a correction is needed.

The statement certification check is necessary but not always sufficient. For a
mapped account with no prior ledger activity, statement checkpoint history, or
non-zero opening balance, the app also requires account identity confidence from
the detected statement account name. This prevents a first PDF import into a
zero-balance wrong account from passing just because the statement's own rows
and ending balance are internally consistent.

## Glossary: accounting terms in the app

### Bank facts

Bank facts are the parts of a transaction that come from the bank or card
issuer: posted date, description, amount, direction, account, and statement
period. A supported PDF statement is the strongest source for bank facts because
it is the closed official record for that period.

### User annotations

User annotations are the app-side details layered on top of bank facts:
category, note, ownership, split ratios, transfer links, and split-expense links.
When a PDF statement certifies an existing mid-cycle row, the app updates the
bank facts from the statement but preserves these annotations.

### Provisional row

A provisional row is useful working data that has not yet been proven by a final
statement. Mid-cycle CSV and XLS exports create provisional rows. They help with
planning during the month, but the final PDF statement gets the last word on
posted bank facts.

### Statement-certified row

A statement-certified row is a ledger row whose bank facts have been verified by
a supported PDF statement. The row may have been imported directly from the
statement, or it may be an existing mid-cycle row that the statement promoted in
place.

### Statement checkpoint

A statement checkpoint is the official closing balance for one account and one
statement period. It is the control total: after applying the statement rows and
prior ledger baseline, the computed ledger balance should equal this number.

### Checks and balances

Checks and balances are the independent proofs the app uses before trusting an
import. The row list proves individual transactions, the checkpoint proves the
ending balance, and account identity confidence proves the statement is mapped
to the intended ledger account.

### Identity unconfirmed

Identity unconfirmed means the statement may balance mathematically, but the app
does not yet have enough evidence that the selected ledger account is the right
account. This mainly protects brand-new zero-balance accounts, where a wrong PDF
could otherwise reconcile against itself.

### Near match and probable match

Near and probable matches are duplicate-detection labels for non-statement
imports. For official PDF statements, the app tries to avoid turning these into
manual decisions: if a statement row matches a provisional mid-cycle row, it
promotes the existing row to statement-certified instead of asking the user to
resolve a duplicate.

## Where is the production app deployed?

The current Cloudflare Worker deployment is:

[https://monies-map.timsantos-accts.workers.dev](https://monies-map.timsantos-accts.workers.dev)

It uses the Cloudflare D1 database `monies-map`.
The Worker is configured as a single-page app, so refreshing nested routes such
as `/entries` should reload the React app instead of returning a Cloudflare 404.

Before using real household data, protect the Worker with Cloudflare Access. The
app reads Cloudflare Access identity headers and can link a signed-in email to a
household member, but it does not implement standalone OAuth itself.

The fastest Access setup is one-time PIN email auth, restricted to:

- primary household email
- partner household email

Google sign-in can be used by configuring Google as a Cloudflare Zero Trust
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
- a `Review matches` text action that opens possible ledger and split matches
- manual `Add expense` flow
- manual `Settle up` recording flow
- `Add to splits` from the entries editor for promoting a ledger expense into
  the shared-expense layer

The Household split view is a read-only overview. It avoids person-specific
wording such as "you owe" and does not allow inline split edits; use a person
tab to add, edit, or settle split records.

![Splits shows open groups, owed totals, and linked split entries](/faq/features/thumbs/splits-overview.png)

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
converted to shared first with a default `50/50` transaction split. The app then
opens a centered split-group picker; nothing is saved until you choose a group,
and you can cancel the picker without creating a split expense.

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
- `Shopping` — icon `shopping-bag` — color `#D86B73`
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
- `Healthcare` — icon `heart-pulse` — color `#D4B35D`
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

## How duplicates and overlaps help

Import previews warn about duplicate-looking rows before commit. They also warn
when the current preview overlaps a previous completed import for the same
account and date range.

- Duplicate warnings help prevent the same row from entering the ledger twice.
- Duplicate matching normalizes punctuation and missing spaces in merchant text,
  so rows like `M1LTDRECURRING` and `M1 LTD RECURRING` can still match.
- Overlap warnings list the existing entries inside the overlapping account/date
  range so you can see which committed rows triggered the warning.
- The info icon on the overlap warning explains that the check is scoped to
  completed imports for the mapped preview accounts, not unrelated accounts.
- Statement PDF overlaps can be normal when mid-cycle exports already placed
  rows in the ledger. The PDF statement can promote matching provisional rows to
  statement-certified, preserving user notes, categories, ownership, splits, and
  links instead of asking for duplicate decisions.
- Citibank activity CSV filenames that end in `-rewards.csv` or `-miles.csv`
  are treated as that card account even if another Citibank card is selected as
  the default account.
- If two accounts share a name, choose the owner-qualified account in the import
  mapping. Overlap checks use that selected account, not just the display name.
- Overlap warnings are date-range warnings; they do not remove rows by
  themselves.
- Marking an overlap as reviewed only hides the warning.
- Exact and near matches use amount, account, date proximity, and description
  similarity.

Already-covered rows stay visible in the preview. You can include one if the
match decision was wrong, and statement checks refresh against the current
commit set. For supported PDF statements, already-covered rows should mostly
mean "already statement-certified" rather than "please inspect this duplicate."

If a statement mismatch is exactly resolved by including unresolved near-match
rows, probable duplicates, or other app-skipped duplicate rows for that account,
the preview treats those rows as statement-confirmed instead of duplicate
warnings. With the statement-certification model, matching provisional mid-cycle
rows are promoted in place: the statement owns the bank facts, while user
annotations stay attached to the existing transaction. Rows you explicitly
skipped stay skipped until you restore them.

When a PDF statement has no new rows because every row was already imported from
mid-cycle activity files, the import action changes to "Save statement
checkpoints" once the statement checks are matched. That lets you save the
statement balance evidence without adding duplicate ledger rows.

## How do Entries filters and refresh work?

The Entries page keeps `Spend` as category expense only. It also shows
`Outflow`, which includes expenses plus transfer-outs, so transfers are visible
without being mixed into category spending.

The account filter on Entries lists every active account, even when an account
has no rows in the selected month. This keeps the filter predictable when you
are checking a specific account for missing or uncategorized activity. Account
choices include the owner in the label, such as "UOB One - Joyce", when the
same account name could appear under different people.

![Entries filters include refresh, wallet, category, people, and type controls](/faq/features/thumbs/entries-filters.png)

Use the refresh button at the start of the Entries filter row to reload the
current month after importing or editing data in another tab.

## Why does switching views usually feel fast?

On Summary and Month, the Household, primary, and partner pills reuse the
matching views already loaded in the app shell when the month or summary range
has not changed. On Entries, the same pills reuse the loaded household month
rows and apply the person as a local filter. Switching between people should
feel like changing a filter, not like reloading the whole page.

Within one browser session, returning to a tab should reuse cached page data
when no import, edit, rollback, or manual refresh has invalidated it. This keeps
tab switching fast while still letting mutation flows clear the cache before
fresh data is needed. Cached route pages do not automatically force a second
fresh request on return; use the screen refresh action when you need to pull the
latest data without an edit or import.

On browser refresh or a later return to the same month/range, the app can render
the last successful bootstrap payload from local browser storage immediately and
then refresh it in the background. Any write that changes app data clears that
stored bootstrap copy so stale ledger state does not survive edits or imports.

## What does background prefetching do?

After the first usable screen renders, the app also uses browser idle time to
warm the most likely next route code chunks.

On non-touch devices, it can also prefetch adjacent Month or Summary periods in
a narrow, delayed sequence. Only after the visible page has finished loading and
the session stays quiet does it warm lower-priority page data such as Imports,
Splits, Settings, and Entries.

The prefetcher sends one request at a time with spacing between requests. Touch
devices skip background API prefetching so mobile refreshes do not compete with
the visible page request. Any route change, browser-tab hide, import, edit,
rollback, manual refresh, data-saver mode, or cache invalidation stops the staged
prefetch.

## How does month navigation work?

On touch devices, swipe left or right on Month or Entries to move to the next
or previous month. Splits does not use the selected month as its main filter, so
the gesture is disabled there.

After a month or summary range loads, the app keeps that page payload in memory
and may gently prefetch the adjacent period on non-touch devices. Going back to
an already loaded or prefetched period can therefore render immediately while
imports, edits, rollbacks, and other writes clear the relevant page cache before
reloading. Entries seeds its first page cache from bootstrap on refresh, then
uses explicit month changes, manual refreshes, and write invalidations for fresh
API loads.

## Why is the app shell split into smaller page loads?

The initial bootstrap now acts as the app shell. Summary, Month, Entries,
Splits, Imports, and Settings each have smaller page-specific reloads so month
changes and review work do not wait for the whole dashboard bootstrap to reload.
Those route screens are also loaded as separate JavaScript chunks, so import,
settings, PDF parsing, and statement parsing code are only downloaded when the
user opens a screen that needs them.

Bootstrap intentionally keeps Imports and Settings details light. Import
history, full category match rules, unresolved transfers, and audit history load
from their own page endpoints instead of being carried in every app-shell
request.

Bootstrap also leaves detailed split workspace rows to the Splits page endpoint.
That keeps refreshes focused on the visible app shell while the split page
loads its own groups, expenses, settlements, and match candidates when opened.

The Imports page initially loads a recent-history summary instead of scanning
the full audit trail. Recent imports open by default, can be filtered by any
owner-qualified account in the household, and label each batch as a PDF
statement, mid-cycle activity import, CSV import, or manual import. Import
preview, commit, rollback, duplicate detection, and same-account overlap checks
still use their focused flows. Because overlap checks inspect the account and
date range being imported, they can warn about an older matching batch even when
that batch is beyond the compact recent-history page currently visible.

## How do I import real bank activity?

Use Imports when you want bank or card rows to become ledger entries. Use
Settings -> Compare statement when you already have rows in the ledger and only
want to investigate a statement mismatch.

### Supported files

The app currently supports:

- CSV files or pasted CSV text
- supported PDF statements
- supported UOB bank and credit-card current-transaction `.xls` exports
- supported Citibank credit-card current-activity `.csv` exports, when the
  selected default account is a Citibank credit card
- supported OCBC card and 360 current-activity `.csv` exports, when the selected
  default account is an OCBC account

Supported PDF parsers include:

- UOB credit-card statements, including multi-card statements such as UOB One
  Card plus UOB Privi Miles
- UOB One savings statements
- Citibank credit-card statements, including known Citi Rewards and Citibank
  Miles layouts
- OCBC 365 credit-card statements with embedded text
- OCBC 360 account statements with embedded text

### Category matching during preview

The import preview uses editable merchant rules from Settings to categorize
future rows before commit. If a rule matches, it can correct the parser's first
guess. This is for repeated bank text such as `TADA`, `SHOPEE`,
`AMAZON`, `AMZON`, `JALAIRLINE`,
`SINGLIFE`, `GOLDENVILLAGE`, `JOSEPHPRINCE`, `GOPAY-GOJEK`, `AXSPTELTD`,
`KEPPEL ELECTRIC`, `M1LIMITED`, `INCOMEINSURANCE`, `INLAND REVENUE`, `IRAS`,
`SP DIGITAL`, `PRUDENTIAL`, `BTG REWARDS`, `DIN TAI FUNG`, `WATSONS`,
`EDITOR'S MARKET`, `NASI LEMAK`, `YOUTRIP`, `PLAYSTATION NETWORK`, `GIRO` plus
`HDB`, and card conversion-fee descriptions.
Transfer-looking card rows such as `TSFTO...6349` are treated as transfers, not
normal expenses.

Use Settings -> Category matching to add or adjust rules. Rules apply to future
previews and can override a parser guess; they do not rewrite older ledger rows
that you already reviewed and committed.

![Settings category matching keeps editable rules and pending suggestions together](/faq/features/thumbs/category-matching.png)

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

If a suggestion points to a pattern that already has a rule, accepting it
updates the existing rule and marks the suggestion accepted instead of creating a
duplicate.

Accepted suggestions apply to future import previews. They do not change older
entries automatically.

### If this is your first account setup

1. Create the account in Settings.
2. Enter the opening balance from just before your first trusted statement
   period.
3. Import the first statement or compare it against existing rows.
4. Review account mapping, ownership, categories, transfers, splits, exceptions,
   and the statement certification check.
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

Example: download a UOB `.xls` activity export or a Citi card activity
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
3. Rows that duplicate existing ledger entries should be skipped before commit.
   Exact and strong probable duplicates are skipped by default, while ambiguous
   near matches need a review decision.
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
6. If the statement preview skipped every row because the ledger already has
   them, commit the statement checkpoint by itself once the certification check
   matches.

This is why statement comparison exists. It lets you prove whether the
mid-cycle rows already satisfy the statement before you commit more rows.

### If a statement arrives later

When the statement is ready, do this before importing duplicate rows:

1. Check the statement period for that specific account.
2. Compare the statement against the committed ledger if rows were already
   imported mid-cycle.
3. Review missing rows, extra rows, direction mistakes, and duplicate-looking
   rows.
4. Import only rows that are truly missing, and leave duplicate preview rows
   marked as already covered before commit. Already-covered rows stay visible
   and can be included if the match was wrong.
5. Save the statement checkpoint once the ledger matches the statement balance.
   The certification check recalculates as rows are excluded or included,
   counting already-covered rows through the existing ledger instead of
   double-counting them.

Cutoffs and row-inclusion effects are per account. If one PDF contains two card
sections, each card gets its own checkpoint and only rows mapped to that card
change that card's certification check. A Citi Rewards cutoff should not be
reused for Citi Miles, and a UOB card statement cycle should not be reused for
UOB One savings.

## Example: growing mid-cycle exports before a two-card statement

This example uses a synthetic two-card UOB-style statement and growing
mid-cycle exports. It models the same workflow as a real credit-card statement
that contains two cards in one PDF.

The thumbnails below open the full screenshot in a new tab.

### Step 1: import the first two-card statement

The user uploads the first PDF statement, maps each detected card section to
its ledger account, and checks that both card balances match before committing.

![Jan two-card PDF mapped to two accounts with both statement checks matched](/faq/import-midcycle-two-card/thumbs/01-jan-two-card-pdf-mapped-and-matched.png)

### Step 2: save checkpoints when the statement has no new rows

If the same statement is reviewed after its rows are already in the ledger, the
preview skips every duplicate row. When both statement checks are green, the
action becomes "Save statement checkpoints" so the user can save the balance
evidence without adding duplicate ledger rows.

![Already imported two-card PDF skips all rows but can save matched statement checkpoints](/faq/import-midcycle-two-card/thumbs/02-jan-two-card-pdf-all-duplicates-save-checkpoints.png)

### Step 3: import the first mid-cycle export

The user imports a current-transaction export during the next statement period.
These are new rows, so they stay in the commit set.

![First mid-cycle export contains only new rows](/faq/import-midcycle-two-card/thumbs/03-midcycle-snapshot-1.png)

### Step 4: import a growing mid-cycle export

The next export starts from the same beginning date and includes rows already
imported earlier plus new rows. The preview skips the exact duplicates and keeps
only the new rows in the commit set.

![Second growing mid-cycle export skips old rows and keeps new rows](/faq/import-midcycle-two-card/thumbs/04-midcycle-snapshot-2.png)

### Step 5: import another growing export

The same rule applies as the export grows. Old rows are skipped, and only rows
that have not reached the ledger yet remain committable.

![Third growing mid-cycle export skips more old rows and keeps the remaining new rows](/faq/import-midcycle-two-card/thumbs/05-midcycle-snapshot-3.png)

### Step 6: review a final current-transaction export

If the final current-transaction export contains only rows that were already
committed from earlier mid-cycle imports, the preview marks all rows as already
covered. Those rows remain visible and can be included if the match decision is
wrong.

![Final current-transaction export has all rows skipped as already imported](/faq/import-midcycle-two-card/thumbs/06-final-csv-all-midcycle-duplicates.png)

### Step 7: import the next two-card statement

When the monthly PDF arrives, the user maps both card sections again. Rows
already imported from mid-cycle exports are promoted to statement-certified,
any statement-only rows remain in the commit set, and each card has its own
statement certification check. The user should see this as the app closing the
period, not as a duplicate cleanup exercise.

![Next two-card PDF certifies mid-cycle rows and keeps a statement-only row](/faq/import-midcycle-two-card/thumbs/07-feb-two-card-pdf-duplicates-plus-late-row-matched.png)

### Step 8: recover from a mistaken manual skip

If the user manually excludes a statement-only row, the affected card's
statement check fails while the other card stays matched. This proves row inclusion
decisions affect only their mapped account's checkpoint.

![Mistakenly skipped statement-only row makes only one card check fail](/faq/import-midcycle-two-card/thumbs/08-user-skipped-late-row-alpha-check-fails.png)

The user includes the row again from already-covered rows. The row returns to
the commit set and both statement checks return to matched.

![Restoring the skipped row makes both statement checks matched again](/faq/import-midcycle-two-card/thumbs/09-user-restored-late-row-both-checks-match.png)

### Step 9: commit and keep the import history

After the statement checks match, the user commits the statement. Recent imports
show the earlier mid-cycle batches and the final statement batch, while the
certified rows keep their user annotations. Mid-cycle batches remain ordinary
working imports; completed PDF statement imports are protected because they may
have certified existing ledger rows.

![Recent imports show the mid-cycle batches and final statement batch](/faq/import-midcycle-two-card/thumbs/10-recent-imports-after-combined-flow.png)

## How do I close a reconciled statement period?

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
3. When the statement arrives, import or compare it against the committed
   ledger.
4. Let the statement certify matching provisional mid-cycle rows; add only rows
   that were truly missing from the working ledger.
5. Save the new checkpoint when the balance and account identity checks match.

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
2. Leave any preview rows that duplicate closed Month 1 rows marked as already
   covered.
3. Commit only new bank rows.
4. Add or link splits for shared spending during the month.
5. When the Month 2 statement arrives, compare it against the ledger.
6. Add only missing statement rows, fix direction mistakes, and let the
   statement certify matched provisional rows.
7. Save the Month 2 checkpoint once the statement balance matches.

The user goal is not to import every file blindly. The goal is to have one bank
ledger row per real bank transaction, with splits linked to those rows where
household sharing matters.

### What you review before commit

Before committing, check:

- account mapping
- duplicate or already-covered rows
- prior import context
- rows that still need a review decision
- row date, description, amount, and type
- category and ownership
- transfer direction
- statement checkpoint fields for supported PDFs
- statement certification check for supported PDFs

Successful commits reset the import composer. Use Start over anytime to clear
the current draft without refreshing the page.

### Notes on supported statement parsers

- CSV can use one signed `amount` column or separate `expense` and `income`
  columns.
- UOB credit-card PDFs use post date as the ledger date and keep transaction
  date in the row note.
- UOB One savings PDFs use the statement period and running balances to validate
  withdrawal/deposit direction.
- UOB current-transaction `.xls` files are old Excel binary workbooks. The
  parser recognizes both bank-account exports and credit-card exports when the
  UOB header row is present.
- Citibank card PDFs use layout-aware parsing for compact card-section rows.
- Citibank current-activity CSV files are headerless, so the app only applies
  the Citi activity parser when the selected default account is a Citibank
  credit card and the file name matches the Citi activity export pattern. The
  trailing card number is reduced to the last four digits in the note.
- OCBC card and 360 current-activity CSV files use transaction-history headers
  with withdrawal and deposit columns, so the app normalizes them into
  reviewable rows without creating a statement checkpoint.
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
