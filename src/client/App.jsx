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
import { invalidateImportMutationQueries, invalidateImportsPageQueries } from "./query-mutations";
import { describeSettingsRefreshPlan, SETTINGS_ROUTE_REQUEST } from "./settings-refresh-plan";
import { getCurrentMonthKey } from "../lib/month";

// Lazy route loaders keep the initial shell small while still splitting each
// feature panel into its own bundle.
const routeModuleLoaders = {
  entries: () => import("./entries-panel.jsx"),
  faq: () => import("./faq-panel.jsx"),
  imports: () => import("./imports-panel.jsx"),
  month: () => import("./month-panel.jsx"),
  settings: () => import("./settings-panel.jsx"),
  splits: () => import("./splits-panel.jsx"),
  summary: () => import("./summary-panel.jsx")
};
// Track preloaded route bundles so the app does not request the same chunk
// repeatedly during idle warmup.
const routeModulePreloads = new Map();

const EntriesPanel = lazy(() => routeModuleLoaders.entries().then((module) => ({ default: module.EntriesPanel })));
const FaqPanel = lazy(() => routeModuleLoaders.faq().then((module) => ({ default: module.FaqPanel })));
const ImportsPanel = lazy(() => routeModuleLoaders.imports().then((module) => ({ default: module.ImportsPanel })));
const MonthPanel = lazy(() => routeModuleLoaders.month().then((module) => ({ default: module.MonthPanel })));
const SettingsPanel = lazy(() => routeModuleLoaders.settings().then((module) => ({ default: module.SettingsPanel })));
const SplitsPanel = lazy(() => routeModuleLoaders.splits().then((module) => ({ default: module.SplitsPanel })));
const SummaryPanel = lazy(() => routeModuleLoaders.summary().then((module) => ({ default: module.SummaryPanel })));

// Shared UI constants used by the month and summary pickers.
const SUMMARY_FOCUS_OVERALL = "overall";
const MONTH_PICKER_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_MONTH_KEY = getCurrentMonthKey();
const { categories: categoryService, format: formatService } = moniesClient;

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
// Prefetch timing is intentionally staggered so warmup does not compete with
// the visible render path.
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

// Trim long route labels and status text so loading chrome stays readable
// without expanding into the whole shell.
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

// Warm route bundles ahead of time so navigation stays fast without changing
// which route data is actually rendered.
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

// Schedule a small idle task so speculative work never competes with the
// visible render path.
function scheduleIdleTask(callback, timeout = 1000) {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (typeof window.requestIdleCallback === "function") {
    return { type: "idle", id: window.requestIdleCallback(callback, { timeout }) };
  }
  return { type: "timeout", id: window.setTimeout(callback, timeout) };
}

// Cancel idle work when route or shell state changes before the task runs.
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

