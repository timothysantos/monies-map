import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { slugify } from "./category-utils";
import { messages } from "./copy/en-SG";
import {
  buildBootstrapErrorMessage,
  buildRequestErrorMessage,
  describeBootstrapError
} from "./request-errors";
import { installMobileFocusVisibility } from "./mobile-focus-visibility";
import { formatMonthLabel } from "./formatters";
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
const BOOTSTRAP_SYNC_CHANNEL = "monies-map-bootstrap-sync";
const BOOTSTRAP_SYNC_STORAGE_KEY = "monies-map-bootstrap-sync";
// Bump this when bootstrap payload usage changes so deployed clients do not
// hydrate from an incompatible persisted shell.
const BOOTSTRAP_PERSISTED_CACHE_KEY = "monies-map-bootstrap-cache-v2";
const MONTH_PICKER_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_MONTH_KEY = getCurrentMonthKey();

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

function readPersistedBootstrap(cacheKey) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawCache = window.localStorage.getItem(BOOTSTRAP_PERSISTED_CACHE_KEY);
    if (!rawCache) {
      return null;
    }

    const parsedCache = JSON.parse(rawCache);
    if (parsedCache?.cacheKey !== cacheKey || !parsedCache?.data) {
      return null;
    }

    return parsedCache.data;
  } catch {
    return null;
  }
}

function writePersistedBootstrap(cacheKey, data) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(BOOTSTRAP_PERSISTED_CACHE_KEY, JSON.stringify({
      cacheKey,
      data,
      storedAt: Date.now()
    }));
  } catch {}
}

function clearPersistedBootstrap() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(BOOTSTRAP_PERSISTED_CACHE_KEY);
  } catch {}
}

function canUseBootstrapRouteForTab(tabId, {
  bootstrapMonth,
  bootstrapScope,
  bootstrapSummaryEnd,
  bootstrapSummaryStart,
  selectedMonth,
  selectedScope,
  selectedSummaryEnd,
  selectedSummaryStart
}) {
  if (tabId === "summary") {
    const effectiveSummaryStart = selectedSummaryStart ?? bootstrapSummaryStart;
    const effectiveSummaryEnd = selectedSummaryEnd ?? bootstrapSummaryEnd;
    return effectiveSummaryStart === bootstrapSummaryStart
      && effectiveSummaryEnd === bootstrapSummaryEnd;
  }

  if (tabId === "month") {
    return selectedMonth === bootstrapMonth && selectedScope === bootstrapScope;
  }

  return false;
}

