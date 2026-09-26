import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Receipt,
  Plus
} from "lucide-react";
import {
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";
import {
  broadcastAppShellRefresh,
  buildEntryMutationSyncEvent,
  buildSummaryMutationSyncEvent,
  buildSplitMutationSyncEvent,
  isMonthWithinRange,
  publishAppSyncEvent
} from "./app-sync";
import { messages } from "./copy/en-SG";
import {
  buildAppShellParams,
  buildEntriesShellParams,
  clearPersistedAppShell,
  readPersistedAppShell,
  writePersistedAppShell
} from "./app-shell-query";
import {
  buildEntriesPageParams,
  buildPageViewFromRouteData,
  buildRoutePageRequest,
  getAppShellAvailableViewIds,
  getSelectedTabId,
  resolveRouteViewId,
  sanitizeTabParams
} from "./app-routing";
import {
  AppLoadingOverlay,
  EnvironmentBanner,
  RouteChunkLoadingFallback,
  ShellErrorScreen,
  ShellLoadingScreen
} from "./app-shell-status";
import { ScreenErrorBoundary } from "./screen-error-boundary";
import { ErrorPanel } from "./ui-states";
import { ShellRouteTabs } from "./app-shell-navigation";
import { PeriodMonthPicker } from "./app-shell-period-pickers";
import { LoginRegistrationDialog } from "./login-registration-dialog";
import { slugify } from "./category-utils";
import { formatMonthLabel } from "./formatters";
import { TotalsVisibilityToggle, useMoneyPrivacy } from "./money-privacy";
import {
  buildAppShellErrorMessage,
  buildRequestErrorMessage,
  describeAppShellError,
  isAppShellResourceLimitError
} from "./request-errors";
import { fetchTextWithTransientWorkerRetry } from "./request-timeout";
import { installMobileFocusVisibility } from "./mobile-focus-visibility";
import { queryKeys } from "./query-keys";
import { fetchQueryWithLease } from "./query-leases";
import { loadRouteModule } from "./route-modules";
import { useAppShellState } from "./use-app-shell-state";
import { useAppSyncSubscription } from "./use-app-sync-subscription";
import { useReferenceData } from "./use-reference-data";
import { useRefreshNotice } from "./use-refresh-notice";
import { useRouteData } from "./use-route-data";
import { useSummaryData } from "./use-summary-data";
import { useRouteWarmup } from "./use-route-warmup";
import {
  buildRouteIdentity,
  buildRouteWorkKey,
  createRequiredWorkCounter,
  createRouteWorkRegistry,
  deriveRouteWork,
  withRequiredWork
} from "./route-work-status";
import {
  RouteWorkProvider,
  useRequiredWorkCount,
  useRouteWorkSnapshot
} from "./use-route-work-status";
import {
  invalidateImportMutationQueries,
  invalidateEntriesMutationQueries,
  invalidateImportsPageQueries,
  invalidateMonthQueries
} from "./query-mutations";
import { describeSettingsRefreshPlan, SETTINGS_ROUTE_REQUEST } from "./settings-refresh-plan";
import {
  buildSummaryAccountPillsParams,
  buildSummaryPageParams,
  buildSummaryPageView,
  fetchSummaryAccountPillsQuery,
  fetchSummaryPageQuery
} from "./summary-query";
import { buildSummaryMutationRefreshPlan } from "./summary-workflow";
import { getCurrentMonthKey } from "../lib/month";

const EntriesPanel = lazy(() => loadRouteModule("entries").then((module) => ({ default: module.EntriesPanel })));
const EntriesFilterStack = lazy(() => import("./entries-filter-stack.jsx").then((module) => ({ default: module.EntriesFilterStack })));
const FaqPanel = lazy(() => loadRouteModule("faq").then((module) => ({ default: module.FaqPanel })));
const ImportsPanel = lazy(() => loadRouteModule("imports").then((module) => ({ default: module.ImportsPanel })));
const MonthPanel = lazy(() => loadRouteModule("month").then((module) => ({ default: module.MonthPanel })));
const SettingsPanel = lazy(() => loadRouteModule("settings").then((module) => ({ default: module.SettingsPanel })));
const SplitsPanel = lazy(() => loadRouteModule("splits").then((module) => ({ default: module.SplitsPanel })));
const SummaryPanel = lazy(() => loadRouteModule("summary").then((module) => ({ default: module.SummaryPanel })));

// Shared UI constants used by the month and summary pickers.
const SUMMARY_FOCUS_OVERALL = "overall";
// Canonical route registry for the top navigation and route-based prefetching.
const routeTabs = [
  { id: "summary", path: "/summary", label: messages.tabs.summary },
  { id: "month", path: "/month", label: messages.tabs.month },
  { id: "entries", path: "/entries", label: messages.tabs.entries },
  { id: "splits", path: "/splits", label: messages.tabs.splits },
  { id: "imports", path: "/imports", label: messages.tabs.imports },
  { id: "settings", path: "/settings", label: messages.tabs.settings },
  { id: "faq", path: "/faq", label: messages.tabs.faq }
];
// Split the tabs so the primary shell keeps the highest-frequency routes in view.
const primaryRouteTabs = routeTabs.slice(0, 4);
const secondaryRouteTabs = routeTabs.slice(4);
const APP_DOCUMENT_TITLE = "Monie's Map";
const LOADING_STATUS_POLL_MS = 500;
function createLoadingStatus(overrides = {}) {
  const now = Date.now();
  return {
    label: "Starting app",
    detail: "Preparing dashboard shell",
    percent: 5,
    startedAt: now,
    updatedAt: now,
    issue: "",
    ...overrides
  };
}

function describeRoutePageContractError(tabId) {
  return `The ${tabId} page response did not include the data needed to render this screen.`;
}

function getRoutePageRequestKey(request) {
  if (!request) {
    return "";
  }

  const query = request.params.toString();
  return query ? `${request.path}?${query}` : request.path;
}

// Detect the current runtime so the shell can label local/demo builds without
// relying on environment variables inside the client bundle.
function getClientAppEnvironment() {
  if (typeof window === "undefined") {
    return "production";
  }

  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "local";
  }
  if (hostname.includes("demo")) {
    return "demo";
  }
  return "production";
}

// Keep the browser title aligned with the active environment.
function getDocumentTitle(environment) {
  if (environment === "demo" || environment === "local") {
    return `${APP_DOCUMENT_TITLE} - ${environment}`;
  }
  return APP_DOCUMENT_TITLE;
}

// Shorten inactive person pills so the shell chrome stays compact.
function getInactivePersonViewLabel(name) {
  const trimmedName = name.trim();
  const firstName = trimmedName.split(/\s+/)[0] ?? trimmedName;
  if (firstName.length <= 10) {
    return firstName;
  }
  return `${firstName.slice(0, 9)}...`;
}

