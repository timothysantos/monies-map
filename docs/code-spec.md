# Code Spec

This document is the compact implementation spec for Monies Map.

Read it after [`docs/architecture.md`](./architecture.md) and before touching
query wiring, slice modules, or page workflows. It exists to keep the
implementation phase constrained enough for humans and smaller coding models.

## Reading Order

Use this order for implementation work:

1. `AGENTS.md`
2. [`docs/architecture.md`](./architecture.md)
3. [`DOMAIN.md`](../DOMAIN.md)
4. one or two task-specific docs only:
   - behavior: [`docs/scenario-catalog.md`](./scenario-catalog.md)
   - boundaries: [`docs/slice-inventory.md`](./slice-inventory.md)
   - queries: [`docs/query-map.md`](./query-map.md)
   - current guardrails:
     [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md)
   - responsive behavior:
     [`docs/responsive-behavior.md`](./responsive-behavior.md)
   - CTA semantics:
     [`docs/interaction-guidelines.md`](./interaction-guidelines.md)
5. this file for implementation shape and performance limits

Prompting rule for implementation:

- name the target slice
- name the target scenarios
- name the target query contract
- name the target responsive/interaction docs only if the workflow touches them

## Why The Worker Sometimes Goes 503

The current app already shows the main risk:

- broad first-load requests can still be slow if they pull too much data
- `src/index.ts` logs API pages as slow at `750ms`
- `src/client/App.jsx` still owns the shell and route orchestration
- E2E tests already defend against "worker restarted mid-request"

The likely failure mode is:

1. a broad request ties up too much worker time or memory
2. the worker restarts, stalls, or gets temporarily throttled upstream
3. the client retries while the worker is still unhealthy
4. many routes fail together until the isolate recovers

This refactor should reduce that risk by:

- replacing broad bootstrap hydration with smaller slice-owned requests
- removing old paths in the same slice once a replacement passes tests
- avoiding eager prefetch storms
- keeping warmup cancellable and low priority
- invalidating narrowly instead of reloading the world after each write

## Performance Budgets

These are target budgets, not platform guarantees.

The current slow-log threshold is `750ms`. New visible page queries should aim
to stay well below that.

| Query / workflow | Target server time | Stretch limit | Notes |
| --- | --- | --- | --- |
| `appShell` | `<= 100ms` | `200ms` | route-neutral shell only; no accounts, categories, page payloads, balances, checkpoints, or import history |
| `referenceData` | `<= 150ms` | `250ms` | account/category dropdown data only; no transaction or checkpoint scans |
| `summaryPage` | `<= 300ms` | `500ms` | aggregates only |
| `summaryAccountPills` | `<= 200ms` | `350ms` | keep separate if costly |
| `monthPage` | `<= 350ms` | `600ms` | month rows and metrics only |
| `entriesPage` | `<= 400ms` | `650ms` | paged or filtered, not full world |
| `importsPage` | `<= 250ms` | `400ms` | list and lightweight metadata |
| `importPreview` | `<= 700ms` | `1200ms` | heavy but draft-sensitive |
| `splitsPage` | `<= 300ms` | `500ms` | slice-owned |
| `settingsPage` | `<= 350ms` | `600ms` | settings forms plus full account diagnostics and checkpoint history |
| warmup / prefetch | `<= 250ms` | `400ms` | must yield to visible work |

Measured at the 10k stress fixture after the macro performance work
(`docs/audits/macro-loading-baseline.md`), all well inside these budgets:
Entries ≈23 ms handler / 38 KB gzip, Month ≈31 ms / 47 KB, Summary (12
months) ≈77 ms / 2 KB, Splits ≈31 ms / 3 KB, account pills and Imports
≈30–35 ms. Payload size, not handler time, is what grows with ledger size.

Budget rules:

