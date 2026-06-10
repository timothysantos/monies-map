import { queryKeys } from "./query-keys.js";
import { buildRequestErrorMessage } from "./request-errors.js";

function getSummaryPageKeyFromParams(params) {
  return queryKeys.summaryPage({
    viewId: params.get("view") ?? "household",
    month: params.get("month") ?? "",
    scope: params.get("scope") ?? "direct_plus_shared",
    startMonth: params.get("summary_start") ?? "",
    endMonth: params.get("summary_end") ?? ""
  });
}

function getSummaryAccountPillsKeyFromParams(params) {
  return queryKeys.summaryAccountPills({
    viewId: params.get("view") ?? "household"
  });
}

export function buildSummaryPageParams({
  viewId,
  month,
  scope,
  summaryStart,
  summaryEnd
}) {
  const params = new URLSearchParams({
    view: viewId,
    month,
    scope
  });

  if (summaryStart) {
    params.set("summary_start", summaryStart);
  }

  if (summaryEnd) {
    params.set("summary_end", summaryEnd);
  }

  return params;
}

export function buildSummaryAccountPillsParams({ viewId }) {
  return new URLSearchParams({ view: viewId });
}

async function fetchSummaryJson(queryClient, {
  params,
  queryKey,
  path,
  bypassCache = false,
  signal
}) {
  if (signal?.aborted) {
    throw new DOMException("Summary request aborted.", "AbortError");
  }

  if (!bypassCache) {
    const cachedData = queryClient.getQueryData(queryKey);
    if (cachedData) {
      return cachedData;
    }
  }

  const fetcher = async () => {
    const response = await fetch(`${path}?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await buildRequestErrorMessage(response, `${path} failed.`));
    }
    return response.json();
  };

  const data = bypassCache
    ? await queryClient.fetchQuery({
        queryKey,
        queryFn: fetcher,
        staleTime: 0
      })
    : await queryClient.ensureQueryData({
        queryKey,
        queryFn: fetcher,
        revalidateIfStale: true
      });

  if (signal?.aborted) {
    throw new DOMException("Summary request aborted.", "AbortError");
  }

  return data;
}

export async function fetchSummaryPageQuery(queryClient, params, options = {}) {
  return fetchSummaryJson(queryClient, {
    ...options,
    params,
    path: "/api/summary-page",
    queryKey: getSummaryPageKeyFromParams(params)
  });
}

export async function fetchSummaryAccountPillsQuery(queryClient, params, options = {}) {
  return fetchSummaryJson(queryClient, {
    ...options,
    params,
    path: "/api/summary-account-pills",
    queryKey: getSummaryAccountPillsKeyFromParams(params)
  });
}

export function buildSummaryPageView({
  appShell,
  selectedViewId,
  summaryPageData,
  summaryAccountPillsData
}) {
  if (!appShell || !summaryPageData) {
    return null;
  }

  const fallbackLabel = selectedViewId === "household"
    ? "Household"
    : appShell.household?.people?.find((person) => person.id === selectedViewId)?.name ?? "Household";

  return {
    id: summaryPageData.viewId ?? selectedViewId ?? "household",
    label: summaryPageData.label ?? fallbackLabel,
    summaryPage: {
      ...summaryPageData.summaryPage,
      accountPills: summaryAccountPillsData?.accountPills ?? []
    }
  };
}
