# Macro Architecture And Performance Plan

Audit date: 2026-09-22. Baseline: `718e708`.
Status: planning complete; P0 measurement (H00/H01) done, later tasks open.
The detailed handoff is
[`macro-performance-implementation.md`](./macro-performance-implementation.md).
H00 and H01 are complete (evidence in
[`audits/macro-loading-baseline.md`](./audits/macro-loading-baseline.md));
H01 found a wrong-person Month cache defect that H02 repairs next.
H00-H10 expand the initial loading delivery with exact
prerequisites, source locations, allowed files and tests; H11-H17 cover the
later architecture tasks. That handoff resolves implementation ambiguities here.
Recent-change comparison: `84a673d^..718e708` (AI assistance through money
visibility in edit forms). This is an explicit comparison window, not all history.

## Assessment

There is avoidable loading work and concentrated orchestration complexity.
There is not enough runtime evidence to claim that recent commits made actual
page loads slower. Retain React, React Router, TanStack Query, Vite, Workers/D1,
Radix, and the existing domain model. A framework rewrite is not justified.

The comparison contains 4,872 additions and 339 deletions across 71 files,
including tests and documentation. No package manifest or lockfile change is
present in that window. New features explain much of the growth.
`node_modules` disk size is not browser transfer size or a performance score.

| Concentration | Before window | Current | Interpretation |
| --- | ---: | ---: | --- |
| `src/client/App.jsx` | 3,926 lines | 3,955 | Large existing ownership problem; recent growth is small |
| `src/domain/app-repository.ts` | 5,803 | 5,844 | Existing persistence concentration |
| `src/index.ts` | 2,231 | 2,634 | Recent AI handlers materially expanded request routing |
| `public/styles.css` | not measured here | 11,949 | Large global cascade; size alone does not prove unused CSS |

### Verified Evidence

- `App.jsx:1716` eagerly loads reference data; `:1742` retains the Entries
  narrow-shell then full-shell sequence. Do not remove that sequence without
  measuring quick-entry readiness and proving identity/registration parity.
- `App.jsx:2606` warms every inactive route module from one idle callback.
  It checks data saver but not coarse pointer, visibility, or active drafts.
  Lazy splitting therefore does not guarantee sustained demand-only loading.
- `App.jsx:2406` fetches the full Imports DTO for a banner. Cleanup suppresses
  updates but does not pass a query abort signal to fetch. This effect is
  separate from the desktop data-prefetch policy at `:2457`.
- `src/domain/pages/imports-page.ts` loads history, accounts, and split-match
  candidates to produce that DTO. Measure these before inventing a new endpoint.
- `src/index.ts:172` awaits schema initialization before `apiPageResponse`
  starts its timer at `:2400`. Existing Server-Timing omits that prerequisite
  and JSON response construction. Initialization is memoized by database in
  `app-repository.ts:243`; do not describe it as a full migration on every request.
- `tests/e2e/api-performance.spec.js` checks one seeded sample for four APIs
  against 750 ms. It does not establish cold-start, browser, percentile, or
  larger-ledger performance. Playwright currently serves Vite development mode.
- `App.jsx` combines query-cache access with local server-data snapshots,
  cross-tab reconciliation, route controls, login registration, and warmup.
  Some snapshots protect drafts; deleting them wholesale would be unsafe.
- Summary reads full entry DTOs for its requested range before aggregation
  (`src/domain/pages/summary-page.ts`). Entries loads a whole month
  (`src/domain/pages/entries-page.ts`). These are bounded by dates but remain
  scale risks, not yet demonstrated bottlenecks.
- `FinancialInsight` has deterministic fallback, a bounded memory cache, and
  abort cleanup. It has no explicit mutation/workflow readiness input. Verify
  request timing during open drafts and pending mutations before changing it.
- Strict TypeScript includes `src/**/*.ts`, not client JS/JSX. A successful
  typecheck is not proof that every client integration is checked.