- visible page queries over `750ms` are a design smell
- warmup must stop before it competes with the active page
- one slow query is acceptable temporarily; broad slow dependency chains are not
- mutations may take longer, but their follow-up invalidation should stay narrow
- account/category mutations refresh `referenceData`; only viewer/person/demo
  changes should refresh `appShell`
- entry-row edits and split-link actions from `Entries` must not invalidate
  `appShell`; they refresh slice queries only and rely on split/entry mutation
  events for cross-tab freshness
- the app shell must not statically import route-only UI, page editing controls,
  or a broad client facade that retains those modules; use route-owned lazy
  modules and direct shared helper imports for the few shell-level operations
- optional work (route code warmup, speculative data, AI wording) starts only
  when `routeWork.usable` is true and goes through the warmup scheduler; do
  not add new idle prefetch effects
- mobile speculative data needs a row in `route-warmup-admissions.js`
  measured with `tests/performance/api-admission.spec.js` on the 10k
  fixture; `maxDataBytes` is compared with gzip bytes
- mobile speculative data also needs a reported `4g` connection, or an
  unknown one (`navigator.connection` missing, as on iPhone) together with a
  measured recent required request of at most `maxRecentRequiredMs`
  (500 ms); a missing or slower measurement, `slow-2g`/`2g`/`3g`, data
  saver, the quiet period, one request per visit, open editors and in-flight
  work still deny it
- a refresh after a save runs through `runBackgroundRefresh`
  (`use-refresh-notice.js`); never swallow it with `.catch(() => null)`. A
  failure keeps the saved data on screen and shows the inline refresh
  notice with "Refresh now"; aborted, cancelled, superseded or left-route
  failures stay silent, and a background refresh never raises the page
  error screen
- the Entries page DTO is written only through `entries-data-owner.js`, so
  a refresh started before a month or view change cannot overwrite the new
  month or end its loading state
- a load or refresh that fails before the request's own page was shown is a
  load failure, not a refresh failure: show the page `ErrorPanel` with the
  shell's retry in place of the stale figures and rows (Entries:
  `loadError`), never the previous period's data or an empty state
- a dialog or sheet that writes checks `response.ok`, shows a saving state,
  takes one submit, ignores Escape and Cancel while in flight, and closes
  only on success; a failure keeps the draft with an `InlineError`
- a portalled dialog that can open inside a form or clickable row stops
  React `submit`, `click` and `keydown` bubbling at its overlay and content
  (`category-edit-dialog.jsx`)
- a page DTO carries only what its route reads; do not embed another route's
  page DTO (Splits carries the month key and transfers, not the Month page)
- page APIs report `Server-Timing: app;dur, init;dur;desc, total;dur`; keep
  `app` first because budget checks read the first `dur`
- enforced budgets: `npm run check:bundle` (first-screen JS and CSS, gzip,
  +5% of `scripts/initial-bundle-budget.json`, run by `npm run verify`) and
  the page-response size test in `tests/e2e/api-performance.spec.js` (+10% of
  `tests/e2e/api-payload-budget.json`, run by the smoke bundle)
- CSS that only one lazy route uses goes in a stylesheet imported by that
  route's module (`month-mid-width.css` from `month-panel.jsx`,
  `splits-panel.css` from `splits-panel.jsx`), so it ships with the route;
  `public/styles.css` counts toward the first-screen budget
- no `:has()` that searches all descendants (`body:has(.x)`): on a large
  month each restyle of an element such a rule styles walks the whole page.
  A portalled layer uses `body:has(> .x)`; an element inside the page holds
  a `<body>` flag through `page-flags.js` (design.md "Page State Rules";
  `tests/page-flags.test.mjs` enforces it)

## List Rendering Contract

