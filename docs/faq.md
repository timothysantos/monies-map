# FAQ

This is a living FAQ for Monie's Map.
It should be updated whenever setup, workflow, scope, or user-facing behavior
changes.

## How should I read this FAQ?

Start with the product basics first: what the app is, what screens exist, and
how the monthly planning model works. Then read the import and statement
sections, because that is where the app's accounting rules become stricter.

If you are trying the app for the first time, this order is usually easiest:

1. Understand the basic workflow.
2. Create or import accounts.
3. Import working bank activity during the month.
4. Reconcile with PDF statements when the statement closes.
5. Use Settings to review balances, checkpoints, category rules, and unresolved
   transfers.

Deployment, Cloudflare, and production reset details are intentionally later in
this FAQ because they are operational details, not the first mental model.

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
- split expense editing can be driven either by split percentage or by an exact
  per-person dollar amount
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

## What is the basic workflow?

The everyday workflow is:

1. Use Month to set the plan for the period.
2. Use Imports or manual Entries to keep the ledger current.
3. Use Splits when a household expense needs sharing or settle-up tracking.
4. Use Summary to see whether income, spending, and savings moved as expected.
5. Use Settings to maintain accounts, checkpoints, category rules, and cleanup
   queues.

During the month, CSV, XLS, and current-activity imports are useful working
data. At statement close, the PDF statement is the stronger proof. It can
confirm rows, save a statement checkpoint, and explain whether the app balance
matches the bank.

## How should saves and refreshes feel during repeated editing?

The app is moving toward a more precise save model for row-heavy screens such as
Month and Entries.

The intended behavior is:

1. when you save a new or edited row, that row should appear updated
   immediately
2. if the save affects server-derived values such as `actual`, top-level
   totals, charts, or summary cards, only those derived values should show a
   lightweight pending state
3. add/edit forms should stay open, or reset into an `add another` draft when
   repeated entry is the expected workflow
4. related screens such as Summary or Month can refresh in the background
   without forcing a full page reset

In practice, that means the app should distinguish between:

- `saving` the row itself
- `updating` the server-derived values tied to that row
- `refreshing` other affected views in the background

The goal is to avoid shell-wide reloads for small edits while still making it
clear that totals, actuals, or charts are catching up to the newest saved data.

## Can an Apple Shortcut create an entry directly?

Yes, but it should use the dedicated shortcut endpoint, not the normal browser
entry API and not the quick-entry URL flow.

Use this method when the shortcut should create the row immediately and then
open the saved entry. Use the quick-entry URL method when you want a prefilled
draft that the user still reviews before saving.

The dedicated endpoint is:

- `POST /api/shortcuts/entries/create`

It is separate from the existing quick-entry URL, which still only opens the
Entries composer. The shortcut endpoint actually creates the ledger row and
returns:

- `entryId`
- `openUrl`

`openUrl` deep-links back into Entries with the created row already opened in
the editor. It now opens `/entries` directly with the created row plus the
month, view, and wallet context already in the URL, so the shortcut avoids a
separate lookup redirect before the normal Entries page can render.

### Security model for the shortcut endpoint

The shortcut endpoint is protected by:

- a shared secret in the `X-Monies-Shortcut-Token` header
- a one-time nonce in the `X-Monies-Shortcut-Nonce` header
- a recent timestamp in the `X-Monies-Shortcut-Timestamp` header

The server rejects missing or invalid tokens, expired requests, and replayed
nonces.

### How do I configure the server secret?

Set a Cloudflare Worker secret named:

- `SHORTCUT_INGEST_TOKEN`

Example:

```bash
wrangler secret put SHORTCUT_INGEST_TOKEN
```

Use a long random value. Do not put that value in URLs. Keep it only in the
Shortcut headers.

Before using this in production, also apply the database migration so replay
protection storage exists:

```bash
npm run db:migrate:remote
```

### What body should the shortcut send?

Send JSON.

Required fields:

