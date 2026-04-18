# Architecture Notes

This document is a living architecture reference for Monie's Map.
It should be updated as the app progresses so the documented product model,
technical boundaries, and implementation direction stay aligned with reality.

## Product shape

The app is a household planning and reporting system, not only a transaction
ledger and not only a budget tracker.

That distinction matters because the system needs to answer questions like:

- what did we actually spend this month?
- what did we intend to spend this month?
- which expenses were mine, hers, or shared?
- which account or card carried the charge?
- which months were outliers and why?
- how much of the planned savings really happened?
- which explanations are supported by the data and which are not?

## Documentation rule

- Keep this file updated alongside meaningful architecture or product changes.
- Keep [`AGENTS.md`](../AGENTS.md) aligned
  with implementation conventions and coding expectations.
- Keep [`docs/faq.md`](faq.md)
  updated as a living user-facing reference for setup, workflow, and feature scope.

## Primary workflows

### 1. Import

- user uploads a CSV export from a bank, card, or mixed-account source, a
  supported PDF statement, or a supported current-transaction workbook export
- system uses an institution-specific mapping profile when available
- PDF statement import is deterministic: the browser extracts text, statement
  parsers normalize rows into the same import shape as CSV, and unsupported
  layouts fail before preview instead of using generative inference
- statement import code is split by source family under `src/lib/statement-import/`:
  UOB, Citibank, OCBC, current-transaction XLS, and shared normalization helpers
- current-transaction imports are deterministic working-ledger imports: for
  example, UOB One `.xls` history exports, Citibank credit-card activity `.csv`
  exports, and OCBC card or 360 account activity `.csv` exports are parsed locally into
  reviewable rows but do not create statement checkpoints. Citibank activity CSV
  parsing is intentionally gated by the selected Citibank credit-card account
  because the files are headerless; OCBC activity parsing is gated by an OCBC
  account context or an OCBC activity filename.
- PDF statement parsers are institution-specific. UOB card and savings
  statements use their printed transaction blocks and balances; Citibank
  Rewards and Citi Miles card statements use browser-extracted layout text
  because their transaction rows are compact, preserve negative credit balances,
  and reconcile against card-section grand totals before preview; OCBC 365 card
  statements and OCBC 360 account statements use spaced layout text and running
  balances where available to determine row direction before preview.
- review step allows whole-file or per-row account attribution; when multiple
  accounts share a display name, import mapping and overlap checks use the
  selected account id so owner-specific accounts do not collide
- direct import-row ownership follows the mapped account owner when the account
  is personally owned; the composer-level default owner is a fallback for rows
  without a personally owned account mapping
- supported PDF statements can also produce editable statement checkpoints; the
  preview projects the post-import ledger balance against those checkpoints
  before commit, then saves them during commit for account reconciliation
- multi-card PDF statements produce one row set and one checkpoint per detected
  card account, so preview can require mapping each detected card to a ledger
  account before commit
- UOB and Citibank card PDF parsers detect card sections from statement
  structure first, while known product aliases only polish the displayed account
  names
- UOB card PDF parsing treats `CR` on card balance lines as a signed credit
  balance and accepts zero-dollar reward adjustment rows, so section
  reconciliation follows the bank's printed card convention
- transactions are normalized to a single ledger shape
- every imported row is attached to an import batch for audit and rollback
- CSV commits pre-resolve accounts, categories, and people before writing, then
  write D1 statements in chunks so larger production imports do not leave
  completed-looking partial batches
- `category_match_rules` are household-scoped reference data used during import
  preview. The backend matches merchant text such as `TADA`, `SHOPEE`,
  `SINGLIFE`, `KEPPEL ELECTRIC`, `INCOMEINSURANCE`, `INLAND REVENUE`, `IRAS`,
  `SP DIGITAL`, `PRUDENTIAL`, `BTG REWARDS`, `DIN TAI FUNG`, `WATSONS`,
  `EDITOR'S MARKET`, `NASI LEMAK`, `YOUTRIP`, `PLAYSTATION NETWORK`, `GIRO`
  plus `HDB`, or conversion-fee patterns to the configured category, and a
  matching rule wins over the parser's first category guess. The parser-side inference keeps a
  similar fallback for local PDF/CSV parsing, but database rules are the
  editable source of truth in Settings.