A month can hold thousands of entries (the 10k stress fixture puts 2,000 in
2026-05). Lists that grow with the ledger follow these rules, measured in
`docs/audits/macro-loading-baseline.md` ("Entries and Month list
rendering"):

- Rows are `memo` components whose props are the row's own data, a few
  primitives and stable handlers. Pass handlers through `useStableHandler`
  (`src/client/use-stable-handler.js`) or a `useCallback` with no changing
  inputs; never an inline closure or a function recreated on each render.
- Anything only an open editor needs travels in one bundle given to the
  open row alone (`editor` in `entries-list.jsx`). Closed rows never
  receive editor, saving, transfer or draft state.
- Derived row data keeps object identity. `entry-row-projection.js`
  caches each projection by entry object and view, and `mergeEntriesById`
  returns the current object when a merge changes no field. Do not spread
  entries into new objects in a selector that feeds rows.
- A memoized component that prints money through the shared formatter
  subscribes with `useMoneyPrivacy()`. Keep that subscription on the
  smallest piece that prints money (`EntryRowAmount`), so the toggle
  redraws amounts, not rows.
- Per-row dialogs, popovers and heavy widgets mount only while open
  (`CategoryAppearancePopover` mounts its dialog on open).
- Expensive scoring runs when its real inputs change, not on every
  checkbox or keystroke in the same dialog (Month plan-link candidates).
- Closed Entries rows use `content-visibility: auto` with a measured
  `contain-intrinsic-size` of the row's content height (67 px desktop,
  88 px mobile: the rendered row minus its 1 px top border, which the
  intrinsic size excludes). Rows stay in the DOM, so find-in-page, Tab focus
  and screen readers reach every row; the open row is never skipped. Update
  the intrinsic size if the row layout changes height.
- Scrolling to a row more than two screens away is instant
  (`longJumpOr` in `entries-list.jsx`): a long smooth scroll renders
  estimated rows on the way and ends off target.
  `tests/performance/entries-deep-link.spec.js` checks a deep link to row
  1,500 and 1,990 lands where row 5 does.
- Entries is not windowed. Windowing would remove off-screen rows from
  the DOM, breaking find-in-page and Tab order through the list; add it
  only with a measured reason and a plan for those.
- Proof: `tests/e2e/entries-row-rendering.spec.js` and
  `tests/e2e/month-plan-link-rendering.spec.js` count row renders through
  the React DevTools hook (`tests/support/react-commit-counter.js`).
  Timing: `PERFORMANCE_FIXTURE=scale-10k npm run test:performance`
  (`entries-interaction.spec.js`, `month-interaction.spec.js`), compared
  with `node scripts/compare-performance.mjs --interaction <before> <after>`
  over several runs per side.

## Optional AI Contract

Workers AI belongs outside the normal query and mutation graph. Most actions
are explicit. A Financial insight may make one debounced, non-blocking wording
request after a stable page/filter state, only while the route is usable (no
editor or save open), when the computed-facts key is absent from a
short-lived in-memory cache; an aborted, non-OK or stale response is neither
shown nor cached. It must render deterministic wording first,
must not persist that cache, and must return an ordinary unavailable result
when disabled, unconfigured, quota-limited, or invalid. No visible page query,
import preview or commit, accounting calculation, reconciliation, category
application, duplicate decision, transfer decision, or Import Inbox plan may
await it.

An AI response is a bounded draft, explanation, or ranking over deterministic
evidence already selected by the app. The existing editor or review action is
the only way to persist a change. Keep request payloads redacted and bounded;
do not persist prompts, model responses, original bank files, raw OCR images,
or embeddings. Each AI change needs a no-AI test and a failure-path test in
addition to the normal behavior test. Financial insight wording must distinguish
full cash flow from a filtered investigation view and from split-settlement
obligations, and must not invent forecasts, savings targets, or comparisons.
AI wording may only choose words around the check-in's fact and think line,
which stay verbatim; a template without both, with its own figures, or
failing the tone lint is refused.

