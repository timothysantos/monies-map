# Architecture Notes

This document is a living architecture reference for Monie's Map.
It should be updated as the app progresses so the documented product model,
technical boundaries, and implementation direction stay aligned with reality.

## Product shape

The app is a household planning and reporting system, not only a transaction
ledger and not only a budget tracker.

That distinction matters because the system needs to answer questions like:

- what did we actually spend this month?
- what did we intend to spend this month?
- which expenses were mine, hers, or shared?
- which account or card carried the charge?
- which months were outliers and why?
- how much of the planned savings really happened?
- which explanations are supported by the data and which are not?

## Documentation rule

- Keep this file updated alongside meaningful architecture or product changes.
- Keep [`DOMAIN.md`](../DOMAIN.md) updated alongside domain-model and canonical
  naming changes.
- Keep [`AGENTS.md`](../AGENTS.md) aligned
  with implementation conventions and coding expectations.
- Keep [`docs/faq.md`](faq.md)
  updated as a living user-facing reference for setup, workflow, and feature scope.

## Primary workflows

### 1. Import

- user uploads a CSV export from a bank, card, or mixed-account source, a
  supported PDF statement, or a supported current-transaction workbook export
- system uses an institution-specific mapping profile when available
- PDF statement import is deterministic: the browser extracts text, statement
  parsers normalize rows into the same import shape as CSV, and unsupported
  layouts fail before preview instead of using generative inference
- statement import code is split by source family under `src/lib/statement-import/`:
  UOB, Citibank, OCBC, current-transaction XLS, and shared normalization helpers
- current-transaction imports are deterministic working-ledger imports: for
  example, UOB One `.xls` history exports, Citibank credit-card activity `.csv`
  exports, and OCBC card or 360 account activity `.csv` exports are parsed locally into
  reviewable rows but do not create statement checkpoints. Citibank activity CSV
  parsing is intentionally gated by the selected Citibank credit-card account,
  then `-rewards.csv` and `-miles.csv` filename hints set the parsed account so
  one Citi card's activity cannot silently import into another selected Citi card
  because the files are headerless; OCBC activity parsing prefers an OCBC
  account context or filename hint, but it can also recognize OCBC transaction
  history CSVs from their account-details and transaction-history headers.
- PDF statement parsers are institution-specific. UOB card and savings
  statements use the raw extracted PDF text so the derived layout variants do
  not duplicate printed transaction blocks; Citibank
  Rewards and Citi Miles card statements use browser-extracted layout text
  because their transaction rows are compact, preserve negative credit balances,
  and reconcile against card-section grand totals before preview; OCBC 365 card
  statements and OCBC 360 account statements use spaced layout text and running
  balances where available to determine row direction before preview.
- review step allows whole-file or per-row account attribution; when multiple
  accounts share a display name, import mapping and overlap checks use the
  selected account id so owner-specific accounts do not collide
- direct import-row ownership follows the mapped account owner when the account
  is personally owned; the composer-level default owner is a fallback for rows
  without a personally owned account mapping
- supported PDF statements can also produce editable statement checkpoints; the
  preview projects the post-import ledger balance against those checkpoints
  before commit, then saves them during commit for account reconciliation
- multi-card PDF statements produce one row set and one checkpoint per detected
  card account, so preview can require mapping each detected card to a ledger
  account before commit
- statement account mapping can create a new tracked account directly from a
  detected PDF statement account. The import flow reuses the settings account
  form, prefills known statement facts, derives the opening balance from the
  printed ending balance minus parsed statement movement, and then remaps the
  preview rows and checkpoint draft to the created account.
- UOB and Citibank card PDF parsers detect card sections from statement
  structure first, while known product aliases only polish the displayed account
  names
- UOB card PDF parsing treats `CR` on card balance lines as a signed credit
  balance and accepts zero-dollar reward adjustment rows, so section
  reconciliation follows the bank's printed card convention
- transactions are normalized to a single ledger shape
- every imported row is attached to an import batch for audit and rollback
- CSV commits pre-resolve accounts, categories, and people before writing, then
  write D1 statements in chunks so larger production imports do not leave
  completed-looking partial batches
- `category_match_rules` are household-scoped reference data used during import
  preview. The backend matches merchant text such as `TADA`, `SHOPEE`,
  `SINGLIFE`, `KEPPEL ELECTRIC`, `INCOMEINSURANCE`, `INLAND REVENUE`, `IRAS`,
  `SP DIGITAL`, `PRUDENTIAL`, `BTG REWARDS`, `DIN TAI FUNG`, `WATSONS`,
  `EDITOR'S MARKET`, `NASI LEMAK`, `YOUTRIP`, `PLAYSTATION NETWORK`, `GIRO`
  plus `HDB`, or conversion-fee patterns to the configured category, and a
  matching rule wins over the parser's first category guess. The parser-side inference keeps a
  similar fallback for local PDF/CSV parsing, but database rules are the
  editable source of truth in Settings.
- repeated manual category corrections are stored as pending
  `category_match_rule_suggestions` instead of silently creating rules. Settings
  shows a badge when suggestions exist, deep-links to Category matching, and lets
  the user add, edit, or ignore each suggestion.
- duplicate prevention should model one economic event flowing through multiple
  evidence sources, not only row-vs-row import collisions
