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

A check-in's facts count what the figures beside it count. Summary builds
them from its page DTO, which the Worker already filtered to the view and
scope. The Month DTO's `entries` holds every household entry (plan linking
needs them all), so `month-insight-facts.js` first keeps the entries the
`Actual spend` card counts with the Worker's own `filterEntriesForView` and
`effectiveScopeForView` (`src/domain/person-view-scope.ts`, over
`person-entry-amount.ts`): every entry for the household, and a person's own
entries in the scope at their own amounts. A scope change therefore changes
the facts and the wording cache key. The Splits check-in counts the active
group's records at their group totals, the same figure as the Splits
`Total spend`, in every view, and so always uses group-level wording rather
than addressing the viewer ("<person>, you spent") as if it were their own.

## Scope Controls

A person view's figures follow the route's `scope`. Each layout has one
scope control:

- Desktop and tablet (wider than the phone layout in `use-viewport.js`):
  Month shows the scope pills in its header. Summary shows
  `SummaryScopeSwitch`: a compact one-click `Direct` / `Shared` / `Both`
  switch (`messages.summary.scopeSwitchLabel`) in the empty space under the
  `Summary` title, with `aria-pressed` on the active option and what each
  scope counts (`messages.views.scopeHint`) as that option's `title`
  tooltip; there is no visible explanation row. It must not change the
  header: `.summary-scope-switch` takes its own row in the title column with
  `contain: inline-size` (no content width) and a -12px margin that cancels
  the title row's 12px flex gap, so the title column is exactly as wide as
  without it, and the row fits beside the two rows of metric cards, so the
  header is exactly as tall. Where the header stacks (960 px and below) the
  switch joins the title row instead, again adding no height.
  `tests/e2e/summary-workflow.spec.js` measures the header, the cards and the
  check-in with and without the switch at 1,440 and 1,920 px.
- Phone (`useIsMobileLayout()`): Summary, Month and Entries show the floating
  View and scope bar from `App.jsx` (`stickyScopeConfig`), and Summary does
  not render its switch at all. The bar's dialog holds the view pills and
  the scope pills; on Summary the scope section also carries the line saying
  what the scope counts. Month and Entries add month arrows beside the bar;
  Summary has no arrows because its range moves from the header.

The bar's label is two lines: the person and a short scope name
(`messages.views.scopeShortLabel`: `Direct`, `Shared`, `Direct + Shared`),
then `View and scope`. The label is wrapping text whose scope part
(`· Direct + Shared`) is `nowrap`, so a long name wraps before the scope
instead of either being cut short; there is no ellipsis. The trigger is at
least 46 px tall, and on Month and Summary the floating money toggle sits
above it. The household view has one Combined scope: the bar shows only
`Household` and `View`, the dialog has no scope section, and desktop Summary
shows no switch.

The active scope on Summary is the scope of the request the figures on
screen answer: `buildSummaryPageView` reads it from the Summary owner's
request key and sets `selectedScope` and `scopes` on the page view (the same
names as the Month DTO), so neither the switch nor the bar run ahead of the
figures while the next scope loads. An option sets the route's `scope`, and
the route reloads Summary; no extra request and no DTO field. The scope rules are
imported by `summary-query.js` in the entry chunk, so the Summary and Month
route chunks share them without a new first-screen file.

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

## Split Currency Display Contract

Every stored amount is in hundredths of its own currency whatever that
currency's minor unit: a ¥12,000 travel expense is `amountMinor` 1,200,000.
`formatCurrencyMinor(amountMinor, currency)` in `src/domain/split-currency.ts`
is the one formatting boundary for a split currency, shared by the Worker
(the group pill `summaryText`) and the client. It uses the currency's own
fraction digits through `Intl.NumberFormat` (JPY `JP¥12,000`, SGD `$12,000.00`,
KWD `KWD 1,234.500`), widens to two digits only when the stored hundredths are
not whole units, and normalizes a malformed code to SGD like
`normalizeSplitCurrency`. No currency is special-cased.

