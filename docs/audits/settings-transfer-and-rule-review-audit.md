# Settings Transfer and Rule Review Audit

Updated: 2026-07-08

## Scope

- Duplicate and overlapping category-rule issue ignore flow.
- Settings unresolved transfer review list.
- Cross-link from Settings unresolved transfers to Entries.
- In-place transfer matching from Settings using the same transfer manager dialog
  as Entries.
- Manual and focus-return refresh for unresolved transfer rows after the user
  opens a matching row in another tab.

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
- Opening Entries in a new tab intentionally leaves Settings mounted. Without a
  section-level refresh affordance, users had to reload the whole page to see
  transfer links or clears completed in the other tab.

## Changes

- `category_rule_issue_ignored` now uses the same narrow category-rule refresh
  plan as other category-rule mutations.
- Settings transfer rows now open Entries in a new tab using the unresolved
  transfer row's own month and entry id.
- Settings transfer rows now include a Manage transfer action that loads the
  full transfer row and candidates from `/api/transfers/candidates`, then opens
  the shared transfer manager dialog.
- The unresolved transfers section now has a Refresh action, and Settings does
  a one-shot refresh when the tab regains focus after Open in entries.
- Transfer links or transfer settlements performed from Settings refresh the
  Settings list and invalidate affected Entries, Month, and Summary route
  families.

## Proof

- `tests/settings-refresh-plan.test.mjs` covers duplicate-rule ignore and
  Settings transfer mutation refresh plans.
- `tests/e2e/settings-reference-data.spec.js` covers immediate duplicate-rule
  issue removal, new-tab Entries navigation, and resolving a matching transfer
  directly from Settings.
- `tests/e2e/settings-reference-data.spec.js` also covers the unresolved
  transfer Refresh action reloading rows changed outside the mounted Settings
  page.
