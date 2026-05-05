# Responsive Behavior

This document captures the intended desktop and mobile behavior contracts for
Monies Map.

Its purpose is to prevent responsive regressions during the slice and TanStack
refactor. The app does not merely resize between breakpoints. Some workflows
change interaction style, component choice, and navigation affordances between
desktop and mobile.

## Scope

This document defines:

- which behaviors must remain shared across desktop and mobile
- which behaviors are intentionally different
- which components are shared versus split by form factor
- what design-language qualities should remain stable across form factors

It does not define visual tokens exhaustively. It defines workflow and
interaction invariants.

## Core Rule

Responsive behavior is not a CSS afterthought in this app.

If desktop and mobile differ in workflow, that difference must be documented as
an intentional contract and covered by scenarios or tests.

## Design-Language Invariants

These should remain consistent across desktop and mobile:

- the same domain language
- the same account, category, month, split, and settings concepts
- the same trust model around imports, entries, checkpoints, and splits
- the same action semantics even when the interaction container changes
- the same overall visual language of:
  - dense but readable data views
  - explicit state labels
  - finance-first clarity over decorative UI
  - strong distinction between direct, shared, transfer, and reconciled states

## Intentional Form-Factor Differences

These are allowed and expected.

### Desktop patterns

- inline table editing
- side-by-side context and controls
- hover-friendly or pointer-precise interactions
- larger filter surfaces visible without extra taps
- dialog-based dense review tools where width helps

### Mobile patterns

- bottom-sheet editing and creation flows
- sticky context controls near the bottom navigation area
- responsive select pickers that replace narrow desktop selects
- simplified scope/view switching through a dedicated mobile context dialog
- progressive disclosure to avoid crowded tables and tiny hit targets

## Shared Versus Split Responsive Components

### Shared responsive components

These may adapt by breakpoint but should remain shared if their public contract
is stable:

- [src/client/responsive-select.jsx](/Users/tim/22m/ai-projects/monies_map/src/client/responsive-select.jsx)
- [src/client/ui-components.jsx](/Users/tim/22m/ai-projects/monies_map/src/client/ui-components.jsx)
- [src/client/category-visuals.jsx](/Users/tim/22m/ai-projects/monies_map/src/client/category-visuals.jsx)

### Shared-with-caution components

These are shared now but should remain shared only if their API stays generic:

- [src/client/entry-mobile-sheet.jsx](/Users/tim/22m/ai-projects/monies_map/src/client/entry-mobile-sheet.jsx)

Rule:

- if a shared mobile shell starts accumulating slice-specific behavior, split it
  into slice-owned mobile surfaces

### Split-by-form-factor behavior

These workflows already differ enough that the behavior should be treated as a
 first-class contract:

- Month page inline editing on desktop versus bottom-sheet editing on mobile
- Entries view/scope switching via shell pills on desktop versus sticky context
  dialog on mobile
- planned-item link dialog on desktop versus bottom-sheet matching flow on
  mobile
- desktop selects or popovers versus mobile picker dialogs

## Page-Level Responsive Contracts

## App Shell

Desktop:

- top-level navigation and context controls stay visible
- person/scope switching is visible in the shell when relevant

Mobile:

- use sticky context trigger and dialog for view/scope changes
- preserve fast access to month navigation and current context

Contract:

- a user must always be able to identify current `view`, `scope`, and `month`
- changing those values must be possible on both form factors without hunting

## Summary

Desktop and mobile should share the same information architecture:

- metric cards
- spending mix
- month cards
- account pills

If layout differs, the drill-down contracts must remain identical:

- category card opens Entries with preserved view/scope/month/category context
- account pill opens Entries with preserved account context
- month card opens Month with preserved view/scope/month context

## Month

Desktop contract:

- budget and planned-item rows support inline editing
- actual drill-downs and link dialogs can use larger modal/dialog surfaces
- scope toggles remain visible when relevant

Mobile contract:

- add/edit uses bottom sheets instead of inline table editing
- category editing can remain accessible above the sheet content
- planned-item matching uses sheet flow rather than dense desktop dialog
- actual drill-downs remain accessible from the edit sheet

Invariant:

- desktop and mobile must produce the same persisted month-plan and note
  outcomes

## Entries

Desktop contract:

- list and filters can stay visible together
- inline entry editing is allowed
- category and transfer tools can use denser layouts

Mobile contract:

- editing uses sheet-based surfaces where needed
- view/scope and filter access remains reachable via sticky context controls
- destructive and secondary actions remain reachable without precision hover

Invariant:

- entry editing, split-linking, transfer-linking, and category updates must
  preserve the same data rules on both form factors

Special rule:

- the filtered-entry recategorization flow must remain stable on both desktop
  and mobile; the row may leave the filtered list only after save settles

## Imports

Desktop and mobile may differ in spacing and progressive disclosure, but the
workflow stages remain the same:

- select file
- map fields
- review preview
- commit

Contracts:

- account mapping blockers and preview guardrails remain explicit
- statement-related warnings remain visible without requiring hidden hover
  affordances

## Splits

Desktop contract:

- activity, groups, and matches can use wider layouts and side-by-side context

Mobile contract:

- dialogs and sheet-like surfaces should keep shared-expense workflows reachable
  with larger touch targets

Invariant:

- match queue, archive access, settlement flows, and linked-entry navigation
  must remain available on both form factors

## Settings

Desktop contract:

- larger settings sections and trust/reconciliation details can remain expanded
  in denser layouts

Mobile contract:

- dialogs and section toggles must avoid crowding and preserve clear exit
  actions

Invariant:

- all important reference-data and trust-management actions must remain possible
  on mobile, even if fewer details are visible at once

## Responsive Query And Warmup Notes

Responsive behavior also affects data strategy.

Rules:

- lower-powered or coarse-pointer contexts should avoid aggressive speculative
  warmup
- mobile should favor current-screen responsiveness over broad background
  prefetch
- desktop may warm adjacent months or nearby drill-down destinations more
  aggressively when that materially improves flow

This must remain subordinate to the main Stage 3 rule:

- the active page query always outranks warmup

## Testing Expectations

Responsive behavior should be tested by intention, not by visual pixel checks
alone.

Coverage expectations:

- test `both` when desktop and mobile behavior should be identical
- test `desktop` when the workflow depends on inline editing, wide tables, or
  dense dialogs
- test `mobile` when the workflow depends on sticky context, bottom sheets, or
  mobile pickers
- test both separately when the same domain action uses different interaction
  containers

## Refactor Guardrails

During future refactors:

- do not collapse mobile and desktop into one interaction model if that harms
  usability
- do not fork components by form factor unless the workflow difference is real
- prefer shared domain rules with separate responsive surfaces when interaction
  needs differ
- when splitting a component by form factor, keep the domain action contract
  shared underneath

## Immediate Watch List

These current areas need explicit protection during refactors:

- sticky mobile context dialog in the app shell
- month add/edit sheets
- mobile planned-item match sheet
- desktop planned-item link dialog
- responsive select behavior
- entry mobile sheet behavior
- desktop versus mobile handling of category editing inside entry editing
