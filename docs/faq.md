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

## Can I recover a deleted split?

Yes. Open **Activity history** from the splits page. Deleted expenses and
settlements are archived, not physically removed, and can be restored with the
same record ID, shares, group, currency, and ledger link. Restoring does not
rewrite an existing settlement checkpoint.
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

## Can I hide totals before opening the app around other people?

Yes. Totals are hidden by default in a new browser. Summary, Month, Entries,
and Splits replace roll-ups, balances, chart totals, plan totals, and settlement
amounts with `••••`, while individual transaction and split-activity amounts
remain readable.

Use the eye button in the top toolbar to reveal or hide totals everywhere at
once. The choice is stored only in that browser, so a different browser or a
cleared browser profile starts hidden again. Financial Insight stays hidden
while totals are hidden because its text can otherwise reveal the same figures.

## Can I stay signed in for a week?

Yes, when the production app is protected with Cloudflare Access. This is an
Access setting, not an app setting: set the Monie's Map application's session
duration to `7 days`, then ensure every Access policy that can match the app
uses the same duration or inherits the application duration. A shorter matching
policy wins, so check that no one-time-PIN, device, or identity policy overrides
it with a shorter session.

Use a week only on a personal, locked device. Shorten the Access session again
for shared devices or if the sign-in context should expire sooner.

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

## What should I do when a statement does not close?

Use this order:

1. Open the red `Already in ledger during this period` section first.
2. Check whether each row belongs to the right card, date, and amount.
3. If a row is wrong, delete it, remap it, or change its posted date, then
   refresh the statement check.

If that red section adds up to the full difference, that is usually the cause.
It often means a prior mid-cycle import, a wrong-card posting, or a duplicate
row is already in the ledger for that statement window.

## What can I still edit on a statement-certified row?

Statement-certified rows keep the bank facts from the saved statement. That
means the date, description, wallet, amount, entry type, and transfer
direction are treated as locked once the statement has certified them.

You can still add context on the row itself:

- note
- category
- owner
- splits

That split is intentional. Use the note field for extra explanation, receipts,
or cleanup notes, and use a replacement statement or adjustment only when the
bank facts themselves were wrong.

## What if the app stays on Loading?

The app loads in three small stages: first the shared dashboard shell, then
lightweight account/category reference data, then the active page payload such
as Imports, Entries, or Summary. If any request stalls, the loading panel stops
waiting after the request timeout and shows which request failed, with a retry
button.

Cloudflare Access can also show browser-console warnings for `/site.webmanifest`
when the manifest request is redirected to the Access login page. That warning
affects the installable web-app manifest only. It is not the same as the
dashboard shell or page API failing to load.

If the retry keeps failing, check Settings → Error diagnostics for saved server
responses from import previews, then check the browser Network panel for the
specific `/api/app-shell`, `/api/reference-data`, `/api/*-page`, or
`/api/summary-*` request that timed out or returned an HTML error page.

If the visible failure says `/api/app-shell` returned a Cloudflare 503 because
the Worker exceeded CPU or resource limits, the request was stopped before the
app could return JSON. `/api/app-shell` is now route-neutral and should not load
accounts, categories, page payloads, balances, checkpoint history, or import
history. If it still fails, check Cloudflare Workers observability for the
failing timestamp and confirm whether shell identity data or schema/seed startup
work is the remaining cost. There is no separate app restart button for this
class of failure; redeploying creates a new Worker version but does not fix an
endpoint that is consistently too expensive. The durable fix is to keep broad
reads split into route-specific payloads or move the Worker to a plan with more
CPU/resource headroom if the production data size now requires it.

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

The production endpoint is:

- `POST https://monies-map-shortcuts.timsantos-accts.workers.dev/api/shortcuts/entries/create`

Use the connection copied by Settings rather than typing this URL. Local and
test environments can still use the relative `/api/shortcuts/entries/create`
route.

It is separate from the existing quick-entry URL, which still only opens the
Entries composer. The shortcut endpoint actually creates the ledger row and
returns:

- `entryId`
- `created` (`false` when a retry returns the already-created row)
- normalized `date`, `description`, `amountMinor`, and `currency`
- `accountId`, `accountName`, and `accountResolution`
- `openUrl`

`openUrl` deep-links back into Entries with the created row already opened in
the editor. It now opens `/entries` directly with the created row plus the
month, view, and wallet context already in the URL, so the shortcut avoids a
separate lookup redirect before the normal Entries page can render.

### Security model for the shortcut endpoint

The verified shared shortcut is public, but it contains no API key and no
household-specific connection URL. During installation, Apple asks for the
private connection URL that Monies Map copied. That URL contains a token and
must be treated like a password.

