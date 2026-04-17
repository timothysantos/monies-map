import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  useSearchParams
} from "react-router-dom";
import { slugify } from "./category-utils";
import { messages } from "./copy/en-SG";
import { EntriesPanel } from "./entries-panel";
import { FaqPanel } from "./faq-panel";
import { ImportsPanel } from "./imports-panel";
import { MonthPanel } from "./month-panel";
import {
  buildBootstrapErrorMessage,
  describeBootstrapError
} from "./request-errors";
import { SettingsPanel } from "./settings-panel";
import { SplitsPanel } from "./splits-panel";
import { SummaryPanel } from "./summary-panel";
import { formatMonthLabel } from "./formatters";
import { getCurrentMonthKey } from "../lib/month";

const SUMMARY_FOCUS_OVERALL = "overall";
const BOOTSTRAP_SYNC_CHANNEL = "monies-map-bootstrap-sync";
const BOOTSTRAP_SYNC_STORAGE_KEY = "monies-map-bootstrap-sync";
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

export function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapLoadCount, setBootstrapLoadCount] = useState(0);
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [rangePickerStartYear, setRangePickerStartYear] = useState(null);
  const [rangePickerEndYear, setRangePickerEndYear] = useState(null);
  const [monthPickerYear, setMonthPickerYear] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const syncChannelRef = useRef(null);
  const selectedMonth = searchParams.get("month") ?? DEFAULT_MONTH_KEY;
  const selectedScope = searchParams.get("scope") ?? "direct_plus_shared";
  const selectedSummaryStart = searchParams.get("summary_start") ?? undefined;
  const selectedSummaryEnd = searchParams.get("summary_end") ?? undefined;
  const isBootstrapLoading = bootstrapLoadCount > 0;

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
    const response = await fetch(`/api/bootstrap?${params.toString()}`, {
      signal,
      cache: "no-store"
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

    setBootstrapError("");
    setBootstrap(data);
    return data;
  }, [selectedMonth, selectedScope, selectedSummaryEnd, selectedSummaryStart]);

  const handleBootstrapFailure = useCallback((error) => {
    setBootstrap(null);
    setBootstrapError(describeBootstrapError(error));
  }, []);

  const refreshBootstrap = useCallback(async ({ broadcast = false } = {}) => {
    const finishBootstrapLoad = beginBootstrapLoad();

    try {
      const data = await loadBootstrap();

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
  }, [beginBootstrapLoad, loadBootstrap]);

  useEffect(() => {
    const controller = new AbortController();
    const finishBootstrapLoad = beginBootstrapLoad();

    void loadBootstrap(controller.signal)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        handleBootstrapFailure(error);
      })
      .finally(finishBootstrapLoad);

    return () => {
      controller.abort();
    };
  }, [beginBootstrapLoad, handleBootstrapFailure, loadBootstrap]);

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
          const finishBootstrapLoad = beginBootstrapLoad();
          void loadBootstrap()
            .catch(handleBootstrapFailure)
            .finally(finishBootstrapLoad);
        }
      };
    }

    const handleStorage = (event) => {
      if (event.key === BOOTSTRAP_SYNC_STORAGE_KEY && event.newValue) {
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
  }, [beginBootstrapLoad, handleBootstrapFailure, loadBootstrap]);

  const selectedViewId = searchParams.get("view") ?? "household";
  const selectedTabId = routeTabs.find((tab) => tab.path === location.pathname)?.id ?? "summary";

  const view = useMemo(
    () => bootstrap?.views.find((item) => item.id === selectedViewId) ?? null,
    [bootstrap, selectedViewId]
  );
  const selectedEntriesScope = searchParams.get("entries_scope") ?? view?.monthPage.selectedScope ?? "direct_plus_shared";
  const householdMonthEntries = useMemo(
    () => bootstrap?.views.find((item) => item.id === "household")?.monthPage.entries ?? [],
    [bootstrap]
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
    if (isDetailMonthTab || !view?.summaryPage.availableMonths.length) {
      return;
    }

    const summaryMonths = view.summaryPage.availableMonths;
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
  }, [isDetailMonthTab, selectedSummaryEnd, selectedSummaryStart, setSearchParams, view]);

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
        <AppLoadingPanel />
      </main>
    );
  }

  const periodMode = isDetailMonthTab ? messages.period.month : messages.period.year;
  const periodLabel = isDetailMonthTab
    ? formatMonthLabel(view.monthPage.month)
    : `${formatMonthLabel(view.summaryPage.rangeStartMonth)} - ${formatMonthLabel(view.summaryPage.rangeEndMonth)}`;
  const pendingCategorySuggestionCount = bootstrap.settingsPage?.categoryMatchRuleSuggestions?.length ?? 0;
  const buildTabTarget = (tab) => {
    const params = new URLSearchParams(searchParams);
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
        selectedKey: view.monthPage.selectedScope,
        paramKey: "scope",
        label: "Month view scope"
      }
    : selectedTabId === "entries"
      ? {
          selectedKey: selectedEntriesScope,
          paramKey: "entries_scope",
          label: "Entries view scope"
        }
      : null;
  const mobileScopeLabels = {
    direct: "Direct",
    shared: "Shared",
    direct_plus_shared: "Direct+Shared"
  };

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
            <button className="period-button" type="button" aria-label={messages.period.nextAriaLabel} onClick={() => handleMonthChange(1)} disabled={isSplitsTab}>›</button>
          </div>
        </div>
      </section>

      {stickyScopeConfig && view.monthPage.scopes.length > 1 ? (
        <section className="mobile-scope-sticky-wrap" aria-label={stickyScopeConfig.label}>
          <div className="scope-toggle pill-row scope-toggle-row mobile-scope-sticky">
            {view.monthPage.scopes.map((scope) => (
              <button
                key={scope.key}
                className={`pill scope-button ${scope.key === stickyScopeConfig.selectedKey ? "is-active" : ""}`}
                type="button"
                onClick={() => {
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set(stickyScopeConfig.paramKey, scope.key);
                    return next;
                  });
                }}
              >
                {mobileScopeLabels[scope.key] ?? scope.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid app-route-grid" aria-busy={isBootstrapLoading ? "true" : "false"}>
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
                householdMonthEntries={householdMonthEntries}
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
                accounts={bootstrap.accounts}
                categories={categories}
                people={bootstrap.household.people}
                onCategoryAppearanceChange={handleCategoryAppearanceChange}
                onRefresh={() => refreshBootstrap({ broadcast: true })}
              />
            )}
          />
          <Route
            path="/splits"
            element={(
              <SplitsPanel
                view={view}
                categories={categories}
                people={bootstrap.household.people}
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
                categories={categories}
                people={bootstrap.household.people}
                viewId={view.id}
                viewLabel={view.label}
                onRefresh={() => refreshBootstrap({ broadcast: true })}
              />
            )}
          />
          <Route path="/faq" element={<FaqPanel viewLabel={view.label} categories={categories} />} />
          <Route path="*" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
        </Routes>
        {isBootstrapLoading ? <AppLoadingOverlay /> : null}
      </section>

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

      {selectedTabId === "splits" && typeof document !== "undefined"
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

function AppLoadingPanel() {
  return (
    <section className="panel app-loading-panel" role="status" aria-live="polite">
      <span className="app-spinner" aria-hidden="true" />
      <p>{messages.common.loading}</p>
    </section>
  );
}

function AppLoadingOverlay() {
  return (
    <div className="app-loading-overlay" role="status" aria-live="polite">
      <span className="app-spinner" aria-hidden="true" />
      <span>{messages.common.loadingLatest}</span>
    </div>
  );
}
