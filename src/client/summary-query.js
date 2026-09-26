import { buildPersonScopes, effectiveScopeForView } from "../domain/person-view-scope";
import { queryKeys, summaryPageKeyFromParams } from "./query-keys.js";
import { fetchQueryWithLease } from "./query-leases.js";
import { buildRequestErrorMessage } from "./request-errors.js";
import { fetchWithTimeout } from "./request-timeout.js";

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

function fetchSummaryJson(queryClient, {
  params,
  queryKey,
  path,
  bypassCache = false,
  signal = undefined
}) {
  return fetchQueryWithLease(queryClient, {
    queryKey,
    bypassCache,
    signal,
    abortMessage: "Summary request aborted.",
    fetcher: async ({ signal: requestSignal }) => {
      const response = await fetchWithTimeout(`${path}?${params.toString()}`, {
        cache: "no-store",
        signal: requestSignal
      }, "Summary request");
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, `${path} failed.`));
      }
      return response.json();
    }
  });
}

export async function fetchSummaryPageQuery(queryClient, params, options = {}) {
  return fetchSummaryJson(queryClient, {
    ...options,
    params,
    path: "/api/summary-page",
    queryKey: summaryPageKeyFromParams(params)
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
  summaryAccountPillsData,
  summaryPageDataRequestKey = ""
}) {
  if (!appShell || !summaryPageData) {
    return null;
  }

  const fallbackLabel = selectedViewId === "household"
    ? "Household"
    : appShell.household?.people?.find((person) => person.id === selectedViewId)?.name ?? "Household";

  const id = summaryPageData.viewId ?? selectedViewId ?? "household";
  return {
    id,
    label: summaryPageData.label ?? fallbackLabel,
    // The scope of the request these figures answer, not the route's latest
    // one, so the scope control never runs ahead of the figures it labels.
    selectedScope: effectiveScopeForView(id, new URLSearchParams(summaryPageDataRequestKey).get("scope")),
    scopes: buildPersonScopes(id),
    summaryPage: {
      ...summaryPageData.summaryPage,
      accountPills: summaryAccountPillsData?.accountPills ?? []
    }
  };
}