- the app should treat this as one `entry reconciliation` system. Manual
  entries, mid-cycle CSV/XLS activity rows, and PDF statement rows all enter
  the same matching pipeline; the difference is source authority, not whether a
  separate duplicate feature runs
- the matching pipeline has two ordered lanes. First, `exact duplicate
  suppression` auto-skips identical incoming bank rows before any source guard
  runs. Second, `promotion and reconciliation` evaluates non-identical rows with
  status isolation and similarity heuristics
- a manual provisional row, a mid-cycle CSV/XLS activity row, and a final PDF
  statement row can all describe the same underlying card event
- when a later source matches an existing provisional row closely enough, the
  app should promote the existing ledger entry in place and attach the newer
  source trace instead of creating a second transaction
- promotion must preserve user-maintained fields such as category, note,
  ownership, split percentages, and links into the split workspace
- promotion updates only `post_date`; it must not rewrite the ledger row's
  `transaction_date`, because planning, splits, and month summaries stay pinned
  to the event date
- matching should isolate one date lane before scoring: event-to-event when
  both rows have intent metadata, otherwise posted-to-posted
- exact duplicate suppression is stricter than promotion scoring. It requires
  the same amount, the same mapped account, and either the same normalized
  import hash or a perfect normalized description match with zero date distance
- matching should score account, signed amount, lane-specific date proximity,
  normalized merchant tokens, and source hints such as `txn date` notes from
  card exports rather than relying only on raw description equality
- merchant aliases such as `CS` -> `Cold Storage` should feed reconciliation
  matching as an evidence layer, separate from the ledger entry's display
  description

### Matching Philosophy

- entry reconciliation should model one economic event across multiple sources,
  but it should not collapse every similar small recurring charge into the same
  ledger event
- identical recurring small-value transactions such as transit fares, coffee,
  or canteen purchases should be treated as unique events by default unless
  they happen close together in time
- this is the `Velocity Rule`: the candidate matching window scales with
  `amount_minor`
- low-value rows with `abs(amount_minor) < 500` require `day_distance <= 2`
  before they can be suggested as duplicate or promotion candidates
- higher-value rows keep a wider `day_distance <= 7` search window so delayed
  bank posting can still reconcile to the same ledger entry
- manual promotion boosts still matter inside that window. Exact-date matches
  supported by source hints remain the strongest promotion candidates because
  their `day_distance` is `0`
- duplicate detection should compare like-for-like dates. When both rows have
  an original transaction date, compare original-to-original; otherwise compare
  posted-to-posted, so low-value commuter rows do not slip through on a false
  original-to-posted 2-day overlap
- reconciliation-only source guards remain explicit: `statement_certified`
  ledger rows are locked, and non-PDF mid-cycle imports cannot reconcile
  against existing `import provisional` rows. Those guards do not apply to the
  earlier exact-duplicate suppression lane.

### 2. Review

- app flags unknown merchants or categories
- app asks whether a transaction is direct, shared, or transfer-related
- shared transactions default to equal splits but support custom ratios such as
  `60/40`
- app allows notes for large or unusual items
- app supports edits after import without breaking import traceability

### 3. Reporting

- summary view shows month-by-month planned versus actual, savings targets,
  notes, and drill-downs
- monthly view shows income rows, planned items, budget buckets, notes, and linked entries
- entries view shows the raw rows for the selected month with filters and edit
  capability
- splits view shows named shared-expense groups, non-group shared expenses,
  settle-up records, and a dedicated matches queue without polluting CSV import
  review
- when Cloudflare Access provides an authenticated email, the app can link that
  login to one household person. Splits then opens on that person's view by
  default, while Household remains a read-only overview without person-specific
  "you owe" copy or inline split editing.
- person views support `Direct ownership`, `Shared`, and `Direct + Shared`
- household monthly view supports `Combined` and `Shared`
- account filter shows source account and institution

### 4. Analysis

- the app should support AI-friendly exports for summary and monthly views
- analysis must consider both ledger data and user-authored notes
- future in-app AI can support or challenge the user’s explanation for unusual
  months instead of only summarizing totals

### 5. Demo state

- the current prototype now stores its demo settings in D1
- the settings screen groups demo metadata such as current mode and reseed
  timestamp under a collapsible demo-state section
- the settings screen can reseed the believable default demo and reload the
  current bootstrap from D1
- demo-state controls are only rendered for `local` and `demo` environments;
  production hides the section, and the reseed/empty-state API routes return
  `403` if called directly
- reload is a typed-confirmation action because it refreshes the visible app
  state from the current database; it does not reseed, delete, or import data
- demo mode is saved after reseed or empty-state reset work succeeds, so failed
  backend resets do not leave the UI claiming a different mode than the data
- empty-state reset actions now verify the POST response and reload the bootstrap
  before the confirmation closes, so failed resets are visible instead of leaving
  stale account cards on screen
- a fresh database defaults to empty-state mode; bootstrap only ensures the
  household, people, and default category catalog exist, so account balances,
  entries, imports, checkpoints, month plans, snapshots, and split records stay
  blank until the user creates or imports them
- household member names are editable in Settings and propagate through person
  views, split labels, and ownership UI
- empty-state mode seeds neutral default member names so blank-state behavior
  does not fall back to placeholder labels
- even the empty-state mode keeps the default category catalog available so a
  fresh import still starts from the intended baseline taxonomy
- this is the first persistence step before full repositories for category edits,
  month planning edits, and entries edits

## Domain model principles

