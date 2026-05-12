// Imports can create shared account metadata while the user is still in the
// workflow, so account creation needs a shell-level refresh rather than just a
// slice invalidation.
export function buildImportAccountCreationRefreshPlan() {
  return { refreshShell: true };
}