- repeated manual category corrections are stored as pending
  `category_match_rule_suggestions` instead of silently creating rules. Settings
  shows a badge when suggestions exist, deep-links to Category matching, and lets
  the user add, edit, or ignore each suggestion.
- duplicates are detected by date, amount, description, and statement id

### 2. Review

- app flags unknown merchants or categories
- app asks whether a transaction is direct, shared, or transfer-related
- shared transactions default to equal splits but support custom ratios such as
  `60/40`
- app allows notes for large or unusual items
- app supports edits after import without breaking import traceability

### 3. Reporting

- summary view shows month-by-month planned versus actual, savings targets,
  notes, and drill-downs
- monthly view shows income rows, planned items, budget buckets, notes, and linked entries
- entries view shows the raw rows for the selected month with filters and edit
  capability
- splits view shows named shared-expense groups, non-group shared expenses,
  settle-up records, and a dedicated matches queue without polluting CSV import
  review
- when Cloudflare Access provides an authenticated email, the app can link that
  login to one household person. Splits then opens on that person's view by
  default, while Household remains a read-only overview without person-specific
  "you owe" copy or inline split editing.
- person views support `Direct ownership`, `Shared`, and `Direct + Shared`
- household monthly view supports `Combined` and `Shared`
- account filter shows source account and institution

### 4. Analysis

- the app should support AI-friendly exports for summary and monthly views
- analysis must consider both ledger data and user-authored notes
- future in-app AI can support or challenge the user’s explanation for unusual
  months instead of only summarizing totals

### 5. Demo state

- the current prototype now stores its demo settings in D1
- the settings screen groups demo metadata such as current mode and reseed
  timestamp under a collapsible demo-state section
- the settings screen can reseed the believable default demo and reload the
  current bootstrap from D1
- reload is a typed-confirmation action because it refreshes the visible app
  state from the current database; it does not reseed, delete, or import data
- demo mode is saved after reseed or empty-state reset work succeeds, so failed
  backend resets do not leave the UI claiming a different mode than the data
- empty-state reset actions now verify the POST response and reload the bootstrap
  before the confirmation closes, so failed resets are visible instead of leaving
  stale account cards on screen
- a fresh database defaults to empty-state mode; bootstrap only ensures the
  household, people, and default category catalog exist, so account balances,
  entries, imports, checkpoints, month plans, snapshots, and split records stay
  blank until the user creates or imports them
- household member names are editable in Settings and propagate through person
  views, split labels, and ownership UI
- empty-state mode seeds neutral default member names so blank-state behavior
  does not fall back to placeholder labels
- even the empty-state mode keeps the default category catalog available so a
  fresh import still starts from the intended baseline taxonomy
- this is the first persistence step before full repositories for category edits,
  month planning edits, and entries edits

## Domain model principles

- `imports` are first-class and must support targeted rollback of a bad batch
- `transactions` are normalized ledger entries
- `monthly plans` are first-class and sit above transaction analytics
- `planned items` represent intentional or recurring commitments
- `budget buckets` represent flexible spending envelopes
- planned-item actuals are resolved through explicit links to ledger entries,
  while budget-bucket actuals stay category-driven
- `transaction_splits` allocate shared expenses between people
- `split_groups`, `split_expenses`, and `split_settlements` model the
  Splitwise-style layer separately from imported ledger rows
- `login_identities` links a Cloudflare Access email to a household person so
  authentication remains separate from household member records. Users can
  unregister that link without deleting or renaming the person.
- `transfers` are first-class linked entries, not fake income or expense rows
- split records can optionally link back to imported transactions later through
  `matches`, so CSV import stays focused on ledger cleanup while shared-expense
  review happens in the splits surface
- `notes` exist at summary and monthly levels, with room for entry-level notes
  later
- account balances are derived from imported ledger activity plus an explicit
  opening balance per account
- CSV-only balances need a reconciliation anchor, so opening balances are part
  of the account model rather than hidden UI math
- `account_balance_checkpoints` store statement-ending balances by account and
  statement month, with optional statement start/end dates for credit-card
  cycles; blank dates fall back to the selected calendar month-end, while filled
  start dates split the comparison into a pre-cycle baseline and in-cycle ledger
  movement
