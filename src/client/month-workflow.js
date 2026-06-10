export function buildMonthMutationRefreshPlan({
  kind,
  affectsEntries = false,
  affectsSplits = false,
  affectsSummary = false,
  refreshShell = false
}) {
  if (kind === "filter-only" || kind === "mobile-sheet") {
    return {
      invalidateEntries: false,
      invalidateMonth: false,
      invalidateSplits: false,
      invalidateSummary: false,
      refreshShell: false
    };
  }

  if (kind === "note-save") {
    return {
      invalidateEntries: false,
      invalidateMonth: true,
      invalidateSplits: false,
      invalidateSummary: affectsSummary,
      refreshShell: false
    };
  }

  if (kind === "plan-row-edit") {
    return {
      invalidateEntries: false,
      invalidateMonth: true,
      invalidateSplits: false,
      invalidateSummary: true,
      refreshShell: false
    };
  }

  if (kind === "plan-link-save") {
    return {
      invalidateEntries: affectsEntries,
      invalidateMonth: true,
      invalidateSplits: affectsSplits,
      invalidateSummary: affectsSummary,
      refreshShell: false
    };
  }

  if (kind === "drilldown-return-entries") {
    return {
      invalidateEntries: true,
      invalidateMonth: true,
      invalidateSplits: false,
      invalidateSummary: false,
      refreshShell: false
    };
  }

  if (kind === "drilldown-return-splits") {
    return {
      invalidateEntries: false,
      invalidateMonth: true,
      invalidateSplits: true,
      invalidateSummary: false,
      refreshShell: false
    };
  }

  return {
    invalidateEntries: affectsEntries,
    invalidateMonth: true,
    invalidateSplits: affectsSplits,
    invalidateSummary: affectsSummary,
    refreshShell: Boolean(refreshShell)
  };
}
