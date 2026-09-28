# Project Working Rules

This document captures the default engineering expectations for this repository.
It is a living document and should be updated as the product, architecture, and
team conventions evolve.

## Living guidance

- Keep this file updated as the app progresses.
- Treat this file as the primary always-read repository instruction file for
  Codex. Any rule that must be followed on every prompt belongs here or must be
  linked clearly from here.
- Treat `CLAUDE.md` as the equivalent always-read file for Claude if that file
  is added later. Do not assume `docs/architecture.md` is loaded automatically
  by coding agents.
- Keep [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md)
  updated alongside domain-model and naming changes.
- Keep [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md)
  updated alongside meaningful client-side boundary and helper-service changes.
- Keep [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  updated alongside meaningful product and technical changes.
- Keep [`docs/code-spec.md`](/Users/tim/22m/ai-projects/monies_map/docs/code-spec.md)
  updated alongside meaningful implementation-shape, query-budget, and
  code-readability rule changes.
- Keep [`docs/implementation-order.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-order.md)
  updated alongside meaningful refactor sequencing and slice migration order
  changes.
- Keep [`docs/preimplementation-checklist.md`](/Users/tim/22m/ai-projects/monies_map/docs/preimplementation-checklist.md)
  updated alongside the reusable pre-change audit checklist and its stop
  conditions.
- Keep [`docs/known-coupling-targets.md`](/Users/tim/22m/ai-projects/monies_map/docs/known-coupling-targets.md)
  updated alongside audit findings that should turn into explicit tests or
  contract checks.
- Keep [`docs/implementation-prompt-template.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-prompt-template.md)
  updated alongside prompt-shape guidance for slice work and bug fixes.
- Keep [`docs/refactor-decisions.md`](/Users/tim/22m/ai-projects/monies_map/docs/refactor-decisions.md)
  updated alongside decisions about shell shape, shared helpers, mobile
  workflow boundaries, money editing, bootstrap migration, and invalidation.
- Keep [`docs/README.md`](/Users/tim/22m/ai-projects/monies_map/docs/README.md)
  updated as the docs index when a doc is added, moved, or archived.
- Archived prompts in [`docs/archive/`](/Users/tim/22m/ai-projects/monies_map/docs/archive/)
  are historical records of finished slices and no longer need updating.
  Start new prompts from `docs/implementation-prompt-template.md`. Archived
  slice prompts:
  [first](/Users/tim/22m/ai-projects/monies_map/docs/archive/first-slice-prompt.md),
  [second](/Users/tim/22m/ai-projects/monies_map/docs/archive/second-slice-prompt.md),
  [third](/Users/tim/22m/ai-projects/monies_map/docs/archive/third-slice-prompt.md),
  [fourth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fourth-slice-prompt.md),
  [fifth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fifth-slice-prompt.md),
  [sixth](/Users/tim/22m/ai-projects/monies_map/docs/archive/sixth-slice-prompt.md),
  [seventh](/Users/tim/22m/ai-projects/monies_map/docs/archive/seventh-slice-prompt.md),
  [eighth](/Users/tim/22m/ai-projects/monies_map/docs/archive/eighth-slice-prompt.md),
  [ninth](/Users/tim/22m/ai-projects/monies_map/docs/archive/ninth-slice-prompt.md),
  [tenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/tenth-slice-prompt.md),
  [eleventh](/Users/tim/22m/ai-projects/monies_map/docs/archive/eleventh-slice-prompt.md),
  [twelfth](/Users/tim/22m/ai-projects/monies_map/docs/archive/twelfth-slice-prompt.md),
  [thirteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/thirteenth-slice-prompt.md),
  [fourteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fourteenth-slice-prompt.md),
  [fifteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fifteenth-slice-prompt.md),
  [sixteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/sixteenth-slice-prompt.md),
  and the
  [Stage 4 closure audit](/Users/tim/22m/ai-projects/monies_map/docs/archive/stage4-closure-audit-documentation-alignment-prompt.md).
- Keep [`docs/stage4-flow-index.md`](/Users/tim/22m/ai-projects/monies_map/docs/stage4-flow-index.md)
  and the page flow docs under `docs/flows/` aligned with the current route,
  state, and data contracts.
- Keep [`docs/stage4-close-checklist.md`](/Users/tim/22m/ai-projects/monies_map/docs/stage4-close-checklist.md)
  updated alongside the Stage 4 closure criteria.
- Refactor work should be committed in small readable batches as it proceeds.
  Use that practice for the first slice and keep it for later slices unless a
  slice is explicitly being held back for one atomic change.
- Finish each slice with a closure audit so the implementation, tests, and docs
  agree before the slice is considered complete.
- Never mark a slice complete unless the slice contract is proven by tests and
  runtime behavior.
- Keep the in-app guides updated alongside user-facing and setup changes:
  [`docs/user-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/user-guide.md)
  for how to use the app (plain language, no developer terms) and
  [`docs/developer-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/developer-guide.md)
  for setup, testing, deploy and internals. They render as the FAQ page's two
  tabs. Regenerate the screenshots a change affects with
  `npm run docs:screenshots` (demo data only, isolated ports);
  `tests/guide-content.test.mjs` checks every link, anchor and image.
- When implementation and documentation diverge, update the documentation in the
  same change whenever practical.

## Engineering posture

- Use systems thinking. Model the household finance domain carefully before
  adding UI or persistence shortcuts.
- Prefer ubiquitous language over local jargon. If a term is important enough
  to appear in routes, DTOs, tables, UI labels, or tests, it should have one
  canonical name in `DOMAIN.md`.
- Prefer vertical slices over horizontal utility sprawl. Build and refactor by
  end-to-end workflows such as imports, entries, months, splits, and settings.
- Build domain-first. Model business behavior in types and domain services
  before UI, and keep distinct semantics distinct when they represent different
  realities.
- Treat projections as first-class. When one underlying reality needs multiple
  views, keep operational, summary, review, compact, and audit-compatible
  projections synchronized and tested together.
- Practice TDD by scenario. Start each meaningful behavior change with a test or
  test update that describes the user-visible workflow before implementation
  details.
- Use runtime proof for user-facing behavior. Prefer real browser or real local
  worker verification over source inspection when the behavior is visible to a
  user.
- Never use browser system alerts, confirms, or prompts for app UX. Replace
  them with in-app dialogs, inline banners, or other app-native feedback that
  matches the surrounding desktop and mobile experience.
- Use `npm run test:e2e:smoke` as the standard smoke-bundle command when you
  need to verify the core desktop and mobile workflows together.
- Use `npm run verify` as the local merge gate. It must pass strict TypeScript,
  unit and parser contracts, the production build, and the smoke bundle.
- Keep `npm run lint` (correctness-only ESLint) and `npm run typecheck:client`
  (checkJs over `src/client`) at zero errors; both run in `verify`.
- Run `npm run test:e2e` before merging a large refactor branch or a change that
  affects shared route, settings, import, entry, month, or split orchestration.
  `npm run test:e2e:sharded` is the faster equivalent (isolated parallel stacks
  on their own ports and D1); browser tests must not depend on another spec
  file or on run order (`docs/audits/e2e-sharding.md`).
- Prove persistence or projection refactors with
  `node --experimental-sqlite --no-warnings scripts/persisted-state-snapshot.mjs <out.json>`:
  the normalized table and page-DTO dump must be identical before and after.
- Measure loading changes with `npm run test:performance` (built client) and
  compare cohorts with `scripts/compare-performance.mjs`; never claim a speed
  change from a single noisy run.
- Do not write shallow tests for implemented behavior. For any non-trivial
  slice, assert the concrete output shape and values, and include at least one
  negative test that proves the guarded or rejected path.
- Import parser changes must include near-real fixture coverage for every bank
  format they touch. Preserve real-world structure such as statement preambles,
  multiline descriptions, quoted comma amounts, dual date columns, and footer
  rows, with private account/person details sanitized. Synthetic one-line CSV
  or PDF snippets are only acceptable as narrow supplemental tests, not as the
  only regression proof for a supported import format.
- Prefer deep modules with small public surfaces and hidden internals over wide,
  shallow helper graphs.
- Prefer explicit domain boundaries between storage, transformation logic, DTOs,
  and UI presentation.
- Keep route orchestration thin. Page components should coordinate, not contain
  the whole system; extract helpers and view-models when a page starts carrying
  too many responsibilities.
- Build for change. Banks, import formats, categories, splits, and dashboard
  views will evolve over time.
- Optimize for maintainability over short-term convenience.

## Loading and data guardrails

These keep the measured loading, payload and reliability gains from drifting.
Details and the reasons are in `docs/code-spec.md` and
`docs/audits/macro-loading-baseline.md`.

- Load the active screen first. Optional work (route code warmup, speculative
  data, AI wording) starts only when `routeWork.usable` is true and goes
  through the warmup scheduler (`src/client/use-route-warmup.js`). Never add
  idle prefetch effects or eager imports of other routes to `App.jsx`.
- Keep the first screen within budget. `npm run check:bundle` (part of
  `npm run verify`) fails when the entry chunk plus the Summary route grows
  more than 5% past `scripts/initial-bundle-budget.json`. New code for other
  screens belongs behind a lazy route or a dynamic import.
- A page API sends only what its screen reads: no second copy of a list and
  no other route's DTO. `tests/e2e/api-performance.spec.js` fails when a page
  response grows more than 10% past `tests/e2e/api-payload-budget.json`.
- Raise either budget only for a deliberate, measured reason
  (`node scripts/check-initial-bundle.mjs --update`,
  `UPDATE_API_PAYLOAD_BUDGET=1`), and say why in the commit.
- Server data has one owner per kind (`reference-data-owner.js`,
  `summary-owner.js`, `route-data-owner.js`, `app-shell-owner.js`,
  `entries-data-owner.js`). Write through the owner so a superseded
  response can never overwrite newer data or raise an error screen; do not
  add a parallel `useState` copy of server data in `App.jsx`.
- Run a refresh after a save through `runBackgroundRefresh`
  (`use-refresh-notice.js`), never `.catch(() => null)`: a failure keeps the
  saved data and shows the retryable refresh notice, and a superseded or
  aborted one stays silent.
- Required reads go through `fetchQueryWithLease`, and speculative reads
  through `startSpeculativeQuery` (`src/client/query-leases.js`), so a
  navigation joins warm data instead of repeating or breaking it.
- Mobile speculative data needs a measured row in
  `src/client/route-warmup-admissions.js` (gzip bytes and handler p95 on the
  10k fixture, `tests/performance/api-admission.spec.js`). Unmeasured means
  not preloaded. It also needs a reported 4g connection, or an unknown one
  (iPhone) with a measured recent required request of at most 500 ms.
- Persistence writes live in the focused `app-repository-*` command modules
  and page projections in `*-projection.ts`. New code imports the specific
  module, never the `app-repository.ts` hub, and command modules never import
  each other.
- Persistence commands are all-or-nothing: read and check first, then
  commit all their writes, audit event and month refresh markers in one
  `db.batch()`, and refresh month totals after it with
  `refreshMonthlySnapshotsAfterWrite`. New or changed commands must not write
  with sequential `.run()` calls, and must be proved by a `failingStatement`
  test in `tests/atomic-writes-*.test.mjs`. Details and the modules not yet
  converted: "Persistence Atomicity Contract" in `docs/code-spec.md`.
- Keep `Server-Timing` as `app, init, total` with `app` first; budget checks
  read the first `dur`.
- Work in three passes: tests first, then runtime and failure behaviour in a
  real browser or Worker, then review and gates. A bug-fix test must fail on
  the old code before the fix counts.

## Optional AI Assistance

- Treat Workers AI as a separate, optional assistance layer, never as part of
  the finance engine or a required dependency for any core workflow.
- Core page loads, import parsing and preview, import commit, ledger writes,
  reconciliation, transfer matching, category application, freshness planning,
  and account prioritization must work identically when the AI binding is
  missing, disabled, rate-limited, malformed, or unavailable.
- Default to explicit user actions for AI. A financial-insight surface may make
  one debounced, non-blocking wording request after a stable page or filter
  change, only while the route is usable (no editor or save open), when the
  same computed-facts key is not in its short-lived in-memory cache. Keep a
  response only if it is OK, valid and still matches the facts on screen. It must render deterministic wording immediately, must not persist
  its cache, and must never run during initial data loading, a mutation,
  preview, commit, or reconciliation refresh. Do not add scheduled or hidden
  inference.
- Keep deterministic data and existing review controls authoritative. AI may
  phrase, rank, or propose a draft, but must not certify, import, categorize,
  skip, merge, delete, or link finance records by itself.
- Money insights are a deterministic, read-only projection. They may show
  recorded cash flow, plan variance, a same-season comparison that is
  already loaded, and explicit bank-proof gaps. They must never present a
  forecast, safe-to-spend promise, or savings target as an AI conclusion.
- Never send credentials, Shortcut tokens, original bank files, raw PDF/image
  binaries, full account/card numbers, or unbounded notes to AI. For a
  statement fallback, require explicit consent and send only bounded,
  redacted browser-extracted text after local parsers and in-browser OCR fail.
- Constrain and validate every AI input and output. Persist only the minimum
  aggregate allowance state needed for cost control, never prompts, responses,
  files, or embeddings unless a separately reviewed design explicitly changes
  that rule.
- Keep the configured AI allowance conservative enough for the intended free
  tier. Each AI slice must include no-AI/failure coverage proving the normal
  workflow remains usable, plus an audit note of its privacy, cost, and write
  boundaries.

## Code structure

- Prefer typed DTOs between layers instead of passing raw database rows straight
  into UI components.
- Organize new work by feature slice first, then by layer inside the slice when
  needed.
- Keep domain calculations in pure functions where possible.
- Separate import parsing, normalization, categorization, transfer matching, and
  dashboard aggregation concerns.
- Favor composable modules over large files with mixed responsibilities.
- Keep module APIs small. A caller should not need to understand a feature's
  internal helper graph to use it safely.
- Keep continuity as an invariant. Preserve state across rerender, route
  change, correction, and review flows where the workflow requires it.
- Treat corrections and review as serious system behavior. Support update,
  delete, merge, restore, undo, and reason capture where relevant, and make sure
  correction history propagates consistently across projections.

## Frontend guidance

- Do not add new visible controls, screens or user-facing copy without the
  owner's approval. When a fix changes how something looks or reads (layout,
  wording, a new state or button), list it with a before/after screenshot for
  the owner to decide instead of shipping it silently. Check the existing
  pattern first (for example the mobile floating "View and scope" bar) before
  proposing a new control.