- credit-card checkpoints normalize bank-facing positive “amount owed” values
  into the app’s liability-negative ledger convention before comparison
- account health exposes reconciliation status, latest import freshness, and
  unresolved transfer counts so trust warnings stay close to balances
- import previews and recent import batches expose duplicate and same-account
  overlapping date-range signals so CSV trust is visible before and after commit
- PDF statement previews also compare detected statement balances with the
  projected account ledger through each statement end date before commit
- mismatched checkpoints can compare an uploaded statement against the already
  committed ledger for that checkpoint period without treating the statement as
  a new import; if the saved checkpoint has no explicit period, the comparison
  uses the uploaded statement period before falling back to the calendar month
- statement comparison near matches include same-amount rows with opposite
  direction so manual income-versus-expense mistakes explain checkpoint deltas
  without looking like wholly missing transactions
- direction mismatches can be fixed in place by updating only the committed
  ledger row classification, preserving the statement comparison session
- statement comparison also reports duplicate-looking groups within the uploaded
  statement and committed ledger using same date, signed amount, and normalized
  description
- large import previews call out that production commits are chunked and that a
  rejected Cloudflare request should be retried as smaller batches
- duplicate heuristics now distinguish exact ledger matches from near matches
  using amount, account, date proximity, and description token overlap
- `audit_events` keep a lightweight history of balance-affecting actions such as
  imports, opening-balance edits, checkpoints, entry edits, and transfer relinks
- account dialogs expose editable/deletable checkpoint history so
  reconciliation can be reviewed as a timeline rather than only as the latest
  status
- unresolved transfers have a dedicated review surface in Settings that links
  back into Entries for settlement work
- `categories` own their presentation metadata, including icon and color, so
  charts and category cards render from the same source of truth
- category matching rules live beside categories as editable Settings reference
  data, so merchant cleanup can improve future imports without changing older
  entries already committed to the ledger
- matching a preview row to the system `Transfer` category also promotes that
  row to transfer type, because transfer semantics affect reconciliation and
  cannot be represented by category alone

## Planning semantics

Each month should support two distinct planning layers:

- income
- planned items
- budget buckets

Monthly planning rows are person-owned first. The primary person and partner can
each have their own monthly plan rows, and the household view should be a
derived combined view over those per-person plans instead of a separate manually
maintained household plan.

Planned items are suitable for rows such as:

- savings
- tax
- subscriptions
- insurance
- loans
- recurring bills
- intentionally planned one-offs

Budget buckets are suitable for rows such as:

- food
- groceries
- shopping
- transport
- entertainment
- gifts
- hobbies

This distinction is important because the app should reveal variance without
forcing fake precision.

Planned-item matching is explicit. A planned row such as `Internet`, `Insurance`,
or `Electricity` can link to one or more imported ledger entries, and its actual
amount is derived from those selected entries. Category alone is not used for
planned-item matching because multiple planned rows can share a broad category
such as `Bills`.

When a user saves planned-item links, the app records lightweight match hints
from the linked ledger descriptions, amounts, categories, and accounts. Future
matching dialogs rank household entries using those hints plus category, account,
amount, description, and date proximity. The app still requires explicit user
confirmation; high-confidence automatic linking is intentionally deferred until
the rules have enough review history.

Budget buckets remain category-driven. A bucket such as `Food & Drinks` or
`Transport` rolls up actual expense entries in that category, after subtracting
actuals already assigned to planned items in the same category. This keeps
commitments precise without requiring every flexible purchase to become a
planned row.

Over-granular planning means too many unstable or ad hoc lines are promoted into
month-specific planned rows. The result is high maintenance and low signal.

The current spreadsheet structure from June to October is already close to the
right model: top rows for commitments and lower highlighted rows for broader
budget envelopes.

## Transaction semantics

Monie's Map should distinguish between:

- `expense`
- `income`
- `transfer`

Transfers should be modeled as linked counterpart entries between accounts, such
as a savings-account payment to a credit card. The UI should make that
relationship visible through labels, hover details, and links to the
counterparty entry.

Income can optionally offset a category when it represents reimbursement rather
than true earned income. Internal transfers should not pollute category spending
analytics.