The main app remains behind Cloudflare Access. A separate public Worker accepts
only the direct-create path, has no app assets, and returns `404` for every
other route. The app-owned token is therefore the authentication boundary for
shortcut requests, while Settings, imports, entries, and the rest of the app
still require Cloudflare Access.

The endpoint accepts the token in one of three places:

- the verified install flow uses the `shortcut_token` query parameter in the
  private connection URL
- advanced clients can use the `X-Monies-Shortcut-Token` header
- advanced clients can use a Bearer `Authorization` header

Advanced clients may also send `X-Monies-Shortcut-Nonce` and
`X-Monies-Shortcut-Timestamp`. They must send both or neither. When both are
present, the server rejects expired requests and replayed nonces. The verified
Apple shortcut uses token-only authentication because Apple setup questions can
configure one URL reliably without exposing blank header rows to the user.

HTTPS protects the connection in transit, but a token embedded in a URL may be
visible in the installed shortcut and infrastructure request logs. Do not share
screenshots or exports that show it. Generate a new key and reinstall the
shortcut if it is exposed. Because one household key can be used by multiple
devices, rotate and update every installed household shortcut together.

### How do I configure the server secret?

Open Settings -> Apple Pay shortcut. The normal install flow generates a key
when needed, saves it, and copies the private connection URL automatically.
There are no header or JSON key names to type.

Choose the default account priority used when Wallet does not identify the
account. Moving an account saves the new order immediately and shows a status
message. API key and default-param edits under Advanced API settings still use
Save shortcut settings.

The app-managed key is stored in app settings and takes priority over the
Cloudflare environment token. Existing deployments can still use a Cloudflare
Worker secret named:

- `SHORTCUT_INGEST_TOKEN`

Example fallback setup:

```bash
npx wrangler secret put SHORTCUT_INGEST_TOKEN --config wrangler.shortcuts.jsonc
```

Use a long random value. Saving a key in Settings lets you rotate the Shortcut
key without logging in to Cloudflare.

Before using this in production, also apply the database migration so replay
protection and app-managed shortcut settings storage exist:

```bash
npm run db:migrate:remote
```

### What body should the shortcut send?

Send JSON.

Required fields:

- `date`
- `description` or `merchant`
- either `amountMinor` or `amount`

`accountId` or `accountName` is optional. An explicit account must identify an
active account. Without one, an exact, unique Wallet `name` match selects that
active account; otherwise the API uses the first active account in Settings ->
Apple Pay shortcut -> Default account priority. `accountResolution` in the
response reports `explicit`, `wallet_name`, or `priority`, so the Shortcut can
show what happened instead of silently guessing.

The endpoint also applies Settings -> Apple Pay shortcut -> Advanced API
settings -> Default shortcut params before the JSON body, so values sent by the
shortcut always win.

If `ownerName` is omitted, a direct entry uses the selected account's owner.
Shared-expense allocation is managed by linking the saved ledger row to a split
expense.

Common payload:

```json
{
  "date": "2026-04-25",
  "description": "Bus fare",
  "amount": "SGD 4.20",
  "accountName": "UOB One",
  "requestId": "apple-pay-20260822190730123",
  "clientVersion": "apple-pay-api-2026-08-22-v3",
  "categoryName": "Transport",
  "ownershipType": "direct",
  "ownerName": "Tim",
  "entryType": "expense",
  "note": "Created from Shortcut"
}
```

`amount` can be a positive decimal number or Wallet-style text such as `SGD
12.34` or `S$1,234.56`. The API preserves cents and rejects ambiguous decimal
or thousands separators and ambiguous bare currency symbols. If the amount
names a currency, it must match the selected account. `amountMinor` also works
if the caller already uses integer cents; when both forms are sent, they must
agree.

Dates should use `YYYY-MM-DD`. Strict ISO timestamps and legacy day-first dates
such as `27/04/2026` remain accepted, but malformed ISO-looking text is rejected.
Descriptions are normalized and limited to 500 characters; notes are limited to
2,000. Rejected requests save nothing.

### Which shortcut payload fields are optional, and what are their defaults?

The shortcut endpoint accepts these optional fields:

- `accountId`
- `accountName`
- `merchant`
- `name`
- `currency`
- `categoryName`
- `entryType`
- `transferDirection`
- `ownershipType`
- `ownerName`
- `offsetsCategory`
- `note`
- `requestId`
- `clientVersion`
- `view`

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
  - optional
  - defaults to the selected account's owner for direct entries
- `note`
  - optional
  - defaults to empty / no note
- `requestId`
  - optional for custom clients
  - sent by the verified Shortcut so a network retry returns the same entry
    instead of inserting a duplicate
  - supported only for direct ownership entries; shared-expense state has a
    separate split lifecycle
- `name`
  - optional Wallet card context
  - an exact active-account match selects that account; otherwise it can serve
    as the description fallback when `description` and `merchant` are empty