- Recent privacy and financial-insight E2E files, app-shell tests, and split
  cross-tab tests are not explicitly selected by the serial smoke script.
  They remain available through the full E2E suite.

Line references describe this baseline; locate symbols again before editing.

### Build And Verification Baseline

Fresh `npm run build` passed using Node 22.12.0; `npm run typecheck` passed;
`npm run test:unit` passed 228/228. The test runner needed local IPC permission.

| Generated artifact | Raw decimal KB | Gzip decimal KB |
| --- | ---: | ---: |
| Main index JS | 476.64 | 148.42 |
| Recharts chunk | 299.18 | 93.02 |
| Imports panel | 134.64 | 34.06 |
| FAQ panel | 149.87 | 45.44 |
| Financial insight | 15.85 | 5.63 |
| PDF library | 409.52 | 123.06 |
| PDF worker | 2,209.73 | not reported |

These are individual artifacts, not additive route totals: traverse the actual
static import graph and observe browser requests before reporting route cost.
`public/styles.css` is 227,878 raw bytes; Vite's JS chunk report does not include
its full delivery cost. FAQ embeds 112,495 bytes of Markdown before bundling.
PDF/worker assets are not proof of a first-load cost merely because they exist.

No browser timing, production traffic, cold Worker timing, historical bundle
comparison, npm audit, smoke run, or full E2E run was performed in this audit.
No production data was accessed. Runtime verification is the first task, not
an implied completed result. Older docs' broad-bootstrap/503 explanations are
historical hypotheses and must not substitute for current request evidence.

## Intended Product And Data Flow

Preserve the navigation model: Summary explains the household/person view;
Month supports planning; Entries investigates and corrects ledger facts; Splits
handles obligations and settlements; Imports supplies evidence and review;
Settings manages reference data and diagnostics. Retain drilldown and return
context, mobile sheets, deep links, and route-specific filters. Do not add a
new dashboard or relocate actions as part of performance work.

```text
URL / saved route intent
  -> lightweight shell and identity resolution
  -> active route module + required route data
  -> deterministic, usable page with stable layout
  -> independent account pills / charts when applicable
  -> bounded optional work only while stable and idle

Edit / import / settlement intent
  -> protected draft with explicit owner
  -> validated domain command and persistence
  -> exact affected query keys marked stale
  -> affected visible projections reconcile when safe
  -> cross-tab event; other tabs respect their own drafts
```

Start independent work concurrently only when its context is known. Never
render another person's cached values as a placeholder. Treat chart/AI failure
as local degradation. Preserve retries for known transient failures, but audit
nested retry layers before increasing them. A module extraction is a
maintainability improvement; it is not a speed improvement unless measured.

### How Lazy Loading And Warmup Work Together

Keep both mechanisms. Lazy loading makes route code independently loadable;
selective warmup starts that same load before likely navigation. Warmup must
reuse the route loader and data query keys, not create a second loading path.

| Mechanism | When | What it saves |
| --- | --- | --- |
| Active-route loading | Immediately on navigation | Makes an unwarmed route usable without waiting for a warmup queue |
| Route-code warmup | Eligible hover/focus intent or one likely-next route after readiness | Component download and module preparation on the next click |
| Route-data warmup | Stable page, eligible connection/device, no protected workflow | API wait on the next navigation, subject to freshness rules |

Example: open Summary, render its required data, then warm Entries code on
eligible navigation intent. Clicking Entries reuses that module and reads its
normal query cache. Fresh data may be reused; stale data follows the existing
refresh and workflow protection rules. Loading code does not imply its data is
loaded, and warm data does not imply its component code is loaded.

An idle callback is only a scheduling opportunity, not proof that the network
is free or the page/workflow is settled. Apply the explicit readiness,
visibility, device, data-saver and workflow gates in P1/P2. Pause speculative
scheduling during editing or mutation; actual navigation bypasses those gates.
Already-started dynamic imports cannot be aborted. Data cancellation must
preserve a same-key request now needed by the visible route.