Money check-in signals live in `src/domain/money-signals/`, one small pure
function per signal returning `{ key, kind, weight, numbers, phrasings,
action? }` or `null`, with its copy in the page's catalogue beside it. They
read only data the page already has (no new endpoint or payload), take
`today` and the money formatter as inputs, and never call `Date.now` or
`Math.random`; ranking and rotation in `checkin.ts` take the clock, the
visit memory and a stable seed. Each signal needs a unit test that it fires
with concrete numbers and exact wording, and one that it stays silent.
Actions may only reuse navigations the page already has. Summary's signals
are on the first screen: keep them compact, and put anything large (like the
quotes) behind a dynamic import.
The Money consequence map is deterministic UI evidence, not model output. A
same-season lane requires an already-loaded matching calendar month; a
one-repeat lane must identify itself as a scenario rather than a forecast; and
bank-confidence wording requires explicit reconciliation/transfer signals from
the page rather than inference from a filtered ledger view.

## Query State Chart

```text
Route intent
  -> Resolve route params
  -> Start primary query only
  -> Render shell / keep previous safe data
  -> Primary query settles
  -> Render active page
  -> If page is stable, maybe start one warmup query

Mutation intent
  -> Check for active workflow lock
  -> Save mutation
  -> Apply optimistic or immediate local state if needed
  -> Invalidate exact affected queries
  -> Cross-tab notify if data changed
  -> Reconcile stale queries when safe to replace
```

## Query Ownership Contract

Each slice owns:

- route-to-query param mapping
- query key builder
- query option builder
- mutation invalidation map
- selectors that shape query data for UI
- tests for route contract and invalidation behavior

URL parameter names (`view`, `summary_start`, `summary_end`) differ from key
field names (`viewId`, `startMonth`, `endMonth`). Translate them only in
`query-keys.js` (`monthPageKeyFromParams`, `summaryPageKeyFromParams`), never
inline. A route's fetch key and its mutation invalidation key must be equal
for every person; `tests/query-foundation.test.mjs` holds that matrix. Keys
that still use URL names (Entries, Splits) must be built from the same URL
params on both sides.

Each slice must not own:

- another slice's hidden query dependencies
- broad bootstrap reads as a shortcut
- compatibility fallbacks that outlive the slice that introduced them
- global refresh side effects that ignore workflow locks

## Invalidation Contract

Use this shape for each mutation:

```text
Entry save
  -> invalidate entriesPage for current route
  -> invalidate monthPage for affected month/view/scope
  -> invalidate summaryPage for affected summary range(s)
  -> invalidate summaryAccountPills if account balances can change
  -> notify cross-tab listeners
```

```text
Month plan save
  -> invalidate monthPage for affected month/view/scope
  -> invalidate summaryPage for affected range
  -> keep open editor stable until save settles
```

```text
Import commit / rollback
  -> invalidate importsPage
  -> invalidate entriesPage for affected months/accounts
  -> invalidate monthPage for affected months
  -> invalidate summaryPage for affected ranges
  -> invalidate summaryAccountPills for affected accounts
  -> clear persisted shell cache
  -> broadcast cross-tab refresh
```

Invalidation rules:

- invalidate the smallest key set that can be defended clearly
- do not use "invalidate everything" as the default
- stale is allowed immediately; visible replacement is not allowed if it would
  clobber an active workflow
- if a slice needs shell refresh for a shared-metadata exception, isolate it
  behind a named helper and document why it is not the normal invalidation
  path

## Workflow Lock Contract

Protected workflows include:

- quick entry opened from URL
- mobile entry edit sheet
- mobile filter sheet with in-progress state
- month add/edit sheet
- import preview draft
- split-group selection flow

Protected workflow pseudocode:

```text
if workflowLock.isActive(slice, workflowId):
  markQueriesStale()
  deferVisibleReplacement()
else:
  refetchAndReconcile()
```

## Persistence Atomicity Contract

A persistence command is all-or-nothing:

- read and validate everything first (lookups, existence and lock checks,
  snapshots needed for undo, generated ids); throw before the first write
- then commit every write of the command, its audit event
  (`buildAuditEventStatement`) and its month refresh markers
  (`buildMonthlySnapshotRefreshMarkers`) in one `db.batch()`. D1 runs a batch
  as one transaction and rolls it back if any statement fails