On the client, `moneyWithCurrency(valueMinor, currency)` wraps it with money
privacy, and `money` stays the SGD home-currency formatter. A Splits surface
that shows a group or record amount passes that currency: the group pill, the
totals strip, the expense dialog's share preview, activity cards, history
rows, archived settle-up summaries, same-currency match deltas, checkpoints,
the Splits financial insight facts and the category donut (`SpendingMixChart`
takes an optional `currency`; `selectSplitDonutChart` picks the active group
currency's chart from `donutChart` / `donutChartsByCurrency`). `moneyStep(currency)` names the
smallest stored step for the odd-cent choice and is not masked, because it is
a unit label rather than a balance. A home-currency (SGD) ledger amount shown
next to a foreign split amount keeps its own SGD formatting. An entry's
`linkedSplitShares` are already in the entry's home currency (each person's
home share of a travel split, computed in `app-repository-entries.ts` with
`homeCurrencyShareAmounts`), so Entries and Month format them with `money`.

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

Render crashes are contained by `screen-error-boundary.jsx`. One boundary
wraps only the active page, so navigation keeps working: it shows an in-app
fallback with "Try again" (reloads the page data through
`retryActivePageLoad`, then redraws) and "Reload app". It clears itself when
a navigation starts and again when the requested page settles, because the
previous page stays on screen while the next one loads. A second boundary in
`main.jsx` wraps the whole app and can only offer a reload. A page whose code
failed to download also gets only "Reload app", because `React.lazy` keeps a
failed load failed until the page reloads.

## Shared States

`ui-states.jsx` is the one presentation for "nothing here", "this failed"
and "this screen failed"; callers pass copy from `copy/en-SG.js` and own
every retry handler.

- `EmptyState` renders an empty section as one muted line, or as a titled
  block with actions (the Entries wallet-view mismatch). Empty sections
  say what is missing instead of showing a bare dash.
- `InlineError` renders a failure inside a section as `role="alert"`, with
  an optional retry button; forms, dialogs and the mobile sheet use it.
- `ErrorPanel` is the screen-level failure. `ShellErrorScreen` (shell,
  reference data and first page load) and the screen error boundary both
  render it, so each is an alert with the same layout and a primary
  `dialog-primary` retry. The detail line is plain language
  (`common.loadFailedDetail`); the technical reason sits in the smaller
  issue line below it.

A page load that fails after the person navigated shows the page
`ErrorPanel` inside the shell, and hides the previous page. Otherwise the
previous page's figures would stay on screen under the new tab or period.

- Navigation and the period picker stay usable.
- "Try loading again" runs `retryActivePageLoad`, and the panel stays up
  (showing "Working...") until the retry settles.
- The previous page is hidden (`display: none` on `.route-page-body`), not
  unmounted, so a draft on it survives the failure and the retry.

Entries can learn that a month failed when the shell does not. Another
tab's save during a month switch clears the Entries cache twice, which
cancels the shell's own load of the page, so the shell stays silent. The
Entries owner then holds a `loadError`, and the panel shows the same page
`ErrorPanel` in place of its totals, insight, filters and rows. It never
shows the previous month's rows or "No entries match this view." Its "Try
loading again" runs the shell's `retryActivePageLoad` (the `onRetryPageLoad`
prop), so the shell and the list recover together. Open drafts and sheets
stay mounted. The split follows the rest of the app: no page for this
request yet means the error panel, while this request's own rows on screen
mean the refresh notice.

Dialogs and sheets that write keep their draft until the write succeeds.
The Month "Match planned item" dialog (desktop) and sheet (mobile) show
"Saving...", take one submit (a ref guards double clicks), and check the
response. Escape, Cancel and the close button are ignored while the save
is in flight. A failure keeps the dialog or sheet open with its draft and an
`InlineError`; only a success closes it and refreshes the month.
The other Month writes follow the same rule: plan and income row deletes
(the `DeleteRowButton` confirmation shows "Working..." and keeps the row
with the error), the row note and month note dialogs (the table and note
card change only after the save succeeds), and duplicate, reset and delete
month (a failure keeps the Actions popover or confirmation dialog open).
The reset and delete confirmation dialogs render beside the Actions popover,
not inside it, because closing the popover unmounts its content.

## Mobile Sheet

`entry-mobile-sheet.jsx` (`EntryMobileSheet`) is the bottom sheet for the
Month plan sheets and the Entries add and edit sheets. It behaves like the
modal desktop dialogs:

- Focus moves into the sheet on open. The sheet itself takes focus, not a
  field, so opening it does not raise the phone keyboard.
- Focus stays inside the sheet while it is open, including when something
  moves it outside directly.