- `imports` are first-class and must support targeted rollback of a bad batch
- `transactions` are normalized ledger entries
- `monthly plans` are first-class and sit above transaction analytics
- `planned items` represent intentional or recurring commitments
- `budget buckets` represent flexible spending envelopes
- planned-item actuals are resolved through explicit links to ledger entries,
  while budget-bucket actuals stay category-driven
- `transaction_splits` allocate shared expenses between people
- `split_groups`, `split_expenses`, and `split_settlements` model the
  Splitwise-style layer separately from imported ledger rows
- `login_identities` links a Cloudflare Access email to a household person so
  authentication remains separate from household member records. Users can
  unregister that link without deleting or renaming the person.
- the public `monies-map-demo` deployment intentionally runs without
  Cloudflare Access. In that mode there is no viewer email, so login identity
  linking is skipped and users choose household/person views manually.
- `transfers` are first-class linked entries, not fake income or expense rows
- split records can optionally link back to imported transactions later through
  `matches`, so CSV import stays focused on ledger cleanup while shared-expense
  review happens in the splits surface
- `notes` exist at summary and monthly levels, with room for entry-level notes
  later
- account balances are derived from imported ledger activity plus an explicit
  opening balance per account
- CSV-only balances need a reconciliation anchor, so opening balances are part
  of the account model rather than hidden UI math
- `account_balance_checkpoints` store statement-ending balances by account and
  statement month, with optional statement start/end dates for credit-card
  cycles; blank dates fall back to the selected calendar month-end, while filled
  start dates split the comparison into a pre-cycle baseline and in-cycle ledger
  movement
- credit-card checkpoints normalize bank-facing positive “amount owed” values
  into the app’s liability-negative ledger convention before comparison
- account health exposes reconciliation status, latest import freshness, and
  unresolved transfer counts so trust warnings stay close to balances
- import previews and recent import batches expose duplicate and same-account
  overlapping date-range signals so CSV trust is visible before and after
  commit; preview overlap DTOs include the committed transactions that sit
  inside the overlapping account/date range, and the review UI turns those
  signals into next-step guidance based on duplicate skip state and statement
  balance reconciliation
- imported transaction bank facts carry a certification status. Working exports
  such as CSV activity and current-transaction XLS rows start as `provisional`,
  while supported PDF statement rows are saved as `statement_certified`.
- manual entries created from Entries or Apple Pay quick-entry URLs also start
  as provisional ledger facts. Import preview compares future bank rows against
  those manual rows so duplicate CSV/XLS rows can be skipped, and supported PDF
  statements can certify the manual row in place instead of creating another
  transaction.
- Apple Shortcut ingestion is a separate write path from the quick-entry URL.
  The quick-entry URL still opens the composer only. A dedicated Worker route,
  `POST /api/shortcuts/entries/create`, creates the entry server-side and
  returns a deep link back into the created ledger row. The returned `openUrl`
  now points straight at `/entries` with the created row and month/account
  context already encoded in the query string, so shortcut opens do not need a
  second context-lookup redirect first. The app also serves a lightweight
  Entries-first shell on cold `/entries` loads, then hydrates the full dashboard
  bootstrap in the background. The shortcut endpoint is protected with a shared secret header, a
  timestamp freshness check, and a one-time nonce stored in
  `shortcut_request_nonces` for replay protection.
- the Entries UI exposes the certification state explicitly: manual rows show
  as `Manual provisional`, CSV/XLS working imports show as `Import
  provisional`, and supported PDF-certified rows show as `Statement certified`.
  This keeps daily planning usefulness separate from bank-statement proof.
- official PDF statement imports act like a bank-sync authority layer for the
  account and statement period. If a statement row matches an existing
  provisional mid-cycle or manual row, commit promotes that existing transaction
  in place: the bank-facing facts are updated from the statement and the row is
  marked statement-certified, while user-maintained fields such as category,
  note, ownership, splits, and links remain attached to the same transaction.
- mid-cycle current-activity imports should follow the same promotion rule one
  step earlier: if a CSV/XLS row matches a manual provisional row, commit should
  update that manual row in place to `import_provisional` instead of inserting a
  second ledger entry. This keeps later statement certification attached to the
  same row and preserves any split record the user already created from the
  manual entry.
- entry reconciliation now applies a status-based match isolation guard before
  scoring duplicate candidates. Existing `statement_certified` rows are locked
  out of future matching, and `import_provisional` rows are only eligible when
  the incoming source is an official PDF statement.
- to prevent cross-bank false positives on high-velocity recurring charges,
  mid-cycle imports only match pending manual entries. However, official PDF
  statement imports can match against mid-cycle provisional entries to elevate
  them to certified status.
- official PDF statement rows that already match statement-certified ledger rows
  are treated as already certified rather than as duplicate conflicts.
- reconciliation should prefer a source-authority ladder:
  manual provisional -> import provisional -> statement certified.
  Each stronger source should usually enrich the same entry unless the evidence
  clearly indicates a genuinely separate transaction.
- in accounting terms, the account-level control remains bank reconciliation.
  `Entry reconciliation` is the product term for the row-level transaction
  matching that keeps the ledger aligned with source evidence before and during
  that bank reconciliation process.
- saving matched PDF statement checkpoints also writes compact reconciliation
  certificates. A certificate records the account, statement period, row count,
  debit and credit totals, net movement, statement balance, projected ledger
  balance, imported row count, certified-existing row count, already-covered row
  count, and whether any exceptions remained.
