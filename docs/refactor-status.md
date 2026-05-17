# Refactor Status

This file summarizes the current state of the Stage 4 implementation plan.
It is a living checkpoint, not a replacement for the slice prompts or audits.

## Implementation Plan

Primary reference:
- [`docs/implementation-order.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-order.md)

Supporting references:
- [`docs/slice-inventory.md`](/Users/tim/22m/ai-projects/monies_map/docs/slice-inventory.md)
- [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
- [`docs/code-spec.md`](/Users/tim/22m/ai-projects/monies_map/docs/code-spec.md)

## Status Summary

### Complete

- App shell and query infrastructure foundation
- Imports slice
- Entries slice
- Month slice
- Summary slice
- Splits slice
- Settings slice
- Settings hardening
- Smoke stabilization
- Cross-slice infrastructure cleanup

### Partial

- App shell orchestration thinning
  - The shell is no longer the default coordination path for the stabilized workflows.
  - `App.jsx` still owns the shell/query coordination boundary and remains a gravity center to watch.
- Shared invalidation helpers
  - The helpers are narrower than before and protected by regression tests.
  - They still exist and need continued pressure testing if future slices expand them.
- Explicit shell refresh escape hatches
  - The escape hatch is now named and justified in the refresh plans.
  - It remains available and should stay tightly scoped.

### Open

- Final removal of coordination gravity from `App.jsx`
- Continued narrowing of explicit shell-refresh use
- Ongoing protection against broad invalidation creep in shared helpers
- Future slice-specific contract hardening if new workflows introduce new state ownership

## What Changed Most Recently

- Imports refresh stopped clearing unrelated summary caches up front.
- Split cache clearing now clears app-shell state only when `refreshShell` is explicitly requested.
- Query foundation tests now assert that import invalidation does not touch the app-shell key.

## What the Plan Looks Like Now

The refactor is no longer a feature-slice buildout. The product slices are in place.
The remaining work is infrastructure thinning:

1. keep `App.jsx` from absorbing new ownership
2. keep shared invalidation narrow
3. keep explicit shell refresh rare and named
4. add tests whenever a new coordination risk appears

## What Final Closure Would Require

- `App.jsx` remains composition-only, with no new long-lived server-state ownership.
- shared invalidation helpers remain narrow and slice-backed.
- explicit shell refresh stays a bounded exception, not the default fallback.
- the full serial smoke bundle continues to pass.
- future changes do not reintroduce broad coordination paths.

