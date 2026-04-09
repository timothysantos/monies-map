import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowRightLeft,
  BusFront,
  Check,
  ChevronRight,
  Clapperboard,
  Dumbbell,
  Gift,
  HeartPulse,
  Lightbulb,
  Plane,
  Receipt,
  SquarePen,
  ShoppingBag,
  ShoppingCart,
  UtensilsCrossed,
  UsersRound,
  X
} from "lucide-react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useSearchParams
} from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { messages } from "./copy/en-SG";
import { inspectCsv } from "../lib/csv";

const moneyFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD"
});

const SUMMARY_FOCUS_OVERALL = "overall";
const BOOTSTRAP_SYNC_CHANNEL = "monies-map-bootstrap-sync";
const BOOTSTRAP_SYNC_STORAGE_KEY = "monies-map-bootstrap-sync";
const MONTH_PICKER_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ICON_OPTIONS = [
  { key: "arrow-right-left", label: "Transfer", Icon: ArrowRightLeft },
  { key: "utensils", label: "Food", Icon: UtensilsCrossed },
  { key: "shopping-bag", label: "Shopping", Icon: ShoppingBag },
  { key: "users", label: "Family", Icon: UsersRound },
  { key: "receipt", label: "Receipt", Icon: Receipt },
  { key: "shopping-cart", label: "Groceries", Icon: ShoppingCart },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "dumbbell", label: "Hobbies", Icon: Dumbbell },
  { key: "lightbulb", label: "Bills", Icon: Lightbulb },
  { key: "clapperboard", label: "Entertainment", Icon: Clapperboard },
  { key: "bus", label: "Transport", Icon: BusFront },
  { key: "heart-pulse", label: "Healthcare", Icon: HeartPulse },
  { key: "gift", label: "Gift", Icon: Gift }
];

const ICON_REGISTRY = Object.fromEntries(ICON_OPTIONS.map((item) => [item.key, item.Icon]));
const COLOR_OPTIONS = ["#1F7A63", "#D4B35D", "#4F8FD6", "#CC63D8", "#F08B43", "#96A95A", "#D86B73", "#56A4C9", "#6A7A73", "#C98A5A"];
const FALLBACK_THEME = { colorHex: "#6A7A73", iconKey: "receipt" };
const ACCOUNT_KIND_OPTIONS = [
  { value: "bank", label: "Bank" },
  { value: "credit_card", label: "Credit card" },
  { value: "loan", label: "Loan" },
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" }
];

const IMPORT_FIELD_OPTIONS = [
  { value: "ignore", label: "Don't import" },
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "account", label: "Account" },
  { value: "category", label: "Category" },
  { value: "note", label: "Note" },
  { value: "type", label: "Type" }
];

const routeTabs = [
  { id: "summary", path: "/summary", label: messages.tabs.summary },
  { id: "month", path: "/month", label: messages.tabs.month },
  { id: "entries", path: "/entries", label: messages.tabs.entries },
  { id: "imports", path: "/imports", label: messages.tabs.imports },
  { id: "settings", path: "/settings", label: messages.tabs.settings },
  { id: "faq", path: "/faq", label: messages.tabs.faq }
];