## Dashboard shape

### Summary page

- defaults to the latest 12 available months
- month-by-month planned versus actual table
- income, planned expense, actual expense, savings target, and variance
- summary notes
- readable high-level charting as support, not as the main truth
- drill-down into a selected month
- actual income and expense values are derived from completed ledger entries
  when that month has entries, so stale monthly snapshots do not hide imported
  activity

### Month page

- income section
- planned items section
- budget buckets section
- planned versus actual comparison by row
- explicit entry matching for planned items
- category breakdown as a secondary analytic view
- person and household perspectives
- monthly notes
- links from summary rows or charts to matching entries

Household month scopes:

- `Combined`: union of person-owned and shared planning rows, merged by the
  appropriate row identity for reporting
- `Shared`: shared planning rows only

Person month scopes:

- `Direct ownership`: direct rows only for that person
- `Shared`: shared rows allocated to that person by split ratio
- `Direct + Shared`: direct rows plus that person's weighted share of shared rows

### Entries page

- all entries for the selected month
- totals distinguish category spend from cash outflow: `Spend` excludes
  transfers, while `Outflow` includes expenses plus transfer-outs
- filters by person, account, category, and import batch
- in person views, shared entries should show that person's allocated subtotal,
  not the full household amount
- when a shared row is shown in a person view, the full shared total should stay
  visible as supporting context
- edit flow for categorization, attribution, and transfer links

### Splits page

- top-level `Splits` tab separate from `Entries`
- group pills start with `Non-group expenses`, followed by named split groups
- each group pill shows context-aware owed/owing copy plus the current open
  entry count
- a `Matches` pill sits on the right and swaps the list into a split-match
  review surface
- splits are not month-filtered; the month picker is passive desktop chrome and
  hidden on mobile because the page is driven by unsettled activity instead
- each group has one active open batch of unsettled entries
- recording a settle-up closes the current batch for that group
- later split expenses, even if backdated, open a new current batch unless an
  older closed batch is explicitly edited
- summary strip shows the current batch's owed/owing state, spend, donut toggle,
  and add-expense action
- split activity combines manual split expenses and settle-up records in one
  current chronological list, followed by muted settled-history batches
- current split rows edit inline by replacing the activity card with the same
  field set used by the create/edit dialogs; delete and linked-entry editing
  live inside that inline form, and delete requires confirmation before removing
  only the split-layer record
- matching links imported ledger transactions back to manual split expenses or
  settle-up records after the import is already committed
- entries editor can promote a ledger expense into the splits layer; if the
  source ledger row is still direct, the app converts it to shared with a
  default 50/50 transaction split first and then creates the linked split
  expense record

## Chart guidance

Pie or donut charts can be useful for quick share-of-total scans, but should not
be the only chart form.

Preferred defaults:

- summary page: compact plan-versus-actual comparison by month
- month page: tables for planned items and budget buckets
- optional donut for quick category share context

Charts should support net category views where reimbursements reduce the net
cost for a category, while still exposing gross expense and offsetting income in
details.

## Application boundaries

The app should be structured with clear boundaries between:

- storage schema and persistence logic
- import parsing and normalization
- domain calculations and aggregations
- DTOs that shape data for UI and APIs
- presentation components and client-side interaction state

Prefer pure transformation functions and typed DTOs over passing raw database
rows directly into the UI.

Frontend direction:

- React + Vite for the app shell and UI state
- React Router should own page-level navigation so dashboard sections have stable URLs
- UI labels and helper copy should be sourced from locale modules instead of being hardcoded across components
- Worker API remains the source of bootstrap, route-page, mutation, and import
  endpoints
- charting should prefer a maintained library over hand-built geometry once the
  visual requirements become real product behavior
- the initial bootstrap remains the app shell and fallback payload for
  household, account, category, view, import, and settings data
- heavy route bodies are split behind focused endpoints:
  `/api/summary-page`, `/api/month-page`, `/api/entries-page`,
  `/api/splits-page`, `/api/imports-page`, and `/api/settings-page`
- bootstrap and page endpoints emit lightweight Worker diagnostics for slow or
  failed requests, including a request id, endpoint label, selected route
  parameters, and duration; error responses include the same request id so
  production console failures can be matched against Worker logs
