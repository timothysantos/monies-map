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
- monthly view shows planned items, budget buckets, notes, and linked entries
- entries view shows the raw rows for the selected month with filters and edit
  capability
- person toggle supports `Direct ownership`, `Shared`, and `Direct + Shared`
- account filter shows source account and institution

### 4. Analysis

- the app should support AI-friendly exports for summary and monthly views
- analysis must consider both ledger data and user-authored notes
- future in-app AI can support or challenge the user’s explanation for unusual
  months instead of only summarizing totals

## Domain model principles

- `imports` are first-class and must support targeted rollback of a bad batch
- `transactions` are normalized ledger entries
- `monthly plans` are first-class and sit above transaction analytics
- `planned items` represent intentional or recurring commitments
- `budget buckets` represent flexible spending envelopes
- `transaction_splits` allocate shared expenses between people
- `transfers` are first-class linked entries, not fake income or expense rows
- `notes` exist at summary and monthly levels, with room for entry-level notes
  later
- `categories` own their presentation metadata, including icon and color, so
  charts and category cards render from the same source of truth

## Planning semantics

Each month should support two distinct planning layers:

- planned items
- budget buckets

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

- planned items section
- budget buckets section
- planned versus actual comparison by row
- category breakdown as a secondary analytic view
- per-person and shared perspectives
- monthly notes
- links from summary rows or charts to matching entries

### Entries page

- all entries for the selected month
- filters by person, account, category, and import batch
- edit flow for categorization, attribution, and transfer links

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
