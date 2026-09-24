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
- the global app shell must not import a broad deep-module facade when it only
  needs a small shared formatter or normalizer. Import that leaf directly, and
  keep route-only components in their owning lazy route chunk.

How this relates to other docs:

- [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md) defines the
  business vocabulary
- [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  defines system-wide structure, staged refactor order, and data flow
- this file defines practical implementation boundaries for client-side code

## Splits Visual Contract

The splits page owns a complete color contract for every new or updated
surface. Keep section backgrounds, headings, body text, muted text, primary
buttons, secondary buttons, link buttons, controls, focus states, status
states, and disabled states scoped under `.panel-splits` (or a splits-owned
component token). Every action must retain readable contrast against its
actual background on desktop and mobile. New splits UI must be placed in the
page hierarchy where the next user action is discoverable; long chronological
lists must not hide status, archive access, or navigation actions below the
fold.

Travel split records use the same splits-owned visual tokens for currency,
payment method, pending statement evidence, and FX review. Foreign amounts are
shown as entered, with any home-currency estimate or converted ledger amount
secondary and explicitly labeled.

Split activity history is an action-oriented recovery surface opened from the
splits summary area. It uses the splits color contract, stays compact and
newest-first, labels archived actions clearly, and places Restore beside a
recoverable record without exposing destructive controls in the history list.

Simplified settlement uses two distinct user facts: `Mark paid` records the
people's confirmation and collapses the checkpoint into a follow-up queue;
`Match bank transfer` records the independent ledger evidence. The queue is
collapsed by default, retains the included-record manifest, supports `Undo
paid`, and shows paid follow-ups across currencies so changing split groups
cannot hide one. The user can expand one item to match a transfer from the
currently selected ledger month. It must never style a paid confirmation as a
bank match.

Financial insight is deliberately compact by default. It shows a two-line,
visually ellipsized narrative preview and a clear `Read full insight` control;
the full narrative, money consequence map, and record actions are revealed
only on demand. Expanding is local presentation state and must not trigger an
additional AI request. The preview also surfaces one stable, computed entry
pattern such as spending concentration or repeated merchant activity. Its
wording varies deterministically with the visible facts, so it stays specific
without changing on a rerender or relying on AI.

The Splits workspace uses a dark surface but paid-settlement follow-ups use a
light proof card. Controls on that card must use an explicit light-card theme:
readable dark secondary actions, a distinct caution treatment for `Undo paid`,
and a high-contrast primary treatment for the later bank-transfer match.

## Apple Shortcut Install Boundary

The Settings slice owns the Apple Pay shortcut install workflow. The display
component renders progress and advanced controls, while the Settings panel
creates the private key, builds and copies the authenticated connection URL,
persists the settings, and refreshes the settings query.

The Settings DTO may supply an absolute endpoint for the dedicated production
shortcut gateway. The client resolves relative local/test endpoints and that
absolute production endpoint through the same URL constructor; it does not
hard-code a second routing rule.

The repository-owned Apple-signed file is a reviewed product artifact, not a
source of household configuration. It must contain neither the API key nor a
private connection URL. Apple's setup question injects that private URL only
after the user opens the file. The question targets a plain Text action whose output is
the POST destination; it must not target a URL action because Apple's URL-list
editor can discard a pasted connection URL during setup. The direct-create
route remains responsible for token validation, typed normalization, account
selection, currency enforcement, idempotency, and entry creation.

The artifact input is the device-local Transaction automation's Dictionary with
`value`, `merchant`, and `name` keys. The automation calls the shared shortcut
directly; a legacy helper shortcut is not part of the supported chain. After a
successful POST, the shortcut reads `openUrl` and `accountName` from the
response, opens the saved entry, and confirms the merchant, amount, and account
in a notification. It sends a per-run request ID so the server can return the
existing row after an HTTP retry.
The production gateway exposes only that direct-create path, shares D1 with the
protected app, and builds response deep links against the protected app origin.

The reviewed source, exact signed release, and release manifest live under
`shortcuts/apple-pay-api/`; a byte-identical signed download lives under
`public/shortcuts/`. The manifest install path must match the Settings constant
and browser contract. Automated tests verify the checksums, action count, setup
question, POST and response behavior markers, and absence of authentication
material. A personal Shortcuts copy can be used for editing, but it is not the
only source and must never be treated as the release authority.

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

The compact stale banner is optional warmup work. It reuses the Imports cache
when fresh and only starts after Summary or Month is usable; it never delays or
re-fetches the active route merely to update banner wording.

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

## Optional AI Assistance Boundary

The optional Workers AI surface is a small client-to-Worker boundary. It is
never loaded as part of route bootstrap, import preview, import commit,
reconciliation refresh, or freshness calculation. The client exposes explicit
actions for narrative drafting, category-rule proposals, candidate ranking,
and a per-file statement-text fallback. Summary, Month, Entries, and Splits
also render a deterministic Financial insight immediately and may make one
debounced, cache-missed wording request after the view is stable. That cache is
memory-only and short-lived. The Worker validates every response against
existing DTO data and returns an unavailable result when the binding, quota, or
model is unavailable. The shared insight labels whether it is looking at full
cash flow, a filtered investigation, or split obligations, then gives a bounded
next-spend consideration from those already-computed facts. When deterministic
evidence warrants it, the component exposes a Review action that opens the
existing filtered Entries or split-match surface; model output never supplies
the target. No AI result bypasses the existing editor, preview, or review
controls.

Full-cash-flow insights also render a deterministic Money consequence map. It
uses only already-loaded summary/month facts: recorded surplus, actual spending
against the plan, a same-season month only when it is already present in the
loaded range, wallet proof gaps, and an explicitly labelled one-repeat
scenario. Summary and Month can route proof gaps to Imports. Entries and Splits
state when their narrower view cannot assess wallet confidence or household
cash flow.

## Money Privacy Display Preference

Money privacy is a display layer, not a financial-state change. A new browser
starts with every displayed monetary value masked on Summary, Month, Entries,
and Splits, including individual ledger and split-activity rows. The shared
top-toolbar eye control reveals or hides those figures everywhere at once and
persists only the browser-local preference. Imports use the same display rule:
the raw CSV source field and editable preview amount cells are screened while
hidden, without blocking paste, drag-and-drop, parsing, mapping, or commit. On mobile, the same control floats
above the bottom navigation, and stacks above the Entries or Splits add button
when one is present. Financial Insight stays hidden while totals are masked
because its prose can expose the same figures.

## Route Work Status Boundary

The shell knows whether the active route is ready and whether any protected
workflow is open, from the owners themselves, never from DOM queries, network
idle or an old page left on screen. `route-work-status.js` is pure: the route
key (`buildRouteIdentity` → `buildRouteWorkKey`), an owner registry, a
required-fetch counter and `deriveRouteWork`, which returns
`{ routeKey, ready, busy, requiredCount, usable, reason }`.
`use-route-work-status.js` holds the React bindings. App wraps the rendered
route in `RouteWorkProvider` with the active key, or `null` while a previous
page is still shown. Route panels call `useRouteWorkReport({ ready, busy })`;
only Entries reports real readiness because it owns its page DTO, and App
checks its own route data against the active request. Delegated editors and
list rows call `useRouteWorkBusy(busy)`, which registers nothing until they
are busy. Required refreshes the shell awaits outside its loading counter run
inside `withRequiredWork`. Optional prefetch, banner and AI work is never
counted. Owners keep their drafts; the registry holds only booleans.

## Shell Presentation Boundary

App owns shell state, queries, URL normalization and every handler. Its
chrome is presentation in four modules, all in the entry chunk:
`app-shell-status.jsx` (environment badge, loading and error screens),
`app-shell-navigation.jsx` (route tabs and the "More pages" menu),
`app-shell-period-pickers.jsx` (`PeriodMonthPicker` for the single month
and both range ends) and `login-registration-dialog.jsx`. They take
explicit props, never App state wholesale.

## Route Warmup Boundary

Optional work (route code, speculative page data, AI wording) starts only
when the active route is usable, and it never delays a navigation or a
required read.

- `route-warmup-policy.js` (pure) decides whether one candidate may start and
  which exact destinations are worth considering. Desktop and mobile have
  separate limits; hybrid or unknown devices get the mobile policy.
- `route-warmup-scheduler.js` owns the quiet period, the per-visit budgets
  and the one-at-a-time queue, with an injected clock. `use-route-warmup.js`
  feeds it browser signals: visibility, connection, interaction, editable
  focus and route work.
- `route-modules.js` is the only route-code loader, shared by navigation and
  warmup, so a warmed chunk is the one the route uses.
- `query-leases.js` keeps the two fetch paths. Required reads take a lease
  before touching the cache. Speculative reads are cancelled at their
  deadline unless a required reader joins them (promotion). It also times
  required network fetches: mobile data warmup needs a recent reading of
  500 ms or less.
- `route-warmup-data.js` builds speculative requests with the same key
  builders as the required readers. `route-warmup-admissions.js` lists the
  data families measured cheap enough for mobile, currently only the Entries
  page (gzip bytes and handler p95 on the 10k fixture). Mobile preloads data
  only on a 4g connection without data saver; a browser that reports no
  connection (iPhone Safari) stays code-only.
- Financial Insight asks for AI wording only while the route is usable
  (`canRequestWording`), and keeps a response only if it is still current.