- `date`
- `description`
- either `accountId` or `accountName`
- either `amountMinor` or `amount`

Important ownership rule:

- if you omit `ownershipType`, the API defaults it to `direct`
- `direct` entries require `ownerName`
- so in practice, either send both `ownershipType: "direct"` and `ownerName`,
  or send `ownershipType: "shared"` if the row should be shared

Common payload:

```json
{
  "date": "2026-04-25",
  "description": "Bus fare",
  "amount": "4.20",
  "accountName": "UOB One",
  "categoryName": "Transport",
  "ownershipType": "direct",
  "ownerName": "Tim",
  "entryType": "expense",
  "note": "Created from Shortcut"
}
```

`amount` can be decimal text or number. `amountMinor` also works if the
shortcut already uses cents.

### Which shortcut payload fields are optional, and what are their defaults?

The shortcut endpoint accepts these optional fields:

- `categoryName`
- `entryType`
- `transferDirection`
- `ownershipType`
- `ownerName`
- `note`
- `splitBasisPoints`

Defaults and behavior:

- `categoryName`
  - optional
  - defaults to `Other`
  - ignored for transfer entries, because transfer rows are forced to category
    `Transfer`
- `entryType`
  - optional
  - defaults to `expense`
- `transferDirection`
  - optional
  - only used when `entryType` is `transfer`
  - defaults to `out` for transfer entries
- `ownershipType`
  - optional
  - defaults to `direct`
- `ownerName`
  - optional only when `ownershipType` is `shared`
  - required when `ownershipType` is `direct`, including when you rely on the
    default `direct`
- `note`
  - optional
  - defaults to empty / no note
- `splitBasisPoints`
  - optional
  - only used when `ownershipType` is `shared`
  - defaults to `5000`, which means a 50/50 split between the two household
    people

Fields with no server default:

- `date`
- `description`
- `accountId` or `accountName`
- `amountMinor` or `amount`

If any of those are missing, the shortcut request is rejected.

### How do I build the Apple Shortcut?

Apple documents `Get Contents of URL` as the API action for Shortcuts and
`Open URLs` for opening returned links. See Apple Support:

