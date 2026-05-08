import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  Receipt,
  Ellipsis,
  Plus
} from "lucide-react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import {
  APP_SYNC_CHANNEL,
  APP_SYNC_EVENT_TYPES,
  APP_SYNC_STORAGE_KEY,
  broadcastAppShellRefresh,
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
  buildPageViewFromRouteData,
  buildRoutePageRequest,
  getSelectedTabId,
  sanitizeTabParams
} from "./app-routing";
import { EntriesFilterStack } from "./entries-overview";
import { moniesClient } from "./monies-client-service";
import {
  buildAppShellErrorMessage,
  buildRequestErrorMessage,
  describeAppShellError
} from "./request-errors";
import { installMobileFocusVisibility } from "./mobile-focus-visibility";
import { queryKeys } from "./query-keys";
import { getCurrentMonthKey } from "../lib/month";

const routeModuleLoaders = {
  entries: () => import("./entries-panel.jsx"),
  faq: () => import("./faq-panel.jsx"),
  imports: () => import("./imports-panel.jsx"),
  month: () => import("./month-panel.jsx"),
  settings: () => import("./settings-panel.jsx"),
  splits: () => import("./splits-panel.jsx"),
  summary: () => import("./summary-panel.jsx")
};
const routeModulePreloads = new Map();

const EntriesPanel = lazy(() => routeModuleLoaders.entries().then((module) => ({ default: module.EntriesPanel })));
const FaqPanel = lazy(() => routeModuleLoaders.faq().then((module) => ({ default: module.FaqPanel })));
const ImportsPanel = lazy(() => routeModuleLoaders.imports().then((module) => ({ default: module.ImportsPanel })));
const MonthPanel = lazy(() => routeModuleLoaders.month().then((module) => ({ default: module.MonthPanel })));
const SettingsPanel = lazy(() => routeModuleLoaders.settings().then((module) => ({ default: module.SettingsPanel })));
const SplitsPanel = lazy(() => routeModuleLoaders.splits().then((module) => ({ default: module.SplitsPanel })));
const SummaryPanel = lazy(() => routeModuleLoaders.summary().then((module) => ({ default: module.SummaryPanel })));

const SUMMARY_FOCUS_OVERALL = "overall";
const MONTH_PICKER_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_MONTH_KEY = getCurrentMonthKey();
const { categories: categoryService, format: formatService } = moniesClient;

const routeTabs = [
  { id: "summary", path: "/summary", label: messages.tabs.summary },
  { id: "month", path: "/month", label: messages.tabs.month },
  { id: "entries", path: "/entries", label: messages.tabs.entries },
  { id: "splits", path: "/splits", label: messages.tabs.splits },
  { id: "imports", path: "/imports", label: messages.tabs.imports },
  { id: "settings", path: "/settings", label: messages.tabs.settings },
  { id: "faq", path: "/faq", label: messages.tabs.faq }
];
const primaryRouteTabs = routeTabs.slice(0, 4);
const secondaryRouteTabs = routeTabs.slice(4);
const PAGE_PREFETCH_DELAY_MS = 1200;
const PAGE_PREFETCH_SPACING_MS = 1500;
const PAGE_PREFETCH_STAGE_DELAY_MS = 5000;
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

function ellipsizeText(value, maxLength = 52) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function preloadRouteModule(routeId) {
  const loader = routeModuleLoaders[routeId];
  if (!loader) {
    return;
  }
  if (!routeModulePreloads.has(routeId)) {
    routeModulePreloads.set(routeId, loader().catch(() => {
      routeModulePreloads.delete(routeId);
    }));
  }
}

function scheduleIdleTask(callback, timeout = 1000) {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (typeof window.requestIdleCallback === "function") {
    return { type: "idle", id: window.requestIdleCallback(callback, { timeout }) };
  }
  return { type: "timeout", id: window.setTimeout(callback, timeout) };
}

function cancelIdleTask(handle) {
  if (!handle || typeof window === "undefined") {
    return;
  }
  if (handle.type === "idle" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle.id);
    return;
  }
  window.clearTimeout(handle.id);
}