- Keep rendering predictable and avoid state graphs that are easy to break.
- Prefer TanStack Query as the server-state boundary and keep query ownership
  close to the feature slice that consumes it.
- Avoid effect-driven derived state when selectors or pure calculations are
  enough.
- Be deliberate about rerenders. Expensive tables, charts, and filters should
  derive from stable inputs and memoized selectors.
- Prevent infinite loops by avoiding effect chains that update state derived
  from that same state.
- Avoid bootstrap payload growth. Fetch the smallest slice needed for the active
  screen and let summary, month, entries, imports, splits, and settings load
  independently.

## Domain guidance

- Treat [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md) as the
  canonical vocabulary for product and data-model terms.
- Cross-reference `DOMAIN.md` before introducing new entity names, and prefer
  extending existing terms over adding synonyms.
- Treat transactions, splits, imports, notes, and transfer links as first-class
  concepts.
- Keep import batches traceable so a bad import can be reviewed or removed
  without damaging other data.
- Model transfers explicitly instead of forcing them into income or expense
  semantics.
- Preserve enough structure so future AI analysis can reason over both ledger
  data and user-provided notes.

## Readability

- Write readable code first.
- Add concise comments where intent, business rules, or non-obvious tradeoffs
  would otherwise be hard to infer.
- Avoid comments that only restate the line below them.
- Prefer clear names over dense abstractions.
- Prefer user-friendly language in visible UI. Avoid internal jargon on the
  main surface and keep deeper interpretation in dedicated review surfaces.

