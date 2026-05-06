# Scenario Catalog

This document is the Stage 1 TDD scenario map for Monies Map.

Read it alongside
[`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md)
when a scenario exists mainly to preserve a hard-won behavior from the current
app.

Its purpose is to define the user-visible workflows that should drive tests and
refactors. It is not a list of buttons. It is a list of meaningful scenarios on
each page and across pages.

Use this document before implementation work to decide:

- what behavior matters
- which test level should cover it
- what state changes must be observable
- which cross-page effects must remain intact during refactors

## How To Read This

Each scenario uses this shape:

1. User intent
2. Starting state
3. Action
4. Expected visible result
5. Expected persisted or queried result
6. Primary test level
7. Form factor

Suggested test levels:

- `Domain`: pure logic, selectors, calculations, parsing, matching
- `Integration`: API, repository, DTO, or page-data contract tests
- `E2E`: browser workflow tests for end-to-end user behavior

Form-factor labels:

- `Both`: same workflow contract on desktop and mobile
- `Desktop`: desktop-specific workflow contract
- `Mobile`: mobile-specific workflow contract
- `Split`: same domain goal, but intentionally different workflow containers on
  desktop and mobile

## Coverage Status

This catalog reflects current product surfaces and current test coverage.

Current strong coverage:

- `Imports`
- `Month`
- `Entries`
- `Splits`

Current weak coverage:

- `Summary`
- `Settings`
- cross-page flows that start outside imports or splits
- savings-target definition and reporting behavior

## Summary Scenarios

### S1. Review range-level financial picture

1. User intent: understand the selected summary range at a glance
2. Starting state: summary page is loaded for a person or household
3. Action: open the Summary page
4. Expected visible result: metric cards, spending mix, month-by-month plan
   review, and account pills are visible
5. Expected persisted or queried result: the summary query returns range months,
   metric cards, category-share data, month summaries, and account health data
6. Primary test level: `Integration`, then one `E2E` smoke test
7. Form factor: `Both`

### S1a. Summary savings target and realized savings use distinct semantics

1. User intent: understand the difference between savings intent and savings
   outcome
2. Starting state: summary data exists for one or more months
3. Action: review summary metrics and intent-vs-outcome values
4. Expected visible result: savings target is shown as explicit plan intent,
   while realized savings is shown as actual outcome
5. Expected persisted or queried result: savings target comes from explicit
   month planning data, while realized savings is derived from actual income and
   actual expenses
6. Primary test level: `Domain` and `Integration`
7. Form factor: `Both`

### S2. Change spending-mix focus month

1. User intent: inspect category mix for one month or for the whole range
2. Starting state: summary page is open with range data loaded
3. Action: switch the summary focus between `overall` and a specific month
4. Expected visible result: donut chart, totals, and category list update to
   the selected focus
5. Expected persisted or queried result: no mutation; the UI derives the next
   focused view from summary page data
6. Primary test level: `Domain`, with one `E2E` route-state test
7. Form factor: `Both`

### S2a. Summary head metrics respect the selected scope

1. User intent: trust that the summary header metrics change with the active
   scope
2. Starting state: Summary is open for a person view, a shared view, and the
   combined household view
3. Action: compare the summary head metrics across `direct`, `shared`, and
   `direct_plus_shared`
4. Expected visible result: direct and shared scopes show the correct scope-
   weighted totals, while household combines the full household totals
5. Expected persisted or queried result: summary header metrics use the
   correct scope-aware query results rather than reusing a single unweighted
   aggregate
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### S3. Drill from category share to entries

1. User intent: inspect the ledger entries behind one category slice
2. Starting state: summary spending mix is visible
3. Action: click a category in the spending-mix list
4. Expected visible result: navigation opens Entries with the same view, the
   same scope, the focused month, and the chosen category filter already
   applied
5. Expected persisted or queried result: entries-page query reflects the route
   contract for view, scope, month, and category
6. Primary test level: `E2E`
7. Form factor: `Both`

### S3a. Category card drill-down preserves route context

1. User intent: move from a summary category card into the exact matching
   entries slice without losing context
2. Starting state: summary page is open for a specific person or household
   view, scope, and summary-focus month
3. Action: click a category card beside the donut chart
4. Expected visible result: Entries opens with the same view and scope, plus
   the month and category filter implied by the clicked card
5. Expected persisted or queried result: entries-page query uses the same view
   and scope as the originating summary screen, rather than falling back to a
   default
6. Primary test level: `E2E`
7. Form factor: `Both`

### S4. Drill from account pill to entries

1. User intent: inspect entries related to one account
2. Starting state: summary account pills are visible
3. Action: open entries from an account pill
4. Expected visible result: Entries opens with the account filter applied
5. Expected persisted or queried result: entries-page query reflects the
   selected account
6. Primary test level: `E2E`
7. Form factor: `Both`

### S5. Open a month from intent-vs-outcome

1. User intent: move from range review into one month workspace
2. Starting state: summary intent-vs-outcome cards are visible
3. Action: open one month from the summary card
4. Expected visible result: Month page opens on the selected month
5. Expected persisted or queried result: month-page query loads the selected
   month
6. Primary test level: `E2E`
7. Form factor: `Both`

### S6. Edit a summary month note

1. User intent: capture an explanation for an unusual month
2. Starting state: summary page is open and a month card is visible
3. Action: open the note dialog, edit the note, and save
4. Expected visible result: the edited note appears on the month card after
   refresh
5. Expected persisted or queried result: month note is saved for the month and
   current view scope
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### S7. Summary reflects month edits when returning from a drilldown

1. User intent: trust that a summary drilldown remains current after editing the
   underlying month data
2. Starting state: Summary is open, and the user drills into a month from
   intent-vs-outcome
3. Action: edit month budget or note, then return to Summary in the same tab
4. Expected visible result: the corresponding summary month card and affected
   metrics reflect the saved change without requiring a full manual reload
5. Expected persisted or queried result: summary queries invalidate or refetch
   after the month mutation and settle to the new values
6. Primary test level: `E2E`
7. Form factor: `Both`

### S8. Summary reflects entry edits when returning from a drilldown

1. User intent: trust that a summary category or account drilldown remains
   current after editing underlying entries
2. Starting state: Summary is open, and the user drills into Entries from a
   category share or account pill
3. Action: edit or recategorize entries, then return to Summary in the same tab
4. Expected visible result: the relevant summary cards, donut shares, and
   account pills reflect the saved changes after background settlement
5. Expected persisted or queried result: entries mutations invalidate affected
   summary queries and account-pill queries
6. Primary test level: `E2E`
7. Form factor: `Both`

### S9. Summary tab refreshes after related changes in another tab

1. User intent: trust that an already-open Summary tab does not stay stale after
   related work in another tab
2. Starting state: Summary is open in one tab while Month, Entries, Imports, or
   Settings is edited in another tab
3. Action: complete a save in the other tab, then focus the existing Summary tab
4. Expected visible result: Summary refreshes or reconciles promptly on return
   and shows the updated metrics, month cards, or account pills
5. Expected persisted or queried result: cross-tab invalidation reaches the
   Summary queries, but refresh is still subordinate to any in-progress local
   workflow
6. Primary test level: `E2E`
7. Form factor: `Both`

## Month Scenarios

### M1. Review one month by view and scope

1. User intent: understand the selected month for a person or household
2. Starting state: month page loads for a selected month and scope
3. Action: open the Month page
4. Expected visible result: month metrics, income rows, planned items, budget
   buckets, notes, and account context are visible
5. Expected persisted or queried result: month-page query returns month-level
   plan sections, income rows, entries, and account context
6. Primary test level: `Integration`, plus `E2E` smoke
7. Form factor: `Both`

### M1b. Month panel metrics respect shared weighting by scope

1. User intent: trust that the month header metrics reflect the active scope
   correctly
2. Starting state: Month is open for a person view and for the combined
   household view
3. Action: compare month metrics in `direct`, `shared`, and `direct_plus_shared`
4. Expected visible result: person scopes show scope-weighted totals, while the
   household scope shows the full household totals
5. Expected persisted or queried result: month-page metric cards are derived
   from scope-aware query data rather than from one generic total
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### M1a. Month savings target is explicit monthly intent

1. User intent: understand how the month defines the savings goal
2. Starting state: month page loads for a selected month
3. Action: review month metrics and planning context
4. Expected visible result: savings target is presented as an explicit monthly
   planning value, not merely as income minus spend
5. Expected persisted or queried result: month data distinguishes savings target
   from realized savings and from any optional planned savings allocation rows
6. Primary test level: `Domain` and `Integration`
7. Form factor: `Both`

### M2. Switch scope without corrupting planned values

1. User intent: compare direct, shared, and combined views safely
2. Starting state: month page contains person-owned plan rows
3. Action: switch scope between direct, shared, and direct-plus-shared
4. Expected visible result: visible totals and derived actuals change where
   appropriate, but stable planned rows remain stable across scopes
5. Expected persisted or queried result: no write; view-specific query shape
   remains consistent
6. Primary test level: `Integration` and `E2E`
7. Form factor: `Both`

### M3. Edit a budget bucket amount

1. User intent: change a monthly planned amount
2. Starting state: editable month plan row is visible
3. Action: open inline editing, change planned value, save
4. Expected visible result: the row updates and month totals settle to the new
   value
5. Expected persisted or queried result: month plan row persists and dependent
   month and summary aggregates recompute
6. Primary test level: `E2E`, supported by `Integration`
7. Form factor: `Desktop`

### M4. Cancel inline editing safely

1. User intent: inspect or start editing a row without committing a change
2. Starting state: editable month row is visible
3. Action: open inline editing and cancel
4. Expected visible result: editing controls disappear and original values
   remain unchanged
5. Expected persisted or queried result: no mutation occurs
6. Primary test level: `E2E`
7. Form factor: `Desktop`

### M5. Planned-item actuals only count linked entries

1. User intent: trust that plan actuals reflect linked ledger evidence
2. Starting state: month contains planned items with and without links
3. Action: inspect planned-item actuals
4. Expected visible result: rows without linked entries do not show phantom
   actuals
5. Expected persisted or queried result: actuals derive only from linked entry
   ids
6. Primary test level: `Domain` and `Integration`
7. Form factor: `Both`

### M6. Link planned rows to ledger entries

1. User intent: explain why a plan row has a real-world actual
2. Starting state: a plan row is eligible for entry linking
3. Action: open link picker, select entries, save
4. Expected visible result: row actuals and drill-down links reflect selected
   entries
5. Expected persisted or queried result: plan-entry links are stored and month
   actuals recompute
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Split`

### M7. Edit month note

1. User intent: add or refine month-level context
2. Starting state: month page is open
3. Action: edit the month note and save
4. Expected visible result: saved note is visible on reload
5. Expected persisted or queried result: month note persists for the current
   scope
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### M8. Add or delete month rows

1. User intent: manage planned rows and income rows from the month workspace
2. Starting state: add or delete controls are available
3. Action: create or delete an editable row
4. Expected visible result: row appears or disappears and totals settle
5. Expected persisted or queried result: row writes are persisted and derived
   month data refreshes
6. Primary test level: `E2E`
7. Form factor: `Split`

### M9. Mobile month editing uses bottom-sheet workflow

1. User intent: edit month rows on a phone-sized screen without relying on
   cramped inline table controls
2. Starting state: month page is open on mobile
3. Action: open add or edit flow for a month row
4. Expected visible result: a mobile sheet opens, category editing remains
   reachable, and save/cancel actions are touch-friendly
5. Expected persisted or queried result: saved changes persist identically to
   the desktop month flow
6. Primary test level: `E2E`
7. Form factor: `Mobile`

### M10. Mobile month actual drilldown remains reachable from the edit sheet

1. User intent: inspect the entries behind actual totals while staying inside
   the mobile month flow
2. Starting state: month page is open on mobile and a row with actual entries
   is editable
3. Action: open the edit sheet and trigger actual drilldown
4. Expected visible result: the contributing entries can be opened from the
   mobile sheet flow
5. Expected persisted or queried result: no write; the correct entry ids remain
   the drilldown target
6. Primary test level: `E2E`
7. Form factor: `Mobile`

## Entries Scenarios

### E1. Review entries for a month with filters

1. User intent: inspect the ledger for one month and one view
2. Starting state: entries page loads for a selected month and view
3. Action: open the Entries page
4. Expected visible result: grouped entries, totals, filters, and breakdowns
   appear for the selected view
5. Expected persisted or queried result: entries-page query returns filtered
   month entries and breakdown data
6. Primary test level: `Integration`, plus `E2E` smoke
7. Form factor: `Both`

### E1a. Entries totals strip respects shared percentage by scope

1. User intent: trust that Entries totals reflect the same scope weighting as
   the rest of the app
2. Starting state: Entries is open for person and household views with rows
   that include shared ownership
3. Action: compare the totals strip in `direct`, `shared`, and
   `direct_plus_shared`
4. Expected visible result: the totals strip shows scope-weighted values for
   person scopes and full household totals for the combined household view
5. Expected persisted or queried result: the totals strip derives from the same
   scope-aware entry set used by the list and breakdown
6. Primary test level: `E2E`
7. Form factor: `Both`

### E2. Switch person view and scope from shell controls

1. User intent: change who and what ownership slice is being viewed
2. Starting state: entries page is open
3. Action: switch between household/person view and ownership scopes
4. Expected visible result: visible entries and totals change to match the new
   selection
5. Expected persisted or queried result: entries-page query reloads with the
   new route parameters
6. Primary test level: `E2E`
7. Form factor: `Split`

### E2a. Filter-sheet view or scope changes do not auto-close mobile controls

1. User intent: adjust several Entries context and filter controls in one visit
   to the mobile sheet
2. Starting state: Entries is open on mobile and the view/scope/filter sheet is
   open
3. Action: change view or scope, then continue adjusting wallet, category,
   type, or search controls
4. Expected visible result: the sheet remains open until the user explicitly
   dismisses it; changing scope alone does not auto-close the sheet
5. Expected persisted or queried result: route and query state update as
   intended, but the workflow container remains stable
6. Primary test level: `E2E`
7. Form factor: `Mobile`

### E3. Create a manual entry

1. User intent: capture a ledger entry before or without an import
2. Starting state: entries page is open
3. Action: open the composer, enter entry details, save
4. Expected visible result: the new entry appears in the list
5. Expected persisted or queried result: a ledger entry is created and later
   flows can use it
6. Primary test level: `E2E`, supported by `Integration`
7. Form factor: `Split`

### E3b. Search entries within the current view, month, and filter context

1. User intent: find a matching entry quickly without losing current month,
   view, scope, or filter context
2. Starting state: Entries is open with a selected month and optional filters
3. Action: enter a basic search term such as merchant, note, or amount text
4. Expected visible result: the entry list narrows within the current route
   context, and clearing search restores the prior filtered set
5. Expected persisted or queried result: search is treated as part of Entries
   filter state and does not silently reset month, view, scope, wallet,
   category, or type filters
6. Primary test level: `E2E`, supported by `Integration`
7. Form factor: `Both`

### E3a. Quick entry from URL survives without unsafe auto-refresh

1. User intent: open a quick-entry flow from a URL or external shortcut and
   complete it without the editor being disrupted
2. Starting state: Entries opens with quick-entry route params, especially on
   mobile where the composer may use a sheet
3. Action: launch quick entry, begin editing, and remain on the screen while
   background invalidation, tab sync, or focus events occur
4. Expected visible result: the quick-entry editor remains stable and is not
   auto-closed, reset, or silently replaced by a background refresh
5. Expected persisted or queried result: active query refreshes are deferred,
   paused, or applied as non-destructive background updates until the quick
   entry is saved or dismissed
6. Primary test level: `E2E`
7. Form factor: `Split`

### E4. Edit an entry

1. User intent: correct category, owner, note, amount, account, or type
2. Starting state: an editable entry exists
3. Action: open inline editor or mobile editor, make changes, save
4. Expected visible result: the entry row and any visible totals update
5. Expected persisted or queried result: entry update persists and downstream
   aggregates refresh if affected
6. Primary test level: `E2E`
7. Form factor: `Split`

### E4a. Finish editing while the active filter would exclude the saved row

1. User intent: re-categorize an entry from a filtered entries list without the
   editor collapsing halfway through the save
2. Starting state: Entries is filtered to a category such as `Others`, and an
   entry currently visible under that filter is open in the editor
3. Action: change the entry category to a value outside the active filter and
   save
4. Expected visible result: the edit session remains stable long enough for the
   user to complete the save and receive success feedback; only after the save
   settles may the row leave the filtered list
5. Expected persisted or queried result: the entry persists with the new
   category, and the filtered entries query no longer includes it after the
   save completes
6. Primary test level: `E2E`
7. Form factor: `Both`

### E5. Delete an entry

1. User intent: remove a wrong or temporary manual entry
2. Starting state: an editable manual entry exists
3. Action: open inline editor and delete the entry
4. Expected visible result: the entry disappears from the list
5. Expected persisted or queried result: entry no longer exists in entries-page
   data
6. Primary test level: `E2E`
7. Form factor: `Split`

### E6. Add an entry to splits

1. User intent: convert a direct expense into a shared split expense
2. Starting state: a direct expense exists on Entries
3. Action: choose `Add to splits`, optionally pick a split group, save
4. Expected visible result: entry becomes shared, split actions appear, and the
   created split can be opened
5. Expected persisted or queried result: linked split expense exists and
   references the ledger entry
6. Primary test level: `E2E`
7. Form factor: `Split`

### E7. Delete a split created from entries

1. User intent: reverse an accidental `Add to splits` action
2. Starting state: entry is linked to a split expense
3. Action: delete the created split from Entries context
4. Expected visible result: linked split actions disappear and entry ownership
   returns to the correct state
5. Expected persisted or queried result: split expense link is removed and
   dependent views refresh
6. Primary test level: `E2E`
7. Form factor: `Split`

### E8. Link transfer candidates and settle transfers

1. User intent: model internal account transfers correctly
2. Starting state: transfer-like entries exist
3. Action: open transfer tools, link or settle transfer candidates
4. Expected visible result: transfer status and related entry state update
5. Expected persisted or queried result: transfer groups or settlement fields
   update
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Split`

### E9. Mobile context dialog switches view and scope cleanly

1. User intent: change who and what ownership slice is shown on a phone-sized
   screen
2. Starting state: Entries is open on mobile
3. Action: open the sticky context dialog and switch view or scope
4. Expected visible result: the dialog reflects the valid controls for the
   current view and the entries list updates after selection
5. Expected persisted or queried result: entries-page query reloads with the new
   route parameters
6. Primary test level: `E2E`
7. Form factor: `Mobile`

### E9a. Mobile filter-sheet dismissal is separate from search submission

1. User intent: search and filter entries on mobile without confusing the sheet
   dismiss action with the search action
2. Starting state: Entries mobile filter sheet is open with a search field
3. Action: type into search, submit search from the keyboard, then dismiss the
   sheet
4. Expected visible result: search applies without closing the sheet unless the
   user intentionally dismisses it; the dismiss action clearly means `Close`
   rather than `Search` or `Done`
5. Expected persisted or queried result: search state updates the Entries
   filter/query context, while sheet dismissal only affects the UI container
6. Primary test level: `E2E`
7. Form factor: `Mobile`

### E10. Open mobile entry sheet is a protected workflow during refresh

1. User intent: finish a mobile entry edit without losing state when other data
   changes
2. Starting state: Entries mobile sheet is open with an active draft or edit
3. Action: a same-tab invalidation, cross-tab invalidation, focus event, or
   explicit background refresh occurs while the sheet is open
4. Expected visible result: the mobile sheet stays open and the active draft is
   preserved until the user saves or cancels
5. Expected persisted or queried result: TanStack invalidation may mark the page
   stale, but visible refetch must not clobber the in-progress draft
6. Primary test level: `E2E`
7. Form factor: `Mobile`

## Imports Scenarios

### I1. Start an import draft

1. User intent: bring new bank data into the app
2. Starting state: imports page is open
3. Action: paste CSV, upload a supported source file, or start a statement
   draft
4. Expected visible result: mapping or preview flow opens based on source type
5. Expected persisted or queried result: no commit yet; draft state exists only
   in the client until preview/commit
6. Primary test level: `E2E`
7. Form factor: `Both`

### I2. Map columns for a generic CSV

1. User intent: tell the app how a raw CSV maps into import fields
2. Starting state: generic CSV headers are detected
3. Action: review or edit field mappings
4. Expected visible result: required-field warnings clear when mapping becomes
   valid
5. Expected persisted or queried result: preview request receives normalized
   mapped rows
6. Primary test level: `Domain` and `E2E`
7. Form factor: `Both`

### I3. Preview blocks unknown accounts before commit

1. User intent: import safely even when source account names do not match the
   app
2. Starting state: preview contains unknown account names
3. Action: run preview
4. Expected visible result: commit is blocked and the UI asks for account
   mapping
5. Expected persisted or queried result: preview response includes detected and
   unresolved account names
6. Primary test level: `E2E`
7. Form factor: `Both`

### I4. Auto-map known expense and income headers

1. User intent: use common CSV shapes without repetitive manual mapping
2. Starting state: CSV uses known expense/income headers
3. Action: paste CSV and preview
4. Expected visible result: mapping succeeds without manual field correction
5. Expected persisted or queried result: mapped rows normalize into the preview
   request correctly
6. Primary test level: `Domain` and `E2E`
7. Form factor: `Both`

### I4a. Similar exports from the same bank remain importable across small file-format variants

1. User intent: import the next export from the same bank/account without
   unpredictable parser rejection
2. Starting state: the app already supports a bank/export family such as UOB
   current-transaction XLS
3. Action: upload a later export from the same source where the workbook
   container or low-level spreadsheet structure differs slightly
4. Expected visible result: the import still reaches mapping or preview instead
   of failing with a misleading unsupported-format error
5. Expected persisted or queried result: the importer recognizes equivalent
   source structure variants, and fixture-backed parser coverage catches the
   regression before release
6. Primary test level: `Domain` and `Integration`
7. Form factor: `Both`

### I5. Review preview guardrails

1. User intent: understand what will import, skip, reconcile, or block
2. Starting state: preview has finished
3. Action: inspect the preview review section and preview rows table
4. Expected visible result: counts and warnings for imported rows, skipped
   rows, matches, unknown categories, overlap imports, and checkpoint effects
5. Expected persisted or queried result: preview response exposes commit-status
   decisions and reconciliation metadata
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### I6. Commit a generic import

1. User intent: write approved preview rows into the ledger
2. Starting state: preview is valid and commit is enabled
3. Action: commit import
4. Expected visible result: import clears or refreshes and downstream pages
   reflect the new ledger data
5. Expected persisted or queried result: import batch, import rows, and ledger
   entries are written
6. Primary test level: `E2E`
7. Form factor: `Both`

### I7. Reconcile provisional rows instead of duplicating them

1. User intent: let later bank evidence promote an existing entry
2. Starting state: provisional matching candidates already exist
3. Action: preview and commit a later import source
4. Expected visible result: rows show reconciliation candidates instead of only
   raw duplicates
5. Expected persisted or queried result: existing ledger entries are promoted or
   certified in place, preserving user-maintained fields
6. Primary test level: `Domain`, `Integration`, and targeted `E2E`
7. Form factor: `Both`

### I8. Save statement checkpoints and reconciliation evidence

1. User intent: anchor balances against official statements
2. Starting state: supported statement import has detected checkpoints
3. Action: preview and commit the statement
4. Expected visible result: checkpoint counts and reconciliation summaries are
   visible before commit
5. Expected persisted or queried result: statement checkpoints and related
   reconciliation records are saved
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### I9. Auto-refresh a stale statement preview safely

1. User intent: keep statement preview in sync while editing mappings or review
2. Starting state: statement preview exists and becomes stale
3. Action: wait with a visible, idle statement preview
4. Expected visible result: preview refreshes only when the throttle and
   visibility rules allow it
5. Expected persisted or queried result: no commit; preview request reruns for
   the same draft key
6. Primary test level: `Domain`
7. Form factor: `Both`

### I10. Review and rollback recent imports

1. User intent: inspect or undo a bad import batch where policy allows
2. Starting state: recent imports list contains prior import batches
3. Action: filter recent imports, inspect one batch, and perform rollback where
   allowed
4. Expected visible result: recent imports list and downstream data reflect the
   rollback
5. Expected persisted or queried result: targeted import effects are removed
   without damaging unrelated data
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

## Splits Scenarios

### SP1. Review split workspace for a person or household

1. User intent: understand shared expenses, matches, and balances
2. Starting state: splits page is open for a view and month
3. Action: open the Splits page
4. Expected visible result: groups, activity, balances, matches, and archive
   entry points are visible
5. Expected persisted or queried result: splits-page query returns activity,
   groups, match queue, and archive metadata
6. Primary test level: `Integration`, plus `E2E` smoke
7. Form factor: `Both`

### SP2. Create a split expense

1. User intent: add a shared expense directly inside the split workspace
2. Starting state: splits page is open
3. Action: add an expense and save
4. Expected visible result: new split row appears immediately
5. Expected persisted or queried result: split expense persists and reloads from
   splits-page data
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP3. Edit a split expense

1. User intent: change a split expense note or other editable fields
2. Starting state: split expense exists
3. Action: open inline editor, edit, save
4. Expected visible result: edited value stays visible in place
5. Expected persisted or queried result: saved value reloads from splits-page
   data
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP4. Delete a split expense

1. User intent: remove a wrong split record
2. Starting state: split expense exists
3. Action: open delete flow and confirm
4. Expected visible result: split row disappears from the current view
5. Expected persisted or queried result: split expense no longer exists in
   splits-page data
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP5. Record a settlement and archive a closed batch

1. User intent: close an open shared-expense batch after settling up
2. Starting state: open split batch exists
3. Action: create settlement and save
4. Expected visible result: group summary changes to settled and archive count
   updates
5. Expected persisted or queried result: settlement persists and closed batch is
   archived
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP6. Review match queue and link a split expense to an entry

1. User intent: connect a split record to its real ledger evidence
2. Starting state: split match candidates exist
3. Action: open matches mode and confirm a match
4. Expected visible result: match disappears from queue and linked split actions
   become available
5. Expected persisted or queried result: split record stores linked transaction
   id and entry ownership updates as needed
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP7. Review match queue and link a settlement to an entry

1. User intent: connect a settle-up record to its bank transfer entry
2. Starting state: settlement match candidate exists
3. Action: match the settlement from the queue
4. Expected visible result: match leaves the queue and linked entry can be
   opened from split history
5. Expected persisted or queried result: settlement record stores linked
   transaction id
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP8. Open linked entry from live or archived split history

1. User intent: inspect the ledger entry behind a split record
2. Starting state: a split record is linked to an entry
3. Action: choose `View entry` from a live or archived split item
4. Expected visible result: Entries opens with the linked entry editor visible
5. Expected persisted or queried result: no mutation; route carries linked entry
   context
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP9. Cross-tab refresh keeps split views in sync

1. User intent: trust that another open tab reflects split changes quickly
2. Starting state: two tabs are open on relevant views
3. Action: create or link split data in one tab
4. Expected visible result: second tab reflects the change without manual full
   reload
5. Expected persisted or queried result: app-sync and refresh logic invalidate
   affected data
6. Primary test level: `E2E`
7. Form factor: `Both`

### SP10. Viewer amount reflects borrowed or lent semantics correctly

1. User intent: see the correct personal share from either side of a split
2. Starting state: the same split expense is viewed by different people
3. Action: load the split activity as each person
4. Expected visible result: borrower and lender labels differ, but amount math
   remains consistent
5. Expected persisted or queried result: view model derives viewer amount from
   the same underlying split shares
6. Primary test level: `Domain` and `Integration`
7. Form factor: `Both`

## Settings Scenarios

### ST1. Review household reference data

1. User intent: inspect people, accounts, categories, category rules, trust,
   transfers, and recent activity
2. Starting state: settings page is open
3. Action: expand the relevant settings sections
4. Expected visible result: current reference data and operational panels are
   visible
5. Expected persisted or queried result: settings-page query returns household
   reference data, activity, and reconciliation context
6. Primary test level: `Integration`, plus one `E2E` smoke test
7. Form factor: `Both`

### ST2. Create or edit a person

1. User intent: keep household member metadata accurate
2. Starting state: settings page is open
3. Action: create or edit a person and save
4. Expected visible result: person labels update in Settings and downstream
   views
5. Expected persisted or queried result: person record persists and later page
   data uses the new name
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### ST3. Create, edit, or archive an account

1. User intent: maintain the tracked account list safely
2. Starting state: settings page is open
3. Action: create, edit, or archive an account
4. Expected visible result: account list updates and later selection controls
   use the changed account metadata
5. Expected persisted or queried result: account record persists with the new
   status and metadata
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### ST3a. New or edited account refreshes Summary account pills

1. User intent: trust that account changes in Settings are reflected in Summary
   without lingering stale pills
2. Starting state: Settings and Summary are both available, and account pills
   are already visible in Summary
3. Action: create, edit, or archive an account in Settings, then return to or
   refocus Summary
4. Expected visible result: Summary account pills reflect the account change
   promptly and do not continue showing stale labels or values indefinitely
5. Expected persisted or queried result: account reference-data invalidation
   reaches the shell or summary-account-pills query without forcing unrelated
   page reloads
6. Primary test level: `E2E`
7. Form factor: `Both`

### ST4. Create or edit a category

1. User intent: maintain the household taxonomy
2. Starting state: settings page is open
3. Action: create or edit a category
4. Expected visible result: category list updates and later category pickers use
   the new metadata
5. Expected persisted or queried result: category persists and later imports or
   edits can reference it
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### ST5. Manage category match rules and suggestions

1. User intent: improve future import classification
2. Starting state: existing rules or pending suggestions exist
3. Action: create, edit, delete, accept, or ignore a category rule suggestion
4. Expected visible result: settings rule list and suggestion badges update
5. Expected persisted or queried result: category rule or suggestion status is
   saved
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### ST6. Manage statement checkpoints and reconciliation review

1. User intent: verify account trust and reconcile against statements
2. Starting state: account has checkpoint or reconciliation history
3. Action: open reconciliation dialog, save or delete checkpoint, inspect
   comparison details
4. Expected visible result: checkpoint history and trust indicators update
5. Expected persisted or queried result: checkpoint or exception records persist
6. Primary test level: `Integration`, then targeted `E2E`
7. Form factor: `Both`

### ST7. Review and dismiss unresolved transfers

1. User intent: clear transfer review queues after checking them
2. Starting state: unresolved transfer items exist
3. Action: dismiss one item or dismiss all
4. Expected visible result: unresolved transfer list shrinks
5. Expected persisted or queried result: dismissal state persists
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### ST8. Run demo and local environment controls safely

1. User intent: reseed demo data, reload, or reset to empty state without
   confusing the app state
2. Starting state: app is in `local` or `demo`
3. Action: use reseed, reload, or empty-state controls with the required typed
   confirmation
4. Expected visible result: app reloads into the selected environment state and
   reports errors clearly when the backend fails
5. Expected persisted or queried result: demo-state action completes and the UI
   refreshes from authoritative data
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

## Cross-Page Scenarios

### X1. Import changes Entries

1. User intent: see newly imported rows in the ledger
2. Starting state: import preview is valid and entries page does not yet include
   the rows
3. Action: commit import
4. Expected visible result: imported rows appear on Entries
5. Expected persisted or queried result: entries-page query now includes the new
   ledger entries
6. Primary test level: `E2E`
7. Form factor: `Both`

### X2. Import changes Month actuals

1. User intent: trust that imported entries affect month planning outcomes
2. Starting state: month actuals are known before import
3. Action: commit import for the same month
4. Expected visible result: month actuals and drill-downs update
5. Expected persisted or queried result: month-page aggregates recompute from
   imported entries
6. Primary test level: `E2E`
7. Form factor: `Both`

### X3. Import changes Summary range metrics

1. User intent: trust that range reporting reflects imported history
2. Starting state: summary metrics are known before import
3. Action: commit import
4. Expected visible result: summary metrics, category mix, and month cards
   update
5. Expected persisted or queried result: summary-page aggregates recompute
6. Primary test level: `E2E`
7. Form factor: `Both`

### X4. Month plan edit changes Summary

1. User intent: trust that planned changes flow into range-level reporting
2. Starting state: month and summary are visible before editing
3. Action: save a month plan edit
4. Expected visible result: month row and summary planned totals both update
5. Expected persisted or queried result: month plan row persists and summary
   query reflects the new planned values
6. Primary test level: `E2E`
7. Form factor: `Both`

### X5. Entries edit changes Month and Summary

1. User intent: trust that entry corrections affect downstream reporting
2. Starting state: entry is visible in Entries and contributes to month/summary
3. Action: edit category, amount, type, or ownership on the entry
4. Expected visible result: affected totals or slices update on Month and
   Summary after refresh
5. Expected persisted or queried result: entry persists and dependent aggregates
   recompute
6. Primary test level: `Integration`, then `E2E`
7. Form factor: `Both`

### X5a. Same-tab return uses settled fresh data, not destructive reload

1. User intent: move between drilldown pages and return to a previously open
   screen without losing the sense of continuity
2. Starting state: the user navigates from Summary or Month into Entries, then
   performs a save
3. Action: return to the originating screen in the same tab
4. Expected visible result: the originating screen shows updated data quickly,
   while preserving safe local UI state and avoiding jarring reload behavior
5. Expected persisted or queried result: the affected TanStack queries are
   invalidated and refetched or reconciled with placeholder data where
   appropriate
6. Primary test level: `E2E`
7. Form factor: `Both`

### X5b. Cross-tab return does not clobber active mobile workflows

1. User intent: benefit from cross-tab freshness without losing in-progress
   mobile editing flows
2. Starting state: one tab performs a mutation while another tab is on a mobile
   editing surface such as quick entry or an entry edit sheet
3. Action: the mutation broadcasts invalidation to the other tab
4. Expected visible result: the passive tab is marked stale or refresh-ready,
   but the active mobile workflow remains intact until it is saved or dismissed
5. Expected persisted or queried result: invalidation reaches TanStack query
   state, but visible refetch is gated by workflow locks
6. Primary test level: `E2E`
7. Form factor: `Mobile`

### X6. Entries to Splits changes both views

1. User intent: create a shared-expense record from a ledger entry and see it
   everywhere relevant
2. Starting state: entry is direct and not yet linked
3. Action: add entry to splits
4. Expected visible result: Entries shows the new shared state and Splits shows
   the created split expense
5. Expected persisted or queried result: linked split expense persists and entry
   ownership/linking refreshes
6. Primary test level: `E2E`
7. Form factor: `Both`

### X7. Split match changes Entries

1. User intent: link a split record to ledger evidence and see the result from
   both sides
2. Starting state: split match candidate exists and the entry is not yet linked
3. Action: confirm the match in Splits
4. Expected visible result: Splits removes the match from queue and Entries
   exposes the linked shared entry state
5. Expected persisted or queried result: linked split and linked entry ids are
   saved
6. Primary test level: `E2E`
7. Form factor: `Both`

### X8. Settings reference-data change affects later workflows

1. User intent: trust that editing people, accounts, categories, or rules in
   Settings affects later product behavior
2. Starting state: reference data exists with an older value
3. Action: change the reference data in Settings, then perform a later flow
4. Expected visible result: later pages use the updated labels, options, or
   matching behavior
5. Expected persisted or queried result: updated reference data flows through
   later page-data queries or imports
6. Primary test level: `E2E`
7. Form factor: `Both`

## Immediate Test Backlog

These scenarios appear important but are not strongly represented by current
tests yet:

- Summary page smoke and drill-down flows
- summary category-card drill-down with preserved view and scope
- summary month note editing
- explicit savings-target semantics in month and summary views
- month note editing
- month plan link picker workflows
- explicit desktop/mobile scenario tagging beyond the current month-page tests
- same-tab and cross-tab summary freshness after month or entry drilldowns
- workflow-lock protection for mobile quick entry and entry edit sheets
- filtered entries recategorization where the saved row should not disappear
  mid-edit
- entry editing effects on month and summary aggregates
- import rollback workflows
- settings CRUD flows for people, accounts, categories, and category rules
- settings reconciliation and unresolved-transfer workflows
- cross-page confirmation that settings edits affect later imports and entries

## Stage 1 Exit Criteria

Stage 1 is complete when:

- each main page has named scenarios
- each important cross-page workflow has named scenarios
- each scenario has a primary recommended test level
- the implementation team can choose tests from scenarios instead of inventing
  behavior ad hoc during refactors