export function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [rangePickerStartYear, setRangePickerStartYear] = useState(null);
  const [rangePickerEndYear, setRangePickerEndYear] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const syncChannelRef = useRef(null);
  const selectedMonth = searchParams.get("month") ?? "2025-10";
  const selectedScope = searchParams.get("scope") ?? "direct_plus_shared";
  const selectedSummaryStart = searchParams.get("summary_start") ?? undefined;
  const selectedSummaryEnd = searchParams.get("summary_end") ?? undefined;

  const loadBootstrap = useCallback(async (signal) => {
    const params = new URLSearchParams({
      month: selectedMonth,
      scope: selectedScope
    });
    if (selectedSummaryStart) {
      params.set("summary_start", selectedSummaryStart);
    }
    if (selectedSummaryEnd) {
      params.set("summary_end", selectedSummaryEnd);
    }
    const response = await fetch(`/api/bootstrap?${params.toString()}`, { signal });
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

    setBootstrapError("");
    setBootstrap(data);
  }, [selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart]);

  const handleBootstrapFailure = useCallback((error) => {
    setBootstrap(null);
    setBootstrapError(describeBootstrapError(error));
  }, []);

  const refreshBootstrap = useCallback(async ({ broadcast = false } = {}) => {
    await loadBootstrap();

    if (!broadcast) {
      return;
    }

    const payload = { type: "bootstrap-refresh", ts: Date.now() };
    try {
      syncChannelRef.current?.postMessage(payload);
    } catch {}

    try {
      window.localStorage.setItem(BOOTSTRAP_SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [loadBootstrap]);

  useEffect(() => {
    const controller = new AbortController();

    void loadBootstrap(controller.signal).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      handleBootstrapFailure(error);
    });

    return () => {
      controller.abort();
    };
  }, [loadBootstrap]);

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
          void loadBootstrap().catch(handleBootstrapFailure);
        }
      };
    }

    const handleStorage = (event) => {
      if (event.key === BOOTSTRAP_SYNC_STORAGE_KEY && event.newValue) {
        void loadBootstrap().catch(handleBootstrapFailure);
      }
    };

    const handleFocus = () => {
      void loadBootstrap().catch(handleBootstrapFailure);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadBootstrap().catch(handleBootstrapFailure);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (channel) {
        channel.close();
        syncChannelRef.current = null;
      }
    };
  }, [handleBootstrapFailure, loadBootstrap]);

  const selectedViewId = searchParams.get("view") ?? "household";
  const selectedTabId = routeTabs.find((tab) => tab.path === location.pathname)?.id ?? "summary";

  const view = useMemo(
    () => bootstrap?.views.find((item) => item.id === selectedViewId) ?? null,
    [bootstrap, selectedViewId]
  );
  const categories = useMemo(
    () => bootstrap?.categories.map((category) => ({ ...category, ...(categoryOverrides[category.id] ?? {}) })) ?? [],
    [bootstrap, categoryOverrides]
  );
  const availableMonths = useMemo(
    () => bootstrap?.views[0]?.summaryPage.availableMonths.slice().sort() ?? [],
    [bootstrap]
  );
  const isDetailMonthTab = selectedTabId === "month" || selectedTabId === "entries";
  const summaryAvailableYears = useMemo(
    () => !isDetailMonthTab && view
      ? [...new Set(view.summaryPage.availableMonths.map((month) => Number(month.slice(0, 4))))].sort((left, right) => left - right)
      : [],
    [isDetailMonthTab, view]
  );
  const summaryAvailableMonthsForPickerYear = useMemo(
    () => !isDetailMonthTab && view && rangePickerStartYear != null
      ? view.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerStartYear)
      : [],
    [isDetailMonthTab, rangePickerStartYear, view]
  );
  const summaryAvailableMonthsForEndPickerYear = useMemo(
    () => !isDetailMonthTab && view && rangePickerEndYear != null
      ? view.summaryPage.availableMonths.filter((month) => Number(month.slice(0, 4)) === rangePickerEndYear)
      : [],
    [isDetailMonthTab, rangePickerEndYear, view]
  );

  useEffect(() => {
    if (!bootstrap) {
      return;
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
  }, [bootstrap, selectedViewId, setSearchParams]);

  useEffect(() => {
    if (!bootstrap || !availableMonths.length || selectedTabId !== "month" && selectedTabId !== "entries") {
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
  }, [availableMonths, bootstrap, selectedMonth, selectedTabId, setSearchParams]);

  useEffect(() => {
    if (isDetailMonthTab || !view) {
      return;
    }

    const nextStartYear = Number(view.summaryPage.rangeStartMonth.slice(0, 4));
    const nextEndYear = Number(view.summaryPage.rangeEndMonth.slice(0, 4));
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
  }, [isDetailMonthTab, summaryAvailableYears, view]);

  if (bootstrapError) {
    return (
      <main className="shell">
        <section className="panel">
          <p>{messages.common.bootstrapErrorTitle}</p>
          <p>{bootstrapError}</p>
        </section>
      </main>
    );
  }

  if (!bootstrap || !view) {
    return (
      <main className="shell">
        <section className="panel">
          <p>{messages.common.loading}</p>
        </section>
      </main>
    );
  }

  const periodMode = isDetailMonthTab ? messages.period.month : messages.period.year;
  const periodLabel = isDetailMonthTab
    ? formatMonthLabel(view.monthPage.month)
    : `${formatMonthLabel(view.summaryPage.rangeStartMonth)} - ${formatMonthLabel(view.summaryPage.rangeEndMonth)}`;

  function handleViewChange(nextViewId) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", nextViewId);
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

    const rangeMonths = view.summaryPage.rangeMonths;
    const availableSummaryMonths = view.summaryPage.availableMonths;
    const startIndex = availableSummaryMonths.indexOf(view.summaryPage.rangeStartMonth);
    const endIndex = availableSummaryMonths.indexOf(view.summaryPage.rangeEndMonth);
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

  function handleSummaryStartMonthSelect(startMonth) {
    if (isDetailMonthTab) {
      return;
    }

    const endMonth = view.summaryPage.rangeEndMonth;
    if (startMonth > endMonth) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", endMonth);
      const focus = next.get("summary_focus");
      const nextRangeMonths = view.summaryPage.availableMonths.filter((month) => month >= startMonth && month <= endMonth);
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

    const startMonth = view.summaryPage.rangeStartMonth;
    if (endMonth < startMonth) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("summary_start", startMonth);
      next.set("summary_end", endMonth);
      const focus = next.get("summary_focus");
      const nextRangeMonths = view.summaryPage.availableMonths.filter((month) => month >= startMonth && month <= endMonth);
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

    await fetch("/api/categories/update", {
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
  }

  return (
    <main className="shell">
      <section className="control-bar">
        <div className="context-block">
          <div className="pill-row">
            <button
              className={`pill ${selectedViewId === "household" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleViewChange("household")}
            >
              {messages.views.household}
            </button>
            {bootstrap.household.people.map((person) => (
              <button
                key={person.id}
                className={`pill ${selectedViewId === person.id ? "is-active" : ""}`}
                type="button"
                onClick={() => handleViewChange(person.id)}
              >
                {person.name}
              </button>
            ))}
          </div>
        </div>

        <div className="period-inline">
          <nav className="tab-strip" aria-label={messages.tabs.ariaLabel}>
            {routeTabs.map((tab) => (
              <NavLink
                key={tab.id}
                className={({ isActive }) => `tab ${isActive ? "is-active" : ""}`}
                to={{ pathname: tab.path, search: searchParams.toString() ? `?${searchParams.toString()}` : "" }}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <button className="period-button" type="button" aria-label={messages.period.previousAriaLabel} onClick={() => handleMonthChange(-1)}>‹</button>
          <div className="period-display">
            <span className="period-mode">{periodMode}</span>
            {isDetailMonthTab ? (
              <strong>{periodLabel}</strong>
            ) : (
              <strong className="period-range-value">
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <button type="button" className="period-range-segment">
                      {formatMonthLabel(view.summaryPage.rangeStartMonth)}
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
                          const isSelected = month === view.summaryPage.rangeStartMonth;
                          const isDisabled = month > view.summaryPage.rangeEndMonth;
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
                <span className="period-range-separator"> - </span>
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <button type="button" className="period-range-segment">
                      {formatMonthLabel(view.summaryPage.rangeEndMonth)}
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
                          const isSelected = month === view.summaryPage.rangeEndMonth;
                          const isDisabled = month < view.summaryPage.rangeStartMonth;
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
          <button className="period-button" type="button" aria-label={messages.period.nextAriaLabel} onClick={() => handleMonthChange(1)}>›</button>
        </div>
      </section>

      <section className="grid">
        <Routes>
          <Route path="/" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
          <Route
            path="/summary"
            element={(
              <SummaryPanel
                view={view}
                selectedMonth={selectedMonth}
                categories={categories}
                onCategoryAppearanceChange={handleCategoryAppearanceChange}
                onRefresh={() => refreshBootstrap({ broadcast: true })}
              />
            )}
          />
          <Route
            path="/month"
            element={(
              <MonthPanel
                view={view}
                accounts={bootstrap.accounts}
                people={bootstrap.household.people}
                categories={categories}
                onCategoryAppearanceChange={handleCategoryAppearanceChange}
                onRefresh={() => refreshBootstrap({ broadcast: true })}
              />
            )}
          />
          <Route
            path="/entries"
            element={(
              <EntriesPanel
                view={view}
                categories={categories}
                people={bootstrap.household.people}
                onCategoryAppearanceChange={handleCategoryAppearanceChange}
                onRefresh={() => refreshBootstrap({ broadcast: true })}
              />
            )}
          />
          <Route
            path="/imports"
            element={(
              <ImportsPanel
                importsPage={bootstrap.importsPage}
                viewId={view.id}
                viewLabel={view.label}
                accounts={bootstrap.accounts}
                categories={categories}
                people={bootstrap.household.people}
                onRefresh={() => refreshBootstrap({ broadcast: true })}
              />
            )}
          />
          <Route
            path="/settings"
            element={(
              <SettingsPanel
                settingsPage={bootstrap.settingsPage}
                accounts={bootstrap.accounts}
                people={bootstrap.household.people}
                viewId={view.id}
                viewLabel={view.label}
                onRefresh={() => refreshBootstrap({ broadcast: true })}
              />
            )}
          />
          <Route path="/faq" element={<FaqPanel viewLabel={view.label} />} />
          <Route path="*" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
        </Routes>
      </section>
    </main>
  );
}

function SummaryPanel({ view, selectedMonth, categories, onCategoryAppearanceChange, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const summaryFocusParam = searchParams.get("summary_focus");
  const latestRangeMonth = view.summaryPage.rangeMonths.at(-1) ?? "";
  const selectedFocusMonth = summaryFocusParam === SUMMARY_FOCUS_OVERALL
    ? ""
    : (summaryFocusParam && view.summaryPage.rangeMonths.includes(summaryFocusParam)
      ? summaryFocusParam
      : latestRangeMonth);
  const selectedDonutMonth = view.summaryPage.categoryShareByMonth.find((month) => month.month === selectedFocusMonth) ?? null;
  const donutData = selectedDonutMonth?.data ?? view.summaryPage.categoryShareChart;
  const totalSpendMinor = donutData.reduce((sum, item) => sum + item.valueMinor, 0);

  function handleFocusChange(value) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) {
        next.set("summary_focus", SUMMARY_FOCUS_OVERALL);
      } else {
        next.set("summary_focus", value);
      }
      return next;
    });
  }

  function handleOpenEntriesForCategory(categoryName) {
    const next = new URLSearchParams(location.search);
    next.delete("entry_wallet");
    next.delete("entry_person");
    next.delete("entry_type");
    next.set("entry_category", categoryName);
    if (selectedFocusMonth) {
      next.set("month", selectedFocusMonth);
    }
    navigate({
      pathname: "/entries",
      search: `?${next.toString()}`
    });
  }

  function handleOpenMonth(month) {
    const next = new URLSearchParams(location.search);
    next.set("month", month);
    navigate({
      pathname: "/month",
      search: `?${next.toString()}`
    });
  }

  function handleOpenEntriesForAccount(accountName) {
    const next = new URLSearchParams(location.search);
    next.delete("entry_category");
    next.delete("entry_person");
    next.delete("entry_type");
    next.set("month", selectedFocusMonth || selectedMonth);
    next.set("entry_wallet", accountName);
    navigate({
      pathname: "/entries",
      search: `?${next.toString()}`
    });
  }

  async function saveSummaryMonthNote() {
    if (!monthNoteDialog) {
      return;
    }

    await fetch("/api/month-note/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: monthNoteDialog.month,
        personScope: view.id,
        note: monthNoteDialog.draft
      })
    });

    setMonthNoteDialog(null);
    await onRefresh();
  }

  return (
    <article className="panel panel-accent">
      <div className="panel-head summary-head">
        <div>
          <h2>{messages.tabs.summary}</h2>
          <span className="panel-context">{messages.common.viewingDot(view.label)}</span>
        </div>
        <div className="metric-row metric-row-summary summary-head-metrics">
          {view.summaryPage.metricCards.map((card) => (
            <MetricCard key={card.label} card={card} />
          ))}
        </div>
      </div>

      <div className="summary-top-grid">
        <section className="chart-card">
          <div className="chart-head">
            <h3>{messages.summary.spendingMix}</h3>
          </div>
          <div className="summary-mix">
            <div className="summary-mix-main">
              <div className="summary-mix-months">
                <button
                  type="button"
                  className={`summary-focus-button ${summaryFocusParam === SUMMARY_FOCUS_OVERALL ? "is-active" : ""}`}
                  onClick={() => handleFocusChange("")}
                >
                  {messages.summary.rangeOverall}
                </button>
                {view.summaryPage.rangeMonths.slice().reverse().map((month) => (
                  <button
                    key={month}
                    type="button"
                    className={`summary-focus-button ${selectedFocusMonth === month ? "is-active" : ""}`}
                    onClick={() => handleFocusChange(month)}
                  >
                    {formatMonthLabel(month)}
                  </button>
                ))}
              </div>
              <SpendingMixChart data={donutData} categories={categories} />
              <div className="share-list">
                {donutData.map((item) => {
                const category = getCategory(categories, item);
                const percentage = (((item.valueMinor / Math.max(totalSpendMinor, 1))) * 100).toFixed(1);
                return (
                  <div
                    key={item.key}
                    className="share-row"
                  >
                    <div className="category-key">
                      <CategoryAppearancePopover
                        category={category}
                        onChange={onCategoryAppearanceChange}
                      />
                      <button
                        type="button"
                        className="share-row-button"
                        onClick={() => handleOpenEntriesForCategory(category?.name ?? item.label)}
                      >
                        <strong>{category?.name ?? item.label}</strong>
                        <p>{messages.common.moneyAndPercent(money(item.valueMinor), percentage)}</p>
                        <span className="share-row-meta">
                          {item.entryCount === 1 ? "1 transaction" : `${item.entryCount ?? 0} transactions`}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        </section>

        <section className="chart-card">
          <div className="chart-head">
            <h3>{messages.summary.intentVsOutcome}</h3>
            <p>{messages.summary.intentVsOutcomeDetail}</p>
          </div>
          <div className="chart-bars">
            {[...view.summaryPage.months]
              .sort((left, right) => right.month.localeCompare(left.month))
              .map((month, index) => {
                const spendVarianceMinor = month.estimatedExpensesMinor - month.realExpensesMinor;
                const savingsVarianceMinor = month.realizedSavingsMinor - month.savingsGoalMinor;
                return (
                <details key={month.month} className="plan-row-card" open={index === 0}>
                  <summary className="plan-row-summary">
                    <div className="plan-row-head">
                      <div>
                        <button
                          type="button"
                          className="summary-month-link"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleOpenMonth(month.month);
                          }}
                        >
                          {formatMonthLabel(month.month)}
                        </button>
                        <p>{messages.summary.incomeLabel(money(month.incomeMinor))}</p>
                      </div>
                      <span className={spendVarianceMinor >= 0 ? "positive" : "negative"}>
                        {money(spendVarianceMinor)}
                      </span>
                    </div>
                  </summary>
                  <div className="plan-row-content">
                    <BarLine
                      label={messages.month.table.planned}
                      valueMinor={month.estimatedExpensesMinor}
                      maxMinor={Math.max(month.realExpensesMinor, month.estimatedExpensesMinor)}
                      tone="planned"
                    />
                    <BarLine
                      label={messages.month.table.actual}
                      valueMinor={month.realExpensesMinor}
                      maxMinor={Math.max(month.realExpensesMinor, month.estimatedExpensesMinor)}
                      tone="actual"
                    />
                    <div className="table-wrap plan-detail-table-wrap">
                      <table className="plan-detail-table">
                        <thead>
                          <tr>
                            <th>{messages.summary.table.metric}</th>
                            <th>{messages.summary.table.estimate}</th>
                            <th>{messages.summary.table.actual}</th>
                            <th>{messages.summary.table.variance}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{messages.summary.table.expectedExpenses}</td>
                            <td>{money(month.estimatedExpensesMinor)}</td>
                            <td>{money(month.realExpensesMinor)}</td>
                            <td className={spendVarianceMinor >= 0 ? "positive" : "negative"}>
                              {money(spendVarianceMinor)}
                            </td>
                          </tr>
                          <tr>
                            <td>{messages.summary.table.expectedSavings}</td>
                            <td>{money(month.savingsGoalMinor)}</td>
                            <td className={month.realizedSavingsMinor >= 0 ? "positive" : "negative"}>
                              {money(month.realizedSavingsMinor)}
                            </td>
                            <td className={savingsVarianceMinor >= 0 ? "positive" : "negative"}>
                              {money(savingsVarianceMinor)}
                            </td>
                          </tr>
                          <tr className="summary-context-row">
                            <td colSpan={4}>
                              <button
                                type="button"
                                className="note-trigger summary-note-trigger"
                                onClick={() => setMonthNoteDialog({ month: month.month, draft: month.note ?? "" })}
                              >
                                <span>{month.note || messages.common.emptyValue}</span>
                                <SquarePen size={14} />
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              )})}
          </div>
        </section>
      </div>

      {view.summaryPage.accountPills.length ? (
        <section className="summary-accounts">
          <div className="panel-subhead">
            <h3>Wallets in view</h3>
            <p>Current wallet balances from the ledger. These do not change with the selected summary range.</p>
          </div>
          <div className="summary-account-pills">
            {view.summaryPage.accountPills.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className={`summary-account-pill ${account.reconciliationStatus ? `is-${account.reconciliationStatus}` : ""}`}
                onClick={() => handleOpenEntriesForAccount(account.accountName)}
              >
                <span className="summary-account-pill-name">{account.accountName}</span>
                <span className="summary-account-pill-amount">{money(account.balanceMinor)}</span>
                <span className="summary-account-pill-meta">{describeAccountHealth(account)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog.Root open={Boolean(monthNoteDialog)} onOpenChange={(open) => { if (!open) setMonthNoteDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{messages.month.notesTitle}</Dialog.Title>
                <Dialog.Description>{messages.month.notesDetail}</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close month note editor"
                onClick={() => setMonthNoteDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="note-dialog-textarea"
              value={monthNoteDialog?.draft ?? ""}
              onChange={(event) => setMonthNoteDialog((current) => current ? { ...current, draft: event.target.value } : current)}
              rows={10}
            />
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setMonthNoteDialog(null)}>
                {messages.month.cancelEdit}
              </button>
              <button type="button" className="dialog-primary" onClick={() => void saveSummaryMonthNote()}>
                {messages.month.doneEdit}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}

function SpendingMixChart({ data, categories }) {
  const total = data.reduce((sum, item) => sum + item.valueMinor, 0);
  const chartData = data.map((item, index) => ({
    ...item,
    ...getCategoryTheme(categories, item, index)
  }));

  return (
    <div className="spending-mix-chart-shell">
      <div className="spending-mix-chart">
        <ResponsiveContainer width="100%" height={360}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="valueMinor"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={120}
              paddingAngle={0}
              isAnimationActive={false}
              labelLine={false}
              label={(props) => renderPieCallout(props, total)}
            >
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center recharts-donut-center">
          <span>{messages.summary.totalSpend}</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
    </div>
  );
}

function renderPieCallout(props, total) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props;
  if (!percent) {
    return null;
  }

  const radians = (Math.PI / 180) * -midAngle;
  const sx = cx + Math.cos(radians) * (outerRadius + 6);
  const sy = cy + Math.sin(radians) * (outerRadius + 6);
  const mx = cx + Math.cos(radians) * (outerRadius + 22);
  const my = cy + Math.sin(radians) * (outerRadius + 22);
  const bx = cx + Math.cos(radians) * (outerRadius + 46);
  const by = cy + Math.sin(radians) * (outerRadius + 46);
  const isRight = Math.cos(radians) >= 0;
  const tx = bx + (isRight ? 34 : -34);
  const percentage = ((payload.valueMinor / total) * 100).toFixed(1);
  const Icon = getIconComponent(payload.iconKey);

  return (
    <g>
      <path d={`M${sx},${sy} L${mx},${my} L${bx},${by}`} stroke={payload.color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.82" />
      <foreignObject x={bx - 22} y={by - 22} width="44" height="44">
        <div className="donut-callout-badge" style={{ "--category-color": payload.color }}>
          <Icon size={18} strokeWidth={2.2} />
        </div>
      </foreignObject>
      <text x={tx} y={by + 1} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" fill={payload.color} fontSize="15" fontWeight="700">
        {percentage}%
      </text>
    </g>
  );
}

function CategoryAppearancePopover({ category, onChange }) {
  if (!category) {
    return <span className="category-icon category-icon-static" />;
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="category-icon category-icon-button"
          style={{ "--category-color": category.colorHex }}
          aria-label={`Edit ${category.name} icon and color`}
        >
          <CategoryGlyph iconKey={category.iconKey} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="category-popover" sideOffset={10} align="start">
          <div className="category-popover-head">
            <strong>{category.name}</strong>
            <span>Icon and color</span>
          </div>

          <div className="category-popover-section">
            <label className="category-popover-label" htmlFor={`category-name-${category.id}`}>Name</label>
            <input
              id={`category-name-${category.id}`}
              className="category-name-input"
              type="text"
              value={category.name}
              onChange={(event) => onChange(category.id, { name: event.target.value })}
            />
          </div>

          <div className="category-popover-section">
            <span className="category-popover-label">Icon</span>
            <div className="icon-grid">
              {ICON_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`icon-choice ${category.iconKey === option.key ? "is-active" : ""}`}
                  onClick={() => onChange(category.id, { iconKey: option.key })}
                  aria-label={option.label}
                  title={option.label}
                >
                  <option.Icon size={16} strokeWidth={2.2} />
                </button>
              ))}
            </div>
          </div>

          <div className="category-popover-section">
            <span className="category-popover-label">Color</span>
            <div className="color-grid">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-choice ${category.colorHex === color ? "is-active" : ""}`}
                  style={{ "--swatch-color": color }}
                  onClick={() => onChange(category.id, { colorHex: color })}
                  aria-label={color}
                  title={color}
                />
              ))}
            </div>
          </div>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CategoryGlyph({ iconKey }) {
  const Icon = getIconComponent(iconKey);
  return <Icon size={18} strokeWidth={2.2} />;
}

function MonthPanel({ view, accounts, people, categories, onCategoryAppearanceChange, onRefresh }) {
  const navigate = useNavigate();
  const defaultSectionOpen = useCallback(() => ({
    income: false,
    planned_items: true,
    budget_buckets: true
  }), []);
  const monthUiKey = `${view.id}:${view.monthPage.month}:${view.monthPage.selectedScope}`;
  const [sectionStateByKey, setSectionStateByKey] = useState({});
  const [planSections, setPlanSections] = useState(view.monthPage.planSections);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [editingDrafts, setEditingDrafts] = useState({});
  const [incomeRows, setIncomeRows] = useState([]);
  const [sectionOpen, setSectionOpen] = useState(() => defaultSectionOpen());
  const [noteDialog, setNoteDialog] = useState(null);
  const [resetMonthText, setResetMonthText] = useState("");
  const [deleteMonthText, setDeleteMonthText] = useState("");
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [tableSorts, setTableSorts] = useState({
    income: null,
    planned_items: null,
    budget_buckets: null
  });
  const isCombinedHouseholdView = view.id === "household" && view.monthPage.selectedScope === "direct_plus_shared";

  useEffect(() => {
    setPlanSections(view.monthPage.planSections);
    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
    setNoteDialog(null);
    setMonthNoteDialog(null);
    setTableSorts({
      income: null,
      planned_items: null,
      budget_buckets: null
    });
    setIncomeRows(view.monthPage.incomeRows);
    setSectionOpen(sectionStateByKey[monthUiKey] ?? defaultSectionOpen());
  }, [view, monthUiKey, sectionStateByKey, defaultSectionOpen]);

  const currentMonthSummary = useMemo(
    () => view.summaryPage.months.find((month) => month.month === view.monthPage.month) ?? null,
    [view]
  );

  const flatPlanRows = useMemo(
    () => planSections.flatMap((section) => section.rows),
    [planSections]
  );
  const plannedSpendMinor = useMemo(
    () => flatPlanRows.reduce((sum, row) => sum + row.plannedMinor, 0),
    [flatPlanRows]
  );
  const actualSpendMinor = currentMonthSummary?.realExpensesMinor
    ?? flatPlanRows.reduce((sum, row) => sum + row.actualMinor, 0);
  const savingsTargetMinor = useMemo(
    () => flatPlanRows
      .filter((row) => row.label === "Savings")
      .reduce((sum, row) => sum + row.plannedMinor, 0),
    [flatPlanRows]
  );
  const plannedIncomeMinor = useMemo(
    () => incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0),
    [incomeRows]
  );
  const remainingBudgetMinor = plannedIncomeMinor - plannedSpendMinor;
  const spendGapMinor = plannedSpendMinor - actualSpendMinor;
  const monthMetricCards = [
    {
      label: "Planned income",
      amountMinor: plannedIncomeMinor
    },
    {
      label: "Planned spend",
      amountMinor: plannedSpendMinor
    },
    {
      label: "Remaining budget",
      amountMinor: remainingBudgetMinor,
      tone: remainingBudgetMinor >= 0 ? "positive" : "negative",
      detail: remainingBudgetMinor >= 0 ? "To allocate" : "Overplanned"
    },
    {
      label: "Actual spend",
      amountMinor: actualSpendMinor,
      tone: actualSpendMinor > plannedSpendMinor ? "negative" : "positive"
    },
    {
      label: "Savings target",
      amountMinor: savingsTargetMinor
    },
    {
      label: "Spend gap",
      amountMinor: spendGapMinor,
      tone: spendGapMinor >= 0 ? "positive" : "negative",
      detail: "Planned minus actual"
    }
  ];
  const visibleAccounts = useMemo(() => {
    const activeAccounts = accounts.filter((account) => account.isActive);
    if (view.id === "household") {
      return activeAccounts;
    }

    return activeAccounts.filter((account) => account.isJoint || account.ownerPersonId === view.id);
  }, [accounts, view.id]);

  function handleRowChange(sectionKey, rowId, patch) {
    setPlanSections((current) => current.map((section) => {
      if (section.key !== sectionKey) {
        return section;
      }

      return {
        ...section,
        rows: section.rows.map((row) => {
          if (row.id !== rowId) {
            return row;
          }

          return {
            ...row,
            ...patch
          };
        })
      };
    }));
  }

  async function persistMonthRow(sectionKey, row, nextPlannedMinor) {
    await fetch("/api/month-plan/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId: row.id,
        month: view.monthPage.month,
        sectionKey,
        categoryName: row.categoryName,
        label: row.label,
        planDate: sectionKey === "planned_items" ? (getRowDateValue(row, view.monthPage.month) || null) : null,
        accountName: sectionKey === "planned_items" ? (row.accountName || null) : null,
        plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor,
        note: row.note ?? null,
        ownershipType: row.ownershipType,
        ownerName: row.ownerName,
        splitBasisPoints: row.ownershipType === "shared"
          ? row.splits[0]?.ratioBasisPoints ?? 5000
          : undefined
      })
    });
  }

  function beginIncomeEdit(row) {
    if (isCombinedHouseholdView || row.isDerived) {
      return;
    }
    if (editingRowId === row.id) {
      return;
    }

    setEditingRowId(row.id);
    setEditingSnapshot({ kind: "income", rowId: row.id, original: { ...row } });
    setEditingDrafts({
      plannedMinor: formatMinorInput(row.plannedMinor)
    });
  }

  function beginPlanEdit(sectionKey, row) {
    if (isCombinedHouseholdView || row.isDerived) {
      return;
    }
    if (editingRowId === row.id) {
      return;
    }

    setEditingRowId(row.id);
    setEditingSnapshot({ kind: "plan", sectionKey, rowId: row.id, original: { ...row } });
    setEditingDrafts({
      plannedMinor: formatMinorInput(row.plannedMinor)
    });
  }

  async function finishEdit() {
    if (!editingSnapshot) {
      return;
    }

    let nextPlannedMinor;
    if (editingSnapshot && Object.prototype.hasOwnProperty.call(editingDrafts, "plannedMinor")) {
      nextPlannedMinor = parseDraftMoneyInput(editingDrafts.plannedMinor);
      if (editingSnapshot.kind === "income") {
        handleIncomeRowChange(editingSnapshot.rowId, { plannedMinor: nextPlannedMinor });
      } else {
        handleRowChange(editingSnapshot.sectionKey, editingSnapshot.rowId, { plannedMinor: nextPlannedMinor });
      }
    }

    if (editingSnapshot.kind === "income") {
      const row = incomeRows.find((item) => item.id === editingSnapshot.rowId);
      if (row) {
        await persistMonthRow("income", {
          ...row,
          plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor
        }, nextPlannedMinor);
      }
    } else {
      const section = planSections.find((item) => item.key === editingSnapshot.sectionKey);
      const row = section?.rows.find((item) => item.id === editingSnapshot.rowId);
      if (row) {
        await persistMonthRow(editingSnapshot.sectionKey, {
          ...row,
          plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor
        }, nextPlannedMinor);
      }
    }

    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
    await onRefresh();
  }

  function cancelEdit() {
    if (!editingSnapshot) {
      setEditingRowId(null);
      return;
    }

    if (editingSnapshot.kind === "income") {
      setIncomeRows((current) => current.map((row) => (
        row.id === editingSnapshot.rowId ? editingSnapshot.original : row
      )));
    } else {
      setPlanSections((current) => current.map((section) => (
        section.key === editingSnapshot.sectionKey
          ? {
              ...section,
              rows: section.rows.map((row) => (
                row.id === editingSnapshot.rowId ? editingSnapshot.original : row
              ))
            }
          : section
      )));
    }

    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
  }

  function handleAddPlanRow(sectionKey) {
    const nextId = `month-plan-${crypto.randomUUID()}`;
    const defaultCategoryName = sectionKey === "planned_items" ? "Savings" : "Food & Drinks";
    const ownerName = view.id === "household" ? undefined : view.label;
    const ownerPerson = ownerName ? people.find((person) => person.name === ownerName) : null;
    const ownershipType = view.monthPage.selectedScope === "shared" ? "shared" : "direct";
    const nextRow = {
      id: nextId,
      section: sectionKey,
      categoryName: defaultCategoryName,
      categoryId: categories.find((category) => category.name === defaultCategoryName)?.id,
      label: sectionKey === "planned_items" ? "New item" : "New bucket",
      dayLabel: sectionKey === "planned_items" ? `${view.monthPage.month}-01` : undefined,
      dayOfWeek: undefined,
      plannedMinor: 0,
      actualMinor: 0,
      accountName: sectionKey === "planned_items" ? "" : undefined,
      note: sectionKey === "planned_items" ? messages.month.newPlannedItemNote : messages.month.newBudgetBucketNote,
      ownershipType,
      ownerName,
      splits: ownershipType === "shared"
        ? people.slice(0, 2).map((person) => ({
            personId: person.id,
            personName: person.name,
            ratioBasisPoints: 5000,
            amountMinor: 0
          }))
        : ownerPerson
          ? [{
              personId: ownerPerson.id,
              personName: ownerPerson.name,
              ratioBasisPoints: 10000,
              amountMinor: 0
            }]
          : [],
      isDraft: true
    };

    setPlanSections((current) => current.map((section) => (
      section.key === sectionKey
        ? {
            ...section,
            rows: [nextRow, ...section.rows]
          }
        : section
    )));
    setTableSorts((current) => ({
      ...current,
      [sectionKey]: null
    }));
    setSectionOpen((current) => {
      const next = {
        ...current,
        [sectionKey]: true
      };
      setSectionStateByKey((existing) => ({
        ...existing,
        [monthUiKey]: next
      }));
      return next;
    });
    setEditingRowId(nextId);
    setEditingDrafts({
      plannedMinor: "0.00"
    });
  }

  async function handleRemovePlanRow(sectionKey, rowId) {
    const section = planSections.find((item) => item.key === sectionKey);
    const row = section?.rows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    if (row.isDraft) {
      setPlanSections((current) => current.map((item) => (
        item.key === sectionKey
          ? { ...item, rows: item.rows.filter((planRow) => planRow.id !== rowId) }
          : item
      )));
      setEditingRowId((current) => (current === rowId ? null : current));
      return;
    }

    await fetch("/api/month-plan/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId,
        month: view.monthPage.month
      })
    });
    setEditingRowId((current) => (current === rowId ? null : current));
    await onRefresh();
  }

  function handleIncomeRowChange(rowId, patch) {
    setIncomeRows((current) => current.map((row) => (
      row.id === rowId
        ? {
            ...row,
            ...patch
          }
        : row
    )));
  }

  function openNoteDialog(kind, rowId, sectionKey, note) {
    setNoteDialog({
      kind,
      rowId,
      sectionKey,
      draft: note ?? ""
    });
  }

  async function commitNoteDialog() {
    if (!noteDialog) {
      return;
    }

    if (noteDialog.kind === "income") {
      handleIncomeRowChange(noteDialog.rowId, { note: noteDialog.draft });
      const row = incomeRows.find((item) => item.id === noteDialog.rowId);
      if (row) {
        await persistMonthRow("income", { ...row, note: noteDialog.draft });
      }
    } else {
      handleRowChange(noteDialog.sectionKey, noteDialog.rowId, { note: noteDialog.draft });
      const section = planSections.find((item) => item.key === noteDialog.sectionKey);
      const row = section?.rows.find((item) => item.id === noteDialog.rowId);
      if (row) {
        await persistMonthRow(noteDialog.sectionKey, { ...row, note: noteDialog.draft });
      }
    }

    setNoteDialog(null);
    await onRefresh();
  }

  async function commitMonthNoteDialog() {
    if (!monthNoteDialog) {
      return;
    }

    await fetch("/api/month-note/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: view.monthPage.month,
        personScope: view.id,
        note: monthNoteDialog.draft
      })
    });

    setMonthNoteDialog(null);
    await onRefresh();
  }

  function handleOpenEntriesForAccount(account) {
    const next = new URLSearchParams();
    next.set("view", view.id);
    next.set("month", view.monthPage.month);
    next.set("entry_wallet", account.name);
    next.set("scope", view.monthPage.selectedScope);

    if (view.id !== "household") {
      next.set("entry_person", view.label);
    } else if (!account.isJoint && account.ownerLabel !== "Shared") {
      next.set("entry_person", account.ownerLabel);
    }

    navigate({
      pathname: "/entries",
      search: `?${next.toString()}`
    });
  }

  function handleAddIncomeRow() {
    const nextId = `month-income-${crypto.randomUUID()}`;
    const ownerName = view.id === "household" ? undefined : view.label;
    const ownerPerson = ownerName ? people.find((person) => person.name === ownerName) : null;
    setIncomeRows((current) => [
      {
        id: nextId,
        categoryName: "Income",
        categoryId: categories.find((category) => category.name === "Income")?.id,
        label: "Other income",
        plannedMinor: 0,
        actualMinor: 0,
        note: messages.month.extraIncomeNote,
        ownershipType: "direct",
        personId: ownerPerson?.id,
        ownerName,
        splits: ownerPerson ? [{
          personId: ownerPerson.id,
          personName: ownerPerson.name,
          ratioBasisPoints: 10000,
          amountMinor: 0
        }] : [],
        isDraft: true
      },
      ...current
    ]);
    setTableSorts((current) => ({
      ...current,
      income: null
    }));
    setSectionOpen((current) => {
      const next = {
        ...current,
        income: true
      };
      setSectionStateByKey((existing) => ({
        ...existing,
        [monthUiKey]: next
      }));
      return next;
    });
    setEditingRowId(nextId);
    setEditingDrafts({
      plannedMinor: "0.00"
    });
  }

  async function handleRemoveIncomeRow(rowId) {
    const row = incomeRows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    if (row.isDraft) {
      setIncomeRows((current) => current.filter((item) => item.id !== rowId));
      setEditingRowId((current) => (current === rowId ? null : current));
      return;
    }

    await fetch("/api/month-plan/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId,
        month: view.monthPage.month
      })
    });
    setEditingRowId((current) => (current === rowId ? null : current));
    await onRefresh();
  }

  function handleSortChange(tableKey, key) {
    setTableSorts((current) => {
      const existing = current[tableKey];
      if (!existing || existing.key !== key) {
        return {
          ...current,
          [tableKey]: { key, direction: "asc" }
        };
      }

      return {
        ...current,
        [tableKey]: {
          key,
          direction: existing.direction === "asc" ? "desc" : "asc"
        }
      };
    });
  }

  const sortedIncomeRows = useMemo(
    () => sortRows(incomeRows, tableSorts.income),
    [incomeRows, tableSorts.income]
  );

  function getSectionTotals(rows) {
    const plannedMinor = rows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const actualMinor = rows.reduce((sum, row) => sum + row.actualMinor, 0);
    return {
      plannedMinor,
      actualMinor,
      varianceMinor: plannedMinor - actualMinor
    };
  }

  const monthKey = view.monthPage.month;
  function toggleSection(sectionKey) {
    setSectionOpen((current) => {
      const next = {
        ...current,
        [sectionKey]: !current[sectionKey]
      };
      setSectionStateByKey((existing) => ({
        ...existing,
        [monthUiKey]: next
      }));
      return next;
    });
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isResettingMonth, setIsResettingMonth] = useState(false);
  const [isDeletingMonth, setIsDeletingMonth] = useState(false);

  async function handleDuplicateMonth() {
    setIsDuplicating(true);
    try {
      const response = await fetch(`/api/months/duplicate?source=${view.monthPage.month}`, { method: "POST" });
      const data = await response.json();
      if (data?.targetMonth) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("month", data.targetMonth);
          return next;
        });
      }
    } finally {
      setIsDuplicating(false);
    }
  }

  async function handleResetMonth() {
    setIsResettingMonth(true);
    try {
      await fetch(`/api/months/reset?month=${view.monthPage.month}`, { method: "POST" });
      await onRefresh();
      setResetMonthText("");
    } finally {
      setIsResettingMonth(false);
    }
  }

  async function handleDeleteMonth() {
    setIsDeletingMonth(true);
    try {
      await fetch(`/api/months/delete?month=${view.monthPage.month}`, { method: "POST" });
      await onRefresh();
      setDeleteMonthText("");
    } finally {
      setIsDeletingMonth(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2 className="month-title">{messages.tabs.month}</h2>
          <span id="month-label" className="month-label">
            <span className="month-label-period">{formatMonthLabel(view.monthPage.month)}</span>
            <span className="month-label-separator">•</span>
            <span className="month-label-view">{view.label}</span>
          </span>
        </div>
        <div className="month-header-controls">
          {view.monthPage.scopes.length > 1 ? (
            <div className="scope-toggle pill-row scope-toggle-row">
              {view.monthPage.scopes.map((scope) => (
                <button
                  key={scope.key}
                  className={`pill scope-button ${scope.key === view.monthPage.selectedScope ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSearchParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set("scope", scope.key);
                      return next;
                    });
                  }}
                >
                  {scope.label}
                </button>
              ))}
            </div>
          ) : null}
          <Popover.Root open={actionsOpen} onOpenChange={setActionsOpen}>
            <Popover.Trigger asChild>
              <button type="button" className="month-actions-trigger">
                {messages.month.actions}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="month-actions-popover" sideOffset={12} align="end">
                <button
                  type="button"
                  className="month-actions-item"
                  onClick={() => {
                    setActionsOpen(false);
                    void handleDuplicateMonth();
                  }}
                  disabled={isDuplicating}
                >
                  {messages.month.duplicateMonth}
                </button>
                <Dialog.Root>
                  <Dialog.Trigger asChild>
                    <button
                      type="button"
                      className="month-actions-item"
                      onClick={() => setActionsOpen(false)}
                      disabled={isResettingMonth}
                    >
                      {messages.month.resetMonth}
                    </button>
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Overlay className="note-dialog-overlay" />
                    <Dialog.Content className="note-dialog-content">
                      <div className="note-dialog-head">
                        <Dialog.Title>{messages.month.resetMonth}</Dialog.Title>
                        <Dialog.Description>{messages.month.resetMonthDetail}</Dialog.Description>
                      </div>
                      <input
                        className="table-edit-input"
                        placeholder={messages.month.resetMonthPlaceholder}
                        value={resetMonthText}
                        onChange={(event) => setResetMonthText(event.target.value)}
                      />
                      <div className="note-dialog-actions">
                        <Dialog.Close asChild>
                          <button type="button" className="subtle-action">Cancel</button>
                        </Dialog.Close>
                        <Dialog.Close asChild>
                          <button
                            type="button"
                            className="subtle-action subtle-danger"
                            disabled={resetMonthText.trim().toLowerCase() !== "reset month" || isResettingMonth}
                            onClick={() => void handleResetMonth()}
                          >
                            {messages.month.resetMonthConfirm}
                          </button>
                        </Dialog.Close>
                      </div>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
                <Dialog.Root>
                  <Dialog.Trigger asChild>
                    <button
                      type="button"
                      className="month-actions-item month-actions-item-danger"
                      onClick={() => setActionsOpen(false)}
                      disabled={isDeletingMonth}
                    >
                      {messages.month.deleteMonth}
                    </button>
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Overlay className="note-dialog-overlay" />
                    <Dialog.Content className="note-dialog-content">
                      <div className="note-dialog-head">
                        <Dialog.Title>{messages.month.deleteMonth}</Dialog.Title>
                        <Dialog.Description>{messages.month.deleteMonthDetail}</Dialog.Description>
                      </div>
                      <input
                        className="table-edit-input"
                        placeholder={messages.month.deleteMonthPlaceholder}
                        value={deleteMonthText}
                        onChange={(event) => setDeleteMonthText(event.target.value)}
                      />
                      <div className="note-dialog-actions">
                        <Dialog.Close asChild>
                          <button type="button" className="subtle-action">Cancel</button>
                        </Dialog.Close>
                        <Dialog.Close asChild>
                          <button
                            type="button"
                            className="subtle-action subtle-danger"
                            disabled={deleteMonthText.trim().toLowerCase() !== "delete month" || isDeletingMonth}
                            onClick={() => void handleDeleteMonth()}
                          >
                            {messages.month.deleteMonthConfirm}
                          </button>
                        </Dialog.Close>
                      </div>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>

      <div className="metric-row metric-row-month">
        {monthMetricCards.map((card) => <MetricCard key={card.label} card={card} />)}
      </div>

      <div className="month-plan-stack">
        <p className={`month-plan-stack-hint ${isCombinedHouseholdView ? "is-readonly" : ""}`}>
          {isCombinedHouseholdView ? messages.month.readOnlyCombinedHint : messages.month.editHint}
        </p>
        <section className={`month-plan-section month-plan-section-income ${isCombinedHouseholdView ? "is-readonly" : ""}`}>
          <button
            type="button"
            className="month-plan-summary"
            aria-expanded={sectionOpen.income}
            onClick={() => toggleSection("income")}
          >
            <div className="panel-subhead">
              <div className="month-section-head month-section-head-inline month-section-head-with-toggle">
                <span className={`month-section-toggle ${sectionOpen.income ? "is-open" : ""}`} aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
                <h3>{messages.month.incomeSectionTitle}</h3>
                <p className="month-section-detail-inline">{messages.month.incomeSectionDetail}</p>
              </div>
                <div className="month-summary-actions">
                  {!isCombinedHouseholdView ? (
                    <button
                      type="button"
                      className="subtle-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleAddIncomeRow();
                      }}
                    >
                      {messages.month.addIncomeSource}
                    </button>
                  ) : null}
                </div>
            </div>
          </button>
          {sectionOpen.income ? (
          <div className="table-wrap month-table-wrap">
            <table>
              <thead>
                <tr>
                  <SortableHeader label={messages.month.table.category} sort={tableSorts.income} columnKey="categoryName" onSort={handleSortChange} tableKey="income" />
                  <SortableHeader label={messages.month.table.item} sort={tableSorts.income} columnKey="label" onSort={handleSortChange} tableKey="income" />
                  <SortableHeader label={messages.month.table.planned} sort={tableSorts.income} columnKey="plannedMinor" onSort={handleSortChange} tableKey="income" />
                  <SortableHeader label={messages.month.table.actual} sort={tableSorts.income} columnKey="actualMinor" onSort={handleSortChange} tableKey="income" />
                  <SortableHeader label={messages.month.table.variance} sort={tableSorts.income} columnKey="variance" onSort={handleSortChange} tableKey="income" />
                  <SortableHeader label={messages.month.table.note} sort={tableSorts.income} columnKey="note" onSort={handleSortChange} tableKey="income" />
                </tr>
              </thead>
              <tbody>
                {sortedIncomeRows.map((row) => {
                  const isEditing = editingRowId === row.id;
                  const canEditRow = !isCombinedHouseholdView && !row.isDerived;
                  const variance = row.plannedMinor - row.actualMinor;

                  return (
                    <tr
                      key={row.id}
                      className={`${isEditing ? "is-editing" : ""} ${!canEditRow ? "is-readonly" : ""}`}
                      onClick={canEditRow ? () => beginIncomeEdit(row) : undefined}
                    >
                      <td>
                        <div className="month-category-cell">
                          <CategoryAppearancePopover
                            category={getCategory(categories, row)}
                            onChange={onCategoryAppearanceChange}
                          />
                          {isEditing ? (
                            <select
                              className="table-edit-input"
                              value={getCategorySelectValue(categories, row)}
                              onChange={(event) => handleIncomeRowChange(row.id, getCategoryPatch(categories, event.target.value))}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {categories.map((category) => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                              ))}
                            </select>
                          ) : <span>{row.categoryName}</span>}
                        </div>
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="table-edit-input"
                            value={row.label}
                            onChange={(event) => handleIncomeRowChange(row.id, { label: event.target.value })}
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : row.label}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="table-edit-input table-edit-input-money"
                            value={editingDrafts.plannedMinor ?? formatMinorInput(row.plannedMinor)}
                            onChange={(event) => setEditingDrafts((current) => ({
                              ...current,
                              plannedMinor: event.target.value
                            }))}
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : money(row.plannedMinor)}
                      </td>
                      <td>{money(row.actualMinor)}</td>
                      <td className={variance <= 0 ? "positive" : "negative"}>{money(variance)}</td>
                      <td>
                        <div className="table-note-actions">
                            <button
                              type="button"
                              className="note-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isCombinedHouseholdView && !row.isDerived) {
                                  openNoteDialog("income", row.id, null, row.note);
                                }
                              }}
                            >
                              <span>{row.note || messages.common.emptyValue}</span>
                              {!isCombinedHouseholdView && !row.isDerived ? <SquarePen size={14} /> : null}
                            </button>
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="icon-action"
                                aria-label="Done editing"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  finishEdit();
                                }}
                              >
                                <Check size={16} />
                              </button>
                              <button
                                type="button"
                                className="icon-action subtle-cancel"
                                aria-label="Cancel editing"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  cancelEdit();
                                }}
                              >
                                <X size={16} />
                              </button>
                            </>
                          ) : null}
                          {incomeRows.length > 1 && canEditRow ? (
                            <DeleteRowButton
                              label={row.label || row.categoryName || "income row"}
                              onConfirm={() => handleRemoveIncomeRow(row.id)}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const totals = getSectionTotals(incomeRows);
                  return (
                    <tr className="table-total-row">
                      <td>{messages.month.table.total}</td>
                      <td>{messages.common.emptyValue}</td>
                      <td>{money(totals.plannedMinor)}</td>
                      <td>{money(totals.actualMinor)}</td>
                      <td className={totals.varianceMinor >= 0 ? "positive" : "negative"}>{money(totals.varianceMinor)}</td>
                      <td>{messages.common.emptyValue}</td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
          ) : null}
        </section>

        {[...planSections]
          .sort((left, right) => {
            const order = {
              budget_buckets: 0,
              planned_items: 1
            };
            return order[left.key] - order[right.key];
          })
          .map((section) => (
          <section
            key={section.key}
            className={`month-plan-section ${section.key === "planned_items" ? "month-plan-section-planned" : "month-plan-section-budgets"} ${isCombinedHouseholdView ? "is-readonly" : ""}`}
          >
            <button
              type="button"
              className="month-plan-summary"
              aria-expanded={sectionOpen[section.key]}
              onClick={() => toggleSection(section.key)}
            >
              <div className="panel-subhead">
                <div className="month-section-head month-section-head-with-toggle">
                  <span className={`month-section-toggle ${sectionOpen[section.key] ? "is-open" : ""}`} aria-hidden="true">
                    <ChevronRight size={16} />
                  </span>
                  <h3>{section.label}</h3>
                  <p>{section.description}</p>
                </div>
                <div className="month-summary-actions">
                  {!isCombinedHouseholdView ? (
                    <button
                      type="button"
                      className="subtle-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleAddPlanRow(section.key);
                      }}
                    >
                      {section.key === "planned_items" ? messages.month.addPlannedItem : messages.month.addBudgetBucket}
                    </button>
                  ) : null}
                </div>
              </div>
            </button>
            {sectionOpen[section.key] ? (
            <div className="table-wrap month-table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortableHeader label={messages.month.table.category} sort={tableSorts[section.key]} columnKey="categoryName" onSort={handleSortChange} tableKey={section.key} />
                    {section.key === "planned_items" ? <SortableHeader label={messages.month.table.day} sort={tableSorts[section.key]} columnKey="day" onSort={handleSortChange} tableKey={section.key} /> : null}
                    <SortableHeader label={messages.month.table.item} sort={tableSorts[section.key]} columnKey="label" onSort={handleSortChange} tableKey={section.key} />
                    <SortableHeader label={messages.month.table.planned} sort={tableSorts[section.key]} columnKey="plannedMinor" onSort={handleSortChange} tableKey={section.key} />
                    <SortableHeader label={messages.month.table.actual} sort={tableSorts[section.key]} columnKey="actualMinor" onSort={handleSortChange} tableKey={section.key} />
                    <SortableHeader label={messages.month.table.variance} sort={tableSorts[section.key]} columnKey="variance" onSort={handleSortChange} tableKey={section.key} />
                    {section.key === "planned_items" ? <SortableHeader label={messages.month.table.account} sort={tableSorts[section.key]} columnKey="accountName" onSort={handleSortChange} tableKey={section.key} /> : null}
                    <SortableHeader label={messages.month.table.note} sort={tableSorts[section.key]} columnKey="note" onSort={handleSortChange} tableKey={section.key} />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(section.rows, tableSorts[section.key], monthKey).map((row) => {
                    const variance = row.plannedMinor - row.actualMinor;
                    const isEditing = editingRowId === row.id;
                    const canEditRow = !isCombinedHouseholdView && !row.isDerived;
                    return (
                      <tr
                        key={row.id}
                        className={`${isEditing ? "is-editing" : ""} ${!canEditRow ? "is-readonly" : ""}`}
                        onClick={canEditRow ? () => beginPlanEdit(section.key, row) : undefined}
                      >
                        <td>
                          <div className="month-category-cell">
                            <CategoryAppearancePopover
                              category={getCategory(categories, row)}
                              onChange={onCategoryAppearanceChange}
                            />
                            {isEditing ? (
                              <select
                                className="table-edit-input"
                                value={getCategorySelectValue(categories, row)}
                                onChange={(event) => handleRowChange(section.key, row.id, getCategoryPatch(categories, event.target.value))}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {categories.map((category) => (
                                  <option key={category.id} value={category.id}>{category.name}</option>
                                ))}
                              </select>
                            ) : <span>{row.categoryName}</span>}
                          </div>
                        </td>
                        {section.key === "planned_items" ? (
                          <td>
                            {isEditing ? (
                              <input
                                className="table-edit-input"
                                type="date"
                                value={getRowDateValue(row, view.monthPage.month)}
                                onChange={(event) => handleRowChange(section.key, row.id, { dayLabel: event.target.value, dayOfWeek: undefined })}
                                onClick={(event) => event.stopPropagation()}
                              />
                            ) : formatRowDateLabel(row, view.monthPage.month)}
                          </td>
                        ) : null}
                        <td>
                          {isEditing ? (
                            <input
                              className="table-edit-input"
                              value={row.label}
                              onChange={(event) => handleRowChange(section.key, row.id, { label: event.target.value })}
                              onClick={(event) => event.stopPropagation()}
                            />
                          ) : row.label}
                        </td>
                        <td>
                        {isEditing ? (
                          <input
                            className="table-edit-input table-edit-input-money"
                              value={editingDrafts.plannedMinor ?? formatMinorInput(row.plannedMinor)}
                              onChange={(event) => setEditingDrafts((current) => ({
                                ...current,
                                plannedMinor: event.target.value
                              }))}
                              onClick={(event) => event.stopPropagation()}
                          />
                        ) : money(row.plannedMinor)}
                        </td>
                        <td>{money(row.actualMinor)}</td>
                        <td className={variance >= 0 ? "positive" : "negative"}>{money(variance)}</td>
                        {section.key === "planned_items" ? (
                          <td>
                            {isEditing ? (
                              <select
                                className="table-edit-input"
                                value={row.accountName ?? ""}
                                onChange={(event) => handleRowChange(section.key, row.id, { accountName: event.target.value })}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <option value="">{messages.common.emptyValue}</option>
                                {accounts.map((account) => (
                                  <option key={account.id} value={account.name}>{account.name}</option>
                                ))}
                              </select>
                            ) : row.accountName ?? messages.common.emptyValue}
                          </td>
                        ) : null}
                      <td>
                        <div className="table-note-actions">
                            <button
                              type="button"
                              className="note-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isCombinedHouseholdView && !row.isDerived) {
                                  openNoteDialog("plan", row.id, section.key, row.note);
                                }
                              }}
                            >
                              <span>{row.note ?? messages.common.emptyValue}</span>
                            {canEditRow ? <SquarePen size={14} /> : null}
                            </button>
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  className="icon-action"
                                  aria-label="Done editing"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    finishEdit();
                                  }}
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-action subtle-cancel"
                                  aria-label="Cancel editing"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    cancelEdit();
                                  }}
                                >
                                  <X size={16} />
                                </button>
                              </>
                            ) : null}
                            {canEditRow ? (
                              <DeleteRowButton
                                label={row.label || row.categoryName || "planning row"}
                                onConfirm={() => handleRemovePlanRow(section.key, row.id)}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totals = getSectionTotals(section.rows);
                    return (
                      <tr className="table-total-row">
                        <td>{messages.month.table.total}</td>
                        {section.key === "planned_items" ? <td>{messages.common.emptyValue}</td> : null}
                        <td>{messages.common.emptyValue}</td>
                        <td>{money(totals.plannedMinor)}</td>
                        <td>{money(totals.actualMinor)}</td>
                        <td className={totals.varianceMinor >= 0 ? "positive" : "negative"}>{money(totals.varianceMinor)}</td>
                        {section.key === "planned_items" ? <td>{messages.common.emptyValue}</td> : null}
                        <td>{messages.common.emptyValue}</td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
            ) : null}
          </section>
        ))}
      </div>

      <div className="panel-subgrid">
        <section>
          <div className="panel-subhead">
            <h3>{messages.month.notesTitle}</h3>
            <p>{messages.month.notesDetail}</p>
          </div>
          <button
            type="button"
            className="note-card note-card-button"
            onClick={() => setMonthNoteDialog({ draft: view.monthPage.monthNote ?? "" })}
          >
            <p>{view.monthPage.monthNote || messages.common.emptyValue}</p>
            <SquarePen size={16} />
          </button>
        </section>

        <section>
          <div className="panel-subhead">
            <h3>{messages.month.accountsTitle}</h3>
            <p>{messages.month.accountsDetail}</p>
          </div>
          <div className="stack">
            {visibleAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className="account account-button"
                onClick={() => handleOpenEntriesForAccount(account)}
              >
                <div>
                  <strong>{account.name}</strong>
                  <p>{messages.common.contextWithView(account.institution, account.kind)}</p>
                </div>
                <span>{account.ownerLabel}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <Dialog.Root open={Boolean(noteDialog)} onOpenChange={(open) => { if (!open) setNoteDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>Edit note</Dialog.Title>
                <Dialog.Description>Write the planning context without squeezing it into the table.</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close note editor"
                onClick={() => setNoteDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="note-dialog-textarea"
              value={noteDialog?.draft ?? ""}
              onChange={(event) => setNoteDialog((current) => current ? { ...current, draft: event.target.value } : current)}
              rows={10}
            />
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setNoteDialog(null)}>
                {messages.month.cancelEdit}
              </button>
              <button type="button" className="dialog-primary" onClick={commitNoteDialog}>
                {messages.month.doneEdit}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(monthNoteDialog)} onOpenChange={(open) => { if (!open) setMonthNoteDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{messages.month.notesTitle}</Dialog.Title>
                <Dialog.Description>{messages.month.notesDetail}</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close month note editor"
                onClick={() => setMonthNoteDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="note-dialog-textarea"
              value={monthNoteDialog?.draft ?? ""}
              onChange={(event) => setMonthNoteDialog((current) => current ? { ...current, draft: event.target.value } : current)}
              rows={10}
            />
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setMonthNoteDialog(null)}>
                {messages.month.cancelEdit}
              </button>
              <button type="button" className="dialog-primary" onClick={() => void commitMonthNoteDialog()}>
                {messages.month.doneEdit}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}

function EntriesPanel({ view, categories, people, onCategoryAppearanceChange, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState(view.monthPage.entries);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [linkingTransferEntryId, setLinkingTransferEntryId] = useState(null);
  const [settlingTransferEntryId, setSettlingTransferEntryId] = useState(null);
  const [transferSettlementDrafts, setTransferSettlementDrafts] = useState({});
  const [transferDialogEntryId, setTransferDialogEntryId] = useState(null);
  const selectedScope = searchParams.get("entries_scope") ?? view.monthPage.selectedScope;
  const defaultEntryPerson = view.id === "person-tim"
    ? "Tim"
    : view.id === "person-joyce"
      ? "Joyce"
      : "";
  const entryFilters = {
    wallet: searchParams.get("entry_wallet") ?? "",
    category: searchParams.get("entry_category") ?? "",
    person: searchParams.get("entry_person") ?? defaultEntryPerson,
    type: searchParams.get("entry_type") ?? ""
  };

  useEffect(() => {
    setEntries(view.monthPage.entries);
    setEditingEntryId(null);
    setEntrySnapshot(null);
    setLinkingTransferEntryId(null);
    setSettlingTransferEntryId(null);
    setTransferSettlementDrafts({});
    setTransferDialogEntryId(null);
  }, [view]);

  const wallets = useMemo(() => uniqueValues(entries.map((entry) => entry.accountName)), [entries]);
  const categoryOptions = useMemo(() => uniqueValues(entries.map((entry) => entry.categoryName)), [entries]);
  const peopleFilterOptions = useMemo(
    () => uniqueValues(entries.flatMap((entry) => entry.ownershipType === "shared" ? ["Shared"] : [entry.ownerName ?? ""])),
    [entries]
  );
  const ownerOptions = useMemo(
    () => [...people.map((person) => person.name), "Shared"],
    [people]
  );

  const filteredEntries = useMemo(
    () => entries.filter((entry) => {
      if (!entryMatchesScope(entry, view.id, selectedScope)) {
        return false;
      }
      if (entryFilters.wallet && entry.accountName !== entryFilters.wallet) {
        return false;
      }
      if (entryFilters.category && entry.categoryName !== entryFilters.category) {
        return false;
      }
      if (entryFilters.type && entry.entryType !== entryFilters.type) {
        return false;
      }
      if (entryFilters.person) {
        if (entryFilters.person === "Shared") {
          return entry.ownershipType === "shared";
        }
        return entry.ownerName === entryFilters.person || entry.splits.some((split) => split.personName === entryFilters.person);
      }
      return true;
    }),
    [entries, entryFilters, selectedScope, view.id]
  );

  const groupedEntries = useMemo(() => groupEntriesByDate(filteredEntries), [filteredEntries]);
  const entryTotals = useMemo(() => filteredEntries.reduce((totals, entry) => {
    if (entry.entryType === "income") {
      totals.incomeMinor += entry.amountMinor;
    } else if (entry.entryType === "expense") {
      totals.spendMinor += entry.amountMinor;
    }

    return totals;
  }, { incomeMinor: 0, spendMinor: 0 }), [filteredEntries]);
  const entryNetMinor = entryTotals.incomeMinor - entryTotals.spendMinor;

  function updateEntryFilter(key, value) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const paramKey = `entry_${key}`;
      if (!value) {
        next.delete(paramKey);
      } else {
        next.set(paramKey, value);
      }
      return next;
    });
  }

  function resetEntryFilters() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("entry_wallet");
      next.delete("entry_category");
      next.delete("entry_person");
      next.delete("entry_type");
      return next;
    });
  }

  function beginEntryEdit(entry) {
    if (editingEntryId === entry.id) {
      return;
    }

    setEditingEntryId(entry.id);
    setEntrySnapshot({ ...entry, splits: entry.splits.map((split) => ({ ...split })) });
  }

  async function finishEntryEdit() {
    const currentEntry = entries.find((entry) => entry.id === editingEntryId);
    if (!currentEntry) {
      setEditingEntryId(null);
      setEntrySnapshot(null);
      return;
    }

    const primarySplit = currentEntry.ownershipType === "shared" ? currentEntry.splits[0] : undefined;

    const response = await fetch("/api/entries/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entryId: currentEntry.id,
        date: currentEntry.date,
        description: currentEntry.description,
        accountName: currentEntry.accountName,
        categoryName: currentEntry.categoryName,
        entryType: currentEntry.entryType,
        transferDirection: currentEntry.transferDirection,
        ownershipType: currentEntry.ownershipType,
        ownerName: currentEntry.ownerName,
        note: currentEntry.note ?? "",
        splitBasisPoints: primarySplit?.ratioBasisPoints
      })
    });

    if (!response.ok) {
      return;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
    await onRefresh();
  }

  function cancelEntryEdit() {
    if (!entrySnapshot) {
      setEditingEntryId(null);
      return;
    }

    setEntries((current) => current.map((entry) => (
      entry.id === entrySnapshot.id ? entrySnapshot : entry
    )));
    setEditingEntryId(null);
    setEntrySnapshot(null);
  }

  async function linkTransferCandidate(entry, candidate) {
    const fromEntryId = entry.transferDirection === "in" ? candidate.id : entry.id;
    const toEntryId = entry.transferDirection === "in" ? entry.id : candidate.id;
    setLinkingTransferEntryId(entry.id);

    try {
      const response = await fetch("/api/transfers/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fromEntryId,
          toEntryId
        })
      });

      if (!response.ok) {
        return;
      }

      setTransferDialogEntryId(null);
      setEditingEntryId(null);
      setEntrySnapshot(null);
      await onRefresh();
    } finally {
      setLinkingTransferEntryId(null);
    }
  }

  function ensureTransferSettlementDraft(entry) {
    setTransferSettlementDrafts((current) => {
      if (current[entry.id]) {
        return current;
      }

      return {
        ...current,
        [entry.id]: {
          currentCategoryName: "Other",
          counterpartCategoryName: "Other"
        }
      };
    });
  }

  function updateTransferSettlementDraft(entryId, patch) {
    setTransferSettlementDrafts((current) => ({
      ...current,
      [entryId]: {
        currentCategoryName: current[entryId]?.currentCategoryName ?? "Other",
        counterpartCategoryName: current[entryId]?.counterpartCategoryName ?? "Other",
        ...patch
      }
    }));
  }

  async function settleTransfer(entry) {
    const draft = transferSettlementDrafts[entry.id] ?? {
      currentCategoryName: "Other",
      counterpartCategoryName: "Other"
    };
    setSettlingTransferEntryId(entry.id);

    try {
      const response = await fetch("/api/transfers/settle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: entry.id,
          counterpartEntryId: entry.linkedTransfer?.transactionId,
          currentCategoryName: draft.currentCategoryName,
          counterpartCategoryName: draft.counterpartCategoryName
        })
      });

      if (!response.ok) {
        return;
      }

      setTransferDialogEntryId(null);
      setEditingEntryId(null);
      setEntrySnapshot(null);
      await onRefresh();
    } finally {
      setSettlingTransferEntryId(null);
    }
  }

  function updateEntry(entryId, patch) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      const nextEntry = { ...entry, ...patch };

      if (typeof patch.categoryName === "string" && patch.categoryName === "Transfer") {
        nextEntry.entryType = "transfer";
        nextEntry.transferDirection = nextEntry.transferDirection ?? "out";
      }

      if (patch.ownershipType === "direct" && patch.ownerName) {
        const owner = people.find((person) => person.name === patch.ownerName);
        nextEntry.splits = [{
          personId: owner?.id ?? patch.ownerName.toLowerCase(),
          personName: patch.ownerName,
          ratioBasisPoints: 10000,
          amountMinor: nextEntry.amountMinor
        }];
      }

      if (patch.ownershipType === "shared") {
        const fallbackPeople = people.slice(0, 2);
        const sharedPeople = entry.splits.length >= 2
          ? entry.splits.slice(0, 2).map((split) => ({
              personId: split.personId,
              personName: split.personName
            }))
          : fallbackPeople.map((person) => ({
              personId: person.id,
              personName: person.name
            }));

        const firstAmount = Math.round(nextEntry.amountMinor / 2);
        const secondAmount = nextEntry.amountMinor - firstAmount;

        nextEntry.ownerName = undefined;
        nextEntry.splits = [
          {
            ...sharedPeople[0],
            ratioBasisPoints: 5000,
            amountMinor: firstAmount
          },
          {
            ...sharedPeople[1],
            ratioBasisPoints: 5000,
            amountMinor: secondAmount
          }
        ];
      }

      return nextEntry;
    }));
  }

  function updateEntrySplit(entryId, percentage) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId || entry.ownershipType !== "shared" || entry.splits.length < 2) {
        return entry;
      }

      const primaryIndex = getVisibleSplitIndex(entry, view.id);
      const secondaryIndex = primaryIndex === 0 ? 1 : 0;
      const basisPoints = Math.max(0, Math.min(10000, Math.round(percentage * 100)));
      const complement = 10000 - basisPoints;
      const totalAmountMinor = entry.totalAmountMinor ?? entry.amountMinor;
      const primaryAmount = Math.round((totalAmountMinor * basisPoints) / 10000);
      const secondaryAmount = totalAmountMinor - primaryAmount;
      const nextSplits = entry.splits.map((split) => ({ ...split }));
      nextSplits[primaryIndex] = {
        ...nextSplits[primaryIndex],
        ratioBasisPoints: basisPoints,
        amountMinor: primaryAmount
      };
      nextSplits[secondaryIndex] = {
        ...nextSplits[secondaryIndex],
        ratioBasisPoints: complement,
        amountMinor: secondaryAmount
      };

      return {
        ...entry,
        amountMinor: view.id === "household" ? totalAmountMinor : nextSplits[primaryIndex].amountMinor,
        totalAmountMinor,
        viewerSplitRatioBasisPoints: view.id === "household" ? undefined : nextSplits[primaryIndex].ratioBasisPoints,
        splits: nextSplits
      };
    }));
  }

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.entries}</h2>
          <span className="panel-context">{messages.entries.viewing(view.label)}</span>
        </div>
        <div className="scope-toggle pill-row scope-toggle-row">
          {view.monthPage.scopes.map((scope) => (
              <button
                key={scope.key}
                className={`pill scope-button ${scope.key === selectedScope ? "is-active" : ""}`}
                type="button"
                onClick={() => {
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("entries_scope", scope.key);
                    return next;
                  });
                }}
              >
                {scope.label}
              </button>
          ))}
        </div>
      </div>

      <section className="entries-filter-bar">
        <div className="entries-filter-reset">
          <button type="button" className="subtle-action" onClick={resetEntryFilters}>
            {messages.entries.resetFilters}
          </button>
        </div>
        <FilterSelect
          label={messages.entries.wallet}
          value={entryFilters.wallet}
          options={wallets}
          emptyLabel={messages.entries.allWallets}
          onChange={(value) => updateEntryFilter("wallet", value)}
        />
        <FilterSelect
          label={messages.entries.category}
          value={entryFilters.category}
          options={categoryOptions}
          emptyLabel={messages.entries.allCategories}
          onChange={(value) => updateEntryFilter("category", value)}
        />
        <FilterSelect
          label={messages.entries.person}
          value={entryFilters.person}
          options={peopleFilterOptions}
          emptyLabel={messages.entries.allPeople}
          onChange={(value) => updateEntryFilter("person", value)}
        />
        <FilterSelect
          label={messages.entries.type}
          value={entryFilters.type}
          options={["expense", "income", "transfer"]}
          emptyLabel={messages.entries.allTypes}
          onChange={(value) => updateEntryFilter("type", value)}
        />
      </section>

      <section className="entries-totals-strip" aria-label={messages.entries.totalsLabel}>
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalSpend}</span>
          <strong className={getAmountToneClass(-entryTotals.spendMinor)}>{money(entryTotals.spendMinor)}</strong>
        </span>
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalIncome}</span>
          <strong className={getAmountToneClass(entryTotals.incomeMinor)}>{money(entryTotals.incomeMinor)}</strong>
        </span>
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalDifference}</span>
          <strong className={getAmountToneClass(entryNetMinor)}>{money(entryNetMinor)}</strong>
        </span>
      </section>

      <div className="entries-date-groups">
        {groupedEntries.map((group) => (
          <section key={group.date} className="entries-date-group">
            <div className="entries-date-head">
              <strong>{formatDateOnly(group.date)}</strong>
              <span>{messages.entries.dateNet}: {money(group.netMinor)}</span>
            </div>

            <div className="entries-rows">
              {group.entries.map((entry) => {
                const isEditing = editingEntryId === entry.id;
                const ownerLabel = entry.ownershipType === "shared" ? "Shared" : entry.ownerName ?? messages.common.emptyValue;
                const splitPercent = getVisibleSplitPercent(entry, view.id);
                const category = getCategory(categories, entry);
                const transferLabel = entry.entryType === "transfer"
                  ? entry.transferDirection === "in" ? "Transfer in" : "Transfer out"
                  : null;
                const transferDetail = entry.linkedTransfer
                  ? `${entry.transferDirection === "out" ? "To" : "From"} ${entry.linkedTransfer.accountName}`
                  : entry.accountName;
                const signedAmountMinor = getSignedAmountMinor(entry);
                const signedTotalAmountMinor = getSignedTotalAmountMinor(entry);
                const hasWeightedTotal = signedTotalAmountMinor != null && signedTotalAmountMinor !== signedAmountMinor;
                const transferCandidates = entry.entryType === "transfer"
                  ? getTransferMatchCandidates(entry, entries)
                  : [];

                return (
                  <div key={entry.id} className={`entry-row ${isEditing ? "is-editing" : ""}`} id={entry.id}>
                    <button type="button" className="entry-row-main" onClick={() => beginEntryEdit(entry)}>
                      <div className="entry-row-category">
                        <CategoryAppearancePopover
                          category={category}
                          onChange={onCategoryAppearanceChange}
                        />
                        <strong>{category?.name ?? entry.categoryName}</strong>
                      </div>
                      <div className="entry-row-description">
                        <strong>{entry.description}</strong>
                        <p>{entry.note || messages.common.emptyValue}</p>
                      </div>
                      <div className="entry-row-transfer">
                        <strong>{transferDetail}</strong>
                        <p>{entry.accountName}</p>
                      </div>
                      <div className="entry-row-right">
                        <div className="entry-pills">
                          {transferLabel ? <span className="entry-chip entry-chip-transfer">{transferLabel}</span> : null}
                          <span className={`entry-chip ${entry.ownershipType === "shared" ? "entry-chip-shared" : "entry-chip-owner"}`}>{ownerLabel}</span>
                          {entry.ownershipType === "shared" && splitPercent != null ? (
                            <span className="entry-chip entry-chip-split">{splitPercent}%</span>
                          ) : null}
                        </div>
                        <strong className={getAmountToneClass(signedAmountMinor)}>{money(signedAmountMinor)}</strong>
                        {hasWeightedTotal ? <p>({money(signedTotalAmountMinor)} total)</p> : null}
                      </div>
                    </button>

                    {isEditing ? (
                      <div className="entry-inline-editor">
                        <div className="entry-edit-grid">
                          <label>
                            <span>{messages.entries.editDate}</span>
                            <input
                              className="table-edit-input"
                              type="date"
                              value={entry.date}
                              onChange={(event) => updateEntry(entry.id, { date: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>{messages.entries.editCategory}</span>
                            {entry.entryType === "transfer" ? (
                              <input
                                className="table-edit-input"
                                value="Transfer"
                                readOnly
                              />
                            ) : (
                              <select
                                className="table-edit-input"
                                value={entry.categoryName}
                                onChange={(event) => updateEntry(entry.id, { categoryName: event.target.value })}
                              >
                                {categoryOptions.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            )}
                          </label>
                          <label>
                            <span>{messages.entries.editWallet}</span>
                            <select
                              className="table-edit-input"
                              value={entry.accountName}
                              onChange={(event) => updateEntry(entry.id, { accountName: event.target.value })}
                            >
                              {wallets.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>{messages.entries.editOwner}</span>
                            <select
                              className="table-edit-input"
                              value={entry.ownershipType === "shared" ? "Shared" : (entry.ownerName ?? "")}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (nextValue === "Shared") {
                                  updateEntry(entry.id, { ownershipType: "shared", ownerName: undefined });
                                } else {
                                  updateEntry(entry.id, { ownershipType: "direct", ownerName: nextValue });
                                }
                              }}
                            >
                              {ownerOptions.map((person) => (
                                <option key={person} value={person}>{person}</option>
                              ))}
                            </select>
                          </label>
                          {entry.entryType === "transfer" ? (
                            <div className="entry-edit-transfer-helper">
                              <span>Transfer match</span>
                              <Dialog.Root
                                open={transferDialogEntryId === entry.id}
                                onOpenChange={(open) => {
                                  if (open) {
                                    ensureTransferSettlementDraft(entry);
                                    setTransferDialogEntryId(entry.id);
                                    return;
                                  }
                                  setTransferDialogEntryId((current) => current === entry.id ? null : current);
                                }}
                              >
                                <Dialog.Trigger asChild>
                                  <button type="button" className="subtle-action">
                                    Manage transfer
                                  </button>
                                </Dialog.Trigger>
                                <Dialog.Portal>
                                  <Dialog.Overlay className="note-dialog-overlay" />
                                  <Dialog.Content className="note-dialog-content transfer-match-dialog">
                                    <div className="transfer-match-head">
                                      <div>
                                        <Dialog.Title>Transfer details</Dialog.Title>
                                        <Dialog.Description>Relink or unlink this transfer pair together.</Dialog.Description>
                                      </div>
                                      <button
                                        type="button"
                                        className="icon-action subtle-cancel"
                                        aria-label="Close transfer manager"
                                        onClick={() => setTransferDialogEntryId(null)}
                                      >
                                        <X size={16} />
                                      </button>
                                    </div>
                                    <div className="transfer-match-layout">
                                      <section className="transfer-match-section">
                                        <h4>Wallets</h4>
                                        <div className="transfer-wallet-grid">
                                          <div>
                                            <span className="transfer-match-label">From wallet</span>
                                            <strong>{getTransferWallets(entry).fromWalletName}</strong>
                                          </div>
                                          <div>
                                            <span className="transfer-match-label">To wallet</span>
                                            <strong>{getTransferWallets(entry).toWalletName}</strong>
                                          </div>
                                        </div>
                                      </section>
                                      <section className="transfer-match-section">
                                        <h4>Exact matches</h4>
                                        <span className="transfer-match-label">Potential exact matches</span>
                                        <div className="transfer-match-stack">
                                          {transferCandidates.length ? transferCandidates.map((candidate) => {
                                            const isCurrentLink = entry.linkedTransfer?.transactionId === candidate.id;
                                            return (
                                              <div key={candidate.id} className="transfer-match-card">
                                                <div>
                                                  <strong>{candidate.accountName}</strong>
                                                  <p>{formatDateOnly(candidate.date)} • {candidate.description}</p>
                                                </div>
                                                {isCurrentLink ? (
                                                  <span className="entry-chip entry-chip-transfer">Current match</span>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    className="subtle-action"
                                                    disabled={linkingTransferEntryId === entry.id}
                                                    onClick={() => void linkTransferCandidate(entry, candidate)}
                                                  >
                                                    Use match
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          }) : (
                                            <p className="transfer-match-empty">No exact amount match found in another wallet for this month.</p>
                                          )}
                                        </div>
                                      </section>
                                      <section className="transfer-match-section transfer-settlement">
                                        <h4>Break connection</h4>
                                        <span className="transfer-match-label">Break connection and convert both sides</span>
                                        <div className="transfer-settlement-grid">
                                          <label>
                                            <span>This entry becomes</span>
                                            <select
                                              className="table-edit-input"
                                              value={transferSettlementDrafts[entry.id]?.currentCategoryName ?? "Other"}
                                              onChange={(event) => updateTransferSettlementDraft(entry.id, { currentCategoryName: event.target.value })}
                                            >
                                              {categoryOptions.filter((option) => option !== "Transfer").map((option) => (
                                                <option key={option} value={option}>{option}</option>
                                              ))}
                                            </select>
                                          </label>
                                          {entry.linkedTransfer ? (
                                            <label>
                                              <span>Counterpart becomes</span>
                                              <select
                                                className="table-edit-input"
                                                value={transferSettlementDrafts[entry.id]?.counterpartCategoryName ?? "Other"}
                                                onChange={(event) => updateTransferSettlementDraft(entry.id, { counterpartCategoryName: event.target.value })}
                                              >
                                                {categoryOptions.filter((option) => option !== "Transfer").map((option) => (
                                                  <option key={option} value={option}>{option}</option>
                                                ))}
                                              </select>
                                            </label>
                                          ) : null}
                                        </div>
                                        <p className="transfer-match-empty">
                                          This removes the transfer link for both sides so you do not leave the counterpart behind as a transfer.
                                        </p>
                                        <button
                                          type="button"
                                          className="subtle-action"
                                          disabled={settlingTransferEntryId === entry.id}
                                          onClick={() => void settleTransfer(entry)}
                                        >
                                          Break connection
                                        </button>
                                      </section>
                                    </div>
                                  </Dialog.Content>
                                </Dialog.Portal>
                              </Dialog.Root>
                            </div>
                          ) : null}
                          {entry.ownershipType === "shared" && splitPercent != null ? (
                            <label>
                              <span>{messages.entries.editSplit}</span>
                              <input
                                className="table-edit-input table-edit-input-money"
                                type="number"
                                min="0"
                                max="100"
                                value={splitPercent}
                                onChange={(event) => updateEntrySplit(entry.id, Number(event.target.value))}
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="entry-writing-grid">
                          <label>
                            <span>{messages.entries.editDescription}</span>
                            <textarea
                              className="table-edit-input table-edit-textarea"
                              value={entry.description}
                              onChange={(event) => updateEntry(entry.id, { description: event.target.value })}
                              rows={3}
                            />
                          </label>
                          <label>
                            <span>{messages.entries.editNote}</span>
                            <textarea
                              className="table-edit-input table-edit-textarea"
                              value={entry.note ?? ""}
                              onChange={(event) => updateEntry(entry.id, { note: event.target.value })}
                              rows={3}
                            />
                          </label>
                        </div>
                        <div className="entry-inline-actions">
                          <button type="button" className="icon-action" aria-label="Done editing entry" onClick={finishEntryEdit}>
                            <Check size={16} />
                          </button>
                          <button type="button" className="icon-action subtle-cancel" aria-label="Cancel editing entry" onClick={cancelEntryEdit}>
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function FilterSelect({ label, value, options, emptyLabel, onChange }) {
  return (
    <label className="entries-filter">
      <span className="entries-filter-label">{label}</span>
      <select className="table-edit-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function DeleteRowButton({ label, onConfirm, triggerLabel, confirmLabel = "Confirm", destructive = true, prompt }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={destructive ? "subtle-remove" : "icon-action"}
          aria-label={triggerLabel ?? `Delete ${label}`}
          onClick={(event) => event.stopPropagation()}
        >
          {destructive ? "×" : <X size={16} />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="delete-popover"
          sideOffset={8}
          align="end"
          onClick={(event) => event.stopPropagation()}
        >
          <p>
            {prompt ?? <>You are deleting <strong>{label}</strong>. Confirm?</>}
          </p>
          <div className="delete-popover-actions">
            <Popover.Close asChild>
              <button type="button" className="subtle-action">
                Cancel
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button type="button" className={`subtle-action ${destructive ? "subtle-danger" : ""}`} onClick={onConfirm}>
                {confirmLabel}
              </button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ImportsPanel({ importsPage, viewId, viewLabel, accounts, categories, people, onRefresh }) {
  const [sourceLabel, setSourceLabel] = useState("Imported CSV");
  const [importNote, setImportNote] = useState("");
  const [csvText, setCsvText] = useState("");
  const [defaultAccountName, setDefaultAccountName] = useState(accounts[0]?.name ?? "");
  const [ownershipType, setOwnershipType] = useState("direct");
  const [ownerName, setOwnerName] = useState(people[0]?.name ?? "");
  const [splitPercent, setSplitPercent] = useState("50");
  const [unknownCategoryMode, setUnknownCategoryMode] = useState("other");
  const [columnMappings, setColumnMappings] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewError, setPreviewError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const csvInspection = useMemo(() => inspectCsv(csvText), [csvText]);
  const headerSignature = csvInspection.headers.join("|");

  useEffect(() => {
    if (!defaultAccountName && accounts[0]?.name) {
      setDefaultAccountName(accounts[0].name);
    }
  }, [accounts, defaultAccountName]);

  useEffect(() => {
    if (!ownerName && people[0]?.name) {
      setOwnerName(people[0].name);
    }
  }, [ownerName, people]);

  useEffect(() => {
    if (!people.length) {
      return;
    }

    if (viewId === "household") {
      if (!ownerName) {
        setOwnerName(people[0].name);
      }
      return;
    }

    const matchedPerson = people.find((person) => person.id === viewId);
    if (matchedPerson && ownerName !== matchedPerson.name) {
      setOwnerName(matchedPerson.name);
    }
  }, [ownerName, people, viewId]);

  useEffect(() => {
    setColumnMappings((current) => {
      const next = {};
      for (const header of csvInspection.headers) {
        next[header] = current[header] ?? inferImportMapping(header);
      }
      return next;
    });
  }, [headerSignature, csvInspection.headers]);

  const mappedFields = useMemo(() => {
    const counts = {};
    for (const value of Object.values(columnMappings)) {
      if (!value || value === "ignore") {
        continue;
      }
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  }, [columnMappings]);

  const duplicateMappings = useMemo(
    () => Object.entries(mappedFields).filter(([, count]) => count > 1).map(([field]) => field),
    [mappedFields]
  );

  const mappedRows = useMemo(
    () => buildMappedImportRows(csvInspection.rows, columnMappings),
    [columnMappings, csvInspection.rows]
  );

  const requiredFields = ["date", "description", "amount"];
  const missingRequiredFields = requiredFields.filter((field) => !mappedFields[field]);
  const readyForMapping = csvInspection.headers.length > 0;
  const readyForPreview = mappedRows.length > 0 && missingRequiredFields.length === 0 && duplicateMappings.length === 0;
  const currentStage = preview ? 3 : readyForMapping ? 2 : 1;
  const hasBlockingCategoryPolicy = unknownCategoryMode === "block" && Boolean(preview?.unknownCategories?.length);
  const hasUnmappedAccounts = previewRows.some((row) => !row.accountName);

  async function handleUploadCsv(event) {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }

    const nextText = await file.text();
    setCsvText(nextText);
    event.target.value = "";
  }

  async function handlePreview() {
    if (!readyForPreview) {
      return;
    }

    setIsSubmitting(true);
    setPreviewError("");
    try {
      const response = await fetch("/api/imports/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceLabel,
          rows: mappedRows,
          defaultAccountName,
          ownershipType,
          ownerName,
          splitBasisPoints: Math.round(Number(splitPercent || "50") * 100)
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setPreview(null);
        setPreviewRows([]);
        setPreviewError(data.error ?? "Import preview failed.");
        return;
      }
      setPreview(data.preview);
      setPreviewRows(data.preview?.previewRows ?? []);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCommit() {
    if (!previewRows.length) {
      return;
    }

    setIsSubmitting(true);
    try {
      await fetch("/api/imports/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceLabel: preview?.sourceLabel ?? sourceLabel,
          note: importNote,
          rows: previewRows.map((row) => ({
            ...row,
            splitBasisPoints: Number(row.splitBasisPoints ?? 10000)
          }))
        })
      });
      setPreview(null);
      setPreviewRows([]);
      setPreviewError("");
      setCsvText("");
      setImportNote("");
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRollback(importId) {
    setIsSubmitting(true);
    try {
      await fetch("/api/imports/rollback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ importId })
      });
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  function updatePreviewRow(rowId, patch) {
    setPreviewRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.imports}</h2>
          <span className="panel-context">{messages.imports.viewing(viewLabel)}</span>
        </div>
      </div>
      <section className="panel-subsection import-workflow">
        <div className="import-header">
          <div>
            <h3>{messages.imports.composerTitle}</h3>
            <p className="lede compact">{messages.imports.composerDetail}</p>
          </div>
          <div className="import-actions">
            <button
              type="button"
              className="subtle-action"
              onClick={() => {
                setPreview(null);
                setPreviewRows([]);
                setPreviewError("");
              }}
            >
              {messages.imports.clearPreview}
            </button>
          </div>
        </div>

        <ol className="import-steps" aria-label={messages.imports.stepsLabel}>
          {messages.imports.steps.map((step, index) => {
            const stepNumber = index + 1;
            const stateClass =
              currentStage > stepNumber ? "is-complete" : currentStage === stepNumber ? "is-current" : "";

            return (
              <li key={step} className={`import-step ${stateClass}`}>
                <span className="import-step-dot" />
                <span>{step}</span>
              </li>
            );
          })}
        </ol>

        <div className="import-stage-card">
          <div className="section-head">
            <h3>{messages.imports.selectFileTitle}</h3>
            <span className="panel-context">{messages.imports.selectFileDetail}</span>
          </div>

          <div className="import-form-grid">
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.sourceLabel}</span>
              <input
                className="table-edit-input"
                value={sourceLabel}
                onChange={(event) => setSourceLabel(event.target.value)}
                placeholder={messages.imports.sourceLabelPlaceholder}
              />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.defaultAccount}</span>
              <select className="table-edit-input" value={defaultAccountName} onChange={(event) => setDefaultAccountName(event.target.value)}>
                <option value="">{messages.entries.allWallets}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.name}>{account.name}</option>
                ))}
              </select>
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.ownership}</span>
              <select className="table-edit-input" value={ownershipType} onChange={(event) => setOwnershipType(event.target.value)}>
                <option value="direct">Direct</option>
                <option value="shared">{messages.entries.shared}</option>
              </select>
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.owner}</span>
              <select className="table-edit-input" value={ownerName} disabled={ownershipType !== "direct"} onChange={(event) => setOwnerName(event.target.value)}>
                {people.map((person) => (
                  <option key={person.id} value={person.name}>{person.name}</option>
                ))}
              </select>
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.split}</span>
              <input
                className="table-edit-input"
                type="number"
                min="0"
                max="100"
                value={splitPercent}
                disabled={ownershipType !== "shared"}
                onChange={(event) => setSplitPercent(event.target.value)}
              />
            </label>
            <label className="entries-filter import-note-field">
              <span className="entries-filter-label">{messages.imports.importNote}</span>
              <input
                className="table-edit-input"
                value={importNote}
                onChange={(event) => setImportNote(event.target.value)}
                placeholder={messages.imports.importNotePlaceholder}
              />
            </label>
          </div>

          <div className="import-csv-grid">
            <label className="entries-filter import-csv-field">
              <span className="entries-filter-label">{messages.imports.csvInput}</span>
              <textarea
                className="table-edit-textarea import-textarea"
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                placeholder={messages.imports.csvPlaceholder}
              />
            </label>
            <div className="import-sidecar">
              <label className="subtle-action upload-action">
                {messages.imports.uploadFile}
                <input type="file" accept=".csv,text/csv" hidden onChange={handleUploadCsv} />
              </label>
              <p className="lede compact">{messages.imports.defaultsHint}</p>
              <p className="lede compact">{messages.imports.trustHint}</p>
              <p className="lede compact">{importsPage.rollbackPolicy}</p>
            </div>
          </div>
        </div>

        {readyForMapping ? (
          <div className="import-stage-card">
            <div className="section-head">
              <h3>{messages.imports.mappingTitle}</h3>
              <span className="panel-context">{messages.imports.mappingDetail(csvInspection.rows.length)}</span>
            </div>

            <div className="import-mapping-topline">
              <label className="entries-filter">
                <span className="entries-filter-label">{messages.imports.nonExistingCategories}</span>
                <select className="table-edit-input" value={unknownCategoryMode} onChange={(event) => setUnknownCategoryMode(event.target.value)}>
                  <option value="other">{messages.imports.categoryFallbackOther}</option>
                  <option value="block">{messages.imports.categoryFallbackBlock}</option>
                </select>
              </label>
              <div className="import-mapping-state">
                {missingRequiredFields.length ? (
                  <span className="pill warning">{messages.imports.missingRequired(missingRequiredFields.join(", "))}</span>
                ) : null}
                {duplicateMappings.length ? (
                  <span className="pill warning">{messages.imports.duplicateMappings(duplicateMappings.join(", "))}</span>
                ) : null}
                {!missingRequiredFields.length && !duplicateMappings.length ? (
                  <span className="pill is-active">{messages.imports.mappingReady}</span>
                ) : null}
              </div>
            </div>

            <div className="import-mapping-grid">
              {csvInspection.headers.map((header) => (
                <article key={header} className="import-column-card">
                  <div className="import-column-head">
                    <strong>{header}</strong>
                    <span>{messages.imports.sampleRows}</span>
                  </div>
                  <select
                    className="table-edit-input"
                    value={columnMappings[header] ?? "ignore"}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setColumnMappings((current) => ({ ...current, [header]: nextValue }));
                    }}
                  >
                    {IMPORT_FIELD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="import-column-samples">
                    {csvInspection.rows.slice(0, 3).map((row, index) => (
                      <code key={`${header}-${index}`}>{row[header] || messages.common.emptyValue}</code>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <div className="import-actions">
              <button type="button" className="subtle-action is-primary" disabled={isSubmitting || !readyForPreview} onClick={handlePreview}>
                {messages.imports.preview}
              </button>
            </div>
            {previewError ? <div className="import-warning"><strong>{previewError}</strong></div> : null}
          </div>
        ) : null}

        <div className="import-stage-card">
          <div className="section-head">
            <h3>{messages.imports.previewRows}</h3>
            <span className="panel-context">
              {preview ? messages.imports.transactionCount(preview.importedRows) : messages.imports.previewEmpty}
            </span>
          </div>

          {preview?.unknownAccounts?.length ? (
            <div className="import-warning">
              <strong>{messages.imports.unknownAccounts}</strong>
              <div className="pill-row dense">
                {preview.unknownAccounts.map((accountName) => (
                  <span key={accountName} className="pill warning">{accountName}</span>
                ))}
              </div>
            </div>
          ) : null}

          {preview?.unknownCategories?.length ? (
            <div className="import-warning">
              <strong>{messages.imports.unknownCategories}</strong>
              <div className="pill-row dense">
                {preview.unknownCategories.map((categoryName) => (
                  <span key={categoryName} className="pill warning">{categoryName}</span>
                ))}
              </div>
              <p className="lede compact">
                {unknownCategoryMode === "other" ? messages.imports.categoryFallbackHelp : messages.imports.categoryFallbackBlocked}
              </p>
            </div>
          ) : null}

          {preview ? (
            <div className="pill-row dense">
              {preview.startDate && preview.endDate ? (
                <span className="pill">{messages.imports.previewCoverage(formatDateOnly(preview.startDate), formatDateOnly(preview.endDate))}</span>
              ) : null}
              {preview.duplicateCandidateCount ? (
                <span className="pill warning">{messages.imports.duplicateCandidates(preview.duplicateCandidateCount)}</span>
              ) : null}
              {preview.overlappingImportCount ? (
                <span className="pill warning">{messages.imports.overlappingImports(preview.overlappingImportCount)}</span>
              ) : null}
            </div>
          ) : null}

          {preview?.duplicateCandidates?.length ? (
            <div className="import-warning">
              <strong>{messages.imports.duplicateMatchesTitle}</strong>
              <p className="lede compact">{messages.imports.duplicateMatchesDetail}</p>
              <div className="stack">
                {preview.duplicateCandidates.map((candidate, index) => (
                  <div key={`${candidate.existingImportId}-${candidate.date}-${index}`} className="import-card">
                    <div>
                      <strong>{candidate.description}</strong>
                      <p>{messages.common.triplet(formatDateOnly(candidate.date), candidate.accountName ?? messages.common.emptyValue, money(candidate.amountMinor))}</p>
                    </div>
                    <div className="import-meta">
                      <span className={`pill ${candidate.matchKind === "exact" ? "warning" : ""}`}>
                        {candidate.matchKind === "exact" ? messages.imports.duplicateMatchKindExact : messages.imports.duplicateMatchKindNear}
                      </span>
                      <p>{candidate.existingImportId}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {previewRows.length ? (
            <>
              <div className="import-actions import-actions-end">
                <button
                  type="button"
                  className="subtle-action is-primary"
                  disabled={isSubmitting || !previewRows.length || hasUnmappedAccounts || hasBlockingCategoryPolicy}
                  onClick={handleCommit}
                >
                  {messages.imports.commit}
                </button>
              </div>
              <div className="table-wrap import-table-wrap">
                <table className="summary-table import-preview-table">
                  <thead>
                    <tr>
                      <th>{messages.imports.table.row}</th>
                      <th>{messages.imports.table.date}</th>
                      <th>{messages.imports.table.description}</th>
                      <th>{messages.imports.table.amount}</th>
                      <th>{messages.imports.table.type}</th>
                      <th>{messages.imports.table.account}</th>
                      <th>{messages.imports.table.category}</th>
                      <th>{messages.imports.table.owner}</th>
                      <th>{messages.imports.table.split}</th>
                      <th>{messages.imports.table.note}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.rowId}>
                        <td>{row.rowIndex}</td>
                        <td>
                          <input className="table-edit-input" type="date" value={row.date} onChange={(event) => updatePreviewRow(row.rowId, { date: event.target.value })} />
                        </td>
                        <td>
                          <input className="table-edit-input" value={row.description} onChange={(event) => updatePreviewRow(row.rowId, { description: event.target.value })} />
                        </td>
                        <td className={getAmountToneClass(row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor)}>
                          <input
                            className="table-edit-input import-amount-input"
                            value={formatMinorInput(row.amountMinor)}
                            onChange={(event) => updatePreviewRow(row.rowId, { amountMinor: parseMoneyInput(event.target.value, row.amountMinor) })}
                          />
                        </td>
                        <td>
                          <select className="table-edit-input" value={row.entryType} onChange={(event) => updatePreviewRow(row.rowId, { entryType: event.target.value })}>
                            <option value="expense">Expense</option>
                            <option value="income">Income</option>
                            <option value="transfer">Transfer</option>
                          </select>
                        </td>
                        <td>
                          <select className="table-edit-input" value={row.accountName ?? ""} onChange={(event) => updatePreviewRow(row.rowId, { accountName: event.target.value || undefined })}>
                            <option value="">{messages.entries.allWallets}</option>
                            {accounts.map((account) => (
                              <option key={account.id} value={account.name}>{account.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select className="table-edit-input" value={row.categoryName ?? ""} onChange={(event) => updatePreviewRow(row.rowId, { categoryName: event.target.value || undefined })}>
                            <option value="">{messages.entries.allCategories}</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.name}>{category.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="table-edit-input"
                            value={row.ownershipType === "shared" ? "Shared" : (row.ownerName ?? "")}
                            onChange={(event) => {
                              const nextOwner = event.target.value;
                              if (nextOwner === "Shared") {
                                updatePreviewRow(row.rowId, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5000 });
                                return;
                              }
                              updatePreviewRow(row.rowId, { ownershipType: "direct", ownerName: nextOwner, splitBasisPoints: 10000 });
                            }}
                          >
                            {people.map((person) => (
                              <option key={person.id} value={person.name}>{person.name}</option>
                            ))}
                            <option value="Shared">{messages.entries.shared}</option>
                          </select>
                        </td>
                        <td>
                          {row.ownershipType === "shared" ? (
                            <input
                              className="table-edit-input import-split-input"
                              type="number"
                              min="0"
                              max="100"
                              value={Math.round((row.splitBasisPoints ?? 5000) / 100)}
                              onChange={(event) => updatePreviewRow(row.rowId, { splitBasisPoints: Math.round(Number(event.target.value || "50") * 100) })}
                            />
                          ) : (
                            messages.common.emptyValue
                          )}
                        </td>
                        <td>
                          <input className="table-edit-input" value={row.note ?? ""} onChange={(event) => updatePreviewRow(row.rowId, { note: event.target.value })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="lede compact">{messages.imports.previewEmpty}</p>
          )}
        </div>
      </section>

      <section className="panel-subsection">
        <div className="section-head">
          <h3>{messages.imports.recentTitle}</h3>
          <span className="panel-context">{messages.imports.recentDetail}</span>
        </div>
        <div className="stack">
          {importsPage.recentImports.map((item) => (
            <div key={item.id} className="import-card">
              <div>
                <strong>{item.sourceLabel}</strong>
                <p>
                  {messages.common.triplet(
                    item.sourceType.toUpperCase(),
                    formatDate(item.importedAt),
                    messages.imports.transactionCount(item.transactionCount)
                  )}
                </p>
                <div className="pill-row dense">
                  {item.startDate && item.endDate ? (
                    <span className="pill">{messages.imports.importCoverage(formatDateOnly(item.startDate), formatDateOnly(item.endDate))}</span>
                  ) : null}
                  {item.overlapImportCount ? (
                    <span className="pill warning">{messages.imports.importOverlap(item.overlapImportCount)}</span>
                  ) : null}
                  {item.accountNames.map((name) => (
                    <span key={`${item.id}-${name}`} className="pill">{name}</span>
                  ))}
                </div>
              </div>
              <div className="import-meta">
                <span className={`pill ${item.status === "rolled_back" ? "warning" : "is-active"}`}>{item.status}</span>
                {item.note ? <p>{item.note}</p> : null}
                {item.status === "completed" ? (
                  <DeleteRowButton
                    label={item.sourceLabel}
                    destructive={false}
                    triggerLabel={messages.imports.rollback}
                    confirmLabel={messages.imports.rollbackConfirm}
                    prompt={<>{messages.imports.rollbackDetail(item.sourceLabel)}</>}
                    onConfirm={() => void handleRollback(item.id)}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

function SettingsPanel({ settingsPage, accounts, people, viewId, viewLabel, onRefresh }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emptyStateText, setEmptyStateText] = useState("");
  const [accountDialog, setAccountDialog] = useState(null);
  const [reconciliationDialog, setReconciliationDialog] = useState(null);
  const [transferReviewOpen, setTransferReviewOpen] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const visibleAccounts = useMemo(
    () => accounts.slice().sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name)),
    [accounts]
  );

  async function handleReseed() {
    setIsSubmitting(true);
    try {
      await fetch("/api/demo/reseed", { method: "POST" });
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefresh() {
    setIsSubmitting(true);
    try {
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEmptyState() {
    setIsSubmitting(true);
    try {
      await fetch("/api/demo/empty", { method: "POST" });
      await onRefresh();
      setEmptyStateText("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openCreateAccountDialog() {
    setAccountDialog({
      mode: "create",
      accountId: "",
      name: "",
      institution: "",
      kind: "bank",
      currency: "SGD",
      openingBalance: "0.00",
      ownerPersonId: "",
      isJoint: false
    });
  }

  function openEditAccountDialog(account) {
    setAccountDialog({
      mode: "edit",
      accountId: account.id,
      name: account.name,
      institution: account.institution,
      kind: account.kind,
      currency: account.currency,
      openingBalance: formatMinorInput(account.openingBalanceMinor ?? 0),
      ownerPersonId: account.ownerPersonId ?? "",
      isJoint: account.isJoint
    });
  }

  function openReconciliationDialog(account) {
    setReconciliationDialog({
      accountId: account.id,
      accountName: account.name,
      checkpointMonth: account.latestCheckpointMonth ?? "",
      statementBalance: formatMinorInput(account.latestCheckpointBalanceMinor ?? account.balanceMinor ?? 0),
      note: account.latestCheckpointNote ?? "",
      history: account.checkpointHistory ?? []
    });
  }

  async function handleSaveAccount() {
    if (!accountDialog) {
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint = accountDialog.mode === "create" ? "/api/accounts/create" : "/api/accounts/update";
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountDialog.accountId || undefined,
          name: accountDialog.name,
          institution: accountDialog.institution,
          kind: accountDialog.kind,
          currency: accountDialog.currency,
          openingBalanceMinor: parseDraftMoneyInput(accountDialog.openingBalance ?? "0"),
          ownerPersonId: accountDialog.isJoint ? null : (accountDialog.ownerPersonId || null),
          isJoint: accountDialog.isJoint
        })
      });
      setAccountDialog(null);
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleArchiveAccount(accountId) {
    setIsSubmitting(true);
    try {
      await fetch("/api/accounts/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId })
      });
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveReconciliation() {
    if (!reconciliationDialog?.accountId || !reconciliationDialog.checkpointMonth.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await fetch("/api/accounts/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: reconciliationDialog.accountId,
          checkpointMonth: reconciliationDialog.checkpointMonth,
          statementBalanceMinor: parseDraftMoneyInput(reconciliationDialog.statementBalance ?? "0"),
          note: reconciliationDialog.note
        })
      });
      setReconciliationDialog(null);
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  function openTransferReview(entryId) {
    const params = new URLSearchParams(searchParams);
    params.set("view", viewId);
    params.set("month", searchParams.get("month") ?? "2025-10");
    params.set("entry_type", "transfer");
    params.set("editing_entry", entryId);
    navigate({ pathname: "/entries", search: params.toString() });
  }

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.settings}</h2>
          <span className="panel-context">{messages.settings.viewing(viewLabel)}</span>
        </div>
      </div>

      <section className="settings-grid">
        <div className="metric">
          <span>{messages.settings.salaryPerPerson}</span>
          <strong>{money(settingsPage.demo.salaryPerPersonMinor)}</strong>
        </div>
        <div className="metric">
          <span>{messages.settings.salaryHousehold}</span>
          <strong>{money(settingsPage.demo.salaryPerPersonMinor * 2)}</strong>
        </div>
        <div className="metric">
          <span>{messages.settings.seededAt}</span>
          <strong>{formatDate(settingsPage.demo.lastSeededAt)}</strong>
        </div>
        <div className="metric">
          <span>{messages.settings.state}</span>
          <strong>{settingsPage.demo.emptyState ? messages.settings.emptyMode : messages.settings.seededMode}</strong>
        </div>
      </section>

      <section className="chart-card settings-card">
        <div className="chart-head">
          <h3>{messages.settings.demoTitle}</h3>
          <p>{messages.settings.demoDetail}</p>
        </div>
        <div className="settings-actions">
          <button type="button" className="subtle-action" onClick={handleReseed} disabled={isSubmitting}>
            {messages.settings.reseed}
          </button>
          <button type="button" className="subtle-action" onClick={handleRefresh} disabled={isSubmitting}>
            {messages.settings.refresh}
          </button>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <button type="button" className="subtle-action subtle-danger" disabled={isSubmitting}>
                {messages.settings.emptyState}
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="note-dialog-overlay" />
              <Dialog.Content className="note-dialog-content">
                <div className="note-dialog-head">
                  <Dialog.Title>{messages.settings.emptyState}</Dialog.Title>
                  <Dialog.Description>{messages.settings.emptyStateDetail}</Dialog.Description>
                </div>
                <input
                  className="table-edit-input"
                  placeholder={messages.settings.emptyStatePlaceholder}
                  value={emptyStateText}
                  onChange={(event) => setEmptyStateText(event.target.value)}
                />
                <div className="note-dialog-actions">
                  <Dialog.Close asChild>
                    <button type="button" className="subtle-action">Cancel</button>
                  </Dialog.Close>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="subtle-action subtle-danger"
                      disabled={emptyStateText.trim().toLowerCase() !== "empty state" || isSubmitting}
                      onClick={handleEmptyState}
                    >
                      {messages.settings.emptyStateConfirm}
                    </button>
                  </Dialog.Close>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
        <p className="lede compact">{messages.settings.refreshHint}</p>
      </section>

      <section className="chart-card settings-card">
        <div className="chart-head">
          <h3>{messages.settings.accountsTitle}</h3>
          <p>{messages.settings.accountsDetail}</p>
        </div>
        <div className="settings-actions">
          <button type="button" className="subtle-action" onClick={openCreateAccountDialog}>
            {messages.settings.addAccount}
          </button>
        </div>
        <p className="lede compact">{messages.settings.accountBalanceHint}</p>
        <div className="settings-account-list">
          {visibleAccounts.map((account) => (
            <div key={account.id} className={`settings-account-row ${!account.isActive ? "is-archived" : ""}`}>
              <div className="settings-account-main">
                <strong>{account.name}</strong>
                <p>{messages.common.triplet(account.institution, account.kind, account.ownerLabel)}</p>
                <p>{`Balance ${money(account.balanceMinor ?? 0)} • Opening ${money(account.openingBalanceMinor ?? 0)}`}</p>
                <p className={`settings-account-health ${account.reconciliationStatus ? `is-${account.reconciliationStatus}` : ""}`}>
                  {describeAccountHealth(account)}
                </p>
                <p className="settings-account-meta">
                  {account.latestImportAt
                    ? messages.settings.accountHealthLastImport(formatDate(account.latestImportAt))
                    : messages.settings.accountHealthNoImports}
                  {account.unresolvedTransferCount ? ` • ${messages.settings.accountHealthUnresolvedTransfers(account.unresolvedTransferCount)}` : ""}
                </p>
              </div>
              <div className="settings-account-actions">
                {!account.isActive ? <span className="account-badge">{messages.settings.archived}</span> : null}
                <button type="button" className="subtle-action" onClick={() => openReconciliationDialog(account)}>
                  {messages.settings.reconcileAccount}
                </button>
                <button type="button" className="icon-action" aria-label={messages.settings.editAccount} onClick={() => openEditAccountDialog(account)}>
                  <SquarePen size={16} />
                </button>
                {account.isActive ? (
                  <DeleteRowButton
                    label={account.name}
                    triggerLabel={messages.settings.archiveAccount}
                    confirmLabel={messages.settings.archiveAccount}
                    destructive={false}
                    prompt={messages.settings.archiveAccountDetail(account.name)}
                    onConfirm={() => handleArchiveAccount(account.id)}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="chart-card settings-card">
        <div className="chart-head">
          <h3>{messages.settings.trustRulesTitle}</h3>
          <p>{messages.settings.trustRulesDetail}</p>
        </div>
      </section>

      <section className="chart-card settings-card">
        <div className="chart-head">
          <h3>{messages.settings.unresolvedTransfersTitle}</h3>
          <p>{messages.settings.unresolvedTransfersDetail}</p>
        </div>
        <div className="settings-actions">
          <button type="button" className="subtle-action" onClick={() => setTransferReviewOpen(true)}>
            {messages.settings.reviewAllTransfers}
          </button>
        </div>
        <div className="settings-account-list">
          {settingsPage.unresolvedTransfers.length ? settingsPage.unresolvedTransfers.map((item) => (
            <div key={item.entryId} className="settings-account-row">
              <div className="settings-account-main">
                <strong>{item.description}</strong>
                <p>{messages.common.triplet(formatDateOnly(item.date), item.accountName, item.transferDirection === "in" ? "Transfer in" : "Transfer out")}</p>
                <p>{money(item.transferDirection === "out" ? -item.amountMinor : item.amountMinor)}</p>
              </div>
              <div className="settings-account-actions">
                <button type="button" className="subtle-action" onClick={() => openTransferReview(item.entryId)}>
                  {messages.settings.openTransferReview}
                </button>
              </div>
            </div>
          )) : (
            <p className="lede compact">{messages.common.emptyValue}</p>
          )}
        </div>
      </section>

      <section className="chart-card settings-card">
        <div className="chart-head">
          <h3>{messages.settings.recentActivityTitle}</h3>
          <p>{messages.settings.recentActivityDetail}</p>
        </div>
        <div className="settings-account-list">
          {settingsPage.recentAuditEvents.length ? settingsPage.recentAuditEvents.map((event) => (
            <div key={event.id} className="settings-account-row">
              <div className="settings-account-main">
                <strong>{formatAuditAction(event.action)}</strong>
                <p>{event.detail}</p>
                <p className="settings-account-meta">{formatDate(event.createdAt)}</p>
              </div>
            </div>
          )) : (
            <p className="lede compact">{messages.common.emptyValue}</p>
          )}
        </div>
      </section>

      <Dialog.Root open={Boolean(accountDialog)} onOpenChange={(open) => { if (!open) setAccountDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content settings-account-dialog">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{accountDialog?.mode === "create" ? messages.settings.createAccount : messages.settings.editAccount}</Dialog.Title>
                <Dialog.Description>{accountDialog?.mode === "create" ? messages.settings.createAccountDetail : messages.settings.editAccountDetail}</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close account dialog"
                onClick={() => setAccountDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="settings-account-form">
              <label className="table-edit-field">
                <span>{messages.settings.accountName}</span>
                <input
                  className="table-edit-input"
                  value={accountDialog?.name ?? ""}
                  onChange={(event) => setAccountDialog((current) => current ? { ...current, name: event.target.value } : current)}
                />
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.accountInstitution}</span>
                <input
                  className="table-edit-input"
                  value={accountDialog?.institution ?? ""}
                  onChange={(event) => setAccountDialog((current) => current ? { ...current, institution: event.target.value } : current)}
                />
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.accountType}</span>
                <select
                  className="table-edit-input"
                  value={accountDialog?.kind ?? "bank"}
                  onChange={(event) => setAccountDialog((current) => current ? { ...current, kind: event.target.value } : current)}
                >
                  {ACCOUNT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.accountCurrency}</span>
                <input
                  className="table-edit-input"
                  value={accountDialog?.currency ?? "SGD"}
                  onChange={(event) => setAccountDialog((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)}
                />
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.accountOpeningBalance}</span>
                <input
                  className="table-edit-input table-edit-input-money"
                  value={accountDialog?.openingBalance ?? "0.00"}
                  onChange={(event) => setAccountDialog((current) => current ? { ...current, openingBalance: event.target.value } : current)}
                />
                <small className="field-help">{messages.settings.accountOpeningBalanceHelp}</small>
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.accountOwner}</span>
                <select
                  className="table-edit-input"
                  value={accountDialog?.isJoint ? "shared" : (accountDialog?.ownerPersonId || "")}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAccountDialog((current) => current ? {
                      ...current,
                      isJoint: value === "shared",
                      ownerPersonId: value === "shared" ? "" : value
                    } : current);
                  }}
                >
                  <option value="shared">Shared</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setAccountDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="dialog-primary"
                disabled={!accountDialog?.name?.trim() || !accountDialog?.institution?.trim() || isSubmitting}
                onClick={() => void handleSaveAccount()}
              >
                {accountDialog?.mode === "create" ? messages.settings.createAccount : messages.settings.saveAccount}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(reconciliationDialog)} onOpenChange={(open) => { if (!open) setReconciliationDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content settings-account-dialog">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{messages.settings.reconcileAccountTitle}</Dialog.Title>
                <Dialog.Description>{messages.settings.reconcileAccountDetail}</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close reconciliation dialog"
                onClick={() => setReconciliationDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="settings-account-form">
              <label className="table-edit-field">
                <span>{messages.settings.accountName}</span>
                <input className="table-edit-input" value={reconciliationDialog?.accountName ?? ""} readOnly />
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.checkpointMonth}</span>
                <input
                  type="month"
                  className="table-edit-input"
                  value={reconciliationDialog?.checkpointMonth ?? ""}
                  onChange={(event) => setReconciliationDialog((current) => current ? { ...current, checkpointMonth: event.target.value } : current)}
                />
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.checkpointBalance}</span>
                <input
                  className="table-edit-input table-edit-input-money"
                  value={reconciliationDialog?.statementBalance ?? "0.00"}
                  onChange={(event) => setReconciliationDialog((current) => current ? { ...current, statementBalance: event.target.value } : current)}
                />
              </label>
              <label className="table-edit-field">
                <span>{messages.settings.checkpointNote}</span>
                <textarea
                  className="table-edit-input"
                  rows={4}
                  value={reconciliationDialog?.note ?? ""}
                  onChange={(event) => setReconciliationDialog((current) => current ? { ...current, note: event.target.value } : current)}
                />
                <small className="field-help">{messages.settings.checkpointHelp}</small>
              </label>
            </div>
            {reconciliationDialog?.history?.length ? (
              <section className="settings-account-history">
                <div className="panel-subhead">
                  <h3>{messages.settings.checkpointHistoryTitle}</h3>
                  <p>{messages.settings.checkpointHistoryDetail}</p>
                </div>
                <div className="settings-account-list">
                  {reconciliationDialog.history.map((item) => (
                    <div key={item.month} className="settings-account-row">
                      <div className="settings-account-main">
                        <strong>{formatMonthLabel(item.month)}</strong>
                        <p>{`Statement ${money(item.statementBalanceMinor)} • Ledger ${money(item.computedBalanceMinor)}`}</p>
                        <p className={`settings-account-health ${item.deltaMinor === 0 ? "is-matched" : "is-mismatch"}`}>
                          {item.deltaMinor === 0 ? "Matched" : `Delta ${money(Math.abs(item.deltaMinor))}`}
                        </p>
                        {item.note ? <p className="settings-account-meta">{item.note}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setReconciliationDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="dialog-primary"
                disabled={!reconciliationDialog?.checkpointMonth?.trim() || isSubmitting}
                onClick={() => void handleSaveReconciliation()}
              >
                {messages.settings.checkpointSave}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={transferReviewOpen} onOpenChange={setTransferReviewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content transfer-match-dialog">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{messages.settings.transferReviewTitle}</Dialog.Title>
                <Dialog.Description>{messages.settings.transferReviewDetail}</Dialog.Description>
              </div>
              <button type="button" className="icon-action subtle-cancel" aria-label="Close transfer review" onClick={() => setTransferReviewOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="settings-account-list">
              {settingsPage.unresolvedTransfers.length ? settingsPage.unresolvedTransfers.map((item) => (
                <div key={item.entryId} className="settings-account-row">
                  <div className="settings-account-main">
                    <strong>{item.description}</strong>
                    <p>{messages.common.triplet(formatDateOnly(item.date), item.accountName, item.transferDirection === "in" ? "Transfer in" : "Transfer out")}</p>
                    <p>{money(item.transferDirection === "out" ? -item.amountMinor : item.amountMinor)}</p>
                  </div>
                  <div className="settings-account-actions">
                    <button type="button" className="subtle-action" onClick={() => openTransferReview(item.entryId)}>
                      {messages.settings.openTransferReview}
                    </button>
                  </div>
                </div>
              )) : (
                <p className="lede compact">{messages.common.emptyValue}</p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}

function FaqPanel({ viewLabel }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.faq}</h2>
          <span className="panel-context">{messages.faq.viewing(viewLabel)}</span>
        </div>
      </div>
      <div className="faq-list">
        {messages.faq.items.map((item) => (
          <article key={item.question} className="faq-item">
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </article>
  );
}

function MetricCard({ card }) {
  const value = card.amountMinor == null ? card.value : money(card.amountMinor);
  return (
    <div className={`metric ${card.tone ? `metric-${card.tone}` : ""}`}>
      <span>{card.label}</span>
      <strong>{value}</strong>
      {card.detail ? <p>{card.detail}</p> : null}
    </div>
  );
}

function SortableHeader({ label, sort, columnKey, onSort, tableKey }) {
  const isActive = sort?.key === columnKey;
  const marker = !isActive ? "" : sort.direction === "asc" ? " ↑" : " ↓";

  return (
    <th>
      <button
        type="button"
        className={`table-sort-button ${isActive ? "is-active" : ""}`}
        onClick={() => onSort(tableKey, columnKey)}
      >
        {label}{marker}
      </button>
    </th>
  );
}

function BarLine({ label, valueMinor, maxMinor, tone }) {
  const percent = Math.max((valueMinor / Math.max(maxMinor, 1)) * 100, 6);
  return (
    <div className="plan-bar-line">
      <span>{label}</span>
      <div className="plan-bar-track">
        <span className={`plan-bar-fill ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <strong>{money(valueMinor)}</strong>
    </div>
  );
}

function getCategory(categories, item) {
  if (item.categoryId) {
    const byId = categories.find((category) => category.id === item.categoryId);
    if (byId) {
      return byId;
    }
  }

  if (item.categoryName) {
    const byName = categories.find((category) => category.name === item.categoryName);
    if (byName) {
      return byName;
    }
  }

  return categories.find((category) => category.name === item.label) ?? null;
}

function getCategorySelectValue(categories, item) {
  const category = getCategory(categories, item);
  return category?.id ?? item.categoryId ?? item.categoryName ?? "";
}

function getCategoryPatch(categories, value) {
  const category = categories.find((entry) => entry.id === value || entry.name === value);
  if (!category) {
    return {
      categoryId: null,
      categoryName: value
    };
  }

  return {
    categoryId: category.id,
    categoryName: category.name
  };
}

function getCategoryTheme(categories, item, index) {
  const category = getCategory(categories, item);
  if (category) {
    return {
      color: category.colorHex,
      iconKey: category.iconKey,
      categoryId: category.id
    };
  }

  const fallback = COLOR_OPTIONS[index % COLOR_OPTIONS.length];
  return {
    color: fallback,
    iconKey: FALLBACK_THEME.iconKey,
    categoryId: `fallback-${index}`
  };
}

function getIconComponent(iconKey) {
  return ICON_REGISTRY[iconKey] ?? Receipt;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortRows(rows, sort, monthKey = "2025-10") {
  if (!sort) {
    return rows;
  }

  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = getSortValue(left, sort.key, monthKey);
    const rightValue = getSortValue(right, sort.key, monthKey);

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * direction;
    }

    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
}

function getSortValue(row, key, monthKey) {
  switch (key) {
    case "variance":
      return row.plannedMinor - row.actualMinor;
    case "day":
      return getRowDateValue(row, monthKey);
    case "accountName":
      return row.accountName ?? "";
    case "note":
      return row.note ?? "";
    default:
      return row[key] ?? "";
  }
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferImportMapping(header) {
  const normalized = header.toLowerCase().trim();

  if (
    [
      "date",
      "transaction date",
      "posting date",
      "posted date",
      "value date"
    ].includes(normalized)
  ) {
    return "date";
  }

  if (
    [
      "description",
      "details",
      "narrative",
      "merchant",
      "memo"
    ].includes(normalized)
  ) {
    return "description";
  }

  if (["amount", "transaction amount", "amt", "value"].includes(normalized)) {
    return "amount";
  }

  if (["debit", "withdrawal", "outflow"].includes(normalized)) {
    return "amount";
  }

  if (["credit", "deposit", "inflow"].includes(normalized)) {
    return "amount";
  }

  if (["account", "wallet", "account name", "source account"].includes(normalized)) {
    return "account";
  }

  if (["category", "category name"].includes(normalized)) {
    return "category";
  }

  if (["note", "notes", "remarks"].includes(normalized)) {
    return "note";
  }

  if (["type", "transaction type", "entry type"].includes(normalized)) {
    return "type";
  }

  return "ignore";
}

function buildMappedImportRows(rows, columnMappings) {
  return rows
    .map((row) => {
      const mappedRow = {};

      for (const [header, target] of Object.entries(columnMappings)) {
        if (!target || target === "ignore") {
          continue;
        }

        const rawValue = row[header];
        if (rawValue == null || rawValue === "") {
          continue;
        }

        if (target === "amount") {
          mappedRow.amount = rawValue;
          continue;
        }

        mappedRow[target] = rawValue;
      }

      return mappedRow;
    })
    .filter((row) => Object.keys(row).length > 0);
}

function entryMatchesScope(entry, viewId, scope) {
  if (viewId === "household") {
    return scope === "shared" ? entry.ownershipType === "shared" : true;
  }

  const personId = viewId;
  if (scope === "shared") {
    return entry.ownershipType === "shared" && entry.splits.some((split) => split.personId === personId);
  }

  if (scope === "direct") {
    return entry.ownershipType === "direct" && entry.splits.some((split) => split.personId === personId);
  }

  return entry.splits.some((split) => split.personId === personId);
}

function getVisibleSplitIndex(entry, viewId) {
  if (entry.ownershipType !== "shared" || !entry.splits.length) {
    return -1;
  }

  if (viewId === "household") {
    return 0;
  }

  const matchingIndex = entry.splits.findIndex((split) => split.personId === viewId);
  return matchingIndex === -1 ? 0 : matchingIndex;
}

function getVisibleSplitPercent(entry, viewId) {
  if (entry.ownershipType !== "shared") {
    return null;
  }

  if (typeof entry.viewerSplitRatioBasisPoints === "number") {
    return entry.viewerSplitRatioBasisPoints / 100;
  }

  const splitIndex = getVisibleSplitIndex(entry, viewId);
  if (splitIndex === -1) {
    return null;
  }

  return entry.splits[splitIndex]?.ratioBasisPoints / 100;
}

function groupEntriesByDate(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const current = grouped.get(entry.date) ?? { date: entry.date, entries: [], netMinor: 0 };
    current.entries.push(entry);
    current.netMinor += getSignedAmountMinor(entry);
    grouped.set(entry.date, current);
  }

  return [...grouped.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function getSignedAmountMinor(entry) {
  if (entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")) {
    return entry.amountMinor;
  }

  if (entry.entryType === "transfer" && entry.transferDirection === "out") {
    return -entry.amountMinor;
  }

  return -entry.amountMinor;
}

function getSignedTotalAmountMinor(entry) {
  if (typeof entry.totalAmountMinor !== "number") {
    return null;
  }

  if (entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")) {
    return entry.totalAmountMinor;
  }

  return -entry.totalAmountMinor;
}

function getTransferWallets(entry) {
  if (entry.transferDirection === "in") {
    return {
      fromWalletName: entry.linkedTransfer?.accountName ?? "Unmatched",
      toWalletName: entry.accountName
    };
  }

  return {
    fromWalletName: entry.accountName,
    toWalletName: entry.linkedTransfer?.accountName ?? "Unmatched"
  };
}

function getTransferMatchCandidates(entry, entries) {
  const amountMinor = entry.totalAmountMinor ?? entry.amountMinor;

  return entries
    .filter((candidate) => {
      if (candidate.id === entry.id) {
        return false;
      }

      const candidateAmountMinor = candidate.totalAmountMinor ?? candidate.amountMinor;
      if (candidateAmountMinor !== amountMinor) {
        return false;
      }

      if (candidate.accountName === entry.accountName) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftOpposite = left.transferDirection && entry.transferDirection
        ? left.transferDirection !== entry.transferDirection
        : false;
      const rightOpposite = right.transferDirection && entry.transferDirection
        ? right.transferDirection !== entry.transferDirection
        : false;
      if (leftOpposite !== rightOpposite) {
        return leftOpposite ? -1 : 1;
      }

      const leftGap = Math.abs(daysBetween(entry.date, left.date));
      const rightGap = Math.abs(daysBetween(entry.date, right.date));
      if (leftGap !== rightGap) {
        return leftGap - rightGap;
      }

      return left.accountName.localeCompare(right.accountName);
    })
    .slice(0, 5);
}

function daysBetween(left, right) {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function getAmountToneClass(amountMinor) {
  if (amountMinor > 0) {
    return "positive";
  }
  if (amountMinor < 0) {
    return "negative";
  }
  return "";
}

function formatDateOnly(value) {
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function describeAccountHealth(account) {
  if (account.reconciliationStatus === "matched" && account.latestCheckpointMonth) {
    return messages.settings.accountHealthMatched(formatMonthLabel(account.latestCheckpointMonth));
  }

  if (account.reconciliationStatus === "mismatch" && account.latestCheckpointMonth) {
    return messages.settings.accountHealthMismatch(
      formatMonthLabel(account.latestCheckpointMonth),
      money(Math.abs(account.latestCheckpointDeltaMinor ?? 0))
    );
  }

  return messages.settings.accountHealthNeedsCheckpoint;
}

function formatAuditAction(action) {
  return action
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function money(valueMinor) {
  return moneyFormatter.format(valueMinor / 100);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMonthLabel(value) {
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    year: "numeric"
  }).format(new Date(Number(year), Number(month) - 1, 1));
}

function formatMinorInput(valueMinor) {
  return (valueMinor / 100).toFixed(2);
}

function parseMoneyInput(value, fallback) {
  const normalized = Number(value.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(normalized)) {
    return fallback;
  }

  return Math.round(normalized * 100);
}

function parseDraftMoneyInput(value) {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100);
}

function getRowDateValue(row, fallbackMonth) {
  if (!row.dayLabel) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(row.dayLabel)) {
    return row.dayLabel;
  }

  if (/^\d+$/.test(row.dayLabel)) {
    return `${fallbackMonth}-${String(Number(row.dayLabel)).padStart(2, "0")}`;
  }

  return "";
}

function formatRowDateLabel(row, fallbackMonth) {
  const value = getRowDateValue(row, fallbackMonth);
  if (!value) {
    return messages.common.emptyValue;
  }

  const [year, month, day] = value.split("-");
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    day: "numeric"
  }).format(new Date(Number(year), Number(month) - 1, Number(day)));
}

function buildBootstrapErrorMessage(status, detail) {
  const normalizedDetail = String(detail ?? "").replace(/\s+/g, " ").trim();
  if (!normalizedDetail) {
    return `Bootstrap request failed with status ${status}.`;
  }

  return `Bootstrap request failed with status ${status}. ${normalizedDetail.slice(0, 240)}`;
}

function describeBootstrapError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The dashboard could not load bootstrap data.";
}