- It looks and sits the same wherever it opens: a fixed bottom sheet over a
  dimmed backdrop. Its styles in `public/styles.css` are therefore not in
  the 760px phone block but in their own unconditional section, scoped to
  the sheet and its backdrop (which render only in a sheet layout). Month
  also opens it on a portrait tablet, where the page itself keeps its
  desktop layout; before this the sheet rendered at the bottom of the
  scroll-locked page there, out of reach. Rules that restyle the page while
  a sheet is open (`body:has(> .entry-mobile-sheet) ...`) stay in the
  phone block (see "Page State Rules").
- The rest of the page is hidden from screen readers (`aria-hidden`), and
  the backdrop covers the viewport in every layout, so a tap outside the
  sheet lands on the backdrop instead of the page. A touch drag or wheel over
  the backdrop does not scroll the page, and neither do the scroll keys.
- Escape or a backdrop tap closes the sheet, and focus returns to the
  control that opened it.
- Escape is a cancel, as in the desktop dialogs, so the draft is discarded.
- While `isSubmitting` (a save or delete in flight), Escape and backdrop
  taps are ignored, so the pending result and the draft are kept.
- Nested Radix layers (a category editor, the mobile select) close first on
  Escape, leaving the sheet open.
- A portalled dialog still bubbles React events through the component tree
  into the form or row that opened it. `CategoryEditDialog` therefore
  stops `submit`, `click` and `keydown` at its overlay and content, so
  saving a category from a sheet, the desktop composer or a list row
  saves only the category. It leaves `pointerdown` alone, because Radix
  uses it for outside-press dismissal. Any new dialog that can open inside
  a form needs the same guard.
- It is a Radix Dialog with `modal={false}` plus the modal pieces added
  back: a trapped, looping `FocusScope`, `hideOthers` from `aria-hidden`,
  `RemoveScroll` without its scrollbar styles, `overflow: hidden` on
  `<html>`, and a plain backdrop. Radix's own modal mode sets
  `pointer-events: none` and a scroll-lock custom property on `<body>`.
  Both inherit, so on a 2,000-row month every row recomputed its style on
  open and again on close. None of the pieces used here changes an
  inherited style (see "Mobile sheet: a lighter modal" in
  `docs/audits/macro-loading-baseline.md`). Keep it that way: a new modal
  behaviour for the sheet must not restyle `<body>` or the app root.
- The opener is found by `sheet-focus-return.js`, not from
  `document.activeElement` alone: iPhone and iPad Safari (WebKit) do not
  focus a tapped or clicked button, so after a tap `activeElement` is
  `<body>`. The module watches trusted clicks in the capture phase and
  remembers the focusable control each one landed on (a key press clears
  it, because keyboard focus is reliable). The sheet takes that control as
  its opener during its first render, else the focused element, which is
  what Chromium gave before. Script clicks do not count, so the Entries
  floating add button, which forwards its tap to a hidden trigger, is the
  opener rather than the trigger.
- When the opener is no longer on the page (or the sheet opened from a
  link, with no opener), and nothing else has taken focus, closing moves
  focus to the `<main>` landmark (given `tabindex="-1"`) instead of
  `<body>`, so a screen reader carries on from the page content.
- `npm run test:e2e:webkit` runs the `@webkit`-tagged sheet focus tests in
  WebKit with an iPhone profile (`playwright.webkit.config.js`); it is not
  part of the default suite. The same tests run in Chromium there.

## Page State Rules