Fields with no server default:

- `date`
- `description` or `merchant`
- `amountMinor` or `amount`

If any of those are missing after Settings defaults are applied, the shortcut
request is rejected.

### How do I install the Apple Shortcut?

1. Open Settings -> Apple Pay shortcut.
2. Put the card used most often first under Default account priority.
3. Select Install Apple Shortcut. Monies Map saves the connection, copies it,
   and opens the repository-owned Apple-signed shortcut file.
4. Select Add Shortcut. If this device already has `Monies Map Apple Pay API`,
   choose Replace.
5. When Apple shows the plain-text setup field for the Monies Map connection
   URL, paste the copied value. The full URL should remain visible after the
   paste.
6. On the iPhone, open the existing When I tap Wallet Transaction automation.
   Choose Run Immediately when that option is available. If no such automation
   exists yet, create one first.
7. In that automation, create a Dictionary with `value`, `merchant`, and `name`
   populated from the Wallet transaction. If the existing automation already
   creates this dictionary, leave it unchanged.
8. In the automation's final Run Shortcut action, replace
   `Register Apple Pay Transaction` with `Monies Map Apple Pay API`, and pass
   that Dictionary as the shortcut input.

The installed shortcut's first action must read from the named `Shortcut Input`
variable. If Apple displays the source as the generic `Input`, open that action,
tap its input, and select `Shortcut Input` explicitly. This is separate from the
Wallet Dictionary's `value` field.

This is one automation calling one shared shortcut. The older
`Register Apple Pay transaction` shortcut is not an additional required step;
once the new flow saves a test transaction successfully, remove or disable the
old shortcut target so one Wallet tap cannot create two ledger entries.

The shortcut sends Wallet amount, merchant, card `name`, ISO date, a client
version, and a per-run request ID directly to Monies Map. On success it shows
`Saved <merchant> • <amount> • <account>`, reads `openUrl` from the response,
and opens the saved entry for optional edits. The request ID makes an HTTP retry
idempotent. The private connection URL is the POST destination stored during
setup; it is not included in the JSON body.

When the shortcut does not send an explicit category, the server applies the
same active category-match rules used by imports. A matching rule can therefore
classify a merchant such as `SUBWAY` before the entry is saved; if no rule
matches, the entry uses `Other` and can be corrected in the editor.

Apple personal automations are device-local and cannot be packaged inside the
downloaded shortcut, so the Transaction automation remains the one required
manual step on each iPhone.

### Is the downloaded shortcut tied to the owner's Mac, iPhone, or iCloud?

No. There are three separate artifacts with different jobs:

- The repository contains the reviewable secret-free plist source.
- The app serves a checksum-verified Apple-signed file that anyone can import.
- Installation creates a local copy in that device's Shortcuts library.

The project owner may keep `Monies Map Apple Pay API Source` in a personal
Shortcuts library as an editing convenience, but the app does not read it and
it is not needed for installation. Losing or changing that personal copy does
not lose the source or release.

The older iCloud link is a superseded v1 snapshot and is not used by Settings.
The current signed file is replaced only by a reviewed repository release and
deployment. Existing installed copies do not update automatically; local edits,
renames, replacement, or deletion affect only that device.

### What should I choose when Apple says the shortcut already exists?

Choose `Replace` when upgrading the installed `Monies Map Apple Pay API`.
Replacement changes only the local copy on that device. It does not overwrite
the repository release, the owner's source, or another person's shortcut.

Choose `Keep Both` only when intentionally preserving the old local copy as a
backup. A normal installation should keep one active shortcut with the exact
name `Monies Map Apple Pay API`, because that is the shortcut selected by the
Wallet automation.

A first-time user, including another household member, sees `Add Shortcut`
instead. Every iPhone installs its own copy, pastes the private connection, and
configures its own device-local Wallet automation. If the household key is
rotated, every device using that key must install or configure the new private
connection.

### How is a new shortcut version released?

Start from the committed plist source, keep its setup Text action blank, and
confirm no private connection or token is present. After testing, sign the
unsigned `.shortcut` with Apple's `shortcuts sign --mode anyone` command. Apple
receives it for validation during signing.

Commit the readable source, exact signed release, byte-identical public download,
size, action contract, and checksums under `shortcuts/apple-pay-api/`. Update the
Settings install contract, browser test, FAQ, and manifest in the same release.
Deploying changes the file offered to future installations; existing devices
keep their local copy until the user installs the new version and chooses
Replace.

### What does the installed direct-create shortcut contain?

The verified shortcut has no empty key rows and no embedded account secret. Its
setup question targets a plain Text action, whose output supplies the URL for
one POST `Get Contents of URL` action. This avoids Apple's multi-item URL editor,
which can clear a complete connection URL pasted during shortcut installation.
The POST has a JSON body with exactly these keys:

