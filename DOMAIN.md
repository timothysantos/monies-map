# Domain Glossary

This file is the canonical vocabulary for Monies Map.

Its purpose is to prevent synonym debt. When adding features, schemas, DTOs,
copy, or docs:

- reuse the canonical terms in this file
- only use aliases when referring to an existing table, field, DTO, or route
- prefer extending an existing entity before inventing a near-duplicate concept
- update this file in the same change if the domain model meaningfully evolves
- consult [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md) when a
  change depends on client implementation boundaries such as the deep module
  service

## Naming Rules

- Use `household` for the top-level container for all data.
- Use `person` for a household member inside the finance model.
- Use `account` for a tracked bank, card, cash, loan, or investment container.
- Use `ledger entry` as the canonical term for a normalized money movement row.
  In UI and DTOs this is usually shortened to `entry`. In storage it currently
  lives in `transactions`.
- Use `import batch` for one import operation and `import row` for one raw row
  inside that batch.
- Use `entry reconciliation` for the app task of deciding whether multiple
  source observations belong to one existing ledger entry or should create a
  new one. In accounting terms, this is the transaction-matching part of `bank
  reconciliation`.
- Use `transfer` for money moved between tracked accounts. Do not model it as
  fake income or fake expense.
- Use `split workspace` for the separate shared-expense settle-up layer.
- Use `month plan row` for a planned line item in the monthly planning model.
- Use `month snapshot` for a generated monthly rollup, never for editable plan
  input.
- Use `statement checkpoint` as the product term for an account balance anchor.
  The storage table is `account_balance_checkpoints`.
- Use `bank certification status` for the trust state of a ledger entry's
  bank-facing facts across manual capture, working imports, and final statement
  proof.

## Core Entities

### Household

The top-level finance container. A household owns people, institutions,
accounts, categories, imports, ledger entries, split workspace records, month
plans, notes, and snapshots.

Storage:
- `households`

Relationships:
- has many `people`
- has many `institutions`
- has many `accounts`
- has many `categories`
- has many `imports`
- has many `ledger entries`
- has many `split groups`, `split batches`, `split expenses`, and `split settlements`
- has many `monthly notes`, `month plan rows`, `month snapshots`, and reconciliation records

### Person

A household member who can own accounts, own direct entries, participate in
shared splits, pay split expenses, send or receive settlements, author notes,
and import data.

Storage:
- `people`

Relationships:
- belongs to one `household`
- can own many `accounts`
- can own many direct `ledger entries`
- can participate in many `entry splits`
- can pay many `split expenses`
- can participate in many `split expense shares`
- can send or receive many `split settlements`
- can own many `month plan rows`

### Institution

A financial institution such as UOB, Citi, or OCBC. Institutions are metadata
used to group accounts and drive import parsing context.

Storage:
- `institutions`

Relationships:
- belongs to one `household`
- has many `accounts`

### Account

A tracked financial container such as a bank account, credit card, cash wallet,
loan, or investment account.

Storage:
- `accounts`

Relationships:
- belongs to one `household`
- belongs to one `institution`
- may belong to one `person` as owner
- has many `ledger entries`
- has many `statement checkpoints`
- has many statement reconciliation records
- may be referenced by many `month plan rows` and `month plan match hints`

### Statement Checkpoint

An explicit balance anchor for an account and statement month, optionally with
statement-period dates. This is the trusted reference point used to reconcile
ledger activity against a statement balance.

Canonical term:
- `statement checkpoint`

Aliases:
- storage table `account_balance_checkpoints`
- DTO `AccountCheckpointDto`

Relationships:
- belongs to one `household`
- belongs to one `account`

### Category

The spending or income taxonomy used to classify ledger entries, split
expenses, and month planning rows.

Storage:
- `categories`

Relationships:
- belongs to one `household`
- may have one parent `category`
- has many `category match rules`
- has many `ledger entries`
- has many `split expenses`
- has many `month plan rows`
- has many `month plan match hints`

### Category Match Rule

A persistent household rule that maps a description pattern to a category during
import and classification workflows.

Storage:
- `category_match_rules`

Relationships:
- belongs to one `household`
- belongs to one `category`

### Category Match Rule Suggestion

A proposed category rule inferred from repeated corrections. Suggestions are
reviewable metadata, not active rules.

Storage:
- `category_match_rule_suggestions`

Relationships:
- belongs to one `household`
- points to one `category`

### Import Batch