- once a statement-certified transaction sits inside a saved statement period,
  its bank facts are locked: date, description, account, amount, entry type, and
  transfer direction require a replacement statement or explicit adjustment.
  User annotations such as category, note, ownership, and splits remain editable.
- import preview exposes an exception register so the user works blockers and
  review items instead of scanning every duplicate-looking row. Exceptions include
  unknown account, unknown category, statement mismatch, account identity proof,
  row review decisions, unresolved ledger matches, and prior import context.
- `reconciliation_exceptions` persist longer-lived balance trust issues outside
  a single import preview. Settings -> Balance trust rules can record open or
  resolved issues such as missing bank rows, extra ledger rows, duplicate
  suspicions, direction mismatches, wrong accounts, timing differences, manual
  reviews, and adjustments. Open exceptions are audit-visible blockers to fully
  trusting a balance; resolving one records an audit event but does not mutate
  ledger amounts by itself.

## Client state model

The frontend now needs an explicit split between server-backed state and local
UI state. The app has grown beyond a single bootstrap payload plus manual
refresh hooks, and the repeated-entry editing flows are now sensitive to broad
page resets.

### State classes

- `server state` is canonical API-backed data that can be refetched,
  invalidated, and shared across pages. Examples include bootstrap shell data,
  route-page payloads, entries-page payloads, month plan rows, summary totals,
  charts, imports preview state, and account health.
- `local UI state` is ephemeral interaction state owned by the current screen
  or component. Examples include open dialogs, add-another forms, inline edit
  drafts, selected tabs, scroll position, accordion state, sort state, and
  transient filter text.
- `optimistic state` is a temporary user-visible projection layered on top of
  server state for direct edits. It should only cover the fields the user
  actually changed, such as a new month-plan row or an updated ledger label.
- `pending derived state` covers values that depend on broader server
  recomputation. Examples include budget-bucket actuals, top-level totals,
  charts, summary cards, and cross-page aggregates after a mutation.

### Technology direction

- TanStack Query is the target server-state layer for the React client.
- React component state remains the default home for local UI state.
- Do not introduce Redux or Zustand as the first answer to server-backed refresh
  issues. They do not replace query invalidation, optimistic mutations,
  background reconciliation, or stale-result protection.
- A separate UI-state store may still be justified later for genuinely shared
  interaction state, but it should be additive to TanStack Query instead of a
  replacement for it.

### Query ownership rules

- Queries own fetched API payloads and derived loading/error state.
- Components should not copy query data into local state just to make it
  editable unless the copied structure is a true draft model.
- Local UI state must survive routine query refreshes. A refetch should not
  close forms, clear drafts, or collapse sections unless the user action or
  route change explicitly requires it.
- Mutations should invalidate the smallest practical set of related queries
  instead of manually clearing broad shell caches and reloading whole page
  payloads.

### Query key model

The app should converge on explicit query keys that mirror the server DTO
boundaries:

- `bootstrap`, keyed by view, month, summary range, and environment-sensitive
  shell parameters
- `route-page`, keyed by tab plus the query parameters that change that tab's
  payload
- `entries-page`, keyed by month, view, scope, filters, account, and open-row
  context when relevant
- smaller supporting queries, such as prior-month actual lookups or import
  previews, keyed by the smallest stable request shape

Query keys must be centralized in a small shared factory so Month, Entries,
Summary, Imports, and shell prefetching all invalidate the same keys
consistently.

### Mutation model

Every mutation should define four things up front:

- `what appears immediately`
- `what remains pending`
- `what invalidates in the background`
- `what local UI state must survive`

The default pattern for save-heavy screens is:

1. apply an optimistic row-level patch for fields the user directly edited
2. keep the surrounding form or sheet alive unless the user chose to close it
3. mark server-derived fields as pending
4. invalidate related queries in the background
5. reconcile to the newest server truth when refetch completes

Older background responses must never overwrite newer optimistic or
server-confirmed state.

### Screen-specific mutation expectations

#### Month

- Creating or editing a budget bucket, planned item, or income row should show
  the row immediately.
- The add/edit UI should stay open or reset into an `add another` draft instead
  of being cleared by a full route refresh.
- `actual`, month totals, and linked metrics may remain pending while server
  recomputation runs.
- Cross-page consumers such as Summary should refresh in the background without
  forcing a shell-wide loading state.

#### Entries

- Entry creates, edits, and deletes should update the visible row immediately.
- Entry-derived month actuals, charts, and summary totals may show a lightweight
  refreshing state until recomputation settles.
- Moving between Entries and Month during active recomputation must be safe.
  The latest successful server truth wins, and stale responses must be ignored
  or superseded.

#### Splits

- Creating, editing, or deleting a split expense or settlement should preserve
  the current group context and keep inline editors or dialogs alive until the
  mutation succeeds or fails.
- Split rows can appear immediately with row-level pending affordances for
  fields the user directly changed, but cross-page ownership interpretations,
  month actuals, and summary totals should remain server-confirmed.
- Match review, archive browsing, and open-group selection are local UI state
  and must not reset just because the Splits route payload revalidated.
- Moving from Splits to Entries or Month while shared totals are still
  reconciling must remain safe. The newest successful server truth wins, and
  older split-route refreshes must not clobber newer entry or month updates.

#### Summary

