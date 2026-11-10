# Architecture Plan

This document is the human-readable architecture plan for Monies Map.

It is not the primary always-loaded AI instruction file. `AGENTS.md` is the
repository rule file that Codex reads each prompt. This document exists to give
humans and coding agents one durable technical plan to follow when changing the
system.

## Document Roles

- `AGENTS.md`: mandatory repository working rules and prompt-time behavior
- [`DOMAIN.md`](../DOMAIN.md): canonical ubiquitous language
- [`design.md`](../design.md): implementation boundaries and deep-module rules
- `docs/architecture.md`: target architecture, migration strategy, and staged
  delivery plan
- [`docs/scenario-catalog.md`](./scenario-catalog.md): Stage 1 TDD scenario map
- [`docs/slice-inventory.md`](./slice-inventory.md): Stage 2 slice ownership map
- [`docs/query-map.md`](./query-map.md): Stage 3 query and cache map
- [`docs/route-data-code-flow.md`](./route-data-code-flow.md): detailed
  three-lane explanation of route flow, data flow, code/rendering flow, and
  their current boundary rules
- [`docs/code-spec.md`](./code-spec.md): compact implementation spec, query
  budgets, invalidation contract, and code-shape rules
- [`docs/implementation-order.md`](./implementation-order.md): Stage 4
  execution order, test priority, and slice migration sequence
- [`docs/preimplementation-checklist.md`](./preimplementation-checklist.md):
  reusable pre-change audit checklist and stop conditions
- [`docs/known-coupling-targets.md`](./known-coupling-targets.md): audit
  findings that should become explicit tests or contract checks
- [`docs/implementation-prompt-template.md`](./implementation-prompt-template.md):
  exact prompt shape for slice work and bug fixes
- [`docs/refactor-decisions.md`](./refactor-decisions.md): intended answers to
  the remaining shell, helper, mobile, money-editing, bootstrap, and
  invalidation shape questions
- [`docs/archive/first-slice-prompt.md`](./archive/first-slice-prompt.md): ready-to-run prompt
  for the app shell and query infrastructure foundation slice
- [`docs/archive/second-slice-prompt.md`](./archive/second-slice-prompt.md): ready-to-run
  prompt for the route-transition and domain-boundary slice
- [`docs/archive/third-slice-prompt.md`](./archive/third-slice-prompt.md): ready-to-run prompt
  for the imports query and workflow slice
- [`docs/archive/fourth-slice-prompt.md`](./archive/fourth-slice-prompt.md): ready-to-run
  prompt for the settings query and workflow slice
- [`docs/archive/eighth-slice-prompt.md`](./archive/eighth-slice-prompt.md): ready-to-run
  prompt for the app-shell retirement and legacy-bridge cleanup slice
- [`docs/archive/ninth-slice-prompt.md`](./archive/ninth-slice-prompt.md): ready-to-run
  prompt for the entries workflow boundary and remaining month handoff slice
- [`docs/archive/tenth-slice-prompt.md`](./archive/tenth-slice-prompt.md): ready-to-run
  prompt for the month workspace boundary slice
- [`docs/archive/eleventh-slice-prompt.md`](./archive/eleventh-slice-prompt.md): ready-to-run
  prompt for the summary slice
- [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md): current-app behaviors that must survive refactors
- [`docs/responsive-behavior.md`](./responsive-behavior.md): responsive UX and form-factor contract
- [`docs/interaction-guidelines.md`](./interaction-guidelines.md): button, CTA, and dismissal semantics
- [`docs/import-summary-code-glossary.md`](./import-summary-code-glossary.md):
  page-local reading glossary, not a second domain source

## Current Problem

The 2026-09-22 [macro audit and execution plan](./macro-performance-plan.md)
distinguishes current evidence from the historical migration goals below.
Retain the existing framework and finance/workflow contracts. Measure built
route loading, optional work, and full request initialization before changing
state ownership or persistence. No runtime redesign was implemented by the audit.

The app works, but the code is hard to follow because too much behavior is
spread across broad client helpers, page components, query wiring, and implicit
state flow. The main problems are:

- data flow is not obvious from screen to query to domain logic to storage
- feature code is not consistently organized as vertical slices
- the current client bootstrap is carrying too much responsibility
- slice migrations must cut over cleanly instead of preserving old and new
  paths side by side
- deep modules are present in intent but not yet enforced as the dominant shape
- tests exist, but the development process is not yet consistently TDD-first at
  the scenario level

## Target Principles

### Ubiquitous language

Ubiquitous language means the same business concept uses the same name in docs,
tests, DTOs, API contracts, and UI copy. Monies Map should have one canonical
term for each important finance concept.

Rules:

- `DOMAIN.md` is the canonical vocabulary
- new feature names must extend existing terms before inventing new ones
- page copy, test names, DTOs, and module names should prefer canonical terms
- narrow code glossaries may exist, but they must defer to `DOMAIN.md`

### Vertical slices

Vertical slices mean the codebase is organized around end-to-end user workflows
instead of around technical layers alone. A slice owns its UI, query options,
workflow orchestration, and tests for one product area.

Target slices:

- `summary`
- `months`
- `entries`
- `imports`
- `splits`
- `settings`

The splits slice also owns settlement checkpoints. A checkpoint is an explicit
snapshot of currently open split activity and its net household balance;
matching a transfer records external settlement without rewriting the source
split rows. A paid confirmation can move an unmatched checkpoint out of the
active workspace, but it is deliberately separate from a bank match and does
not write or certify any ledger evidence. Reopening a checkpoint releases its
rows for a later checkpoint while preserving the historical checkpoint record.

Split groups carry a designated currency and optional expense source, while expenses and settlements retain
their original currency and payment evidence. Checkpoint netting only sums one
currency at a time; matching a ledger transfer in another currency requires a
stored, user-supplied FX rate and records both the ledger amount and converted
checkpoint amount. Foreign card expenses can remain awaiting statement
certification, and cash expenses do not require a ledger link.

Group settlement and simplification are separate commands. A group settlement
closes only the selected group's active batch and creates no checkpoint.
Simplification may create one active checkpoint per currency, allowing an SGD
and JPY obligation to progress independently without cross-currency netting.

Split deletion is reversible: the source expense or settlement is soft-deleted
with `deleted_at`, and `split_activity_history` records the deletion and later
restore. The history projection is household-scoped and available from the
splits page; restoring reactivates the original record and relationships rather
than creating a replacement. Settlement checkpoint membership is not rewritten
by either operation.