P1/P2 must retain useful warm navigation while reducing unnecessary idle
traffic. Do not remove all warmup or make every route eager. Compare cold load,
warm navigation, unwarmed navigation and idle bytes using P0 before accepting
the policy change.

## Non-Negotiable Contracts

- Finance semantics stay in typed domain services: integer minor units,
  household/person shares, currency-safe settlement, event versus posted dates,
  transfer exclusions, statement certification, and checkpoint confidence.
- Preserve one-shot shortcut parameters, reload-safe drafts, explicit edit
  targets, filter/search state, selected split group, and back-navigation intent.
- Stale marking may be immediate; replacing a draft-sensitive visible snapshot
  must wait. Preserve generation guards against older responses after two saves.
- Preserve import preview throttling and statement/activity imports in both
  orders, rollback restoration, and exact-match certification.
- Privacy remains hidden by default, avoids first-paint money exposure, covers
  all projections, and permits explicit amount editing without changing values.
- AI stays optional, bounded, redacted, and unable to write finance records.
  Never block initial render, preview, commit, or reconciliation on inference.
- No production reseed, data deletion, schema rollout, deployment, dependency
  upgrade, or parser rewrite is part of this plan's default execution.

## Execution Rules For A Smaller Model

Execute one task ID at a time. Read `AGENTS.md`, `DOMAIN.md`, `docs/code-spec.md`,
this task, and only the relevant workflow/guardrail docs. Recheck HEAD and dirty
files. If baseline has moved, update evidence for touched paths first.

Before edits, identify callers, returned shapes, side effects, and existing
tests. Add a behavior test for each changed contract, including a rejected or
cancelled path. Keep mechanical moves separate from policy changes. Use named
arguments and small public APIs; do not hide dependencies in a giant context
object or pass all of App's setters to a new hook. Avoid generic repositories,
universal form engines, new state libraries, and new global event systems.

Target 200-500-line modules as guidance. Existing 800+ line modules require
planned extraction, but never split financial invariants purely to hit a count.
Use existing refresh-plan helpers and query-key builders. Add types at changed
boundaries; a whole-app TypeScript conversion is out of scope.

For each task, record exact commands, exit codes, changed contracts, before/after
measurements where applicable, and unresolved risks. Run focused tests during
work and `npm run verify` before declaring a task complete. Run full
`npm run test:e2e` for broad route, shared state, persistence, or invalidation
changes. Do not weaken tests, silently raise budgets, or use audit fixes with
force to clear unrelated failures. Record baseline failures separately.

Keep each completed task in a small reviewable commit when commits are requested
or under the repository's refactor commit convention. Roll back only that task's
own changes; preserve unrelated user work. No permanent duplicate loading path.
If preserving a contract requires a second workflow change, stop that task at
the documented boundary and split it into another task.

## Ordered Tasks

### P0: Establish Production-Like Measurements And Characterization

Depends on: nothing. Required before performance claims or structural changes.
Scope: a separate performance Playwright configuration, a baseline collection
script, fixture support, and a dated report under `docs/audits/`. Keep existing
functional Playwright configuration and serial smoke isolation unchanged.

1. Inspect `playwright.config.js`, `wrangler.test.jsonc`, E2E helpers, existing
   API performance tests, and smoke stabilization audit. Use only isolated test
   D1. Never reuse an arbitrary running server for tests that reseed.
2. Serve the built client through the isolated test Worker's configured static
   assets on an available dedicated port, as specified in H01. Verify the browser loads hashed built
   assets, not `/@vite/client`. Record Node/browser versions and git revision.
3. Measure each route below in fresh and warm browser contexts; distinguish
   fresh browser cache from fresh Worker isolate. Use desktop 1440x900 and
   mobile 390x844. Record the exact CPU/network throttling profile.
4. Record navigation-to-usable-content, LCP/CLS, long tasks, transferred JS/CSS,
   API counts and bytes, wall duration, Server-Timing, and idle traffic at
   2/10/30 seconds. A readiness assertion must include correct route data and
   an enabled primary control, not just a heading or `networkidle`.
