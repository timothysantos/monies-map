# Codex Prompt: Mutation Interaction Standardization Follow-Up

Use this prompt to continue the mutation interaction standardization work after the fifteenth slice and the mutation-interaction hardening pass.

This is not a new architecture refactor. It is a focused implementation pass to address the remaining UX consistency risks identified in the audit.

## Context

The previous work introduced:

- import commit pending/loading behavior
- recent-import scoped refresh feedback
- inline completion confirmation
- month note pending/error handling on desktop and mobile
- settings category-rule dialog submit semantics
- runtime regression tests for import, month, and settings mutation behavior
- interaction-guideline rules that prefer local mutation feedback over global loading indicators

The audit identified the next risk:

```txt
mutation feedback is improving, but the contract is still emerging implicitly through examples
```

This pass should make the app’s mutation interaction behavior more explicit, consistent, and test-backed without introducing global loading orchestration.

## Primary Goal

Standardize mutation interaction semantics across stable workflows.

The goal is to make user-triggered mutations feel:

- immediate
- local
- predictable
- non-destructive
- mobile-safe
- consistent across workflows

When the user clicks Save, Update, Delete, Restore, Split, Import, Certify, or similar, the app should clearly show:

- the action was received
- the mutation is pending
- duplicate submits are prevented
- the current workflow context is preserved
- success or failure is visible near the interaction
- background refresh does not destroy active state

## Non-Goals

Do not:

- introduce a global mutation manager
- introduce a global loading overlay
- introduce a top-level loading bar package
- move loading orchestration into `App.jsx`
- widen query invalidation
- reinterpret accounting/import/split/product semantics
- rebuild the app shell
- refactor unrelated workflows without runtime proof
- use route-level loading for local save/edit/delete actions
- hide mutation state behind full-page reloads
- silently change existing successful workflows without tests

## Required Implementation Direction

Prefer local workflow-owned mutation behavior.

Use:

- button-level pending states
- disabled action buttons while pending
- inline spinner or short pending label
- inline success/error feedback
- scoped section refresh indicators
- stale-visible content where safe
- non-destructive background refreshes

Avoid:

- full-page spinners
- route resets
- shell loading
- app-wide blocking overlays
- clearing visible content during background refresh
- closing mobile sheets during mutation
- losing keyboard or scroll context

## Mutation Interaction Contract

For every workflow touched in this pass, verify the following contract.

### 1. Pending State

The clicked action must:

- enter pending state immediately
- become disabled during the mutation
- prevent duplicate submit
- remain visible
- preserve layout stability
- preserve scroll position
- remain usable on mobile

Examples of acceptable labels:

- Saving...
- Updating...
- Working...
- Deleting...
- Restoring...
- Importing...

Use the existing app loading language and styling where possible.

### 2. Completion State

On success:

- update the affected visible state
- show inline confirmation where the workflow needs reassurance
- avoid unnecessary page refresh
- avoid resetting active workflow state

### 3. Failure State

On failure:

- show inline error near the workflow context
- preserve the user’s entered values
- preserve the current dialog/sheet/editor
- allow retry
- do not rely only on console errors

### 4. Scoped Refresh

When nearby data refreshes after mutation:

- refresh only the affected section/query family
- keep stale content visible when safe
- avoid blanking unrelated page content
- avoid route/app-shell loading
- avoid broad invalidation

### 5. Mobile Continuity

On mobile, verify:

- sheet continuity
- keyboard continuity where relevant
- scroll continuity
- visible pending state
- stable tap targets
- no destructive layout jump
- confirmation/error feedback is not hidden off-screen

Desktop and mobile can have different layout presentation, but the mutation semantics must be equivalent.

## Target Workflows

Audit and harden only stable workflows with existing query ownership.

Prioritize:

- entry save/edit
- split save/edit/delete
- month note save
- month plan row save
- settings CRUD dialogs/forms
- import final commit
- import restore/delete/certify confirmation flows
- summary note save if it shares the same note behavior

Do not broaden into unstable or unrelated areas unless the audit finds a clear mutation-feedback bug and adds runtime proof.

## Important Current Concern

The implementation is improving through individual examples, but the app still risks inconsistent mutation semantics.