One ingestion operation from a CSV, PDF statement, manual flow, or current
transaction export. It is the audit and rollback boundary for imported data.

Storage:
- `imports`

Relationships:
- belongs to one `household`
- may be created by one `person`
- has many `import rows`
- may create or certify many `ledger entries`
- may create many statement reconciliation records

### Import Row

One raw source row inside an import batch. Import rows preserve traceability
from normalized ledger facts back to source data.

Storage:
- `import_rows`

Relationships:
- belongs to one `import batch`
- may be assigned to one `account`
- may map to one committed `ledger entry`

Important distinctions:
- Multiple import rows across time can refer to the same real-world card or
  bank event. Later sources should usually enrich or certify the existing
  `ledger entry`, not create a second one.
- A manual provisional entry, a mid-cycle activity row, and a final statement
  row can all be separate source observations of one underlying ledger fact.

### Entry Reconciliation

The app workflow that matches source observations against existing ledger
entries so one economic event stays represented by one ledger entry across
manual capture, mid-cycle activity imports, and final statement imports.

Canonical term:
- `entry reconciliation`

Accounting analogue:
- `bank reconciliation` at the account level
- `transaction matching` at the row level

Important distinctions:
- Entry reconciliation is broader than duplicate detection. It decides whether a
  later source should create a new ledger entry, promote an existing provisional
  one, or certify an already-matched entry.
- Entry reconciliation now starts with a stricter `exact duplicate suppression`
  lane before it evaluates the guarded `promotion and reconciliation` lane.
- Entry reconciliation is not limited to PDF statements. The same system should
  govern manual entries, CSV/XLS activity imports, and statement imports with a
  source-authority ladder.
- `Exact duplicate suppression` is a raw identity check. If the incoming row has
  the same amount, the same mapped account, and either the same normalized
  import hash or a perfect normalized description match on the same date, the
  preview auto-skips it as already covered.
- `Promotion and reconciliation` is the status-guarded lane. It handles manual
  row promotion and statement certification after duplicate suppression has
  already removed truly identical bank rows.
- The `Velocity Rule` prevents commuter false positives by scaling duplicate
  candidate windows with `amount_minor`. Low-value rows with
  `abs(amount_minor) < 500` need `day_distance <= 2`, while higher-value rows
  can use `day_distance <= 7` to tolerate delayed posting.
- Under that rule, identical recurring small-value transactions such as
  BUS/MRT fares or coffee should be treated as separate economic events by
  default unless they occur close together in time.
- Date evidence should stay lane-aware. Compare original transaction dates to
  other original transaction dates when both exist; otherwise compare posted
  dates, so imported commuter rows do not become false matches through a mixed
  original-versus-posted comparison.

### Ledger Entry

A normalized money movement row in the household ledger. This is the main
financial fact record used across entries, months, summaries, transfers, and
reconciliation.

Canonical term:
- `ledger entry`

Accepted shorthands:
- `entry` in product, UI, and DTO contexts

Storage alias:
- `transaction` / `transactions`

Subtypes:
- `expense`
- `income`
- `transfer`

Relationships:
- belongs to one `household`
- belongs to one `account`
- may come from one `import batch`
- may come from one `import row`
- may belong to one `category`
- may belong to one `person` as direct owner
- may participate in one `transfer group`
- may have many `entry splits`
- may link to many `month plan rows` through plan-entry links
- may link to one `split expense`
- may link to one `split settlement`
- may be referenced by reconciliation records

### Transaction Date & Reconciliation
The system uses an event-first date model so planning and split workflows do
not drift when the bank clears later:

* **Event Date (`transaction_date`):** The immutable date the economic event
  happened. This drives ledger sorting, monthly planning, summary grouping, and
  split workspace calculations.
* **Posted Date (`post_date`):** The bank-cleared date used for statement
  verification, balance checkpoints, and other reconciliation-only workflows.

**Why this matters:**
An April 30 expense must stay in April for budgets and split math even if the
bank posts it on May 3. Reconciliation still needs the May 3 date, but it must
not push the event into a different planning month.

Important distinctions:
- A ledger entry is not the same thing as an import row.
- A ledger entry should represent one economic event even when that event is
  observed through multiple source paths such as manual entry, current-activity
  import, and final statement import.
- During entry reconciliation, later bank sources should fill or update
  `post_date` without rewriting `transaction_date`.
- A transfer ledger entry is still one ledger entry; a full transfer usually
  needs a matched pair of entries linked by a transfer group.