5. Repeat at least 20 warm runs; report median/p95 with sample count and raw
   samples. Report cold restarts separately. Local timing is not production
   latency; obtain deployment timing only through a separately scoped read.
6. Use deterministic sanitized fixtures at ordinary and stress sizes: 1k/10k
   ledger rows over 24 months, including one 2k-row month, shared entries,
   transfers, imports/checkpoints and mixed-currency split groups. Validate
   fixture counts and expected financial totals; do not duplicate unique IDs.

| Route/scenario | Required observations |
| --- | --- |
| Summary direct load and Entries return | shell, summary, pills, chart, banner timing; view/scope totals |
| Month with open editor | usable plan, linked entries, typing while background work settles |
| Entries and shortcut launch | editor readiness; one-shot params; filter and draft restoration |
| Splits group and settlement | list/filter readiness; currency and optimistic refresh correctness |
| Imports intake and preview | initial list cost versus parser/preview cost; cancellation; rollback |
| Settings and FAQ | reference-data/diagnostics timing; FAQ bytes and category glossary |
| Two tabs and two rapid saves | exact invalidation; protected draft; latest result wins |
| Privacy and AI unavailable | no money flash; deterministic content; no blocking request |

Add an asset-graph report from a build manifest; keep performance thresholds
out of functional timing-sensitive tests. Initial hard rule: no new startup
dependency on inactive routes or optional AI. Provisional regression limits:
no >5% increase in initial compressed JS/CSS and no >10% median/p95 slowdown
on the same controlled fixture. Investigate repeatable breaches; do not treat
noise as a passed improvement. Use `docs/code-spec.md` server budgets as targets;
add full-request timing rather than silently redefining existing `app;dur`.
Suggested UX goals to calibrate after measurement: usable cold mobile page
within 2.5 s, warm navigation within 300 ms, CLS <=0.1. These are targets, not
current measured performance or guaranteed delivery promises.

Done: reproducible report, scripts clean up their servers, and all contract
scenarios have named existing or new tests. No application optimization yet.

### P1: Bound Route-Module Warmup

Depends on: P0. Scope: `App.jsx` route loaders/preloads and one small
`route-warmup.js` policy module plus tests. Do not migrate server state here.

Replace unconditional all-route idle imports with navigation intent (hover/focus)
and at most one likely-next module after the active page is usable on desktop.
Use P2m's separate policy on mobile; coarse-pointer is a policy selection signal,
not a permanent ban on mobile warmup. Skip speculation while hidden, save-data,
loading, or workflow-busy.
Actual navigation must always load its route immediately. Dynamic imports
already started cannot be cancelled; cancel scheduling and prevent further work.
Retain failed-preload retry behavior and successful-load deduplication.

Tests: network observations for Summary/Entries cold loads and 30 seconds idle;
rapid tab changes, failed chunk retry, touch/data-saver, keyboard focus intent,
and open mobile editor. Do not eagerly pull FAQ, PDF, Imports, or Settings just
because shell metadata arrived. Check `client-route-chunks`, app routing,
app-shell, mobile continuity, and FAQ tests. Done: idle bytes fall and warm
navigation stays within P0 limits. Preserve useful preloading if data supports it.

### P2: Unify Optional Data Scheduling And Cancellation

Depends on: P1. Scope: banner and data-prefetch effects in `App.jsx`, relevant
query functions, and a bounded scheduling helper. Keep existing query keys.

Route banner warmup through the same readiness/visibility/workflow policy as
other speculative data. Reuse a cached Imports DTO; forward TanStack's query
signal into fetch. At most one speculative API request at a time. A primary
request can proceed independently and always has priority. Cancelling a warmup
must not abort a same-key query now required by the active Imports route; check
ownership/current active request before cancellation. Keep stale badge data
usable and failure nonfatal. Preserve invalidation after commit/rollback.

