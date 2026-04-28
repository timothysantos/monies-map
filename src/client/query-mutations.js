import { queryKeys } from "./query-keys";

async function cancelAndInvalidate(queryClient, queryKey) {
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
}

export async function invalidateBootstrapQueries(queryClient, params) {
  await cancelAndInvalidate(queryClient, queryKeys.bootstrap(params));
}

export async function invalidateRoutePageQueries(queryClient, request) {
  await cancelAndInvalidate(queryClient, queryKeys.routePage(request));
}

export async function invalidateEntriesPageQueries(queryClient, params) {
  await cancelAndInvalidate(queryClient, queryKeys.entriesPage(params));
}

export async function invalidateMonthQueries(queryClient, { viewId, month, scope }) {
  await Promise.all([
    cancelAndInvalidate(queryClient, queryKeys.monthPage({ viewId, month, scope })),
    queryClient.invalidateQueries({ queryKey: ["route-page"] }),
    queryClient.invalidateQueries({ queryKey: ["entries-page"] }),
    queryClient.invalidateQueries({ queryKey: ["summary-page"] })
  ]);
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
  } else {
    tasks.push(queryClient.invalidateQueries({ queryKey: ["entries-page"] }));
  }

  tasks.push(queryClient.invalidateQueries({ queryKey: ["route-page"] }));

  if (monthKey && viewId) {
    tasks.push(queryClient.invalidateQueries({
      queryKey: queryKeys.monthPage({ viewId, month: monthKey, scope })
    }));
  }

  if (summaryRange && viewId) {
    tasks.push(queryClient.invalidateQueries({
      queryKey: queryKeys.summaryPage({
        viewId,
        startMonth: summaryRange.startMonth,
        endMonth: summaryRange.endMonth
      })
    }));
  } else {
    tasks.push(queryClient.invalidateQueries({ queryKey: ["summary-page"] }));
  }

  await Promise.all(tasks);
}
