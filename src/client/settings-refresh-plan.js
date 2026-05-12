export const SETTINGS_ROUTE_REQUEST = Object.freeze({
  path: "/api/settings-page",
  params: new URLSearchParams()
});

const SETTINGS_ROUTE_PAGE_TARGETS = Object.freeze({
  entries: "/api/entries-page",
  imports: "/api/imports-page",
  month: "/api/month-page",
  splits: "/api/splits-page"
});

const SETTINGS_ONLY_PLAN = Object.freeze({
  refreshShell: false,
  invalidateEntries: false,
  invalidateImports: false,
  invalidateMonth: false,
  invalidateSplits: false,
  invalidateSummary: false
});

const REFERENCE_DATA_PLAN = Object.freeze({
  refreshShell: true,
  invalidateEntries: true,
  invalidateImports: false,
  invalidateMonth: true,
  invalidateSplits: true,
  invalidateSummary: true
});

const CATEGORY_RULE_PLAN = Object.freeze({
  refreshShell: false,
  invalidateEntries: false,
  invalidateImports: true,
  invalidateMonth: false,
  invalidateSplits: false,
  invalidateSummary: false
});

const DEMO_RESET_PLAN = Object.freeze({
  refreshShell: true,
  invalidateEntries: true,
  invalidateImports: true,
  invalidateMonth: true,
  invalidateSplits: true,
  invalidateSummary: true
});

// Settings mutations use named refresh plans so invalidation stays explicit and
// the panel does not decide cache-burst behavior inline.
export function buildSettingsRefreshPlan(kind) {
  if (
    kind === "person_saved"
    || kind === "account_saved"
    || kind === "account_archived"
    || kind === "category_saved"
    || kind === "category_deleted"
  ) {
    return REFERENCE_DATA_PLAN;
  }

  if (
    kind === "category_rule_saved"
    || kind === "category_rule_deleted"
    || kind === "category_rule_suggestion_accepted"
    || kind === "category_rule_suggestion_ignored"
  ) {
    return CATEGORY_RULE_PLAN;
  }

  if (
    kind === "checkpoint_saved"
    || kind === "checkpoint_deleted"
    || kind === "unresolved_transfer_dismissed"
    || kind === "unresolved_transfer_dismissed_all"
    || kind === "reconciliation_exception_created"
    || kind === "reconciliation_exception_resolved"
    || kind === "statement_compare_linked"
    || kind === "statement_compare_entry_added"
  ) {
    return SETTINGS_ONLY_PLAN;
  }

  if (kind === "demo_reseed" || kind === "demo_empty_state") {
    return DEMO_RESET_PLAN;
  }

  throw new Error(`Unknown settings refresh plan: ${kind}`);
}

// Convert the slice-level refresh flags into the concrete route-page families
// that must be cleared. App executes this shape without owning the mapping.
export function describeSettingsRefreshPlan(plan = SETTINGS_ONLY_PLAN) {
  const routePagePaths = [];

  if (plan.invalidateEntries) {
    routePagePaths.push(SETTINGS_ROUTE_PAGE_TARGETS.entries);
  }

  if (plan.invalidateImports) {
    routePagePaths.push(SETTINGS_ROUTE_PAGE_TARGETS.imports);
  }

  if (plan.invalidateMonth) {
    routePagePaths.push(SETTINGS_ROUTE_PAGE_TARGETS.month);
  }

  if (plan.invalidateSplits) {
    routePagePaths.push(SETTINGS_ROUTE_PAGE_TARGETS.splits);
  }

  return {
    routeRequest: SETTINGS_ROUTE_REQUEST,
    routePagePaths,
    clearEntriesPageCache: plan.invalidateEntries,
    invalidateImportsPage: plan.invalidateImports,
    invalidateSummaryAccountPills: plan.invalidateSummary,
    invalidateSummaryPage: plan.invalidateSummary,
    refreshShell: Boolean(plan.refreshShell)
  };
}
