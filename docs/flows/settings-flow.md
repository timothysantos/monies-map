# Settings Flow

This doc describes the Settings page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/settings`

Settings > Cards and rewards (`settings-card-rewards-section.jsx`) reads
`GET /api/card-rewards/rules` only when opened, saves through `POST
/api/card-rewards/rules` and `/suggest-from`, and refreshes the Summary card's
query (`queryKeys.cardRewards`).

The route state carries the active settings section. The browser location is
the source of truth.

## State Flow

Settings state is split between:

- route state for the active section
- server state for the settings page DTO
- workflow state for account, category, person, checkpoint, and reconciliation
  actions
- workflow state for Apple Pay shortcut installation, private key edits,
  default shortcut params, and default-account priority order, for the person
  chosen on "Who is this phone for?" (one connection per person; the row shows
  with two or more people, and **Stop this phone** under More shortcut settings
  asks in an in-app dialog first)
- workflow state for each person's payment ways (DOMAIN.md, "Payment Way")
- transient UI state for dialogs and section disclosure

Each section is wrapped in `GuardedSettingsSection` (`settings-section.jsx`): a
section that cannot draw its data is replaced by the app's own "could not be
shown" panel (Try again, Reload app) and the rest of Settings keeps working.
`tests/e2e/settings-section-crash.spec.js` proves it.

Settings should stay lightweight. It should not become a hidden app-shell
state container.

Empty sections say what is missing instead of showing a bare dash:
- category rules: "No category rules yet. …"
- unresolved transfers: "No transfers need review right now."
- recent activity: "No balance activity recorded yet."

They use the shared `EmptyState`. Form errors are `InlineError` alerts.

## Data Flow

Settings data comes from:

- `GET /api/settings-page`

`settingsPage.paymentWays` lists one effective payment way per person
(defaults applied). Payment ways sit in their own section after the Apple
Pay shortcut: per person a "PayNow and bank transfers" select (active bank
accounts, the person's own first, then shared, then other people's) and a
"Cash" select (active cash accounts; disabled with a hint when there are
none). Each change posts that person's two values to
`POST /api/settings/payment-ways/save` straight away, like Default account
priority, and refreshes with the `payment_way_saved` plan (Settings only).
A refusal shows its reason above the people and puts the select back.

The Ask and AI section (after the Apple Pay shortcut) shows the Claude
credit status from `GET /api/ai-assist/provider-status` (DOMAIN.md "AI
Provider Status"), not from the settings page DTO. It is read lazily, once
Settings is first usable, through `useClaudeCreditStatus`
(`claude-credit-status.js`: `fetchQueryWithLease` under
`queryKeys.claudeCreditStatus()`, the same entry the Ask notice reads, kept
for five minutes); a failed read or `{ visible: false }` leaves the section
out. Opened, the section shows the same status line as the Ask notice
(`buildClaudeCreditLine`; "Claude credits are fine: about $X of $Y used."
when fine, figures dropped with money hidden), the "Top up in the Claude
Console" link and "I've topped up", and "Last checked" with the time the
status was read. When Claude is not set up (or the state is unknown after a
failure) it shows only "Claude isn't set up, so Ask uses the basic model.";
set up but not answered yet (state unknown, no failure recorded) it shows
only "Claude hasn't been used yet." I've topped
up opens the same form as on Ask and posts
`POST /api/ai-assist/provider-status/topped-up { creditUsd }`; its answer
replaces the kept status. Nothing else on Settings refreshes. Design and
flow details: design.md "Claude credit notice", `docs/flows/ask-flow.md`
"Claude credits".

Reference-data settings changes may also refresh:

- `entries`
- `imports`
- `month`
- `splits`
- `summary`

when the change truly affects shared metadata.

Compare statement posts the card's rows and the PDF's other card sections to
`POST /api/accounts/checkpoints/compare-statement`, which returns the
comparison with `statementDiagnosis` (corrections after commit). Applying or
undoing one posts to `/api/accounts/checkpoints/statement-corrections/apply`
or `/undo`, re-runs the same comparison, and refreshes with the
`statement_corrected` / `statement_correction_undone` plan (entries, month,
summary and imports, because an import a removal depends on can no longer be
rolled back).

## Ownership Notes

Settings owns:

- accounts
- categories
- people
- category rules
- checkpoints
- statement corrections from Compare statement (DOMAIN.md, "Statement
  Correction")
- reconciliation exceptions
- unresolved transfer review
- Apple Pay shortcut install state, private key, default shortcut params, and
  default account fallback order
- payment ways: each person's PayNow and bank transfers account and cash
  wallet, read by the entry draft
- the Ask and AI section's display (the Claude credit status itself is the
  query cache's, shared with the Ask notice)

The Apple Pay shortcut install flow is ordered deliberately:

1. create a private key if none exists
2. build and copy the authenticated connection URL
3. persist the settings
4. open the verified, secret-free Apple-signed shortcut file served by the app

The signed artifact uses an Apple setup question targeting a plain Text action
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
The POST includes a per-run request ID so a network retry is idempotent. The API
uses an exact active-account match from Wallet `name` before default account
priority, validates named currency against that account, and reports the account
resolution in its response. After a successful POST, the shortcut opens the
response `openUrl` for optional entry edits and confirms the Wallet merchant,
amount, and resolved account in a notification.
In production the copied URL targets the public, shortcut-only gateway rather
than the Cloudflare Access-protected app hostname. The gateway shares app
settings through D1 and exposes no Settings, ledger, import, or static-app route.

Artifact lifecycle is separate from installation state. The source plist,
exact signed release, public download, and checksum manifest live under
`shortcuts/apple-pay-api/` and `public/shortcuts/`. The project owner's synced
personal source copy is only an editing convenience. Existing installed copies
do not follow local source edits or deployments. Releasing a revision requires
Apple signing plus aligned repository artifacts, Settings path, browser test,
FAQ, and deployment.

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep shell refresh as a named exception, not a default fallback

## Known Exceptions / Watch Areas

- reference-data changes may justify shell refresh when the change affects
  shared metadata used outside Settings
- settings form drafts and visibility-only changes should not invalidate server
  data
