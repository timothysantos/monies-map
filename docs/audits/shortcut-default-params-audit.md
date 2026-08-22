# Shortcut Default Params Audit

Date: 2026-08-22

## Feature List

- Direct-create API shortcut: `POST /api/shortcuts/entries/create` creates a
  saved entry, validates API key, timestamp, and nonce, then returns an
  `openUrl`.
- Quick-entry URL shortcut: `/entries?action=add-expense` opens a prefilled
  draft for review before save.
- Shortcut API settings: stores the API key, active-account priority order, and
  now a query-string style default-params field.
- Account fallback: both the API and quick-entry URL use the first active
  account in the configured priority order when account fields are omitted.
- Apple Shortcuts setup support: Settings exposes a verified shared shortcut
  install action plus the advanced parameter reference.

## Existing-State Findings

- The API endpoint already used default account priority when `accountId` and
  `accountName` were omitted.
- The quick-entry URL flow still required `account` or `account_id`; otherwise
  it opened a draft without a wallet.
- Settings showed endpoint/key/account priority, but did not show the complete
  API and URL parameter lists.
- There was no place to save user-desired default params such as category,
  owner, shared/direct ownership, or view.
- Opening Apple's blank shortcut editor did not satisfy the expected install
  experience and left users to enter header and JSON keys manually.

## Implemented Contract

- `settingsPage.shortcutSettings.defaultParams` is persisted with the shortcut
  settings JSON.
- The Settings Shortcut API section includes:
  - editable default params,
  - system defaults as help text,
  - quick-entry URL parameter reference,
  - direct-create API JSON parameter reference,
  - a one-action verified Apple shortcut install flow.
- Direct-create API merges default params first and request JSON second.
- Quick-entry URL merges default params first and explicit URL params second.
- Both flows use default account priority when no account is supplied.
- Default-account priority moves save immediately from the reorder control;
  API key and default-param text edits still use Save shortcut settings.

## Test Coverage

- `tests/quick-entry-url-defaults.test.mjs` covers URL default-param merging,
  account-priority fallback, and explicit account override.
- `tests/settings-workflow.test.mjs` covers the settings draft preserving saved
  default params.
- `tests/e2e/settings-reference-data.spec.js` covers API default params being
  returned by Settings and applied to direct-create requests.

## Residual Risks

- The shared shortcut installs the API actions, but Apple requires each device
  to create its own personal Transaction automation.
- Default params are intentionally stored as a query string so users can copy
  Apple Shortcut URL fragments directly. Validation is lightweight; invalid
  keys are ignored unless the target flow already validates them.
