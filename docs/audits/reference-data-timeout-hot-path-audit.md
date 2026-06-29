# Reference Data Timeout Hot-Path Audit

Date: 2026-06-29

## Symptom

The app loaded the shell but then showed:

> Reference data request timed out after 45 seconds.

The same page also reported the summary request timing out. Cloudflare
observability had previously shown Worker CPU-limit failures on route loads.

## Root Cause

The OCBC legacy value-date repair was correct as data repair, but it was too
close to hot read paths:

- `buildReferenceDataDto` called `ensureAppData`.
- `ensureAppData` runs schema and startup maintenance work per Worker isolate.
- `loadAccounts` also called the OCBC repair directly.
- The repair was an `UPDATE transactions ... note LIKE value date` scan. Running
  that scan from read endpoints can exceed Cloudflare Worker resource limits,
  especially when multiple route slices load at once.

Reference data should be a small account/category read. It should not run schema
startup, seed logic, or one-off data repairs.

## Fix

- `/api/reference-data` now reads only account references and categories.
- The OCBC value-date repair now writes an `app_maintenance_tasks` completion
  marker after it runs.
- `loadAccounts` no longer performs repair work.
- The repair remains in schema/startup maintenance, but later Worker isolates
  skip the expensive scan after the database marker exists.

## Regression Tests

- `tests/domain-boundaries.test.mjs`
  - proves `buildReferenceDataDto` does not call `ensureAppData`.
- `tests/repository-repairs.test.mjs`
  - proves the OCBC repair updates legacy rows once.
  - proves a maintenance marker prevents later PRAGMA/UPDATE work.
- Existing app-shell e2e checks continue to prove `/api/reference-data` owns
  only lightweight account/category lists.

## Follow-Up Guardrail

One-off repairs and schema migrations may run during explicit initialization,
but they must not be invoked from route read helpers such as reference data,
summary, entries, or settings account loading. If a repair needs to be retried,
store a database marker and make the retry path bounded.