- [Request your first API in Shortcuts on iPhone or iPad](https://support.apple.com/en-euro/guide/shortcuts/apd58d46713f/ios)
- [Intro to URL schemes in Shortcuts on iPhone or iPad](https://support.apple.com/en-au/guide/shortcuts/apd621a1ad7a/ios)

The practical action flow is:

1. `Current Date`
2. `Format Date` as ISO 8601
3. `Generate UUID`
4. `Dictionary` for the JSON body
5. `Text` for the endpoint URL:
   `https://monies-map.timsantos-accts.workers.dev/api/shortcuts/entries/create`
6. `Get Contents of URL`
   - Method: `POST`
   - Request Body: `JSON`
   - Headers:
     - `X-Monies-Shortcut-Token: <your secret>`
     - `X-Monies-Shortcut-Nonce: <UUID>`
     - `X-Monies-Shortcut-Timestamp: <formatted date>`
7. `Get Dictionary Value` for `openUrl`
8. `Open URLs`

If you want a safer review step, read the returned `entryId` and `openUrl`,
show a quick result card, then open the URL only when the API says `ok: true`.

### Step-by-step shortcut setup for the direct-create method

1. Create a Wallet transaction automation in Shortcuts.
2. Add `Current Date`.
3. Add `Format Date` and output ISO 8601 text.
4. Add `Generate UUID`.
5. Add `Dictionary` and set keys such as:
   - `date`
   - `description`
   - `amount`
   - `accountName`
   - `categoryName`
   - `ownershipType`
   - `ownerName`
   - `entryType`
   - `note`
6. Add `URL` with:
   `https://monies-map.timsantos-accts.workers.dev/api/shortcuts/entries/create`
7. Add `Get Contents of URL`:
   - method: `POST`
   - request body: `JSON`
   - body: the Dictionary from step 5
   - headers:
     - `X-Monies-Shortcut-Token`
     - `X-Monies-Shortcut-Nonce`
     - `X-Monies-Shortcut-Timestamp`
8. Add `Get Dictionary from Input` on the API response.
9. Add `Get Dictionary Value` with key `openUrl`.
10. Add `Open URLs`.

Expected response shape:

```json
{
  "ok": true,
  "entryId": "txn-...",
  "created": true,
  "openUrl": "https://monies-map.timsantos-accts.workers.dev/entries?editing_entry=txn-...&month=2026-04&view=household"
}
```

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

When a planned item has many possible ledger matches, the matching dialog does
not run a full ledger search first. It starts with lightweight narrowing:
`Linked`, `Same category`, `Same account`, `This month only`, and a description
contains filter over the ranked candidate list. This keeps the flow faster than
global search while still making long categories such as `Food & Drinks` easier
to narrow down.

On mobile, this planned-item matching flow uses the same bottom-sheet pattern as
the other month add and edit forms instead of a centered modal.

After a planned item is matched, the app remembers lightweight matching hints
from the linked ledger entries so future months can suggest likely matches. It
does not auto-link them yet; the user still confirms the matches.

Budget buckets can also be reduced by category-offsetting income, such as a
reimbursement, when that income row is explicitly marked as offsetting the same
category. Transfers still do not count toward budget-bucket actuals.

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

## How do I import real bank activity?

Use Imports when you want bank or card rows to become ledger entries. Use
Settings -> Accounts -> Reconcile to save a statement checkpoint. If that
checkpoint is mismatched, the account card and checkpoint history show
`Compare statement` so you can investigate the statement against rows already
in the ledger.

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

### Can Apple Pay open a prefilled expense?

Yes. iOS Shortcuts can use a Wallet transaction automation to open the Entries
page with a prefilled expense draft. The app does not save the row
automatically; it opens the draft so the user can review the merchant, amount,
account, category, and owner before tapping Save.

Use a URL like this:

```text
https://monies-map.timsantos-accts.workers.dev/entries?action=add-expense&amount=12.34&merchant=Starbucks&date=2026-04-22&account=UOB%20One&category=Food%20%26%20Drinks
```

Supported query parameters are:

- `action=add-expense`
- `amount`
- `merchant` or `description`
- `date`, preferably `YYYY-MM-DD`
- `account` or `account_id`
- `category`
- `owner`
- `shared=true`
- `note`

After the app reads the parameters, it removes them from the URL so refreshing
the page does not reopen the draft.

### Step-by-step shortcut setup for the quick-entry URL method

1. Create a Wallet transaction automation in Shortcuts.
2. Add `Receive transaction as input`.
3. Add `Text`.
4. Build a URL like:

```text
https://monies-map.timsantos-accts.workers.dev/entries?action=add-expense&amount=<Amount>&merchant=<Merchant>&date=<ISO date>&account=<Account name>&category=<Category>
```

5. Use the Wallet transaction variables inside that text:
   - `Amount`
   - `Merchant`
   - transaction date, formatted as `YYYY-MM-DD`
   - card or account name
6. Add `Open URLs`.
7. Save the automation with `Run Immediately` if you want it to trigger without
   an extra approval step.

What happens next:

1. The app opens Entries with a prefilled draft.
2. The draft is not saved yet.
3. The user reviews the fields and taps `Save`.
4. The query parameters are stripped from the URL after the draft is loaded so a
   normal refresh does not reopen it.

Quick-entry Apple Pay rows are provisional ledger entries. If a later bank
activity export or PDF statement contains the same transaction, import preview
compares against those manual rows by account, amount, nearby date, and merchant
similarity. CSV and XLS rows that duplicate a manual entry should be skipped.
Supported PDF statement rows can certify the matching manual entry in place,
preserving the category, owner, splits, and notes while replacing bank-facing
facts such as posted date and statement description.

### If you add manual entries before importing bank activity

Manual entries and Apple Pay quick entries are useful when you want the month to
stay current before the bank export is available. Treat them as provisional
claims about what happened, not as final bank evidence.

Expected workflow:

1. Enter enough bank-like detail for matching: account, amount, transaction date,
   and merchant. Use merchant names such as `Starbucks`, `Grab`, or `FairPrice`
   instead of personal descriptions such as `lunch`.
2. When a mid-cycle `.xls` or `.csv` arrives, import it normally. Rows that match
   manual entries should appear as exact, probable, or near ledger matches.
3. Keep genuinely new bank rows included. Leave exact and probable duplicates
   skipped unless the match is wrong. Review near matches before commit.
4. When the PDF statement arrives, import or compare it against the current
   ledger. Matching statement rows can certify existing manual or mid-cycle rows
   instead of adding duplicates.
5. After certification, the bank-facing facts come from the statement, while the
   user-maintained fields stay with the row: category, owner, split setup, and
   notes.

If the bank statement uses a very different merchant description, the row may
show as a near match or remain unmatched. In that case, compare account, amount,
and date before deciding whether to skip the import row, certify the manual row,
or keep both because they are genuinely different transactions.

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

## How should I treat PDF statements versus mid-cycle exports?

Supported PDF statements are the strongest import source in the app. Treat them
like a bank-sync checkpoint for the account and statement period: the statement
certifies posted date, description, amount, direction, and ending balance after
the parser has reconciled the statement structure.

In product terms, this whole matching workflow is `entry reconciliation`. In
accounting terms, it is the transaction-matching part of bank reconciliation.

Mid-cycle CSV or XLS exports and manual quick entries are still useful for
keeping the working ledger current, but they are provisional until the official
statement arrives. When a PDF statement row matches a provisional mid-cycle or
manual ledger row, the app promotes the existing row instead of creating a
duplicate. That preserves user-added category choices, notes, ownership, splits,
and links while updating the bank-facing facts from the statement.

If the same official statement row has already been imported or previously
certified, the app treats it as already certified rather than asking for another
duplicate decision. PDF statement imports that certify pre-existing ledger rows
are not rolled back like ordinary working imports; use a replacement statement
or an explicit adjustment if a correction is needed.

The statement certification check is necessary but not always sufficient. For a
mapped account with no prior ledger activity, statement checkpoint history, or
non-zero opening balance, the app also requires account identity confidence from
the detected statement account name. This prevents a first PDF import into a
zero-balance wrong account from passing just because the statement's own rows
and ending balance are internally consistent.

When a PDF statement closes successfully, the app stores a reconciliation
certificate for each account section. The certificate records row counts,
debit/credit totals, net movement, statement balance, projected ledger balance,
how many rows were imported, how many existing rows were certified, how many
were already covered, and whether any exception remained.

After a row is statement-certified inside a saved statement period, its bank
facts are locked. You can still edit user annotations such as category, note,
ownership, and splits, but changing date, description, account, amount, type, or
transfer direction requires a replacement statement or explicit adjustment.

## What if I import a PDF statement to the wrong account?

The app tries to prevent this before commit. A PDF statement must pass the
statement certification check, and first-time zero-balance accounts also need
account identity confidence from the detected statement account name. If the
selected account has no prior ledger activity, no statement checkpoint history,
and no opening balance, a wrong PDF can otherwise balance against its own rows,
so the app marks the result as identity unconfirmed instead of certified.

If a wrong PDF still gets committed, first check what it changed. If it only
created rows from that same statement, or only saved statement checkpoint or
certificate metadata, rollback can remove that batch so the account mapping can
be corrected and re-imported. If it certified pre-existing ledger rows, do not
treat it like an ordinary CSV rollback. The correction should be handled as a
replacement statement workflow or explicit adjustment so the audit trail remains
clear.

### What can be rolled back?

Ordinary CSV, XLS, and mid-cycle imports can be rolled back as working imports.
They are provisional working data until a statement confirms them.

A first PDF statement can also be rolled back when the ledger rows were created
by that same PDF import and no later statement exists for the same account. This
includes the case where the user creates a new account from the import page and
the form pre-fills an opening balance from the statement. The app calculates the
opening balance from the statement ending balance minus the statement's net
activity, so the newly created account can reconcile immediately. If that
account mapping was wrong, rollbacking the PDF batch and re-importing to the
right account is the clean correction before newer statements are added.

A checkpoint-only PDF can be rolled back too, as long as it is still the newest
statement certificate for that account. That removes the statement checkpoint
and reconciliation certificate metadata, without touching older ledger activity.

A PDF statement should not be rolled back once it certifies pre-existing ledger
rows, such as rows that came from a mid-cycle export. At that point the
statement has promoted existing working rows to bank-certified facts while
preserving user annotations. Corrections should use a replacement statement or
an explicit adjustment instead of silently unwinding that certification.

Older PDF statements should also not be rolled back after a later statement for
the same account has been saved. Rollbacks should move backward from the newest
statement, or use a replacement statement or explicit adjustment when the period
has already become part of a later certified sequence.

In Recent imports, this means a run of monthly PDF statements should not all
show the rollback action. For one account, only the newest rollbackable
statement should show rollback. Older statements should show `Statement locked`
because later statement certificates now depend on the account's certified
sequence. If every completed PDF statement for the same account shows rollback,
the UI and server protection logic are wrong.

Renaming an account is only the right fix when the account object represents the
correct real-world bank account and the label was wrong. It is not the right fix
for a statement that was mapped to a different account.

### Why does this need a special correction path?

The full replacement workflow is not automatically required on day one. It
becomes relevant because of the accounting controls the app applies:

- PDF statements are treated as high-authority evidence.
- PDF imports can certify existing mid-cycle rows.
- Certified bank facts are locked after a statement period closes.
- PDF imports are blocked from normal rollback after they certify pre-existing
  ledger rows, or after a later statement exists for the same account.
- Reconciliation certificates make the period auditable.

The accounting concept is that closed periods need traceable corrections, not
silent history rewrites. The replacement workflow is the app-specific way to
apply that concept when the evidence source was wrong.

The intended replacement workflow is:

1. Upload the correct PDF statement for the same account and statement period.
2. Compare its account identity, statement dates, row count, debit and credit
   totals, ending balance, and existing reconciliation certificate against the
   committed statement.
3. Preserve user annotations on rows that still match, such as categories,
   notes, ownership, splits, and links.
4. Re-certify matching rows from the replacement statement.
5. Mark wrong rows from the mistaken statement as explicit corrections,
   reversals, or adjustment exceptions rather than silently deleting them.

That full replacement UI is not implemented yet. Until it exists, the safer
manual path is to add a correcting statement or adjustment with a clear note, or
restore from backup if the mistaken PDF was committed to the wrong production
account and the correction would be too noisy.

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
statement. Manual quick-entry rows show as `Manual provisional`; mid-cycle CSV
and XLS exports show as `Import provisional`. They help with planning during the
month, but the final PDF statement gets the last word on posted bank facts.
When a later bank source promotes a manual provisional row, Entries switches the
row's main date stays on the original event date and the bank-cleared date is
stored in `post_date`. Sorting, monthly plans, and split views stay
event-first; balance checkpoints and statement comparison use `post_date`.

### Statement-certified row

A statement-certified row is a ledger row whose bank facts have been verified by
a supported PDF statement. The row may have been imported directly from the
statement, or it may be an existing mid-cycle row that the statement promoted in
place. These rows show as `Statement certified` in Entries.

### Statement checkpoint

A statement checkpoint is the official closing balance for one account and one
statement period. It is the control total: after applying the statement rows and
prior ledger baseline, the computed ledger balance should equal this number.

### Reconciliation certificate

A reconciliation certificate is the saved proof that a PDF statement section
closed. It stores control totals and exception counts so the app can later show
that the period was certified, not merely imported.

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

### Exception register

The exception register is the preview's short list of things that still require
attention. Normal matched statement rows should not appear as work for the user.
The register focuses on blockers such as account mapping, account identity,
statement mismatch, unknown categories, unresolved row decisions, and prior
import context.

Settings also has a persistent reconciliation exception list under Balance trust
rules. Use it when a known issue survives beyond one import preview: a missing
bank row, an extra manual ledger row, a likely duplicate, a direction mismatch,
a wrong account, a timing difference, or an adjustment that still needs proof.
Open exceptions mean the account balance is not fully certified yet, even if
the ledger is useful for daily planning. Resolve the exception only after the
bank statement, corrected import, or manual adjustment explains the gap.

### Visible row states

Entries shows the current proof level for each row:

- `Manual provisional` means the row came from a manual entry or Apple Pay
  quick-entry URL and still needs bank evidence.
- `Import provisional` means the row came from a CSV, XLS, or other working
  import but has not yet been certified by a final PDF statement.
- `Statement certified` means a supported PDF statement verified the row's bank
  facts.

These labels are not category or ownership states. They are evidence states.
User annotations can still be edited, but certified bank facts should be
changed only through a replacement statement or explicit adjustment workflow.

### Near match and probable match

Near and probable matches are duplicate-detection labels for non-statement
imports. For official PDF statements, the app tries to avoid turning these into
manual decisions: if a statement row matches a provisional mid-cycle row, it
promotes the existing row to statement-certified instead of asking the user to
resolve a duplicate.

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

That does not mean every shared ledger row must live in `Splits`.

Current model:

- an entry in `Entries` can have direct ownership or shared ownership
- `Shared` in the owner control is a real ledger ownership state
- `Shared` is not a third person or virtual household user
- a shared entry may have per-person `transaction splits`
- a shared entry may also remain only a shared ledger row, without a linked
  split-workspace record

So:

- `shared ledger entry` means the ledger row belongs to the household/shared
  bucket
- `split expense` means the row is also being tracked in the separate
  shared-expense workspace

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

Important current limitation:

- shared month-plan allocation still exists in storage and calculations
- but it is not currently an actively supported first-class user-controlled
  Month UI feature
- the combined Household month view is read-only
- users do not currently get a dedicated control to manage shared month-plan
  split ratios directly

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

Local development shows a thin sticky green `local` banner at the top of the
page so it is visually distinct from deployed environments.

If the app sits on `Loading...` and the browser console shows `/api/app-shell`
or one of the page routes returning `500` plus a JSON parse error, the usual
local cause is that Vite is still running while the Worker API failed to
start. This repo expects Node 22 for local scripts, so run `nvm use` from the
repo root and restart `npm run dev`.

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

The public demo deployment is:

[https://monies-map-demo.timsantos-accts.workers.dev](https://monies-map-demo.timsantos-accts.workers.dev)

It uses the separate Cloudflare D1 database `monies-map-demo` and intentionally
does not require Cloudflare Access. Without Access, the app has no authenticated
viewer email, so login-to-person linking is unavailable and users switch between
household/person views manually. Keep the demo database limited to fake data
because anyone with the URL can make changes. The demo app shows a thin sticky
blue `demo` banner at the top of the page.

## How do I deploy to production?

Use the Cloudflare deploy steps in
[`README.md`](../README.md#cloudflare-deploy).
The routine production path is to use Node 22, then run `npm run deploy:prod`.
Use `npm run deploy:demo` for only the public demo, or `npm run deploy:all` to
build once and publish both Workers. If the app change depends on a schema
update, run the matching D1 migration before deploy.

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
5. Use Settings -> Accounts -> Reconcile, then `Compare statement`, if the
   mismatch belongs to a specific saved statement checkpoint.
6. Open a reconciliation exception under Balance trust rules if the gap cannot
   be fixed immediately but should remain visible.

The comparison tool treats the PDF as evidence, not as a new import. It shows
which statement rows already match the ledger, which rows are missing, which
ledger rows are extra, and whether there are likely duplicates or direction
mistakes. Missing statement rows can be added from there, and direction mistakes
can be fixed inline without reuploading the PDF.

Reconciliation exceptions are the app's "do not forget this gap" workflow. They
do not change balances by themselves. They make a known issue visible until a
later import, statement comparison, replacement statement, or manual adjustment
resolves it.

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
- Statement PDF overlaps can be normal when mid-cycle exports or manual quick
  entries already placed rows in the ledger. The PDF statement can promote
  matching provisional rows to statement-certified, preserving user notes,
  categories, ownership, splits, and links instead of asking for duplicate
  decisions.
- Citibank activity CSV filenames that end in `-rewards.csv` or `-miles.csv`
  are treated as that card account even if another Citibank card is selected as
  the default account.
- If two accounts share a name, choose the owner-qualified account in the import
  mapping. Overlap checks use that selected account, not just the display name.
- Overlap warnings are date-range warnings; they do not remove rows by
  themselves.
- Marking an overlap as reviewed only hides the warning.
- Exact and near matches use amount, account, lane-specific date proximity, and
  description similarity.

Description similarity is token-based. The app lowercases descriptions, replaces
punctuation and symbols with spaces, then compares normalized words. It also
checks compact text with spaces removed, so bank text like `M1LTDRECURRING` can
still match a manual description like `M1 LTD RECURRING`.

Import duplicate matching now runs in two lanes. First, exact duplicate
suppression checks for the same mapped account, the same amount, and either the
same normalized import hash or a perfect normalized description match with
`dayDistance === 0`. Those rows are auto-skipped before any reconciliation
status guard runs.

If a row is not an exact duplicate, the app then isolates one date lane for the
promotion and reconciliation step. If both rows have event date hints, it
compares event date to event date. Otherwise it compares posted date to posted
date. The match tiers are:

- exact: same account, same absolute amount, `dayDistance === 0`, and
  description similarity `>= 0.8`
- probable: same absolute amount, `dayDistance <= 2`, and description
  similarity `>= 0.6`
- near: same absolute amount, `dayDistance <= 7`, and token similarity `>= 0.5`

Low-value rows below `500` minor units use the `Velocity Rule`: if the lane
distance is more than 2 days, the row is not treated as a duplicate candidate.

A normalized import hash is the strict fingerprint for one reviewed import row.
It is built from the normalized date, description, amount, mapped account, and
entry type. If all of those fields match an existing imported ledger row, the
app can suppress the incoming row as an exact duplicate immediately. If the
date is different, such as an April Netflix row compared with a January
Netflix row, it should not be the same normalized hash; at most it should be
evaluated by the looser reconciliation checks below.

Statement comparison is slightly more flexible because the statement is used as
evidence. A same-date statement row can match with description similarity of
`0.45`, while nearby-date matches within 3 days require `0.65`. The possible
matches list may also show candidates within 7 days or with similarity around
`0.5`, so the user can resolve posting-date or wording differences without
creating duplicate ledger rows.

Already-covered rows stay visible in the preview. You can include one if the
match decision was wrong, and statement checks refresh against the current
commit set. For supported PDF statements, already-covered rows should mostly
mean "already statement-certified" rather than "please inspect this duplicate."
Those already-certified rows still keep the same import-versus-ledger comparison
popover in the preview so a mismatch can be inspected without restoring the row
first.

If a statement mismatch is exactly resolved by including unresolved near-match
rows, probable duplicates, or other app-skipped duplicate rows for that account,
the preview treats those rows as statement-confirmed instead of duplicate
warnings. With the statement-certification model, matching provisional mid-cycle
rows are promoted in place: the statement owns the bank facts, while user
annotations stay attached to the existing transaction. Rows you explicitly
skipped stay skipped until you restore them.

Status guards only apply in that second lane. `statement_certified` ledger rows
cannot be chosen as reconciliation targets, and non-PDF mid-cycle imports
cannot reconcile against existing imported provisional rows. Exact duplicate
suppression still sees those rows so overlapping bank files can auto-skip
already-covered activity.

When a PDF statement has no new rows because every row was already imported from
mid-cycle activity files, the import action changes to "Save statement
checkpoints" once the statement checks are matched. That lets you save the
statement balance evidence without adding duplicate ledger rows.

## How do Entries filters and refresh work?

The Entries page keeps `Spend` as category expense only. It also shows
`Transfers`, which is the gross total of transfer-out rows, and `Outflow`,
which equals `Spend + Transfers`, so transfers are visible without being mixed
into category spending. In person views, the weighted amount still appears in
parentheses so you can see the share-adjusted value without losing the gross
ledger total.

In a person view, a collapsed shared entry row now shows the full ledger amount
first and the current viewer's weighted share in parentheses. The Entries total
strip follows the same rule for `Spend`, `Transfers`, and `Outflow`: it shows
the gross total first and the weighted visible amount in parentheses when
shared weighting changes that number for the current person view. When you
expand a shared row to edit it, the `Amount` field uses the full ledger amount
and the `Split %` field remains the basis for each person's share. You do not
need to reverse-calculate a half share or other weighted amount just to
correct the entry total.

The account filter on Entries lists every active account, even when an account
has no rows in the selected month. This keeps the filter predictable when you
are checking a specific account for missing or uncategorized activity. Account
choices include the owner in the label, such as "UOB One - Joyce", when the
same account name could appear under different people.

If you are on a person view and pick a wallet that belongs to the other person,
Entries now keeps the broad wallet filter but, when that combination has no
shared rows for the month, shows quick actions to switch to Household or the
wallet owner's view instead of leaving a confusing blank result.

![Entries filters include refresh, wallet, category, people, and type controls](/faq/features/thumbs/entries-filters.png)

Use the refresh button at the start of the Entries filter row to reload the
current month after importing or editing data in another tab.

## Why does switching views usually feel fast?

On Summary and Month, the Household, primary, and partner pills reuse the
matching views already loaded in the app shell when the month or summary range
has not changed. On Entries, the same pills reuse the loaded household month
rows and apply the person as a local filter. Switching between people should
feel like changing a filter, not like reloading the whole page.

On mobile Month and Entries, the sticky control above the bottom navigation now
collapses that context into a compact summary button, such as `Tim • Shared`,
with previous and next month buttons beside it. Tapping the summary opens a
bottom sheet where you can switch the household/person view first and then
adjust scope when that view supports multiple scope options.

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
certified rows keep their user annotations. The app also saves statement
certificates for both card sections, then locks certified bank facts for the
closed period. Mid-cycle batches remain ordinary working imports; completed PDF
statement imports are protected because they may have certified existing ledger
rows.

![Recent imports show the mid-cycle batches and final statement batch](/faq/import-midcycle-two-card/thumbs/10-recent-imports-after-combined-flow.png)

## How do I close a reconciled statement period?

### After statement reconciliation

When the checkpoint matches, treat that account and period as closed.

Good follow-up work:

1. Resolve transfer links.
2. Link any unmatched split expenses or settlements to their bank rows.
3. Clean categories and ownership.
4. Leave the import batch in history so it can be rolled back if it was wrong.

Avoid editing old reconciled bank facts unless you are fixing a known mistake.
For statement-certified rows in a saved period, the app blocks bank-fact edits
and asks for a replacement statement or adjustment instead. User annotations
remain editable because they do not change the bank evidence.

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

When a supported PDF statement contains an account that is not tracked yet, use
Create account in the statement account mapping section. The account form is
prefilled from the detected statement name, bank, account type, and a starting
balance derived from the statement balance and parsed rows so the new account
can reconcile after import.

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
  with withdrawal and deposit columns, so the app can recognize them from
  either the filename or the OCBC account-details and transaction-history
  headers, then normalize them into reviewable rows without creating a
  statement checkpoint.
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
