# Design Notes

This file captures design-level implementation boundaries that are more
specific than the domain glossary and more tactical than the architecture
overview.

## Client Deep Module Strategy

The current canonical client deep module service is
[`src/client/monies-client-service.js`](/Users/tim/22m/ai-projects/monies_map/src/client/monies-client-service.js),
but the long-term target is not one giant helper barrel. The target is a small
set of feature-level deep modules with narrow public APIs.

Purpose:

- expose stable utility and workflow surfaces for client components
- hide leaf helper layout behind a small number of intentional import boundaries
- keep feature code from reaching into many low-level helper files directly
- let each vertical slice own its own query keys, selectors, formatters, and
  workflow helpers without leaking them app-wide

Rules:

- client components should prefer slice-level deep modules over direct imports
  from many leaf helpers
- new shared helpers should not be promoted globally by default; first ask
  whether they belong inside one slice deep module
- the target slices are `summary`, `months`, `entries`, `imports`, `splits`,
  and `settings`
- each slice deep module may expose a small surface such as:
  - query option builders
  - selectors and derived-view helpers
  - display formatting tied to that slice
  - mutation orchestration helpers
- do not put raw transport details or route wiring directly into display
  components
- do not create cross-slice helper tangles. If two slices need the same logic,
  either move it into a truly shared domain/helper module or duplicate the
  simplest form until the right abstraction is clear
- a deep module should be easy to use and hard to misuse. Its public API should
  be shorter than the internal work it hides

How this relates to other docs:

- [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md) defines the
  business vocabulary
- [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  defines system-wide structure, staged refactor order, and data flow
- this file defines practical implementation boundaries for client-side code

## Apple Shortcut Install Boundary

The Settings slice owns the Apple Pay shortcut install workflow. The display
component renders progress and advanced controls, while the Settings panel
creates the private key, builds and copies the authenticated connection URL,
persists the settings, and refreshes the settings query.

The Settings DTO may supply an absolute endpoint for the dedicated production
shortcut gateway. The client resolves relative local/test endpoints and that
absolute production endpoint through the same URL constructor; it does not
hard-code a second routing rule.

The shared iCloud URL is a reviewed product artifact, not a source of household
configuration. It must contain neither the API key nor a private connection
URL. Apple's setup question injects that private URL only after the user opens
the shared shortcut. The question targets a plain Text action whose output is
the POST destination; it must not target a URL action because Apple's URL-list
editor can discard a pasted connection URL during setup. The direct-create
route remains responsible for token validation, date normalization,
default-account selection, and entry creation.

The artifact input is the device-local Transaction automation's Dictionary with
`value`, `merchant`, and `name` keys. The automation calls the shared shortcut
directly; a legacy helper shortcut is not part of the supported chain. After a
successful POST, the shortcut reads `openUrl` from the response, opens the saved
entry, and confirms the merchant and amount in a notification.
The production gateway exposes only that direct-create path, shares D1 with the
protected app, and builds response deep links against the protected app origin.

The install action opens its target window synchronously before asynchronous
save work so browser popup protection does not turn a successful setup into a
dead button. Failure closes the placeholder window and leaves an inline error.

## Import Preview Matcher Boundary

The canonical import-preview matcher lives in
[`src/domain/app-repository-import-preview.ts`](/Users/tim/22m/ai-projects/monies_map/src/domain/app-repository-import-preview.ts).

Rules:

- run exact duplicate suppression before any certification-status or
  source-isolation guard
- exact duplicate suppression should auto-skip rows that share the same amount,
  mapped account, and either the same normalized import hash or a perfect
  normalized description match on the same day
- apply certification-status eligibility checks only inside the promotion and
  reconciliation lane, before date-distance or description-similarity scoring
- treat `statement_certified` ledger entries as locked and never eligible for a
  new incoming bank-row reconciliation match
- allow mid-cycle sources such as CSV/XLS to reconcile only against manual
  provisional ledger rows
- allow official PDF statements to reconcile against both manual provisional and
  import provisional rows so month-end statement imports can promote existing
  working rows instead of duplicating them
- keep exact duplicate suppression separate from status-guarded reconciliation
  so overlapping files auto-skip cleanly while recurring-charge heuristics stay
  isolated to the promotion lane

Why:

- To prevent cross-bank false positives on high-velocity recurring charges,
  mid-cycle imports only match pending manual entries. However, official PDF
  statement imports can match against mid-cycle provisional entries to elevate
  them to certified status.
- Repeated overlapping bank exports should still auto-skip truly identical
  rows, even when those rows would be excluded from reconciliation by the
  promotion-lane source guards.

## Import Inbox And Intake Boundary

Import Inbox planning belongs to the Imports slice. It is route-level product
state, not app-shell chrome: Summary and Month may show a compact stale banner,
but the checklist, bank-session grouping, and review order live on Imports.

Rules:

- group download work by bank session so a user logs into one institution and
  collects every needed file there
- keep accounting review order separate from download order, with statements
  reviewed oldest period first
- do not require filename conventions for the guided workflow; classify queued
  files from parsed account, period, source, row, and checkpoint evidence
- keep multi-file intake browser-only. Queue items may retain parsed rows,
  checkpoints, and generic CSV text in transient page state, but they must not
  retain `File` objects or persist original PDFs, CSVs, XLS files, OCR images,
  or raw bank files
- keep HSBC image PDFs on the same private browser OCR path as single-file
  import, then load the parsed statement into the normal preview/review flow
- keep split cleanup separate from required bank-file collection