Some CSS restyles the rest of the page while something is open: the tab
strip, the sticky View and scope bar, the floating add and totals buttons
and the floating Splits group row give way to the mobile sheet, a dialog or
an inline editor, and the Splits page has its own phone background. These
rules must not use a `:has()` that searches all descendants
(`body:has(.x)`). Chromium then walks the whole page each time an element
such a rule styles is restyled; on the 2,000-row month that was about 25 ms
of style work per sheet open or close at CPU 4x (see "Mobile sheet: page
rules" in `docs/audits/macro-loading-baseline.md`).

- Portalled layers are direct children of `<body>`: Radix portals each
  direct child of `<Dialog.Portal>` there without a wrapper, including the
  sheet's backdrop and content. Their rules use `body:has(> .entry-mobile-sheet)`
  and `body:has(> .note-dialog-overlay)`, which check only `<body>`'s
  children. A dialog that portals into a container, or wraps its overlay,
  would not be seen.
- Elements inside the page hold a flag on `<body>` through
  `page-flags.js`: `ref={pageFlagRef(PAGE_FLAG.entryInlineEditor, inlineEditorRef)}`
  on the Entries inline editor, `splitInlineEditor` on the Splits inline
  card and `splitsPanel` on the Splits panel. The ref sets `data-<flag>`
  while the element is attached (React 19 ref cleanup), so the flag changes
  in the same commit as the element, and CSS reads
  `body[data-entry-inline-editor] ...`. The callback is cached per flag and
  element ref, so rows need no extra hook. `PAGE_FLAG` lists every flag.
- `tests/page-flags.test.mjs` fails on a descendant `:has()` in any
  stylesheet, on a body flag the CSS reads that the client does not set (or
  the other way round), and on a dialog overlay that is not a direct child
  of `<Dialog.Portal>`. `tests/e2e/page-chrome-while-editing.spec.js` pins
  the visible behaviour.

## Reference Data Owner

`reference-data-owner.js` owns accounts and categories: the query cache is
authoritative, and the owner keeps the last good DTO on screen while a
refresh runs. Every load and refresh takes a generation, so a superseded
request (for example one cancelled by a cross-tab refresh) never overwrites
newer data or shows the error screen. `use-reference-data.js` is its React
binding; App calls `refresh()` from mutation plans and
`refreshOrShowError(label)` from cross-tab refresh and the retry button.

## Page, Summary And Shell Owners

Summary (`summary-owner.js`), generic route pages (`route-data-owner.js`)
and the app shell (`app-shell-owner.js`) follow the reference-data pattern:
each owner keeps the last applied snapshot (with its request key) and a
generation, so a superseded load or refresh never overwrites newer data,
clears it or raises an error screen. A route-data refresh with
`apply: false` (Settings refreshed while another route is open) takes no
generation. Hooks (`use-summary-data.js`, `use-route-data.js`,
`use-app-shell-state.js`) bind them; App keeps loading status, required
work, the page error screen and the mutation refresh plans.

The Entries panel's page DTO has its own owner (`entries-data-owner.js`,
bound inside `useEntriesPageData`): loads and refreshes take a generation,
and a refresh whose month and view are no longer active returns before it
clears any cache or fetches, so an edit's late refresh can neither
overwrite nor stall the month the person moved to. The owner also tracks
which request the page on screen belongs to (`seed(page, params)` and
applied loads set it). The latest load or refresh can fail while that page
is still another month's or view's. The owner then sets `loadError`, keeps
the page for open drafts, and does not rethrow, so no refresh notice
appears. A load that fails over this request's own page is rethrown, and
the panel reports it through `runBackgroundRefresh`. Aborts and cancels are
never errors.

The panel reads the linked entry (`editing_entry`) straight from the URL and
keeps only whether it already acted on the param's current value
(`linked-entry-request.js`, synced while rendering, not in an effect). The
open effect handles each value once, so an editor closed by a save, a
transfer link or a close is never reopened while the param clear is still
pending.

Refreshes after a save go through `runBackgroundRefresh` from
`use-refresh-notice.js` (owner: `refresh-notice.js`). App uses it for every
background shell, reference-data, route-page and Summary refresh in its
refresh plans, and passes it to the Month, Splits and Entries panels. A
failure resolves to `null`, keeps the saved data on screen and shows the
inline refresh notice with "Refresh now" (it reruns the failed refresh) and
"Dismiss". Aborted and cancelled requests, a shell request overtaken by a
newer one, and failures that land after a route change are silent; a route
change clears the notice. When several refreshes fail together (a page and
its shell), "Refresh now" reruns each of them.

`use-app-sync-subscription.js` owns the cross-tab BroadcastChannel and
storage listeners; its parse and dispatch helpers are pure.

## Layout Breakpoint Boundary

`use-viewport.js` is the only client module that calls `matchMedia` for
layout; nothing else reads `innerWidth` or repeats a query string. It has
two queries:

- `MOBILE_LAYOUT_QUERY`, `(max-width: 760px)`, is the phone layout and
  matches the `@media (max-width: 760px)` blocks in `public/styles.css` (a
  unit test checks the stylesheet). Entries, Splits, the responsive pickers,
  the spending chart, the last-period hint, inline editor scrolling, the
  Splits group pills and focus visibility use it.
- `MONTH_SHEET_LAYOUT_QUERY` adds `(max-width: 1024px) and (orientation:
  portrait)`. Month plan and income rows open the mobile sheet on a portrait
  tablet too, while the CSS and every other page keep the desktop layout.
  This difference is deliberate; do not merge the two queries. The CSS has
  no copy of this query: the sheet's own styles apply whenever it renders
  (see "Mobile Sheet").

