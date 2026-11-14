// Keeps account-display in the entry chunk. Summary and several lazy routes
// share it; as its own chunk it stops the bundler merging React and the copy
// into the entry, which adds two first-screen files (check:bundle fails).
import "./account-display";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { createPortal, flushSync } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Receipt,
  Plus
} from "lucide-react";
import {
  useLocation,
  useNavigate
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
  buildAskLocation,
  buildEntriesPageParams,
  buildPageViewFromRouteData,
  buildRoutePageRequest,
  getAppShellAvailableViewIds,
  getSelectedTabId,
  resolveRouteViewId,
  sanitizeTabParams
} from "./app-routing";
import { planReturnToCheck, useReturnToCheck } from "./return-to-check";
import {
  AppLoadingOverlay,
  EnvironmentBanner,
  ShellErrorScreen,
  ShellLoadingScreen
} from "./app-shell-status";
import { ScreenErrorBoundary } from "./screen-error-boundary";
import { ErrorPanel, StateBanner } from "./ui-states";
import { ShellRouteTabs } from "./app-shell-navigation";
import { askConversationPresence } from "./ask-conversation-presence";
import { useRemindersCue } from "./reminders-cue";
import { AskDock, openAskDock } from "./ask-dock";
import { PeriodMonthPicker } from "./app-shell-period-pickers";
import { slugify } from "./category-utils";
import { formatMonthLabel } from "./formatters";
import { TotalsVisibilityToggle, useMoneyPrivacy } from "./money-privacy";
import { getPersonColourVars } from "./person-colour";
import {
  buildAppShellErrorMessage,
  buildRequestFailureMessage,
  buildRequestErrorMessage,
  describeAppShellError,
  isAppShellResourceLimitError
} from "./request-errors";
import { fetchTextWithTransientWorkerRetry } from "./request-timeout";
import { installMobileFocusVisibility } from "./mobile-focus-visibility";
import { queryKeys, summaryPageKeyFromParams } from "./query-keys";
import { fetchQueryWithLease, startSpeculativeQuery } from "./query-leases";
import { loadRouteModule } from "./route-modules";
import { useAppShellState } from "./use-app-shell-state";
import { useAppSyncSubscription } from "./use-app-sync-subscription";
import { useReferenceData } from "./use-reference-data";
import { useRefreshNotice } from "./use-refresh-notice";
import { useRouteData } from "./use-route-data";
import { useSummaryData } from "./use-summary-data";
import { useRouteWarmup, useRouteWarmupEngine } from "./use-route-warmup";
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
import { describeSettingsRefreshPlan, SETTINGS_ROUTE_REQUEST } from "./settings-refresh-request";
import {
  buildSummaryAccountPillsParams,
  buildSummaryPageParams,
  buildSummaryPageView,
  fetchSummaryAccountPillsQuery,
  fetchSummaryPageQuery,
  seedPinnedSummaryPage
} from "./summary-query";
import { buildSummaryMutationRefreshPlan } from "./summary-workflow";
import {
  buildSummaryMonthChoiceLocation,
  clampMonthToRange,
  stepMonthInRange
} from "./summary-month-choice";
import { ContextPersonChip } from "./mobile-context-chip";
import { MobileContextStatus, useContextAnnouncement } from "./mobile-context-status";
import { SummaryMonthIslandControl, SummaryMonthSelector } from "./summary-month-picker";
import { getCurrentMonthKey } from "../lib/month";
import { isMobileLayout } from "./use-viewport";
import { GUESSED_RESERVE_MS, IMPORT_BANNER_HEIGHT_KEY, initialBannerReserve } from "./import-banner-reserve";
import { useInsightAskLauncher } from "./use-insight-ask-launcher";
import { useLiveSearchParams } from "./use-live-search-params";
import { leadViewStore, useLeadView } from "./lead-view";
import { LeadViewSwitch } from "./lead-view-switch";
import { publishAppShell } from "./app-shell-watch";

const AskPanel = lazy(() => loadRouteModule("ask").then((module) => ({ default: module.AskPanel })));
const EntriesPanel = lazy(() => loadRouteModule("entries").then((module) => ({ default: module.EntriesPanel })));
const MobileContextSheet = lazy(() => import("./mobile-context-sheet.jsx"));
const CheckPanel = lazy(() => loadRouteModule("check").then((module) => ({ default: module.CheckPanel })));
const TripPanel = lazy(() => loadRouteModule("trip").then((module) => ({ default: module.TripPanel })));
const FaqPanel = lazy(() => loadRouteModule("faq").then((module) => ({ default: module.FaqPanel })));
const ImportsPanel = lazy(() => loadRouteModule("imports").then((module) => ({ default: module.ImportsPanel })));
const MonthPanel = lazy(() => loadRouteModule("month").then((module) => ({ default: module.MonthPanel })));
const SettingsPanel = lazy(() => loadRouteModule("settings").then((module) => ({ default: module.SettingsPanel })));
const SplitsPanel = lazy(() => loadRouteModule("splits").then((module) => ({ default: module.SplitsPanel })));
const SummaryPanel = lazy(() => loadRouteModule("summary").then((module) => ({ default: module.SummaryPanel })));
// The phone's "Pick a month" sheet loads when it is first opened.
const SummaryMonthSheet = lazy(() => import("./summary-month-sheet.jsx"));
// Only an unlinked login ever sees this dialog, and it uses the shared sheet frame.
const LoginRegistrationDialog = lazy(() => import("./login-registration-dialog.jsx").then((module) => ({ default: module.LoginRegistrationDialog })));

