// What App runs after a settings change: the settings page request and the
// route-page families a refresh plan clears. App ships with the first screen,
// so this half stays small; the named plans themselves are in
// settings-refresh-plan.js, which only the Settings route (a lazy chunk) needs.
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

// Convert the slice-level refresh flags into the concrete route-page families
// that must be cleared. App executes this shape without owning the mapping.
// No plan clears nothing (the settings-only plan).
/** @param {Partial<Record<"refreshShell" | "refreshReferenceData" | "invalidateEntries" | "invalidateImports" | "invalidateMonth" | "invalidateSplits" | "invalidateSummary", boolean>>} [plan] */
export function describeSettingsRefreshPlan(plan = {}) {
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
    clearEntriesPageCache: Boolean(plan.invalidateEntries),
    invalidateImportsPage: Boolean(plan.invalidateImports),
    invalidateSummaryAccountPills: Boolean(plan.invalidateSummary),
    invalidateSummaryPage: Boolean(plan.invalidateSummary),
    refreshShell: Boolean(plan.refreshShell),
    refreshReferenceData: Boolean(plan.refreshReferenceData)
  };
}
