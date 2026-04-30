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
