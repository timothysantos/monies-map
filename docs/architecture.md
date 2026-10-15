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
"Wallets in view" row for the investment account carries a plain sentence
("Worth $x on 30 Sep 2026, from its statement"), read from the account-pills
slice Summary already loads, so no page payload grows for a household with no
investment statement.

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
