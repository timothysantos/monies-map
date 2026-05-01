# Design Notes

This file captures design-level implementation boundaries that are more
specific than the domain glossary and more tactical than the architecture
overview.

## Client Deep Module Service

The canonical client deep module service is
[`src/client/monies-client-service.js`](/Users/tim/22m/ai-projects/monies_map/src/client/monies-client-service.js).

Purpose:

- expose one stable utility surface for client components
- hide leaf helper layout behind a single import boundary
- keep feature code from reaching into many low-level helper files directly

Rules:

- client components should prefer `moniesClient` over importing leaf helper
  modules directly
- when a helper is broadly reusable across client features, add it behind
  `moniesClient` instead of creating new ad hoc cross-component imports
- keep `moniesClient` organized by domain slices such as `accounts`,
  `categories`, `entries`, `format`, `imports`, `months`, and `splits`
- do not put network mutations or route state in `moniesClient`; it is a
  helper-service boundary, not an API transport layer
- when refactoring client logic, preserve the rule that components should not
  need to know which leaf helper file owns a small formatting or transformation
  rule

How this relates to other docs:

- [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md) defines the
  business vocabulary
- [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  defines system-wide structure and data flow
- this file defines a practical implementation boundary for client-side code

## Import Preview Matcher Boundary

The canonical import-preview matcher lives in
[`src/domain/app-repository-import-preview.ts`](/Users/tim/22m/ai-projects/monies_map/src/domain/app-repository-import-preview.ts).

Rules:

- apply certification-status eligibility checks before date-distance or
  description-similarity scoring
- treat `statement_certified` ledger entries as locked and never eligible for a
  new incoming bank-row match
- allow mid-cycle sources such as CSV/XLS to reconcile only against manual
  provisional ledger rows
- allow official PDF statements to reconcile against both manual provisional and
  import provisional rows so month-end statement imports can promote existing
  working rows instead of duplicating them
- keep the status guard separate from ranking heuristics so source authority is
  explicit and easy to audit

Why:

- To prevent cross-bank false positives on high-velocity recurring charges,
  mid-cycle imports only match pending manual entries. However, official PDF
  statement imports can match against mid-cycle provisional entries to elevate
  them to certified status.
