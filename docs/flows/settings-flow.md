# Settings Flow

This doc describes the Settings page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/settings`

The route state carries the active settings section. The browser location is
the source of truth.

## State Flow

Settings state is split between:

- route state for the active section
- server state for the settings page DTO
- workflow state for account, category, person, checkpoint, and reconciliation
  actions
- workflow state for Apple Pay shortcut installation, private key edits,
  default shortcut params, and default-account priority order
- transient UI state for dialogs and section disclosure

Settings should stay lightweight. It should not become a hidden app-shell
state container.

## Data Flow

Settings data comes from:

- `GET /api/settings-page`

Reference-data settings changes may also refresh:

- `entries`
- `imports`
- `month`
- `splits`
- `summary`

when the change truly affects shared metadata.

## Ownership Notes

Settings owns:

- accounts
- categories
- people
- category rules
- checkpoints
- reconciliation exceptions
- unresolved transfer review
- Apple Pay shortcut install state, private key, default shortcut params, and
  default account fallback order

The Apple Pay shortcut install flow is ordered deliberately:

1. create a private key if none exists
2. build and copy the authenticated connection URL
3. persist the settings
4. open the verified, secret-free iCloud shortcut

The iCloud artifact uses an Apple setup question targeting a plain Text action
to receive the copied URL. The Text action then supplies the POST action's URL;
using Apple's URL-list setup editor is prohibited because it can clear a full
URL pasted on iPhone. The public artifact never owns the household key. Default
account reordering saves immediately; advanced key and default-param text edits
retain an explicit save.

The shared shortcut accepts the device-local Transaction automation's
Dictionary input with `value`, `merchant`, and `name` keys. The automation's
final action runs `Monies Map Apple Pay API` with that Dictionary. An older
helper shortcut must not remain as an additional hop or a second target because
that obscures ownership and can produce duplicate ledger rows.
After a successful POST, the shortcut opens the response `openUrl` for optional
entry edits and confirms the Wallet merchant and amount in a notification.
In production the copied URL targets the public, shortcut-only gateway rather
than the Cloudflare Access-protected app hostname. The gateway shares app
settings through D1 and exposes no Settings, ledger, import, or static-app route.

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep shell refresh as a named exception, not a default fallback

## Known Exceptions / Watch Areas

- reference-data changes may justify shell refresh when the change affects
  shared metadata used outside Settings
- settings form drafts and visibility-only changes should not invalidate server
  data