## Documentation expectations

- Update this file when team conventions change.
- Keep agent-facing instructions short, prescriptive, and enforceable here in
  `AGENTS.md`.
- Update [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  when product behavior, data flow, technical direction, or staged refactor
  plan changes.
- Update [`docs/code-spec.md`](/Users/tim/22m/ai-projects/monies_map/docs/code-spec.md)
  when code-shape rules, query budgets, invalidation contracts, or
  implementation-reading guidance changes.
- Update [`docs/implementation-order.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-order.md)
  when the refactor execution order, per-slice migration strategy, or testing
  order changes.
- Update [`docs/preimplementation-checklist.md`](/Users/tim/22m/ai-projects/monies_map/docs/preimplementation-checklist.md)
  when the reusable audit checklist, hidden-coupling checks, or stop
  conditions change.
- Update [`docs/known-coupling-targets.md`](/Users/tim/22m/ai-projects/monies_map/docs/known-coupling-targets.md)
  when a refactor audit finds a user-visible coupling or contract risk that
  needs to stay on the test plan.
- Update [`docs/implementation-prompt-template.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-prompt-template.md)
  when the recommended prompt shape or required doc list changes.
- Update [`docs/refactor-decisions.md`](/Users/tim/22m/ai-projects/monies_map/docs/refactor-decisions.md)
  when a decision about App shell shape, shared helpers, mobile workflow
  shape, money editing, bootstrap dependence, or invalidation changes.
- Do not update archived prompts or reports in `docs/archive/`; they are
  historical. Move a finished prompt there with `git mv` and fix its links.
- Update [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md) when
  implementation boundaries such as the client deep module service evolve.
- Update [`docs/user-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/user-guide.md)
  when user-facing behavior or feature scope changes, and
  [`docs/developer-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/developer-guide.md)
  when setup steps, testing, deploy or internals change.
- Add narrower docs under `docs/` when a subsystem grows beyond what belongs in
  the main architecture file.