- never interleave awaited reads between writes, never write with sequential
  `.run()` calls, and never split one command's writes over several batches.
  When a later statement needs an earlier result, compute it in JS before the
  batch (precomputed ids, the ledger with the command's own changes applied,
  source-month totals for a copied month)
- helpers used inside a command return statements (`build...Statements`)
  instead of executing them
- refresh derived month totals after the batch with
  `refreshMonthlySnapshotsAfterWrite`; one month's scopes and the marker clear
  commit together, and a refresh failure is logged, not returned as a write
  failure, because the markers let the next Summary or Month read repair it
- the only multi-batch write is an import over
  `IMPORT_COMMIT_SINGLE_BATCH_STATEMENT_LIMIT` (500) statements: draft-only
  rows are staged, every visible change is one final batch, and a failure
  discards the staged rows. Do not add another staged write without a measured
  limit and the same invisibility argument
- a repeated destructive command is rejected, not re-run (rolling back a
  rolled-back import returns 409)
- a check on the record's own state that a concurrent request can make stale
  between the read and the batch (still archived, still unlinked) is guarded
  inside the batch: a first statement from `buildBatchGuard`
  (`app-repository-splits.ts`) fails the whole batch when the state changed,
  and the command re-reads it to give the check's own message. A
  conditional `UPDATE ... WHERE` alone is not enough: its zero-row result
  would still commit the rest of the batch (history event, month markers).
  Races between two records for one ledger row stay with the partial unique
  indexes below
- prove each command with a failure test in `tests/atomic-writes-*.test.mjs`:
  make one statement fail partway with `failingStatement` and assert the whole
  database dump is unchanged; the test must fail on sequential writes

