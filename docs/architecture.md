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
- Keep [`AGENTS.md`](/Users/tim/22m/ai-projects/monies_map/AGENTS.md) aligned
  with implementation conventions and coding expectations.
- Keep [`docs/faq.md`](/Users/tim/22m/ai-projects/monies_map/docs/faq.md)
  updated as a living user-facing reference for setup, workflow, and feature scope.

## Primary workflows

### 1. Import

- user uploads a CSV export from a bank, card, or mixed-account source
- system uses an institution-specific mapping profile when available
- review step allows whole-file or per-row account attribution
- transactions are normalized to a single ledger shape
- every imported row is attached to an import batch for audit and rollback
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
- the settings screen groups demo metadata such as salary-per-person, current
  mode, and reseed timestamp under a collapsible demo-state section
- the settings screen can reseed the believable default demo and refresh the bootstrap
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
  month so the latest checkpoint can be compared against the computed ledger
- account health exposes reconciliation status, latest import freshness, and
  unresolved transfer counts so trust warnings stay close to balances
- import previews and recent import batches expose duplicate and overlapping
  date-range signals so CSV trust is visible before and after commit
- duplicate heuristics now distinguish exact ledger matches from near matches
  using amount, account, date proximity, and description token overlap
- `audit_events` keep a lightweight history of balance-affecting actions such as
  imports, opening-balance edits, checkpoints, entry edits, and transfer relinks
- account dialogs expose checkpoint history so reconciliation can be reviewed as
  a timeline rather than only as the latest status
- unresolved transfers have a dedicated review surface in Settings that links
  back into Entries for settlement work
- `categories` own their presentation metadata, including icon and color, so
  charts and category cards render from the same source of truth

## Planning semantics

Each month should support two distinct planning layers:

- income
- planned items
- budget buckets

Monthly planning rows are person-owned first. Tim and Joyce can each have their
own monthly plan rows, and the household view should be a derived combined view
over those per-person plans instead of a separate manually maintained household
plan.

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

- month-by-month planned versus actual table
- income, planned expense, actual expense, savings target, and variance
- summary notes
- readable high-level charting as support, not as the main truth
- drill-down into a selected month

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
- Worker API remains the source of bootstrap and import endpoints
- charting should prefer a maintained library over hand-built geometry once the
  visual requirements become real product behavior
- interaction primitives such as popovers should prefer maintained web-native
  packages rather than bespoke UI widgets

## Why Cloudflare

Cloudflare is a practical choice here:

- cheap to operate
- simple deployment from Git
- fast enough for a reporting-heavy application
- D1 is sufficient for this data volume
- R2 is available later if raw statements need to be retained

The production app now runs as one Cloudflare Worker with static assets served
from `dist` and a D1 binding named `DB`. The current Worker URL is
`https://monies-map.timsantos-accts.workers.dev`, backed by the APAC D1 database
`monies-map` (`d1aa440c-d239-48ac-b0a6-d39f34e26e0e`).

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