First measure full Imports DTO cost. Add a dedicated banner projection only if
P0 shows material cost; make that a separate follow-up with response contract,
cache key, exact badge parity, and mutation invalidation tests. Do not reuse an
Imports page cache key for an incompatible smaller response.

Tests: no optional request during editing/commit, hidden/save-data; mobile work
obeys P2m's smaller budget;
aborted scheduled work; navigation to Imports during in-flight warmup; stale
badge refresh; direct Imports still loads promptly. Run import inbox, preview
auto-refresh, import-ledger, query-foundation and cross-tab scenarios.

### P2m: Mobile Warmup With A Separate Policy

Depends on: P0, P1, P2. Implement as separate policy and test changes, not a
second router or cache. This replaces the earlier blanket touch-device skip
proposal. Mobile should benefit from selective warmup without paying for the
desktop speculation schedule. All numbers below are initial policy limits to
validate in P0, not measured optima.

**Ownership and selection.** Keep one scheduler, route-loader registry, query
cache, invalidation model and workflow-lock source. Add pure policy functions
in `route-warmup-policy.js` returning a bounded candidate or no work; keep DOM
listeners and timers in the scheduler. Use the existing compact-layout signal
or coarse primary pointer to select the conservative mobile policy; do not use
user-agent sniffing. Wide touch tablets remain conservative. Re-evaluate on
capability/layout change without spending a new budget. Provide test overrides.
Keyboard navigation still works under either policy.

| Situation | Mobile route code | Mobile speculative data |
| --- | --- | --- |
| Initial page loading, active API, edit/filter sheet, keyboard input, mutation or reconciliation | None | None |
| Hidden, offline, data saver, reported slow-2g/2g/3g connection | None | None |
| Stable page; connection information absent | One high-confidence small candidate | None |
| Stable page; connection reports 4g and recent visible API completed within 500 ms | One high-confidence small candidate | At most one eligible query |
| Touch/pen pointer-down on an explicit route link | Start that route's code if otherwise eligible | None before navigation |
| Actual route activation | Load immediately regardless of warmup gates | Normal required query/cache behavior |

Connection hints may be absent or inaccurate. Reported 4g is not proof of Wi-Fi
or an unmetered connection. Never infer unlimited bandwidth from missing APIs.
Do not require battery/device-memory APIs, active bandwidth probes, persistent
behavior tracking, or a new preference UI. Honor existing browser hints when
available. Existing required freshness and explicit refresh bypass speculation
limits; optional AI keeps P3's independent readiness contract.

**Candidates.** Only consider exact destinations already derivable from the
current route and session. Priority: explicit link intent, previously visited
drilldown destination in the same workflow, then one defined route pair:
Summary -> Entries for the selected month/view; Month -> Entries for the same
month/view. Resolve URLs through existing route helpers. A drilldown requiring
an unchosen category/group is not yet a candidate. Do not predict an arbitrary
month, default to household from a person view, or prefetch both directions.
Entries/Splits have no automatic next-route candidate without recent matching
workflow history. Imports, Settings, FAQ, PDF and OCR get no automatic mobile
warmup. Explicit navigation always remains available.

**Readiness and budget.** Wait for active route data and controls to be usable,
no active required queries, and two seconds without interaction. Use an idle
callback when available only after these gates pass. Scroll, input and pointer
activity reset the timer; implement passive listeners with complete cleanup.
Do not continually restart a delay due solely to unrelated React rerenders.
Permit one automatic route-code candidate and one speculative data query per
route visit, with a global session rate limit of two automatic route candidates
per rolling minute. No recursive warming from a warmed route. Deduplicate cached
code and fresh queries before charging a budget.

For automatic code warmup, cap estimated missing compressed JS at 50 KB,
including transitive static imports and accounting for already loaded chunks.
Generate the route-cost map from P0's build manifest; shared chunks count once.
If cost is unknown or above the cap, skip automatic warming and rely on explicit
intent/navigation. The estimate is not an exact browser transfer guarantee.
Pointer-down can bypass the automatic code-size quota for that one destination
but still honors data saver, visibility and workflow gates. Never preventDefault,
delay a click, or trigger a mutation. A cancelled gesture must not navigate;
already-started module bytes cannot be recovered.