- `amount`
- `description`
- `date`
- `name`
- `requestId`
- `clientVersion`

After the POST succeeds, the shortcut extracts `openUrl` and `accountName`,
opens the URL, and shows a notification containing the Wallet merchant, amount,
and resolved account. If no `openUrl` is returned, it reads `error` and shows a
not-saved notification instead of calling Open URLs with a blank value.

Account, category, ownership, and owner are resolved from the Settings defaults.
Advanced custom shortcuts can add any optional API fields documented above.

Expected response shape:

```json
{
  "ok": true,
  "entryId": "txn-...",
  "created": true,
  "date": "2026-04-25",
  "description": "Bus fare",
  "amountMinor": 420,
  "currency": "SGD",
  "accountId": "acct-uob-one",
  "accountName": "UOB One",
  "accountResolution": "wallet_name",
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

The Import Inbox at the top of Imports plans the bank run for you. It groups
needed files by bank login session, shows the statements or activity exports to
collect, links to the bank portal where configured, and keeps split cleanup as a
separate after-import lane. You do not need to rename files.

Dropping one file keeps the normal immediate preview flow. Dropping multiple
files reads them in the browser and adds them to a temporary intake queue so you
can load one file at a time into review. The app does not persist original PDFs,
CSVs, XLS files, OCR images, or raw bank files. HSBC image-only PDFs still use
private browser OCR before entering the normal statement preview.

Before preview or commit, the server also checks parsed descriptions for
statement-layout contamination. If a row description is unusually long or
contains bank disclosure/page-header text, the import is blocked before the row
can enter the ledger. That failure usually means the parser or OCR merged a
statement footer into a transaction line; re-upload only after the parser
mapping is fixed or the bank export is clean.

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
- OCBC 365 and OCBC Infinity Cashback credit-card statements with embedded text
- OCBC 360 account statements with embedded text
- OCBC Child Development Acc (CDA) statements with embedded text
- HSBC Visa Revolution image-based statements through private in-browser OCR

### How do I import an image-only HSBC PDF?

Drag the HSBC Visa Revolution PDF onto Imports the same way as the other
supported bank statements. If the PDF has no embedded text, the app detects that
and runs private OCR in your browser. No additional command is required.

The import then continues through the normal statement preview: account mapping,
row review, statement checkpoint, duplicate checks, reconciliation, and commit.
Review the parsed rows against the original PDF before saving, because OCR can
still misread bank text.

The fallback helper still exists for troubleshooting unsupported browsers or
very slow devices:

```bash
PATH=/Users/tim/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH ./node_modules/.bin/tsx scripts/hsbc-pdf-to-import.mjs /path/to/HSBC.pdf
```

It writes a `.hsbc-ocr.tsv` package that can be uploaded in Imports. The PDF and
rendered page images stay local, and the helper deletes temporary OCR images.

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

The category matching settings also surface active duplicate and overlapping
rules before pending suggestions. Same-category overlaps help you spot broad
and specific rules that may both match a merchant. Different-category overlaps
are shown as conflicts because either rule could win depending on priority. Use
the edit shortcut beside each surfaced rule to tighten the merchant text,
change category, update priority or status, or delete the redundant rule.

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

Suggestions are only shown when they still need review. If an active rule in
the same category already covers the suggested merchant text or one of its saved
sample descriptions, the suggestion is filtered out of Settings.

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

When a linked entry and split already exist, changing the note on either side
opens a confirmation dialog before save. The dialog shows the note you are
saving and the connected record's current note, then lets you save only the
record you edited or update both notes together.

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

### How do I settle split groups without making an internal transfer?

In a person view, choose `Simplify settlement`. The app creates a settlement
checkpoint for the currently open split activity and removes those rows from
the open balance. If the groups already offset each other, it records an
internal offset and no bank transfer is needed. Otherwise, select the matching
ledger transfer in the checkpoint and choose `Match transfer`.

If the people have already paid each other but the transfer has not appeared in
the ledger, choose `Mark paid`. The active settlement collapses into `Settled,
awaiting bank match`, so it stops competing with current work but remains
available for later proof. Open that section when the bank transfer appears,
select the transfer for the relevant month, and choose `Match transfer`.
The collapsed follow-up section retains paid settlements in every currency, so
switching split groups cannot hide a repayment that still needs bank proof.
`Mark paid` never creates or certifies a ledger entry. Choose `Undo paid` if
the confirmation was premature; use `Undo simplification` only when the
included split activity itself must return to the open balance.

## Can I keep Financial insight brief?

Yes. Every Financial insight starts as a two-line preview with an ellipsis.
The preview also calls out one computed pattern from the visible records, such
as a concentrated category, the largest expense, or a repeated merchant. The
wording can differ when the visible facts differ, but it never invents a
transaction or changes the app's calculations.
Choose `Read full insight` to reveal the complete narrative, consequence map,
and links to the specific records worth reviewing. It returns to the concise
preview when the page or filters change, and expanding it never makes another
AI request.

New split activity added after the checkpoint remains open, even when its date
falls inside the earlier activity range. Use `Reopen settlement` to release a
checkpoint's rows if the settlement was premature; the checkpoint remains in
history and a later checkpoint can include the released rows.

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
- `note`

`account` or `account_id` is optional. If neither is sent, the app uses the
first active account in Settings -> Apple Pay shortcut -> Default account
priority. The quick-entry URL also applies the Default shortcut params under
Advanced API settings first, then lets explicit URL parameters override them.

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
   Unique exact matches are already handled by the preview: the import promotes
   the existing manual provisional row instead of asking you to exclude it.
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

### How should I handle a large unresolved transfer count?

Use Settings -> Unresolved transfers as a review queue, not as a single global
to-do list. The section groups transfer reviews by transaction month and pages
inside the selected month, so a backlog of hundreds can be worked one statement
period at a time.

If the section warns that transfer descriptions were shortened for review, those
are older stored rows with unusually long bank text. The full original bank file
is not stored by the app; the warning only means the displayed ledger
description was bounded for review. Future imports now block this kind of
description before commit.

### If you import UOB `.xls` or Citi `.csv` after adding manual splits

Import the activity file normally, but review duplicates and split matches before
commit.

If `Preview import` or `Commit import to ledger` fails after a file was parsed
and mapped, the import card should show the server's own error when it returned
JSON. If the failure came from Cloudflare returning an HTML error page instead
of app JSON, the card shows a short diagnosis with an **Open error diagnostics**
link. That settings section keeps the previous action, the action that just
failed, route/status, possible reason, bounded request context, and the saved
response body. A `Worker exceeded resource limits` response means Cloudflare
ended the Worker request before the app could finish the preview or commit. It
can be triggered by a large or expensive import, repeated heavy imports close
together, CPU pressure, memory pressure, or a matching path that needs to be
made cheaper; it is not by itself proof that the import data was duplicated or
changed. If retrying once does not work, open the linked diagnostics record and
use the saved action context and response body to decide whether to split the
import, wait and retry, or optimize the backend path.

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

If a mid-cycle row and the final PDF use different dates for the same bank
event, the final PDF owns the bank date lanes. When the PDF carries both a
transaction or event date and a posted date, certification sets
`transaction_date` from the PDF event date and `post_date` from the PDF posted
date. Entries stays event-first; statement checks and checkpoints use the
posted statement date.

For bank and deposit accounts, mid-cycle CSV exports can also have two dates.
OCBC 360, for example, uses `Transaction date` and `Value date`. The value date
is the date that belongs to statement balance reconciliation, so the app imports
that as the bank-facing date and keeps the transaction date as event context. A
May 31 transfer with a June 2 value date should therefore not make the May
statement go out of balance.

Older OCBC 360 activity rows may show the value date only in the note, for
example `value date: 2026-06-02`. On startup the app repairs those rows by
putting that value into the posted-date lane when the row did not already have a
separate posted date, so statement checks use the bank-cleared date.

If the official PDF row only has one printed date, the app treats that date as
the bank's full evidence for the event. Certification updates both
`transaction_date` and `post_date` to that statement date.

Sometimes a mid-cycle export contains a provisional row that the final PDF does
not include. The PDF can supersede that provisional row only when the statement
check proves it exactly: the row must be import-provisional, inside the
statement period, for the same account, not matched by any statement row, and
its signed amount must uniquely explain the statement difference. Manual rows
and already statement-certified rows are not removed by this path.

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

When the statement certification check does not match, the import preview shows
a plain-language balance breakdown for each affected account. It separates the
prior ledger balance, existing ledger rows inside the statement period, included
PDF rows, matched rows that will certify existing ledger entries, skipped or
needs-review PDF rows, and any provisional rows the official statement can
supersede. If the PDF is mapped to the correct card account, treat the PDF as
the stronger bank record. Start by opening the listed ledger-only rows in
Entries from the provided row links; those links use the row's actual month,
entry id, and wallet filter so cross-month statement periods do not hide April
rows from a May statement.

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
the form pre-fills an opening balance from the statement. When a supported PDF
prints a previous or last-month balance, the app uses that value directly.
Otherwise, it calculates the opening balance from the statement ending balance
minus the statement's net activity, so the newly created account can reconcile
immediately. If that account mapping was wrong, rollbacking the PDF batch and
re-importing to the right account is the clean correction before newer
statements are added.

A checkpoint-only PDF can be rolled back too, as long as it is still the newest
statement certificate for that account. That removes the statement checkpoint
and reconciliation certificate metadata, without touching older ledger activity.

If the rolled-back PDF was the first statement for an otherwise blank account,
rollback returns the account to its blank state and a later statement may become
the new starting point. If earlier statement checkpoints already exist, rollback
creates a statement-chain gap. Later statements stay blocked until the missing
statement month is imported again.

A PDF statement may still be rolled back even when it certifies pre-existing
ledger rows, as long as it is still the newest statement certificate for that
account. In that case rollback restores the prior working rows and removes the
statement certificate metadata. Older PDF statements stay locked once a later
statement certificate exists for the same account.

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
month, but the final PDF statement gets the last word on bank-facing facts.
When a later non-statement bank source promotes a manual provisional row,
Entries keeps the row's main date on the original event date when the bank
source also carries a separate posted date. The bank-cleared date is stored in
`post_date`.

When a final PDF statement certifies a provisional row, the final statement
gets the last word on both bank date lanes. If the PDF has both a transaction
or event date and a posted date, `transaction_date` becomes the PDF event date
and `post_date` becomes the PDF posted date. If the PDF only has one row date,
certification updates both lanes to that statement date. Sorting, monthly
plans, and split views stay event-first; balance checkpoints and statement
comparison use `post_date`.

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

For statement mismatches, the detailed certification card is the first place to
look. It shows whether the difference is explained by an existing manual or
mid-cycle ledger row, a skipped statement row, a row direction problem, account
mapping, or a provisional import row that can be superseded by the official PDF.
If the card lists "ledger rows not automatically matched to this PDF", use the
row links to go to Entries in a new tab, or use the inline delete action only
after confirming the row is absent, duplicated, or on another account. This list
means the preview did not certify those ledger rows against unique PDF rows; it
does not prove the rows are absent from the PDF. Repeated same-merchant charges
can land here when the app cannot safely pair every copy. The diagnostic list
shows every row in the unresolved set, not a sample. The date shown on ledger
rows is the transaction date; PDF diagnostic rows show posted date and include
the event/transaction date when the parser found one. When the unresolved ledger
rows total the same amount as the unexplained difference, correcting those rows
should reconcile the statement as long as the PDF is mapped to the right
account. Check each opened row against the PDF for the same card and statement
period: if the PDF contains it, it should be matched or certified; if the PDF
does not contain it, remove it from that account; if it belongs to a different
card, remap it; if it came from a prior provisional import, roll back that
import.

For unresolved lists with multiple ledger rows, the card can show a confirmed
"Delete all" action. Treat it as a bulk version of the per-row delete, not as the
default fix. Use it only when the whole listed set is absent from this PDF,
duplicated elsewhere, or mapped to the wrong account. If the PDF contains those
charges, the right correction is to match/certify the rows or fix their date
lanes. UOB card matching ignores foreign-currency amount fragments in
descriptions, so rows such as `OPENAI OPENAI.COM US` can match PDF descriptions
such as
`OPENAI OPENAI.COM USD 5.58` when the amount, account, posted date, and event
date evidence line up.

When a statement already closes, matched PDF rows are audit context rather than
work for the user. The import preview collapses that list by default and shows
only the count and net statement movement; open it only if you want to inspect
which PDF rows will certify existing ledger rows while preserving user edits.

When a real ledger row is inside the transaction-date period but the PDF omits
it because the bank posted it after the statement cutoff, use `Set posted date`
if the bank app shows the exact posted date. Use `Defer` when you know the row is
legitimate but do not know the posted date yet. Defer assigns a provisional
posted date to the first day after the statement end so the current statement can
close without deleting the row. A later official PDF remains the stronger bank
record: if it uniquely matches the deferred row, certification replaces both the
transaction date and posted date with the official statement dates while keeping
the user's category, owner, split setup, and notes.

The five balance boxes in the statement certification card have hover/focus
help. Use them to see the exact statement start and end dates, what rows feed
each number, and why the number is part of the projected ledger balance.

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

Shared Entries rows are driven by a split-expense link.

Current model:

- an entry in `Entries` has a real ledger owner
- `Shared` in Entries means the row has a linked split expense
- `Shared` is not a third person, virtual household user, or ledger owner
- the split ratio lives on the split expense and its split expense shares
- deleting or unlinking the split expense removes the shared Entries cue without
  rewriting the ledger owner

So:

- `ledger owner` means the person attached to the bank/account-side row
- `split expense` means the row is being tracked in the separate shared-expense
  workspace
- `split-linked ledger entry` means an Entries row has a linked split expense

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

Each split expense keeps the exact per-person share amounts. For a 50/50 split
with an odd cent, the app stores exact cents instead of relying on a hidden
rounding rule from another app. The default share uses a deterministic balancing
remainder, and the expanded split editor shows an `Odd cent` control so you can
choose which person gets the extra cent when matching a Splitwise record. The
collapsed activity row stays compact; open the row to see or change the exact
shares.

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
owner or owning account as the payer and creates a linked split expense with a
default `50/50` split. The ledger row keeps its owner. The app opens a centered
split-group picker; nothing is saved until you choose a group, and you can
cancel the picker without creating a split expense.

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
start. This repo expects Node 22.12.0 or newer for local scripts, so run
`nvm use` from the repo root and restart `npm run dev`.

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
The routine production path is to use Node 22.12.0 or newer, then run
`npm run deploy:prod`. Use `npm run deploy:demo` for only the public demo, or
`npm run deploy:all` to build once and publish both Workers. If the app change
depends on a schema update, run the matching D1 migration before deploy.

If production is deployed but does not load, follow
[`docs/production-debugging-runbook.md`](production-debugging-runbook.md). Start
with Cloudflare Access and Worker logs before redeploying, because Access can
block a request before the Worker runs.

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
- Citibank activity CSV imports can use known filename suffixes such as
  `-rewards.csv` or `-miles.csv` as an extra card hint in the single-file flow,
  but the Import Inbox workflow does not require renaming downloaded files, and
  the single-file paste flow can auto-preview recognized Citi activity rows
  directly once the Citibank credit-card account is selected.
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
status guard runs. When the existing ledger row is already statement-certified
from a PDF and the incoming row is a later mid-cycle activity file, the
description/hash lane may use the same velocity date window. That lets a final
statement row posted on one date suppress a later activity export row for the
same bank event when the activity export shows the transaction date instead.

If a row is not an exact duplicate, the app then isolates one date lane for the
promotion and reconciliation step. If both rows have event date hints, it
compares event date to event date. Otherwise it compares posted date to posted
date. For card activity files, posted date remains the balance-control date
because card statements close by posted date; event date stays on the ledger row
for spending history and matching. A unique exact promotion should show as
`Matched to ledger`, not as a manual exclusion task. The match tiers are:

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

If the mismatch is exactly explained by provisional mid-cycle ledger rows that
are absent from the official PDF, the preview lists those rows as superseded by
the statement. Commit removes only those listed provisional rows while saving
the statement certification. If multiple possible row combinations could explain
the same difference, the app leaves the mismatch open for review instead of
guessing.

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

### What if the bank app shows a real transaction that is missing from the PDF?

Some card statements close by posted date. A transaction can happen before the
statement cutoff but post after it, so the bank app shows the row while the PDF
statement does not include it yet. Do not delete a legitimate row just because
the current PDF omits it.

In the import diagnostics, use:

1. **Set posted date** when the bank app shows the exact post date. This keeps
   the transaction date for spending history and uses the posted date for
   statement reconciliation.
2. **Defer to next statement** when the row is legitimate but you do not know the
   exact post date. The app sets a provisional posted date to the first day after
   the current statement end, moving the row out of this statement without
   deleting it. Replace it later with the exact posted date if you learn it.

You can also edit the posted date later from the Entries editor. Use that when
you have the bank evidence already and want the ledger row itself to carry the
correct cleared date.

Delete is only for rows that are absent, duplicated, or on the wrong
card/account after checking the PDF and bank app.

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
  Citi card PDFs currently expose one row date, so statement certification uses
  that date for both the ledger event date and posted date.
- Citibank current-activity CSV files are headerless. In the single-file flow,
  the app applies the Citi activity parser when the selected default account is
  a Citibank credit card and known Citi export clues are present, so a pasted
  Citi activity export can jump straight to preview without manual column
  mapping. Recognized filename suffixes can still provide an extra card hint,
  but they are no longer required. In the Import Inbox multi-file flow, the
  user does not need to rename files before dropping them. The trailing card
  number is reduced to the last four digits in the note.
- OCBC card and 360 current-activity CSV files use transaction-history headers
  with withdrawal and deposit columns, so the app can recognize them from
  either the filename or the OCBC account-details and transaction-history
  headers. OCBC 360 browser exports may include account preamble rows and
  compact headers such as `Withdrawals(SGD)` and `Deposits(SGD)`; those are
  parsed directly into reviewable rows without creating a statement checkpoint.
- OCBC 365 and OCBC Infinity Cashback card PDFs use the printed statement date,
  last-month balance, subtotal, and total amount due. Credits such as card
  payments and cash rebates are imported as income/transfer rows so the
  statement balance reconciles. If you create the card account from the import
  page, the opening balance is pre-filled from the printed last-month balance.
- OCBC 360 account PDFs use the monthly period, running balances, and balance
  carried forward.
- OCBC Child Development Acc (CDA) PDFs use the printed statement period,
  opening balance, and balance carried forward. If the statement has no activity,
  the import creates a statement checkpoint with zero rows so the account can
  still be certified.

For supported PDFs, the browser extracts statement text locally and turns it
into reviewable rows. If the PDF creates statement checkpoints, those fields are
editable before commit.

### What does the optional AI assistance do?

AI assistance is an optional review layer, not a finance engine. The app keeps
working normally when it is disabled, unavailable, or out of its daily
allowance. Ledger math, bank-parser output, category rules, duplicate checks,
transfer matching, statement reconciliation, and the Import Inbox remain the
source of truth.

You can ask it to draft a Monthly Note, phrase a statement mismatch in simpler
language, suggest category-rule drafts from existing categorized history, or
rank descriptions among candidates that the app has already constrained by
account, amount, and date. Summary, Month, Entries, and Splits also show a
Financial insight for the figures already on screen. It appears immediately
from the app's own calculations, then may improve its wording in the background
after a short pause. Changing a month, account, category, search, scope, or
split group creates a different insight; the app keeps same-view wording in a
short-lived in-memory cache so it does not keep calling AI while you work.
Its compact preview includes one deterministic pattern from the visible entries
before any optional AI wording returns.

Those insights are guidance, not a recalculation. A filtered Entries or Splits
view says so and should be used to investigate that subset, not as a full-month
budget total. The advice keeps accounting boundaries clear: compare provisional
entries to the bank before closing a month, do not treat split balances as new
spending, and review large budget variances before changing a plan. In a full
cash-flow view, it also distinguishes a recorded surplus from money that is
actually free to spend: future bills, transfers, and an intentional savings
transfer still need to be covered. Each insight includes one conservative
consideration for the next discretionary spend. It does not forecast, make an
unverified year-over-year claim, or decide a savings target on its own.

Summary and Month also show a **Money consequence map**. It makes the
calculation easier to inspect: recorded surplus, plan position, a same-season
comparison, bank-record confidence, and sometimes a one-repeat scenario. A
same-season comparison appears only when the matching calendar month is already
loaded in the selected summary range. The one-repeat card is not a prediction:
it simply shows the recorded cash-flow result if another expense equal to the
largest visible expense happens before other future commitments. When statement
or transfer evidence needs review, the map labels the snapshot as provisional
and links to Imports. Entries and Splits say when they cannot assess that
wallet-level confidence.

When the app has concrete evidence worth reviewing, the insight can include a
`Review` link. That link opens the already-existing filtered Entries or split
match workflow, such as the largest visible expense, an overspent category, or
unresolved bank matches. It is generated by the app from record IDs and current
filters; AI wording cannot choose or invent a record link.

The wording service receives placeholder names rather than the actual figures,
merchant names, account names, or ledger rows. The app inserts the
already-computed values only after validating the model's template. It cannot
import transactions, change a category, skip a row, certify a statement, or
link a transfer on its own. Use the normal review controls to accept any
suggestion.

For a PDF that no supported parser can read, Imports offers an explicit
checkbox to allow an AI fallback. The browser still tries the dedicated parser
and private in-browser OCR first, including HSBC image statements. Only the
locally extracted text is sent after you opt in; the original PDF is neither
uploaded as a file nor stored. Fallback rows always start as **Needs review**
and do not create a statement balance checkpoint automatically.

The app keeps only daily AI usage counters so it can stay within its configured
allowance. It does not save prompts, model answers, original PDFs, credentials,
Shortcut tokens, or full card/account numbers as an AI history.

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
# Splits and Travel

A group can be settled by itself. Use **Settle group** to record payment and
close only the selected group's current batch. This does not create a
simplified checkpoint and does not touch balances in other groups.

**Simplify settlement** is optional and only combines open groups that share
the same currency. JPY and SGD obligations remain separate unless each is
settled with its own evidence. A JPY settle-up can still be linked to an SGD
bank transfer after reviewing the derived FX rate.

## Can I record a foreign-currency trip?

Yes. Create the split group in the trip currency and keep each original amount
in that currency. Cash expenses can stay unlinked. For a card expense, mark it
as awaiting statement until the final certified ledger row arrives; matching a
different-currency settlement requires an explicit FX rate and keeps both
amounts visible.

For a simpler holiday workflow, create two groups in the trip currency: one
with purchase source `Cash only` and one with `Bank/card`. The cash group keeps
offline purchases out of ledger matching, while the Bank/card group is ready
for later statement links. Existing groups remain `Mixed`. This setting only
guards purchase records; a repayment for either group may still be cash or
bank transfer.

The app does not currently treat children, babies, or guests as separate
settlement people. Keep those labels in notes and shares until dependent
participant roles are introduced, so they cannot accidentally become debtors.