Converted (2026-09, `docs/audits/atomic-writes.md`): import commit and
rollback, entry create/edit/delete, transfer link and settle, month-plan
commands and the month snapshot recalculation; in the split workspace, add
an entry to splits, match a split expense to an imported entry, delete a
split expense, restore a split record (each with the entry month's refresh
markers), split expense and settle-up edit and delete (2026-09-26; a linked
split's edit carries its entry month's marker), the linked split's amount,
date, description and payer follow-up inside an entry edit's batch, the
linked split a Shared owner entry save or create writes
(`buildLinkedSplitUpsertStatements`, in the entry's batch) and an import
rollback's linked split amount follow-up. One active split record per ledger
row is held by partial unique indexes (`schema.sql`, runtime schema), so a
check before a linking batch is backed by the database when two writes race.
Not yet converted, so still
written statement by statement: the rest of the split workspace
(`app-repository-splits.ts`: split create, note and category edits,
checkpoints), category match rules,
settings, categories,
statement checkpoint edits, Shortcut requests (parked on purpose) and the
demo seed. Convert a module the next time its writes change.

## Data Flow Pseudocode

Keep slice code close to this shape:

```text
route params
  -> slice query options
  -> fetch DTO
  -> slice selector
  -> presentational component
  -> user action
  -> slice mutation action
  -> repository / API
  -> narrow invalidation
  -> selector recomputes
  -> UI settles
```

Do not skip from route or component directly into scattered helper calls.

## Stress Tests

Each implemented slice should have at least one stress-oriented test from this
list when relevant:

- same-tab return after drilldown edit shows fresh values
- cross-tab mutation refreshes stale page on focus
- mobile workflow does not get clobbered by background freshness
- manual refresh during an open workflow does not lose the draft
- rapid route changes cancel or ignore stale warmup work
- two quick saves do not let the older refresh overwrite the newer state
- slow query or restart does not break persisted app-shell cache
- import parser accepts structural variants from the same bank source

Testing depth rule:

- `npm run verify` is the local merge gate: dependency audit, strict
  TypeScript, the client type check, lint, unit tests, production build, the
  initial bundle budget, and the desktop/mobile smoke bundle
- `npm run lint` (`eslint.config.js`, ESLint flat config) checks correctness
  only: `eslint:recommended`, unused locals and imports (parameters and props
  are ignored, `_` names are exempt), `eqeqeq` smart, self-compare, template
  placeholders in plain strings, unmodified loop conditions, array callbacks
  that forget to return, and `react-hooks/rules-of-hooks` as errors;
  `react-hooks/exhaustive-deps` is a warning because many effects deliberately
  run on a key. There are no stylistic or formatting rules, and TypeScript
  files are left to `tsc`. Errors fail verify; do not add warnings casually
- `npm run typecheck:client` (`tsconfig.client.json`) runs `tsc` with
  `allowJs` and `checkJs` over `src/client` at the default, non-strict level
  (`strictNullChecks` alone reports hundreds of errors). Ambient browser and
  test-hook types live in `src/client/client-env.d.ts`. In plain JS an
  undefaulted destructured prop counts as required, so give optional props
  and options an explicit `= undefined` default rather than suppressing the
  error; use a JSDoc cast for untyped cache reads. A `// @ts-expect-error`
  needs a reason, and `// @ts-nocheck` is only for generated or vendor code
- run `npm run test:e2e` before merging broad shared-infrastructure,
  persistence, import, or cross-page invalidation changes;
  `npm run test:e2e:sharded` runs the same suite as parallel shards, each
  with its own Vite, Wrangler, ports (5501+/8901+/9501+) and local D1 persist
  directory, and is the faster equivalent (`docs/audits/e2e-sharding.md`)
- browser tests must not depend on another spec file or on run order: a
  test reseeds (`reseedDemo`, in the test, a local helper, or a
  `beforeEach` covering it) or reads only static content, because a shard
  starts from an empty schema and runs whole files in any grouping. Tests in
  one file stay together, in order, on one shard. After adding or
  noticeably slowing a spec, refresh the shard plan with
  `npm run test:e2e:sharded -- --update-weights` (full, passing run only)
- browser or unit: a test belongs in Playwright when the screen is part of
  what it proves: focus and keyboard, layout at a breakpoint, dialogs,
  sheets and Escape, navigation, back/forward and deep links, drafts
  surviving, money privacy, loading, error and retry states, timing and
  races, route warmup, or the Worker, D1 and client working together. A test
  that only sends API requests and checks the JSON, a computed total, a date
  or parser rule, a DTO shape or a stored row is a Worker-level test: put it
  in `tests/*-api.test.mjs` with `useSeededWorkerRequest()`
  (`tests/support/worker-request.mjs`, the real Worker over a real local D1)
  or, for a pure function, a plain unit test. Every user workflow keeps at
  least one browser test that drives it end to end. When in doubt, keep it
  in the browser. `docs/audits/e2e-unit-audit.md` records the moves made so
  far and the candidates kept on purpose
- do not waive a failing browser scenario as timing-sensitive until the
  user-visible invariant has been reproduced and the test has been proven to
  wait on the correct route or rendered state

- do not stop at truthy checks or existence checks for implemented behavior
- assert the concrete output shape and values that the slice owns
- include at least one negative test for each non-trivial slice so blocked or
  rejected behavior is covered explicitly
- bank import parser changes must use sanitized near-real fixtures for each
  affected supported format. Keep structural details that commonly break
  imports: preamble lines, multiline quoted descriptions, quoted comma amounts,
  dual date columns, section boundaries, and footer rows. Minimal synthetic
  snippets can cover narrow edge cases, but they are not enough as the only
  contract for a production importer.
- parser contracts for bank/deposit activity exports with dual date columns must
  assert which date becomes the statement/checkpoint date and where the other
  date is preserved. For bank balances, value/cleared/posted date is the
  reconciliation date; transaction date remains event-date context.
- PDF statement parser changes must assert that legal disclosures, transaction
  code legends, page headers, and footers cannot be swallowed into transaction
  descriptions. Near-real fixtures should include at least one page boundary or
  non-transaction section for statement formats that print them.
- PDF statement fixtures are extracted text, not PDFs: keep them in
  `tests/fixtures/pdf-statement-text/` in the `extractPdfText()` shape (raw items,
  `__PDF_LAYOUT_TEXT__`, `__PDF_SPACED_LAYOUT_TEXT__`) so routing in
  `parseStatementText()` sees all three views. Assert every parsed row, the
  checkpoints, and at least one rejected tampered variant. Prefer text
  extracted from a real statement with the shipped pdf.js version and masked
  item by item (`*-real-sanitized.pdf-text.txt`); hand-built layouts missed
  real Citi and OCBC card structure. pdf.js stays on 4.x because the parsers
  read its per-word text items (`tests/pdfjs-version-contract.test.mjs`).
- One-off data repairs and schema maintenance must not run from hot read helpers
  such as reference-data, account-list, summary, entries, or settings reads.
  Put repairs behind explicit initialization and persist a completion marker so
  new Worker isolates can skip expensive scans.
- import flow tests for statement-plus-mid-cycle scenarios must include the
  sequence both ways when supported by the source: current activity before the
  statement, and current activity after a statement has already certified the
  month. The latter must prove a later import cannot reopen or break a matched
  statement checkpoint.

## Code Shape Rules

These are defaults, not excuses for clever golfing.

- target `80-120` characters per line
- target `20-50` lines per function
- split earlier if one function mixes orchestration, shaping, and rendering
- keep one main responsibility per file when practical
- prefer one exported slice entry point over many wide helpers
- keep public APIs small and intention-revealing
- target `200-500` lines per handwritten module
- treat `800+` line handwritten modules as mandatory extraction work, not a
  normal steady-state shape
- if `App.jsx`, `app-shell.ts`, or a page module grows large during migration,
  move page logic into slice deep modules instead of letting the file keep
  accumulating responsibilities
- `src/domain/app-shell.ts` is for shell orchestration and shell-shared DTO
  builders; keep route-page fragments out of that layer. Page projections
  live in `month-projection.ts`, `summary-projection.ts`,
  `splits-projection.ts` and `donut-chart-projection.ts` (H15e)
- persistence writes live in focused modules below the
  `app-repository.ts` re-export hub (H15): `app-repository-schema.ts`
  (runtime schema), `app-repository-seed.ts` (demo and empty-state seed),
  `app-repository-showcase-seed.ts` (the public demo's showcase dataset from
  `demo-showcase-data.ts`, written in one batch with its settings and month
  refresh markers),
  `app-repository-entry-commands.ts`, `app-repository-month-commands.ts`,
  `app-repository-import-commit.ts` (commit and rollback) and
  `app-repository-snapshots.ts` (monthly snapshot recalculation, refresh
  markers and repair, used by all of them). New code imports the specific
  module, never the hub, and a command module never imports another command
  module. Command writes follow the Persistence Atomicity Contract
- move persistence code with `scripts/persisted-state-snapshot.mjs`: its
  normalized table and page-DTO dump must be identical before and after
- entry, month and statement dates are plain `YYYY-MM-DD` calendar dates,
  never instants; do not convert them through UTC. "Today" and the current
  month come from the household calendar in `src/lib/app-calendar.ts`
  (Singapore), shared by the client (`src/client/app-dates.js`) and the
  Worker (`getCurrentMonthKey` in `src/lib/month.ts`), read at call time.
  Never cut a date out of `toISOString()`/`toJSON()`: that is the UTC day,
  wrong before 8 am, and the Worker runs in UTC; `tests/app-dates.test.mjs`
  fails on that pattern in client code. Calendar arithmetic on
  `T00:00:00Z` dates (`addDaysToIsoDate`) stays in UTC
- if several route modules repeat the same route-context or month-selection
  logic, extract that logic into `src/domain/route-context.ts` or another
  shared route fragment before the duplication spreads
- `src/domain/route-context.ts` is only for shared route interpretation and
  context resolution; do not park formatting helpers, UI labels, parsing
  helpers, or React-only logic there
- `src/domain/page-labels.ts` is label-only
- if logic belongs primarily to one route, keep it in that route module
- cross-route financial business rules belong in dedicated domain modules, not
  in `route-context.ts`
- keep `route-context.ts` focused on route interpretation and context resolution,
  not authorization, reconciliation, split calculations, account visibility, or
  budgeting logic

Good function split:

- `buildEntriesPageQueryOptions`
- `selectEntriesTotalsStrip`
- `saveEntryAndInvalidate`

Bad function split:

- giant one-file page helper with fetch, normalize, totals, filters, and UI
  branching mixed together

Refactor rule:

- old compatibility code and new replacement code should not both remain once
  the replacement passes the slice tests
- large legacy files are migration targets, not permission to keep adding more
  responsibilities to the same file
- split the file by slice boundary first, then by helper depth inside the slice

## Remaining Large Modules

These handwritten modules are still over the 800-line guideline after the
macro performance work. Each has one owner and a reason; splitting them is
future work, not a claim that the complexity is gone.

| Module | Lines | Owner | Why it is still large |
| --- | ---: | --- | --- |
| `src/client/App.jsx` | ≈3,150 | App shell | Route orchestration, mutation refresh plans and cross-route invalidation still meet here; state owners (H12) and chrome (H11) have moved out |
| `src/index.ts` | ≈2,300 | Worker | One flat route chain with request validation per endpoint; only the AI routes are extracted (H13) |
| `src/client/imports-panel.jsx`, `import-preview-review.jsx` | ≈2,050 / ≈1,400 | Imports | Browser-only intake, preview review and commit flow share draft state |
| `src/domain/app-repository-import-preview.ts`, `-import-commit.ts` | ≈1,970 / ≈1,900 | Imports | Statement reconciliation, certification and rollback restoration are one tightly coupled algorithm |
| `src/client/month-panel.jsx`, `entries-panel.jsx`, `splits-panel.jsx`, `settings-panel.jsx`, `settings-sections.jsx` | ≈1,200–1,800 | Each route | Route panels with their editors; drafts and workflow locks are panel state |
| `src/domain/app-repository-splits.ts` | ≈1,580 | Splits | Split expenses, settlements, checkpoints and matches share validation |
| `src/domain/app-repository-entry-commands.ts` | ≈1,170 | Entries | Five edit paths share bank-fact locks and split sync |
| `src/domain/demo-data.ts`, `src/types/dto.ts`, `src/client/copy/en-SG.js` | ≈1,480 / 900 / 940 | Fixtures, DTO types, copy | Data and declarations, not logic |

## Comment Rules

Comments are required when the code hides one of these:

- business rule
- persistence contract
- cache invalidation reason
- workflow lock reason
- non-obvious fallback behavior

Comment rules:

- explain why, not the obvious what
- keep comments short and local
- add a short contract comment above dense selectors or mutation orchestration
- do not narrate every line

## Refactor Cutover Rule

When a slice migrates to a new query, route, or workflow boundary:

- the new path should replace the old path in the same change whenever
  possible
- if the old path must exist temporarily, it must be deleted before the slice
  is declared complete
- do not leave hidden compatibility branches behind for future slices to
  discover later

## Documentation Output Rule

When implementing a non-trivial change, update only the narrowest docs needed:

- vocabulary change: `DOMAIN.md`
- global repo rule: `AGENTS.md`
- architecture or migration change: `docs/architecture.md`
- behavior change: `docs/scenario-catalog.md`
- query or invalidation change: `docs/query-map.md`
- current-product lesson to preserve: `docs/existing-behavior-guardrails.md`
- code-shape or implementation rule change: this file

Keep docs compact. Prefer one sharp update to one right file over repeating the
same rule in five places.