- Summary cards and charts should stay visible during background refreshes.
- Mutations elsewhere may invalidate Summary queries, but they should not blank
  the whole page or block continued editing on other screens.

#### Imports

- Bulk import stages remain explicit and can keep stronger loading affordances
  than row-level edits.
- Once an import commits, only the affected Month, Entries, Summary, account
  health, and reconciliation queries should invalidate.

#### Settings and lower-frequency screens

- Settings saves should still use targeted invalidation.
- Avoid shell-wide reloads when a narrower query refresh is enough.

### Loading language

The UI should distinguish between:

- `saving`: the user edit is being committed
- `updating`: server-derived values such as actuals or totals are reconciling
- `refreshing`: a query is revalidating in the background while stale data stays
  visible

The app should prefer precise pending indicators on the affected row, metric, or
chart over page-wide loading states for small edits.

### Splits invalidation matrix

Split mutations are more interconnected than ordinary page-local edits. The app
should treat the Splits route payload as the primary source of split workspace
truth, then invalidate Month, Entries, Summary, and bootstrap shell state only
when the split action changes how those screens interpret ledger ownership or
shared actuals.

#### Query ownership

- `route-page(/api/splits-page)` owns split groups, current activity,
  settlements, match review candidates, archive batches, and donut data.
- `route-page(/api/entries-page)` or `entries-page` owns ledger-row presentation
  such as linked split badges, entry filters, and per-month totals.
- `month-page` owns month actuals and scoped comparisons that can change when a
  split action reclassifies a ledger row as shared or changes linked split
  matching.
- `summary-page` owns higher-level spend and actual rollups that may shift after
  split-linked entry changes.
- `bootstrap` owns shared shell DTOs such as household balances, view shell
  labels, and fallback route data. It should refresh quietly after split
  mutations that materially change cross-page household totals.

#### Mutation classes

- `shell-coupled`: changes split workspace metadata that the shell itself owns.
  Example: creating a new split group.
- `split-only`: changes the split workspace without changing any ledger-row
  ownership or cross-page actuals. Example: creating, editing, or deleting a
  split expense or settlement row.
- `ledger-coupled`: changes split records and ledger interpretation together.
  Example: promoting an entry into Splits or linking an expense match that
  converts a direct imported row into a shared ledger row.

#### Invalidation rules by action

- `create split group`
  - optimistic: the new group pill and active selection
  - pending: none beyond the new group shell
  - invalidate: Splits route plus quiet bootstrap refresh so other surfaces get
    the new group metadata
  - preserve: current match-review state and any still-open add flow
- `create or edit split expense`
  - optimistic: the edited split row fields inside the current group
  - pending: group balances and donut totals inside Splits
  - invalidate: Splits route only for manual rows; linked expense edits also
    invalidate Entries, Month, Summary, and quiet bootstrap state because the
    ledger's shared split weights change with them
  - preserve: inline editor or dialog state until success, then group context
- `delete split expense`
  - optimistic: remove the split row locally
  - pending: group balances and activity ordering
  - invalidate: Splits route only for manual rows; linked rows also invalidate
    Entries so linked-split badges and deep links disappear in other views
  - preserve: current group, archive open state, and surrounding editor context
- `create or edit settlement`
  - optimistic: the settlement row and current-batch ordering
  - pending: group owed or owing balances plus archive batch rollups
  - invalidate: Splits route only
  - preserve: current archive or match review context
- `delete settlement`
  - optimistic: remove the settlement row locally
  - pending: group balances and batch-open or batch-closed status
  - invalidate: Splits route only
  - preserve: current group and archive view
- `link split expense match`
  - optimistic: mark the reviewed match as pending or resolved
  - pending: linked-entry badges, group balances, month actuals, and summary
    totals while the shared ledger interpretation settles
  - invalidate: Splits route, Entries, Month, and Summary
  - preserve: review-matches surface and dismissed-match state for unrelated
    rows
- `link split settlement match`
  - optimistic: mark the reviewed settlement match as resolved
  - pending: linked-entry navigation state inside Splits only
  - invalidate: Splits route only
  - preserve: review-matches surface and dismissed-match state for unrelated
    rows
- `promote entry to splits` or `edit linked entry from Splits`
  - optimistic: the entry's split-linked badge and the new split row shell
  - pending: ownership-weighted actuals, group balances, month totals, summary
    totals
  - invalidate: Splits route, Entries, Month, Summary, and quiet bootstrap sync
  - preserve: the current entry editor or split editor until the user finishes

#### Resulting implementation rules

- Splits should get the same targeted background refresh treatment as Month and
  Entries: refresh the current Splits route quietly instead of forcing a shell
  reload after each mutation.
- Cross-page invalidation should be explicit per mutation class instead of
  treating every split save as equivalent. In the current implementation,
  ordinary split row CRUD is splits-only, split group creation refreshes
  bootstrap metadata too, expense match-linking invalidates Entries, Month, and
  Summary caches, and settlement match-linking stays local to the Splits
  workspace.
- Split mutation sync now uses a targeted cross-tab app event instead of
  treating every remote refresh as a full bootstrap reload. BroadcastChannel is
  used when available with localStorage as a fallback; the payload carries the
  affected month plus the exact Entries, Month, Summary, or shell invalidation
  flags so other open windows can quietly refresh only the surfaces that are
  actually stale.