- Shared ownership on a ledger entry is not the same thing as a split expense
  record in the split workspace.

### Bank Certification Status

The trust state of a ledger entry's bank-facing facts. This status explains
whether the row is still provisional working data or has been proven by a final
statement.

Canonical term:
- `bank certification status`

UI states:
- `Manual provisional`
- `Import provisional`
- `Statement certified`

Storage states:
- `provisional`
- `statement_certified`

Important distinctions:
- `Manual provisional` means the row is provisional and has no import batch.
- `Import provisional` means the row is provisional and came from a working
  import such as CSV or XLS.
- `Statement certified` means a supported final statement is the authority for
  the row's posted bank facts.
- The UI shows three states, but storage only needs two raw values because
  `Manual provisional` versus `Import provisional` is derived from whether the
  provisional row has an `import batch`.
- Entry reconciliation uses a status-based match isolation guard. No incoming
  bank row can reconcile against an existing `statement_certified` ledger entry
  in the promotion/reconciliation lane.
- Mid-cycle imports such as CSV or XLS can only reconcile against
  `Manual provisional` ledger entries.
- To prevent cross-bank false positives on high-velocity recurring charges,
  mid-cycle imports only match pending manual entries. However, official PDF
  statement imports can match against mid-cycle provisional entries to elevate
  them to certified status.
- Those status guards do not block exact duplicate suppression. Repeated bank
  files should still auto-skip a row that is already present in the ledger,
  even if that ledger row is import provisional or statement certified.

### Entry Split

An allocation of one shared ledger entry across participating people. This is
the household-ledger ownership split model.

Canonical term:
- `entry split`

Storage alias:
- `transaction_splits`

Relationships:
- belongs to one `ledger entry`
- belongs to one `person`

### Transfer Group

A linkage record that pairs related transfer ledger entries across accounts.
The group models the relationship; the money movement facts still live on the
entries themselves.

Storage:
- `transfer_groups`

Relationships:
- belongs to one `household`
- has many `ledger entries`, usually two matched transfer entries

### Split Workspace

The shared-expense settle-up subsystem. It is intentionally separate from the
household ledger so collaborative expense tracking does not distort imported
bank facts.

This is a conceptual subsystem, not a single table.

Core records:
- `split groups`
- `split batches`
- `split expenses`
- `split settlements`

### Split Group

A named shared-expense context such as a trip, event, or household bucket.

Storage:
- `split_groups`

Relationships:
- belongs to one `household`
- has many `split batches`
- has many `split expenses`
- has many `split settlements`

### Split Batch

An optional archival or time-boxing container inside a split group. It allows
split activity to be grouped into open and closed periods.

Storage:
- `split_batches`

Relationships:
- belongs to one `household`
- may belong to one `split group`
- has many `split expenses`
- has many `split settlements`

### Split Expense

A shared-expense record in the split workspace. It represents who paid, what
was paid, and how the cost should be shared. It may optionally link back to a
ledger entry, but it is not itself a ledger entry.

Storage:
- `split_expenses`

Relationships:
- belongs to one `household`
- may belong to one `split group`
- may belong to one `split batch`
- belongs to one `person` as payer
- may belong to one `category`
- has many `split expense shares`
- may link to one `ledger entry`

### Split Expense Share

An allocation of a split expense across participating people. This is the split
workspace equivalent of an entry split.

Storage:
- `split_expense_shares`

Relationships:
- belongs to one `split expense`
- belongs to one `person`

### Split Settlement

A record that one person settled an amount with another person inside the split
workspace. It may optionally link to a ledger entry that carried the payment.

Storage:
- `split_settlements`

Relationships:
- belongs to one `household`
- may belong to one `split group`
- may belong to one `split batch`
- has one `from person`
- has one `to person`
- may link to one `ledger entry`

### Monthly Note

A note attached either to a summary scope or a specific month. Notes preserve
human context for later review and analysis.

Storage:
- `monthly_notes`

Relationships:
- belongs to one `household`
- may belong to one `person` as author

### Month Plan Row

An editable planning row for a specific month. This is the canonical planning
entity for incomes, planned items, and budget buckets.

Canonical term:
- `month plan row`

Storage:
- `monthly_plan_rows`

Sections:
- `income`
- `planned_items`
- `budget_buckets`

Relationships:
- belongs to one `household`
- may belong to one `person`
- may belong to one `category`
- may belong to one `account`
- has many `month plan row splits`
- may link to many `ledger entries`
- may have many `month plan match hints`