Start automatic data warmup only after code warmup settles and only for a query
P0 measured at <=50 KB response body and <=250 ms handler time on the stress
fixture. Unknown-cost queries are ineligible. Allow one in-flight speculative
query, no automatic retries, and a 1.5-second speculative deadline. Treat these
as admission estimates, not hard server-work limits. Abort only while the
request remains exclusively speculative; promote it if the visible route needs
the same key. A navigation or mutation must not wait for speculative work.
Keep normal cache TTLs and invalidation; never lengthen staleTime to make a
benchmark look faster. Do not create a separate mobile cache.

**Banner and resume.** Mobile Summary/Month may reuse the cached Imports banner.
Do not fetch the full Imports page solely for its banner on mobile. If P2 later
adds a measured lightweight banner endpoint, it competes for the same one-query
budget, with user navigation intent taking precedence. On tab hide, stop timers
and abort exclusively speculative data. Resume required freshness first, then
restart the two-second readiness interval; returning from background does not
reset visit budgets or replay every missed warmup.

**Tests and acceptance.** Add table-driven tests for every policy row, unknown
connection, hybrid input, cost cap, quotas, query promotion, invalidation and
timer cleanup. Add mobile browser scenarios for Summary -> Entries, Month ->
Entries, cold shortcut launch, repeated taps, scroll/cancelled gesture, hidden
tab/resume, offline recovery, two saves, and an open money/filter/import editor.
Assert exact route/query identities and financial values, not only request counts.
Use Chromium touch emulation and WebKit for missing-capability behavior; label
these as emulation, not real iPhone/Android or battery measurements. Capture
real-device evidence when available and disclose any missing coverage.

Compare mobile no-warmup, proposed mobile policy, and current behavior under the
same P0 fixtures and network settings. Before interaction, idle requests must
stay within admission/rate limits, and restricted conditions must issue zero
speculative requests. Cold usable-page time and interaction latency must not
regress beyond P0 tolerances. Record hit rate, completed-but-unused speculative
bytes, and median/p95 warm AND unwarmed navigation. Enable automatic candidates
only where repeatable navigation benefit justifies their byte cost; otherwise
retain intent-only code warmup for that candidate. Desktop measurements must
remain unchanged by mobile policy selection. Rollback disables mobile automatic
candidates while retaining normal navigation, cache reuse and desktop policy.

Done: mobile policy has isolated tests and measured benefit; no duplicate data
ownership, draft loss, all-route download burst, or mobile-wide refresh storm.

### P3: Make Optional Insight Readiness Explicit

Depends on: P0; can follow P2. Scope: `financial-insight.jsx` and its Summary,
Month, Splits call sites, existing AI tests. No prompt/domain math changes.

Characterize current request timing, then pass one explicit readiness boolean
derived from existing loading/mutation/workflow state. Render deterministic
facts immediately. Pause/abort optional wording during protected work and
resume once stable; preserve redaction, memory-only TTL cache, bounded size,
privacy behavior, and facts-key response guards. Handle unavailable/malformed
responses locally. Do not introduce TanStack caching of private narratives.

Tests: no inference while pending edit/save/preview, hide-money abort, changed
facts reject old response, unavailable AI leaves totals/actions correct.
Run financial-insight, money-privacy, money-field-editability and AI contracts.
Done: the documented optional-AI scheduling contract has runtime proof.

### P4: Expose Full Request And Initialization Cost

Depends on: P0. Scope: `src/index.ts` timing boundary, schema initialization
instrumentation, API performance tests. This is instrumentation, not migration.

Keep existing handler timing and add separately named full/initialization
durations, with bounded diagnostic fields and no financial payloads or identity
data in logs. Include response serialization in the full duration where feasible.
Capture initialization failures through the existing error-response policy.
Measure memoized steady-state versus new-isolate initialization separately;
retain failed-initialization retry. Add all page endpoints to the test matrix.