// Canonical route registry for the top navigation and route-based prefetching.
// One Summary tab stands for two routes: /summary (All months) and /month (one
// month of the range picked); see summary-month-choice.js. Primary tabs fill
// the phone's bottom bar, the rest sit behind its ••• menu. Ask is a primary
// tab on a phone only: a wide screen has its own way in, the Ask field at the
// bottom right that opens the conversation beside the page (AskDock), so
// there the tab is hidden (phoneOnly); /ask still opens from the + and
// receipt buttons. The phone bar reads Summary, Entries, Splits, Ask.
const routeTabs = [
  { id: "summary", path: "/summary", label: messages.tabs.summary, routeIds: ["summary", "month"], primary: true },
  // A trip or event's page (/trips/<id>) belongs under Entries, where trips are listed.
  { id: "entries", path: "/entries", label: messages.tabs.entries, routeIds: ["entries", "trip"], primary: true },
  { id: "splits", path: "/splits", label: messages.tabs.splits, primary: true },
  { id: "ask", path: "/ask", label: messages.tabs.ask, icon: "ask", phoneOnly: true, primary: true },
  { id: "imports", path: "/imports", label: messages.tabs.imports },
  { id: "settings", path: "/settings", label: messages.tabs.settings },
  { id: "faq", path: "/faq", label: messages.tabs.faq },
  { id: "check", path: "/check", label: messages.tabs.check }
];
const primaryRouteTabs = routeTabs.filter((tab) => tab.primary);
const secondaryRouteTabs = routeTabs.filter((tab) => !tab.primary);
// Page names for a load error: the Month page keeps its own name.
const routePageLabels = {
  ...Object.fromEntries(routeTabs.map((tab) => [tab.id, tab.label])),
  month: messages.tabs.month
};
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
  // The login's Plan | Simple choice rides on the shell (lead-view.js).
  useEffect(() => leadViewStore.applyShell(appShell), [appShell]);
  useEffect(() => publishAppShell(appShell), [appShell]);
  const [appShellLoadCount, setAppShellLoadCount] = useState(0);
  // Loading state is separate from shell state so route and shell fetches can
  // report progress without mutating the active payloads.
  const [loadingStatus, setLoadingStatus] = useState(() => createLoadingStatus());
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  // Mobile context state only controls the sheet chrome around the current
  // route, not the route payload itself.
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [desktopContextVisible, setDesktopContextVisible] = useState(false);
  // The phone's "Pick a month" sheet on the Summary tab.
  const [monthSheetOpen, setMonthSheetOpen] = useState(false);
  const [entriesMobileFilterProps, setEntriesMobileFilterProps] = useState(null);
  // The entries filter stack mirrors route state but only updates when the
  // effective filter props actually change.
  // The island's filter summary opens the sheet scrolled to the filters.
  const [mobileContextToFilters, setMobileContextToFilters] = useState(false);
  const islandTriggerRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const closeMobileContext = useCallback(() => {
    setMobileContextOpen(false);
    setMobileContextToFilters(false);
  }, []);
  // The Entries top's Filters row opens the same sheet as the floating bar.
  const openMobileContext = useCallback(() => {
    setMobileContextOpen(true);
  }, []);
  const openMobileFilters = useCallback(() => {
    flushSync(() => {
      setMobileContextToFilters(true);
      setMobileContextOpen(true);
    });
  }, []);
  const handleEntriesMobileFilterStateChange = useCallback((nextProps) => {
    setEntriesMobileFilterProps((current) => areEntriesMobileFilterPropsEqual(current, nextProps) ? current : nextProps);
  }, []);
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [rangePickerStartYear, setRangePickerStartYear] = useState(null);
  const [rangePickerEndYear, setRangePickerEndYear] = useState(null);
  const [monthPickerYear, setMonthPickerYear] = useState(null);
  // A functional update builds on the URL as it is now, not the last
  // render's params: a scope tapped right after Reset filters keeps them
  // cleared (use-live-search-params.js).
  const [searchParams, setSearchParams] = useLiveSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // "‹ Check my books" above a page that "Check my books" sent the person to
  // (return-to-check.js); null for everyone else.
  const returnToCheck = useReturnToCheck(location.pathname);
  // "Ask about this" on a Money insights line opens Ask with it.
  useInsightAskLauncher({ navigate, searchParams });
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
  // The Ask conversation lives above the routes (ask-conversation-store.js,
  // loaded with Ask); the shell only reads whether one is in progress, for
  // the Ask tab's dot and the way back in.
  const askConversation = useSyncExternalStore(askConversationPresence.subscribe, askConversationPresence.getSnapshot, askConversationPresence.getSnapshot);
  // New reminders for this view, from the answer Ask already kept (no request
  // of its own): the Ask tab's dot and the desktop Ask field's.
  const newReminderCount = useRemindersCue({ queryClient, viewId: routeViewId ?? "household" });
  const selectedSummaryStart = searchParams.get("summary_start") ?? undefined;
  const selectedSummaryEnd = searchParams.get("summary_end") ?? undefined;
  const isAppShellLoading = appShellLoadCount > 0;
  const [importInboxBanner, setImportInboxBanner] = useState(null);
  // Whether the Imports cache has answered yet (the banner reads it), and the
  // height the banner had on this device last time: kept as its slot until
  // the answer comes, so the banner arriving moves nothing under it.
  const [importBannerKnown, setImportBannerKnown] = useState(false);
  // A device that has never seen the banner keeps the room a banner usually
  // takes (import-banner-reserve.js) and gives it back if no answer comes.
  const [initialBanner] = useState(() => initialBannerReserve({ storage: readStorage(), phone: isMobileLayout(), width: window.innerWidth }));
  const [guessedRoomReleased, setGuessedRoomReleased] = useState(false);
  const importBannerReserve = guessedRoomReleased ? 0 : initialBanner.height;
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

  // Openable figures (figure-menu.js, design.md "Openable figures"): a tap,
  // click, Enter or Space on a [data-fig] loads the menu on first use and
  // opens it. Its choices come back as `monies:money-action`: a location
  // (Entries narrowed to the figure, the Month plan, Splits), or "Ask about
  // this" with its question asked and answered at once (as if typed): the
  // Ask page on a phone, the Ask panel beside the page on a wider screen.
  // The shell navigates, so the router and the dock's launcher stay out of
  // the menu's chunk.
  const moneyActionRef = useRef(/** @type {(detail: any) => void} */ (() => {}));
  moneyActionRef.current = (detail) => {
    if (detail?.entries) {
      navigate(detail.entries);
    } else if (detail?.askText) {
      if (isMobileLayout()) {
        navigate(buildAskLocation(searchParams), { state: { askQuestion: { text: detail.askText } } });
      } else {
        openAskDock({ intent: { mode: "chat" }, question: detail.askText });
      }
    }
  };
  useEffect(() => {
    const onMoneyAction = (event) => moneyActionRef.current(/** @type {CustomEvent} */ (event).detail);
    const onFigure = (event) => {
      const figure = event.target.closest?.("[data-fig]");
      if (figure && (event.type === "click" || (figure.tagName !== "BUTTON" && (event.key === "Enter" || event.key === " ")))) {
        // Captured, so the row or card around the figure does not act too.
        event.preventDefault();
        event.stopPropagation();
        import("./figure-menu.js").then((menu) => menu.toggleFigureMenu(figure), () => {});
      }
    };
    window.addEventListener("monies:money-action", onMoneyAction);
    document.addEventListener("click", onFigure, true);
    document.addEventListener("keydown", onFigure, true);
    return () => {
      window.removeEventListener("monies:money-action", onMoneyAction);
      document.removeEventListener("click", onFigure, true);
      document.removeEventListener("keydown", onFigure, true);
    };
  }, []);

  // The active route's code loads beside its data rather than after it (the
  // panel renders only once its data is here). This is the page being
  // opened, never another route, so it is not warmup. It also starts
  // Summary's Money insights module in time for the panel's first render
  // (summary-panel.jsx, money-insights-loader.js).
  useEffect(() => {
    loadRouteModule(selectedTabId).catch(() => {});
  }, [selectedTabId]);

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
          throw new Error(buildRequestFailureMessage("Entries shell request", response.status, responseText));
        }

        throw new Error("Entries shell returned invalid JSON.");
      }
    }

    if (!response.ok) {
      throw new Error(buildRequestFailureMessage("Entries shell request", response.status, data?.message ?? data?.error ?? responseText));
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
  const fetchRoutePageResponse = useCallback(async (request, { bypassCache = false, signal = undefined } = {}) => {
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
              throw new Error(buildRequestFailureMessage("Page request", response.status, responseText));
            }

            throw new Error("Page request returned invalid JSON.");
          }
        }

        if (!response.ok) {
          throw new Error(buildRequestFailureMessage("Page request", response.status, data?.message ?? data?.error ?? responseText));
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

  // A required read for the small optional reads a route makes itself (the
  // Claude credit status on Ask and Settings), so they share the shell's
  // leases and timing without importing query-leases into a route chunk.
  const fetchRequiredQuery = useCallback((options) => fetchQueryWithLease(queryClient, options), [queryClient]);
  // And its optional twin (a Splits section's rows read ahead on hover).
  const startOptionalQuery = useCallback((options) => startSpeculativeQuery(queryClient, options), [queryClient]);

  // The Ask page borrows the Entries page DTO (its split groups, and the
  // Apple Pay Shortcut's saved entry) through the same required read, so a
  // later visit to Entries joins it.
  const fetchAskEntriesPage = useCallback(
    (params, options = {}) => fetchRoutePageResponse({ path: "/api/entries-page", params }, options),
    [fetchRoutePageResponse]
  );

  // Month's Accounts section and check-in read wallet balances and statement
  // health from the view's account pills, the query Summary's "Wallets in
  // view" uses, fetched beside the month page and with the same cache
  // bypass, so the month page stays month rows and metrics only and a
  // Summary visit's warm pills are reused.
  const fetchRoutePageData = useCallback(async (request, options = {}) => {
    if (request?.path !== "/api/month-page") {
      return fetchRoutePageResponse(request, options);
    }
    const pillsParams = buildSummaryAccountPillsParams({ viewId: request.params.get("view") ?? "household" });
    const [data, pills] = await Promise.all([
      fetchRoutePageResponse(request, options),
      fetchSummaryAccountPillsQuery(queryClient, pillsParams, options)
    ]);
    return data ? { ...data, accountPills: pills?.accountPills ?? [] } : data;
  }, [fetchRoutePageResponse, queryClient]);

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
    // Settled rows (splits-settled-rows.js) belong to no month: a save or
    // an undo can move records in or out of a settled section, so every
    // view's are read again.
    clearSplitsPageCacheByPredicate((query) => String(query.queryKey?.[0]).startsWith("splits-settled-"));

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
  // A change Ask saved to settings data (payment ways, categories, a rule).
  const onAskSettingsMutation = useCallback((plan) => {
    void refreshCurrentSettingsPage({ ...plan, broadcast: true });
  }, [refreshCurrentSettingsPage]);

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
    const hasCachedPage = Boolean(queryClient.getQueryData(summaryPageKeyFromParams(summaryPageParams)));
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

  // With a month picked (/month) the Summary tab still shows the range: the
  // header's range control, the month arrows and the month sheet read the
  // Summary page for it. Coming from All months the page is already cached
  // (picking a month reuses it under the pinned range), so this costs no
  // request; only a /month deep link fetches it, beside the month page. It
  // never blocks the Month page or raises its error screen: without it the
  // header shows the range from the URL and the month controls wait.
  const loadSummaryRangeContext = useCallback((signal) => (
    summaryOwner.load({ pageParams: summaryPageParams, pillsParams: summaryAccountPillsParams, signal })
      .catch((error) => {
        reportLoadingIssue("Summary range load failed", error);
        return false;
      })
  ), [reportLoadingIssue, summaryAccountPillsParams, summaryOwner, summaryPageParams]);
  useEffect(() => {
    if (selectedTabId !== "month") {
      return undefined;
    }
    const controller = new AbortController();
    void loadSummaryRangeContext(controller.signal);
    return () => controller.abort();
  }, [loadSummaryRangeContext, selectedTabId]);

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
    : selectedTabId === "faq" || selectedTabId === "ask" || selectedTabId === "check" || selectedTabId === "trip" || Boolean(currentRoutePageData);
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
      // An open month sheet holds optional work back like the View sheet.
      mobileContextOpen: mobileContextOpen || monthSheetOpen,
      loginRegistrationBlocking
    }),
    [
      activeRouteKey,
      appShellError,
      currentPageView,
      isAppShellLoading,
      loginRegistrationBlocking,
      mobileContextOpen,
      monthSheetOpen,
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
  const getNavIntentProps = useRouteWarmup();
  // The engine is a lazy chunk, fetched the first time the page is usable.
  useRouteWarmupEngine({
    routeIdentity: activeRouteIdentity,
    routeWork,
    queryEpoch,
    queryClient,
    availableMonths,
    summaryRange: warmupSummaryRange
  });
  // Entries and Splits show one month in the header's month picker. The
  // Summary tab (Summary for All months, Month for a picked month) keeps the
  // header on its range and picks the month in the island, sheet or row.
  const isDetailMonthTab = renderedTabId === "entries" || renderedTabId === "splits";
  const selectedRouteIsDetailMonthTab = selectedTabId === "month" || selectedTabId === "entries" || selectedTabId === "splits";
  const isSummaryTab = renderedTabId === "summary" || renderedTabId === "month";
  // The month the Summary tab has picked, "" for All months. It follows the
  // URL at once, so the controls answer a tap before the Month page loads.
  const pickedSummaryMonth = isSummaryTab && selectedTabId === "month" ? selectedMonth : "";
  // The range on screen: Summary's own page, or with a month picked the
  // Summary page loaded beside it for the same range (never another view's
  // or scope's page still held by the owner).
  const summaryRangePage = renderedTabId === "summary"
    ? summaryPage
    : renderedTabId === "month" && summaryPageDataRequestKey === summaryPageParams.toString()
      ? summaryPageData?.summaryPage ?? null
      : null;
  const summaryRangeMonths = useMemo(() => summaryRangePage?.rangeMonths ?? [], [summaryRangePage]);
  const previousSummaryMonth = pickedSummaryMonth ? stepMonthInRange(summaryRangeMonths, pickedSummaryMonth, -1) : "";
  const nextSummaryMonth = pickedSummaryMonth ? stepMonthInRange(summaryRangeMonths, pickedSummaryMonth, 1) : "";
  const isSplitsTab = renderedTabId === "splits";
  // Imports, Settings and FAQ do not depend on a period, so the header keeps
  // the period control in place but greyed out and disabled there.
  const routeUsesPeriod = !["imports", "settings", "faq", "ask", "check", "trip"].includes(renderedTabId);
  const isPeriodPassive = isSplitsTab || !routeUsesPeriod;
  // A page load error names the page the person asked for.
  const selectedPageLabel = routePageLabels[selectedTabId] ?? "";
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
    () => summaryRangePage?.availableMonths
      ? [...new Set(summaryRangePage.availableMonths.map((month) => Number(month.slice(0, 4))))].sort((left, right) => left - right)
      : [],
    [summaryRangePage]
  );
  // Filter the summary picker months for the active start-year bucket.
  const summaryAvailableMonthsForPickerYear = useMemo(
    () => summaryRangePage?.availableMonths && rangePickerStartYear != null
      ? summaryRangePage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerStartYear)
      : [],
    [rangePickerStartYear, summaryRangePage]
  );
  // Filter the summary picker months for the active end-year bucket.
  const summaryAvailableMonthsForEndPickerYear = useMemo(
    () => summaryRangePage?.availableMonths && rangePickerEndYear != null
      ? summaryRangePage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerEndYear)
      : [],
    [rangePickerEndYear, summaryRangePage]
  );
  // Summary's month cards pick a month like the month controls do. The panel
  // gets a stable callback (the route element is memoized) that calls the
  // latest selectSummaryMonth, assigned below with the other handlers.
  const selectSummaryMonthRef = useRef(null);
  const openSummaryMonth = useCallback((month) => selectSummaryMonthRef.current?.(month), []);
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
  // Ask and Settings read the Claude credit status once they are usable
  // (claude-credit-status.js). Only those two routes see the flag, so it
  // never re-renders another route as optional work starts and stops.
  const creditStatusRouteUsable = (renderedTabId === "ask" || renderedTabId === "settings") && routeWork.usable;
  // Summary's Subscriptions and bills reads its data once the top summary is
  // usable; only Summary sees the flag, for the same reason.
  const summaryCardsUsable = renderedTabId === "summary" && routeWork.usable;
  const monthCardsUsable = renderedTabId === "month" && routeWork.usable;
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
          accounts={accounts}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
          onRefresh={saveSummaryMonthNote}
          onOpenMonth={openSummaryMonth}
          cardsUsable={summaryCardsUsable}
          fetchRequiredQuery={fetchRequiredQuery}
          runBackgroundRefresh={runBackgroundRefresh}
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
          isDemoEnvironment={appEnvironment === "demo"}
          cardsUsable={monthCardsUsable}
          fetchRequiredQuery={fetchRequiredQuery}
          rangeSummaryMonths={summaryRangePage?.months ?? null}
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
          onOpenMobileContext={openMobileContext}
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
          fetchRequiredQuery={fetchRequiredQuery}
          startOptionalQuery={startOptionalQuery}
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
          runBackgroundRefresh={runBackgroundRefresh}
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
          fetchRequiredQuery={fetchRequiredQuery}
          routeUsable={creditStatusRouteUsable}
        />
      );
    }

    if (renderedTabId === "faq") {
      return <FaqPanel viewLabel={pageView.label} categories={categories} />;
    }

    if (renderedTabId === "check") {
      return (
        <CheckPanel
          view={pageView}
          runBackgroundRefresh={runBackgroundRefresh}
          fetchRequiredQuery={fetchRequiredQuery}
          categories={categories}
          onEntryMutation={broadcastEntryMutation}
          onSplitMutation={broadcastSplitMutation}
        />
      );
    }

    if (renderedTabId === "trip") {
      return (
        <TripPanel
          fetchRequiredQuery={fetchRequiredQuery}
          categories={categories}
          onCategoryAppearanceChange={handleCategoryAppearanceChange}
        />
      );
    }

    if (renderedTabId === "ask") {
      return (
        <AskPanel
          view={pageView}
          selectedMonth={selectedMonth}
          selectedScope={selectedScope}
          accounts={accounts}
          categories={categories}
          people={appShell.household.people}
          trackedMonths={appShell.trackedMonths}
          shortcutSettings={appShell.settingsPage?.shortcutSettings}
          fetchEntriesPage={fetchAskEntriesPage}
          onEntryMutation={broadcastEntryMutation}
          onSplitMutation={broadcastSplitMutation}
          onSettingsMutation={onAskSettingsMutation}
          runBackgroundRefresh={runBackgroundRefresh}
          fetchRequiredQuery={fetchRequiredQuery}
          routeUsable={creditStatusRouteUsable}
        />
      );
    }

    return null;
  }, [
    appEnvironment,
    accounts,
    appShell?.household?.people,
    appShell?.settingsPage?.shortcutSettings,
    appShell?.trackedMonths,
    appShell?.viewerIdentity,
    broadcastEntryMutation,
    broadcastSplitMutation,
    onAskSettingsMutation,
    categories,
    creditStatusRouteUsable,
    summaryCardsUsable,
    monthCardsUsable,
    fetchAskEntriesPage,
    fetchRequiredQuery,
    closeMobileContext,
    entriesExternalRefreshToken,
    handleCategoryAppearanceChange,
    handleEntriesMobileFilterStateChange,
    handleLogout,
    handleUnregisterLogin,
    isUnregisteringLogin,
    loginIdentityError,
    mobileContextOpen,
    openMobileContext,
    openSummaryMonth,
    pageView,
    referenceData,
    refreshCurrentSettingsPage,
    refreshCurrentImportsPage,
    refreshCurrentMonthPage,
    refreshCurrentSplitsPage,
    renderedTabId,
    retryActivePageLoad,
    routePageData,
    runBackgroundRefresh,
    saveSummaryMonthNote,
    selectedMonth,
    selectedScope,
    syncAppShellAfterMutation
  ]);
  // Desktop Ask (ask-dock.jsx): the Ask page beside the page on screen, in
  // the dock's own conversation. It reports busy (a card being filled)
  // under no route key, so optional work waits for it, but it never makes a
  // route ready. Its view is the page's.
  const askDockView = useMemo(
    () => buildPageViewFromRouteData("ask", null, routeViewId, appShell),
    [appShell, routeViewId]
  );
  // A save in the panel also brings the page beside it up to date, as a
  // save from another browser tab does (the Entries list, Splits, Month or
  // Summary of that month).
  const onAskDockEntryMutation = useCallback((payload) => {
    broadcastEntryMutation(payload);
    void handleRemoteEntryMutation(payload);
  }, [broadcastEntryMutation, handleRemoteEntryMutation]);
  const onAskDockSplitMutation = useCallback((payload) => {
    broadcastSplitMutation(payload);
    void handleRemoteSplitMutation(payload);
  }, [broadcastSplitMutation, handleRemoteSplitMutation]);
  const renderAskDockConversation = useCallback(({ layout, canExpand, intent, visit }) => (
    <RouteWorkProvider registry={routeWorkRegistry} routeKey={null}>
      <AskPanel
        key={visit}
        placement={layout}
        canExpand={canExpand}
        intent={intent}
        view={askDockView}
        selectedMonth={selectedMonth}
        selectedScope={selectedScope}
        accounts={accounts}
        categories={categories}
        people={appShell?.household?.people ?? []}
        trackedMonths={appShell?.trackedMonths}
        shortcutSettings={appShell?.settingsPage?.shortcutSettings}
        fetchEntriesPage={fetchAskEntriesPage}
        onEntryMutation={onAskDockEntryMutation}
        onSplitMutation={onAskDockSplitMutation}
        onSettingsMutation={onAskSettingsMutation}
        runBackgroundRefresh={runBackgroundRefresh}
        fetchRequiredQuery={fetchRequiredQuery}
        routeUsable={routeWork.usable}
      />
    </RouteWorkProvider>
  ), [
    accounts,
    appShell?.household?.people,
    appShell?.settingsPage?.shortcutSettings,
    appShell?.trackedMonths,
    askDockView,
    categories,
    fetchAskEntriesPage,
    fetchRequiredQuery,
    onAskDockEntryMutation,
    onAskDockSplitMutation,
    onAskSettingsMutation,
    routeWork.usable,
    routeWorkRegistry,
    runBackgroundRefresh,
    selectedMonth,
    selectedScope
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
  // pageView is always set here: the shell returns the loading skeleton above
  // until the first page has settled, and a later navigation keeps the
  // previous page.
  const routeBody = (
    <>
      {showRoutePageError ? (
        <ErrorPanel
          className="route-page-error"
          title={messages.common.pageLoadErrorTitleFor(selectedPageLabel)}
          detail={messages.common.loadFailedDetail}
          technical={routePageError}
          actions={[{
            label: isRetryingRoutePage ? messages.common.working : messages.common.retryPageLoad,
            onClick: () => void retryRoutePageFromPanel(),
            disabled: isRetryingRoutePage,
            primary: true
          }]}
        />
      ) : null}
      {returnToCheck && renderedTabId === selectedTabId ? (
        <a
          className="return-to-check"
          href={`${returnToCheck.checkPath}`}
          aria-label={messages.returnToCheck.aria}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            const plan = planReturnToCheck(returnToCheck, window.history.state?.idx);
            if (plan.kind === "history") {
              navigate(-1);
            } else {
              navigate(plan.to);
            }
          }}
        >
          {messages.returnToCheck.label}
        </a>
      ) : null}
      <div className="route-page-body" style={{ display: showRoutePageError ? "none" : "contents" }}>
        <RouteWorkProvider registry={routeWorkRegistry} routeKey={currentPageView ? activeRouteKey : null}>
          {renderedRouteElement}
        </RouteWorkProvider>
      </div>
    </>
  );
  const showImportInboxBanner = Boolean(
    importInboxBanner
    && ["summary", "month"].includes(renderedTabId)
    && importInboxBanner.summary.requiredFileCount > 0
  );

  useEffect(() => {
    if (!initialBanner.guessed || importBannerKnown) return undefined;
    const timer = window.setTimeout(() => setGuessedRoomReleased(true), GUESSED_RESERVE_MS);
    return () => window.clearTimeout(timer);
  }, [importBannerKnown, initialBanner.guessed]);

  // Once the answer is in and there is nothing behind, the next visit reserves nothing.
  useEffect(() => {
    if (importBannerKnown && !showImportInboxBanner && ["summary", "month"].includes(renderedTabId)) {
      writeImportBannerHeight(0);
    }
  }, [importBannerKnown, renderedTabId, showImportInboxBanner]);

  // The import banner shows whatever the Imports query cache holds: filled by
  // visiting Imports, by desktop warmup, or by import mutations that refresh
  // it. The banner itself never fetches, so mobile never downloads the
  // Imports page just for it.
  useEffect(() => {
    const importsKeyHash = hashKey(queryKeys.importsPage());
    const readBanner = () => {
      const cached = /** @type {any} */ (queryClient.getQueryData(queryKeys.importsPage()));
      setImportInboxBanner(cached?.importsPage?.importInbox ?? null);
      setImportBannerKnown(Boolean(cached?.importsPage));
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
    // Ask has no period: its month is the context it was opened with (an
    // Apple Pay entry's own month), so it is never moved to a tracked one.
    if (!appShell || !availableMonths.length || selectedTabId === "ask") {
      return;
    }

    if (selectedRouteIsDetailMonthTab) {
      const routeMonth = currentPageView?.monthPage?.month;
      if (!routeMonth || routeMonth === selectedMonth) {
        return;
      }

      // Built from the address bar as it is now: a page that consumed its own
      // link parameters (Entries clearing a quick-entry link) in this same
      // commit has already replaced the URL, and this render's snapshot of
      // it would put them back.
      const next = new URLSearchParams(window.location.search);
      next.set("month", routeMonth);
      navigate({ pathname: location.pathname, search: `?${next.toString()}`, hash: location.hash }, { replace: true });
      return;
    }

    if (availableMonths.includes(selectedMonth)) {
      return;
    }

    // Keep a #section anchor (an FAQ guide deep link) while the month is
    // corrected; setSearchParams would drop it.
    const next = new URLSearchParams(window.location.search);
    next.set("month", availableMonths[availableMonths.length - 1]);
    navigate({ pathname: location.pathname, search: `?${next.toString()}`, hash: location.hash }, { replace: true });
  }, [availableMonths, appShell, currentPageView, location.hash, location.pathname, location.search, navigate, selectedMonth, selectedRouteIsDetailMonthTab, selectedTabId]);

  //Repair an explicit Summary range the data does not have (both tabs of the
  // Summary tab carry it), so the pickers and the URL agree.
  useEffect(() => {
    if (!isSummaryTab || !summaryRangePage?.availableMonths?.length) {
      return;
    }

    const summaryMonths = summaryRangePage.availableMonths;
    const hasExplicitSummaryRange = Boolean(selectedSummaryStart || selectedSummaryEnd);
    const startIsValid = selectedSummaryStart && summaryMonths.includes(selectedSummaryStart);
    const endIsValid = selectedSummaryEnd && summaryMonths.includes(selectedSummaryEnd);
    if (!hasExplicitSummaryRange) {
      return;
    }

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
      return next;
    }, { replace: true });
  }, [isSummaryTab, selectedSummaryEnd, selectedSummaryStart, setSearchParams, summaryRangePage]);

  // Initialize the range picker year buckets from the range on screen.
  useEffect(() => {
    // Summary can briefly hydrate without a fully bounded range, so this
    // effect only runs when both boundary months are actually present.
    if (!summaryRangePage?.rangeStartMonth || !summaryRangePage?.rangeEndMonth) {
      return;
    }

    const nextStartYear = Number(summaryRangePage.rangeStartMonth.slice(0, 4));
    const nextEndYear = Number(summaryRangePage.rangeEndMonth.slice(0, 4));
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
  }, [summaryAvailableYears, summaryRangePage]);

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
  // that it never cuts short. The sheet's lead also carries the line saying
  // what the scope counts, which desktop shows under the pills.
  const mobileContextScopeLabel = selectedViewSupportsScope && selectedMobileScope
    ? messages.views.scopeShortLabel[selectedMobileScope.key] ?? selectedMobileScope.label
    : "";
  const mobileContextScopeHint = selectedViewSupportsScope && selectedMobileScope
    ? messages.views.scopeHint[selectedMobileScope.key]?.(pageView?.label ?? "") ?? ""
    : "";
  const showMobileContextSticky = Boolean(stickyScopeConfig);
  const showMobileContextScopeSection = Boolean(stickyScopeConfig) && selectedViewSupportsScope && mobileContextScopes.length > 1;
  // What a screen reader hears on the Support bar's trigger: who, the scope,
  // then what it opens.
  const mobileContextTriggerName = [
    pageView?.label ?? "",
    mobileContextScopeLabel ? `· ${mobileContextScopeLabel}` : "",
    showMobileContextScopeSection ? "View and scope" : "View"
  ].filter(Boolean).join(" ");
  // The Summary tab moves its range from the header and picks its month in
  // the bar (All months, or one month with arrows); Entries keeps the bar's
  // month arrows for its single month.
  const showMobileMonthJump = showMobileContextSticky && isDetailMonthTab;
  const showMobileMonthChoice = showMobileContextSticky && isSummaryTab;
  const [floatingLeadView, setFloatingLeadView] = useLeadView();

  // The island's context line: what narrows Entries (with Clear), or a month
  // other than this one on the Summary tab (with a way back). It takes the
  // scope text's place in the same row while the scope is the default (or the
  // household's, which has none), so the island keeps its height; a scope
  // that is not the default stays visible and the line goes on a second row.
  const todayMonthKey = getCurrentMonthKey();
  const entriesIsland = showMobileContextSticky && renderedTabId === "entries" ? entriesMobileFilterProps?.island ?? null : null;
  const monthIsland = !entriesIsland && showMobileContextSticky && pickedSummaryMonth && pickedSummaryMonth !== todayMonthKey && summaryRangeMonths.includes(todayMonthKey);
  const islandActive = Boolean(entriesIsland || monthIsland);
  const islandStacked = islandActive && Boolean(mobileContextScopeLabel) && stickyScopeConfig?.selectedKey !== "direct_plus_shared";
  const islandInline = islandActive && !islandStacked;
  const islandLineProps = {
    kind: entriesIsland ? "filters" : "month",
    text: entriesIsland ? entriesIsland.text : pickedSummaryMonth ? formatMonthLabel(pickedSummaryMonth) : "",
    inline: islandInline,
    onOpen: openMobileFilters,
    // Focus goes to the island's trigger as the line goes away, so it is not lost.
    onClear: () => {
      entriesMobileFilterProps?.onResetFilters?.(true);
      islandTriggerRef.current?.focus({ preventScroll: true });
    },
    onBack: () => {
      selectSummaryMonth(todayMonthKey);
      islandTriggerRef.current?.focus({ preventScroll: true });
    }
  };
  const islandStatus = useContextAnnouncement(entriesIsland?.announce ?? "");

  // Wide long-page chrome returns after its header leaves. Splits shares the
  // tab bar even though its second control is the current group chooser. The
  // watcher and the direction button load after the route paints
  // (scroll-direction-fab.js), so the first screen does not carry them.
  useEffect(() => {
    if (!["summary", "month", "entries", "splits"].includes(renderedTabId)) {
      setDesktopContextVisible(false);
      return undefined;
    }
    let dispose;
    let cancelled = false;
    import("./scroll-direction-fab.js").then((module) => {
      if (!cancelled) dispose = module.mountLongPageChrome(() => setDesktopContextVisible(!isMobileLayout() && window.scrollY > 180));
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [renderedTabId]);

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
        title={messages.common.pageLoadErrorTitleFor(selectedPageLabel)}
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
    return <ShellLoadingScreen environment={appEnvironment} tabId={selectedTabId} status={loadingStatus} elapsedSeconds={loadingElapsedSeconds} />;
  }

  // The top chrome reflects the active period semantics of the current route.
  // A route without a period shows the last Summary range it knows (loaded,
  // then the URL), or the selected month when no range is known yet.
  const passiveRangeStart = summaryPageData?.summaryPage?.rangeStartMonth ?? selectedSummaryStart;
  const passiveRangeEnd = summaryPageData?.summaryPage?.rangeEndMonth ?? selectedSummaryEnd;
  const showsPassiveRange = !routeUsesPeriod && Boolean(passiveRangeStart && passiveRangeEnd);
  const showsMonthPeriod = isDetailMonthTab || (!routeUsesPeriod && !showsPassiveRange);
  const periodMode = showsMonthPeriod ? messages.period.month : messages.period.year;
  const periodLabel = showsMonthPeriod
    ? formatMonthLabel(selectedMonth)
    : showsPassiveRange
      ? `${formatMonthLabel(passiveRangeStart)} - ${formatMonthLabel(passiveRangeEnd)}`
      : summaryRangePage?.rangeStartMonth && summaryRangePage?.rangeEndMonth
        ? `${formatMonthLabel(summaryRangePage.rangeStartMonth)} - ${formatMonthLabel(summaryRangePage.rangeEndMonth)}`
        // A picked month's range is still loading: the URL's range, or the month.
        : renderedTabId === "month"
          ? selectedSummaryStart && selectedSummaryEnd
            ? `${formatMonthLabel(selectedSummaryStart)} - ${formatMonthLabel(selectedSummaryEnd)}`
            : formatMonthLabel(selectedMonth)
          : pageView.label;
  // The settings badge reads from the settings page cache so the shell stays a
  // reference-data payload instead of reabsorbing settings-page state.
  const cachedSettingsPage = /** @type {any} */ (queryClient.getQueryData(queryKeys.routeRequestKey(SETTINGS_ROUTE_REQUEST)));
  const pendingCategorySuggestionCount = cachedSettingsPage?.settingsPage?.categoryMatchRuleSuggestions?.length ?? 0;
  const buildTabTarget = (tab) => {
    // Each nav link preserves the relevant route query while stripping
    // parameters that belong to another tab.
    // The Summary tab always opens All months (/summary), also from a picked
    // month, like tapping a phone's active tab returns to its top level.
    const params = new URLSearchParams(searchParams);
    sanitizeTabParams(params, tab.id);
    // The Ask tab goes back to the conversation in progress: a new entry
    // card from the Entries + or the Splits receipt button reopens there.
    const resumeAsk = tab.id === "ask" && selectedTabId !== "ask" ? askConversation.resumeIntent : null;
    if (resumeAsk) {
      params.set("mode", resumeAsk.mode);
      if (resumeAsk.from) params.set("from", resumeAsk.from);
      if (resumeAsk.splitGroupId) params.set("split_group", resumeAsk.splitGroupId);
    }
    if (tab.id === "settings" && pendingCategorySuggestionCount) {
      params.set("settings_section", "categoryRules");
    } else {
      params.delete("settings_section");
    }

    return { pathname: tab.path, search: params.toString() ? `?${params.toString()}` : "" };
  };
  // The wide floating bar's tabs (the island's on Summary, Month and Entries,
  // the Splits bar's on Splits).
  const desktopFloatingTabs = desktopContextVisible ? (
    <ShellRouteTabs
      className="desktop-floating-tabs"
      ariaLabel={messages.tabs.keptInViewAriaLabel}
      primaryTabs={primaryRouteTabs}
      secondaryTabs={[]}
      selectedTabId={selectedTabId}
      buildTabTarget={buildTabTarget}
      getNavIntentProps={getNavIntentProps}
      pendingCategorySuggestionCount={pendingCategorySuggestionCount}
      askInProgress={askConversation.inProgress && selectedTabId !== "ask"}
      remindersCount={selectedTabId !== "ask" ? newReminderCount : 0}
      showPhoneOnly
      includeOverflow={false}
    />
  ) : null;
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

    if (!summaryRangePage) {
      return;
    }

    const availableSummaryMonths = summaryRangePage.availableMonths;
    const startIndex = availableSummaryMonths.indexOf(summaryRangePage.rangeStartMonth);
    const endIndex = availableSummaryMonths.indexOf(summaryRangePage.rangeEndMonth);
    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    const nextStartIndex = startIndex + direction;
    const nextEndIndex = endIndex + direction;
    if (nextStartIndex < 0 || nextEndIndex >= availableSummaryMonths.length) {
      return;
    }

    applySummaryRange(availableSummaryMonths[nextStartIndex], availableSummaryMonths[nextEndIndex]);
  }

  // A new range from the header (arrows or either end's picker). With a month
  // picked, a month the new range no longer has moves to its nearest month,
  // so the Month page always shows a month the range offers.
  function applySummaryRange(startMonth, endMonth) {
    const nextRangeMonths = summaryRangePage.availableMonths.filter((month) => month >= startMonth && month <= endMonth);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", endMonth);
      next.delete("summary_focus");
      if (pickedSummaryMonth) {
        next.set("month", clampMonthToRange(pickedSummaryMonth, nextRangeMonths));
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

  // The summary range start picker keeps the end month fixed.
  function handleSummaryStartMonthSelect(startMonth) {
    if (!summaryRangePage || startMonth > summaryRangePage.rangeEndMonth) {
      return;
    }
    applySummaryRange(startMonth, summaryRangePage.rangeEndMonth);
  }

  // The summary range end picker mirrors the start picker but updates the
  // right edge of the range.
  function handleSummaryEndMonthSelect(endMonth) {
    if (!summaryRangePage || endMonth < summaryRangePage.rangeStartMonth) {
      return;
    }
    applySummaryRange(summaryRangePage.rangeStartMonth, endMonth);
  }

  // The Summary tab's month choice (island, sheet, desktop row and Summary's
  // month cards): a month opens the Month page for it, "" returns to All
  // months. The range on screen is pinned into the URL so it stays put while
  // months change, and the loaded Summary page is kept for the pinned range.
  function selectSummaryMonth(month) {
    setMonthSheetOpen(false);
    const range = summaryRangePage?.rangeStartMonth && summaryRangePage?.rangeEndMonth
      ? { startMonth: summaryRangePage.rangeStartMonth, endMonth: summaryRangePage.rangeEndMonth }
      : null;
    const target = buildSummaryMonthChoiceLocation(location.search, month, range);
    if (range && !(selectedSummaryStart && selectedSummaryEnd) && summaryPageDataRequestKey) {
      seedPinnedSummaryPage(
        queryClient,
        new URLSearchParams(summaryPageDataRequestKey),
        buildSummaryPageParams({
          viewId: selectedViewId,
          month: month || selectedMonth,
          scope: selectedScope,
          summaryStart: range.startMonth,
          summaryEnd: range.endMonth
        })
      );
    }
    navigate(target);
  }
  selectSummaryMonthRef.current = selectSummaryMonth;

  // On a phone the + and receipt buttons open Ask as a new history entry.
  // The page's place (URL and scroll; the page adds an open sheet through
  // the event) is kept first on its own entry and handed to Ask, so Ask's
  // back link and the back gesture both return to it (ask-origin.js).
  function openAskFromPage(target, from) {
    const origin = { id: `${Date.now()}`, from, path: location.pathname + location.search, scrollY: window.scrollY, sheet: null };
    window.dispatchEvent(new CustomEvent("monies:ask-origin", { detail: origin }));
    navigate(origin.path, { replace: true, state: { askReturn: origin } });
    navigate(target, { state: { askOrigin: origin } });
  }

  // Opening the month sheet re-reads the range's Summary page when a save
  // since cleared it (the sheet shows the figures it has meanwhile).
  function openMonthSheet() {
    setMonthSheetOpen(true);
    if (renderedTabId === "month" && !queryClient.getQueryData(summaryPageKeyFromParams(summaryPageParams))) {
      void loadSummaryRangeContext();
    }
  }

  // "Change range" in the month sheet: close it and open the header's range
  // start picker, scrolled into view.
  function openHeaderRangePicker() {
    setMonthSheetOpen(false);
    window.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => {
      const trigger = document.querySelector(".control-bar .period-range-segment");
      if (trigger instanceof HTMLButtonElement) {
        trigger.click();
      }
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
                // Their colour (the Entries row edge) marks a person's view while it is active.
                style={/** @type {import("react").CSSProperties} */ (getPersonColourVars(person.name))}
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
            askInProgress={askConversation.inProgress && selectedTabId !== "ask"}
            remindersCount={selectedTabId !== "ask" ? newReminderCount : 0}
          />
          <div className={`period-nav-cluster ${isPeriodPassive ? "is-passive" : ""}`} aria-disabled={isPeriodPassive || undefined}>
            <button className="period-button" type="button" aria-label={messages.period.previousAriaLabel} onClick={() => handleMonthChange(-1)} disabled={isPeriodPassive}>‹</button>
            <div className="period-display">
              <span className="period-mode">{periodMode}</span>
              {!routeUsesPeriod ? (
                <strong className="period-range-value">{periodLabel}</strong>
              ) : isDetailMonthTab ? (
                <strong className="period-range-value">
                  <PeriodMonthPicker
                    modal={isSummaryTab}
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
              ) : summaryRangePage?.rangeStartMonth && summaryRangePage?.rangeEndMonth ? (
                <strong className="period-range-value">
                  <PeriodMonthPicker
                    modal={isSummaryTab}
                    triggerLabel={formatMonthLabel(summaryRangePage.rangeStartMonth)}
                    title="Start month"
                    hint="Choose the first month in the summary range."
                    yearsAriaLabel="Available start years"
                    years={summaryAvailableYears}
                    activeYear={rangePickerStartYear}
                    onYearChange={setRangePickerStartYear}
                    months={summaryAvailableMonthsForPickerYear}
                    selectedMonth={summaryRangePage.rangeStartMonth}
                    isMonthDisabled={(month) => month > summaryRangePage.rangeEndMonth}
                    onSelect={handleSummaryStartMonthSelect}
                  />
                  <span className="period-range-separator" aria-hidden="true">-</span>
                  <PeriodMonthPicker
                    modal={isSummaryTab}
                    triggerLabel={formatMonthLabel(summaryRangePage.rangeEndMonth)}
                    title="End month"
                    hint="Choose the last month in the summary range."
                    yearsAriaLabel="Available end years"
                    years={summaryAvailableYears}
                    activeYear={rangePickerEndYear}
                    onYearChange={setRangePickerEndYear}
                    months={summaryAvailableMonthsForEndPickerYear}
                    selectedMonth={summaryRangePage.rangeEndMonth}
                    isMonthDisabled={(month) => month < summaryRangePage.rangeStartMonth}
                    onSelect={handleSummaryEndMonthSelect}
                  />
                </strong>
              ) : (
                <strong className="period-range-value">{periodLabel}</strong>
              )}
            </div>
            <button className="period-button" type="button" aria-label={messages.period.nextAriaLabel} onClick={() => handleMonthChange(1)} disabled={isPeriodPassive}>›</button>
          </div>
          <TotalsVisibilityToggle className="totals-visibility-toggle--header" />
        </div>
      </section>

      {/* The mobile sticky sheet mirrors the desktop chrome without forcing the user to scroll back to the top. */}
      {showMobileContextSticky ? (
        <section className={`mobile-context-sticky-wrap${desktopContextVisible ? " is-desktop-visible" : ""}`} aria-label={stickyScopeConfig.label}>
          {desktopContextVisible ? desktopFloatingTabs : null}
          <div className="mobile-context-sticky-bar" data-scope={stickyScopeConfig?.selectedKey}>
            <MobileContextStatus message={islandStatus} />
            {islandStacked ? (
              <Suspense fallback={null}><MobileContextSheet contextLine stacked {...islandLineProps} /></Suspense>
            ) : null}
            <div className="mobile-context-main">
            <Dialog.Root open={mobileContextOpen} onOpenChange={(open) => { setMobileContextOpen(open); if (!open) setMobileContextToFilters(false); }}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  ref={islandTriggerRef}
                  className={`mobile-context-trigger${islandInline ? " is-compact" : ""}`}
                  aria-label={mobileContextTriggerName}
                  onClick={(event) => {
                    event.currentTarget.blur();
                  }}
                >
                  <ContextPersonChip label={pageView?.label ?? ""} isHousehold={selectedViewId === "household"} />
                  {mobileContextScopeLabel && !islandInline ? <span className="mobile-context-scope">{mobileContextScopeLabel}</span> : null}
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
                      <Dialog.Description className="sr-only">
                        Change the active household view without scrolling back to the top.
                      </Dialog.Description>
                    </div>
                  </div>
                  {/* The inside (and the swipe-down code) loads with the sheet, not the first screen. */}
                  <ScreenErrorBoundary level="section">
                    <Suspense fallback={null}>
                      <MobileContextSheet
                        viewLabel={pageView?.label ?? ""}
                        personChip={<ContextPersonChip label={pageView?.label ?? ""} isHousehold={selectedViewId === "household"} />}
                        people={appShell.household.people}
                        selectedViewId={selectedViewId}
                        scopeLabel={mobileContextScopeLabel}
                        scopeHint={mobileContextScopeHint}
                        scopes={showMobileContextScopeSection ? mobileContextScopes : []}
                        selectedScopeKey={stickyScopeConfig.selectedKey}
                        scrollToFilters={mobileContextToFilters}
                        filterProps={renderedTabId === "entries" ? entriesMobileFilterProps : null}
                        onViewChange={handleViewChange}
                        onScopeChange={handleStickyScopeChange}
                        onClose={closeMobileContext}
                      />
                    </Suspense>
                  </ScreenErrorBoundary>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span id="mobile-plan-actions" />
            {islandInline ? <Suspense fallback={null}><MobileContextSheet contextLine {...islandLineProps} /></Suspense> : null}
            {desktopContextVisible && isSummaryTab ? (
              <LeadViewSwitch view={floatingLeadView} onChange={setFloatingLeadView} name="lead-view-floating" />
            ) : null}
            {showMobileMonthJump ? (
              <div className="mobile-month-jump" role="group" aria-label="Month navigation">
                <button
                  className="period-button mobile-month-jump-button"
                  type="button"
                  aria-label={messages.period.previousAriaLabel}
                  onClick={() => handleMonthChange(-1)}
                  disabled={!canMoveToPreviousDetailMonth}
                >
                  <ChevronLeft size={19} strokeWidth={2.2} aria-hidden="true" />
                </button>
                <span className="mobile-month-jump-label">{formatMonthLabel(selectedMonth)}</span>
                <button
                  className="period-button mobile-month-jump-button"
                  type="button"
                  aria-label={messages.period.nextAriaLabel}
                  onClick={() => handleMonthChange(1)}
                  disabled={!canMoveToNextDetailMonth}
                >
                  <ChevronRight size={19} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {showMobileMonthChoice ? (
              <SummaryMonthIslandControl
                pickedMonth={pickedSummaryMonth}
                previousMonth={previousSummaryMonth}
                nextMonth={nextSummaryMonth}
                disabled={!summaryRangeMonths.length}
                onStep={selectSummaryMonth}
                onOpen={openMonthSheet}
                intentProps={getNavIntentProps("month")}
              />
            ) : null}
            </div>
          </div>
        </section>
      ) : null}
      {desktopContextVisible && renderedTabId === "splits" ? (
        <section className="desktop-splits-floating-tabs" aria-label="Splits navigation">
          {desktopFloatingTabs}
          <span id="desktop-splits-groups" className="desktop-splits-groups" />
        </section>
      ) : null}
      {showMobileMonthChoice && monthSheetOpen ? (
        <ScreenErrorBoundary level="section">
          <Suspense fallback={null}>
            <SummaryMonthSheet
              open
              onOpenChange={setMonthSheetOpen}
              rangeStartMonth={summaryRangePage?.rangeStartMonth ?? ""}
              rangeEndMonth={summaryRangePage?.rangeEndMonth ?? ""}
              months={summaryRangePage?.months ?? []}
              pickedMonth={pickedSummaryMonth}
              onPick={selectSummaryMonth}
              onChangeRange={openHeaderRangePicker}
            />
          </Suspense>
        </ScreenErrorBoundary>
      ) : null}

      {/* The routed panel area is the actual screen body; every tab renders through this slot. */}
      <section className="grid app-route-grid" aria-busy={isAppShellLoading ? "true" : "false"}>
        {/* Desktop and tablet pick the Summary tab's month here (a phone uses the island). */}
        {isSummaryTab ? (
          <SummaryMonthSelector
            rangeMonths={summaryRangeMonths}
            pickedMonth={pickedSummaryMonth}
            onPick={selectSummaryMonth}
            intentProps={getNavIntentProps("month")}
          />
        ) : null}
        {/* Route panels can hydrate lazily, so the fallback stays inside the
            routed region instead of replacing the whole shell. */}
        {showImportInboxBanner || (!importBannerKnown && importBannerReserve > 0 && ["summary", "month"].includes(renderedTabId)) ? (
          <ImportInboxBannerSlot
            reserve={importBannerReserve}
            inbox={showImportInboxBanner ? importInboxBanner : null}
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
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}

      {renderedTabId === "entries" && typeof document !== "undefined"
        ? createPortal(
            <button type="button" className="entries-fab" onClick={() => {
              // The + button opens Ask's new entry card: on a phone the Ask
              // page, on a wide screen in the Ask panel beside Entries,
              // which stays. The Entries composer stays on "+ Add entry"
              // and the card's "Edit in form".
              if (isMobileLayout()) {
                openAskFromPage(buildAskLocation(searchParams, { mode: "add", from: "entries" }), "entries");
              } else {
                openAskDock({ intent: { mode: "add", from: "entries" } });
              }
            }} aria-label={messages.shell.addEntry} title={messages.shell.addEntry}>
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
              // The receipt button opens Ask's card with the Splits switch
              // on for the open group (the Ask page on a phone, the Ask
              // panel beside Splits on a wide screen); the Splits expense
              // dialog stays on "+ Add expense" and the card's "Edit in form".
              // The open group: the URL's, else the one Splits chose itself
              // (it marks its hidden add trigger with it).
              const trigger = document.querySelector("[data-splits-fab-trigger='true']");
              const splitGroup = searchParams.get("split_group")
                ?? (trigger instanceof HTMLElement ? trigger.dataset.splitGroup ?? "" : "");
              if (isMobileLayout()) {
                openAskFromPage(buildAskLocation(searchParams, { mode: "expense", from: "splits", splitGroup }), "splits");
              } else {
                openAskDock({ intent: { mode: "expense", from: "splits", splitGroupId: splitGroup } });
              }
            }} aria-label={messages.shell.addSplitsExpense} title={messages.shell.addSplitsExpense}>
              <Receipt size={24} />
            </button>,
            document.body
          )
        : null}

      {/* Desktop Ask: the field at the bottom right, beside the + or receipt
          button where there is one, and the panel or popup it opens. Not on
          /ask itself, where the page is Ask, nor on a phone (its Ask tab). */}
      {selectedTabId !== "ask" && pageView && referenceData ? (
        <AskDock
          besideFab={renderedTabId === "entries" || (renderedTabId === "splits" && pageView.id !== "household")}
          intentProps={getNavIntentProps("ask")}
          remindersCount={newReminderCount}
          canLoad={routeWork.usable}
          renderConversation={renderAskDockConversation}
        />
      ) : null}
    </main>
  );
}

// A background refresh after a save failed: the saved result stays on
// screen, and the person can refresh again without losing their place.
function RefreshFailureNotice({ onRetry, onDismiss }) {
  return (
    <StateBanner
      className="refresh-failure-notice"
      tone="butter"
      title={messages.common.refreshFailedTitle}
      detail={messages.common.refreshFailedDetail}
      actions={[
        { label: messages.common.refreshFailedRetry, onClick: onRetry, primary: true },
        { label: messages.common.refreshFailedDismiss, onClick: onDismiss }
      ]}
    />
  );
}

// The banner's slot: as tall as the banner was last time on this device while
// the Imports answer is unknown (layout-shift guard, summary-plan-layout.spec.js),
// so the banner lands in its place; the height is remembered for next time.
function readStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeImportBannerHeight(height) {
  try {
    window.localStorage.setItem(IMPORT_BANNER_HEIGHT_KEY, String(Math.round(height)));
  } catch {
    // Blocked storage: the next visit reserves nothing.
  }
}

function ImportInboxBannerSlot({ reserve, inbox, onOpenImports }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (inbox && ref.current) {
      writeImportBannerHeight(ref.current.getBoundingClientRect().height);
    }
  });
  return (
    <div ref={ref} className="import-banner-slot" style={{ minHeight: reserve || undefined }}>
      {inbox ? <ImportInboxRouteBanner inbox={inbox} onOpenImports={onOpenImports} /> : null}
    </div>
  );
}

function ImportInboxRouteBanner({ inbox, onOpenImports }) {
  return (
    <StateBanner
      tone="sky"
      title={messages.shell.importInboxBannerTitle(inbox.summary.requiredFileCount)}
      detail={messages.shell.importInboxBannerDetail(inbox.summary.institutionCount, inbox.summary.pendingSplitMatchCount)}
      actions={[{ label: messages.shell.importInboxBannerAction, onClick: onOpenImports, primary: true }]}
    />
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
    && current.island?.text === next.island?.text
    && current.entryFilters?.search === next.entryFilters?.search
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