function waitFor(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

function EnvironmentBanner({ environment }) {
  if (environment !== "demo" && environment !== "local") {
    return null;
  }

  return (
    <div className={`environment-banner environment-banner-${environment}`}>
      {environment}
    </div>
  );
}

function getDocumentTitle(environment) {
  if (environment === "demo" || environment === "local") {
    return `${APP_DOCUMENT_TITLE} - ${environment}`;
  }
  return APP_DOCUMENT_TITLE;
}

function getInactivePersonViewLabel(name) {
  const trimmedName = name.trim();
  const firstName = trimmedName.split(/\s+/)[0] ?? trimmedName;
  if (firstName.length <= 10) {
    return firstName;
  }
  return `${firstName.slice(0, 9)}...`;
}

export function App() {
  const queryClient = useQueryClient();
  const [appShell, setAppShell] = useState(null);
  const [appShellError, setAppShellError] = useState("");
  const [appShellLoadCount, setAppShellLoadCount] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState(() => createLoadingStatus());
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [entriesMobileFilterProps, setEntriesMobileFilterProps] = useState(null);
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
  const syncChannelRef = useRef(null);
  const queryEpochRef = useRef(0);
  const routePagePrefetchTimerRef = useRef(null);
  const appEnvironment = appShell?.appEnvironment ?? getClientAppEnvironment();
  const explicitViewId = searchParams.get("view");
  const selectedViewId = explicitViewId ?? "household";
  const selectedTabId = getSelectedTabId(location.pathname);
  const selectedMonth = searchParams.get("month") ?? DEFAULT_MONTH_KEY;
  const selectedScope = searchParams.get("scope") ?? "direct_plus_shared";
  const selectedSummaryStart = searchParams.get("summary_start") ?? undefined;
  const selectedSummaryEnd = searchParams.get("summary_end") ?? undefined;
  const isAppShellLoading = appShellLoadCount > 0;
  const [routePageData, setRoutePageData] = useState(null);
  const [entriesExternalRefreshToken, setEntriesExternalRefreshToken] = useState(0);
  const [loginRegistrationDraft, setLoginRegistrationDraft] = useState(null);
  const [loginRegistrationError, setLoginRegistrationError] = useState("");
  const [isRegisteringLogin, setIsRegisteringLogin] = useState(false);
  const [loginIdentityError, setLoginIdentityError] = useState("");
  const [isUnregisteringLogin, setIsUnregisteringLogin] = useState(false);
  const [suppressedLoginRegistrationEmail, setSuppressedLoginRegistrationEmail] = useState("");
  const appShellMonth = selectedMonth;
  const appShellSummaryStart = selectedSummaryStart;
  const appShellSummaryEnd = selectedSummaryEnd;
  const appShellScope = selectedScope;

  useEffect(() => installMobileFocusVisibility(), []);

  useEffect(() => {
    document.title = getDocumentTitle(appEnvironment);
  }, [appEnvironment]);

  const canUseAppShellRoutePage = false;
  const appShellParams = useMemo(
    () => buildAppShellParams({
      month: selectedMonth,
      scope: selectedScope,
      summaryStart: selectedSummaryStart,
      summaryEnd: selectedSummaryEnd
    }),
    [selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart]
  );
  const appShellCacheKey = appShellParams.toString();
  const routePageRequest = useMemo(
    () => canUseAppShellRoutePage ? null : buildRoutePageRequest({
      tabId: selectedTabId,
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope,
      summaryStart: selectedSummaryStart,
      summaryEnd: selectedSummaryEnd
    }),
    [canUseAppShellRoutePage, selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart, selectedTabId, selectedViewId]
  );

  const updateLoadingStatus = useCallback((patch) => {
    setLoadingStatus((current) => ({
      ...current,
      ...patch,
      updatedAt: Date.now()
    }));
  }, []);

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

  const bumpQueryEpoch = useCallback(() => {
    queryEpochRef.current += 1;
  }, []);

  const clearAppShellCache = useCallback(() => {
    bumpQueryEpoch();
    queryClient.cancelQueries({ queryKey: queryKeys.appShell() });
    queryClient.removeQueries({ queryKey: queryKeys.appShell() });
    clearPersistedAppShell();
  }, [bumpQueryEpoch, queryClient]);

  const clearRoutePageCache = useCallback(() => {
    bumpQueryEpoch();
    queryClient.cancelQueries({ queryKey: ["route-page"] });
    queryClient.removeQueries({ queryKey: ["route-page"] });
  }, [bumpQueryEpoch, queryClient]);

  const clearEntriesPageCache = useCallback(() => {
    bumpQueryEpoch();
    queryClient.cancelQueries({ queryKey: ["entries-page"] });
    queryClient.removeQueries({ queryKey: ["entries-page"] });
  }, [bumpQueryEpoch, queryClient]);

  const fetchEntriesPageData = useCallback(async (params, { bypassCache = false, signal } = {}) => {
    const queryKey = queryKeys.entriesPage(params);
    const queryState = queryClient.getQueryState(queryKey);
    if (signal?.aborted) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }

    if (!bypassCache) {
      const cachedData = queryClient.getQueryData(queryKey);
      if (cachedData) {
        return cachedData;
      }
    }

    const fetcher = async () => {
      const response = await fetch(`/api/entries-page?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, "Entries page failed."));
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
      throw new DOMException("Entries page request aborted.", "AbortError");
    }
    return data;
  }, [queryClient]);

  const fetchAppShellData = useCallback(async (params, { bypassCache = false, signal } = {}) => {
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

    const fetcher = async () => {
      const response = await fetch(`/api/app-shell?${cacheKey}`, { cache: "no-store" });
        updateLoadingStatus({
          label: "Reading dashboard response",
          detail: "Parsing dashboard...",
          percent: 55
        });
        const responseText = await response.text();
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
          staleTime: 0
        })
      : await queryClient.ensureQueryData({
          queryKey,
          queryFn: fetcher,
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

  const fetchEntriesShellData = useCallback(async (params, { signal } = {}) => {
    if (signal?.aborted) {
      throw new DOMException("Entries shell request aborted.", "AbortError");
    }

    updateLoadingStatus({
      label: "Opening entry view",
      detail: "Loading entries...",
      percent: 22
    });
    const response = await fetch(`/api/entries-shell?${params.toString()}`, {
      cache: "no-store",
      signal
    });
    updateLoadingStatus({
      label: "Preparing entry view",
      detail: "Opening editor...",
      percent: 48
    });
    const responseText = await response.text();
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

  const loadAppShell = useCallback(async (signal, { bypassCache = false } = {}) => {
    const data = await fetchAppShellData(appShellParams, { bypassCache, signal });

    setAppShellError("");
    setAppShell(data);
    return data;
  }, [appShellParams, fetchAppShellData]);

  const handleAppShellFailure = useCallback((error) => {
    setAppShell(null);
    setAppShellError(describeAppShellError(error));
    reportLoadingIssue("Load failed", error);
    updateLoadingStatus({
      label: "Dashboard load failed",
      detail: "App shell request did not complete",
      percent: 100
    });
  }, [reportLoadingIssue, updateLoadingStatus]);

  const refreshAppShell = useCallback(async ({ broadcast = false } = {}) => {
    clearAppShellCache();
    clearRoutePageCache();
    setRoutePageData(null);
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
  }, [beginAppShellLoad, clearAppShellCache, clearRoutePageCache, loadAppShell]);

  const refreshAppShellInBackground = useCallback(async () => {
    clearAppShellCache();
    const data = await fetchAppShellData(appShellParams, { bypassCache: true });
    setAppShellError("");
    setAppShell(data);
    return data;
  }, [appShellParams, clearAppShellCache, fetchAppShellData]);

  const fetchRoutePageData = useCallback(async (request, { bypassCache = false, signal } = {}) => {
    if (!request) {
      return null;
    }

    const queryKey = queryKeys.routePage(request);
    const queryState = queryClient.getQueryState(queryKey);
    if (signal?.aborted) {
      throw new DOMException("Page request aborted.", "AbortError");
    }

    if (!bypassCache && queryClient.getQueryData(queryKey)) {
      updateLoadingStatus({
        label: "Using cached page data",
        detail: "Cached page...",
        percent: 84
      });
      return queryClient.getQueryData(queryKey);
    }

    if (!bypassCache && queryState?.fetchStatus === "fetching") {
      updateLoadingStatus({
        label: "Waiting for page data",
        detail: "Waiting for page...",
        percent: 86
      });
    }

    const query = request.params.toString();
    const requestUrl = query ? `${request.path}?${query}` : request.path;
    updateLoadingStatus({
      label: "Loading current page",
      detail: "Loading page...",
      percent: 88
    });
    const fetcher = async () => {
      const response = await fetch(requestUrl, { cache: "no-store" });
        updateLoadingStatus({
          label: "Reading page response",
          detail: "Parsing page...",
          percent: 92
        });
        const responseText = await response.text();
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
      throw new DOMException("Page request aborted.", "AbortError");
    }
    updateLoadingStatus({
      label: "Current page ready",
      detail: "Applying page...",
      percent: 96
    });
    return data;
  }, [queryClient, updateLoadingStatus]);

  const refreshRoutePage = useCallback(async ({ broadcast = false, refreshShell = false } = {}) => {
    clearRoutePageCache();
    clearAppShellCache();
    clearEntriesPageCache();

    if (!routePageRequest) {
      return refreshAppShell({ broadcast });
    }

    if (refreshShell) {
      await refreshAppShell({ broadcast });
    }

    const finishAppShellLoad = beginAppShellLoad();
    try {
      const data = await fetchRoutePageData(routePageRequest, { bypassCache: true });
      setRoutePageData(data);
      return data;
    } finally {
      finishAppShellLoad();
    }
  }, [beginAppShellLoad, clearAppShellCache, clearEntriesPageCache, clearRoutePageCache, fetchRoutePageData, refreshAppShell, routePageRequest]);

  const refreshCurrentMonthPage = useCallback(async () => {
    const request = buildRoutePageRequest({
      tabId: "month",
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope
    });
    if (!request) {
      return null;
    }

    const [data] = await Promise.all([
      fetchRoutePageData(request, { bypassCache: true }),
      refreshAppShellInBackground().catch(() => null)
    ]);
    setRoutePageData(data);
    return data;
  }, [fetchRoutePageData, refreshAppShellInBackground, selectedMonth, selectedScope, selectedViewId]);

  const refreshCurrentImportsPage = useCallback(async ({ broadcast = false, refreshShell = false } = {}) => {
    const request = buildRoutePageRequest({
      tabId: "imports",
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope
    });
    if (!request) {
      return null;
    }

    const tasks = [fetchRoutePageData(request, { bypassCache: true })];
    if (refreshShell) {
      tasks.push(refreshAppShellInBackground().catch(() => null));
    }
    const [data] = await Promise.all(tasks);
    setRoutePageData(data);

    if (broadcast) {
      broadcastAppShellRefresh(syncChannelRef);
    }

    return data;
  }, [fetchRoutePageData, refreshAppShellInBackground, selectedMonth, selectedScope, selectedViewId]);

  const clearRoutePageCacheByPredicate = useCallback((predicate) => {
    queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [queryClient]);

  const clearEntriesPageCacheByPredicate = useCallback((predicate) => {
    queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [queryClient]);

  const clearSplitMutationCaches = useCallback(({
    month,
    invalidateEntries = false,
    invalidateMonth = false,
    invalidateSummary = false,
    refreshShell = false
  }) => {
    clearRoutePageCacheByPredicate((query) => (
      query.queryKey?.[0] === "route-page"
      && query.queryKey?.[1]?.path === "/api/splits-page"
      && query.queryKey?.[1]?.params?.month === month
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
      clearRoutePageCacheByPredicate((query) => (
        query.queryKey?.[0] === "route-page"
        && query.queryKey?.[1]?.path === "/api/summary-page"
        && isMonthWithinRange(
          month,
          query.queryKey?.[1]?.params?.summary_start,
          query.queryKey?.[1]?.params?.summary_end
        )
      ));
    }

    if (refreshShell || invalidateEntries || invalidateMonth || invalidateSummary) {
      clearAppShellCache();
    }
  }, [
    clearAppShellCache,
    clearEntriesPageCacheByPredicate,
    clearRoutePageCacheByPredicate
  ]);

  const refreshActiveRoutePageInBackground = useCallback(async (request) => {
    if (!request) {
      return null;
    }

    const data = await fetchRoutePageData(request, { bypassCache: true });
    setRoutePageData(data);
    return data;
  }, [fetchRoutePageData]);

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
      tasks.push(refreshAppShellInBackground().catch(() => null));
    }
    const [data] = await Promise.all(tasks);
    setRoutePageData(data);

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
    selectedMonth,
    selectedScope,
    selectedViewId
  ]);

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
      tasks.push(refreshActiveRoutePageInBackground(routePageRequest).catch(() => null));
    } else if (selectedTabId === "month" && invalidateMonth && selectedMonth === month) {
      if (canUseAppShellRoutePage) {
        tasks.push(refreshAppShellInBackground().catch(() => null));
      } else {
        tasks.push(refreshActiveRoutePageInBackground(routePageRequest).catch(() => null));
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
      if (canUseAppShellRoutePage) {
        tasks.push(refreshAppShellInBackground().catch(() => null));
      } else {
        tasks.push(refreshActiveRoutePageInBackground(routePageRequest).catch(() => null));
      }
    }

    await Promise.all(tasks);
  }, [
    appShellSummaryEnd,
    appShellSummaryStart,
    canUseAppShellRoutePage,
    clearSplitMutationCaches,
    refreshActiveRoutePageInBackground,
    refreshAppShellInBackground,
    routePageRequest,
    selectedMonth,
    selectedSummaryEnd,
    selectedSummaryStart,
    selectedTabId
  ]);

  const syncAppShellAfterMutation = useCallback(async () => {
    await refreshAppShellInBackground();
  }, [refreshAppShellInBackground]);

  const prefetchRoutePage = useCallback(async (request) => {
    if (!request) {
      return;
    }

    const queryKey = queryKeys.routePage(request);
    const queryState = queryClient.getQueryState(queryKey);
    if (queryClient.getQueryData(queryKey) || queryState?.fetchStatus === "fetching") {
      return;
    }

    await fetchRoutePageData(request).catch(() => {});
  }, [fetchRoutePageData, queryClient]);

  const prefetchEntriesPage = useCallback(async (params) => {
    const queryKey = queryKeys.entriesPage(params);
    const queryState = queryClient.getQueryState(queryKey);
    if (queryClient.getQueryData(queryKey) || queryState?.fetchStatus === "fetching") {
      return;
    }

    await fetchEntriesPageData(params).catch(() => {});
  }, [fetchEntriesPageData, queryClient]);

  useEffect(() => {
    const controller = new AbortController();
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

    void (async () => {
      try {
        if (shouldUseEntriesShell) {
          const shellData = await fetchEntriesShellData(entriesShellParams, {
            signal: controller.signal
          });
          if (!controller.signal.aborted) {
            setAppShellError("");
            setAppShell(shellData);
          }

          const fullData = await fetchAppShellData(appShellParams, {
            bypassCache: true,
            signal: controller.signal
          });
          if (!controller.signal.aborted) {
            setAppShellError("");
            setAppShell(fullData);
          }
          return;
        }

        await loadAppShell(controller.signal);
        if (!hasCachedAppShell || controller.signal.aborted) {
          return;
        }

        try {
          const data = await fetchAppShellData(appShellParams, {
            bypassCache: true,
            signal: controller.signal
          });
          if (!controller.signal.aborted) {
            setAppShellError("");
            setAppShell(data);
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (shouldUseEntriesShell) {
          try {
            const fallbackData = await fetchAppShellData(appShellParams, {
              bypassCache: true,
              signal: controller.signal
            });
            if (!controller.signal.aborted) {
              setAppShellError("");
              setAppShell(fallbackData);
            }
            return;
          } catch (fallbackError) {
            if (fallbackError instanceof DOMException && fallbackError.name === "AbortError") {
              return;
            }
            handleAppShellFailure(fallbackError);
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let channel = null;
    if ("BroadcastChannel" in window) {
      channel = new window.BroadcastChannel(APP_SYNC_CHANNEL);
      syncChannelRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === APP_SYNC_EVENT_TYPES.appShellRefresh) {
          clearAppShellCache();
          clearRoutePageCache();
          const finishAppShellLoad = beginAppShellLoad();
          void loadAppShell()
            .catch(handleAppShellFailure)
            .finally(finishAppShellLoad);
          return;
        }

        if (event.data?.type === APP_SYNC_EVENT_TYPES.splitMutation) {
          void handleRemoteSplitMutation(event.data);
        }
      };
    }

    const handleStorage = (event) => {
      if (event.key !== APP_SYNC_STORAGE_KEY || !event.newValue) {
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(event.newValue);
      } catch {
        return;
      }

      if (payload?.type === APP_SYNC_EVENT_TYPES.appShellRefresh) {
        clearAppShellCache();
        clearRoutePageCache();
          const finishAppShellLoad = beginAppShellLoad();
          void loadAppShell()
            .catch(handleAppShellFailure)
            .finally(finishAppShellLoad);
        return;
      }

      if (payload?.type === APP_SYNC_EVENT_TYPES.splitMutation) {
        void handleRemoteSplitMutation(payload);
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      if (channel) {
        channel.close();
        syncChannelRef.current = null;
      }
    };
  }, [
    beginAppShellLoad,
    clearAppShellCache,
    clearRoutePageCache,
    handleAppShellFailure,
    handleRemoteSplitMutation,
    loadAppShell
  ]);

  const hasAppShell = Boolean(appShell);

  useEffect(() => {
    if (!hasAppShell || !routePageRequest) {
      setRoutePageData(null);
      return undefined;
    }

    const controller = new AbortController();
    const hasCachedPage = Boolean(queryClient.getQueryData(queryKeys.routePage(routePageRequest)));
    if (!hasCachedPage) {
      updateLoadingStatus({
        label: "Preparing current page",
        detail: "Preparing page...",
        percent: 84
      });
    }
    const finishAppShellLoad = hasCachedPage ? null : beginAppShellLoad();

    void fetchRoutePageData(routePageRequest, { signal: controller.signal })
      .then(async (data) => {
        if (controller.signal.aborted) {
          return;
        }

        setRoutePageData(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setRoutePageData(null);
        reportLoadingIssue("Page load failed", error);
      })
      .finally(() => finishAppShellLoad?.());

    return () => {
      controller.abort();
      finishAppShellLoad?.();
    };
  }, [beginAppShellLoad, fetchRoutePageData, hasAppShell, queryClient, reportLoadingIssue, routePageRequest, updateLoadingStatus]);

  const pageView = useMemo(
    () => buildPageViewFromRouteData(selectedTabId, routePageData, selectedViewId, appShell),
    [appShell, routePageData, selectedTabId, selectedViewId]
  );
  const defaultSplitsViewId = appShell?.viewerPersonId
    ?? appShell?.household?.people?.[0]?.id
    ?? appShell?.selectedViewId
    ?? "household";
  const selectedEntriesScope = searchParams.get("entries_scope") ?? pageView?.monthPage?.selectedScope ?? "direct_plus_shared";
  const householdMonthEntries = useMemo(
    () => selectedTabId === "month" && Array.isArray(routePageData?.householdMonthEntries)
      ? routePageData.householdMonthEntries
      : [],
    [routePageData, selectedTabId]
  );
  const categories = useMemo(
    () => appShell?.categories.map((category) => ({ ...category, ...(categoryOverrides[category.id] ?? {}) })) ?? [],
    [appShell, categoryOverrides]
  );
  const availableMonths = useMemo(
    () => pageView?.summaryPage?.availableMonths?.slice().sort() ?? appShell?.trackedMonths ?? [],
    [appShell, pageView]
  );
  const isDetailMonthTab = selectedTabId === "month" || selectedTabId === "entries" || selectedTabId === "splits";
  const isSplitsTab = selectedTabId === "splits";
  const currentDetailMonthIndex = useMemo(
    () => isDetailMonthTab ? availableMonths.indexOf(selectedMonth) : -1,
    [availableMonths, isDetailMonthTab, selectedMonth]
  );
  const canMoveToPreviousDetailMonth = currentDetailMonthIndex > 0;
  const canMoveToNextDetailMonth = currentDetailMonthIndex !== -1 && currentDetailMonthIndex < availableMonths.length - 1;
  const detailAvailableYears = useMemo(
    () => isDetailMonthTab
      ? [...new Set(availableMonths.map((month) => Number(month.slice(0, 4))))].sort((left, right) => left - right)
      : [],
    [availableMonths, isDetailMonthTab]
  );
  const detailAvailableMonthsForPickerYear = useMemo(
    () => isDetailMonthTab && monthPickerYear != null
      ? availableMonths.filter((month) => Number(month.slice(0, 4)) === monthPickerYear)
      : [],
    [availableMonths, isDetailMonthTab, monthPickerYear]
  );
  const summaryAvailableYears = useMemo(
    () => !isDetailMonthTab && pageView?.summaryPage?.availableMonths
      ? [...new Set(pageView.summaryPage.availableMonths.map((month) => Number(month.slice(0, 4))))].sort((left, right) => left - right)
      : [],
    [isDetailMonthTab, pageView]
  );
  const summaryAvailableMonthsForPickerYear = useMemo(
    () => !isDetailMonthTab && pageView?.summaryPage?.availableMonths && rangePickerStartYear != null
      ? pageView.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerStartYear)
      : [],
    [isDetailMonthTab, rangePickerStartYear, pageView]
  );
  const summaryAvailableMonthsForEndPickerYear = useMemo(
    () => !isDetailMonthTab && pageView?.summaryPage?.availableMonths && rangePickerEndYear != null
      ? pageView.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerEndYear)
      : [],
    [isDetailMonthTab, rangePickerEndYear, pageView]
  );

  useEffect(() => {
    if (
      !appShell
      || appShellError
      || isAppShellLoading
      || typeof window === "undefined"
      || window.navigator?.connection?.saveData
      || window.matchMedia?.("(pointer: coarse)")?.matches
    ) {
      return undefined;
    }

    let isCancelled = false;
    const queryEpoch = queryEpochRef.current;
    const isStable = () => !isCancelled
      && queryEpochRef.current === queryEpoch
      && document.visibilityState === "visible";
    const runPrefetchTasks = async (tasks) => {
      const seenKeys = new Set();
      for (const task of tasks) {
        if (!task || seenKeys.has(task.key)) {
          continue;
        }
        seenKeys.add(task.key);
        if (!isStable()) {
          return false;
        }
        await task.run();
        if (!isStable()) {
          return false;
        }
        await waitFor(PAGE_PREFETCH_SPACING_MS);
      }
      return isStable();
    };

    routePagePrefetchTimerRef.current = window.setTimeout(() => {
      const highPriorityTasks = [];
      const lowPriorityTasks = [];

      if (selectedTabId === "month") {
        const currentIndex = availableMonths.indexOf(selectedMonth);
        if (currentIndex !== -1) {
          for (const offset of [-1, 1]) {
            const adjacentMonth = availableMonths[currentIndex + offset];
            if (adjacentMonth) {
              const request = buildRoutePageRequest({
                tabId: "month",
                viewId: selectedViewId,
                month: adjacentMonth,
                scope: selectedScope
              });
              highPriorityTasks.push({
                key: `${request.path}?${request.params.toString()}`,
                run: () => prefetchRoutePage(request)
              });
            }
          }
        }
      } else if (selectedTabId === "summary" && pageView?.summaryPage?.availableMonths?.length) {
        const summaryMonths = pageView.summaryPage.availableMonths;
        const startIndex = summaryMonths.indexOf(pageView.summaryPage.rangeStartMonth);
        const endIndex = summaryMonths.indexOf(pageView.summaryPage.rangeEndMonth);
        if (startIndex !== -1 && endIndex !== -1) {
          for (const offset of [-1, 1]) {
            const nextStartIndex = startIndex + offset;
            const nextEndIndex = endIndex + offset;
            if (nextStartIndex >= 0 && nextEndIndex < summaryMonths.length) {
              const request = buildRoutePageRequest({
                tabId: "summary",
                viewId: selectedViewId,
                month: selectedMonth,
                scope: selectedScope,
                summaryStart: summaryMonths[nextStartIndex],
                summaryEnd: summaryMonths[nextEndIndex]
              });
              highPriorityTasks.push({
                key: `${request.path}?${request.params.toString()}`,
                run: () => prefetchRoutePage(request)
              });
            }
          }
        }
      }

      for (const tabId of ["splits", "imports", "settings"]) {
        if (tabId === selectedTabId) {
          continue;
        }
        const request = buildRoutePageRequest({
          tabId,
          viewId: selectedViewId,
          month: selectedMonth,
          scope: selectedScope
        });
        if (request) {
          lowPriorityTasks.push({
            key: `${request.path}?${request.params.toString()}`,
            run: () => prefetchRoutePage(request)
          });
        }
      }

      if (selectedTabId !== "entries") {
        const params = buildEntriesPageParams({ viewId: "household", month: selectedMonth });
        lowPriorityTasks.push({
          key: `/api/entries-page?${params.toString()}`,
          run: () => prefetchEntriesPage(params)
        });
      }

      void (async () => {
        const highPriorityComplete = await runPrefetchTasks(highPriorityTasks.slice(0, 2));
        if (!highPriorityComplete) {
          return;
        }
        await waitFor(PAGE_PREFETCH_STAGE_DELAY_MS);
        await runPrefetchTasks(lowPriorityTasks);
      })();
    }, PAGE_PREFETCH_DELAY_MS);

    return () => {
      isCancelled = true;
      if (routePagePrefetchTimerRef.current) {
        window.clearTimeout(routePagePrefetchTimerRef.current);
        routePagePrefetchTimerRef.current = null;
      }
    };
  }, [
    availableMonths,
    appShell,
    appShellError,
    isAppShellLoading,
    pageView,
    prefetchEntriesPage,
    prefetchRoutePage,
    selectedMonth,
    selectedScope,
    selectedTabId,
    selectedViewId
  ]);

  useEffect(() => {
    if (!appShell || appShellError || typeof window === "undefined" || window.navigator?.connection?.saveData) {
      return undefined;
    }

    const idleHandle = scheduleIdleTask(() => {
      const warmRouteIds = routeTabs.map((tab) => tab.id);
      for (const routeId of warmRouteIds) {
        if (routeId !== selectedTabId) {
          preloadRouteModule(routeId);
        }
      }
    }, 900);

    return () => cancelIdleTask(idleHandle);
  }, [
    appShell,
    appShellError,
    selectedTabId
  ]);

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

    const matchesKnownView = appShell.availableViewIds.includes(selectedViewId);
    if (matchesKnownView) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", appShell.selectedViewId);
      return next;
    }, { replace: true });
  }, [appShell, defaultSplitsViewId, explicitViewId, selectedTabId, selectedViewId, setSearchParams]);

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

  useEffect(() => {
    if (!appShell || !availableMonths.length) {
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
  }, [availableMonths, appShell, selectedMonth, setSearchParams]);

  useEffect(() => {
    if (isDetailMonthTab || !pageView?.summaryPage?.availableMonths?.length) {
      return;
    }

    const summaryMonths = pageView.summaryPage.availableMonths;
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
  }, [isDetailMonthTab, pageView, searchParams, selectedSummaryEnd, selectedSummaryStart, setSearchParams]);

  useEffect(() => {
    if (isDetailMonthTab || !pageView) {
      return;
    }

    const nextStartYear = Number(pageView.summaryPage.rangeStartMonth.slice(0, 4));
    const nextEndYear = Number(pageView.summaryPage.rangeEndMonth.slice(0, 4));
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
  }, [isDetailMonthTab, pageView, summaryAvailableYears]);

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

  const stickyScopeConfig = pageView
    ? selectedTabId === "month"
      ? {
          selectedKey: selectedScope,
          paramKey: "scope",
          label: "Month view controls"
        }
      : selectedTabId === "entries"
        ? {
            selectedKey: selectedEntriesScope,
            paramKey: "entries_scope",
            label: "Entries view controls"
          }
        : null
    : null;
  const mobileScopeLabels = {
    direct: "Direct",
    shared: "Shared",
    direct_plus_shared: "Direct+Shared"
  };
  const selectedViewSupportsScope = selectedViewId !== "household";
  const mobileContextScopes = stickyScopeConfig ? pageView?.monthPage?.scopes ?? [] : [];
  const selectedMobileScope = stickyScopeConfig
    ? mobileContextScopes.find((scope) => scope.key === stickyScopeConfig.selectedKey) ?? null
    : null;
  const mobileContextSummary = selectedViewSupportsScope && selectedMobileScope
    ? `${pageView?.label ?? ""} · ${mobileScopeLabels[selectedMobileScope.key] ?? selectedMobileScope.label}`
    : pageView?.label ?? "";
  const showMobileContextSticky = Boolean(stickyScopeConfig);
  const showMobileContextScopeSection = Boolean(stickyScopeConfig) && selectedViewSupportsScope && mobileContextScopes.length > 1;

  useEffect(() => {
    if (!showMobileContextSticky && mobileContextOpen) {
      setMobileContextOpen(false);
    }
  }, [mobileContextOpen, showMobileContextSticky]);

  if (appShellError) {
    return (
      <main className="shell">
        <EnvironmentBanner environment={appEnvironment} />
        <section className="panel">
          <p>{messages.common.appShellErrorTitle}</p>
          <p>{appShellError}</p>
          {loadingStatus.issue ? <p className="app-loading-issue-inline">{loadingStatus.issue}</p> : null}
        </section>
      </main>
    );
  }

  if (!appShell || !pageView) {
    return (
      <main className="shell">
        <EnvironmentBanner environment={appEnvironment} />
        <AppLoadingPanel status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />
      </main>
    );
  }

  const periodMode = isDetailMonthTab ? messages.period.month : messages.period.year;
  const periodLabel = isDetailMonthTab
    ? formatService.formatMonthLabel(selectedMonth)
    : `${formatService.formatMonthLabel(pageView.summaryPage.rangeStartMonth)} - ${formatService.formatMonthLabel(pageView.summaryPage.rangeEndMonth)}`;
  const pendingCategorySuggestionCount = appShell.settingsPage?.categoryMatchRuleSuggestions?.length ?? 0;
  const buildTabTarget = (tab) => {
    const params = new URLSearchParams(searchParams);
    sanitizeTabParams(params, tab.id);
    if (tab.id === "settings" && pendingCategorySuggestionCount) {
      params.set("settings_section", "categoryRules");
    } else {
      params.delete("settings_section");
    }

    return { pathname: tab.path, search: params.toString() ? `?${params.toString()}` : "" };
  };
  const renderTabLabel = (tab) => (
    <span className="tab-label-with-badge">
      <span>{tab.label}</span>
      {tab.id === "settings" && pendingCategorySuggestionCount ? (
        <span className="tab-badge" title={messages.settings.settingsCategorySuggestionBadgeTitle(pendingCategorySuggestionCount)}>
          {pendingCategorySuggestionCount}
        </span>
      ) : null}
    </span>
  );
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

    const rangeMonths = pageView.summaryPage.rangeMonths;
    const availableSummaryMonths = pageView.summaryPage.availableMonths;
    const startIndex = availableSummaryMonths.indexOf(pageView.summaryPage.rangeStartMonth);
    const endIndex = availableSummaryMonths.indexOf(pageView.summaryPage.rangeEndMonth);
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

  function handleSummaryStartMonthSelect(startMonth) {
    if (isDetailMonthTab) {
      return;
    }

    const endMonth = pageView.summaryPage.rangeEndMonth;
    if (startMonth > endMonth) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", endMonth);
      const focus = next.get("summary_focus");
      const nextRangeMonths = pageView.summaryPage.availableMonths.filter((month) => month >= startMonth && month <= endMonth);
      if (focus && focus !== SUMMARY_FOCUS_OVERALL && !nextRangeMonths.includes(focus)) {
        next.delete("summary_focus");
      }
      return next;
    });
  }

  function handleSummaryEndMonthSelect(endMonth) {
    if (isDetailMonthTab) {
      return;
    }

    const startMonth = pageView.summaryPage.rangeStartMonth;
    if (endMonth < startMonth) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", endMonth);
      const focus = next.get("summary_focus");
      const nextRangeMonths = pageView.summaryPage.availableMonths.filter((month) => month >= startMonth && month <= endMonth);
      if (focus && focus !== SUMMARY_FOCUS_OVERALL && !nextRangeMonths.includes(focus)) {
        next.delete("summary_focus");
      }
      return next;
    });
  }

  async function handleCategoryAppearanceChange(categoryId, nextAppearance) {
    const normalizedAppearance = { ...nextAppearance };
    if (typeof nextAppearance.name === "string") {
      normalizedAppearance.slug = categoryService.slugify(nextAppearance.name);
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

  function handleLogout() {
    window.location.href = "/cdn-cgi/access/logout";
  }

  return (
    <main className="shell">
      <EnvironmentBanner environment={appEnvironment} />
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
          <nav className="tab-strip" aria-label={messages.tabs.ariaLabel}>
            {primaryRouteTabs.map((tab) => (
              <NavLink
                key={tab.id}
                className={({ isActive }) => `tab ${isActive ? "is-active" : ""}`}
                to={buildTabTarget(tab)}
                title={tab.id === "settings" && pendingCategorySuggestionCount ? messages.settings.settingsCategorySuggestionBadgeTitle(pendingCategorySuggestionCount) : undefined}
              >
                {renderTabLabel(tab)}
              </NavLink>
            ))}
            {secondaryRouteTabs.map((tab) => (
              <NavLink
                key={tab.id}
                className={({ isActive }) => `tab tab-secondary ${isActive ? "is-active" : ""}`}
                to={buildTabTarget(tab)}
                title={tab.id === "settings" && pendingCategorySuggestionCount ? messages.settings.settingsCategorySuggestionBadgeTitle(pendingCategorySuggestionCount) : undefined}
              >
                {renderTabLabel(tab)}
              </NavLink>
            ))}
            <Popover.Root>
              <Popover.Trigger asChild>
                <button type="button" className={`tab tab-overflow-trigger ${secondaryRouteTabs.some((tab) => tab.id === selectedTabId) ? "is-active" : ""}`} aria-label="More pages">
                  <Ellipsis size={18} />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="tab-overflow-popover" sideOffset={10} align="end">
                  <div className="tab-overflow-list">
                    {secondaryRouteTabs.map((tab) => (
                      <NavLink
                        key={tab.id}
                        className={({ isActive }) => `tab-overflow-link ${isActive ? "is-active" : ""}`}
                        to={buildTabTarget(tab)}
                        title={tab.id === "settings" && pendingCategorySuggestionCount ? messages.settings.settingsCategorySuggestionBadgeTitle(pendingCategorySuggestionCount) : undefined}
                      >
                        {renderTabLabel(tab)}
                      </NavLink>
                    ))}
                  </div>
                  <Popover.Arrow className="category-popover-arrow" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </nav>
          <div className={`period-nav-cluster ${isSplitsTab ? "is-passive" : ""}`}>
            <button className="period-button" type="button" aria-label={messages.period.previousAriaLabel} onClick={() => handleMonthChange(-1)} disabled={isSplitsTab}>‹</button>
            <div className="period-display">
              <span className="period-mode">{periodMode}</span>
              {isDetailMonthTab ? (
                <strong className="period-range-value">
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <button type="button" className="period-range-segment" disabled={isSplitsTab}>
                        {periodLabel}
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="period-picker-popover" sideOffset={10} align="center">
                        <div className="period-picker-head">
                          <strong>Month</strong>
                          <span>Choose a single month for this view.</span>
                        </div>
                        <div className="period-picker-years" role="tablist" aria-label="Available years">
                          {detailAvailableYears.map((year) => (
                            <button
                              key={year}
                              type="button"
                              className={`period-picker-year ${monthPickerYear === year ? "is-active" : ""}`}
                              onClick={() => setMonthPickerYear(year)}
                            >
                              {year}
                            </button>
                          ))}
                        </div>
                        <div className="period-picker-months">
                          {detailAvailableMonthsForPickerYear.map((month) => {
                            const monthIndex = Number(month.slice(5, 7)) - 1;
                            const isSelected = month === selectedMonth;
                            return (
                              <Popover.Close key={month} asChild>
                                <button
                                  type="button"
                                  className={`period-picker-month ${isSelected ? "is-active" : ""}`}
                                  onClick={() => handleDetailMonthSelect(month)}
                                >
                                  {MONTH_PICKER_LABELS[monthIndex]}
                                </button>
                              </Popover.Close>
                            );
                          })}
                        </div>
                        <Popover.Arrow className="category-popover-arrow" />
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </strong>
              ) : (
                <strong className="period-range-value">
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <button type="button" className="period-range-segment">
                        {formatService.formatMonthLabel(pageView.summaryPage.rangeStartMonth)}
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="period-picker-popover" sideOffset={10} align="center">
                        <div className="period-picker-head">
                          <strong>Start month</strong>
                          <span>Choose the first month in the summary range.</span>
                        </div>
                        <div className="period-picker-years" role="tablist" aria-label="Available start years">
                          {summaryAvailableYears.map((year) => (
                            <button
                              key={year}
                              type="button"
                              className={`period-picker-year ${rangePickerStartYear === year ? "is-active" : ""}`}
                              onClick={() => setRangePickerStartYear(year)}
                            >
                              {year}
                            </button>
                          ))}
                        </div>
                        <div className="period-picker-months">
                          {summaryAvailableMonthsForPickerYear.map((month) => {
                            const monthIndex = Number(month.slice(5, 7)) - 1;
                            const isSelected = month === pageView.summaryPage.rangeStartMonth;
                            const isDisabled = month > pageView.summaryPage.rangeEndMonth;
                            return (
                              <button
                                key={month}
                                type="button"
                                className={`period-picker-month ${isSelected ? "is-active" : ""}`}
                                disabled={isDisabled}
                                onClick={() => handleSummaryStartMonthSelect(month)}
                              >
                                {MONTH_PICKER_LABELS[monthIndex]}
                              </button>
                            );
                          })}
                        </div>
                        <Popover.Arrow className="category-popover-arrow" />
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  <span className="period-range-separator" aria-hidden="true">-</span>
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <button type="button" className="period-range-segment">
                        {formatService.formatMonthLabel(pageView.summaryPage.rangeEndMonth)}
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="period-picker-popover" sideOffset={10} align="center">
                        <div className="period-picker-head">
                          <strong>End month</strong>
                          <span>Choose the last month in the summary range.</span>
                        </div>
                        <div className="period-picker-years" role="tablist" aria-label="Available end years">
                          {summaryAvailableYears.map((year) => (
                            <button
                              key={year}
                              type="button"
                              className={`period-picker-year ${rangePickerEndYear === year ? "is-active" : ""}`}
                              onClick={() => setRangePickerEndYear(year)}
                            >
                              {year}
                            </button>
                          ))}
                        </div>
                        <div className="period-picker-months">
                          {summaryAvailableMonthsForEndPickerYear.map((month) => {
                            const monthIndex = Number(month.slice(5, 7)) - 1;
                            const isSelected = month === pageView.summaryPage.rangeEndMonth;
                            const isDisabled = month < pageView.summaryPage.rangeStartMonth;
                            return (
                              <button
                                key={month}
                                type="button"
                                className={`period-picker-month ${isSelected ? "is-active" : ""}`}
                                disabled={isDisabled}
                                onClick={() => handleSummaryEndMonthSelect(month)}
                              >
                                {MONTH_PICKER_LABELS[monthIndex]}
                              </button>
                            );
                          })}
                        </div>
                        <Popover.Arrow className="category-popover-arrow" />
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </strong>
              )}
            </div>
            <button className="period-button" type="button" aria-label={messages.period.nextAriaLabel} onClick={() => handleMonthChange(1)} disabled={isSplitsTab}>›</button>
          </div>
        </div>
      </section>

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
                    <span className="mobile-context-trigger-label">{mobileContextSummary}</span>
                    {showMobileContextScopeSection ? (
                      <>
                        <span className="mobile-context-trigger-divider" aria-hidden="true">|</span>
                        <span className="mobile-context-trigger-hint">View and scope</span>
                      </>
                    ) : (
                      <span className="mobile-context-trigger-hint">View</span>
                    )}
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
                    </section>
                  ) : null}

                  {selectedTabId === "entries" && entriesMobileFilterProps ? (
                    <section className="mobile-context-dialog-section mobile-context-dialog-filters-slot" aria-label="Filters">
                      <EntriesFilterStack {...entriesMobileFilterProps} />
                    </section>
                  ) : null}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
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
          </div>
        </section>
      ) : null}

      <section className="grid app-route-grid" aria-busy={isAppShellLoading ? "true" : "false"}>
        <Suspense fallback={<RouteChunkLoadingFallback status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />}>
          <Routes>
            <Route path="/" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
            <Route path="/entries/by-id/:entryId" element={<EntryDeepLinkRoute />} />
            <Route
              path="/summary"
              element={(
                <SummaryPanel
                  view={pageView}
                  selectedMonth={selectedMonth}
                  categories={categories}
                  onCategoryAppearanceChange={handleCategoryAppearanceChange}
                  onRefresh={() => refreshRoutePage()}
                />
              )}
            />
            <Route
              path="/month"
              element={(
                <MonthPanel
                  view={pageView}
                  accounts={appShell.accounts}
                  people={appShell.household.people}
                  categories={categories}
                  householdMonthEntries={householdMonthEntries}
                  onCategoryAppearanceChange={handleCategoryAppearanceChange}
                  onRefresh={refreshCurrentMonthPage}
                />
              )}
            />
            <Route
              path="/entries"
              element={(
                <EntriesPanel
                  view={pageView}
                  entriesSourceView={pageView}
                  selectedMonth={selectedMonth}
                  mobileContextOpen={mobileContextOpen}
                  onCloseMobileContext={closeMobileContext}
                  onMobileFilterStateChange={handleEntriesMobileFilterStateChange}
                  externalRefreshToken={entriesExternalRefreshToken}
                  availableMonths={availableMonths}
                  accounts={appShell.accounts}
                  categories={categories}
                  people={appShell.household.people}
                  onCategoryAppearanceChange={handleCategoryAppearanceChange}
                  onInvalidateAppShellCache={syncAppShellAfterMutation}
                  onBroadcastSplitMutation={broadcastSplitMutation}
                />
              )}
            />
            <Route
              path="/splits"
              element={(
                <SplitsPanel
                  view={pageView}
                  categories={categories}
                  people={appShell.household.people}
                  onRefresh={(options) => refreshCurrentSplitsPage(options)}
                />
              )}
            />
            <Route
              path="/imports"
              element={(
                <ImportsPanel
                  importsPage={routePageData?.importsPage ?? appShell.importsPage}
                  viewId={pageView.id}
                  viewLabel={pageView.label}
                  accounts={appShell.accounts}
                  categories={categories}
                  people={appShell.household.people}
                  onRefresh={(options) => refreshCurrentImportsPage(options)}
                />
              )}
            />
            <Route
              path="/settings"
              element={(
                <SettingsPanel
                  settingsPage={routePageData?.settingsPage ?? appShell.settingsPage}
                  accounts={appShell.accounts}
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
                  onRefresh={() => refreshAppShell({ broadcast: true })}
                />
              )}
            />
            <Route path="/faq" element={<FaqPanel viewLabel={pageView.label} categories={categories} />} />
            <Route path="*" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
          </Routes>
        </Suspense>
        {isAppShellLoading ? <AppLoadingOverlay status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} /> : null}
      </section>

      {loginRegistrationDraft ? (
        <Dialog.Root open>
          <Dialog.Portal>
            <Dialog.Overlay className="note-dialog-overlay" />
            <Dialog.Content className="note-dialog-content login-registration-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
              <form onSubmit={handleRegisterLogin}>
                <div className="note-dialog-head">
                  <div>
                    <Dialog.Title>Set up this login</Dialog.Title>
                    <Dialog.Description>
                      Link {loginRegistrationDraft.email} to one household profile. This lets Splits open on your view next time.
                    </Dialog.Description>
                  </div>
                </div>
                <div className="login-registration-form">
                  <label>
                    <span>Household profile</span>
                    <select
                      className="table-edit-input"
                      value={loginRegistrationDraft.personId}
                      onChange={(event) => {
                        const person = appShell.household.people.find((item) => item.id === event.target.value);
                        setLoginRegistrationDraft((current) => current ? {
                          ...current,
                          personId: event.target.value,
                          name: isPlaceholderPersonName(person?.name) ? "" : person?.name ?? current.name
                        } : current);
                      }}
                    >
                      {appShell.household.people.map((person) => (
                        <option key={person.id} value={person.id}>{person.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Display name</span>
                    <input
                      className="table-edit-input"
                      value={loginRegistrationDraft.name}
                      placeholder="Name for this household profile"
                      onChange={(event) => setLoginRegistrationDraft((current) => current ? { ...current, name: event.target.value } : current)}
                    />
                  </label>
                </div>
                {loginRegistrationError ? <p className="form-error">{loginRegistrationError}</p> : null}
                <div className="note-dialog-actions">
                  <button type="submit" className="dialog-primary" disabled={isRegisteringLogin}>
                    {isRegisteringLogin ? "Saving..." : "Save login"}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}

      {selectedTabId === "entries" && typeof document !== "undefined"
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

      {selectedTabId === "splits" && pageView.id !== "household" && typeof document !== "undefined"
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

function isPlaceholderPersonName(name) {
  return ["primary", "partner"].includes(String(name ?? "").trim().toLowerCase());
}

function AppLoadingStatusText({ status, elapsedSeconds, compact = false }) {
  const percentText = typeof status?.percent === "number" ? `${Math.max(0, Math.min(100, Math.round(status.percent)))}%` : null;
  const elapsedText = elapsedSeconds > 0 ? `${elapsedSeconds}s` : null;
  const detailText = ellipsizeText(status?.detail ?? "");
  const meta = [percentText, detailText, elapsedText].filter(Boolean).join(" · ");

  return (
    <div className={`app-loading-status ${compact ? "is-compact" : ""}`}>
      <small title={status?.detail ?? ""}>{meta}</small>
      {status?.issue ? <small className="is-error" title={status.issue}>{ellipsizeText(status.issue, compact ? 64 : 84)}</small> : null}
    </div>
  );
}

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

function areEntryFilterValuesEqual(current, next) {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    return current === next;
  }
  return (
    current.category === next.category
    && current.type === next.type
    && areStringArraysEqual(current.entryIds, next.entryIds)
    && areStringArraysEqual(current.wallets, next.wallets)
  );
}

function areStringArraysEqual(current, next) {
  if (current === next) {
    return true;
  }
  if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) {
    return false;
  }
  return current.every((value, index) => value === next[index]);
}

function AppLoadingPanel({ status, elapsedSeconds }) {
  return (
    <section className="panel app-loading-panel" role="status" aria-live="polite">
      <div className="app-loading-main">
        <span className="app-spinner" aria-hidden="true" />
        <p>{messages.common.loading}</p>
      </div>
      <AppLoadingStatusText status={status} elapsedSeconds={elapsedSeconds} />
    </section>
  );
}

function AppLoadingOverlay({ status, elapsedSeconds }) {
  return (
    <div className="app-loading-overlay" role="status" aria-live="polite">
      <div className="app-loading-overlay-main">
        <span className="app-spinner" aria-hidden="true" />
        <span>{messages.common.loadingLatest}</span>
      </div>
      <AppLoadingStatusText status={status} elapsedSeconds={elapsedSeconds} compact />
    </div>
  );
}

function RouteChunkLoadingFallback({ status, elapsedSeconds }) {
  return (
    <section className="panel app-loading-panel route-loading-panel" role="status" aria-live="polite">
      <div className="app-loading-main">
        <span className="app-spinner" aria-hidden="true" />
        <p>{messages.common.loading}</p>
      </div>
      <AppLoadingStatusText status={status} elapsedSeconds={elapsedSeconds} />
    </section>
  );
}

function buildEntriesPageParams({ viewId, month }) {
  return new URLSearchParams({
    view: viewId,
    month
  });
}

function EntryDeepLinkRoute() {
  const { entryId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState({ loading: true, error: "" });

  useEffect(() => {
    if (!entryId) {
      setStatus({ loading: false, error: "Missing entry id." });
      return;
    }

    const controller = new AbortController();
    setStatus({ loading: true, error: "" });

    void fetch(`/api/entries/locate?entryId=${encodeURIComponent(entryId)}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data?.context) {
          throw new Error(data?.error ?? "Entry not found.");
        }

        const next = new URLSearchParams(location.search);
        next.set("view", data.context.viewId ?? "household");
        next.set("month", data.context.month);
        next.set("editing_entry", data.context.entryId);
        if (data.context.accountId) {
          next.set("entry_wallet", data.context.accountId);
        } else if (data.context.accountName) {
          next.set("entry_wallet", data.context.accountName);
        }
        navigate({
          pathname: "/entries",
          search: `?${next.toString()}`
        }, { replace: true });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setStatus({
          loading: false,
          error: error instanceof Error ? error.message : "Entry not found."
        });
      });

    return () => controller.abort();
  }, [entryId, location.search, navigate]);

  if (status.loading) {
    return <RouteChunkLoadingFallback />;
  }

  return (
    <section className="panel panel-accent">
      <div className="import-warning import-warning-attention">
        <strong>Entry link unavailable</strong>
        <p className="lede compact">{status.error || "The requested entry could not be opened."}</p>
      </div>
    </section>
  );
}