Render code uses `useIsMobileLayout()` / `useIsMonthSheetLayout()`, built on
`useSyncExternalStore` with one shared `MediaQueryList` per query, so the
value is right on first render and a resize or rotation switches the layout
without a reload. With no window (server render, unit tests) they report
the desktop layout. Event handlers and effects call `isMobileLayout()` /
`isMonthSheetLayout()`, which ask `matchMedia` at that moment. The Month
open handlers must keep this fresh read: the row-open spy in
`tests/e2e/month-page.spec.js` counts it. Focus visibility also treats a
visual viewport of 760px or less (pinch zoom) as mobile.

Between the two layouts there is a CSS-only mid-width range, 761 to
1,099 px (portrait and landscape tablets, small laptops), where the desktop
layout must still fit the screen. It needs no JavaScript, so it has no
query in `use-viewport.js`. Its blocks are
`@media (min-width: 761px) and (max-width: 1099px)` (plus one to 960 px)
and never touch the phone or wide-desktop rules. The header block runs on
to 1,279 px (see below). The header rules are in
`public/styles.css`, because every page shows the header. The Month rules
are in `src/client/month-mid-width.css`, which `month-panel.jsx` imports,
so they ship with the lazy Month route and stay out of the first-screen
CSS budget (`npm run check:bundle`). That file loads after `styles.css`,
so its rules win over base rules of the same specificity.

- The header's period controls wrap below the page tabs as one group.
  Before, they widened the page up to 960 px and slid under the tabs from
  961 px, covering Settings and FAQ.
  The same header block runs to 1,279 px (`max-width: 1279px`): from
  1,100 to about 1,195 px the tabs and period controls do not fit one row,
  and the tab strip ran up to 71 px under the "‹" button. There the period
  controls now wrap below the tabs; where the row fits (about 1,200 px and
  up) the wrap does not happen and the header is laid out as before.
  `tests/e2e/header-tab-fit.spec.js` checks every page at 1,120 and
  1,200 px with `elementFromPoint` at each tab's edges and centre.
- The Month panel and plan sections may shrink below their tables'
  min-content width (a grid item's automatic minimum is its min-content,
  which is the whole table), so `.month-table-wrap` scrolls inside the page
  and the page never scrolls sideways. Tighter cell spacing and two-line
  notes let the tables fit whole from about 900 px; below that the Account
  and Note columns scroll inside the table, while Category, Item and the
  money columns stay on screen. Inline Save and Cancel stick to the visible
  edge of the table. On a portrait tablet the row sheet shows every field.

`tests/e2e/month-mid-width-layout.spec.js` checks this at 820×1180 (full
mobile emulation) and 1024×768. With mobile emulation, as on a real tablet,
a too-wide page grows the layout viewport, which moves controls and the
fixed sheet off screen, so keep new Month and header content shrinkable.

Route warmup reuses `MOBILE_LAYOUT_QUERY` for its narrow-viewport signal,
but its mode also needs `(pointer: coarse)` and stays in
`selectWarmupMode`, because warmup is about the device, not the layout.
`tests/e2e/viewport-breakpoints.spec.js` resizes one page across both
widths.

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

## In-App Guide Boundary

The FAQ route renders two Markdown guides as tabs: `docs/user-guide.md`
(User guide) and `docs/developer-guide.md` (For developers).

- `guide-markdown.js` is a pure parser for the small Markdown subset the
  guides use (parts, sections, subsections, lists, tips, code, images, inline
  bold, code and links). It gives every heading a stable id and classifies
  links as in-guide anchors, cross-tab anchors (`?faq=developers#id`), app
  routes, public files or outside sites. Tests reuse it to check that every
  link, anchor and image resolves.
- `faq-panel.jsx` owns the tab state in the URL (`faq=developers`; the user
  guide is the default and has no parameter) and loads each guide through its
  own dynamic import, so the developer guide downloads only when its tab
  opens and neither guide reaches the first-screen bundle.
  `sanitizeTabParams` drops `faq` on every other route.
- FAQ styles live in `faq-panel.css`, loaded with the lazy route. Screenshot
  families (`/faq/guide/desktop/`, `/phone/`, `/iphone/`) get a fixed aspect
  ratio so lazy images never shift a deep-linked section.
- The route stays static: it reports ready immediately and never busy.

