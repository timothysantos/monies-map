# Shortcut Default Params Audit

Date: 2026-07-05

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
- Apple Shortcuts setup support: Settings exposes the parameter reference and a
  `shortcuts://create-shortcut` link for opening Apple's shortcut editor.

## Existing-State Findings

- The API endpoint already used default account priority when `accountId` and
  `accountName` were omitted.
- The quick-entry URL flow still required `account` or `account_id`; otherwise
  it opened a draft without a wallet.
- Settings showed endpoint/key/account priority, but did not show the complete
  API and URL parameter lists.
- There was no place to save user-desired default params such as category,
  owner, shared/direct ownership, or view.
- Apple documents `shortcuts://create-shortcut` for opening a blank shortcut
  editor, but does not document a URL that pre-populates all actions in a
  shortcut.

## Implemented Contract

- `settingsPage.shortcutSettings.defaultParams` is persisted with the shortcut
  settings JSON.
- The Settings Shortcut API section includes:
  - editable default params,
  - system defaults as help text,
  - quick-entry URL parameter reference,
  - direct-create API JSON parameter reference,
  - a link to open Apple's new-shortcut editor.
- Direct-create API merges default params first and request JSON second.
- Quick-entry URL merges default params first and explicit URL params second.
- Both flows use default account priority when no account is supplied.

## Test Coverage

- `tests/quick-entry-url-defaults.test.mjs` covers URL default-param merging,
  account-priority fallback, and explicit account override.
- `tests/settings-workflow.test.mjs` covers the settings draft preserving saved
  default params.
- `tests/e2e/settings-reference-data.spec.js` covers API default params being
  returned by Settings and applied to direct-create requests.

## Residual Risks

- The `shortcuts://create-shortcut` link can only open Apple's blank shortcut
  editor. A true install experience requires a separately created shared
  iCloud Shortcut URL.
- Default params are intentionally stored as a query string so users can copy
  Apple Shortcut URL fragments directly. Validation is lightweight; invalid
  keys are ignored unless the target flow already validates them.