The Ask page (`/ask`, `docs/flows/ask-flow.md`) is a lazy route, not a
slice of its own data: it adds entries through the entries slice's create
path (`entry-create-request.js`) and the existing split link, borrows the
Entries and Summary DTOs from the query cache (the Entries one through the
shell's required read when it must load it), and holds only its
conversation and one entry card. The Entries + and Splits receipt buttons
open it; their old forms stay reachable. On a wide screen the same page
also opens beside any other page, docked or as a popup, from the
bottom-right Ask field (`ask-dock.jsx`, design.md "Desktop Ask"), on the
same conversation store. Money questions ("why was August so expensive?",
"what do I owe Serene?") go to `POST /api/ai-assist/answer`, which reads
them by rules, checks the skew candidates first and answers from the Month
and Splits page DTOs (DOMAIN.md "Money Question").

Rules:

- each slice should expose a small public surface
- cross-slice dependencies should be rare and explicit
- shared code should move to a shared module only when at least two slices need
  the same abstraction and the name is stable

### TDD by scenarios

TDD here does not mean writing one test per button. It means defining the user
scenarios that matter on each page and across pages, writing those tests first,
then implementing or refactoring to satisfy them.

Rules:

- every feature change starts with a failing or intentionally updated test
- page workflows should be described as scenarios, not implementation trivia
- cross-page flows are first-class because this app is a finance workflow, not
  a set of isolated screens
- tests should describe outcomes in domain terms

### Deep modules

Deep modules have small public APIs and substantial internal logic. A caller
should get a simple entry point without needing to understand the whole helper
graph behind it.

Rules:

- prefer small, intention-revealing public APIs
- hide formatting, shaping, reconciliation, and view-derivation internals
- avoid utility sprawl where every file imports every other helper directly
- a component should depend on a slice API, not on a web of helper files

## Target System Shape

### Entry time of day

An entry can carry the local clock time it was made (`transactions.transaction_time`,
"HH:MM" in the household's Asia/Singapore time, nullable, additive;
`src/lib/entry-time.ts`). The Apple Pay Shortcut, the Entries form and Ask
set it only for an entry dated today; imports leave it empty and a statement
that certifies an entry keeps it. It is display-only: matching, duplicate
checks and month totals never read it, and only the Entries page DTO sends it
(`loadEntries(..., { withTime: true })`). DOMAIN.md, "Transaction Time".

### Server-state strategy

The app should move toward TanStack Query as the main server-state boundary.

Rules:

- stop treating bootstrap as the default source for all screens
- fetch the minimum data needed per screen
- keep separate queries for separate concerns such as:
  - route-neutral app shell identity
  - lightweight account/category reference data
  - month list
  - month detail
  - entries list
  - entry detail when needed
  - aggregates
  - imports inbox planning and preview state
  - splits workspace state
  - settings account diagnostics and reference management
- let each slice own its query keys and query option builders
- invalidate narrowly after mutations
- keep `/api/app-shell` free of accounts, categories, page payloads, balances,
  checkpoint history, and import history

### Loading, warmup and data ownership (current, 2026-09)

The macro performance work (`docs/macro-performance-implementation.md`,
evidence in `docs/audits/macro-loading-baseline.md`) left this shape:

- **Route work.** Each route owner reports whether its page is ready and
  whether a protected workflow (an editor, a save) is open. The shell derives
  one `usable` signal from that; optional work waits for it.
- **One optional warmup queue.** After the page is usable and quiet, at most
  one likely-next route module and, on desktop, up to two data requests per
  visit are warmed, one at a time. Mobile warms code, and data only for
  measured cheap families on a good connection (currently the Entries page).
  Speculative reads are cancelled at a deadline unless the visible route
  joins them. Navigation and required reads never wait for warmup.
- **Owners for server data.** Reference data, Summary, the other route pages
  and the app shell each have one owner that keeps the last good snapshot on
  screen and ignores superseded responses, so a slow or cancelled request
  cannot overwrite newer data, blank the shell or raise an error screen.
- **Payloads.** APIs serve compact JSON. The Month page sends its entries
  once; Splits carries only the month's transfers. Every page API reports
  `Server-Timing: app, init, total`.
- **Persistence.** Write commands, runtime schema, seeding, snapshot
  recalculation and page projections live in focused modules; persistence
  refactors are proven with `scripts/persisted-state-snapshot.mjs`.

### Navigation: one Summary tab (current, 2026-10)

Summary and Month are one `Summary` tab. "All months" is the Summary page
(`/summary`), a picked month of the header's range is the Month page
(`/month?month=YYYY-MM`); both URLs stay, so saved links and the Shortcut
keep working. The header picks the range on both; the month is picked in
the phone's floating island and its "Pick a month" sheet, or the desktop
month row under the header. A month choice pins the range into the URL, and
a pinned Summary request is keyed by its range, so moving between months and
All months reuses one Summary page instead of fetching it again. The phone
bar holds Summary, Entries and Splits plus the ••• menu (one grid column per
primary tab). Spending Mix follows the tab's month choice and has no month
chips: the whole range on All months, the picked month on Month (from the
Month page DTO, no request). Decision: `docs/refactor-decisions.md` §8; design:
design.md, "Summary Tab Month Choice".

### Client state strategy

- route state should select the active screen and screen parameters
- server state should live in TanStack Query
- transient form state should stay local to the relevant feature
- imports owns browser-only intake state for selected/dropped bank files. It may
  keep parsed rows, checkpoints, and generic CSV text while the page is alive,
  but it must not persist original PDFs, CSVs, XLS files, OCR images, or raw
  bank files
- derived view state should come from selectors or pure helpers, not effect
  chains
- the app shell should import only its route-neutral controls and the small
  shared helpers it renders directly. Page editing controls, filter stacks,
  import parsers, and broad facades that retain them belong in lazy
  slice-owned modules so the first screen does not pay for inactive workflows

### Backend shape

The backend should remain explicit about boundaries:

- repository/storage logic
- domain logic and calculations
- DTO mapping
- route handlers

The existing domain richness is an asset. The redesign should not flatten the
domain model just to simplify the client.

### Write atomicity and derived month totals (current, 2026-09)

Every persistence command reads and checks first, then commits all of its
writes, its audit event and its month refresh markers in one `db.batch()`,
which D1 runs as one transaction. A failure at any statement leaves the
database as it was. This covers import commit and rollback (including
statement certification, checkpoints and certificates), entry create, edit
and delete, transfer link and settle, and every month-plan command. A
statement import's approved statement fixes (DOMAIN.md, "Statement Fix") are
written in the same batch as its certifications, before them, and undone by
its rollback. Statement corrections from the Settings comparison (DOMAIN.md,
"Statement Correction") are their own command: each apply or undo is one
batch, recorded in `statement_corrections` for the undo.

`monthly_snapshots` (the stored month totals Summary reads) are derived from
the committed ledger, so they are refreshed in a second batch right after the
write:

```text
command batch:  ledger writes + audit event + monthly_snapshot_refreshes rows
refresh batch:  every scope's monthly_snapshots for those months
                + delete their monthly_snapshot_refreshes rows
Summary/Month page read: refresh any months still marked, then read totals
```

Each marker write sets a new refresh token, and a refresh only writes totals
and clears a marker while the token it read is unchanged, so a refresh that
races a newer write can never store older totals. A refresh that fails does
not fail the committed write; its markers stay until
the next Summary or Month read repairs them. An import larger than one batch
(over 500 statements, about 245 CSV rows) stages the draft import and its new
rows in chunks, which ledger reads ignore while the import is a draft, then
makes every visible change in one final batch and discards the staged rows if
anything fails. Rolling back an already rolled-back import is rejected (409).
Evidence: `docs/audits/atomic-writes.md`.

### Skew candidates (current, 2026-10)

Money that moves inside the household can be imported as spending and
income: a split settlement paid by PayNow, or a move between one person's
own accounts filed as Salary on the receiving side. Until the pair is
linked as a transfer (and a settlement matched to its checkpoint) the
month's figures are wrong by that amount. `skew candidates` (DOMAIN.md,
"Skew Candidate") flag these deterministically so anything that explains a
month, such as the planned chat, can check them before answering:

```text
GET /api/skew-candidates?view=&month=&scope=
  pages/skew-candidates.ts      reads: entries for the month +-14 days,
                                transfer-grouped ids, account owners, open
                                settlement checkpoints, split groups,
                                expenses and settle-ups
  splits-projection.ts          group balances, as the Splits page shows them
  skew-candidates.ts (pure)     settlement + own_transfer candidates, skew per
                                view and month, reasons, suggested actions
```

The route is read-only (no writes, no month refresh), is not a page DTO and
is not carried by any first-screen or page payload. It names the existing
write routes that resolve each candidate (`/api/transfers/link`,
`/api/entries/update-classification`, `/api/splits/checkpoints/match`,
`/api/splits/settlements/create`); it never calls them. No AI is involved.

### Reminders in Ask: what is coming up (current, 2026-10)

Up to a few short cards at the top of Ask's chat mode and a dot on the Ask tab:
a card bill due, a statement that should be out, a Splits settle-up that has
waited, a subscription price change and a month ready to close. Fixed rules
(`src/domain/reminders/`, pure) over data the app already holds, one read-only
route (`GET /api/reminders`) read when Ask opens, words in a fixed copy file,
Later and Got it kept on the device. No AI, no write, no new table. The
Ledger check-up is what looks wrong; reminders are what is coming up and never
repeat it. See `docs/flows/reminders-flow.md` and `docs/audits/reminders.md`.

### Subscriptions and bills: repeating charges on Summary (current, 2026-11)

A Summary card under Money insights lists every charge that comes back each
month or year (owner decisions D1 to D3, 2026-11-10). One pure engine
(`src/domain/repeating-charges.ts`, DOMAIN.md "Repeating Charge") groups the
view's expenses by payee (`payeeKey`) and finds monthly and yearly series by
gap and amount; the subscription price change reminder shares its
`detectPriceChange`, so the row's "Went up" and the reminder never disagree.
`GET /api/repeating-charges?view=&scope=` (`src/domain/pages/
repeating-charges.ts`) reads 26 months of expenses grouped in SQL by
description and month, each account's latest entry date, the people and,
for a person view, the window's split shares, all in one step; a person
view counts each charge at their share (`personEntryAmountMinor`). The card
(`subscriptions-section.jsx`) is a lazy chunk read once the top summary is
usable. Every amount opens exactly its charges (`repeating` figure). No AI,
no write.

### Investments over time and Tax reliefs on Summary (current, 2026-11)

Two read-only Summary cards (owner-approved design, 2026-11-10). `GET
/api/investments-over-time?view=` (`src/domain/pages/investments-over-time.ts`,
pure rules in `src/domain/investments-over-time.ts`) reads the investment
accounts, their `investment_statement_values` and the people in one step and,
only when an account in view has a statement value, the household's entries
from 1 January (figures only): worth, put in, grew by, paid out and a chart
with worth points only at statement months. `GET /api/tax-reliefs?view=`
(`src/domain/pages/tax-reliefs.ts`, rules in `src/domain/tax-reliefs.ts`,
limits in the one dated `src/domain/sg-tax-relief-limits.ts`) reads the year's
entries whose category or transfer purpose is one of the three seeded relief
categories (matched in SQL) and gives each person's use against the limits.
In December the same facts feed one Reminders To do (`tax_relief`, read only
in December). The cards are lazy code in Spending Mix's chunk, read once the
top summary is usable. No AI, no write, no new table.

### What changed this month: a Summary card (current, 2026-11)