Done: timings cannot hide prerequisite schema work; numerical response parity
and status/error contracts pass. If initialization dominates, propose P9a with
versioned initialization and old-database fixtures. Never simply delete repairs.

### P5: Extract Shell Presentation, Without Changing Data Ownership

Depends on: P0-P3. Scope: presentational navigation, month/range pickers,
loading/error chrome, login registration UI from `App.jsx` into narrowly named
components. One component family per commit. Preserve current props/events.

Do not move query effects, rewrite URL normalization, alter login identity
behavior, or make shell statically import route editors. Pass explicit small
contracts; reject a new component needing the whole application state object.
Add JSDoc shapes or narrow checked types for each changed interface.

Tests: app-shell, routing, mobile continuity, quick-entry URL defaults, keyboard
focus and back navigation; built chunk graph still excludes route-only controls.
Done: render responsibilities leave App and visible behavior is unchanged.

### P6: Move One Server-State Owner At A Time

Depends on: P5 and P0 race tests. Risk: high. Do not execute as one large task.
Order: P6a reference data; P6b Summary; P6c generic route data; P6d shell
hydration and cross-tab subscription. Each is a separate verified change.

Read `app-shell-query.js`, `summary-query.js`, `query-keys.js`, refresh plans,
`app-sync.js`, and the selected App effects. Inventory each copy as authoritative
cache, protected workflow snapshot, optimistic overlay, or derived view.
Use existing query-option patterns; move ownership into a feature hook/module.
Retain intentional snapshots and generation/epoch guards. Where appropriate,
use query subscriptions rather than mirroring unprotected responses with effects.
Do not combine key changes, cache policy changes, and ownership changes.

For each subtask prove: direct load; warm return; invalid route fallback;
household/person separation; two out-of-order responses; two quick saves;
cross-tab update during editor/filter/preview; release of deferred refresh;
offline/transient failure recovery. Preserve Entries-shell launch until a
separate measured comparison proves that removing it preserves fast launch.
Run full E2E for each shared-coordination subtask. Done: exactly one declared
owner per server-data resource, no obsolete mirror, no draft regression.

### P7: Extract Request Handlers Without Changing Security Or Semantics

Depends on: P4. Scope: first move AI parsing/handlers from `src/index.ts` into
`src/server/ai-assistance-routes.ts`; other endpoint families are separate tasks.

Preserve gateway allowlist and method checks, environment checks, identity,
quota/privacy validation, response/status shapes, exception behavior, and
initialization order. Use a narrow handler interface with explicit dependencies;
do not introduce a router framework. Do not route unmatched requests through an
AI module fallback. Test method rejection, invalid input, no binding, quota,
normal response, and the shortcut-only gateway's rejection of unrelated APIs.
Run AI and shortcut contracts and affected E2E. Done: route entry is smaller
without any change to which caller can perform which action.

### P8: Reduce Read Cost Only Where P0/P4 Prove It

Depends on: P4. One endpoint per task. Scope selected from
`src/domain/pages/`, corresponding repository readers, and projection tests.

Record query count, rows read/returned, payload bytes, and query plan on the
stress fixture. Prioritize Summary range hydration, Imports banner/history,
then Entries month rendering based on measured cost, not presumed order.
Parallelize independent reads only when safe; first remove duplicate reads and
unused projection fields. Consider aggregate SQL only with exact parity tests
for person shares, transfer exclusion, date semantics, negative values, empty
months, linked plans and currency. Never replace weighted JS with naive SUM.

Add an index only when query-plan evidence supports it, as a separate migration
task with fresh/existing DB coverage. Do not paginate Entries until search,
totals, filters, exports, selection and deep-link behavior have explicit full-set
semantics. Consider virtualization only after a trace proves rendering cost;
test focus, row heights, accessibility and active editors. Done: measured cost
falls at stress size and every finance projection remains numerically identical.

