import { queryKeys } from "./query-keys.js";

async function cancelAndInvalidate(queryClient, queryKey) {
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
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

export async function invalidateMonthQueries(queryClient, {
  entriesParams,
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
      startMonth: summaryRange.startMonth,
      endMonth: summaryRange.endMonth
    })));
  }

  await Promise.all(tasks);
}

export async function invalidateEntriesMutationQueries(queryClient, {
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
      startMonth: summaryRange.startMonth,
      endMonth: summaryRange.endMonth
    })));
  }

  await Promise.all(tasks);
}