Important distinctions:
- A month plan row is an input or planning record, not a derived rollup.
- `planned item` and `budget bucket` are section types, not separate top-level
  entities.

### Month Plan Row Split

An allocation of a shared month plan row across people.

Canonical term:
- `month plan row split`

Storage:
- `monthly_plan_row_splits`

Relationships:
- belongs to one `month plan row`
- belongs to one `person`

### Plan-Entry Link

An explicit link between a month plan row and one ledger entry. These links are
how planned-item actuals are resolved against real activity.

Canonical term:
- `plan-entry link`

Storage:
- `monthly_plan_entry_links`

Relationships:
- belongs to one `month plan row`
- belongs to one `ledger entry`

### Month Plan Match Hint

A reusable matching hint for connecting similar future ledger entries to a
month plan row pattern.

Storage:
- `monthly_plan_match_hints`

Relationships:
- belongs to one `household`
- may point to one `person`
- may point to one `category`
- may point to one `account`

### Month Snapshot

A generated monthly rollup used by dashboards and summaries. Snapshots are
derived state, not user-authored planning state.

Storage:
- `monthly_snapshots`

Relationships:
- belongs to one `household`
- keyed by `year`, `month`, and `person_scope`

### Monthly Budget Record

A compatibility-level planning table that still exists in storage but is not
the preferred planning abstraction for new work. New product features should
anchor on `month plan rows` unless there is a deliberate migration or cleanup
reason to touch this older shape.

Storage:
- `monthly_budgets`

Relationships:
- belongs to one `household`
- may point to one `person`
- may point to one `category`

### Statement Reconciliation Certificate

A proof record that a statement import reconciled a specific account and period.
Certificates are evidence of successful certification, not the ledger facts
themselves.

Storage:
- `statement_reconciliation_certificates`

Relationships:
- belongs to one `household`
- belongs to one `import batch`
- belongs to one `account`

### Reconciliation Exception

A persisted balance-trust issue that remains open or resolved outside a single
import preview. It records problems that block or weaken confidence in a fully
trusted account balance.

Storage:
- `reconciliation_exceptions`

Relationships:
- belongs to one `household`
- may point to one `account`
- may point to one `ledger entry`

## Relationship Map

At a high level:

- a `household` contains the full graph
- `people`, `institutions`, `accounts`, `categories`, and rules are reference data
- `import batches` and `import rows` capture source traceability
- `ledger entries` are the normalized financial facts
- `entry splits` and `transfer groups` refine ledger-entry meaning
- the `split workspace` is a separate shared-expense workflow that can link back
  to ledger entries without replacing them
- `month plan rows` capture intent
- `plan-entry links` connect intent to actual ledger facts
- `month snapshots` summarize derived results
- `statement checkpoints`, `reconciliation certificates`, and
  `reconciliation exceptions` model balance trust and proof

## Synonym Guardrails

Use these terms consistently in future work:

- Say `ledger entry` or `entry`, not `transaction`, unless you are explicitly
  talking about the `transactions` table or compatibility code.
- Say `statement checkpoint`, not `balance snapshot`, for
  `account_balance_checkpoints`.
- Say `import batch`, not just `import`, when the batch boundary matters.
- Say `import row`, not `raw transaction`, for source rows before normalization.
- Say `entry reconciliation`, not only `duplicate detection`, when the task is
  to decide whether two source rows refer to the same economic event.
- Say `transfer group` for the link record and `transfer entry` for each ledger
  row inside the pair.
- Say `split expense` for the Splitwise-style record and `shared ledger entry`
  for a shared row in the ledger. They are related but not interchangeable.
- Say `month plan row`, not `budget row`, unless you specifically mean the
  `budget_buckets` section.
- Say `month snapshot`, not `monthly plan summary`, for generated dashboard
  rollups.

## Current Canonical Boundaries

These boundaries are important enough to preserve explicitly:

- Source data vs normalized data:
  `import row` -> `ledger entry`
- Matching workflow vs proof workflow:
  `entry reconciliation` != `statement reconciliation certificate`
- Ledger ownership vs split workspace:
  `entry split` != `split expense share`
- Transfer linkage vs transfer facts:
  `transfer group` links transfer entries but does not replace them
- Planning vs actuals:
  `month plan row` != `ledger entry`
- Proof vs balance anchor:
  `statement reconciliation certificate` != `statement checkpoint`
