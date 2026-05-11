# Interaction Guidelines

This document defines the interaction semantics for buttons, actions, and
dismissal patterns in Monies Map.

Its purpose is to stop UI drift. The main problem is not only visual variance.
It is semantic variance: the same-looking button can mean different things, and
similar actions can be labeled inconsistently across desktop and mobile.

## Planning Rule

We do not need to choose or adopt a UI library yet to define these rules.

At the planning stage, what matters is:

- button intent
- action hierarchy
- dismissal semantics
- destructive-action safeguards
- responsive interaction consistency

A UI library may help later, but it should implement these rules, not define
them for us.

## Core Principle

Buttons should be classified by intent, not by ad hoc styling.

Each interactive surface should make clear:

- what is the main forward action
- what is the dismiss action
- what is destructive
- what is merely supportive or navigational

When writing scenarios or implementation prompts, name the button text, the
surface where it lives, and the intended button class. If a surface mixes a
staged apply action with dismissal, those are separate controls and should be
called out separately.

## Action Hierarchy

### Primary action

Use for the main forward action in a container.

Examples:

- `Save`
- `Commit import`
- `Match`
- `Create account`

Rules:

- one primary action per container whenever possible
- the primary action should be visually strongest
- the primary action should represent the most likely successful completion path

### Secondary action

Use for supporting actions that matter but are not the main completion path.

Examples:

- `Edit`
- `View entry`
- `Duplicate month`

Rules:

- secondary actions should never visually compete with the primary action
- use for meaningful but non-destructive alternatives

### Tertiary or subtle action

Use for low-emphasis utility actions.

Examples:

- `Clear`
- `Done`
- `Open filters`
- `Dismiss overlap`

Rules:

- subtle actions should not look destructive
- subtle actions should not be used for the main commit path

### Danger action

Use for destructive or difficult-to-reverse actions.

Examples:

- `Delete`
- `Reset month`
- `Rollback import`
- `Delete split row`

Rules:

- danger actions must be clearly distinguishable from primary and secondary
  actions
- use typed confirmation or dedicated confirmation dialogs for irreversible or
  broad-impact actions
- do not hide destructive actions behind ambiguous labels

### Dismiss action

Use for leaving a surface without taking the main action.

Examples:

- `Cancel`
- `Close`

Rules:

- dismissal labels must reflect the surface semantics
- do not casually swap `Cancel` and `Close`

## Cancel Versus Close

This distinction should be explicit.

### Use `Cancel` when

- the user is abandoning an in-progress edit
- the surface contains draft changes, selections, or data-entry intent
- dismissing the surface means “do not apply this”

### Use `Close` when

- the surface is informational or read-only
- the surface applies changes live and the user is only dismissing the current
  control surface
- no editable draft is being abandoned
- the user is merely dismissing a view

### Preferred rule for Monies Map

If a surface can change data, prefer `Cancel`.

If a surface only shows information, prefer `Close`.

## Responsive Consistency

Desktop and mobile may use different containers, but they should preserve the
same action semantics.

Examples:

- desktop dialog `Cancel` should not become mobile `Close` if both dismiss an
  unsaved draft
- desktop inline `Save` should correspond to mobile sheet `Save`
- a destructive desktop action should remain visually destructive on mobile

## Filter And Search Surface Semantics

Filter bars and filter sheets need their own rule because they mix navigation,
live filtering, and optional text input.

### Live filters

If a filter surface applies changes immediately as the user taps or selects,
then the footer or header dismiss action should be `Close`, not `Done`.

Examples:

- switching Entries scope
- changing wallet/category/type filters
- opening or dismissing a mobile filter sheet

Rules:

- live filter changes should not auto-close the containing sheet unless the
  user selected a navigation destination
- a dismiss action on a live filter surface means "hide this panel", not "apply
  changes"
- do not label that dismiss action `Done` if there is no pending staged change

### Staged filters

If a filter surface intentionally stages changes and only applies them after a
  confirmation step, then use an explicit commit action such as `Apply`.

Rules:

- use `Apply` for staged filter changes
- keep `Cancel` for abandoning staged, unsaved changes
- avoid mixing staged and live controls in the same sheet unless the split is
  visually obvious

### Search inside filter surfaces

Search is not the same action as dismissing the sheet.

Preferred rule:

- desktop Entries search lives directly in the filter bar
- mobile Entries search lives inside the filter sheet near the top of the
  filter controls
- the keyboard action can be `Search`
- the sheet dismiss action remains `Close`

This avoids the collision where a single `Done` label tries to mean both
"dismiss the sheet" and "run the search".

The same principle applies to split-linking surfaces. If the user is linking a
manual split to a later bank row, the surface should expose search and filters
without conflating them with dismissal. Reuse the existing matching vocabulary
from split review and import preview rather than inventing a new one.

## Button Inventory Model

When reviewing or refactoring a surface, classify every visible action as one
of:

- `Primary`
- `Secondary`
- `Tertiary`
- `Danger`
- `Dismiss`
- `Navigation`

`Navigation` is for actions that mainly move the user elsewhere.

Examples:

- `Open month`
- `View split`
- `View entry`

## Visual-System Guidance

Even before choosing a UI library, the repo should converge on:

- one primary button style
- one secondary button style
- one subtle/tertiary style
- one danger style
- one dismiss style
- one consistent corner-radius scale
- one consistent disabled-state treatment

## Destructive Safeguards

Use stronger safeguards when the blast radius is larger.

### Lightweight confirm

Use for:

- deleting a single row
- removing a small local item

### Dialog confirm

Use for:

- deleting or resetting month-wide data
- rolling back imports
- actions that affect downstream derived data

### Typed confirm

Use for:

- high-risk or broad-scope destructive actions
- actions that may remove or rewrite significant household data

## Current Cleanup Targets

These areas likely need normalization during implementation:

- row-level inline save/cancel button styles
- mobile sheet close/cancel semantics
- dialog header close icon versus footer cancel button roles
- destructive confirmation actions in month, settings, imports, and splits
- subtle-action overuse where some actions should really be primary or danger

## Relationship To Future UI Library Choice

If a UI library is introduced later:

- the library should serve the interaction model in this document
- do not let a library's default button taxonomy dictate the product semantics
- prefer thin wrappers that encode Monies Map intent categories

The likely future shape is:

- a small design-system layer with app-specific button components
- each wrapper encoding intent such as `PrimaryButton`, `DangerButton`, or
  `DismissButton`

That can happen later. It is not required to finish the planning stages.
