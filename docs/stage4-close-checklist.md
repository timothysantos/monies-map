# Stage 4 Close Checklist

Use this checklist only when deciding whether Stage 4 can be called closed.

## Must-Have Conditions

- Full serial smoke bundle passes.
- `App.jsx` does not gain new business or workflow ownership.
- Shared invalidation helpers stay narrow.
- Explicit shell refresh is rare, named, and justified.
- Each major slice owns its query and mutation boundary.
- No old broad refresh paths remain as fallback behavior.
- Docs reflect the current architecture, not the old migration plan.

## Required Proof

- query-boundary tests pass
- slice refresh-plan tests pass
- relevant runtime smoke tests pass
- flow docs exist for the parent flow and each major page
- every flow doc includes route flow, state flow, data flow, and a known
  exceptions / watch areas section
- audits name the remaining watch areas honestly

## Stop Conditions

Do not call Stage 4 closed if any of the following is true:

- `App.jsx` has absorbed new workflow logic
- a shared helper has become a broad refresh coordinator
- a shell refresh path is becoming the default escape hatch
- a flow doc describes behavior that the current tests no longer prove
- the smoke bundle is red or order-sensitive again

## Final Closure Note

Stage 4 is closed only when the checklist items above are true together, not
when any one of them is true by itself.