export function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapLoadCount, setBootstrapLoadCount] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState(() => createLoadingStatus());
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [rangePickerStartYear, setRangePickerStartYear] = useState(null);
  const [rangePickerEndYear, setRangePickerEndYear] = useState(null);
  const [monthPickerYear, setMonthPickerYear] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const syncChannelRef = useRef(null);
  const bootstrapCacheRef = useRef(new Map());
  const bootstrapInflightRef = useRef(new Map());
  const bootstrapCacheVersionRef = useRef(0);
  const routePageCacheRef = useRef(new Map());
  const routePageInflightRef = useRef(new Map());
  const routePageCacheVersionRef = useRef(0);
  const routePagePrefetchTimerRef = useRef(null);
  const entriesPageCacheRef = useRef(new Map());
  const entriesPageInflightRef = useRef(new Map());
  const entriesPageCacheVersionRef = useRef(0);
  const appEnvironment = bootstrap?.appEnvironment ?? getClientAppEnvironment();
  const explicitViewId = searchParams.get("view");
  const selectedViewId = explicitViewId ?? "household";
  const selectedTabId = getSelectedTabId(location.pathname);
  const selectedMonth = searchParams.get("month") ?? DEFAULT_MONTH_KEY;
  const selectedScope = searchParams.get("scope") ?? "direct_plus_shared";
  const selectedSummaryStart = searchParams.get("summary_start") ?? undefined;
  const selectedSummaryEnd = searchParams.get("summary_end") ?? undefined;
  const isBootstrapLoading = bootstrapLoadCount > 0;
  const [routePageData, setRoutePageData] = useState(null);
  const [loginRegistrationDraft, setLoginRegistrationDraft] = useState(null);
  const [loginRegistrationError, setLoginRegistrationError] = useState("");
  const [isRegisteringLogin, setIsRegisteringLogin] = useState(false);
  const [loginIdentityError, setLoginIdentityError] = useState("");
  const [isUnregisteringLogin, setIsUnregisteringLogin] = useState(false);
  const [suppressedLoginRegistrationEmail, setSuppressedLoginRegistrationEmail] = useState("");
  const bootstrapShellView = bootstrap?.views[0] ?? null;
  const bootstrapMonth = bootstrapShellView?.monthPage?.month ?? selectedMonth;
  const bootstrapSummaryStart = bootstrapShellView?.summaryPage?.rangeStartMonth ?? selectedSummaryStart;
  const bootstrapSummaryEnd = bootstrapShellView?.summaryPage?.rangeEndMonth ?? selectedSummaryEnd;
  const bootstrapScope = bootstrapShellView?.monthPage?.selectedScope ?? selectedScope;

  useEffect(() => installMobileFocusVisibility(), []);

  useEffect(() => {
    document.title = getDocumentTitle(appEnvironment);
  }, [appEnvironment]);

  const canUseBootstrapRoutePage = useMemo(() => {
    if (!bootstrapShellView) {
      return false;
    }

    return canUseBootstrapRouteForTab(selectedTabId, {
      bootstrapMonth,
      bootstrapScope,
      bootstrapSummaryEnd,
      bootstrapSummaryStart,
      selectedMonth,
      selectedScope,
      selectedSummaryEnd,
      selectedSummaryStart
    });
  }, [
    bootstrapMonth,
    bootstrapScope,
    bootstrapShellView,
    bootstrapSummaryEnd,
    bootstrapSummaryStart,
    selectedMonth,
    selectedScope,
    selectedSummaryEnd,
    selectedSummaryStart,
    selectedTabId
  ]);
  const bootstrapParams = useMemo(
    () => buildBootstrapParams({
      month: bootstrapMonth,
      scope: bootstrapScope,
      summaryStart: bootstrapSummaryStart,
      summaryEnd: bootstrapSummaryEnd
    }),
    [bootstrapMonth, bootstrapScope, bootstrapSummaryEnd, bootstrapSummaryStart]
  );
  const bootstrapCacheKey = bootstrapParams.toString();
  const routePageRequest = useMemo(
    () => canUseBootstrapRoutePage ? null : buildRoutePageRequest({
      tabId: selectedTabId,
      viewId: selectedViewId,
      month: selectedMonth,
      scope: selectedScope,
      summaryStart: selectedSummaryStart,
      summaryEnd: selectedSummaryEnd
    }),
    [canUseBootstrapRoutePage, selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart, selectedTabId, selectedViewId]
  );
  const routePageCacheKey = routePageRequest ? `${routePageRequest.path}?${routePageRequest.params.toString()}` : "";

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

  const beginBootstrapLoad = useCallback(() => {
    let didFinish = false;
    setBootstrapLoadCount((count) => count + 1);

    return () => {
      if (didFinish) {
        return;
      }

      didFinish = true;
      setBootstrapLoadCount((count) => Math.max(0, count - 1));
    };
  }, []);

  useEffect(() => {
    if (!isBootstrapLoading) {
      setLoadingElapsedSeconds(0);
      return undefined;
    }

    setLoadingElapsedSeconds(Math.max(0, Math.floor((Date.now() - loadingStatus.startedAt) / 1000)));
    const timer = window.setInterval(() => {
      setLoadingElapsedSeconds(Math.max(0, Math.floor((Date.now() - loadingStatus.startedAt) / 1000)));
    }, LOADING_STATUS_POLL_MS);

    return () => window.clearInterval(timer);
  }, [isBootstrapLoading, loadingStatus.startedAt]);

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

  const clearBootstrapCache = useCallback(() => {
    bootstrapCacheVersionRef.current += 1;
    bootstrapCacheRef.current.clear();
    bootstrapInflightRef.current.clear();
    clearPersistedBootstrap();
  }, []);

  const clearRoutePageCache = useCallback(() => {
    routePageCacheVersionRef.current += 1;
    routePageCacheRef.current.clear();
    routePageInflightRef.current.clear();
  }, []);

  const clearEntriesPageCache = useCallback(() => {
    entriesPageCacheVersionRef.current += 1;
    entriesPageCacheRef.current.clear();
    entriesPageInflightRef.current.clear();
  }, []);
  const entriesPageCacheStore = useMemo(() => ({
    cacheRef: entriesPageCacheRef,
    inflightRef: entriesPageInflightRef,
    versionRef: entriesPageCacheVersionRef,
    clear: clearEntriesPageCache
  }), [clearEntriesPageCache]);

  const fetchEntriesPageData = useCallback(async (params, { bypassCache = false, signal } = {}) => {
    const cacheKey = params.toString();
    const cacheVersion = entriesPageCacheVersionRef.current;
    if (signal?.aborted) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }

    if (!bypassCache && entriesPageCacheRef.current.has(cacheKey)) {
      return entriesPageCacheRef.current.get(cacheKey);
    }

    if (!bypassCache && entriesPageInflightRef.current.has(cacheKey)) {
      const data = await entriesPageInflightRef.current.get(cacheKey);
      if (signal?.aborted) {
        throw new DOMException("Entries page request aborted.", "AbortError");
      }
      return data;
    }

    const request = fetch(`/api/entries-page?${cacheKey}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await buildRequestErrorMessage(response, "Entries page failed."));
        }
        const data = await response.json();
        if (entriesPageCacheVersionRef.current === cacheVersion) {
          entriesPageCacheRef.current.set(cacheKey, data);
        }
        return data;
      })
      .finally(() => {
        entriesPageInflightRef.current.delete(cacheKey);
      });

    entriesPageInflightRef.current.set(cacheKey, request);
    const data = await request;
    if (signal?.aborted || entriesPageCacheVersionRef.current !== cacheVersion) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }
    return data;
  }, []);

  const fetchBootstrapData = useCallback(async (params, { bypassCache = false, signal } = {}) => {
    const cacheKey = params.toString();
    const cacheVersion = bootstrapCacheVersionRef.current;
    if (signal?.aborted) {
      throw new DOMException("Bootstrap request aborted.", "AbortError");
    }

    if (!bypassCache && bootstrapCacheRef.current.has(cacheKey)) {
      updateLoadingStatus({
        label: "Using cached dashboard",
        detail: "Cached shell...",
        percent: 18
      });
      return bootstrapCacheRef.current.get(cacheKey);
    }

    if (!bypassCache && bootstrapInflightRef.current.has(cacheKey)) {
      updateLoadingStatus({
        label: "Waiting for dashboard data",
        detail: "Waiting for latest shell...",
        percent: 28
      });
      const data = await bootstrapInflightRef.current.get(cacheKey);
      if (signal?.aborted) {
        throw new DOMException("Bootstrap request aborted.", "AbortError");
      }
      return data;
    }

    updateLoadingStatus({
      label: "Requesting dashboard data",
      detail: "Loading dashboard...",
      percent: 35
    });
    const request = fetch(`/api/bootstrap?${cacheKey}`, { cache: "no-store" })
      .then(async (response) => {
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
              throw new Error(buildBootstrapErrorMessage(response.status, responseText));
            }

            throw new Error("Bootstrap returned invalid JSON.");
          }
        }

        if (!response.ok) {
          throw new Error(buildBootstrapErrorMessage(response.status, data?.message ?? responseText));
        }

        updateLoadingStatus({
          label: "Preparing dashboard shell",
          detail: "Building dashboard...",
          percent: 72
        });
        if (bootstrapCacheVersionRef.current === cacheVersion) {
          bootstrapCacheRef.current.set(cacheKey, data);
          writePersistedBootstrap(cacheKey, data);
        }
        return data;
      })
      .finally(() => {
        bootstrapInflightRef.current.delete(cacheKey);
      });

    bootstrapInflightRef.current.set(cacheKey, request);
    const data = await request;
    if (signal?.aborted || bootstrapCacheVersionRef.current !== cacheVersion) {
      throw new DOMException("Bootstrap request aborted.", "AbortError");
    }
    updateLoadingStatus({
      label: "Dashboard shell ready",
      detail: "Applying latest data...",
      percent: 82
    });
    return data;
  }, [updateLoadingStatus]);

  const loadBootstrap = useCallback(async (signal, { bypassCache = false } = {}) => {
    const data = await fetchBootstrapData(bootstrapParams, { bypassCache, signal });

    setBootstrapError("");
    setBootstrap(data);
    return data;
  }, [bootstrapParams, fetchBootstrapData]);

  const handleBootstrapFailure = useCallback((error) => {
    setBootstrap(null);
    setBootstrapError(describeBootstrapError(error));
    reportLoadingIssue("Load failed", error);
    updateLoadingStatus({
      label: "Dashboard load failed",
      detail: "Bootstrap request did not complete",
      percent: 100
    });
  }, [reportLoadingIssue, updateLoadingStatus]);

  const refreshBootstrap = useCallback(async ({ broadcast = false } = {}) => {
    clearBootstrapCache();
    clearRoutePageCache();
    setRoutePageData(null);
    const finishBootstrapLoad = beginBootstrapLoad();

    try {
      const data = await loadBootstrap(undefined, { bypassCache: true });

      if (!broadcast) {
        return data;
      }

      const payload = { type: "bootstrap-refresh", ts: Date.now() };
      try {
        syncChannelRef.current?.postMessage(payload);
      } catch {}

      try {
        window.localStorage.setItem(BOOTSTRAP_SYNC_STORAGE_KEY, JSON.stringify(payload));
      } catch {}

      return data;
    } finally {
      finishBootstrapLoad();
    }
  }, [beginBootstrapLoad, clearBootstrapCache, clearRoutePageCache, loadBootstrap]);

  const fetchRoutePageData = useCallback(async (request, { bypassCache = false, signal } = {}) => {
    if (!request) {
      return null;
    }

    const cacheKey = `${request.path}?${request.params.toString()}`;
    const cacheVersion = routePageCacheVersionRef.current;
    if (signal?.aborted) {
      throw new DOMException("Page request aborted.", "AbortError");
    }

    if (!bypassCache && routePageCacheRef.current.has(cacheKey)) {
      updateLoadingStatus({
        label: "Using cached page data",
        detail: "Cached page...",
        percent: 84
      });
      return routePageCacheRef.current.get(cacheKey);
    }

    if (!bypassCache && routePageInflightRef.current.has(cacheKey)) {
      updateLoadingStatus({
        label: "Waiting for page data",
        detail: "Waiting for page...",
        percent: 86
      });
      const data = await routePageInflightRef.current.get(cacheKey);
      if (signal?.aborted) {
        throw new DOMException("Page request aborted.", "AbortError");
      }
      return data;
    }

    const query = request.params.toString();
    const requestUrl = query ? `${request.path}?${query}` : request.path;
    updateLoadingStatus({
      label: "Loading current page",
      detail: "Loading page...",
      percent: 88
    });
    const pageRequest = fetch(requestUrl, { cache: "no-store" })
      .then(async (response) => {
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
              throw new Error(buildBootstrapErrorMessage(response.status, responseText));
            }

            throw new Error("Page request returned invalid JSON.");
          }
        }

        if (!response.ok) {
          throw new Error(buildBootstrapErrorMessage(response.status, data?.message ?? responseText));
        }

        if (routePageCacheVersionRef.current === cacheVersion) {
          routePageCacheRef.current.set(cacheKey, data);
        }
        return data;
      })
      .finally(() => {
        routePageInflightRef.current.delete(cacheKey);
      });

    routePageInflightRef.current.set(cacheKey, pageRequest);
    const data = await pageRequest;
    if (signal?.aborted || routePageCacheVersionRef.current !== cacheVersion) {
      throw new DOMException("Page request aborted.", "AbortError");
    }
    updateLoadingStatus({
      label: "Current page ready",
      detail: "Applying page...",
      percent: 96
    });
    return data;
  }, [updateLoadingStatus]);

  const refreshRoutePage = useCallback(async ({ broadcast = false, refreshShell = false } = {}) => {
    clearRoutePageCache();
    clearBootstrapCache();
    clearEntriesPageCache();

    if (!routePageRequest) {
      return refreshBootstrap({ broadcast });
    }

    if (refreshShell) {
      await refreshBootstrap({ broadcast });
    }

    const finishBootstrapLoad = beginBootstrapLoad();
    try {
      const data = await fetchRoutePageData(routePageRequest, { bypassCache: true });
      setRoutePageData(data);
      return data;
    } finally {
      finishBootstrapLoad();
    }
  }, [beginBootstrapLoad, clearBootstrapCache, clearEntriesPageCache, clearRoutePageCache, fetchRoutePageData, refreshBootstrap, routePageRequest]);

  const invalidatePageAndShellCaches = useCallback(() => {
    clearRoutePageCache();
    clearBootstrapCache();
    clearEntriesPageCache();
  }, [clearBootstrapCache, clearEntriesPageCache, clearRoutePageCache]);

  const prefetchRoutePage = useCallback(async (request) => {
    if (!request) {
      return;
    }

    const cacheKey = `${request.path}?${request.params.toString()}`;
    if (routePageCacheRef.current.has(cacheKey) || routePageInflightRef.current.has(cacheKey)) {
      return;
    }

    await fetchRoutePageData(request).catch(() => {});
  }, [fetchRoutePageData]);

  const prefetchEntriesPage = useCallback(async (params) => {
    const cacheKey = params.toString();
    if (entriesPageCacheRef.current.has(cacheKey) || entriesPageInflightRef.current.has(cacheKey)) {
      return;
    }

    await fetchEntriesPageData(params).catch(() => {});
  }, [fetchEntriesPageData]);

  useEffect(() => {
    const controller = new AbortController();
    startLoadingStatus({
      label: "Preparing dashboard shell",
      detail: "Checking cache...",
      percent: 10
    });
    if (!bootstrapCacheRef.current.has(bootstrapCacheKey)) {
      const persistedBootstrap = readPersistedBootstrap(bootstrapCacheKey);
      if (persistedBootstrap) {
        bootstrapCacheRef.current.set(bootstrapCacheKey, persistedBootstrap);
        updateLoadingStatus({
          label: "Using cached dashboard",
          detail: "Cached shell...",
          percent: 16
        });
      }
    }

    const hasCachedBootstrap = bootstrapCacheRef.current.has(bootstrapCacheKey);
    const finishBootstrapLoad = hasCachedBootstrap ? null : beginBootstrapLoad();

    void loadBootstrap(controller.signal)
      .then(async () => {
        if (!hasCachedBootstrap) {
          return;
        }

        try {
          const data = await fetchBootstrapData(bootstrapParams, {
            bypassCache: true,
            signal: controller.signal
          });
          if (!controller.signal.aborted) {
            setBootstrapError("");
            setBootstrap(data);
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (!hasCachedBootstrap) {
          handleBootstrapFailure(error);
        }
      })
      .finally(() => finishBootstrapLoad?.());

    return () => {
      controller.abort();
      finishBootstrapLoad?.();
    };
  }, [beginBootstrapLoad, bootstrapCacheKey, bootstrapParams, fetchBootstrapData, handleBootstrapFailure, loadBootstrap]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let channel = null;
    if ("BroadcastChannel" in window) {
      channel = new window.BroadcastChannel(BOOTSTRAP_SYNC_CHANNEL);
      syncChannelRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === "bootstrap-refresh") {
          clearBootstrapCache();
          clearRoutePageCache();
          const finishBootstrapLoad = beginBootstrapLoad();
          void loadBootstrap()
            .catch(handleBootstrapFailure)
            .finally(finishBootstrapLoad);
        }
      };
    }

    const handleStorage = (event) => {
      if (event.key === BOOTSTRAP_SYNC_STORAGE_KEY && event.newValue) {
        clearBootstrapCache();
        clearRoutePageCache();
        const finishBootstrapLoad = beginBootstrapLoad();
        void loadBootstrap()
          .catch(handleBootstrapFailure)
          .finally(finishBootstrapLoad);
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
  }, [beginBootstrapLoad, clearBootstrapCache, clearRoutePageCache, handleBootstrapFailure, loadBootstrap]);

  const hasBootstrap = Boolean(bootstrap);

  useEffect(() => {
    if (!hasBootstrap || !routePageRequest) {
      setRoutePageData(null);
      return undefined;
    }

    const controller = new AbortController();
    const hasCachedPage = routePageCacheRef.current.has(routePageCacheKey);
    if (!hasCachedPage) {
      updateLoadingStatus({
        label: "Preparing current page",
        detail: "Preparing page...",
        percent: 84
      });
    }
    const finishBootstrapLoad = hasCachedPage ? null : beginBootstrapLoad();

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
      .finally(() => finishBootstrapLoad?.());

    return () => {
      controller.abort();
      finishBootstrapLoad?.();
    };
  }, [beginBootstrapLoad, fetchRoutePageData, hasBootstrap, reportLoadingIssue, routePageCacheKey, routePageRequest, updateLoadingStatus]);

  const view = useMemo(
    () => bootstrap?.views.find((item) => item.id === selectedViewId) ?? null,
    [bootstrap, selectedViewId]
  );
  const activeView = useMemo(
    () => mergeRoutePageIntoView(view, routePageData, selectedTabId),
    [routePageData, selectedTabId, view]
  );
  const pageView = activeView ?? view;
  const householdView = bootstrap?.views.find((item) => item.id === "household") ?? pageView;
  const defaultSplitsViewId = bootstrap?.viewerPersonId
    ?? bootstrap?.household?.people?.[0]?.id
    ?? bootstrap?.selectedViewId
    ?? "household";
  const selectedEntriesScope = searchParams.get("entries_scope") ?? pageView?.monthPage.selectedScope ?? "direct_plus_shared";
  const householdMonthEntries = useMemo(
    () => selectedTabId === "month" && Array.isArray(routePageData?.householdMonthEntries)
      ? routePageData.householdMonthEntries
      : bootstrap?.views.find((item) => item.id === "household")?.monthPage.entries ?? [],
    [bootstrap, routePageData, selectedTabId]
  );
  const categories = useMemo(
    () => bootstrap?.categories.map((category) => ({ ...category, ...(categoryOverrides[category.id] ?? {}) })) ?? [],
    [bootstrap, categoryOverrides]
  );
  const availableMonths = useMemo(
    () => bootstrap?.views[0]?.summaryPage.availableMonths.slice().sort() ?? [],
    [bootstrap]
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
    () => !isDetailMonthTab && pageView
      ? [...new Set(pageView.summaryPage.availableMonths.map((month) => Number(month.slice(0, 4))))].sort((left, right) => left - right)
      : [],
    [isDetailMonthTab, pageView]
  );
  const summaryAvailableMonthsForPickerYear = useMemo(
    () => !isDetailMonthTab && pageView && rangePickerStartYear != null
      ? pageView.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerStartYear)
      : [],
    [isDetailMonthTab, rangePickerStartYear, pageView]
  );
  const summaryAvailableMonthsForEndPickerYear = useMemo(
    () => !isDetailMonthTab && pageView && rangePickerEndYear != null
      ? pageView.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerEndYear)
      : [],
    [isDetailMonthTab, rangePickerEndYear, pageView]
  );

  useEffect(() => {
    if (
      !bootstrap
      || bootstrapError
      || isBootstrapLoading
      || typeof window === "undefined"
      || window.navigator?.connection?.saveData
      || window.matchMedia?.("(pointer: coarse)")?.matches
    ) {
      return undefined;
    }

    let isCancelled = false;
    const bootstrapVersion = bootstrapCacheVersionRef.current;
    const routePageVersion = routePageCacheVersionRef.current;
    const entriesPageVersion = entriesPageCacheVersionRef.current;
    const isStable = () => !isCancelled
      && bootstrapCacheVersionRef.current === bootstrapVersion
      && routePageCacheVersionRef.current === routePageVersion
      && entriesPageCacheVersionRef.current === entriesPageVersion
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
      } else if (selectedTabId === "summary" && pageView?.summaryPage.availableMonths.length) {
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
    bootstrap,
    bootstrapError,
    isBootstrapLoading,
    pageView,
    prefetchEntriesPage,
    prefetchRoutePage,
    selectedMonth,
    selectedScope,
    selectedTabId,
    selectedViewId
  ]);

  useEffect(() => {
    if (!bootstrap || bootstrapError || typeof window === "undefined" || window.navigator?.connection?.saveData) {
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
    bootstrap,
    bootstrapError,
    selectedTabId
  ]);

  useEffect(() => {
    if (!bootstrap) {
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

    const matchesKnownView = bootstrap.views.some((item) => item.id === selectedViewId);
    if (matchesKnownView) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", bootstrap.selectedViewId);
      return next;
    }, { replace: true });
  }, [bootstrap, defaultSplitsViewId, explicitViewId, selectedTabId, selectedViewId, setSearchParams]);

  useEffect(() => {
    if (!bootstrap?.viewerRegistration) {
      setLoginRegistrationDraft(null);
      setLoginRegistrationError("");
      return;
    }

    if (bootstrap.viewerRegistration.email === suppressedLoginRegistrationEmail) {
      setLoginRegistrationDraft(null);
      setLoginRegistrationError("");
      return;
    }

    setLoginRegistrationDraft((current) => {
      if (current?.email === bootstrap.viewerRegistration.email) {
        return current;
      }
      const suggestedPerson = bootstrap.household.people.find((person) => person.id === bootstrap.viewerRegistration.suggestedPersonId)
        ?? bootstrap.household.people[0];
      return {
        email: bootstrap.viewerRegistration.email,
        personId: suggestedPerson?.id ?? "",
        name: isPlaceholderPersonName(suggestedPerson?.name) ? "" : suggestedPerson?.name ?? ""
      };
    });
  }, [bootstrap, suppressedLoginRegistrationEmail]);

  useEffect(() => {
    if (!bootstrap || !availableMonths.length) {
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
  }, [availableMonths, bootstrap, selectedMonth, setSearchParams]);

  useEffect(() => {
    if (isDetailMonthTab || !pageView?.summaryPage.availableMonths.length) {
      return;
    }

    const summaryMonths = pageView.summaryPage.availableMonths;
    const startIsValid = selectedSummaryStart && summaryMonths.includes(selectedSummaryStart);
    const endIsValid = selectedSummaryEnd && summaryMonths.includes(selectedSummaryEnd);
    if (startIsValid && endIsValid && selectedSummaryStart <= selectedSummaryEnd) {
      return;
    }

    const resolvedEndMonth = endIsValid ? selectedSummaryEnd : summaryMonths[summaryMonths.length - 1];
    const endIndex = summaryMonths.indexOf(resolvedEndMonth);
    const startMonth = summaryMonths[Math.max(0, endIndex - 11)];
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", resolvedEndMonth);
      const focus = next.get("summary_focus");
      if (focus && focus !== SUMMARY_FOCUS_OVERALL && !summaryMonths.includes(focus)) {
        next.delete("summary_focus");
      }
      return next;
    }, { replace: true });
  }, [isDetailMonthTab, pageView, selectedSummaryEnd, selectedSummaryStart, setSearchParams]);

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

  if (bootstrapError) {
    return (
      <main className="shell">
        <EnvironmentBanner environment={appEnvironment} />
        <section className="panel">
          <p>{messages.common.bootstrapErrorTitle}</p>
          <p>{bootstrapError}</p>
          {loadingStatus.issue ? <p className="app-loading-issue-inline">{loadingStatus.issue}</p> : null}
        </section>
      </main>
    );
  }

  if (!bootstrap || !view) {
    return (
      <main className="shell">
        <EnvironmentBanner environment={appEnvironment} />
        <AppLoadingPanel status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />
      </main>
    );
  }

  const periodMode = isDetailMonthTab ? messages.period.month : messages.period.year;
  const periodLabel = isDetailMonthTab
    ? formatMonthLabel(selectedMonth)
    : `${formatMonthLabel(pageView.summaryPage.rangeStartMonth)} - ${formatMonthLabel(pageView.summaryPage.rangeEndMonth)}`;
  const pendingCategorySuggestionCount = bootstrap.settingsPage?.categoryMatchRuleSuggestions?.length ?? 0;
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
  const stickyScopeConfig = selectedTabId === "month"
    ? {
        selectedKey: pageView.monthPage.selectedScope,
        paramKey: "scope",
        label: "Month view controls"
      }
    : selectedTabId === "entries"
      ? {
          selectedKey: selectedEntriesScope,
          paramKey: "entries_scope",
          label: "Entries view controls"
        }
      : null;
  const mobileScopeLabels = {
    direct: "Direct",
    shared: "Shared",
    direct_plus_shared: "Direct+Shared"
  };
  const mobileContextScopes = stickyScopeConfig ? pageView.monthPage.scopes ?? [] : [];
  const selectedMobileScope = stickyScopeConfig
    ? mobileContextScopes.find((scope) => scope.key === stickyScopeConfig.selectedKey) ?? null
    : null;
  const mobileContextSummary = selectedMobileScope
    ? `${pageView.label} · ${mobileScopeLabels[selectedMobileScope.key] ?? selectedMobileScope.label}`
    : pageView.label;
  const showMobileContextSticky = Boolean(stickyScopeConfig);
  const showMobileContextScopeSection = Boolean(stickyScopeConfig) && mobileContextScopes.length > 1;

  useEffect(() => {
    if (!showMobileContextSticky && mobileContextOpen) {
      setMobileContextOpen(false);
    }
  }, [mobileContextOpen, showMobileContextSticky]);

  function handleViewChange(nextViewId) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", nextViewId);
      if (selectedTabId === "entries") {
        if (nextViewId === "household") {
          next.delete("entry_person");
        } else {
          const person = bootstrap.household.people.find((item) => item.id === nextViewId);
          if (person) {
            next.set("entry_person", person.name);
          }
        }
      }
      return next;
    });
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
    clearBootstrapCache();
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
      clearBootstrapCache();
      clearRoutePageCache();
      clearEntriesPageCache();
      await refreshBootstrap({ broadcast: true });
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
    const viewerEmail = bootstrap.viewerIdentity?.email;
    const viewerPersonId = bootstrap.viewerIdentity?.personId;
    setLoginIdentityError("");
    setIsUnregisteringLogin(true);
    try {
      const response = await fetch("/api/login-identities/unregister", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error ?? "Login could not be unregistered.");
      }
      clearBootstrapCache();
      clearRoutePageCache();
      clearEntriesPageCache();
      if (viewerEmail) {
        setSuppressedLoginRegistrationEmail(viewerEmail);
      }
      await refreshBootstrap({ broadcast: true });
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
            {bootstrap.household.people.map((person) => (
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
                        {formatMonthLabel(pageView.summaryPage.rangeStartMonth)}
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
                        {formatMonthLabel(pageView.summaryPage.rangeEndMonth)}
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
                <button type="button" className="mobile-context-trigger" aria-label={stickyScopeConfig.label}>
                  <span className="mobile-context-trigger-copy">
                    <span className="mobile-context-trigger-label">{mobileContextSummary}</span>
                    <span className="mobile-context-trigger-hint">View and scope</span>
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
                    <div className="pill-row mobile-context-pill-row">
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
                      {bootstrap.household.people.map((person) => (
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

      <section className="grid app-route-grid" aria-busy={isBootstrapLoading ? "true" : "false"}>
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
                  accounts={bootstrap.accounts}
                  people={bootstrap.household.people}
                  categories={categories}
                  householdMonthEntries={householdMonthEntries}
                  onCategoryAppearanceChange={handleCategoryAppearanceChange}
                  onRefresh={() => refreshRoutePage()}
                />
              )}
            />
            <Route
              path="/entries"
              element={(
                <EntriesPanel
                  view={pageView}
                  entriesSourceView={householdView}
                  selectedMonth={selectedMonth}
                  availableMonths={availableMonths}
                  accounts={bootstrap.accounts}
                  categories={categories}
                  people={bootstrap.household.people}
                  onCategoryAppearanceChange={handleCategoryAppearanceChange}
                  onInvalidateBootstrapCache={invalidatePageAndShellCaches}
                  entriesPageCache={entriesPageCacheStore}
                />
              )}
            />
            <Route
              path="/splits"
              element={(
                <SplitsPanel
                  view={pageView}
                  categories={categories}
                  people={bootstrap.household.people}
                  onRefresh={() => refreshRoutePage({ refreshShell: true, broadcast: true })}
                />
              )}
            />
            <Route
              path="/imports"
              element={(
                <ImportsPanel
                  importsPage={routePageData?.importsPage ?? bootstrap.importsPage}
                  viewId={pageView.id}
                  viewLabel={pageView.label}
                  accounts={bootstrap.accounts}
                  categories={categories}
                  people={bootstrap.household.people}
                  onRefresh={(options) => refreshRoutePage(options)}
                />
              )}
            />
            <Route
              path="/settings"
              element={(
                <SettingsPanel
                  settingsPage={routePageData?.settingsPage ?? bootstrap.settingsPage}
                  accounts={bootstrap.accounts}
                  categories={categories}
                  people={bootstrap.household.people}
                  viewId={pageView.id}
                  viewLabel={pageView.label}
                  appEnvironment={appEnvironment}
                  viewerIdentity={bootstrap.viewerIdentity}
                  loginIdentityError={loginIdentityError}
                  isUnregisteringLogin={isUnregisteringLogin}
                  onUnregisterLogin={handleUnregisterLogin}
                  onLogout={handleLogout}
                  onRefresh={() => refreshBootstrap({ broadcast: true })}
                />
              )}
            />
            <Route path="/faq" element={<FaqPanel viewLabel={pageView.label} categories={categories} />} />
            <Route path="*" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
          </Routes>
        </Suspense>
        {isBootstrapLoading ? <AppLoadingOverlay status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} /> : null}
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
                        const person = bootstrap.household.people.find((item) => item.id === event.target.value);
                        setLoginRegistrationDraft((current) => current ? {
                          ...current,
                          personId: event.target.value,
                          name: isPlaceholderPersonName(person?.name) ? "" : person?.name ?? current.name
                        } : current);
                      }}
                    >
                      {bootstrap.household.people.map((person) => (
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

function buildBootstrapParams({ month, scope, summaryStart, summaryEnd }) {
  const params = new URLSearchParams({
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

function sanitizeTabParams(params, tabId) {
  if (tabId !== "entries") {
    [
      "action",
      "amount",
      "merchant",
      "description",
      "date",
      "account",
      "account_id",
      "category",
      "note",
      "owner",
      "shared",
      "editing_entry",
      "entries_scope",
      "entry_id",
      "entry_wallet",
      "entry_category",
      "entry_person",
      "entry_type"
    ].forEach((key) => params.delete(key));
  }

  if (tabId !== "splits") {
    [
      "split_group",
      "split_mode",
      "editing_split_expense"
    ].forEach((key) => params.delete(key));
  }
}

function buildEntriesPageParams({ viewId, month }) {
  return new URLSearchParams({
    view: viewId,
    month
  });
}

function getSelectedTabId(pathname) {
  if (pathname.startsWith("/entries")) {
    return "entries";
  }

  return routeTabs.find((tab) => tab.path === pathname)?.id ?? "summary";
}

function buildRoutePageRequest({ tabId, viewId, month, scope, summaryStart, summaryEnd }) {
  if (tabId === "summary") {
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
    return { path: "/api/summary-page", params };
  }

  if (tabId === "month") {
    return {
      path: "/api/month-page",
      params: new URLSearchParams({
        view: viewId,
        month,
        scope
      })
    };
  }

  if (tabId === "splits") {
    return {
      path: "/api/splits-page",
      params: new URLSearchParams({
        view: viewId,
        month
      })
    };
  }

  if (tabId === "imports") {
    return { path: "/api/imports-page", params: new URLSearchParams() };
  }

  if (tabId === "settings") {
    return { path: "/api/settings-page", params: new URLSearchParams() };
  }

  return null;
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

function mergeRoutePageIntoView(view, pageData, tabId) {
  if (!view || !pageData) {
    return view;
  }

  if ((tabId === "summary" || tabId === "month" || tabId === "splits") && pageData.viewId !== view.id) {
    return view;
  }

  if (tabId === "summary" && pageData.summaryPage) {
    return {
      ...view,
      label: pageData.label ?? view.label,
      summaryPage: pageData.summaryPage
    };
  }

  if (tabId === "month" && pageData.monthPage) {
    return {
      ...view,
      label: pageData.label ?? view.label,
      summaryPage: {
        ...view.summaryPage,
        ...(pageData.summaryPage ?? {})
      },
      monthPage: pageData.monthPage
    };
  }

  if (tabId === "splits" && pageData.splitsPage) {
    return {
      ...view,
      label: pageData.label ?? view.label,
      splitsPage: pageData.splitsPage
    };
  }

  return view;
}
