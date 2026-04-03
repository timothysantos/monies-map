# Project Working Rules

This document captures the default engineering expectations for this repository.
It is a living document and should be updated as the product, architecture, and
team conventions evolve.

## Living guidance

- Keep this file updated as the app progresses.
- Keep [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  updated alongside meaningful product and technical changes.
- Keep [`docs/faq.md`](/Users/tim/22m/ai-projects/monies_map/docs/faq.md)
  updated alongside user-facing product, setup, and workflow changes.
- When implementation and documentation diverge, update the documentation in the
  same change whenever practical.

## Engineering posture

- Use systems thinking. Model the household finance domain carefully before
  adding UI or persistence shortcuts.
- Prefer explicit domain boundaries between storage, transformation logic, DTOs,
  and UI presentation.
- Build for change. Banks, import formats, categories, splits, and dashboard
  views will evolve over time.
- Optimize for maintainability over short-term convenience.

## Code structure

- Prefer typed DTOs between layers instead of passing raw database rows straight
  into UI components.
- Keep domain calculations in pure functions where possible.
- Separate import parsing, normalization, categorization, transfer matching, and
  dashboard aggregation concerns.
- Favor composable modules over large files with mixed responsibilities.

## Frontend guidance

- Keep rendering predictable and avoid state graphs that are easy to break.
- Avoid effect-driven derived state when selectors or pure calculations are
  enough.
- Be deliberate about rerenders. Expensive tables, charts, and filters should
  derive from stable inputs and memoized selectors.
- Prevent infinite loops by avoiding effect chains that update state derived
  from that same state.

## Domain guidance

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
- Update [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  when product behavior, data flow, or technical direction changes.
- Update [`docs/faq.md`](/Users/tim/22m/ai-projects/monies_map/docs/faq.md)
  when user-facing behavior, setup steps, or feature scope changes.
- Add narrower docs under `docs/` when a subsystem grows beyond what belongs in
  the main architecture file.