- Local editor state should reset only when the route context truly changes,
  such as switching view, switching the active split group intentionally, or
  closing the editor on success.
- PDF statement commit requires both balance reconciliation and account identity
  confidence. If the mapped account has no prior checkpoint history or ledger
  activity, the detected statement account name must match the mapped ledger
  account closely enough before the preview can be committed. This prevents a
  first statement on a zero-balance wrong account from passing only because the
  statement is internally consistent.
- completed official PDF statement imports are rollback-protected when they
  certify pre-existing ledger rows, or when a later statement certificate exists
  for the same account. First-statement imports that created their own rows, plus
  checkpoint-only statement imports, can be rolled back to correct a wrong
  account mapping only while they are still the newest statement for that
  account; pre-existing-row-certified or superseded corrections should come from
  a replacement statement import or an explicit manual adjustment, preserving
  audit continuity.
- replacement statement correction should compare account identity, period,
  row count, debit and credit totals, ending balance, and the saved
  reconciliation certificate before changing certified rows. Matching rows
  should keep user annotations; rows unique to the wrong statement should become
  explicit corrections, reversals, or adjustment exceptions rather than silent
  deletes.
- PDF statement previews also compare detected statement balances with the
  projected account ledger through each statement end date before commit.
  Skipped duplicate rows are excluded from the pending import set and are
  counted through the already committed ledger instead, so restoring a skipped
  row immediately refreshes only that row's account checkpoint.
- When a statement preview mismatch is exactly resolved by including unresolved
  near-match rows for that same account, the preview treats those rows as
  statement-confirmed import rows, clears their duplicate warning, and
  recalculates the account checkpoint before returning the preview DTO.
- Statement-certified skipped rows keep their matched-ledger comparison payload
  for the preview UI even after duplicate warnings are cleared, so mismatch
  investigation can still open the side-by-side popover without reclassifying
  the row as a duplicate candidate.
- mismatched checkpoints can compare an uploaded statement against the already
  committed ledger for that checkpoint period without treating the statement as
  a new import; if the saved checkpoint has no explicit period, the comparison
  uses the uploaded statement period before falling back to the calendar month
- statement comparison near matches include same-amount rows with opposite
  direction so manual income-versus-expense mistakes explain checkpoint deltas
  without looking like wholly missing transactions
- direction mismatches can be fixed in place by updating only the committed
  ledger row classification, preserving the statement comparison session
- statement comparison also reports duplicate-looking groups within the uploaded
  statement and committed ledger using same date, signed amount, and normalized
  description
- large import previews call out that production commits are chunked and that a
  rejected Cloudflare request should be retried as smaller batches
- duplicate heuristics now distinguish exact ledger matches from near matches
  using amount, account, date proximity, and description token overlap
- the `Velocity Rule` narrows duplicate candidate windows for low-value rows to
  avoid commuter false positives, so weekly BUS/MRT or coffee transactions are
  not flagged as near matches just because they reused the same fare amount and
  merchant text
- `audit_events` keep a lightweight history of balance-affecting actions such as
  imports, opening-balance edits, checkpoints, entry edits, and transfer relinks
- account dialogs expose editable/deletable checkpoint history so
  reconciliation can be reviewed as a timeline rather than only as the latest
  status
- unresolved transfers have a paginated review surface in Settings that links
  back into Entries for settlement work. Users can also clear one or all
  transfer reviews, which marks the row as dismissed from that queue without
  rewriting imported bank facts.
- `categories` own their presentation metadata, including icon and color, so
  charts and category cards render from the same source of truth
- category matching rules live beside categories as editable Settings reference
  data, so merchant cleanup can improve future imports without changing older
  entries already committed to the ledger
- matching a preview row to the system `Transfer` category also promotes that
  row to transfer type, because transfer semantics affect reconciliation and
  cannot be represented by category alone

## Planning semantics

Each month should support two distinct planning layers:

- income
- planned items
- budget buckets

Monthly planning rows are person-owned first. The primary person and partner can
each have their own monthly plan rows, and the household view should be a
derived combined view over those per-person plans instead of a separate manually
maintained household plan.

Planned items are suitable for rows such as:

- savings
- tax
- subscriptions
- insurance
- loans
- recurring bills
- intentionally planned one-offs

Budget buckets are suitable for rows such as:

- food
- groceries
- shopping
- transport
- entertainment
- gifts
- hobbies

This distinction is important because the app should reveal variance without
forcing fake precision.

Planned-item matching is explicit. A planned row such as `Internet`, `Insurance`,
or `Electricity` can link to one or more imported ledger entries, and its actual
amount is derived from those selected entries. Category alone is not used for
planned-item matching because multiple planned rows can share a broad category
such as `Bills`.

When a user saves planned-item links, the app records lightweight match hints
from the linked ledger descriptions, amounts, categories, and accounts. Future
matching dialogs rank household entries using those hints plus category, account,
amount, description, and date proximity. The app still requires explicit user
confirmation; high-confidence automatic linking is intentionally deferred until
the rules have enough review history.

The planned-item matching dialog now favors lightweight narrowing before any
global search workflow. It supports:

- `Linked` to isolate the rows currently selected for that planned item
- `Same category`
- `Same account`
- `This month only`
- a local description substring filter over the ranked candidate list

The dialog also reports how many candidate rows remain after the current
filters, which matters when broad categories such as `Food & Drinks` can
surface dozens of ledger rows in the same month.

