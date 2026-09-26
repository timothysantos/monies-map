import { queryKeys } from "./query-keys.js";

async function cancelAndInvalidate(queryClient, queryKey) {
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
}

// Route pages are served from any cached copy, stale or not, so a family
// that must be read fresh on its next visit is removed.
async function cancelAndRemove(queryClient, queryKey) {
  await queryClient.cancelQueries({ queryKey });
  queryClient.removeQueries({ queryKey });
}

export async function invalidateAppShellQueries(queryClient, params = {}) {
  await cancelAndInvalidate(queryClient, queryKeys.appShell(params));
}

export async function invalidateRoutePageQueries(queryClient, request) {
  await cancelAndInvalidate(queryClient, queryKeys.routePage(request));
}

export async function invalidateEntriesPageQueries(queryClient, params) {
  await cancelAndInvalidate(queryClient, queryKeys.entriesPage(params));
}

export async function invalidateSplitsPageQueries(queryClient, params) {
  await cancelAndInvalidate(queryClient, queryKeys.splitsPage(params));
}

export async function invalidateSummaryPageQueries(queryClient, params) {
  await cancelAndInvalidate(queryClient, queryKeys.summaryPage(params));
}

export async function invalidateSummaryAccountPillQueries(queryClient, params) {
  await cancelAndInvalidate(queryClient, queryKeys.summaryAccountPills(params));
}

export async function invalidateImportsPageQueries(queryClient) {
  await cancelAndInvalidate(queryClient, queryKeys.importsPage());
}

export async function invalidateMonthQueries(queryClient, {
  invalidateSummaryAccountPills = false,
  entriesParams = undefined,
  month,
  scope,
  summaryRange,
  viewId
}) {
  const tasks = [cancelAndInvalidate(queryClient, queryKeys.monthPage({ viewId, month, scope }))];

  if (entriesParams) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.entriesPage(entriesParams)));
  }

  if (summaryRange) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.summaryPage({
      viewId,
      month: summaryRange.endMonth,
      scope,
      startMonth: summaryRange.startMonth,
      endMonth: summaryRange.endMonth
    })));
  }

  if (invalidateSummaryAccountPills && viewId) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.summaryAccountPills({ viewId })));
  }

  await Promise.all(tasks);
}

export async function invalidateEntriesMutationQueries(queryClient, {
  invalidateSummaryAccountPills = false,
  entriesParams,
  monthKey,
  scope,
  viewId,
  summaryRange
}) {
  const tasks = [];

  if (entriesParams) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.entriesPage(entriesParams)));
  }

  if (monthKey && viewId) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.monthPage({ viewId, month: monthKey, scope })));
  }

  if (summaryRange && viewId) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.summaryPage({
      viewId,
      month: summaryRange.endMonth,
      scope,
      startMonth: summaryRange.startMonth,
      endMonth: summaryRange.endMonth
    })));
  }

  if (invalidateSummaryAccountPills && viewId) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.summaryAccountPills({ viewId })));
  }

  await Promise.all(tasks);
}

export async function invalidateImportMutationQueries(queryClient, {
  invalidateSummaryAccountPills = false,
  invalidateSplits = false,
  entriesParams,
  monthKeys = [],
  scope,
  summaryRange,
  viewId
}) {
  const tasks = [cancelAndInvalidate(queryClient, queryKeys.importsPage())];

  // A rollback can unlink a split from a removed entry or move a linked
  // split with its restored entry, in any month or view.
  if (invalidateSplits) {
    tasks.push(cancelAndRemove(queryClient, ["splits-page"]));
  }

  if (entriesParams) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.entriesPage(entriesParams)));
  }

  for (const month of monthKeys) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.monthPage({ viewId, month, scope })));
  }

  if (summaryRange && viewId) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.summaryPage({
      viewId,
      month: summaryRange.endMonth,
      scope,
      startMonth: summaryRange.startMonth,
      endMonth: summaryRange.endMonth
    })));
  }

  if (invalidateSummaryAccountPills && viewId) {
    tasks.push(cancelAndInvalidate(queryClient, queryKeys.summaryAccountPills({ viewId })));
  }

  await Promise.all(tasks);
}