export function App() {
  // Plain text currency labels use the shared formatter, so the shell also
  // observes privacy changes and redraws the active route without resetting it.
  useMoneyPrivacy();
  // App-level shell state and caches live here; everything below derives the
  // active route from that data instead of maintaining a second store.
  const queryClient = useQueryClient();
  const { appShell, appShellError, appShellOwner } = useAppShellState();
  const [appShellLoadCount, setAppShellLoadCount] = useState(0);
  // Loading state is separate from shell state so route and shell fetches can
  // report progress without mutating the active payloads.
  const [loadingStatus, setLoadingStatus] = useState(() => createLoadingStatus());
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  // Mobile context state only controls the sheet chrome around the current
  // route, not the route payload itself.
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [entriesMobileFilterProps, setEntriesMobileFilterProps] = useState(null);
  // The entries filter stack mirrors route state but only updates when the
  // effective filter props actually change.
  const closeMobileContext = useCallback(() => {
    setMobileContextOpen(false);
  }, []);
  const handleEntriesMobileFilterStateChange = useCallback((nextProps) => {
    setEntriesMobileFilterProps((current) => areEntriesMobileFilterPropsEqual(current, nextProps) ? current : nextProps);
  }, []);
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [rangePickerStartYear, setRangePickerStartYear] = useState(null);
  const [rangePickerEndYear, setRangePickerEndYear] = useState(null);
  const [monthPickerYear, setMonthPickerYear] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const syncChannelRef = useRef(null);
  const queryEpochRef = useRef(0);
  // Route identity is derived from the browser location and query string, and
  // that route drives which page payload we fetch next.
  const appEnvironment = appShell?.appEnvironment ?? getClientAppEnvironment();
  const explicitViewId = searchParams.get("view");
  const selectedViewId = explicitViewId ?? "household";
  const selectedTabId = getSelectedTabId(location.pathname);
  const defaultSplitsViewId = appShell?.viewerPersonId
    ?? appShell?.household?.people?.[0]?.id
    ?? appShell?.selectedViewId
    ?? "household";
  const splitsViewNeedsPerson = selectedTabId === "splits"
    && selectedViewId === "household"
    && defaultSplitsViewId !== "household";
  const routeViewId = resolveRouteViewId(
    splitsViewNeedsPerson ? defaultSplitsViewId : selectedViewId,
    appShell,
    selectedTabId === "splits" ? defaultSplitsViewId : undefined
  );
  const selectedMonth = searchParams.get("month") ?? getCurrentMonthKey();
  const selectedScope = searchParams.get("scope") ?? "direct_plus_shared";
  const selectedSummaryStart = searchParams.get("summary_start") ?? undefined;
  const selectedSummaryEnd = searchParams.get("summary_end") ?? undefined;
  const isAppShellLoading = appShellLoadCount > 0;
  const [importInboxBanner, setImportInboxBanner] = useState(null);
  const [routePageError, setRoutePageError] = useState("");
  const [isRetryingRoutePage, setIsRetryingRoutePage] = useState(false);
  // Summary data is not replaced until the next response arrives, so keep the
  // request it belongs to; readiness compares it with the active request.
  const [entriesExternalRefreshToken, setEntriesExternalRefreshToken] = useState(0);
  const [loginRegistrationDraft, setLoginRegistrationDraft] = useState(null);
  const [loginRegistrationError, setLoginRegistrationError] = useState("");
  const [isRegisteringLogin, setIsRegisteringLogin] = useState(false);
  const [loginIdentityError, setLoginIdentityError] = useState("");
  const [isUnregisteringLogin, setIsUnregisteringLogin] = useState(false);
  const [suppressedLoginRegistrationEmail, setSuppressedLoginRegistrationEmail] = useState("");
  // These aliases make the current route inputs explicit before they flow into
  // shell and page fetch helpers.
  const appShellSummaryStart = selectedSummaryStart;
  const appShellSummaryEnd = selectedSummaryEnd;

  // Install the mobile focus helper once so dialogs and popovers remain
  // keyboard-friendly on small screens.
  useEffect(() => installMobileFocusVisibility(), []);

  // Keep the document title aligned with the current environment.
  useEffect(() => {
    document.title = getDocumentTitle(appEnvironment);
  }, [appEnvironment]);

  // The strict cutover uses explicit route-page fetching, so the app-shell
  // page shortcut stays disabled.
  const canUseAppShellRoutePage = false;
  // Build the shell query key once per route state change so caches stay
  // canonical and stable.
  const appShellParams = useMemo(
    () => buildAppShellParams(),
    []
  );
  const appShellCacheKey = appShellParams.toString();
  const summaryPageParams = useMemo(
    () => buildSummaryPageParams({
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope,
      summaryStart: selectedSummaryStart,
      summaryEnd: selectedSummaryEnd
    }),
    [selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart, selectedViewId]
  );
  const summaryAccountPillsParams = useMemo(
    () => buildSummaryAccountPillsParams({ viewId: selectedViewId }),
    [selectedViewId]
  );
  // Route-page requests are derived from the current tab and route params so
  // every screen loads the smallest possible server payload.
  const routePageRequest = useMemo(
    () => canUseAppShellRoutePage || selectedTabId === "summary"
      ? null
      : buildRoutePageRequest({
          tabId: selectedTabId,
          viewId: routeViewId,
          month: selectedMonth,
          scope: selectedScope,
          summaryStart: selectedSummaryStart,
          summaryEnd: selectedSummaryEnd
        }),
    [canUseAppShellRoutePage, routeViewId, selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart, selectedTabId]
  );
  const routePageRequestKey = useMemo(
    () => getRoutePageRequestKey(routePageRequest),
    [routePageRequest]
  );
  // One key per active route and data context. Panels report readiness and
  // busy state against it; later warmup work reads the derived route work.
  const activeRouteIdentity = useMemo(
    () => buildRouteIdentity({
      tabId: selectedTabId,
      viewId: selectedTabId === "summary" ? selectedViewId : routeViewId,
      month: selectedMonth,
      scope: selectedScope,
      summaryStart: selectedSummaryStart,
      summaryEnd: selectedSummaryEnd
    }),
    [routeViewId, selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart, selectedTabId, selectedViewId]
  );
  const activeRouteKey = useMemo(() => buildRouteWorkKey(activeRouteIdentity), [activeRouteIdentity]);
  const { refreshNotice, refreshNoticeOwner, runBackgroundRefresh } = useRefreshNotice(activeRouteKey);
  const [routeWorkRegistry] = useState(createRouteWorkRegistry);
  const [requiredWork] = useState(createRequiredWorkCounter);

  const updateLoadingStatus = useCallback((patch) => {
    setLoadingStatus((current) => ({
      ...current,
      ...patch,
      updatedAt: Date.now()
    }));
  }, []);

  // Reset loading progress while preserving any previously reported issue.
  const startLoadingStatus = useCallback((patch) => {
    setLoadingStatus((current) => createLoadingStatus({
      issue: current.issue,
      ...patch
    }));
  }, []);

  const reportLoadingIssue = useCallback((source, detail) => {
    const normalizedDetail = typeof detail === "string"
      ? detail
      : detail instanceof Error
        ? detail.message
        : String(detail ?? "").trim();
    const summary = normalizedDetail
      .replace(/\s+/g, " ")
      .replace(/^Uncaught\s+/i, "")
      .slice(0, 220);
    if (!summary) {
      return;
    }
    updateLoadingStatus({ issue: `${source}: ${summary}` });
  }, [updateLoadingStatus]);

  const clearLoadingIssue = useCallback(() => {
    updateLoadingStatus({ issue: "" });
  }, [updateLoadingStatus]);

  // Incrementing this counter invalidates in-flight responses from older
  // requests so the latest route state always wins.
  const beginAppShellLoad = useCallback(() => {
    let didFinish = false;
    setAppShellLoadCount((count) => count + 1);

    return () => {
      if (didFinish) {
        return;
      }

      didFinish = true;
      setAppShellLoadCount((count) => Math.max(0, count - 1));
    };
  }, []);

  // Update the on-screen timer while the shell is loading so the user can see
  // that the app is still working.
  useEffect(() => {
    if (!isAppShellLoading) {
      setLoadingElapsedSeconds(0);
      return undefined;
    }

    setLoadingElapsedSeconds(Math.max(0, Math.floor((Date.now() - loadingStatus.startedAt) / 1000)));
    const timer = window.setInterval(() => {
      setLoadingElapsedSeconds(Math.max(0, Math.floor((Date.now() - loadingStatus.startedAt) / 1000)));
    }, LOADING_STATUS_POLL_MS);

    return () => window.clearInterval(timer);
  }, [isAppShellLoading, loadingStatus.startedAt]);

  // Normalize runtime errors into the loading panel so startup failures are
  // visible instead of failing silently.
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const originalConsoleError = console.error;
    const handleWindowError = (event) => {
      reportLoadingIssue("Runtime error", event.message ?? event.error?.message ?? "Unknown error");
    };
    const handleUnhandledRejection = (event) => {
      reportLoadingIssue("Unhandled promise", event.reason);
    };

    console.error = (...args) => {
      const detail = args
        .map((item) => {
          if (item instanceof Error) {
            return item.message;
          }
          if (typeof item === "string") {
            return item;
          }
          try {
            return JSON.stringify(item);
          } catch {
            return String(item);
          }
        })
        .filter(Boolean)
        .join(" ");
      reportLoadingIssue("Console error", detail);
      originalConsoleError.apply(console, args);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      console.error = originalConsoleError;
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [reportLoadingIssue]);

  // Bump the local query epoch so stale responses cannot overwrite the latest
  // shell or page state.
  // The state copy lets route warmup start a new generation on invalidation;
  // existing readers keep using the ref.
  const [queryEpoch, setQueryEpoch] = useState(0);
  const bumpQueryEpoch = useCallback(() => {
    queryEpochRef.current += 1;
    setQueryEpoch((value) => value + 1);
  }, []);
  const { referenceData, referenceDataError, referenceDataOwner } = useReferenceData({
    queryClient,
    onCacheCleared: bumpQueryEpoch,
    reportIssue: reportLoadingIssue
  });

  // Clear the shell cache and persisted shell payload when shell-relevant data
  // changes.
  const clearAppShellCache = useCallback(() => {
    bumpQueryEpoch();
    queryClient.cancelQueries({ queryKey: queryKeys.appShell() });
    queryClient.removeQueries({ queryKey: queryKeys.appShell() });
    clearPersistedAppShell();
  }, [bumpQueryEpoch, queryClient]);

  // Clear the route-page cache so the next navigation or refresh rebuilds the
  // active screen from fresh server data.
  const { routePageData, routePageDataRequestKey, routeDataOwner } = useRouteData({
    queryClient,
    onCacheCleared: bumpQueryEpoch,
    requestKeyOf: getRoutePageRequestKey
  });
  const clearRoutePageCache = routeDataOwner.clearCache;

  // Clear the entries-page cache when entry mutations should be reflected in
  // the dedicated entries workflow.
  const clearEntriesPageCache = useCallback(() => {
    bumpQueryEpoch();
    queryClient.cancelQueries({ queryKey: ["entries-page"] });
    queryClient.removeQueries({ queryKey: ["entries-page"] });
  }, [bumpQueryEpoch, queryClient]);

  // Fetch the app shell payload and persist it so the next render can reuse
  // global metadata immediately.
  const fetchAppShellData = useCallback(async (params, { bypassCache = false, signal = undefined } = {}) => {
    const cacheKey = params.toString();
    const queryKey = queryKeys.appShell(params);
    const queryState = queryClient.getQueryState(queryKey);
    if (signal?.aborted) {
      throw new DOMException("App shell request aborted.", "AbortError");
    }

    if (!bypassCache && queryClient.getQueryData(queryKey)) {
      updateLoadingStatus({
        label: "Using cached dashboard",
        detail: "Cached shell...",
        percent: 18
      });
      return queryClient.getQueryData(queryKey);
    }

    if (!bypassCache && queryState?.fetchStatus === "fetching") {
      updateLoadingStatus({
        label: "Waiting for dashboard data",
        detail: "Waiting for latest shell...",
        percent: 28
      });
    }

    updateLoadingStatus({
      label: "Requesting dashboard data",
      detail: "Loading dashboard...",
      percent: 35
    });

    // The app-shell fetcher uses a manual parse step so non-JSON error bodies
    // can still surface a useful message.
    const fetcher = async () => {
      const requestUrl = cacheKey ? `/api/app-shell?${cacheKey}` : "/api/app-shell";
      const { response, responseText } = await fetchTextWithTransientWorkerRetry(requestUrl, {
        cache: "no-store",
        requestLabel: "App shell request"
      });
      updateLoadingStatus({
        label: "Reading dashboard response",
        detail: "Parsing dashboard...",
        percent: 55
      });
      let data = null;

      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          if (!response.ok) {
            throw new Error(buildAppShellErrorMessage(response.status, responseText));
          }

          throw new Error("App shell returned invalid JSON.");
        }
      }

      if (!response.ok) {
        throw new Error(buildAppShellErrorMessage(response.status, data?.message ?? responseText));
      }

      updateLoadingStatus({
        label: "Preparing dashboard shell",
        detail: "Building dashboard...",
        percent: 72
      });
      writePersistedAppShell(cacheKey, data);
      return data;
    };

    const data = bypassCache
      ? await queryClient.fetchQuery({
          queryKey,
          queryFn: fetcher,
          retry: false,
          staleTime: 0
        })
      : await queryClient.ensureQueryData({
          queryKey,
          queryFn: fetcher,
          retry: false,
          revalidateIfStale: true
        });

    if (signal?.aborted) {
      throw new DOMException("App shell request aborted.", "AbortError");
    }
    updateLoadingStatus({
      label: "Dashboard shell ready",
      detail: "Applying latest data...",
      percent: 82
    });
    return data;
  }, [queryClient, updateLoadingStatus]);

  // Fetch the entries shell payload used by the dedicated entries workflow.
  const fetchEntriesShellData = useCallback(async (params, { signal = undefined } = {}) => {
    if (signal?.aborted) {
      throw new DOMException("Entries shell request aborted.", "AbortError");
    }

    updateLoadingStatus({
      label: "Opening entry view",
      detail: "Loading entries...",
      percent: 22
    });
    const { response, responseText } = await fetchTextWithTransientWorkerRetry(`/api/entries-shell?${params.toString()}`, {
      cache: "no-store",
      requestLabel: "Entries shell request"
    });
    updateLoadingStatus({
      label: "Preparing entry view",
      detail: "Opening editor...",
      percent: 48
    });
    let data = null;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        if (!response.ok) {
          throw new Error(buildAppShellErrorMessage(response.status, responseText));
        }

        throw new Error("Entries shell returned invalid JSON.");
      }
    }

    if (!response.ok) {
      throw new Error(buildAppShellErrorMessage(response.status, data?.message ?? responseText));
    }

    if (signal?.aborted) {
      throw new DOMException("Entries shell request aborted.", "AbortError");
    }

    return data;
  }, [updateLoadingStatus]);

  // Hydrate the client shell state from the app-shell query and clear any
  // previous shell error. Page errors stay: a page that failed before the
  // shell arrived must still reach its error screen.
  const loadAppShell = useCallback(async (signal, { bypassCache = false } = {}) => {
    const token = appShellOwner.begin();
    try {
      const data = await fetchAppShellData(appShellParams, { bypassCache, signal });
      appShellOwner.apply(token, data);
      return data;
    } catch (error) {
      throw appShellOwner.markIfSuperseded(token, error);
    }
  }, [appShellOwner, appShellParams, fetchAppShellData]);

  // Normalize shell fetch failures into the app-shell error banner and the
  // loading status tracker.
  const handleAppShellFailure = useCallback((error) => {
    // A shell request that a newer one already replaced is not a failure.
    if (appShellOwner.isSuperseded(error)) {
      return;
    }
    appShellOwner.failLatest(describeAppShellError(error));
    reportLoadingIssue("Load failed", error);
    updateLoadingStatus({
      label: "Dashboard load failed",
      detail: "App shell request did not complete",
      percent: 100
    });
  }, [appShellOwner, reportLoadingIssue, updateLoadingStatus]);

  // Reload the shell from the network and optionally broadcast the refresh to
  // other tabs once the new payload is ready.
  const refreshAppShell = useCallback(async ({ broadcast = false } = {}) => {
    clearAppShellCache();
    clearRoutePageCache();
    routeDataOwner.reset();
    const finishAppShellLoad = beginAppShellLoad();

    try {
      const data = await loadAppShell(undefined, { bypassCache: true });

      if (!broadcast) {
        return data;
      }

      broadcastAppShellRefresh(syncChannelRef);
      return data;
    } finally {
      finishAppShellLoad();
    }
  }, [beginAppShellLoad, clearAppShellCache, clearRoutePageCache, loadAppShell, routeDataOwner]);

  // Refresh the shell in the background without surfacing a full loading state
  // to the user.
  const refreshAppShellInBackground = useCallback(async () => {
    const token = appShellOwner.begin();
    clearAppShellCache();
    try {
      const data = await fetchAppShellData(appShellParams, { bypassCache: true });
      appShellOwner.apply(token, data);
      return data;
    } catch (error) {
      // A newer shell request owns the screen now; this failure is moot.
      if (!appShellOwner.isLatest(token)) {
        return null;
      }
      throw error;
    }
  }, [appShellOwner, appShellParams, clearAppShellCache, fetchAppShellData]);

  // Fetch the active route page and shape it into the current screen payload.
  const fetchRoutePageData = useCallback(async (request, { bypassCache = false, signal = undefined } = {}) => {
    if (!request) {
      return null;
    }

    const queryKey = queryKeys.routeRequestKey(request);
    const query = request.params.toString();
    const requestUrl = query ? `${request.path}?${query}` : request.path;
    const readPage = () => fetchQueryWithLease(queryClient, {
      queryKey,
      bypassCache,
      signal,
      abortMessage: "Page request aborted.",
      // Route-page responses are parsed manually for the same reason as the
      // shell fetch: server errors still need to surface useful context.
      fetcher: async ({ signal: requestSignal }) => {
        const { response, responseText } = await fetchTextWithTransientWorkerRetry(requestUrl, {
          cache: "no-store",
          requestLabel: "Page request",
          signal: requestSignal
        });
        updateLoadingStatus({
          label: "Reading page response",
          detail: "Parsing page...",
          percent: 92
        });
        let data = null;

        if (responseText) {
          try {
            data = JSON.parse(responseText);
          } catch {
            if (!response.ok) {
              throw new Error(buildAppShellErrorMessage(response.status, responseText));
            }

            throw new Error("Page request returned invalid JSON.");
          }
        }

        if (!response.ok) {
          throw new Error(buildAppShellErrorMessage(response.status, data?.message ?? responseText));
        }

        return data;
      }
    });
    if (signal?.aborted) {
      throw new DOMException("Page request aborted.", "AbortError");
    }

    if (!bypassCache && queryClient.getQueryData(queryKey)) {
      updateLoadingStatus({
        label: "Using cached page data",
        detail: "Cached page...",
        percent: 84
      });
      return readPage();
    }

    if (!bypassCache && queryClient.getQueryState(queryKey)?.fetchStatus === "fetching") {
      updateLoadingStatus({
        label: "Waiting for page data",
        detail: "Waiting for page...",
        percent: 86
      });
    }

    updateLoadingStatus({
      label: "Loading current page",
      detail: "Loading page...",
      percent: 88
    });
    const data = await readPage();
    updateLoadingStatus({
      label: "Current page ready",
      detail: "Applying page...",
      percent: 96
    });
    return data;
  }, [queryClient, updateLoadingStatus]);

  // Summary uses slice-owned queries instead of the generic route-page
  // endpoint so its range DTO and wallet pills can refresh independently.
  const fetchSummaryPageData = useCallback(async (params, { bypassCache = false, signal = undefined } = {}) => {
    updateLoadingStatus({
      label: "Loading current page",
      detail: "Loading summary...",
      percent: 88
    });
    const data = await fetchSummaryPageQuery(queryClient, params, { bypassCache, signal });
    updateLoadingStatus({
      label: "Current page ready",
      detail: "Applying summary...",
      percent: 96
    });
    return data;
  }, [queryClient, updateLoadingStatus]);

  // Summary account pills stay on a dedicated query so range changes and note
  // edits do not fan out into unrelated wallet refreshes.
  const fetchSummaryAccountPillsData = useCallback(async (params, { bypassCache = false, signal = undefined } = {}) => (
    fetchSummaryAccountPillsQuery(queryClient, params, { bypassCache, signal })
  ), [queryClient]);
  const {
    summaryPageData,
    summaryAccountPillsData,
    summaryPageDataRequestKey,
    summaryOwner
  } = useSummaryData({
    queryClient,
    onCacheCleared: bumpQueryEpoch,
    fetchPage: fetchSummaryPageData,
    fetchPills: fetchSummaryAccountPillsData
  });
  const { clearPageCache: clearSummaryPageCache, clearPillsCache: clearSummaryAccountPillsCache } = summaryOwner;

  // Refresh the active route page, and optionally refresh shell state when the
  // mutation affected shared metadata.
  const refreshRoutePage = useCallback(async ({ broadcast = false, refreshShell = false } = {}) => {
    clearRoutePageCache();
    clearEntriesPageCache();

    if (!routePageRequest) {
      return refreshAppShell({ broadcast });
    }

    if (refreshShell) {
      await refreshAppShell({ broadcast });
    }

    const finishAppShellLoad = beginAppShellLoad();
    try {
      const result = await routeDataOwner.refresh({
        request: routePageRequest,
        run: () => Promise.all([fetchRoutePageData(routePageRequest, { bypassCache: true })])
      });
      return result?.[0] ?? null;
    } finally {
      finishAppShellLoad();
    }
  }, [beginAppShellLoad, clearEntriesPageCache, clearRoutePageCache, fetchRoutePageData, refreshAppShell, routeDataOwner, routePageRequest]);

  // Refresh the summary slice from its dedicated page and account-pill
  // queries without routing it back through the generic page loader.
  const refreshCurrentSummaryPage = useCallback(({ bypassCache = true } = {}) => (
    withRequiredWork(requiredWork, "summary refresh", () => summaryOwner.refresh({
      pageParams: summaryPageParams,
      pillsParams: summaryAccountPillsParams,
      bypassCache
    }))
  ), [requiredWork, summaryAccountPillsParams, summaryOwner, summaryPageParams]);

  const retryActivePageLoad = useCallback(async () => {
    setRoutePageError("");

    try {
      if (selectedTabId === "summary") {
        const finishAppShellLoad = beginAppShellLoad();
        try {
          await refreshCurrentSummaryPage({ bypassCache: true });
        } finally {
          finishAppShellLoad();
        }
      } else {
        await refreshRoutePage();
      }
    } catch (error) {
      setRoutePageError(describeAppShellError(error));
      reportLoadingIssue("Page retry failed", error);
    }
  }, [
    beginAppShellLoad,
    refreshCurrentSummaryPage,
    refreshRoutePage,
    reportLoadingIssue,
    selectedTabId
  ]);

  // Refresh the month page that shares the current route state, then refresh
  // the shell in the background so summary and month stay aligned.
  const refreshCurrentMonthPage = useCallback(async ({
    refreshShell = true
  } = {}) => {
    const request = buildRoutePageRequest({
      tabId: "month",
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope
    });
    if (!request) {
      return null;
    }

    clearSummaryPageCache((params) => isMonthWithinRange(
      selectedMonth,
      params?.startMonth,
      params?.endMonth
    ));
    const result = await withRequiredWork(requiredWork, "month refresh", () => routeDataOwner.refresh({
      request,
      run: () => Promise.all([
        fetchRoutePageData(request, { bypassCache: true }),
        refreshShell ? runBackgroundRefresh(refreshAppShellInBackground) : Promise.resolve(null)
      ])
    }));
    return result?.[0] ?? null;
  }, [
    clearSummaryPageCache,
    fetchRoutePageData,
    refreshAppShellInBackground,
    requiredWork,
    routeDataOwner,
    runBackgroundRefresh,
    selectedMonth,
    selectedScope,
    selectedViewId
  ]);

  // Refresh the imports page and optionally rebroadcast shell freshness when
  // import mutations change shared reference data.
  const refreshCurrentImportsPage = useCallback(async ({
    broadcast = false,
    invalidateImports = false,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false,
    invalidateSplits = false,
    refreshShell = false
  } = {}) => {
    const request = buildRoutePageRequest({
      tabId: "imports",
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope
    });
    if (!request) {
      return null;
    }

    if (invalidateImports) {
      await invalidateImportMutationQueries(queryClient, {
        entriesParams: invalidateEntries
          ? buildEntriesPageParams({ viewId: selectedViewId, month: selectedMonth })
          : undefined,
        invalidateSummaryAccountPills: true,
        invalidateSplits,
        monthKeys: invalidateMonth ? [selectedMonth] : [],
        scope: selectedScope,
        summaryRange: invalidateSummary ? {
          startMonth: selectedMonth,
          endMonth: selectedMonth
        } : undefined,
        viewId: selectedViewId
      });
    }
    const tasks = [fetchRoutePageData(request, { bypassCache: true })];
    if (refreshShell) {
      tasks.push(runBackgroundRefresh(referenceDataOwner.refresh));
    }
    const result = await withRequiredWork(requiredWork, "imports refresh", () => routeDataOwner.refresh({ request, run: () => Promise.all(tasks) }));
    const data = result?.[0] ?? null;

    if (broadcast) {
      broadcastAppShellRefresh(syncChannelRef);
    }

    return data;
  }, [
    fetchRoutePageData,
    queryClient,
    referenceDataOwner,
    requiredWork,
    routeDataOwner,
    runBackgroundRefresh,
    selectedMonth,
    selectedScope,
    selectedViewId
  ]);

  // Clear route-page cache entries that match a targeted invalidation
  // predicate.
  const clearRoutePageCacheByPredicate = useCallback((predicate) => {
    queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [queryClient]);

  // Clear entries-page cache entries that match a targeted invalidation
  // predicate.
  const clearEntriesPageCacheByPredicate = useCallback((predicate) => {
    queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [queryClient]);

  // Splits-page cache entries are invalidated with the same targeted
  // predicate style so the slice can own its cache boundary explicitly.
  const clearSplitsPageCacheByPredicate = useCallback((predicate) => {
    queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [queryClient]);

  // Settings invalidation clears route-page families by endpoint path so
  // renamed reference data does not survive in stale page DTO caches.
  const clearRoutePageCacheByPath = useCallback((path, predicate) => {
    clearRoutePageCacheByPredicate((query) => (
      query.queryKey?.[0] === "route-page"
      && query.queryKey?.[1]?.path === path
      && (!predicate || predicate(query.queryKey?.[1]?.params ?? {}))
    ));
  }, [clearRoutePageCacheByPredicate]);

  // Invalidate the exact caches affected by a split mutation before any
  // refresh or broadcast happens.
  const clearSplitMutationCaches = useCallback(({
    month,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false,
    refreshShell = false
  }) => {
    clearSplitsPageCacheByPredicate((query) => (
      query.queryKey?.[0] === "splits-page"
      && query.queryKey?.[1]?.month === month
      && (
        query.queryKey?.[1]?.view === selectedViewId
        || query.queryKey?.[1]?.viewId === selectedViewId
      )
    ));

    if (invalidateEntries) {
      clearEntriesPageCacheByPredicate((query) => (
        query.queryKey?.[0] === "entries-page"
        && query.queryKey?.[1]?.month === month
      ));
    }

    if (invalidateMonth) {
      clearRoutePageCacheByPredicate((query) => (
        query.queryKey?.[0] === "route-page"
        && query.queryKey?.[1]?.path === "/api/month-page"
        && query.queryKey?.[1]?.params?.month === month
      ));
    }

    if (invalidateSummary) {
      clearSummaryPageCache((params) => (
        isMonthWithinRange(
          month,
          params?.startMonth,
          params?.endMonth
        )
      ));
      clearSummaryAccountPillsCache();
    }

    if (refreshShell) {
      clearAppShellCache();
    }
  }, [
    clearAppShellCache,
    clearEntriesPageCacheByPredicate,
    clearSplitsPageCacheByPredicate,
    clearSummaryAccountPillsCache,
    clearSummaryPageCache,
    selectedViewId
  ]);

  // Settings reference-data edits clear the specific downstream route caches
  // described by the settings slice refresh plan.
  const clearSettingsMutationCaches = useCallback(({
    routePagePaths = [],
    clearEntriesPageCache = false,
    invalidateSummaryAccountPills = false,
    invalidateSummaryPage = false
  }) => {
    for (const path of routePagePaths) {
      clearRoutePageCacheByPath(path);
    }

    if (clearEntriesPageCache) {
      clearEntriesPageCacheByPredicate(() => true);
    }

    if (invalidateSummaryPage) {
      clearSummaryPageCache();
    }

    if (invalidateSummaryAccountPills) {
      clearSummaryAccountPillsCache();
    }
  }, [
    clearEntriesPageCacheByPredicate,
    clearRoutePageCacheByPath,
    clearSummaryAccountPillsCache,
    clearSummaryPageCache
  ]);

  // Settings mutations refresh the settings page directly, while the settings
  // slice owns which downstream route families must be invalidated.
  const refreshCurrentSettingsPage = useCallback(async (options = {}) => {
    const {
      broadcast = false,
      ...plan
    } = options;
    const refreshDescription = describeSettingsRefreshPlan(plan);

    clearSettingsMutationCaches(refreshDescription);

    const tasks = [fetchRoutePageData(refreshDescription.routeRequest, { bypassCache: true })];

    if (refreshDescription.invalidateImportsPage) {
      tasks.push(invalidateImportsPageQueries(queryClient));
    }

    if (refreshDescription.refreshShell) {
      tasks.push(runBackgroundRefresh(refreshAppShellInBackground));
    }

    if (refreshDescription.refreshReferenceData) {
      tasks.push(runBackgroundRefresh(referenceDataOwner.refresh));
    }

    const result = await withRequiredWork(requiredWork, "settings refresh", () => routeDataOwner.refresh({
      request: refreshDescription.routeRequest,
      run: () => Promise.all(tasks),
      apply: selectedTabId === "settings"
    }));
    if (!result) {
      return null;
    }
    const [data, ...taskResults] = result;

    if (broadcast && (refreshDescription.refreshShell || refreshDescription.refreshReferenceData)) {
      broadcastAppShellRefresh(syncChannelRef);
    }

    return refreshDescription.refreshShell || refreshDescription.refreshReferenceData
      ? taskResults.find((result) => result?.accounts || result?.categories || result?.household) ?? data
      : data;
  }, [
    clearSettingsMutationCaches,
    fetchRoutePageData,
    queryClient,
    refreshAppShellInBackground,
    referenceDataOwner,
    requiredWork,
    routeDataOwner,
    runBackgroundRefresh,
    selectedTabId
  ]);

  // Refresh the current route page in the background without switching tabs or
  // interrupting the visible workflow.
  const refreshActiveRoutePageInBackground = useCallback(async (request) => {
    if (!request) {
      return null;
    }

    const result = await withRequiredWork(requiredWork, "route background refresh", () => routeDataOwner.refresh({
      request,
      run: () => Promise.all([fetchRoutePageData(request, { bypassCache: true })])
    }));
    return result?.[0] ?? null;
  }, [fetchRoutePageData, requiredWork, routeDataOwner]);

  // Broadcast split invalidation details to other tabs after the local cache
  // has already been cleared.
  const broadcastSplitMutation = useCallback(({
    month,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false,
    refreshShell = false
  }) => {
    clearSplitMutationCaches({
      month,
      invalidateEntries,
      invalidateMonth,
      invalidateSummary,
      refreshShell
    });
    publishAppSyncEvent(syncChannelRef, buildSplitMutationSyncEvent({
      month,
      invalidateEntries,
      invalidateMonth,
      invalidateSummary,
      refreshShell
    }));
  }, [clearSplitMutationCaches]);

  // Entries mutations keep their own narrow freshness policy so the shell
  // does not absorb entries-specific invalidation branches.
  const broadcastEntryMutation = useCallback(({
    month,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false
  }) => {
    void invalidateEntriesMutationQueries(queryClient, {
      entriesParams: routePageRequest?.path === "/api/entries-page" ? routePageRequest.params : null,
      monthKey: month,
      scope: selectedScope,
      summaryRange: invalidateSummary ? {
        startMonth: selectedSummaryStart ?? appShellSummaryStart,
        endMonth: selectedSummaryEnd ?? appShellSummaryEnd
      } : null,
      viewId: selectedViewId
    });
    publishAppSyncEvent(syncChannelRef, buildEntryMutationSyncEvent({
      month,
      invalidateEntries,
      invalidateMonth,
      invalidateSummary
    }));
  }, [
    appShellSummaryEnd,
    appShellSummaryStart,
    queryClient,
    routePageRequest,
    selectedScope,
    selectedSummaryEnd,
    selectedSummaryStart,
    selectedViewId
  ]);

  // Refresh the splits page and optionally refresh shell state when the split
  // mutation changed shared metadata.
  const refreshCurrentSplitsPage = useCallback(async ({
    broadcast = false,
    refreshShell = false,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false
  } = {}) => {
    const request = buildRoutePageRequest({
      tabId: "splits",
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope
    });
    if (!request) {
      return null;
    }

    clearSplitMutationCaches({
      month: selectedMonth,
      invalidateEntries,
      invalidateMonth,
      invalidateSummary,
      refreshShell
    });

    const tasks = [fetchRoutePageData(request, { bypassCache: true })];
    if (refreshShell || invalidateEntries || invalidateMonth || invalidateSummary) {
      tasks.push(runBackgroundRefresh(refreshAppShellInBackground));
    }
    const result = await withRequiredWork(requiredWork, "splits refresh", () => routeDataOwner.refresh({ request, run: () => Promise.all(tasks) }));
    const data = result?.[0] ?? null;

    if (broadcast) {
      if (refreshShell && !invalidateEntries && !invalidateMonth && !invalidateSummary) {
        broadcastAppShellRefresh(syncChannelRef);
      } else {
        publishAppSyncEvent(syncChannelRef, buildSplitMutationSyncEvent({
          month: selectedMonth,
          invalidateEntries,
          invalidateMonth,
          invalidateSummary,
          refreshShell
        }));
      }
    }

    return data;
  }, [
    clearSplitMutationCaches,
    fetchRoutePageData,
    refreshAppShellInBackground,
    requiredWork,
    routeDataOwner,
    runBackgroundRefresh,
    selectedMonth,
    selectedScope,
    selectedViewId
  ]);

  // Apply a remote split mutation to the current tab without assuming the
  // local user is in the same workflow.
  const handleRemoteSplitMutation = useCallback(async ({
    month,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false,
    refreshShell = false
  }) => {
    clearSplitMutationCaches({
      month,
      invalidateEntries,
      invalidateMonth,
      invalidateSummary,
      refreshShell
    });

    const tasks = [];
    if (selectedTabId === "entries" && invalidateEntries && selectedMonth === month) {
      setEntriesExternalRefreshToken((current) => current + 1);
    }

    if (selectedTabId === "splits" && selectedMonth === month) {
      tasks.push(runBackgroundRefresh(() => refreshActiveRoutePageInBackground(routePageRequest)));
    } else if (selectedTabId === "month" && invalidateMonth && selectedMonth === month) {
      if (canUseAppShellRoutePage) {
        tasks.push(runBackgroundRefresh(refreshAppShellInBackground));
      } else {
        tasks.push(runBackgroundRefresh(() => refreshActiveRoutePageInBackground(routePageRequest)));
      }
    } else if (
      selectedTabId === "summary"
      && invalidateSummary
      && isMonthWithinRange(
        month,
        selectedSummaryStart ?? appShellSummaryStart,
        selectedSummaryEnd ?? appShellSummaryEnd
      )
    ) {
      tasks.push(runBackgroundRefresh(() => refreshCurrentSummaryPage({ bypassCache: true })));
    }

    await Promise.all(tasks);
  }, [
    appShellSummaryEnd,
    appShellSummaryStart,
    canUseAppShellRoutePage,
    clearSplitMutationCaches,
    refreshAppShellInBackground,
    refreshCurrentSummaryPage,
    routePageRequest,
    runBackgroundRefresh,
    selectedMonth,
    selectedSummaryEnd,
    selectedSummaryStart,
    selectedTabId
  ]);

  // Apply a remote entries mutation to the current tab without widening the
  // shell into entries-specific policy.
  const handleRemoteEntryMutation = useCallback(async ({
    month,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false
  }) => {
    if (invalidateEntries || invalidateMonth || invalidateSummary) {
      void invalidateEntriesMutationQueries(queryClient, {
        entriesParams: routePageRequest?.path === "/api/entries-page" ? routePageRequest.params : null,
        monthKey: month,
        scope: selectedScope,
        summaryRange: invalidateSummary ? {
          startMonth: selectedSummaryStart ?? appShellSummaryStart,
          endMonth: selectedSummaryEnd ?? appShellSummaryEnd
        } : null,
        viewId: selectedViewId
      });
    }

    const tasks = [];
    if (selectedTabId === "entries" && invalidateEntries && selectedMonth === month) {
      setEntriesExternalRefreshToken((current) => current + 1);
    }

    if (selectedTabId === "month" && invalidateMonth && selectedMonth === month) {
      if (canUseAppShellRoutePage) {
        tasks.push(runBackgroundRefresh(refreshAppShellInBackground));
      } else {
        tasks.push(runBackgroundRefresh(() => refreshActiveRoutePageInBackground(routePageRequest)));
      }
    } else if (
      selectedTabId === "summary"
      && invalidateSummary
      && isMonthWithinRange(
        month,
        selectedSummaryStart ?? appShellSummaryStart,
        selectedSummaryEnd ?? appShellSummaryEnd
      )
    ) {
      tasks.push(runBackgroundRefresh(() => refreshCurrentSummaryPage({ bypassCache: true })));
    }

    await Promise.all(tasks);
  }, [
    appShellSummaryEnd,
    appShellSummaryStart,
    canUseAppShellRoutePage,
    queryClient,
    refreshActiveRoutePageInBackground,
    refreshAppShellInBackground,
    refreshCurrentSummaryPage,
    routePageRequest,
    runBackgroundRefresh,
    selectedMonth,
    selectedScope,
    selectedSummaryEnd,
    selectedSummaryStart,
    selectedTabId,
    selectedViewId
  ]);

  // Summary note saves stay narrow and should not turn summary into the owner
  // of month or shell policy.
  const handleRemoteSummaryMutation = useCallback(async ({
    month,
    invalidateMonth = false,
    invalidateSummary = false
  }) => {
    const tasks = [];

    if (selectedTabId === "month" && invalidateMonth && selectedMonth === month) {
      if (canUseAppShellRoutePage) {
        tasks.push(runBackgroundRefresh(refreshAppShellInBackground));
      } else {
        tasks.push(runBackgroundRefresh(() => refreshActiveRoutePageInBackground(routePageRequest)));
      }
    } else if (
      selectedTabId === "summary"
      && invalidateSummary
      && isMonthWithinRange(
        month,
        selectedSummaryStart ?? appShellSummaryStart,
        selectedSummaryEnd ?? appShellSummaryEnd
      )
    ) {
      tasks.push(runBackgroundRefresh(() => refreshCurrentSummaryPage({ bypassCache: true })));
    }

    await Promise.all(tasks);
  }, [
    appShellSummaryEnd,
    appShellSummaryStart,
    canUseAppShellRoutePage,
    refreshActiveRoutePageInBackground,
    refreshAppShellInBackground,
    refreshCurrentSummaryPage,
    routePageRequest,
    runBackgroundRefresh,
    selectedMonth,
    selectedSummaryEnd,
    selectedSummaryStart,
    selectedTabId
  ]);

  // Refresh the shell after a mutation that needs global metadata to stay in
  // sync.
  const syncAppShellAfterMutation = useCallback(async () => {
    clearSummaryPageCache();
    clearSummaryAccountPillsCache();
  }, [clearSummaryAccountPillsCache, clearSummaryPageCache]);

  // Hydrate the shell from persisted cache first, then replace it with fresh
  // server data and an optional entries-shell warm start when the entries tab
  // is the active route.
  useEffect(() => {
    const controller = new AbortController();
    // Entries mode can reuse a narrower shell first so the editor feels faster
    // before the full shell arrives.
    const entriesShellParams = buildEntriesShellParams({
      viewId: selectedViewId,
      month: selectedMonth
    });
    startLoadingStatus({
      label: "Preparing dashboard shell",
      detail: "Checking cache...",
      percent: 10
    });
    const appShellQueryKey = queryKeys.appShell(appShellParams);
    if (!queryClient.getQueryData(appShellQueryKey)) {
      const persistedAppShell = readPersistedAppShell(appShellCacheKey);
      if (persistedAppShell) {
        queryClient.setQueryData(appShellQueryKey, persistedAppShell);
        updateLoadingStatus({
          label: "Using cached dashboard",
          detail: "Cached shell...",
          percent: 16
        });
      }
    }

    const hasCachedAppShell = Boolean(queryClient.getQueryData(appShellQueryKey));
    const shouldUseEntriesShell = !hasCachedAppShell && selectedTabId === "entries";
    const finishAppShellLoad = hasCachedAppShell ? null : beginAppShellLoad();

    // The Entries warm start applies twice under one shell token.
    const warmStartToken = shouldUseEntriesShell ? appShellOwner.begin() : null;
    void (async () => {
      try {
        if (shouldUseEntriesShell) {
          const shellData = await fetchEntriesShellData(entriesShellParams, {
            signal: controller.signal
          });
          if (!controller.signal.aborted) {
            appShellOwner.apply(warmStartToken, shellData);
          }

          const fullData = await fetchAppShellData(appShellParams, {
            bypassCache: true,
            signal: controller.signal
          });
          if (!controller.signal.aborted) {
            appShellOwner.apply(warmStartToken, fullData);
          }
          return;
        }

        // Fall back to the normal shell fetch for every non-entries route and
        // for the second, full shell pass after the entries warm start.
        await loadAppShell(controller.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (shouldUseEntriesShell) {
          // If the entries warm start fails, recover by retrying the full shell
          // so the app still reaches a usable state.
          try {
            const fallbackData = await fetchAppShellData(appShellParams, {
              bypassCache: true,
              signal: controller.signal
            });
            if (!controller.signal.aborted) {
              appShellOwner.apply(warmStartToken, fallbackData);
            }
            return;
          } catch (fallbackError) {
            if (fallbackError instanceof DOMException && fallbackError.name === "AbortError") {
              return;
            }
            handleAppShellFailure(appShellOwner.markIfSuperseded(warmStartToken, fallbackError));
            return;
          }
        }

        if (!hasCachedAppShell) {
          handleAppShellFailure(error);
        }
      } finally {
        finishAppShellLoad?.();
      }
    })();

    return () => {
      controller.abort();
      finishAppShellLoad?.();
    };
  }, [
    beginAppShellLoad,
    appShellCacheKey,
    appShellOwner,
    appShellParams,
    fetchAppShellData,
    fetchEntriesShellData,
    handleAppShellFailure,
    loadAppShell,
    queryClient,
    selectedMonth,
    selectedTabId,
    selectedViewId,
    updateLoadingStatus
  ]);

  // Listen for cross-tab shell refreshes and split mutations so every open tab
  // converges on the same canonical state. A shell refresh arriving through
  // the storage fallback also clears the Summary caches.
  useAppSyncSubscription(syncChannelRef, {
    onShellRefresh: (source) => {
      clearAppShellCache();
      clearRoutePageCache();
      if (source === "storage") {
        clearSummaryPageCache();
        clearSummaryAccountPillsCache();
      }
      const finishAppShellLoad = beginAppShellLoad();
      void Promise.all([
        loadAppShell().catch(handleAppShellFailure),
        referenceDataOwner.refreshOrShowError("Reference data refresh failed")
      ])
        .finally(finishAppShellLoad);
    },
    onSplitMutation: (payload) => { void handleRemoteSplitMutation(payload); },
    onEntryMutation: (payload) => { void handleRemoteEntryMutation(payload); },
    onSummaryMutation: (payload) => { void handleRemoteSummaryMutation(payload); }
  });

  // Summary owns its own page query plus wallet-pill query, so the summary tab
  // hydrates from those slice caches instead of the generic route-page family.
  useEffect(() => {
    if (selectedTabId !== "summary") {
      return undefined;
    }

    const controller = new AbortController();
    const summaryQueryKey = queryKeys.summaryPage({
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope,
      startMonth: selectedSummaryStart ?? "",
      endMonth: selectedSummaryEnd ?? ""
    });
    const hasCachedPage = Boolean(queryClient.getQueryData(summaryQueryKey));
    setRoutePageError("");
    if (!hasCachedPage) {
      updateLoadingStatus({
        label: "Preparing current page",
        detail: "Preparing summary...",
        percent: 84
      });
    }
    const finishAppShellLoad = hasCachedPage ? null : beginAppShellLoad();

    // The owner ignores aborted and superseded loads; only a failure of
    // the latest load reaches the page error screen.
    void summaryOwner.load({ pageParams: summaryPageParams, pillsParams: summaryAccountPillsParams, signal: controller.signal })
      .then((applied) => {
        if (applied) {
          setRoutePageError("");
        }
      })
      .catch((error) => {
        setRoutePageError(describeAppShellError(error));
        reportLoadingIssue("Summary load failed", error);
      })
      .finally(() => finishAppShellLoad?.());

    return () => {
      controller.abort();
      finishAppShellLoad?.();
    };
  }, [
    beginAppShellLoad,
    queryClient,
    reportLoadingIssue,
    selectedScope,
    selectedSummaryEnd,
    selectedSummaryStart,
    selectedTabId,
    selectedViewId,
    summaryAccountPillsParams,
    summaryOwner,
    summaryPageParams,
    updateLoadingStatus
  ]);

  // Route-page loading starts as soon as the route is known so shell and page
  // requests can overlap when the page does not need shell-derived inputs.
  useEffect(() => {
    if (!routePageRequest) {
      return undefined;
    }

    const controller = new AbortController();
    const hasCachedPage = Boolean(queryClient.getQueryData(queryKeys.routePage(routePageRequest)));
    setRoutePageError("");
    if (!hasCachedPage) {
      updateLoadingStatus({
        label: "Preparing current page",
        detail: "Preparing page...",
        percent: 84
      });
    }
    const finishAppShellLoad = hasCachedPage ? null : beginAppShellLoad();

    // The owner ignores aborted and superseded loads; only a failure of
    // the latest load reaches the page error screen.
    void routeDataOwner.load({ request: routePageRequest, fetchPage: fetchRoutePageData, signal: controller.signal })
      .then((applied) => {
        if (applied) {
          setRoutePageError("");
        }
      })
      .catch((error) => {
        setRoutePageError(describeAppShellError(error));
        reportLoadingIssue("Page load failed", error);
      })
      .finally(() => finishAppShellLoad?.());

    return () => {
      controller.abort();
      finishAppShellLoad?.();
    };
  }, [beginAppShellLoad, fetchRoutePageData, queryClient, reportLoadingIssue, routeDataOwner, routePageRequest, updateLoadingStatus]);

  // Keep only the last settled route snapshot in refs so hydration can fall
  // back to the previous screen without introducing a second render source of
  // truth.
  const currentRoutePageData = routePageRequestKey && routePageDataRequestKey === routePageRequestKey
    ? routePageData
    : null;
  const currentPageView = useMemo(
    () => selectedTabId === "summary"
      ? buildSummaryPageView({
          appShell,
          selectedViewId,
          summaryPageData,
          summaryAccountPillsData,
          summaryPageDataRequestKey
        })
      : buildPageViewFromRouteData(selectedTabId, currentRoutePageData, selectedViewId, appShell),
    [appShell, currentRoutePageData, selectedTabId, selectedViewId, summaryAccountPillsData, summaryPageData, summaryPageDataRequestKey]
  );
  const lastSettledPageViewRef = useRef(null);
  const lastSettledTabIdRef = useRef(null);
  useEffect(() => {
    if (currentPageView) {
      lastSettledPageViewRef.current = currentPageView;
      lastSettledTabIdRef.current = selectedTabId;
    }
  }, [currentPageView, selectedTabId]);

  // A page failure belongs to the page: shell loads never clear it, so the
  // contract check waits for the shell instead of flagging Summary data that
  // simply arrived first (the Summary view cannot be built without the shell).
  useEffect(() => {
    if (!appShell || currentPageView || routePageError) {
      return;
    }

    if (selectedTabId === "summary") {
      if (summaryPageData || summaryAccountPillsData) {
        setRoutePageError(describeRoutePageContractError(selectedTabId));
      }
      return;
    }

    if (currentRoutePageData) {
      setRoutePageError(describeRoutePageContractError(selectedTabId));
    }
  }, [
    appShell,
    currentPageView,
    currentRoutePageData,
    routePageError,
    selectedTabId,
    summaryAccountPillsData,
    summaryPageData
  ]);

  // Derive the active render state directly from the current route, falling
  // back to the last settled route only while the next page hydrates.
  const pageView = currentPageView ?? lastSettledPageViewRef.current;
  const renderedTabId = currentPageView ? selectedTabId : lastSettledTabIdRef.current ?? selectedTabId;
  // Route data held by the shell counts as ready only when it was fetched for
  // the active request; a previous page kept on screen never does.
  const routeDataReady = selectedTabId === "summary"
    ? Boolean(summaryPageData && summaryAccountPillsData) && summaryPageDataRequestKey === summaryPageParams.toString()
    : selectedTabId === "faq" || Boolean(currentRoutePageData);
  const routeWorkSnapshot = useRouteWorkSnapshot(routeWorkRegistry, activeRouteKey);
  const requiredWorkCount = useRequiredWorkCount(requiredWork);
  const loginRegistrationBlocking = Boolean(loginRegistrationDraft) || isRegisteringLogin || isUnregisteringLogin;
  const routeWork = useMemo(
    () => deriveRouteWork({
      routeKey: activeRouteKey,
      hasPageView: Boolean(currentPageView),
      isAppShellLoading,
      hasShellError: Boolean(appShellError),
      hasRouteError: Boolean(routePageError),
      hasReferenceData: Boolean(referenceData),
      routeDataReady,
      snapshot: routeWorkSnapshot,
      requiredCount: requiredWorkCount,
      mobileContextOpen,
      loginRegistrationBlocking
    }),
    [
      activeRouteKey,
      appShellError,
      currentPageView,
      isAppShellLoading,
      loginRegistrationBlocking,
      mobileContextOpen,
      referenceData,
      requiredWorkCount,
      routeDataReady,
      routePageError,
      routeWorkSnapshot.busy,
      routeWorkSnapshot.hasReport,
      routeWorkSnapshot.ready
    ]
  );
  useEffect(() => {
    // Test/development read hook only; absent from production builds.
    if (import.meta.env.MODE !== "production") {
      window.__MONIES_MAP_ROUTE_WORK__ = routeWork;
    }
  }, [routeWork]);
  // Summary-dependent helpers reuse the same optional page slice so the
  // summary-specific code stays isolated from detail tabs.
  const summaryPage = pageView?.summaryPage ?? null;
  // Entries scope falls back to the month view scope when the route has not
  // overridden it yet.
  const selectedEntriesScope = searchParams.get("entries_scope") ?? pageView?.monthPage?.selectedScope ?? "direct_plus_shared";
  const categories = useMemo(
    () => referenceData?.categories.map((category) => ({ ...category, ...(categoryOverrides[category.id] ?? {}) })) ?? [],
    [referenceData, categoryOverrides]
  );
  const accounts = useMemo(
    () => renderedTabId === "settings" && pageView?.settingsPage?.accounts?.length
      ? pageView.settingsPage.accounts
      : referenceData?.accounts ?? [],
    [pageView, referenceData, renderedTabId]
  );
  // Use the summary page's month list when present, otherwise fall back to the
  // shell's tracked months for detail tabs and route-neutral navigation.
  const availableMonths = useMemo(
    () => pageView?.summaryPage?.availableMonths?.slice().sort() ?? appShell?.trackedMonths ?? [],
    [appShell, pageView]
  );
  // Summary range shifts are only proposed from the range the server resolved.
  const warmupSummaryRange = useMemo(
    () => (selectedTabId === "summary" && currentPageView?.summaryPage?.rangeStartMonth
      ? { startMonth: currentPageView.summaryPage.rangeStartMonth, endMonth: currentPageView.summaryPage.rangeEndMonth }
      : null),
    [currentPageView, selectedTabId]
  );
  // Route code, then a few optional data requests, warm only once this route
  // is usable and quiet, plus exact link intent. Clicks always load normally.
  const getNavIntentProps = useRouteWarmup({
    routeIdentity: activeRouteIdentity,
    routeWork,
    queryEpoch,
    queryClient,
    availableMonths,
    summaryRange: warmupSummaryRange
  });
  const isDetailMonthTab = renderedTabId === "month" || renderedTabId === "entries" || renderedTabId === "splits";
  const selectedRouteIsDetailMonthTab = selectedTabId === "month" || selectedTabId === "entries" || selectedTabId === "splits";
  const isSplitsTab = renderedTabId === "splits";
  // Detail tabs use the current month index to decide whether the navigation
  // arrows should remain enabled.
  const currentDetailMonthIndex = useMemo(
    () => isDetailMonthTab ? availableMonths.indexOf(selectedMonth) : -1,
    [availableMonths, isDetailMonthTab, selectedMonth]
  );
  const canMoveToPreviousDetailMonth = currentDetailMonthIndex > 0;
  const canMoveToNextDetailMonth = currentDetailMonthIndex !== -1 && currentDetailMonthIndex < availableMonths.length - 1;
  // The month picker groups available months by year so the user can jump
  // quickly across the imported ledger timeline.
  const detailAvailableYears = useMemo(
    () => isDetailMonthTab
      ? [...new Set(availableMonths.map((month) => Number(month.slice(0, 4))))].sort((left, right) => left - right)
      : [],
    [availableMonths, isDetailMonthTab]
  );
  // Filter the current route's month list down to the selected year for the
  // detail month picker.
  const detailAvailableMonthsForPickerYear = useMemo(
    () => isDetailMonthTab && monthPickerYear != null
      ? availableMonths.filter((month) => Number(month.slice(0, 4)) === monthPickerYear)
      : [],
    [availableMonths, isDetailMonthTab, monthPickerYear]
  );
  // The summary range picker uses the same month list but renders year buckets
  // separately for start and end selection.
  const summaryAvailableYears = useMemo(
    () => !isDetailMonthTab && pageView?.summaryPage?.availableMonths
      ? [...new Set(pageView.summaryPage.availableMonths.map((month) => Number(month.slice(0, 4))))].sort((left, right) => left - right)
      : [],
    [isDetailMonthTab, pageView]
  );
  // Filter the summary picker months for the active start-year bucket.
  const summaryAvailableMonthsForPickerYear = useMemo(
    () => !isDetailMonthTab && pageView?.summaryPage?.availableMonths && rangePickerStartYear != null
      ? pageView.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerStartYear)
      : [],
    [isDetailMonthTab, rangePickerStartYear, pageView]
  );
  // Filter the summary picker months for the active end-year bucket.
  const summaryAvailableMonthsForEndPickerYear = useMemo(
    () => !isDetailMonthTab && pageView?.summaryPage?.availableMonths && rangePickerEndYear != null
      ? pageView.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerEndYear)
      : [],
    [isDetailMonthTab, rangePickerEndYear, pageView]
  );
  const saveSummaryMonthNote = useCallback(async ({ month, note }) => {
    const refreshPlan = buildSummaryMutationRefreshPlan({ kind: "note-save" });
    const response = await fetch("/api/month-note/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        month,
        personScope: selectedViewId,
        note
      })
    });

    if (!response.ok) {
      throw new Error(await buildRequestErrorMessage(response, "Failed to save month note."));
    }

    await invalidateMonthQueries(queryClient, {
      month,
      scope: selectedScope,
      summaryRange: summaryPage
        ? {
            startMonth: summaryPage.rangeStartMonth,
            endMonth: summaryPage.rangeEndMonth
        }
      : undefined,
      viewId: selectedViewId
    });

    await refreshCurrentSummaryPage({ bypassCache: true });

    publishAppSyncEvent(syncChannelRef, buildSummaryMutationSyncEvent({
      month,
      invalidateMonth: refreshPlan.invalidateMonth,
      invalidateSummary: refreshPlan.invalidateSummary,
      refreshShell: refreshPlan.refreshShell
    }));
  }, [
    queryClient,
    syncChannelRef,
    refreshCurrentSummaryPage,
    selectedScope,
    selectedViewId,
    summaryPage
  ]);
  const renderedRouteElement = useMemo(() => {
    if (!appShell || !pageView || !referenceData) {
      return null;
    }

    if (renderedTabId === "summary") {
      return (
        <SummaryPanel
          view={pageView}
          selectedMonth={selectedMonth}
          categories={categories}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
          onRefresh={saveSummaryMonthNote}
          canRequestWording={routeWork.usable}
        />
      );
    }

    if (renderedTabId === "month") {
      return (
        <MonthPanel
          view={pageView}
          accounts={accounts}
          people={appShell.household.people}
          categories={categories}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
          onRefresh={refreshCurrentMonthPage}
          runBackgroundRefresh={runBackgroundRefresh}
          canRequestWording={routeWork.usable}
        />
      );
    }

    if (renderedTabId === "entries") {
      return (
        <EntriesPanel
          view={pageView}
          entriesSourceView={pageView}
          selectedMonth={selectedMonth}
          mobileContextOpen={mobileContextOpen}
          onCloseMobileContext={closeMobileContext}
          onMobileFilterStateChange={handleEntriesMobileFilterStateChange}
          externalRefreshToken={entriesExternalRefreshToken}
          accounts={accounts}
          categories={categories}
          people={appShell.household.people}
          shortcutSettings={appShell.settingsPage?.shortcutSettings}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
          onInvalidateAppShellCache={syncAppShellAfterMutation}
          onInvalidateEntryMutation={broadcastEntryMutation}
          onBroadcastSplitMutation={broadcastSplitMutation}
          runBackgroundRefresh={runBackgroundRefresh}
          onRetryPageLoad={retryActivePageLoad}
          canRequestWording={routeWork.usable}
        />
      );
    }

    if (renderedTabId === "splits") {
      return (
        <SplitsPanel
          view={pageView}
          categories={categories}
          people={appShell.household.people}
          onRefresh={(options) => refreshCurrentSplitsPage(options)}
          runBackgroundRefresh={runBackgroundRefresh}
          canRequestWording={routeWork.usable}
        />
      );
    }

    if (renderedTabId === "imports") {
      return (
        <ImportsPanel
          importsPage={pageView.importsPage}
          viewId={pageView.id}
          viewLabel={pageView.label}
          accounts={accounts}
          categories={categories}
          people={appShell.household.people}
          onRefresh={(options) => refreshCurrentImportsPage(options)}
        />
      );
    }

    if (renderedTabId === "settings") {
      return (
        <SettingsPanel
          settingsPage={pageView.settingsPage}
          accounts={accounts}
          categories={categories}
          people={appShell.household.people}
          viewId={pageView.id}
          viewLabel={pageView.label}
          appEnvironment={appEnvironment}
          viewerIdentity={appShell.viewerIdentity}
          loginIdentityError={loginIdentityError}
          isUnregisteringLogin={isUnregisteringLogin}
          onUnregisterLogin={handleUnregisterLogin}
          onLogout={handleLogout}
          onRefresh={(options) => refreshCurrentSettingsPage(options)}
        />
      );
    }

    if (renderedTabId === "faq") {
      return <FaqPanel viewLabel={pageView.label} categories={categories} />;
    }

    return null;
  }, [
    appEnvironment,
    accounts,
    appShell?.household?.people,
    appShell?.viewerIdentity,
    broadcastSplitMutation,
    categories,
    closeMobileContext,
    entriesExternalRefreshToken,
    handleCategoryAppearanceChange,
    handleEntriesMobileFilterStateChange,
    handleLogout,
    handleUnregisterLogin,
    isUnregisteringLogin,
    loginIdentityError,
    mobileContextOpen,
    pageView,
    referenceData,
    refreshCurrentSettingsPage,
    refreshCurrentImportsPage,
    refreshCurrentMonthPage,
    refreshCurrentSplitsPage,
    renderedTabId,
    retryActivePageLoad,
    routePageData,
    routeWork.usable,
    runBackgroundRefresh,
    saveSummaryMonthNote,
    selectedMonth,
    syncAppShellAfterMutation
  ]);
  // The previous page stays on screen while the next one loads, so a crashed
  // screen retries both when a navigation starts and when its page settles.
  const screenErrorResetKey = `${activeRouteKey}:${currentPageView ? "current" : "previous"}`;
  // A page that failed to load after the person navigated must not leave the
  // previous page readable under the new tab or period: its figures would
  // read as the new period's. The error panel takes its place inside the
  // shell, so navigation and the period picker keep working, and stays up
  // while "Try loading again" runs. The previous page stays mounted but
  // hidden, so a draft on it survives the failure and the retry.
  const showRoutePageError = Boolean((routePageError || isRetryingRoutePage) && !currentPageView && pageView);
  const retryRoutePageFromPanel = async () => {
    setIsRetryingRoutePage(true);
    try {
      await retryActivePageLoad();
    } finally {
      setIsRetryingRoutePage(false);
    }
  };
  const routeBody = pageView
    ? (
        <>
          {showRoutePageError ? (
            <ErrorPanel
              className="route-page-error"
              title={messages.common.pageLoadErrorTitle}
              detail={messages.common.loadFailedDetail}
              actions={[{
                label: isRetryingRoutePage ? messages.common.working : messages.common.retryPageLoad,
                onClick: () => void retryRoutePageFromPanel(),
                disabled: isRetryingRoutePage,
                primary: true
              }]}
            >
              {routePageError ? <p className="app-loading-issue-inline">{routePageError}</p> : null}
            </ErrorPanel>
          ) : null}
          <div className="route-page-body" style={{ display: showRoutePageError ? "none" : "contents" }}>
            <RouteWorkProvider registry={routeWorkRegistry} routeKey={currentPageView ? activeRouteKey : null}>
              {renderedRouteElement}
            </RouteWorkProvider>
          </div>
        </>
      )
    : <RouteChunkLoadingFallback status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />;
  const showImportInboxBanner = Boolean(
    importInboxBanner
    && ["summary", "month"].includes(renderedTabId)
    && importInboxBanner.summary.requiredFileCount > 0
  );

  // The import banner shows whatever the Imports query cache holds: filled by
  // visiting Imports, by desktop warmup, or by import mutations that refresh
  // it. The banner itself never fetches, so mobile never downloads the
  // Imports page just for it.
  useEffect(() => {
    const importsKeyHash = hashKey(queryKeys.importsPage());
    const readBanner = () => {
      setImportInboxBanner(/** @type {any} */ (queryClient.getQueryData(queryKeys.importsPage()))?.importsPage?.importInbox ?? null);
    };
    readBanner();
    return queryClient.getQueryCache().subscribe((event) => {
      if (event?.query?.queryHash === importsKeyHash) {
        readBanner();
      }
    });
  }, [queryClient]);

  // Keep the splits view pinned to a sensible default person when no explicit
  // selection is available in the URL.
  useEffect(() => {
    if (!appShell) {
      return;
    }

    if (selectedTabId === "splits") {
      if ((!explicitViewId || selectedViewId === "household") && defaultSplitsViewId && defaultSplitsViewId !== selectedViewId) {
        setSearchParams((current) => {
          const currentViewId = current.get("view");
          if (currentViewId && currentViewId !== "household") {
            return current;
          }
          const next = new URLSearchParams(current);
          next.set("view", defaultSplitsViewId);
          return next;
        }, { replace: true });
        return;
      }
    }

    const matchesKnownView = getAppShellAvailableViewIds(appShell).includes(selectedViewId);
    if (matchesKnownView) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", selectedTabId === "splits" ? defaultSplitsViewId : appShell.selectedViewId);
      return next;
    }, { replace: true });
  }, [appShell, defaultSplitsViewId, explicitViewId, selectedTabId, selectedViewId, setSearchParams]);

  // Keep the selected month valid when route state points at a month that no
  // longer exists in the loaded data.
  useEffect(() => {
    if (!appShell?.viewerRegistration) {
      setLoginRegistrationDraft(null);
      setLoginRegistrationError("");
      return;
    }

    if (appShell.viewerRegistration.email === suppressedLoginRegistrationEmail) {
      setLoginRegistrationDraft(null);
      setLoginRegistrationError("");
      return;
    }

    setLoginRegistrationDraft((current) => {
      if (current?.email === appShell.viewerRegistration.email) {
        return current;
      }
      const suggestedPerson = appShell.household.people.find((person) => person.id === appShell.viewerRegistration.suggestedPersonId)
        ?? appShell.household.people[0];
      return {
        email: appShell.viewerRegistration.email,
        personId: suggestedPerson?.id ?? "",
        name: isPlaceholderPersonName(suggestedPerson?.name) ? "" : suggestedPerson?.name ?? ""
      };
    });
  }, [appShell, suppressedLoginRegistrationEmail]);

  // Normalize summary range parameters so the picker and the URL stay in sync.
  useEffect(() => {
    if (!appShell || !availableMonths.length) {
      return;
    }

    if (selectedRouteIsDetailMonthTab) {
      const routeMonth = currentPageView?.monthPage?.month;
      if (!routeMonth || routeMonth === selectedMonth) {
        return;
      }

      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("month", routeMonth);
        return next;
      }, { replace: true });
      return;
    }

    if (availableMonths.includes(selectedMonth)) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("month", availableMonths[availableMonths.length - 1]);
      return next;
    }, { replace: true });
  }, [availableMonths, appShell, currentPageView, selectedMonth, selectedRouteIsDetailMonthTab, setSearchParams]);

  // Initialize the summary range picker year buckets from the active summary
  // window.
  useEffect(() => {
    if (isDetailMonthTab || !summaryPage?.availableMonths?.length) {
      return;
    }

    const summaryMonths = summaryPage.availableMonths;
    const hasExplicitSummaryRange = Boolean(selectedSummaryStart || selectedSummaryEnd);
    const focus = searchParams.get("summary_focus");
    const hasInvalidFocus = Boolean(focus && focus !== SUMMARY_FOCUS_OVERALL && !summaryMonths.includes(focus));
    const startIsValid = selectedSummaryStart && summaryMonths.includes(selectedSummaryStart);
    const endIsValid = selectedSummaryEnd && summaryMonths.includes(selectedSummaryEnd);
    if (!hasExplicitSummaryRange && !hasInvalidFocus) {
      return;
    }

    if (startIsValid && endIsValid && selectedSummaryStart <= selectedSummaryEnd && !hasInvalidFocus) {
      return;
    }

    const resolvedEndMonth = endIsValid ? selectedSummaryEnd : summaryMonths[summaryMonths.length - 1];
    const endIndex = summaryMonths.indexOf(resolvedEndMonth);
    const startMonth = summaryMonths[Math.max(0, endIndex - 11)];
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", resolvedEndMonth);
      const nextFocus = next.get("summary_focus");
      if (nextFocus && nextFocus !== SUMMARY_FOCUS_OVERALL && !summaryMonths.includes(nextFocus)) {
        next.delete("summary_focus");
      }
      return next;
    }, { replace: true });
  }, [isDetailMonthTab, searchParams, selectedSummaryEnd, selectedSummaryStart, setSearchParams, summaryPage]);

  // Initialize the detail month picker year bucket from the active month.
  useEffect(() => {
    // Summary can briefly hydrate without a fully bounded range, so this
    // effect only runs when both boundary months are actually present.
    if (isDetailMonthTab || !summaryPage?.rangeStartMonth || !summaryPage?.rangeEndMonth) {
      return;
    }

    const nextStartYear = Number(summaryPage.rangeStartMonth.slice(0, 4));
    const nextEndYear = Number(summaryPage.rangeEndMonth.slice(0, 4));
    setRangePickerStartYear((current) => {
      if (current != null && summaryAvailableYears.includes(current)) {
        return current;
      }
      return nextStartYear;
    });
    setRangePickerEndYear((current) => {
      if (current != null && summaryAvailableYears.includes(current)) {
        return current;
      }
      return nextEndYear;
    });
  }, [isDetailMonthTab, summaryAvailableYears, summaryPage]);

  useEffect(() => {
    if (!isDetailMonthTab || !detailAvailableYears.length) {
      return;
    }

    const selectedYear = Number(selectedMonth.slice(0, 4));
    setMonthPickerYear((current) => {
      if (current != null && detailAvailableYears.includes(current)) {
        return current;
      }
      return detailAvailableYears.includes(selectedYear) ? selectedYear : detailAvailableYears.at(-1);
    });
  }, [detailAvailableYears, isDetailMonthTab, selectedMonth]);

  // Derive the mobile sticky control config from the current tab and its scope
  // semantics. On a phone this bar is the one view and scope control on
  // Month, Entries and Summary. Summary names the scope its figures answer
  // (the page view's selectedScope), like its desktop pills.
  const stickyScopeConfig = pageView
    ? renderedTabId === "month"
      ? {
          selectedKey: selectedScope,
          paramKey: "scope",
          label: "Month view controls",
          scopes: pageView.monthPage?.scopes ?? []
        }
      : renderedTabId === "entries"
        ? {
            selectedKey: selectedEntriesScope,
            paramKey: "entries_scope",
            label: "Entries view controls",
            scopes: pageView.monthPage?.scopes ?? []
          }
        : renderedTabId === "summary"
          ? {
              selectedKey: pageView.selectedScope,
              paramKey: "scope",
              label: "Summary view controls",
              scopes: pageView.scopes ?? []
            }
          : null
    : null;
  const selectedViewSupportsScope = selectedViewId !== "household";
  const mobileContextScopes = stickyScopeConfig?.scopes ?? [];
  const selectedMobileScope = stickyScopeConfig
    ? mobileContextScopes.find((scope) => scope.key === stickyScopeConfig.selectedKey) ?? null
    : null;
  // The bar names the person and a short scope name ("Tim · Direct + Shared")
  // that it never cuts short; the dialog says what the scope counts.
  const mobileContextScopeLabel = selectedViewSupportsScope && selectedMobileScope
    ? messages.views.scopeShortLabel[selectedMobileScope.key] ?? selectedMobileScope.label
    : "";
  const mobileContextScopeHint = selectedMobileScope
    ? messages.views.scopeHint[selectedMobileScope.key]?.(pageView?.label ?? "") ?? ""
    : "";
  const showMobileContextSticky = Boolean(stickyScopeConfig);
  // Summary moves its range from the header; the bar's month arrows step the
  // single month of Month and Entries.
  const showMobileMonthJump = showMobileContextSticky && isDetailMonthTab;
  const showMobileContextScopeSection = Boolean(stickyScopeConfig) && selectedViewSupportsScope && mobileContextScopes.length > 1;

  // Collapse the mobile sheet when the sticky context is no longer relevant.
  useEffect(() => {
    if (!showMobileContextSticky && mobileContextOpen) {
      setMobileContextOpen(false);
    }
  }, [mobileContextOpen, showMobileContextSticky]);

  // Render the explicit error state before any route chrome if the shell load
  // failed.
  if (appShellError) {
    const isResourceLimitError = isAppShellResourceLimitError(appShellError);
    return (
      <ShellErrorScreen
        environment={appEnvironment}
        title={messages.common.appShellErrorTitle}
        message={appShellError}
        diagnosis={isResourceLimitError ? (
          <div className="app-loading-diagnosis">
            <strong>{messages.common.appShellResourceLimitTitle}</strong>
            <p>{messages.common.appShellResourceLimitDetail}</p>
            <p>{messages.common.appShellDiagnosticsUnavailable}</p>
          </div>
        ) : null}
        issue={loadingStatus.issue}
        retryLabel={messages.common.appShellRetry}
        onRetry={() => { void refreshAppShell({ broadcast: false }).catch(handleAppShellFailure); }}
      />
    );
  }

  if (referenceDataError) {
    return (
      <ShellErrorScreen
        environment={appEnvironment}
        title={messages.common.referenceDataErrorTitle}
        message={referenceDataError}
        diagnosis={(
          <div className="app-loading-diagnosis">
            <p>{messages.common.referenceDataErrorDetail}</p>
          </div>
        )}
        issue={loadingStatus.issue}
        retryLabel={messages.common.referenceDataRetry}
        onRetry={() => { void referenceDataOwner.refreshOrShowError("Reference data retry failed"); }}
      />
    );
  }

  if (appShell && !pageView && routePageError) {
    return (
      <ShellErrorScreen
        environment={appEnvironment}
        title={messages.common.pageLoadErrorTitle}
        message={routePageError}
        issue={loadingStatus.issue}
        retryLabel={messages.common.retryPageLoad}
        onRetry={retryActivePageLoad}
      />
    );
  }

  // Render the loading state while either the shell or the active page is
  // still being resolved.
  if (!appShell || !referenceData || !pageView) {
    return <ShellLoadingScreen environment={appEnvironment} status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />;
  }

  // The top chrome reflects the active period semantics of the current route.
  const periodMode = isDetailMonthTab ? messages.period.month : messages.period.year;
  const periodLabel = isDetailMonthTab
    ? formatMonthLabel(selectedMonth)
    : pageView?.summaryPage?.rangeStartMonth && pageView?.summaryPage?.rangeEndMonth
      ? `${formatMonthLabel(pageView.summaryPage.rangeStartMonth)} - ${formatMonthLabel(pageView.summaryPage.rangeEndMonth)}`
      : pageView.label;
  // The settings badge reads from the settings page cache so the shell stays a
  // reference-data payload instead of reabsorbing settings-page state.
  const cachedSettingsPage = /** @type {any} */ (queryClient.getQueryData(queryKeys.routeRequestKey(SETTINGS_ROUTE_REQUEST)));
  const pendingCategorySuggestionCount = cachedSettingsPage?.settingsPage?.categoryMatchRuleSuggestions?.length ?? 0;
  const buildTabTarget = (tab) => {
    // Each nav link preserves the relevant route query while stripping
    // parameters that belong to another tab.
    const params = new URLSearchParams(searchParams);
    sanitizeTabParams(params, tab.id);
    if (tab.id === "settings" && pendingCategorySuggestionCount) {
      params.set("settings_section", "categoryRules");
    } else {
      params.delete("settings_section");
    }

    return { pathname: tab.path, search: params.toString() ? `?${params.toString()}` : "" };
  };
  // Route-driven view changes need to keep the month and entries tabs
  // internally consistent when the active household member changes.
  function handleViewChange(nextViewId) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", nextViewId);
      if (selectedTabId === "entries") {
        if (nextViewId === "household") {
          next.delete("entry_person");
          next.set("entries_scope", "direct_plus_shared");
        } else {
          const person = appShell.household.people.find((item) => item.id === nextViewId);
          if (person) {
            next.set("entry_person", person.name);
          }
        }
      }
      if (selectedTabId === "month" && nextViewId === "household") {
        next.set("scope", "direct_plus_shared");
      }
      return next;
    });

    if (nextViewId === "household") {
      setMobileContextOpen(false);
    }
  }

  // The mobile scope toggle only changes the current route parameter.
  // The sticky scope control only updates the current route query string.
  function handleStickyScopeChange(nextScopeKey) {
    if (!stickyScopeConfig) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set(stickyScopeConfig.paramKey, nextScopeKey);
      return next;
    });
    setMobileContextOpen(false);
  }

  // Month navigation either moves the single-month detail view or shifts the
  // summary range by one bucket.
  function handleMonthChange(direction) {
    if (isDetailMonthTab) {
      const currentIndex = availableMonths.indexOf(selectedMonth);
      if (currentIndex === -1) {
        return;
      }

      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= availableMonths.length) {
        return;
      }

      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("month", availableMonths[nextIndex]);
        return next;
      });
      return;
    }

    if (!summaryPage) {
      return;
    }

    const rangeMonths = summaryPage.rangeMonths;
    const availableSummaryMonths = summaryPage.availableMonths;
    const startIndex = availableSummaryMonths.indexOf(summaryPage.rangeStartMonth);
    const endIndex = availableSummaryMonths.indexOf(summaryPage.rangeEndMonth);
    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    const nextStartIndex = startIndex + direction;
    const nextEndIndex = endIndex + direction;
    if (nextStartIndex < 0 || nextEndIndex >= availableSummaryMonths.length) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", availableSummaryMonths[nextStartIndex]);
      next.set("summary_end", availableSummaryMonths[nextEndIndex]);
      const focus = next.get("summary_focus");
      if (focus && focus !== SUMMARY_FOCUS_OVERALL && !rangeMonths.includes(focus)) {
        next.delete("summary_focus");
      }
      return next;
    });
  }

  // Month picker selections rewrite the route to the chosen month.
  function handleDetailMonthSelect(month) {
    if (!isDetailMonthTab || !availableMonths.includes(month)) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("month", month);
      return next;
    });
  }

  // The summary range start picker keeps the end month fixed and clamps the
  // focus into the new interval.
  function handleSummaryStartMonthSelect(startMonth) {
    if (isDetailMonthTab || !summaryPage) {
      return;
    }

    const endMonth = summaryPage.rangeEndMonth;
    if (startMonth > endMonth) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", endMonth);
      const focus = next.get("summary_focus");
      const nextRangeMonths = summaryPage.availableMonths.filter((month) => month >= startMonth && month <= endMonth);
      if (focus && focus !== SUMMARY_FOCUS_OVERALL && !nextRangeMonths.includes(focus)) {
        next.delete("summary_focus");
      }
      return next;
    });
  }

  // The summary range end picker mirrors the start picker but updates the
  // right edge of the range.
  function handleSummaryEndMonthSelect(endMonth) {
    if (isDetailMonthTab || !summaryPage) {
      return;
    }

    const startMonth = summaryPage.rangeStartMonth;
    if (endMonth < startMonth) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", endMonth);
      const focus = next.get("summary_focus");
      const nextRangeMonths = summaryPage.availableMonths.filter((month) => month >= startMonth && month <= endMonth);
      if (focus && focus !== SUMMARY_FOCUS_OVERALL && !nextRangeMonths.includes(focus)) {
        next.delete("summary_focus");
      }
      return next;
    });
  }

  // Category appearance updates are optimistic in the UI but still persisted to
  // the server immediately.
  async function handleCategoryAppearanceChange(categoryId, nextAppearance) {
    const normalizedAppearance = { ...nextAppearance };
    if (typeof nextAppearance.name === "string") {
      normalizedAppearance.slug = slugify(nextAppearance.name);
    }

    setCategoryOverrides((current) => ({
      ...current,
      [categoryId]: {
        ...(current[categoryId] ?? {}),
        ...normalizedAppearance
      }
    }));

    const response = await fetch("/api/categories/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        categoryId,
        name: normalizedAppearance.name,
        slug: normalizedAppearance.slug,
        iconKey: normalizedAppearance.iconKey,
        colorHex: normalizedAppearance.colorHex
      })
    });
    if (!response.ok) {
      throw new Error("Category appearance could not be saved.");
    }
    clearAppShellCache();
  }

  // Login registration links the current email to a household member and then
  // refreshes shell state so the new identity is visible everywhere.
  async function handleRegisterLogin(event) {
    event.preventDefault();
    if (!loginRegistrationDraft?.personId) {
      setLoginRegistrationError("Choose a household profile for this login.");
      return;
    }

    setLoginRegistrationError("");
    setIsRegisteringLogin(true);
    try {
      const response = await fetch("/api/login-identities/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personId: loginRegistrationDraft.personId,
          name: loginRegistrationDraft.name
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Login could not be linked.");
      }
      setLoginRegistrationDraft(null);
      setLoginIdentityError("");
      setSuppressedLoginRegistrationEmail("");
      clearAppShellCache();
      clearRoutePageCache();
      clearEntriesPageCache();
      await refreshAppShell({ broadcast: true });
      if (selectedTabId === "splits") {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("view", data.personId ?? loginRegistrationDraft.personId);
          return next;
        }, { replace: true });
      }
    } catch (error) {
      setLoginRegistrationError(error instanceof Error ? error.message : "Login could not be linked.");
    } finally {
      setIsRegisteringLogin(false);
    }
  }

  // Unregistering the login clears the local identity and rehydrates the shell
  // so the app falls back to the anonymous household view.
  async function handleUnregisterLogin() {
    const viewerEmail = appShell.viewerIdentity?.email;
    const viewerPersonId = appShell.viewerIdentity?.personId;
    setLoginIdentityError("");
    setIsUnregisteringLogin(true);
    try {
      const response = await fetch("/api/login-identities/unregister", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Login could not be unregistered.");
      }
      clearAppShellCache();
      clearRoutePageCache();
      clearEntriesPageCache();
      if (viewerEmail) {
        setSuppressedLoginRegistrationEmail(viewerEmail);
      }
      await refreshAppShell({ broadcast: true });
      if (selectedTabId === "splits" && viewerPersonId && selectedViewId === viewerPersonId) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("view", "household");
          return next;
        }, { replace: true });
      }
    } catch (error) {
      setLoginIdentityError(error instanceof Error ? error.message : "Login could not be unregistered.");
    } finally {
      setIsUnregisteringLogin(false);
    }
  }

  // Logout is delegated to the Cloudflare Access endpoint rather than the app
  // shell because it is an auth boundary, not an in-app state change.
  function handleLogout() {
    window.location.href = "/cdn-cgi/access/logout";
  }

  // Render the shell chrome, the active route panel, and the login setup modal
  // in one place so the top-level orchestration stays explicit.
  return (
    <main className="shell">
      <EnvironmentBanner environment={appEnvironment} />
      {/* Top chrome keeps the route tabs, view pills, and period controls in one visible block. */}
      <section className="control-bar">
        <div className={`context-block ${showMobileContextSticky ? "has-mobile-sticky-context" : ""}`}>
          <div className="pill-row">
            {selectedTabId !== "splits"
              ? (
                  <button
                    className={`pill ${selectedViewId === "household" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => handleViewChange("household")}
                  >
                    {messages.views.household}
                  </button>
                )
              : (
                  <span className="pill pill-disabled" aria-disabled="true">
                    {messages.views.household}
                  </span>
                )}
            {appShell.household.people.map((person) => (
              <button
                key={person.id}
                className={`pill ${selectedViewId === person.id ? "is-active" : ""}`}
                type="button"
                onClick={() => handleViewChange(person.id)}
                title={person.name}
              >
                {selectedViewId === person.id ? person.name : getInactivePersonViewLabel(person.name)}
              </button>
            ))}
          </div>
        </div>

        <div className="period-inline">
          <ShellRouteTabs
            primaryTabs={primaryRouteTabs}
            secondaryTabs={secondaryRouteTabs}
            selectedTabId={selectedTabId}
            buildTabTarget={buildTabTarget}
            getNavIntentProps={getNavIntentProps}
            pendingCategorySuggestionCount={pendingCategorySuggestionCount}
          />
          <div className={`period-nav-cluster ${isSplitsTab ? "is-passive" : ""}`}>
            <button className="period-button" type="button" aria-label={messages.period.previousAriaLabel} onClick={() => handleMonthChange(-1)} disabled={isSplitsTab}>‹</button>
            <div className="period-display">
              <span className="period-mode">{periodMode}</span>
              {isDetailMonthTab ? (
                <strong className="period-range-value">
                  <PeriodMonthPicker
                    triggerLabel={periodLabel}
                    disabled={isSplitsTab}
                    title="Month"
                    hint="Choose a single month for this view."
                    yearsAriaLabel="Available years"
                    years={detailAvailableYears}
                    activeYear={monthPickerYear}
                    onYearChange={setMonthPickerYear}
                    months={detailAvailableMonthsForPickerYear}
                    selectedMonth={selectedMonth}
                    closeOnSelect
                    onSelect={handleDetailMonthSelect}
                  />
                </strong>
              ) : summaryPage?.rangeStartMonth && summaryPage?.rangeEndMonth ? (
                <strong className="period-range-value">
                  <PeriodMonthPicker
                    triggerLabel={formatMonthLabel(pageView.summaryPage.rangeStartMonth)}
                    title="Start month"
                    hint="Choose the first month in the summary range."
                    yearsAriaLabel="Available start years"
                    years={summaryAvailableYears}
                    activeYear={rangePickerStartYear}
                    onYearChange={setRangePickerStartYear}
                    months={summaryAvailableMonthsForPickerYear}
                    selectedMonth={pageView.summaryPage.rangeStartMonth}
                    isMonthDisabled={(month) => month > pageView.summaryPage.rangeEndMonth}
                    onSelect={handleSummaryStartMonthSelect}
                  />
                  <span className="period-range-separator" aria-hidden="true">-</span>
                  <PeriodMonthPicker
                    triggerLabel={formatMonthLabel(pageView.summaryPage.rangeEndMonth)}
                    title="End month"
                    hint="Choose the last month in the summary range."
                    yearsAriaLabel="Available end years"
                    years={summaryAvailableYears}
                    activeYear={rangePickerEndYear}
                    onYearChange={setRangePickerEndYear}
                    months={summaryAvailableMonthsForEndPickerYear}
                    selectedMonth={pageView.summaryPage.rangeEndMonth}
                    isMonthDisabled={(month) => month < pageView.summaryPage.rangeStartMonth}
                    onSelect={handleSummaryEndMonthSelect}
                  />
                </strong>
              ) : (
                <strong className="period-range-value">{periodLabel}</strong>
              )}
            </div>
            <button className="period-button" type="button" aria-label={messages.period.nextAriaLabel} onClick={() => handleMonthChange(1)} disabled={isSplitsTab}>›</button>
          </div>
          <TotalsVisibilityToggle className="totals-visibility-toggle--header" />
        </div>
      </section>

      {/* The mobile sticky sheet mirrors the desktop chrome without forcing the user to scroll back to the top. */}
      {showMobileContextSticky ? (
        <section className="mobile-context-sticky-wrap" aria-label={stickyScopeConfig.label}>
          <div className="mobile-context-sticky-bar">
            <Dialog.Root open={mobileContextOpen} onOpenChange={setMobileContextOpen}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="mobile-context-trigger"
                  aria-label={stickyScopeConfig.label}
                  onClick={(event) => {
                    event.currentTarget.blur();
                  }}
                >
                  <span className="mobile-context-trigger-copy">
                    {/* The label wraps between the name and the scope rather than truncating. */}
                    <span className="mobile-context-trigger-label">
                      <span className="mobile-context-trigger-person">{pageView?.label ?? ""}</span>
                      {mobileContextScopeLabel ? (
                        <> <span className="mobile-context-trigger-scope">· {mobileContextScopeLabel}</span></>
                      ) : null}
                    </span>
                    <span className="mobile-context-trigger-hint">
                      {showMobileContextScopeSection ? "View and scope" : "View"}
                    </span>
                  </span>
                  <span className="mobile-context-trigger-caret" aria-hidden="true">▾</span>
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="note-dialog-overlay" />
                <Dialog.Content
                  className="note-dialog-content split-dialog-content mobile-context-dialog"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <div className="note-dialog-head mobile-context-dialog-head">
                    <div>
                      <Dialog.Title>View and scope</Dialog.Title>
                      <Dialog.Description>
                        Change the active household view without scrolling back to the top.
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button type="button" className="subtle-action mobile-context-dialog-close">Done</button>
                    </Dialog.Close>
                  </div>

                  <section className="mobile-context-dialog-section" aria-label="View">
                    <strong className="mobile-context-dialog-section-title">View</strong>
                    <div className="pill-row mobile-context-pill-row mobile-context-view-row">
                      {renderedTabId !== "splits"
                        ? (
                            <button
                              className={`pill ${selectedViewId === "household" ? "is-active" : ""}`}
                              type="button"
                              onClick={() => handleViewChange("household")}
                            >
                              {messages.views.household}
                            </button>
                          )
                        : (
                            <span className="pill pill-disabled" aria-disabled="true">
                              {messages.views.household}
                            </span>
                          )}
                      {appShell.household.people.map((person) => (
                        <button
                          key={person.id}
                          className={`pill ${selectedViewId === person.id ? "is-active" : ""}`}
                          type="button"
                          onClick={() => handleViewChange(person.id)}
                          title={person.name}
                        >
                          {person.name}
                        </button>
                      ))}
                    </div>
                  </section>

                  {showMobileContextScopeSection ? (
                    <section className="mobile-context-dialog-section" aria-label="Scope">
                      <strong className="mobile-context-dialog-section-title">Scope</strong>
                      <div className="scope-toggle pill-row scope-toggle-row mobile-context-pill-row">
                        {mobileContextScopes.map((scope) => (
                          <button
                            key={scope.key}
                            className={`pill scope-button ${scope.key === stickyScopeConfig.selectedKey ? "is-active" : ""}`}
                            type="button"
                            onClick={() => handleStickyScopeChange(scope.key)}
                          >
                            {scope.label}
                          </button>
                        ))}
                      </div>
                      {mobileContextScopeHint ? (
                        <p className="mobile-context-dialog-hint">{mobileContextScopeHint}</p>
                      ) : null}
                    </section>
                  ) : null}

                  {renderedTabId === "entries" && entriesMobileFilterProps ? (
                    <section className="mobile-context-dialog-section mobile-context-dialog-filters-slot" aria-label="Filters">
                      <Suspense fallback={null}>
                        <EntriesFilterStack {...entriesMobileFilterProps} />
                      </Suspense>
                    </section>
                  ) : null}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            {showMobileMonthJump ? (
              <div className="mobile-month-jump" aria-label="Month navigation">
                <button
                  className="period-button mobile-month-jump-button"
                  type="button"
                  aria-label={messages.period.previousAriaLabel}
                  onClick={() => handleMonthChange(-1)}
                  disabled={!canMoveToPreviousDetailMonth}
                >
                  ‹
                </button>
                <button
                  className="period-button mobile-month-jump-button"
                  type="button"
                  aria-label={messages.period.nextAriaLabel}
                  onClick={() => handleMonthChange(1)}
                  disabled={!canMoveToNextDetailMonth}
                >
                  ›
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The routed panel area is the actual screen body; every tab renders through this slot. */}
      <section className="grid app-route-grid" aria-busy={isAppShellLoading ? "true" : "false"}>
        {/* Route panels can hydrate lazily, so the fallback stays inside the
            routed region instead of replacing the whole shell. */}
        {showImportInboxBanner ? (
          <ImportInboxRouteBanner
            inbox={importInboxBanner}
            onOpenImports={() => navigate(buildTabPath("imports", {
              viewId: selectedViewId,
              month: selectedMonth,
              scope: selectedScope
            }))}
          />
        ) : null}
        {refreshNotice ? (
          <RefreshFailureNotice
            onRetry={refreshNoticeOwner.retry}
            onDismiss={refreshNoticeOwner.dismiss}
          />
        ) : null}
        <ScreenErrorBoundary resetKey={screenErrorResetKey} onRetry={retryActivePageLoad} onReset={clearLoadingIssue}>
          {routeBody}
        </ScreenErrorBoundary>
        {isAppShellLoading ? <AppLoadingOverlay status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} /> : null}
      </section>

      {/* Login registration is modal because it must interrupt the flow only when the shell has no stable identity mapping. */}
      {loginRegistrationDraft ? (
        <LoginRegistrationDialog
          draft={loginRegistrationDraft}
          people={appShell.household.people}
          error={loginRegistrationError}
          isSubmitting={isRegisteringLogin}
          onSubmit={handleRegisterLogin}
          onPersonChange={(personId) => {
            const person = appShell.household.people.find((item) => item.id === personId);
            setLoginRegistrationDraft((current) => current ? {
              ...current,
              personId,
              name: isPlaceholderPersonName(person?.name) ? "" : person?.name ?? current.name
            } : current);
          }}
          onNameChange={(name) => setLoginRegistrationDraft((current) => current ? { ...current, name } : current)}
        />
      ) : null}

      {renderedTabId === "entries" && typeof document !== "undefined"
        ? createPortal(
            <button type="button" className="entries-fab" onClick={() => {
              const trigger = document.querySelector("[data-entries-fab-trigger='true']");
              if (trigger instanceof HTMLButtonElement) {
                trigger.click();
              }
            }} aria-label={messages.entries.addEntry} title={messages.entries.addEntry}>
              <Plus size={24} />
            </button>,
            document.body
          )
        : null}

      {["summary", "month", "entries", "splits"].includes(renderedTabId) && typeof document !== "undefined"
        ? createPortal(
            <TotalsVisibilityToggle
              className={`totals-visibility-toggle--floating totals-visibility-toggle--${renderedTabId}${
                renderedTabId === "splits" && pageView.id === "household" ? " totals-visibility-toggle--splits-standalone" : ""
              }`}
            />,
            document.body
          )
        : null}

      {renderedTabId === "splits" && pageView.id !== "household" && typeof document !== "undefined"
        ? createPortal(
            <button type="button" className="entries-fab splits-fab" onClick={() => {
              const trigger = document.querySelector("[data-splits-fab-trigger='true']");
              if (trigger instanceof HTMLButtonElement) {
                trigger.click();
              }
            }} aria-label={messages.splits.addExpense} title={messages.splits.addExpense}>
              <Receipt size={24} />
            </button>,
            document.body
          )
        : null}
    </main>
  );
}

// A background refresh after a save failed: the saved result stays on
// screen, and the person can refresh again without losing their place.
function RefreshFailureNotice({ onRetry, onDismiss }) {
  return (
    <section className="import-stale-banner refresh-failure-notice" role="status">
      <div>
        <strong>{messages.common.refreshFailedTitle}</strong>
        <span>{messages.common.refreshFailedDetail}</span>
      </div>
      <div className="refresh-failure-notice-actions">
        <button type="button" className="dialog-primary" onClick={onRetry}>
          {messages.common.refreshFailedRetry}
        </button>
        <button type="button" className="subtle-action" onClick={onDismiss}>
          {messages.common.refreshFailedDismiss}
        </button>
      </div>
    </section>
  );
}

function ImportInboxRouteBanner({ inbox, onOpenImports }) {
  return (
    <section className="import-stale-banner" role="status">
      <div>
        <strong>{messages.imports.routeBannerTitle(inbox.summary.requiredFileCount)}</strong>
        <span>{messages.imports.routeBannerDetail(inbox.summary.institutionCount, inbox.summary.pendingSplitMatchCount)}</span>
      </div>
      <button type="button" className="dialog-primary" onClick={onOpenImports}>
        {messages.imports.routeBannerAction}
      </button>
    </section>
  );
}

function buildTabPath(tabId, { viewId, month, scope }) {
  const params = new URLSearchParams();
  if (viewId) {
    params.set("view", viewId);
  }
  if (month) {
    params.set("month", month);
  }
  if (scope) {
    params.set("scope", scope);
  }
  return {
    pathname: `/${tabId}`,
    search: `?${params.toString()}`
  };
}

// Detect placeholder household names that should be replaced with the real
// person name during login setup.
function isPlaceholderPersonName(name) {
  return ["primary", "partner"].includes(String(name ?? "").trim().toLowerCase());
}

// Compare the mobile entries filter props deeply enough to avoid rerender
// loops while still updating when the filter stack actually changes.
function areEntriesMobileFilterPropsEqual(current, next) {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    return current === next;
  }
  return (
    current.showMobileFilters === next.showMobileFilters
    && current.activeEntryFilterCount === next.activeEntryFilterCount
    && current.hideToggle === next.hideToggle
    && current.hideRefresh === next.hideRefresh
    && current.onToggleMobileFilters === next.onToggleMobileFilters
    && current.onChangeFilter === next.onChangeFilter
    && current.onResetFilters === next.onResetFilters
    && current.onRefresh === next.onRefresh
    && current.onDone === next.onDone
    && current.wallets === next.wallets
    && current.entryCategoryOptions === next.entryCategoryOptions
    && areEntryFilterValuesEqual(current.entryFilters, next.entryFilters)
  );
}

// Compare the active entry filter values so the mobile stack can stay in sync
// without treating every new array reference as a real change.
function areEntryFilterValuesEqual(current, next) {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    return current === next;
  }
  return (
    current.type === next.type
    && areStringArraysEqual(current.entryIds, next.entryIds)
    && areStringArraysEqual(current.wallets, next.wallets)
    && areStringArraysEqual(current.categories, next.categories)
  );
}

// Compare string arrays by value for the filter helpers above.
function areStringArraysEqual(current, next) {
  if (current === next) {
    return true;
  }
  if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) {
    return false;
  }
  return current.every((value, index) => value === next[index]);
}
