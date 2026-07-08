# Settings Transfer and Rule Review Audit

Updated: 2026-07-08

## Scope

- Duplicate and overlapping category-rule issue ignore flow.
- Settings unresolved transfer review list.
- Cross-link from Settings unresolved transfers to Entries.
- In-place transfer matching from Settings using the same transfer manager dialog
  as Entries.

## Findings

- Ignoring duplicate category-rule issues wrote the ignore row successfully, but
  `category_rule_issue_ignored` was missing from the settings refresh-plan
  allowlist. The post-mutation refresh failed before the settings page DTO was
  reloaded, leaving the ignored issue visible until manual reload.
- Settings unresolved transfers used a same-tab Entries navigation helper and
  defaulted the Entries month from the current Settings URL, not from the
  transfer row date.
- The Entries transfer manager was already a reusable component, but Settings
  only exposed clear and open-in-entries actions.

## Changes

- `category_rule_issue_ignored` now uses the same narrow category-rule refresh
  plan as other category-rule mutations.
- Settings transfer rows now open Entries in a new tab using the unresolved
  transfer row's own month and entry id.
- Settings transfer rows now include a Manage transfer action that loads the
  full transfer row and candidates from `/api/transfers/candidates`, then opens
  the shared transfer manager dialog.
- Transfer links or transfer settlements performed from Settings refresh the
  Settings list and invalidate affected Entries, Month, and Summary route
  families.

## Proof

- `tests/settings-refresh-plan.test.mjs` covers duplicate-rule ignore and
  Settings transfer mutation refresh plans.
- `tests/e2e/settings-reference-data.spec.js` covers immediate duplicate-rule
  issue removal, new-tab Entries navigation, and resolving a matching transfer
  directly from Settings.