Budget buckets remain category-driven. A bucket such as `Food & Drinks` or
`Transport` rolls up actual expense entries in that category, after subtracting
actuals already assigned to planned items in the same category. This keeps
commitments precise without requiring every flexible purchase to become a
planned row.

Category-offsetting income, such as reimbursements, also reduces a budget
bucket's actual total when the entry is explicitly marked as offsetting that
category. Internal transfers still stay out of budget-bucket actuals.

Over-granular planning means too many unstable or ad hoc lines are promoted into
month-specific planned rows. The result is high maintenance and low signal.

The current spreadsheet structure from June to October is already close to the
right model: top rows for commitments and lower highlighted rows for broader
budget envelopes.

## Transaction semantics

Monie's Map should distinguish between:

- `expense`
- `income`
- `transfer`

Transfers should be modeled as linked counterpart entries between accounts, such
as a savings-account payment to a credit card. The UI should make that
relationship visible through labels, hover details, and links to the
counterparty entry.

Income can optionally offset a category when it represents reimbursement rather
than true earned income. Internal transfers should not pollute category spending
analytics.

## Dashboard shape

### Summary page

- defaults to the latest 12 available months
- month-by-month planned versus actual table
- planned income, actual income, planned expense, actual expense, savings
  target, and variance
- summary notes
- readable high-level charting as support, not as the main truth
- drill-down into a selected month
- planned values come from person-owned month rows and planned income rows
- actual income and expense values are derived from completed ledger entries
  when that month has entries, so stale monthly snapshots do not hide imported
  activity
- household summary view is a rollup of person planning plus household actuals,
  following the same ownership model as the month page

### Month page

- income section
- planned items section
- budget buckets section
- planned versus actual comparison by row
- explicit entry matching for planned items
- category breakdown as a secondary analytic view
- person and household perspectives
- monthly notes
- links from summary rows or charts to matching entries

Month-page planning model:

- person month pages are the primary planning surface
- income rows, planned items, and budget buckets are person-owned planning rows
- the same person-owned rows stay visible across `Direct ownership`, `Shared`,
  and `Direct + Shared`
- month-page scope changes actual aggregation only; it does not decide which
  rows exist in the person plan
- `Direct ownership` compares a person's rows against that person's direct
  ledger activity only
- `Shared` compares the same rows against that person's weighted share of shared
  ledger activity only
- `Direct + Shared` compares the same rows against direct activity plus that
  person's weighted share of shared activity
- household month view is a rollup of person-owned plans and household actuals,
  intended primarily for overview and coordination instead of being the default
  authoring surface

Household month scopes:

- `Combined`: aggregate rollup of both people's month plans plus household
  actuals

Person month scopes:

- `Direct ownership`: same plan rows, direct actuals only
- `Shared`: same plan rows, shared weighted actuals only
- `Direct + Shared`: same plan rows, direct actuals plus shared weighted actuals

### Entries page

- all entries for the selected month
- totals distinguish category spend from cash outflow: `Spend` excludes
  transfers, while `Outflow` includes expenses plus transfer-outs
- filters by person, account, category, and import batch
- in person views, shared entries should show that person's allocated subtotal,
  not the full household amount
- when a shared row is shown in a person view, the full shared total should stay
  visible as supporting context
- edit flow for categorization, attribution, and transfer links

### Splits page

- top-level `Splits` tab separate from `Entries`
- group pills start with `Non-group expenses`, followed by named split groups
- each group pill shows context-aware owed/owing copy plus the current open
  entry count
- a lightweight `Review matches` text action opens the split-match review
  surface without making matches look like a real expense group
- splits are not month-filtered; the month picker is passive desktop chrome and
  hidden on mobile because the page is driven by unsettled activity instead
- each group has one active open batch of unsettled entries
- recording a settle-up closes the current batch for that group
- later split expenses, even if backdated, open a new current batch unless an
  older closed batch is explicitly edited
- summary strip shows the current batch's owed/owing state, spend, donut toggle,
  and add-expense action
- split activity combines manual split expenses and settle-up records in one
  current chronological list, followed by muted settled-history batches
- current split rows edit inline by replacing the activity card with the same
  field set used by the create/edit dialogs; delete and linked-entry editing
  live inside that inline form, and delete requires confirmation before removing
  only the split-layer record
- matching links imported ledger transactions back to manual split expenses or
  settle-up records after the import is already committed
- entries editor can promote a ledger expense into the splits layer; if the
  source ledger row is still direct, the app converts it to shared with a
  default 50/50 transaction split first and then creates the linked split
  expense record

## Chart guidance

Pie or donut charts can be useful for quick share-of-total scans, but should not
be the only chart form.

Preferred defaults:

- summary page: compact plan-versus-actual comparison by month
- month page: tables for planned items and budget buckets
- optional donut for quick category share context

Charts should support net category views where reimbursements reduce the net
cost for a category, while still exposing gross expense and offsetting income in
details.

## Application boundaries

The app should be structured with clear boundaries between:

- storage schema and persistence logic
- import parsing and normalization
- domain calculations and aggregations
- DTOs that shape data for UI and APIs
- presentation components and client-side interaction state

Prefer pure transformation functions and typed DTOs over passing raw database
rows directly into the UI.

Frontend direction:

- React + Vite for the app shell and UI state
- React Router should own page-level navigation so dashboard sections have stable URLs
- UI labels and helper copy should be sourced from locale modules instead of being hardcoded across components
- client utility access should flow through `src/client/monies-client-service.js`.
  Leaf helpers such as formatters, category matching, import mapping, month
  helpers, entry math, and split presentation remain implementation details
  behind that deep module so components do not need to know which small file
  owns a given rule. Treat this as the client deep module service described in
  [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md).
- Worker API remains the source of bootstrap, route-page, mutation, and import
  endpoints
- charting should prefer a maintained library over hand-built geometry once the
  visual requirements become real product behavior
- the initial bootstrap remains the app shell and fallback payload for
  household, account, category, view, import, and settings data
- heavy route bodies are split behind focused endpoints:
  `/api/summary-page`, `/api/month-page`, `/api/entries-page`,
  `/api/splits-page`, `/api/imports-page`, and `/api/settings-page`
- the Imports page loads a bounded recent-history payload for browsing, while
  the recent-import account filter is built from the household account list so
  accounts do not disappear when their latest imports are outside the visible
  history slice
- bootstrap and page endpoints emit lightweight Worker diagnostics for slow or
  failed requests, including a request id, endpoint label, selected route
  parameters, and duration; error responses include the same request id so
  production console failures can be matched against Worker logs
- app-data schema and seed checks are cached per Worker instance after a
  successful initialization. Demo reseed and empty-state reset clear that cache.
  The read-path seed guard does not recalculate monthly snapshots; writes and
  imports remain responsible for refreshing derived snapshot rows.
- hot read paths have explicit D1 indexes for import history, ledger entries,
  plan rows, snapshots, category rules, and split activity. Runtime schema
  checks also ensure those indexes exist for older databases that predate the
  current `schema.sql`.
- bootstrap carries only the split-page shell fallback; split groups, expenses,
  settlements, and match candidates load from `/api/splits-page` so the app
  shell does not pay for split workspace data on every refresh.
- the imports page returns a bounded recent-history summary for first paint.
  Recent history opens by default and filters that bounded set by
  owner-qualified account labels. Full import preview, duplicate checks,
  rollback, and overlap checks still run through their dedicated import flows,
  but recent history no longer forces all historical batches to be scanned
  before the page is usable.
- page refreshes keep the current route mounted with a busy overlay while the
  smaller route payload loads; writes clear page and shell caches before
  reloading data. Cached route payloads are reused without automatic
  stale-while-revalidate requests because those page endpoints can be expensive;
  explicit refreshes and mutations remain the freshness boundary.
- route-page responses are cached in memory by endpoint and query string.
  Adjacent month or summary-range payloads are prefetched first after the
  current page settles on non-touch devices. Touch devices skip background API
  prefetching so mobile refreshes do not compete with the visible page request.
  Lower-priority page data warms only after the visible route has finished
  loading and an additional quiet period passes; those background requests run
  one at a time with spacing between them. Route changes, browser-tab hiding,
  mutations, manual refreshes, and cache invalidation cancel the staged prefetch
  so bootstrap no longer has to reload for ordinary month/range navigation
  without creating a burst of background API calls. Entries seeds its first page
  cache from bootstrap on refresh and relies on explicit month changes, manual
  refreshes, and write invalidations for fresh API loads.
- route panels are lazily loaded behind React Suspense so imports, settings,
  PDF parsing, statement parsing, and charting code do not inflate the initial
  app shell bundle
- Month and Entries support horizontal touch swipes for previous/next month
  navigation; Splits stays excluded because its main surface is not
  month-filtered
- heavyweight charting code should be lazily loaded from the client where it is
  not required for first render
- interaction primitives such as popovers should prefer maintained web-native
  packages rather than bespoke UI widgets
- dialogs and confirmation popovers that save, delete, import, or reset data
  should stay open while the request is running, disable duplicate actions, and
  swap the primary action text to a short pending label such as "Saving..." or
  "Working..."; close the surface only after success and keep it open for inline
  errors when possible

## Why Cloudflare

Cloudflare is a practical choice here:

- cheap to operate
- simple deployment from Git
- fast enough for a reporting-heavy application
- D1 is sufficient for this data volume
- R2 is available later if raw statements need to be retained

The production app now runs as one Cloudflare Worker with static assets served
from `dist` and a D1 binding named `DB`. The current Worker URL is
`https://<your-worker-host>`, backed by the APAC D1 database
`monies-map` (`d1aa440c-d239-48ac-b0a6-d39f34e26e0e`).
Worker assets use single-page-application not-found handling so direct refreshes
of React routes such as `/entries` and `/settings` return the app shell instead
of a Worker 404.

Authentication should be enforced at the Cloudflare Access layer before the app
is used with real household data. The pragmatic first pass is Access one-time
PIN email auth with an allowlist for the two household emails. Google login can
replace the OTP provider later after Google is configured as a Zero Trust
identity provider; the application code does not need to own password or
session handling for this private deployment.

## Suggested roadmap

### Milestone 1

- working imports for 2 to 3 institutions
- import history and import-batch rollback
- review queue for uncategorized items
- monthly dashboard and entries view
- summary and monthly notes

### Milestone 2

- recurring transaction rules
- Google login
- better search and filters
- AI export pack for summary and monthly dashboards

### Milestone 3

- in-app AI analysis using structured dashboard context and notes
- annual net worth and account balance tracking
- household calendar view of large expected expenses
- forecasting based on recurring patterns
