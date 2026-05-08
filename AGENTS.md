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
- Keep [`docs/faq.md`](/Users/tim/22m/ai-projects/monies_map/docs/faq.md)
  updated alongside user-facing product, setup, and workflow changes.
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
- Practice TDD by scenario. Start each meaningful behavior change with a test or
  test update that describes the user-visible workflow before implementation
  details.
- Prefer deep modules with small public surfaces and hidden internals over wide,
  shallow helper graphs.
- Prefer explicit domain boundaries between storage, transformation logic, DTOs,
  and UI presentation.
- Build for change. Banks, import formats, categories, splits, and dashboard
  views will evolve over time.
- Optimize for maintainability over short-term convenience.

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

## Frontend guidance

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
- Update [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md) when
  implementation boundaries such as the client deep module service evolve.
- Update [`docs/faq.md`](/Users/tim/22m/ai-projects/monies_map/docs/faq.md)
  when user-facing behavior, setup steps, or feature scope changes.
- Add narrower docs under `docs/` when a subsystem grows beyond what belongs in
  the main architecture file.