- app-data schema and seed checks are cached per Worker instance after a
  successful initialization. Demo reseed and empty-state reset clear that cache.
  The read-path seed guard does not recalculate monthly snapshots; writes and
  imports remain responsible for refreshing derived snapshot rows.
- hot read paths have explicit D1 indexes for import history, ledger entries,
  plan rows, snapshots, category rules, and split activity. Runtime schema
  checks also ensure those indexes exist for older databases that predate the
  current `schema.sql`.
- bootstrap carries only the split-page shell fallback; split groups, expenses,
  settlements, and match candidates load from `/api/splits-page` so the app
  shell does not pay for split workspace data on every refresh.
- the imports page returns a bounded recent-history summary for first paint.
  Full import preview, duplicate checks, rollback, and overlap checks still run
  through their dedicated import flows, but the collapsed recent-history panel
  no longer forces all historical batches to be scanned before the page is
  usable.
- page refreshes keep the current route mounted with a busy overlay while the
  smaller route payload loads; writes clear page and shell caches before
  reloading data. Cached route payloads are reused without automatic
  stale-while-revalidate requests because those page endpoints can be expensive;
  explicit refreshes and mutations remain the freshness boundary.
- route-page responses are cached in memory by endpoint and query string.
  Adjacent month or summary-range payloads are prefetched first after the
  current page settles on non-touch devices. Touch devices skip background API
  prefetching so mobile refreshes do not compete with the visible page request.
  Lower-priority page data warms only after the visible route has finished
  loading and an additional quiet period passes; those background requests run
  one at a time with spacing between them. Route changes, browser-tab hiding,
  mutations, manual refreshes, and cache invalidation cancel the staged prefetch
  so bootstrap no longer has to reload for ordinary month/range navigation
  without creating a burst of background API calls. Entries seeds its first page
  cache from bootstrap on refresh and relies on explicit month changes, manual
  refreshes, and write invalidations for fresh API loads.
- route panels are lazily loaded behind React Suspense so imports, settings,
  PDF parsing, statement parsing, and charting code do not inflate the initial
  app shell bundle
- Month and Entries support horizontal touch swipes for previous/next month
  navigation; Splits stays excluded because its main surface is not
  month-filtered
- heavyweight charting code should be lazily loaded from the client where it is
  not required for first render
- interaction primitives such as popovers should prefer maintained web-native
  packages rather than bespoke UI widgets
- dialogs and confirmation popovers that save, delete, import, or reset data
  should stay open while the request is running, disable duplicate actions, and
  swap the primary action text to a short pending label such as "Saving..." or
  "Working..."; close the surface only after success and keep it open for inline
  errors when possible

## Why Cloudflare

Cloudflare is a practical choice here:

- cheap to operate
- simple deployment from Git
- fast enough for a reporting-heavy application
- D1 is sufficient for this data volume
- R2 is available later if raw statements need to be retained

The production app now runs as one Cloudflare Worker with static assets served
from `dist` and a D1 binding named `DB`. The current Worker URL is
`https://<your-worker-host>`, backed by the APAC D1 database
`monies-map` (`d1aa440c-d239-48ac-b0a6-d39f34e26e0e`).
Worker assets use single-page-application not-found handling so direct refreshes
of React routes such as `/entries` and `/settings` return the app shell instead
of a Worker 404.

Authentication should be enforced at the Cloudflare Access layer before the app
is used with real household data. The pragmatic first pass is Access one-time
PIN email auth with an allowlist for the two household emails. Google login can
replace the OTP provider later after Google is configured as a Zero Trust
identity provider; the application code does not need to own password or
session handling for this private deployment.

## Suggested roadmap

### Milestone 1

- working imports for 2 to 3 institutions
- import history and import-batch rollback
- review queue for uncategorized items
- monthly dashboard and entries view
- summary and monthly notes

### Milestone 2

- recurring transaction rules
- Google login
- better search and filters
- AI export pack for summary and monthly dashboards

### Milestone 3

- in-app AI analysis using structured dashboard context and notes
- annual net worth and account balance tracking
- household calendar view of large expected expenses
- forecasting based on recurring patterns