Look for:

- save actions that still silently save
- buttons that do not disable during mutation
- duplicate-submit risk
- spinner-only behavior without accessible label
- workflows that reset or close during background refresh
- mobile sheets that collapse during mutation
- errors that are not visible near the failed workflow
- inconsistent success/error placement
- route or shell loading triggered by local mutations

## Suggested Implementation Shape

Before adding new abstraction, inspect existing patterns.

If duplication appears, consider small reusable primitives such as:

- a pending button helper/component
- shared mutation feedback copy
- inline mutation status helper
- scoped refresh indicator pattern

But do not create a global mutation orchestration layer.

The desired abstraction is:

```txt
shared interaction primitive
```

not:

```txt
global loading manager
```

Keep ownership local to the workflow.

## Test Requirements

Build success alone is not enough.

Add or update runtime tests for every workflow changed.

Tests should prove:

### Pending Behavior

- action shows pending state immediately
- button is disabled while pending
- duplicate submit is prevented
- pending state is visible on desktop
- pending state is visible on mobile where applicable

### Continuity Behavior

- active editor/dialog/sheet remains open during mutation
- user-entered values are preserved on failure
- stale content remains visible during safe refresh
- scroll position does not jump destructively
- mobile sheet does not collapse during mutation

### Success/Error Behavior

- success feedback appears where needed
- inline error appears on failure
- retry remains possible after failure
- workflow context is preserved

### Loading Boundary Behavior

- route-level loading is not triggered for local mutation
- app-shell loading is not triggered for local mutation
- unrelated query families are not invalidated
- unrelated page content is not blanked

## Runtime Verification

Run:

- `npm run build`
- targeted Playwright tests for each changed workflow
- relevant mobile Playwright scenario where workflow has mobile layout
- `npm run test:e2e:smoke` if available

If the full smoke bundle does not pass, the audit must clearly state:

- which test failed
- whether the failure is related to this pass
- why the targeted runtime proof is still sufficient or not sufficient

Do not claim full closure if smoke fails from an untriaged related failure.

## Required Audit Before Completion

Do not mark this pass complete until the audit answers all of the following.

### Scope

1. Which mutation workflows were touched?
2. Which workflows were intentionally left unchanged?
3. Did the pass stay within local mutation-feedback behavior?

### Pending-State Contract

4. Do touched actions show pending state immediately?
5. Are touched action buttons disabled while pending?
6. Is duplicate submit prevented?
7. Is pending feedback visible on both desktop and mobile where applicable?

### Completion And Failure

8. Is success feedback visible where the workflow needs reassurance?
9. Are failures shown inline near the workflow context?
10. Are entered values preserved after failure?
11. Is retry possible after failure?

### Refresh And State Safety

12. Did nearby sections refresh without destructive resets?
13. Did stale content remain visible where safe?
14. Did active editing survive background refresh?
15. Did the implementation avoid route-level loading for local mutations?
16. Did the implementation avoid shell/app-level loading for local mutations?

### Mobile

17. Did mobile sheets remain open where expected?
18. Did keyboard and scroll continuity remain stable where relevant?
19. Did pending/error/success feedback remain visible on mobile?

### Architecture

20. Was any global loading manager introduced?
21. Was any loading/progress package added?
22. Was any invalidation widened?
23. Was any loading ownership moved into `App.jsx`?
24. Were any product semantics changed?

### Verification

25. Which tests were added or updated?
26. Which targeted tests passed?
27. Did `npm run build` pass?
28. Did smoke pass? If not, is the failure related or unrelated?
29. What remains inconsistent?
30. Is the final verdict honest?

## Completion Standard

This pass can be considered complete only when:

- touched workflows follow the local mutation-feedback contract
- runtime tests prove the changed interaction paths
- mobile behavior is verified where relevant
- no global loading orchestration was introduced
- no product semantics were changed
- the audit honestly lists any remaining inconsistencies

The intended outcome is not “every workflow in the app is perfect forever.”

The intended outcome is:

```txt
stable, test-backed mutation interaction semantics for the workflows touched in this pass,
with clear remaining gaps documented for future targeted work.
```
