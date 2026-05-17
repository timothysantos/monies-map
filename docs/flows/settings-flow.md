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

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep shell refresh as a named exception, not a default fallback

## Known Exceptions / Watch Areas

- reference-data changes may justify shell refresh when the change affects
  shared metadata used outside Settings
- settings form drafts and visibility-only changes should not invalidate server
  data