### P9: Extract Persistence And Domain Projections In Separate Batches

Depends on: P6/P7 for shared changes; no runtime-policy changes in move commits.
P9a initialization; P9b entry commands; P9c month commands; P9d import commit
and rollback together with their shared certification/snapshot helpers.

Map imports before moving code out of `app-repository.ts`. Existing specialized
repository files are the pattern. Avoid new circular imports back through the
central re-export facade. Preserve batch boundaries, statement ordering,
idempotency, account ownership, and repair completion markers. Temporary exports
must be removed when all callers move in the same completed task.

Separately move route projections out of `app-shell.ts` by domain responsibility;
keep shared weighting logic in one domain module, not duplicated per route.
Each move needs exact DTO/output tests and affected real Worker/E2E flows.
Import batches require near-real fixtures, both import orders, certified row
retention, rollback restoration, linked split and transfer behavior. Do not
change parser algorithms or database schema while extracting these functions.

Done: smaller ownership surfaces and no output or persisted-state differences.
These moves need not produce smaller browser bundles or faster requests.

### P10: Address CSS, FAQ And Chart Cost If Measured

Depends on: P1/P0. Separate tasks for each asset family; lower priority.
CSS: measure coverage across all routes, dialogs, breakpoints, privacy states
and error/loading states. Remove a rule only after finding no active/generated
selector use. Preserve cascade order when splitting; compare screenshots on
desktop/mobile. Splitting files without reducing loaded bytes is not a win.
FAQ: first keep it out of automatic warmup; consider loading Markdown on demand
only if its route cost remains material. Preserve anchors, searchable content,
images and canonical category glossary. Check demo-data import retention in
the built graph before extracting category constants.
Charts: keep Recharts unless traces show a meaningful unresolved cost. Delay
below-fold charts only with a fixed-size placeholder and no loss of immediate
totals, filtering, accessibility or drilldowns. Do not replace a proven chart
library as an incidental cleanup. PDF/OCR must retain on-demand behavior.

Done: explicit asset/trace improvement plus responsive and workflow parity.

### P11: Close The Audit And Consolidate Current Guidance

Depends on: selected tasks complete. Rerun P0 under identical conditions,
`npm run verify`, and full E2E for the shared changes. Report per-route deltas,
not only total build size. Add bounded smoke coverage for privacy, AI fallback,
shell continuity and two-tab freshness while retaining serial server teardown.

Update the narrow owning docs and mark tasks complete only with evidence.
Keep historical slice prompts as history; fix present-tense stale bootstrap
claims and clearly label hypotheses about Worker failures. Link one current
execution plan rather than copy its rules into every document. No new domain
terms are needed. Do not declare the architecture finished merely because
large files became smaller.

## Ready-To-Use Implementation Prompt

```text
Implement ONLY task <H-ID/subtask> from docs/macro-performance-implementation.md.
Use docs/macro-performance-plan.md for goals and budgets.
Read AGENTS.md, DOMAIN.md, docs/code-spec.md, that task's sources and tests.
Baseline audit commit: 718e708. Reconcile changed files against current HEAD.
Confirm prerequisite task evidence exists; otherwise complete only the missing
prerequisite work needed for this task and report the scope change.
List the protected workflows and exact files you will change before editing.
Add concrete positive and negative behavior tests, then make the smallest change.
Keep financial calculations, cache keys, protected drafts and URL contracts
unchanged unless this exact task specifies the change. No framework replacement,
dependency upgrade, deployment, production data operation or unrelated refactor.
Run focused checks and the prescribed merge gates. Report failures honestly.
Update the task evidence with changed files, commands/results, measured deltas,
remaining risks and the next eligible task. Do not start the next task.
```

Recommended first delivery: P0, P1, P2, P2m, P3, P4. Reassess measured results before
funding the higher-risk P6/P8/P9 work. This allows early speed improvements while
keeping the existing correctness mechanisms intact.