A Summary card under Money insights shows the month so far against the same
point last month: the 3 categories that went up most and the 3 that went
down most, each with the shops behind it on a tap, a "more than usual" mark
from the same-day engine (`usual-so-far.ts`), and one quiet line when
nothing moved much (owner decision 2026-11-10; DOMAIN.md "What Changed
Card"). It replaced the two Money insights "more than usual so far" lines,
so the same fact is not shown twice. `GET /api/summary-changed` reads the
same 7-month date window Ask's "What changed?" reads and shares its engine
(`ask-changed.ts`), so the two cannot disagree; the card is read after the
first screen and adds nothing to the Summary payload. Deterministic, no AI,
looks back only.

### Miles and cashback: card reward rules (current, 2026-11)

Owner-approved (2026-11-10). A credit card's reward rules (DOMAIN.md "Card
reward rule") live in the additive `card_reward_rules` table, one JSON row per
card, copied from the presets in `src/domain/card-reward-presets.ts` the first
time a card is read (`ensureCardRewardRules`: one read, one `db.batch()` for
only what is missing, one audit event; a missing table reads as the presets).
Pure rules in `src/domain/card-rewards.ts` (channel estimate, earning per cycle
with caps, best card now, cap notices, a 3-month replay) run over the credit
card entries of the last four months (bounded by date, household-date index).
`GET /api/card-rewards?view=` feeds Summary's card, `GET
/api/card-rewards/rules` Settings > Cards and rewards; `POST
/api/card-rewards/rules` (save, reset, undo) and `/suggest-from` are
all-or-nothing commands with audit events (`app-repository-card-rewards.ts`).
The "Suggest cards from" setting defaults to the whole household (pooled caps
and miles); per-person mode never names another person's card. Lazy code in
Spending Mix's chunk, read once the top summary is usable. No AI.

### Ledger check-up: one explicit report of what is wrong (current, 2026-10)

The household asks "Check my books" and gets a list of problems in its own data
with evidence, a confidence tier and, where the app already has one, a link to
the fix (DOMAIN.md "Ledger Check-up"; `docs/proposals/ledger-checkup.md`,
`docs/audits/ledger-checkup.md`). Phase 1 is the engine and the API; phase 2 is
the page (`/check`, `docs/flows/check-flow.md`: a lazy route with its own data
owner, `check-data-owner.js`, that runs only when opened); the correction of a
settled period is phase 3.

```text
GET /api/ledger-checkup[?view=&dismissed=1]
  pages/ledger-checkup.ts            loader + stored dismissals + runner
  ledger-checkup/loader.ts           3 db.batch round trips, <= 25 statements,
                                     every read indexed, windowed and limited
  ledger-checkup/registry.ts         one list of pure detectors, one fact slice each
  ledger-checkup/*.ts (pure)         wrong-card, split duplicates and settled-period
                                     errors, duplicate entries, unmatched transfers,
                                     statement gaps / joins / balance mismatch, stale
                                     estimates, plan problems, data hygiene
  ledger-checkup/runner.ts           order (tier, money, recency), 50 a kind, person view
POST /api/ledger-checkup/dismiss | undo-dismiss
  app-repository-ledger-checkup.ts   one app_settings row + audit event, one batch
```

The report reuses the matchers the app already trusts rather than defining a
second meaning of "the same purchase": the wrong-card rules
(`assessWrongCardDuplicates`), the transfer candidate ranking, the Splits
matcher (`findBestSplitExpenseMatch`), the settle-up coverage rules, the
statement balance functions Settings uses, and the Month link dialog's reasons.
It is read-only (the one write is "This is fine"), runs only when the person
opens it, and uses no AI, no schedule and no cache.

### Transfer purpose: person views of a transfer (current, 2026-10)

A transfer between two people of the household can say what it pays for
(DOMAIN.md "Transfer Purpose"; `docs/proposals/transfer-purpose.md`). The
purpose is stored on the sending entry and changes person views only, through
one pure reading shared by the Worker and the browser:

```text
transactions.transfer_purpose_*      on the sending transfer entry
app-repository-entries.ts            EntryDto.transferPurpose (only those rows)
transfer-purpose.ts (pure)           readEntryForPerson / readEntriesForView:
                                     sender -> expense in the purpose category
                                     receiver -> payback in that category
                                     household -> the same array, untouched
month-projection.ts                  adjustEntriesForView = split shares + reading
                                     (Summary, Month, plan history, Ask facts)
                                     adjustEntriesForList = split shares only
                                     (Entries, app shell, Splits' transfers)
app-repository-snapshots.ts          stored person month totals read per scope
src/client/entry-filtering.js        Entries reads its ledger rows for filters,
                                     totals and figures; a read row keeps
                                     `ledgerEntry` for the editor
```

The Entries list keeps ledger facts because it is where entries are edited: a
row read as spending is never saved as an expense. Household figures are
untouched by construction (the household reading returns its input).

### Wrong-card Apple Pay duplicates (current, 2026-10)

An Apple Pay entry saved on the wrong card is counted twice once the right
card's activity file arrives, and no existing check saw it (the "no longer
listed" check removes only what an export created; a Shortcut entry counts
as the user's own; the wrong-card diagnosis reads statements only). The
import preview now flags it, deterministically and without AI:

```text
preview  import-wrong-card-duplicates.ts   loadWrongCardEvidence: 1 read when
         |                                  no Apple Pay entry is in the file's
         |                                  dates, else 4 (entries, same-amount
         |                                  entries around them, each card's
         |                                  earlier export dates, posting lag)
         wrong-card-apple-pay-duplicate.ts  pure confidence rules (high /
                                            medium / low, score, reasons)
         -> ImportPreviewDto.wrongCardDuplicates (high and medium only)
commit   buildWrongCardDuplicateRemoval    re-runs the same evidence on the
         |                                  ledger as it is and the reviewed
         |                                  rows, refuses anything short of
         |                                  high; guarded INSERT (saved row),
         |                                  INSERT (audit), DELETE per entry
         |                                  in the import's one batch
rollback buildWrongCardDuplicateRestore    puts each whole row back in the
                                            rollback's batch
```

Nothing is automatic and there is no standing "do it for me" choice: a
removal is offered, confirmed in a dialog and checked again at commit.
Statement imports keep their own wrong-card path. Rules, false-positive
analysis, measured reads and the real case:
`docs/audits/wrong-card-apple-pay-duplicate.md`.

### Investment statements (current, 2026-10)

An iFAST "Wrap" monthly statement PDF, and a StashAway "Statement of Account"
PDF, are an investment account's statement, imported through the same Imports
flow as a bank statement, deterministically (no AI):

```text
browser: extractPdfText (pdf.js, unchanged) -> parseStatementText
  lib/statement-import/ifast.ts   pure parser: period, account number, currency,
                                  total assets, income, plan-level cash rows
                                  (reads the raw item view, not visual lines)
  lib/statement-import/stashaway.ts  same shape for StashAway: period, reference
                                  code, SGD, summary "Total" row (opening,
                                  cashflow, returns, fees, closing), deposit and
                                  withdrawal rows or one net-cashflow row
POST /api/imports/preview
  app-repository-import-preview.ts   splits value checkpoints from bank ones
  import-investment-statement.ts     pairs each row with a bank entry
                                     (transfer-candidates.ts, account number
                                     as the strong signal)
  import-investment-values.ts        what the statement will save / replace
POST /api/imports/commit (one db.batch, with the rows)
  import-transfer-links.ts           transfer group over statement row + bank
                                     entry, bank entry's old classification kept
  import-investment-values.ts        investment_statement_values upsert, the
                                     replaced value kept for rollback
POST /api/imports/rollback           restores bank entry, value, drops the group
GET  /api/summary-account-pills      investmentValue on an investment account's
                                     pill (the one place the value is shown)
```

Decisions: the market value is not a `statement checkpoint`. Checkpoints are
bank balances with certificates, chain breaks and a ledger difference; a
market value includes gains, so it has its own table
(`investment_statement_values`, additive, `CREATE TABLE IF NOT EXISTS`) and no
balance reader can mistake it for one. Contribution rows are certified
transfers in on the investment account (owner follows the account); the pair
with the bank's GIRO row is one `transfer group` made inside the import batch,
so Invested counts it once (`investment-moves.ts`). Placement: the Summary's
"The accounts shown" row for the investment account carries a plain sentence
("$x on 30 Sep 2026, as the statement says"), read from the account-pills
slice Summary already loads, so no page payload grows for a household with no
investment statement.

### Usually shared (current, 2026-11)

Splits lists past expenses that look like the ones their payer usually puts
on Splits ("Usually shared, not on Splits yet"; DOMAIN.md "Usually Shared").
It adds no table and no policy: `src/domain/usually-shared.ts` sweeps the
single-entry split rule (`suggestSplitForEntry`) over the owner's unsplit
expenses of the last 90 days, grouped by shop, payer, group, share and
currency. `src/domain/pages/usually-shared.ts` loads two bounded reads (the
newest 500 candidates; the newest 6,000 of the 455 days of history) and the
route `GET /api/splits/usually-shared` is read only, never part of a page
DTO, read by a lazy Splits section after the page is on screen. The write is
`addEntriesToSplitsRecord` (`POST /api/splits/expenses/add-usual`): the same
split rows as Add to Splits (one shared statement builder), one audit event
and the month refresh markers in ONE batch, refused entries named with their
reason, at most 200 and "Yes, add all N" over 10; Undo is
`removeSplitExpensesRecord` (`/remove-added`, one batch, settlement lock
checked). Ask offers the same list as a change card (`add_usually_shared`,
`ask-usually-shared.ts`) saved only through those two routes. It never applies
by itself and no AI chooses what is on the list. The Entries picked-rows bar
reaches the same command by hand ("Add to Splits": one chosen group and share
for all, `POST /api/splits/expenses/add-chosen`, audit `split_expenses_added_chosen`),
so a shop with no history can still be added in one step, with Undo.

### Trips and events (current, 2026-11)

A trip or event (DOMAIN.md "Trip or Event") gathers entries such as "Seoul
trip" or "Mum's 70th" across categories, people and months. It is its own
additive model, not a kind of split group: `trip_events` holds the name,
icon and optional dates, currency and split group link, and
`trip_event_entries` holds one row per entry (so an entry is on at most
one). Every reader tolerates the tables missing; the feature is then off.
The commands (`src/domain/app-repository-trip-events.ts`, routes in
`src/server/trip-events-route.ts`) are all-or-nothing with one audit event,
and Undo reads that audit event back. No month total changes, so no month
refresh markers are written. The one place the feature touches existing
commands is the carry through corrections: a wrong-card Apple Pay copy or a
statement's second copy hands its trip to the entry that stays
(`buildTripEventCarryStatements`, one more statement in that correction's
own batch). Summary and Month do not change (owner decision 5).

Suggestions (slice 5) are reads, never writes: the review list
(`GET /api/trip-events/suggestions`, `trip-event-suggestions.ts`) groups and
ticks a trip's likely entries from its dates, its currency (a kept Wallet
amount or the bank line's printed amount) and its linked split group, with
home bills never ticked; "Booked before you went?" (`/search`) looks back
12 months before the first day; the Entries page names a suggested trip on
new Apple Pay entries (`suggestedTripEventId`, the dashed chip) in the same
round trip as its rows' trips (`loadTripEventRowFacts`). Nothing joins a
trip until the person taps. The one automatic link is owner decision 3:
adding an entry to a linked split group's splits puts it on the trip too,
as a second all-or-nothing command after the split command saved
(`followSplitGroupTripEvent`, called from the from-entry route), so a failure
there leaves the split saved and the entry on no trip.

### Shortcut integration boundary

The Apple Pay integration uses a dedicated direct-create route rather than the
browser entry form. The Apple-signed shortcut must remain secret-free. Settings
owns key generation, connection-URL copy, the verified signed-file install path,
and default account priority. There is one connection per person (key,
Default account order, card for other currencies; the first person's is the
household's original), chosen under "Who is this phone for?", and an entry
saved through a connection is always that person's
(DOMAIN.md "Shortcut Connection"). Ask can also ask a one-line card question
for a new entry at a shop mostly paid on another card
(DOMAIN.md "Card Suggestion").

Production serves that route through the `monies-map-shortcuts` Worker. It
shares the production D1 database but has no static assets and returns `404` for
every path except `/api/shortcuts/entries/create`. This keeps the main
`monies-map` Worker behind Cloudflare Access while allowing iOS Shortcuts to
reach the app-owned token boundary without an interactive Access session.

The application route itself is also hardened for a staged move to a single
Worker: it accepts only `POST` at `/api/shortcuts/entries/create` and returns
`405` before schema or page work for every other method. The legacy Shortcut
Worker remains the live endpoint until an exact-path Cloudflare Access Bypass
application is configured and verified. Only then may Settings switch its
published connection URL to the main Worker; the legacy Worker must remain
deployed until installed shortcuts have migrated.

The direct-create route accepts authenticated URL or header token transport.
The shared shortcut receives that URL through an import question on a plain
Text action and passes the action output to the POST request. A URL-action import
question is not used because Apple's URL-list setup editor can discard a pasted
connection URL. Nonce and timestamp headers are an optional complete pair for
advanced clients; when present, replay and freshness checks remain mandatory.
The shortcut body contains transaction facts plus `requestId` and
`clientVersion`. The request ID is stored as a unique external reference so an
HTTP retry returns the existing row. Personal Transaction automations remain
device-local Apple configuration and are not represented as app state. The
supported handoff is one Transaction automation creating a Dictionary with
`value`, `merchant`, and `name`, then running `Monies Map Apple Pay API` with
that Dictionary as input; no second helper shortcut belongs in the chain.

The API normalizes strict ISO or day-first dates, Wallet currency text, bounded
descriptions, and typed optional fields before persistence. Explicit active
accounts win. Otherwise an exact unique Wallet `name` match selects an account,
then the configured active priority is the fallback. Named Wallet currency must
match the selected account currency. The response returns normalized transaction
facts, account identity and resolution, creation status, and `openUrl`. The
shortcut opens `openUrl` only when present and shows merchant, amount, and
resolved account in its success notification. `openUrl` opens the Ask page
on the saved entry's card (`/ask?saved_entry=<id>`, built by
`buildShortcutEntryOpenUrl` in `src/server/shortcut-gateway.ts`), which
offers a category when it landed in Other and Splits; the Entries link
earlier responses carried (`/entries?editing_entry=<id>`) still opens the
entry in Entries.

The repository owns the durable shortcut source under
`shortcuts/apple-pay-api/`. It stores a reviewable secret-free plist, the exact
Apple-signed `anyone` release, and a manifest binding the source, versioned
release, and byte-identical public file to checksums. The project owner's
personal `Monies Map Apple Pay API Source` duplicate is a convenient editing
backup, not an architectural dependency or the canonical source.

The app serves the signed file from `/shortcuts/monies-map-apple-pay-api.shortcut`.
Local replacement affects only one installed copy. Shortcut revisions require
Apple signing and an atomic update to the repository artifacts, manifest,
Settings install path, browser contract, and user documentation. The superseded
v1 iCloud record is not part of the active install path.

### Savings model

The app should treat `savings target` as a first-class monthly planning input.

Rules:

- `savings target` is explicit monthly intent
- `savings target` is not inferred from a row label such as `Savings`
- `savings target` does not need to match a ledger entry
- `realized savings` is a derived outcome from actual ledger activity
- optional planned savings movements may still exist as matchable `month plan
  rows`, but those are not the same concept as the top-level `savings target`

### Plan Studio (current, 2026-10)

The Month page's Plan view is a set of money jobs (DOMAIN.md "Plan Studio"):
where planned money in goes, how the month is going against the plan (pace by
due date, never a forecast), What if I save more? and every plan row with a
slider and an exact amount. It is a lazy chunk of the Month route, reads only
the Month page DTO (no new field) and saves through the existing all-or-nothing
`applyMonthPlanChanges` command, so there is no new write path. Held changes
live in the page until Save plan. The model is pure and tested
(`plan-studio-model.js`, `plan-studio-edit.js`, `plan-studio-slider.js`).

v2 (2026-10-15): one list grouped by money job (dated spending items sit in
Spend), a slider popover with a row's past (the Month page DTO's small
`history` tuple per plan row, `src/domain/month-plan-history.ts`), Planned in
by source, money that arrived beyond the plan (Add to Savings through the same
save), and a Sliders | List switch remembered per login
(`POST /api/viewer-preferences/plan-mode`). The only new reads are at most
three tracked months before the page's month; the only new write is the
preference. See `docs/audits/plan-studio.md`.

## Documentation Standard

When changing architecture:

- update `AGENTS.md` if the rule must be followed every prompt
- update `DOMAIN.md` if the vocabulary changes
- update `design.md` if client boundaries or deep-module rules change
- update `docs/code-spec.md` if implementation rules, query budgets, or code
  shape constraints change
- update this file if the target structure, delivery stages, or technical
  direction changes

## Delivery Plan

The plan is TDD-first and no large rewrite should begin without stage-level
tests and acceptance criteria.

### Stage 0: Freeze vocabulary and rules

Goal:
- establish one source of truth for terms and repo guidance before moving code

Actions:
- keep `AGENTS.md` as the prompt-time instruction file
- keep `DOMAIN.md` as the canonical vocabulary
- keep page-specific glossaries subordinate to `DOMAIN.md`
- define vertical slices, TDD, and deep modules explicitly in the docs

Exit criteria:
- a contributor can answer where repo rules live
- a contributor can answer where domain terms live
- a contributor can answer what counts as a slice, scenario test, and deep
  module in this repo

### Stage 1: Define the scenario test map

Goal:
- turn each page and each cross-page workflow into a readable scenario catalog

Actions:
- list core scenarios for `Summary`, `Month`, `Entries`, `Imports`, `Splits`,
  and `Settings`
- list cross-page scenarios such as:
  - import affects entries
  - import affects month actuals
  - entries edits affect summaries
  - split matching affects entries and splits views
  - settings reference-data changes affect later imports and edits
- classify each scenario by test level:
  - domain/unit
  - integration/API
  - end-to-end
- include desktop/mobile interaction contracts when the same feature uses
  different containers, such as inline filter bars versus mobile filter sheets

Exit criteria:
- each page has a scenario list
- each cross-page workflow has at least one acceptance scenario
- new work can start from scenarios instead of from component internals

Artifact:
- [`docs/scenario-catalog.md`](./scenario-catalog.md)

### Stage 2: Define the target slice boundaries

Goal:
- decide where code should live before moving it

Actions:
- define the public boundary of each slice:
  - routes/screens
  - query surface
  - selectors/view helpers
  - mutations/workflow actions
  - test surface
- identify current files that belong to each slice
- identify shared modules that should remain shared versus code that should move
  back into a slice

Exit criteria:
- each existing client file has an intended future home
- shared modules are justified, not accidental
- slice boundaries are readable without opening many files

Artifact:
- [`docs/slice-inventory.md`](./slice-inventory.md)

### Stage 3: Replace bootstrap-heavy loading with TanStack query slices

Goal:
- move from broad bootstrap hydration to minimal, screen-owned data fetching
- remove the old path in the same slice once the replacement passes the slice
  tests

Actions:
- inventory current refresh, prefetch, quick-entry, and cross-tab behaviors
  before replacing them
- define query contracts for summary, month, entries, imports, splits, and
  settings
- separate aggregates from row-level queries
- separate month list queries from month detail queries
- keep invalidation narrow and predictable
- remove hidden data dependencies on one giant bootstrap payload
- do not leave a compatibility path alive after the slice owns its new query
  boundary

Exit criteria:
- each screen can describe which query powers it
- loading one screen does not require hydrating unrelated screens
- mutations invalidate only the affected slices

Artifact:
- [`docs/query-map.md`](./query-map.md)
- [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md)

### Stage 4: Refactor into deep modules inside each slice

Goal:
- hide slice complexity behind small, readable APIs

Actions:
- create or reinforce slice-level deep modules
- move low-level helper graphs behind those boundaries
- keep public APIs short and intention-revealing
- reduce direct component imports from many helper files
- start with the slice that has the clearest scenario coverage and the fewest
  hidden cross-slice dependencies
- keep Stage 3 as the foundation for this stage; do not start deep-module
  refactors before the query map is in place

Exit criteria:
- page components read as orchestration and rendering, not helper plumbing
- a new contributor can follow one slice without reading the whole app
- helper sprawl is reduced measurably

Artifact:
- [`docs/implementation-order.md`](./implementation-order.md)

Before implementation work, also use:

- [`docs/preimplementation-checklist.md`](./preimplementation-checklist.md)
- [`docs/known-coupling-targets.md`](./known-coupling-targets.md)
- [`docs/implementation-prompt-template.md`](./implementation-prompt-template.md)
- [`docs/refactor-decisions.md`](./refactor-decisions.md)
- [`docs/archive/first-slice-prompt.md`](./archive/first-slice-prompt.md)

### Stage 5: Tighten backend boundaries to match the slices

Goal:
- keep the client cleanup matched by explicit backend seams

Actions:
- verify DTO boundaries for each slice
- keep domain calculations pure where possible
- separate route handlers from repository internals
- align backend query shapes with the TanStack slice contracts

Exit criteria:
- API responses match slice needs cleanly
- route handlers are not mixing domain and persistence concerns
- DTO naming aligns with `DOMAIN.md`

### Stage 6: Simplify for readability

Goal:
- make the code feel standard, short, and obvious to follow

Actions:
- rename modules and functions toward domain terms
- remove unnecessary abstractions and duplicated indirection
- prefer short files when a split increases clarity
- prefer slightly duplicated simple code over premature shared complexity

Exit criteria:
- the common data flow of a feature is visible in a few files
- module names match user workflows
- average changes touch one slice more often than many unrelated helpers

## Optional AI Assistance

AI is a non-authoritative assistance boundary. It is never on the
page-load, import-preview, import-commit, reconciliation, or freshness critical
path. Every AI action is an explicit user action; within a conversation the
user started, the chat may ask follow-up questions. Each request is capped by
a shared D1 daily usage counter and returns an ordinary unavailable response
when the binding is disabled, the allowance is exhausted, or a model response
fails validation.

Providers sit behind one deep module, `src/domain/ai-provider.ts`
(`runVisionJson`, `runTextJson`). When the owner configures Cloudflare AI
Gateway and a key, Claude Haiku (`claude-haiku-5-5`) answers first, with
gateway logging and caching off on every request and a hard monthly gateway
spend limit; Workers AI (Gemma 4) is the fallback for a rate limit, spend
cap, failure, timeout or unusable answer. With no gateway config, Workers AI
is used directly. Neither provider is required: the route answers
unavailable and the client uses its deterministic fallback. Receipts, Ask's
answer wording, the Monthly Note draft, statement-mismatch wording,
category-rule suggestions, the statement text fallback and the entry draft
all use it; match ranking uses Workers AI embeddings. A monthly Claude
target (`AI_CLAUDE_MONTHLY_TARGET_USD`, default 8) paces who is asked first
(auto-balance: Claude first under pace, the basic model first for background
help over pace, for everything at 90% of the target), deterministically and
without AI; Settings shows the month's line.

The app cannot buy Claude credits. After each Claude attempt the provider
writes one aggregate row (`ai_provider_status`: last failure kind and time,
last success time, estimated spend since the owner's last top-up mark) so
`GET /api/ai-assist/provider-status` can tell the viewers in
`AI_ALERT_EMAILS` (everyone when it is `"*"`, as `wrangler.jsonc` ships)
that credits are low, used up or capped by the gateway, with a link to the
Claude Console billing page; anyone not listed sees nothing.
The write never fails or holds an AI answer. Ask shows it as one inline
notice at the top of the conversation and Settings in its Ask and AI
section, both reading the status lazily once their route is usable
(design.md "Claude credit notice").

```text
receipt image (user pasted, dropped, scanned or shared; browser downscales,
strips EXIF/location)
  -> POST /api/ai-assist/receipt-read (type, bytes and 1.5 MiB checks)
  -> AI off/unconfigured? -> { available: false } -> in-browser OCR
                                -> readReceiptOcrText -> ReceiptReadDto
  -> reserve daily allowance (aggregate counter is the only write)
  -> Claude via AI Gateway (if configured) -> else/fallback Workers AI
  -> finalizeReceiptRead (app validates date, total, currency, card last 4;
     builds questions)
  -> ReceiptReadDto draft -> receiptReadToDraftFields -> entry editor
  -> user taps save -> normal /api/entries/create
(the image is discarded after the provider call; nothing else is stored)
```

Summary, Month, Entries, and Splits render their Money insights from
already-loaded figures with computed wording only (see "Money insights"
below): the headline is the bold fact and its think line as written. There
is no AI rewording; the optional `/api/ai-assist/financial-insight` route was
removed after it produced broken grammar in production.

Entry drafts: `POST /api/ai-assist/entry-draft` takes `{ text, viewId? }`
and returns `{ ok, draft: EntryDraftDto, ai }`. The deterministic parser
(`src/domain/entry-draft.ts`) always answers, from read-only reference data
(`entry-draft-context.ts`: accounts without balances, people, category names,
category rules, the Shortcut's Default account priority and other-currency
card, and each person's payment ways). A payment word ("paynow", "NETS",
"cash") with no account named picks that person's payment way account,
marked `rule` (DOMAIN.md, "Payment Way"). Only when the sentence named no amount or left no description does
the route spend one allowance unit asking AI, sending the redacted sentence
alone (300 characters, 80 tokens). The answer fills only those gaps, marked
`ai`, after validation; anything else returns the deterministic draft with
`ai.available: false` and the reason. The route writes nothing but the
shared allowance counter: the user saves a confirmed draft through
`/api/entries/create`, whose body the draft's `createBody` already matches.

The Ask page is the client of both readers: a typed sentence goes to
`/api/ai-assist/entry-draft` only when the person sends it, and a receipt
photo to `/api/ai-assist/receipt-read` only when they pick, paste or drop
one; both answer with drafts the entry card shows for the person to save
through the normal create route, and both failing leaves the card manual
(a receipt is then read on the device). The photo is downscaled and
re-encoded in the browser (no EXIF or location) and never stored
(`ask-api.js`, `ask-receipt-image.js`).

Apart from a receipt image the user explicitly supplies, the Worker receives
bounded, redacted text only. Statement fallback begins with
browser-local PDF extraction and OCR; it sends extracted text after explicit
consent and never uploads or stores the original binary. Model output is
validated into drafts only: monthly note wording, pending category-rule
suggestions, review-only statement rows, an entry draft's missing amount or
description, or semantic scores for candidates that
the deterministic matchers already selected. The ledger, D1 data, category
rules, checkpoints, reconciliation calculations, and import inbox stay
authoritative. Before any AI explanation of a month's spending or income,
the deterministic `skew candidates` (see "Skew candidates" above) are the
evidence of likely unlinked settlements and own-account moves; AI may phrase
them but never decides or links them.

Ask's money answers follow that order (`POST /api/ai-assist/answer`,
`src/server/ask-answer-route.ts`): rules read the question into one of nine
intents (where and why the money went, the plan, two months compared, the
biggest expenses, income, who owes whom on Splits, and the money jobs'
invested, saved and spending against income, read through the lead's own
`splitMoneyUse`), over one month or a period of up to 12; a high-confidence skew
candidate that would change the facts is asked about first, with Mark as
settlement or Link as transfer (the candidate's suggested routes, run by
the person's tap) and It's real spending; the facts are read from the Month
and Splits page DTOs, so the answer's figures equal the screens its chips
open; a computed 1-3 sentence wording is always ready. Only with AI on may
the provider phrase that wording from a bounded fact list, and the phrasing
is shown only when every number and name in it is in the facts
(`validateAiWording`). Nothing but the allowance counter is written
(`docs/audits/ask-answers-audit.md`).

The Money consequence map that used to sit under "See all insights" was
retired in September 2026: it repeated what the signals say, and its
one-repeat scenario bordered on a forecast. Plan variance, the already-loaded
same-season comparison and bank-proof gaps are now check-in signals only (a
plan Worth knowing or Something to think about, the same-season Big picture and the
statement-gap To do with "Compare with the statement"), and the AI facts carry no
map. Nothing in Money insights predicts spending or gives a safe-to-spend
figure. The one look ahead is the scheduled check (October 2026): a bank
account's latest statement balance against payments that already repeat
from it, due within a month, shown only as a To do when one cannot fit.

## Money insights (the check-in)

The check-in is a pure, deterministic domain module
(`src/domain/money-signals/`): one small function per signal over data the
page already loads (Summary: month totals, category totals per month, the
view's account pills joined to reference account kinds; Month: entries, plan
rows, income rows, the month's totals and account pills; Entries: the
month's list for the view and scope; Splits: the selected group's balance,
open activity, match candidates and settlements). It adds no endpoint; the
same-season line shows only when last year's month is already in the range.
Two small facts ride on payloads the pages already load: the account pills
carry each bank account's routine (`account-routines.ts`: moved income,
missed payments, account charges, own-account transfers counted as income
and the scheduled check, from one read of the bank entries in the last 200
days beside the card window), and an open settlement checkpoint carries its
likely payment (`paymentCandidate`, one small query per open checkpoint).
`checkin.ts` ranks the signals (quick fix, bigger question, a moment, worth
a look, going well; then money, then not recently seen) and decides rests,
"what changed", sorted and quiet visits from `nowMs`, `today`, a stable
seed and the visit memory, which the client keeps only in localStorage
(`checkin-visit-memory.js`). A signal that is true almost every month
(the five largest entries, subscriptions, months under plan, plan left) is
`steady` unless its numbers are unusual: it never leads except in its
quarter turn, so no always-true line leads month after month; a month with
nothing notable leads with a Going well or the calm line. What rotates (the wording, the long view's
lead, the Fun fact line, the quote, the calm line) follows the period
being viewed (`rotation.ts`): for one page and view nothing repeats within
twelve consecutive periods, whatever the browser remembers or forgets. The
quote library is a separate chunk loaded when "See all insights" opens.
Summary's signals and copy pools are a separate chunk too: its import
starts with the Summary route's own, the route never waits for it, and
until it arrives the insights show only their frame
(`money-insights-loader.js`). App loads the active route's code beside its
data, so in practice the insights paint complete the first time.
Every line passes the tone lint (`tone.ts`); all copy and each page's
rotation are listed in `docs/money-insights-copy.md`.

## Scenario Planning Standard

Every new feature or refactor stage should define scenarios in this shape:

1. User intent
2. Starting state
3. Action
4. Expected visible result
5. Expected persisted or queried result

Examples of scenario families to define:

- Imports:
  - see stale accounts and expected bank files before logging into banks
  - collect files by bank session while reviewing statements in chronology
  - drop multiple downloaded files without filename conventions or original-file
    storage
  - import a known file
  - flag an activity row inside a confirmed statement when no certified row
    covers it; require an explicit review before it enters the ledger
  - review preview rows
  - commit rows
  - see imported effects in entries and month views
- Entries:
  - edit category, owner, note, transfer, or split behavior
  - see aggregate changes where relevant
- Month:
  - review plan versus actual
  - inspect drill-downs
- Splits:
  - create expense
  - match ledger entries
  - settle balances
- Settings:
  - change categories, people, or accounts
  - confirm later flows use the changed reference data

## Non-Goals

This plan does not aim to:

- rewrite the domain model from scratch
- replace D1 or Workers
- chase abstract purity over readable product code
- force one test type to cover all behavior

## Immediate Next Planning Artifacts

Before implementation, the next useful planning documents are:

- a migration order that reduces risk and preserves working behavior


The phone island's contextual controls reuse the Entries filter publication and
URL reset, with a lazy context body shared with the mobile View and scope sheet.
Default scope wording gives way to the filter summary without changing island
height; non-default scope stays visible above the existing list without changing
its padding. Month's return-to-current-month action stays within the displayed
range. Splits clears its search through the group strip. No API, DTO, query,
persistence, or optional AI boundary changes. See design.md, "Island context line",
and `tests/e2e/island-context.spec.js` for layout and continuity contracts.
Summary's cards under the top summary render in each person's own order and
can be hidden (`summary-card-order.js`, DOMAIN.md "Summary Card", design.md
"Arrange Summary"): a per-login viewer preference like the lead view, its
editor in a lazy chunk, and a registry test that fails for any card that is
not registered.
The desktop floating island shares the lead-view preference on Summary and
Month. Entries names its selected month between matching navigation arrows;
the Splits bar exposes only groups with open entries and keeps archived batches
in their existing dated history surface.

The mobile filter summary and sheet share one resolved lazy component so a
summary tap can synchronously mount and focus search. Opening intent is captured
once per sheet visit; the owner chip has none. The Month route portals mode
switching into the shell's island host; Plan Studio portals its own Undo callback
only while visible and editable. Draft/history ownership stays in Plan Studio.
Pinned slider explanations and figure action menus consume outside presses;
interactive row/amount popovers and Summary/Month header menus are modal.
Live drag hints stay passive.
The unit runner shares only a freshly seeded template across test files, with
private real-D1 copies per test and a separate path for custom fixtures.