// Wrap `setTimeout` in a promise so route work can be staged with explicit
// pauses during warmup and prefetching.
function waitFor(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

// Show a small environment badge only when the app is running locally or in
// the demo environment.
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
  // App-level shell state and caches live here; everything below derives the
  // active route from that data instead of maintaining a second store.
  const queryClient = useQueryClient();
  const [appShell, setAppShell] = useState(null);
  const [appShellError, setAppShellError] = useState("");
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
  const syncChannelRef = useRef(null);
  const queryEpochRef = useRef(0);
  const routePagePrefetchTimerRef = useRef(null);
  // Route identity is derived from the browser location and query string, and
  // that route drives which page payload we fetch next.
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
  // These aliases make the current route inputs explicit before they flow into
  // shell and page fetch helpers.
  const appShellMonth = selectedMonth;
  const appShellSummaryStart = selectedSummaryStart;
  const appShellSummaryEnd = selectedSummaryEnd;
  const appShellScope = selectedScope;

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
    () => buildAppShellParams({
      month: selectedMonth,
      scope: selectedScope,
      summaryStart: selectedSummaryStart,
      summaryEnd: selectedSummaryEnd
    }),
    [selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart]
  );
  const appShellCacheKey = appShellParams.toString();
  // Route-page requests are derived from the current tab and route params so
  // every screen loads the smallest possible server payload.
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
  const bumpQueryEpoch = useCallback(() => {
    queryEpochRef.current += 1;
  }, []);

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
  const clearRoutePageCache = useCallback(() => {
    bumpQueryEpoch();
    queryClient.cancelQueries({ queryKey: ["route-page"] });
    queryClient.removeQueries({ queryKey: ["route-page"] });
  }, [bumpQueryEpoch, queryClient]);

  // Clear the entries-page cache when entry mutations should be reflected in
  // the dedicated entries workflow.
  const clearEntriesPageCache = useCallback(() => {
    bumpQueryEpoch();
    queryClient.cancelQueries({ queryKey: ["entries-page"] });
    queryClient.removeQueries({ queryKey: ["entries-page"] });
  }, [bumpQueryEpoch, queryClient]);

  // Fetch the entries page with exact caching semantics so the dedicated
  // entries workflow can reuse data without rebuilding the shell.
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

  // Fetch the app shell payload and persist it so the next render can reuse
  // global metadata immediately.
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

    // The app-shell fetcher uses a manual parse step so non-JSON error bodies
    // can still surface a useful message.
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

  // Fetch the entries shell payload used by the dedicated entries workflow.
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

  // Hydrate the client shell state from the app-shell query and clear any
  // previous shell error before rendering.
  const loadAppShell = useCallback(async (signal, { bypassCache = false } = {}) => {
    const data = await fetchAppShellData(appShellParams, { bypassCache, signal });

    setAppShellError("");
    setAppShell(data);
    return data;
  }, [appShellParams, fetchAppShellData]);

  // Normalize shell fetch failures into the app-shell error banner and the
  // loading status tracker.
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

  // Reload the shell from the network and optionally broadcast the refresh to
  // other tabs once the new payload is ready.
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

  // Refresh the shell in the background without surfacing a full loading state
  // to the user.
  const refreshAppShellInBackground = useCallback(async () => {
    clearAppShellCache();
    const data = await fetchAppShellData(appShellParams, { bypassCache: true });
    setAppShellError("");
    setAppShell(data);
    return data;
  }, [appShellParams, clearAppShellCache, fetchAppShellData]);

  // Fetch the active route page and shape it into the current screen payload.
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
    // Route-page responses are parsed manually for the same reason as the
    // shell fetch: server errors still need to surface useful context.
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

  // Refresh the active route page, and optionally refresh shell state when the
  // mutation affected shared metadata.
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

  // Refresh the month page that shares the current route state, then refresh
  // the shell in the background so summary and month stay aligned.
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

  // Refresh the imports page and optionally rebroadcast shell freshness when
  // import mutations change shared reference data.
  const refreshCurrentImportsPage = useCallback(async ({
    broadcast = false,
    invalidateImports = false,
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

    const tasks = [fetchRoutePageData(request, { bypassCache: true })];
    if (invalidateImports) {
      tasks.push(invalidateImportMutationQueries(queryClient, {}));
    }
    if (refreshShell) {
      tasks.push(refreshAppShellInBackground().catch(() => null));
    }
    const [data] = await Promise.all(tasks);
    setRoutePageData(data);

    if (broadcast) {
      broadcastAppShellRefresh(syncChannelRef);
    }

    return data;
  }, [fetchRoutePageData, queryClient, refreshAppShellInBackground, selectedMonth, selectedScope, selectedViewId]);

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
      tasks.push(refreshAppShellInBackground().catch(() => null));
    }

    const [data, ...taskResults] = await Promise.all(tasks);
    setRoutePageData((current) => (
      selectedTabId === "settings" && current?.settingsPage ? data : current
    ));

    if (broadcast && refreshDescription.refreshShell) {
      broadcastAppShellRefresh(syncChannelRef);
    }

    return refreshDescription.refreshShell
      ? taskResults.find((result) => result?.accounts || result?.categories || result?.household) ?? data
      : data;
  }, [
    clearSettingsMutationCaches,
    fetchRoutePageData,
    queryClient,
    refreshAppShellInBackground,
    selectedTabId
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

  // Settings reference-data edits clear the specific downstream route caches
  // described by the settings slice refresh plan.
  const clearSettingsMutationCaches = useCallback(({
    routePagePaths = [],
    clearEntriesPageCache = false
  }) => {
    for (const path of routePagePaths) {
      clearRoutePageCacheByPath(path);
    }

    if (clearEntriesPageCache) {
      clearEntriesPageCacheByPredicate(() => true);
    }
  }, [
    clearEntriesPageCacheByPredicate,
    clearRoutePageCacheByPath
  ]);

  // Refresh the current route page in the background without switching tabs or
  // interrupting the visible workflow.
  const refreshActiveRoutePageInBackground = useCallback(async (request) => {
    if (!request) {
      return null;
    }

    const data = await fetchRoutePageData(request, { bypassCache: true });
    setRoutePageData(data);
    return data;
  }, [fetchRoutePageData]);

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

  // Refresh the shell after a mutation that needs global metadata to stay in
  // sync.
  const syncAppShellAfterMutation = useCallback(async () => {
    await refreshAppShellInBackground();
  }, [refreshAppShellInBackground]);

  // Prefetch the next likely route page without replacing the current active
  // page state.
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

  // Prefetch the entries page using the same exact key that the entries route
  // will later consume.
  const prefetchEntriesPage = useCallback(async (params) => {
    const queryKey = queryKeys.entriesPage(params);
    const queryState = queryClient.getQueryState(queryKey);
    if (queryClient.getQueryData(queryKey) || queryState?.fetchStatus === "fetching") {
      return;
    }

    await fetchEntriesPageData(params).catch(() => {});
  }, [fetchEntriesPageData, queryClient]);

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

        // Fall back to the normal shell fetch for every non-entries route and
        // for the second, full shell pass after the entries warm start.
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
          // If the entries warm start fails, recover by retrying the full shell
          // so the app still reaches a usable state.
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

  // Listen for cross-tab shell refreshes and split mutations so every open tab
  // converges on the same canonical state.
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

  // Route-page loading starts as soon as the route is known so shell and page
  // requests can overlap when the page does not need shell-derived inputs.
  useEffect(() => {
    if (!routePageRequest) {
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
  }, [beginAppShellLoad, fetchRoutePageData, queryClient, reportLoadingIssue, routePageRequest, updateLoadingStatus]);

  // Keep only the last settled route snapshot in refs so hydration can fall
  // back to the previous screen without introducing a second render source of
  // truth.
  const currentPageView = useMemo(
    () => buildPageViewFromRouteData(selectedTabId, routePageData, selectedViewId, appShell),
    [appShell, routePageData, selectedTabId, selectedViewId]
  );
  const lastSettledPageViewRef = useRef(null);
  const lastSettledTabIdRef = useRef(null);
  useEffect(() => {
    if (currentPageView) {
      lastSettledPageViewRef.current = currentPageView;
      lastSettledTabIdRef.current = selectedTabId;
    }
  }, [currentPageView, selectedTabId]);

  // Derive the active render state directly from the current route, falling
  // back to the last settled route only while the next page hydrates.
  const pageView = currentPageView ?? lastSettledPageViewRef.current;
  const renderedTabId = currentPageView ? selectedTabId : lastSettledTabIdRef.current ?? selectedTabId;
  // Summary-dependent helpers reuse the same optional page slice so the
  // summary-specific code stays isolated from detail tabs.
  const summaryPage = pageView?.summaryPage ?? null;
  const defaultSplitsViewId = appShell?.viewerPersonId
    ?? appShell?.household?.people?.[0]?.id
    ?? appShell?.selectedViewId
    ?? "household";
  // Entries scope falls back to the month view scope when the route has not
  // overridden it yet.
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
  // Use the summary page's month list when present, otherwise fall back to the
  // shell's tracked months for detail tabs and route-neutral navigation.
  const availableMonths = useMemo(
    () => pageView?.summaryPage?.availableMonths?.slice().sort() ?? appShell?.trackedMonths ?? [],
    [appShell, pageView]
  );
  const isDetailMonthTab = renderedTabId === "month" || renderedTabId === "entries" || renderedTabId === "splits";
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
  const renderedRouteElement = useMemo(() => {
    if (!pageView) {
      return null;
    }

    if (renderedTabId === "summary") {
      return (
        <SummaryPanel
          view={pageView}
          selectedMonth={selectedMonth}
          categories={categories}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
          onRefresh={() => refreshRoutePage()}
        />
      );
    }

    if (renderedTabId === "month") {
      return (
        <MonthPanel
          view={pageView}
          accounts={appShell.accounts}
          people={appShell.household.people}
          categories={categories}
          householdMonthEntries={householdMonthEntries}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
          onRefresh={refreshCurrentMonthPage}
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
          availableMonths={availableMonths}
          accounts={appShell.accounts}
          categories={categories}
          people={appShell.household.people}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
          onInvalidateAppShellCache={syncAppShellAfterMutation}
          onBroadcastSplitMutation={broadcastSplitMutation}
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
        />
      );
    }

    if (renderedTabId === "imports") {
      return (
        <ImportsPanel
          importsPage={pageView.importsPage}
          viewId={pageView.id}
          viewLabel={pageView.label}
          accounts={appShell.accounts}
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
    appShell?.accounts,
    appShell?.household?.people,
    appShell?.importsPage,
    appShell?.viewerIdentity,
    availableMonths,
    broadcastSplitMutation,
    categories,
    closeMobileContext,
    entriesExternalRefreshToken,
    handleCategoryAppearanceChange,
    handleEntriesMobileFilterStateChange,
    handleLogout,
    handleUnregisterLogin,
    householdMonthEntries,
    isUnregisteringLogin,
    loginIdentityError,
    mobileContextOpen,
    pageView,
    refreshCurrentSettingsPage,
    refreshAppShell,
    refreshCurrentImportsPage,
    refreshCurrentMonthPage,
    refreshCurrentSplitsPage,
    refreshRoutePage,
    renderedTabId,
    routePageData,
    selectedMonth,
    syncAppShellAfterMutation
  ]);
  const routeBody = pageView
    ? renderedRouteElement
    : <RouteChunkLoadingFallback status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />;

  // Prefetch adjacent routes once the shell is stable so fast navigation feels
  // instant without violating the current route's source of truth.
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
      // High-priority tasks are the next months or summary windows the user is
      // most likely to visit immediately.
      const highPriorityTasks = [];
      // Low-priority tasks warm the rest of the route set and the entries page.
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
      } else if (selectedTabId === "summary" && summaryPage?.availableMonths?.length) {
        const summaryMonths = summaryPage.availableMonths;
        const startIndex = summaryMonths.indexOf(summaryPage.rangeStartMonth);
        const endIndex = summaryMonths.indexOf(summaryPage.rangeEndMonth);
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

  // Idle-time route module warming keeps tab switches fast without blocking
  // the active screen.
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

    if (availableMonths.includes(selectedMonth)) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("month", availableMonths[availableMonths.length - 1]);
      return next;
    }, { replace: true });
  }, [availableMonths, appShell, selectedMonth, setSearchParams]);

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
  // semantics.
  const stickyScopeConfig = pageView
    ? renderedTabId === "month"
      ? {
          selectedKey: selectedScope,
          paramKey: "scope",
          label: "Month view controls"
        }
      : renderedTabId === "entries"
        ? {
            selectedKey: selectedEntriesScope,
            paramKey: "entries_scope",
            label: "Entries view controls"
          }
        : null
    : null;
  // Small labels are easier to scan inside the mobile sheet than the full
  // scope names.
  const mobileScopeLabels = {
    direct: "Direct",
    shared: "Shared",
    direct_plus_shared: "Direct+Shared"
  };
  const selectedViewSupportsScope = selectedViewId !== "household";
  // The sticky sheet only needs month scopes when the route exposes them.
  const mobileContextScopes = stickyScopeConfig ? pageView?.monthPage?.scopes ?? [] : [];
  const selectedMobileScope = stickyScopeConfig
    ? mobileContextScopes.find((scope) => scope.key === stickyScopeConfig.selectedKey) ?? null
    : null;
  const mobileContextSummary = selectedViewSupportsScope && selectedMobileScope
    ? `${pageView?.label ?? ""} · ${mobileScopeLabels[selectedMobileScope.key] ?? selectedMobileScope.label}`
    : pageView?.label ?? "";
  const showMobileContextSticky = Boolean(stickyScopeConfig);
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

  // Render the loading state while either the shell or the active page is
  // still being resolved.
  if (!appShell || !pageView) {
    return (
      <main className="shell">
        <EnvironmentBanner environment={appEnvironment} />
        <AppLoadingPanel status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />
      </main>
    );
  }

  // The top chrome reflects the active period semantics of the current route.
  const periodMode = isDetailMonthTab ? messages.period.month : messages.period.year;
  const periodLabel = isDetailMonthTab
    ? formatService.formatMonthLabel(selectedMonth)
    : pageView?.summaryPage?.rangeStartMonth && pageView?.summaryPage?.rangeEndMonth
      ? `${formatService.formatMonthLabel(pageView.summaryPage.rangeStartMonth)} - ${formatService.formatMonthLabel(pageView.summaryPage.rangeEndMonth)}`
      : pageView.label;
  // The settings badge reads from the settings page cache so the shell stays a
  // reference-data payload instead of reabsorbing settings-page state.
  const cachedSettingsPage = queryClient.getQueryData(queryKeys.routePage(SETTINGS_ROUTE_REQUEST));
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
              ) : summaryPage?.rangeStartMonth && summaryPage?.rangeEndMonth ? (
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
              ) : (
                <strong className="period-range-value">{periodLabel}</strong>
              )}
            </div>
            <button className="period-button" type="button" aria-label={messages.period.nextAriaLabel} onClick={() => handleMonthChange(1)} disabled={isSplitsTab}>›</button>
          </div>
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
                    </section>
                  ) : null}

                  {renderedTabId === "entries" && entriesMobileFilterProps ? (
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

      {/* The routed panel area is the actual screen body; every tab renders through this slot. */}
      <section className="grid app-route-grid" aria-busy={isAppShellLoading ? "true" : "false"}>
        {/* Route panels can hydrate lazily, so the fallback stays inside the
            routed region instead of replacing the whole shell. */}
        {routeBody}
        {isAppShellLoading ? <AppLoadingOverlay status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} /> : null}
      </section>

      {/* Login registration is modal because it must interrupt the flow only when the shell has no stable identity mapping. */}
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

// Detect placeholder household names that should be replaced with the real
// person name during login setup.
function isPlaceholderPersonName(name) {
  return ["primary", "partner"].includes(String(name ?? "").trim().toLowerCase());
}

// Compact the loading copy and status line so the startup panel stays readable
// while the shell is still assembling.
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
    current.category === next.category
    && current.type === next.type
    && areStringArraysEqual(current.entryIds, next.entryIds)
    && areStringArraysEqual(current.wallets, next.wallets)
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

// Full-screen startup state used before the shell or route payload is ready.
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

// Overlay status used while a route fetch is still hydrating the current
// screen.
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

// In-panel fallback for route hydration, separate from the full startup state.
function RouteChunkLoadingFallback({ status, elapsedSeconds }) {
  return (
    <section className="route-loading-panel" role="status" aria-live="polite">
      <div className="app-loading-main">
        <span className="app-spinner" aria-hidden="true" />
        <p>{messages.common.loadingLatest}</p>
      </div>
      <AppLoadingStatusText status={status} elapsedSeconds={elapsedSeconds} compact />
    </section>
  );
}

// Build the query string used by the deep-link route that jumps directly to
// the Entries page.
function buildEntriesPageParams({ viewId, month }) {
  return new URLSearchParams({
    view: viewId,
    month
  });
}

// Resolve an entry deep link by looking up the owning month and redirecting to
// the correct Entries route with the matching edit context.
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
