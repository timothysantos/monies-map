import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Receipt,
  SquarePen,
  Ellipsis,
  Plus,
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
import {
  CategoryAppearancePopover,
  SpendingMixChart
} from "./category-visuals";
import {
  describeAccountHealth,
  formatAccountDisplayName
} from "./account-display";
import {
  getCategory,
  getCategoryPatch,
  getCategorySelectValue,
  getCategoryTheme,
  slugify
} from "./category-utils";
import { messages } from "./copy/en-SG";
import {
  applySharedSplit,
  buildEntryDraft,
  entryMatchesScope,
  getAmountToneClass,
  getSignedAmountMinor,
  getSignedTotalAmountMinor,
  getTransferMatchCandidates,
  getTransferWallets,
  getVisibleSplitIndex,
  getVisibleSplitPercent,
  groupEntriesByDate,
  normalizeEntryShape,
  uniqueValues
} from "./entry-helpers";
import { FaqPanel } from "./faq-panel";
import { ImportsPanel } from "./imports-panel";
import {
  buildPlanLinkCandidates,
  buildMonthMetricCards,
  getDefaultMonthSectionOpen,
  getMonthSectionTotals,
  getPlanRowById,
  getVisibleMonthAccounts
} from "./month-helpers";
import {
  buildBootstrapErrorMessage,
  describeBootstrapError
} from "./request-errors";
import { SettingsPanel } from "./settings-panel";
import { SplitsPanel } from "./splits-panel";
import { SummaryPanel } from "./summary-panel";
import {
  BarLine,
  CategoryGlyph,
  DeleteRowButton,
  FilterSelect,
  MetricCard,
  SortableHeader
} from "./ui-components";
import {
  formatRowDateLabel,
  getRowDateValue,
  sortRows
} from "./table-helpers";
import {
  formatDateOnly,
  formatEditableMinorInput,
  formatMinorInput,
  formatMonthLabel,
  money,
  parseDraftMoneyInput,
  parseMoneyInput
} from "./formatters";
import { getCurrentMonthKey } from "../lib/month";

const SUMMARY_FOCUS_OVERALL = "overall";
const BOOTSTRAP_SYNC_CHANNEL = "monies-map-bootstrap-sync";
const BOOTSTRAP_SYNC_STORAGE_KEY = "monies-map-bootstrap-sync";
const MONTH_PICKER_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_MONTH_KEY = getCurrentMonthKey();
const MONTH_SECTION_STATE_CACHE = new Map();

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

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
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
                to={{ pathname: tab.path, search: searchParams.toString() ? `?${searchParams.toString()}` : "" }}
              >
                {tab.label}
              </NavLink>
            ))}
            {secondaryRouteTabs.map((tab) => (
              <NavLink
                key={tab.id}
                className={({ isActive }) => `tab tab-secondary ${isActive ? "is-active" : ""}`}
                to={{ pathname: tab.path, search: searchParams.toString() ? `?${searchParams.toString()}` : "" }}
              >
                {tab.label}
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
                        to={{ pathname: tab.path, search: searchParams.toString() ? `?${searchParams.toString()}` : "" }}
                      >
                        {tab.label}
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

function MonthPanel({ view, accounts, people, categories, householdMonthEntries, onCategoryAppearanceChange, onRefresh }) {
  const navigate = useNavigate();
  const monthUiKey = `${view.id}:${view.monthPage.month}:${view.monthPage.selectedScope}`;
  const [planSections, setPlanSections] = useState(view.monthPage.planSections);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [editingDrafts, setEditingDrafts] = useState({});
  const [incomeRows, setIncomeRows] = useState([]);
  const [sectionOpen, setSectionOpen] = useState(() => MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? getDefaultMonthSectionOpen());
  const [noteDialog, setNoteDialog] = useState(null);
  const [planLinkDialog, setPlanLinkDialog] = useState(null);
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
    setPlanLinkDialog(null);
    setMonthNoteDialog(null);
    setTableSorts({
      income: null,
      planned_items: null,
      budget_buckets: null
    });
    setIncomeRows(view.monthPage.incomeRows);
  }, [view]);

  useEffect(() => {
    setSectionOpen(MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? getDefaultMonthSectionOpen());
  }, [monthUiKey]);

  const currentMonthSummary = useMemo(
    () => view.summaryPage.months.find((month) => month.month === view.monthPage.month) ?? null,
    [view]
  );

  const monthMetricCards = useMemo(
    () => buildMonthMetricCards({ planSections, incomeRows, currentMonthSummary }),
    [currentMonthSummary, incomeRows, planSections]
  );
  const visibleAccounts = useMemo(
    () => getVisibleMonthAccounts(accounts, view.id),
    [accounts, view.id]
  );

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
      MONTH_SECTION_STATE_CACHE.set(monthUiKey, next);
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
      MONTH_SECTION_STATE_CACHE.set(monthUiKey, next);
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

  async function openPlanLinkDialog(row) {
    if (editingSnapshot?.rowId === row.id) {
      await finishEdit();
    }

    setPlanLinkDialog({
      rowId: row.id,
      draftEntryIds: row.linkedEntryIds ?? []
    });
  }

  async function savePlanLinkDialog() {
    if (!planLinkDialog) {
      return;
    }

    await fetch("/api/month-plan/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId: planLinkDialog.rowId,
        month: view.monthPage.month,
        transactionIds: planLinkDialog.draftEntryIds
      })
    });

    setPlanLinkDialog(null);
    await onRefresh();
  }

  const monthKey = view.monthPage.month;
  function toggleSection(sectionKey) {
    setSectionOpen((current) => {
      const next = {
        ...current,
        [sectionKey]: !current[sectionKey]
      };
      MONTH_SECTION_STATE_CACHE.set(monthUiKey, next);
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
            <div className="scope-toggle pill-row scope-toggle-row desktop-scope-toggle">
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
          <div className="month-plan-summary">
            <div className="panel-subhead month-plan-header-bar">
              <button
                type="button"
                className="month-plan-summary-toggle"
                aria-expanded={sectionOpen.income}
                onClick={() => toggleSection("income")}
              >
                <div className="month-section-head month-section-head-inline month-section-head-with-toggle">
                  <span className={`month-section-toggle ${sectionOpen.income ? "is-open" : ""}`} aria-hidden="true">
                    <ChevronRight size={16} />
                  </span>
                  <h3>{messages.month.incomeSectionTitle}</h3>
                  <p className="month-section-detail-inline">{messages.month.incomeSectionDetail}</p>
                </div>
              </button>
              <div className="month-summary-actions">
                {!isCombinedHouseholdView ? (
                  <button
                    type="button"
                    className="subtle-action"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleAddIncomeRow();
                    }}
                  >
                    {messages.month.addIncomeSource}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
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
                  const totals = getMonthSectionTotals(incomeRows);
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
            <div className="month-plan-summary">
              <div className="panel-subhead month-plan-header-bar">
                <button
                  type="button"
                  className="month-plan-summary-toggle"
                  aria-expanded={sectionOpen[section.key]}
                  onClick={() => toggleSection(section.key)}
                >
                  <div className="month-section-head month-section-head-with-toggle">
                    <span className={`month-section-toggle ${sectionOpen[section.key] ? "is-open" : ""}`} aria-hidden="true">
                      <ChevronRight size={16} />
                    </span>
                    <h3>{section.label}</h3>
                    <p>{section.description}</p>
                  </div>
                </button>
                <div className="month-summary-actions">
                  {!isCombinedHouseholdView ? (
                    <button
                      type="button"
                      className="subtle-action"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleAddPlanRow(section.key);
                      }}
                    >
                      {section.key === "planned_items" ? messages.month.addPlannedItem : messages.month.addBudgetBucket}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
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
                        <td>
                          {section.key === "planned_items" ? (
                            <button
                              type="button"
                              className="planned-link-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (canEditRow) {
                                  void openPlanLinkDialog(row);
                                }
                              }}
                              disabled={!canEditRow}
                            >
                              <strong>{money(row.actualMinor)}</strong>
                              <span>{row.linkedEntryCount ? `${row.linkedEntryCount} linked` : "Link entries"}</span>
                            </button>
                          ) : money(row.actualMinor)}
                        </td>
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
                    const totals = getMonthSectionTotals(section.rows);
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
          <div className="summary-account-pills">
            {visibleAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={`summary-account-pill ${account.reconciliationStatus ? `is-${account.reconciliationStatus}` : ""}`}
                onClick={() => handleOpenEntriesForAccount(account)}
              >
                <span className="summary-account-pill-name">{formatAccountDisplayName(account)}</span>
                <span className="summary-account-pill-amount">{money(account.balanceMinor ?? 0)}</span>
                <span className="summary-account-pill-meta">{describeAccountHealth(account)}</span>
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

      <Dialog.Root open={Boolean(planLinkDialog)} onOpenChange={(open) => { if (!open) setPlanLinkDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content planned-link-dialog">
            {(() => {
              const row = planLinkDialog ? getPlanRowById(planSections, planLinkDialog.rowId) : null;
              const candidates = buildPlanLinkCandidates({
                row,
                householdMonthEntries,
                monthEntries: view.monthPage.entries,
                monthKey: view.monthPage.month
              });
              const selectedIds = new Set(planLinkDialog?.draftEntryIds ?? []);
              return (
                <>
                  <div className="note-dialog-head">
                    <div>
                      <Dialog.Title>Match planned item</Dialog.Title>
                      <Dialog.Description>
                        Link exact ledger entries to {row?.label ?? "this planned item"}. Budget buckets still use category totals.
                      </Dialog.Description>
                    </div>
                    <button
                      type="button"
                      className="icon-action subtle-cancel"
                      aria-label="Close planned item matching"
                      onClick={() => setPlanLinkDialog(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {candidates.length ? (
                    <div className="planned-link-list">
                      {candidates.map((entry) => (
                        <label key={entry.id} className="planned-link-row">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.id)}
                            onChange={(event) => {
                              setPlanLinkDialog((current) => {
                                if (!current) {
                                  return current;
                                }
                                const nextIds = new Set(current.draftEntryIds);
                                if (event.target.checked) {
                                  nextIds.add(entry.id);
                                } else {
                                  nextIds.delete(entry.id);
                                }
                                return {
                                  ...current,
                                  draftEntryIds: [...nextIds]
                                };
                              });
                            }}
                          />
                          <span className="planned-link-row-main">
                            <strong>{entry.description}</strong>
                            <small>{formatDateOnly(entry.date)} • {entry.accountName} • {entry.categoryName}</small>
                            {entry.matchReasons?.length ? <em>{entry.matchReasons.slice(0, 3).join(" · ")}</em> : null}
                          </span>
                          <span>{money(entry.amountMinor)}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-copy">No expense entries are available in the selected month.</p>
                  )}
                  <div className="note-dialog-actions">
                    <button type="button" className="subtle-cancel" onClick={() => setPlanLinkDialog(null)}>
                      {messages.month.cancelEdit}
                    </button>
                    <button type="button" className="dialog-primary" onClick={() => void savePlanLinkDialog()}>
                      Save matches
                    </button>
                  </div>
                </>
              );
            })()}
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

function EntriesPanel({ view, accounts, categories, people, onCategoryAppearanceChange, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState(view.monthPage.entries);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [showEntryComposer, setShowEntryComposer] = useState(false);
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [entryDraft, setEntryDraft] = useState(() => buildEntryDraft(view, accounts, categories, people));
  const [entrySubmitError, setEntrySubmitError] = useState("");
  const [linkingTransferEntryId, setLinkingTransferEntryId] = useState(null);
  const [settlingTransferEntryId, setSettlingTransferEntryId] = useState(null);
  const [transferSettlementDrafts, setTransferSettlementDrafts] = useState({});
  const [transferDialogEntryId, setTransferDialogEntryId] = useState(null);
  const [addingToSplitsEntryId, setAddingToSplitsEntryId] = useState(null);
  const selectedScope = searchParams.get("entries_scope") ?? view.monthPage.selectedScope;
  const defaultEntryPerson = view.id !== "household" ? view.label : "";
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
    setShowEntryComposer(false);
    setShowExpenseBreakdown(false);
    setShowMobileFilters(false);
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
    setEntrySubmitError("");
    setLinkingTransferEntryId(null);
    setSettlingTransferEntryId(null);
    setTransferSettlementDrafts({});
    setTransferDialogEntryId(null);
    setAddingToSplitsEntryId(null);
  }, [view, accounts, categories, people]);

  const wallets = useMemo(() => uniqueValues(entries.map((entry) => entry.accountName)), [entries]);
  const entryCategoryOptions = useMemo(() => uniqueValues(entries.map((entry) => entry.categoryName)), [entries]);
  const categoryOptions = useMemo(
    () => categories
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
      .map((category) => category.name),
    [categories]
  );
  const accountOptions = useMemo(
    () => accounts
      .filter((account) => account.isActive !== false)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((account) => account.name),
    [accounts]
  );
  const peopleFilterOptions = useMemo(
    () => uniqueValues(entries.flatMap((entry) => entry.ownershipType === "shared" ? ["Shared"] : [entry.ownerName ?? ""])),
    [entries]
  );
  const activeEntryFilterCount = useMemo(
    () => ["wallet", "category", "person", "type"].reduce((count, key) => count + (entryFilters[key] ? 1 : 0), 0),
    [entryFilters]
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
    } else if (entry.entryType === "transfer" && entry.transferDirection === "out") {
      totals.transferOutMinor += entry.amountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "in") {
      totals.transferInMinor += entry.amountMinor;
    }

    return totals;
  }, { incomeMinor: 0, spendMinor: 0, transferInMinor: 0, transferOutMinor: 0 }), [filteredEntries]);
  const entryOutflowMinor = entryTotals.spendMinor + entryTotals.transferOutMinor;
  const entryNetMinor = entryTotals.incomeMinor - entryTotals.spendMinor;
  const expenseBreakdown = useMemo(() => {
    const grouped = new Map();
    for (const entry of filteredEntries) {
      if (entry.entryType !== "expense") {
        continue;
      }
      const key = entry.categoryName;
      const current = grouped.get(key) ?? {
        key,
        label: key,
        categoryName: key,
        valueMinor: 0,
        entryCount: 0
      };
      current.valueMinor += entry.amountMinor;
      current.entryCount += 1;
      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.valueMinor - left.valueMinor);
  }, [filteredEntries]);

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

  function openEntryComposer() {
    if (showEntryComposer) {
      closeEntryComposer();
      return;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
    setEntrySubmitError("");
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
    setShowEntryComposer(true);
  }

  function closeEntryComposer() {
    setShowEntryComposer(false);
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
    setEntrySubmitError("");
  }

  function updateEntryDraft(patch) {
    setEntryDraft((current) => normalizeEntryShape({ ...current, ...patch }, people));
  }

  async function saveEntryDraft() {
    setEntrySubmitError("");
    const primarySplit = entryDraft.ownershipType === "shared" ? entryDraft.splits[0] : undefined;
    const response = await fetch("/api/entries/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        date: entryDraft.date,
        description: entryDraft.description,
        accountName: entryDraft.accountName,
        categoryName: entryDraft.categoryName,
        amountMinor: entryDraft.amountMinor,
        entryType: entryDraft.entryType,
        transferDirection: entryDraft.transferDirection,
        ownershipType: entryDraft.ownershipType,
        ownerName: entryDraft.ownerName,
        note: entryDraft.note ?? "",
        splitBasisPoints: primarySplit?.ratioBasisPoints
      })
    });

    const data = await response.json();
    if (!response.ok) {
      setEntrySubmitError(data.error ?? "Failed to create entry.");
      return;
    }

    closeEntryComposer();
    await onRefresh();
  }

  function beginEntryEdit(entry) {
    if (editingEntryId === entry.id) {
      cancelEntryEdit();
      return;
    }

    setShowEntryComposer(false);
    setEntrySubmitError("");
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
        amountMinor: currentEntry.amountMinor,
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

  async function addEntryToSplits(entry) {
    setEntrySubmitError("");
    setAddingToSplitsEntryId(entry.id);

    try {
      const response = await fetch("/api/splits/expenses/from-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: entry.id,
          splitGroupId: null
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setEntrySubmitError(data.error ?? "Failed to add entry to splits.");
        return;
      }

      setEditingEntryId(null);
      setEntrySnapshot(null);
      await onRefresh();
    } finally {
      setAddingToSplitsEntryId(null);
    }
  }

  function updateEntry(entryId, patch) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      return normalizeEntryShape({ ...entry, ...patch }, people, entry);
    }));
  }

  function updateEntrySplit(entryId, percentage) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId || entry.ownershipType !== "shared" || entry.splits.length < 2) {
        return entry;
      }

      const nextSplits = applySharedSplit(entry, people, percentage, view.id);
      const primaryIndex = getVisibleSplitIndex(entry, view.id);
      const totalAmountMinor = entry.totalAmountMinor ?? entry.amountMinor;

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
        <div className="scope-toggle pill-row scope-toggle-row desktop-scope-toggle">
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

      <section className="entries-totals-strip" aria-label={messages.entries.totalsLabel}>
        <button
          type="button"
          className={`entries-breakdown-toggle ${showExpenseBreakdown ? "is-open" : ""}`}
          onClick={() => setShowExpenseBreakdown((current) => !current)}
          aria-expanded={showExpenseBreakdown}
          aria-label={showExpenseBreakdown ? "Hide expense breakdown" : "Show expense breakdown"}
        >
          {showExpenseBreakdown ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
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
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalOutflow}</span>
          <strong className={getAmountToneClass(-entryOutflowMinor)}>{money(entryOutflowMinor)}</strong>
        </span>
        <div className="entries-totals-spacer" />
        <button type="button" className="subtle-action is-primary entries-add-inline" onClick={openEntryComposer}>
          {messages.entries.addEntry}
        </button>
      </section>

      <button
        type="button"
        data-entries-fab-trigger="true"
        className="entries-fab-trigger"
        onClick={openEntryComposer}
        aria-hidden="true"
        tabIndex={-1}
      />

      {showExpenseBreakdown ? (
        <section className="entries-breakdown-panel">
          <div className="entries-breakdown-chart">
            {expenseBreakdown.length ? (
              <SpendingMixChart
                data={expenseBreakdown}
                categories={categories}
                totalLabel={messages.entries.totalSpend}
                compact
                height={300}
                innerRadius={58}
                outerRadius={96}
              />
            ) : (
              <p className="lede compact">{messages.entries.noSpendBreakdown}</p>
            )}
          </div>
          <div className="entries-breakdown-list category-list">
            {expenseBreakdown.map((item, index) => {
              const theme = getCategoryTheme(categories, item, index);
              return (
                <div key={item.key} className="category-row">
                  <div className="category-key">
                    <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                      <CategoryGlyph iconKey={theme.iconKey} />
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{money(item.valueMinor)} • {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={`entries-filter-stack ${showMobileFilters ? "is-open" : ""}`}>
        <button type="button" className="entries-filter-toggle" onClick={() => setShowMobileFilters((current) => !current)}>
          <span>{activeEntryFilterCount ? `Filters · ${activeEntryFilterCount}` : "Filters"}</span>
          <span>{showMobileFilters ? "Hide" : "Show"}</span>
        </button>
        <section className="entries-filter-bar">
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
            options={entryCategoryOptions}
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
          <div className="entries-filter-reset">
            <button type="button" className="subtle-action" onClick={resetEntryFilters}>
              {messages.entries.resetFilters}
            </button>
          </div>
        </section>
      </section>

      {showEntryComposer ? (
        <section className="entry-row is-editing entry-composer">
          <div className="entry-inline-editor">
            <div className="entry-edit-grid">
              <label>
                <span>{messages.entries.editDate}</span>
                <input
                  className="table-edit-input"
                  type="date"
                  value={entryDraft.date}
                  onChange={(event) => updateEntryDraft({ date: event.target.value })}
                />
              </label>
              <label>
                <span>{messages.entries.editType}</span>
                <select
                  className="table-edit-input"
                  value={entryDraft.entryType}
                  onChange={(event) => updateEntryDraft({ entryType: event.target.value })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>
              <label>
                <span>{messages.entries.editAmount}</span>
                <input
                  className="table-edit-input table-edit-input-money"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={formatEditableMinorInput(entryDraft.amountMinor)}
                  onChange={(event) => updateEntryDraft({ amountMinor: Math.max(0, parseMoneyInput(event.target.value, entryDraft.amountMinor)) })}
                />
              </label>
              <label>
                <span>{messages.entries.editCategory}</span>
                <div className="entry-category-field">
                  <span
                    className="category-icon category-icon-static"
                    style={{ "--category-color": getCategoryTheme(categories, { categoryName: entryDraft.categoryName }, 0).color }}
                  >
                    <CategoryGlyph iconKey={getCategoryTheme(categories, { categoryName: entryDraft.categoryName }, 0).iconKey} />
                  </span>
                  <select
                    className="table-edit-input"
                    value={entryDraft.categoryName}
                    onChange={(event) => updateEntryDraft({ categoryName: event.target.value })}
                  >
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label>
                <span>{messages.entries.editWallet}</span>
                <select
                  className="table-edit-input"
                  value={entryDraft.accountName}
                  onChange={(event) => updateEntryDraft({ accountName: event.target.value })}
                >
                  {accountOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{messages.entries.editOwner}</span>
                <select
                  className="table-edit-input"
                  value={entryDraft.ownershipType === "shared" ? "Shared" : (entryDraft.ownerName ?? "")}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (nextValue === "Shared") {
                      updateEntryDraft({ ownershipType: "shared", ownerName: undefined });
                    } else {
                      updateEntryDraft({ ownershipType: "direct", ownerName: nextValue });
                    }
                  }}
                >
                  {ownerOptions.map((person) => (
                    <option key={person} value={person}>{person}</option>
                  ))}
                </select>
              </label>
              {entryDraft.entryType === "transfer" ? (
                <label>
                  <span>{messages.entries.editTransferDirection}</span>
                  <select
                    className="table-edit-input"
                    value={entryDraft.transferDirection ?? "out"}
                    onChange={(event) => updateEntryDraft({ transferDirection: event.target.value })}
                  >
                    <option value="out">Transfer out</option>
                    <option value="in">Transfer in</option>
                  </select>
                </label>
              ) : null}
              {entryDraft.ownershipType === "shared" ? (
                <label>
                  <span>{messages.entries.editSplit}</span>
                  <input
                    className="table-edit-input table-edit-input-money"
                    type="number"
                    min="0"
                    max="100"
                    value={getVisibleSplitPercent(entryDraft, view.id) ?? 50}
                    onChange={(event) => {
                      const percentage = Number(event.target.value);
                      updateEntryDraft({
                        splits: applySharedSplit(entryDraft, people, percentage),
                        viewerSplitRatioBasisPoints: view.id === "household" ? undefined : Math.round(percentage * 100)
                      });
                    }}
                  />
                </label>
              ) : null}
            </div>
            <div className="entry-writing-grid">
              <label>
                <span>{messages.entries.editDescription}</span>
                <textarea
                  className="table-edit-input table-edit-textarea"
                  value={entryDraft.description}
                  onChange={(event) => updateEntryDraft({ description: event.target.value })}
                  rows={3}
                />
              </label>
              <label>
                <span>{messages.entries.editNote}</span>
                <textarea
                  className="table-edit-input table-edit-textarea"
                  value={entryDraft.note ?? ""}
                  onChange={(event) => updateEntryDraft({ note: event.target.value })}
                  rows={3}
                />
              </label>
            </div>
            {entrySubmitError ? <p className="entry-submit-error">{entrySubmitError}</p> : null}
            <div className="entry-inline-actions">
              <button type="button" className="icon-action" aria-label="Create entry" onClick={() => void saveEntryDraft()}>
                <Check size={16} />
              </button>
              <button type="button" className="icon-action subtle-cancel" aria-label="Cancel new entry" onClick={closeEntryComposer}>
                <X size={16} />
              </button>
            </div>
          </div>
        </section>
      ) : null}

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
                        <div className="entry-row-amount">
                          <strong className={getAmountToneClass(signedAmountMinor)}>{money(signedAmountMinor)}</strong>
                          {hasWeightedTotal ? <p>({money(signedTotalAmountMinor)} total)</p> : null}
                        </div>
                        <div className="entry-pills">
                          {transferLabel ? <span className="entry-chip entry-chip-transfer">{transferLabel}</span> : null}
                          <span className={`entry-chip ${entry.ownershipType === "shared" ? "entry-chip-shared" : "entry-chip-owner"}`}>{ownerLabel}</span>
                          {entry.ownershipType === "shared" && splitPercent != null ? (
                            <span className="entry-chip entry-chip-split">{splitPercent}%</span>
                          ) : null}
                        </div>
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
                            <span>{messages.entries.editType}</span>
                            <select
                              className="table-edit-input"
                              value={entry.entryType}
                              onChange={(event) => updateEntry(entry.id, { entryType: event.target.value })}
                            >
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                              <option value="transfer">Transfer</option>
                            </select>
                          </label>
                          <label>
                            <span>{messages.entries.editAmount}</span>
                            <input
                              className="table-edit-input table-edit-input-money"
                              type="number"
                              step="0.01"
                              inputMode="decimal"
                              value={formatEditableMinorInput(entry.amountMinor)}
                              onChange={(event) => updateEntry(entry.id, { amountMinor: Math.max(0, parseMoneyInput(event.target.value, entry.amountMinor)) })}
                            />
                          </label>
                          <label>
                            <span>{messages.entries.editCategory}</span>
                            {entry.entryType === "transfer" ? (
                              <div className="entry-category-field">
                                <span
                                  className="category-icon category-icon-static"
                                  style={{ "--category-color": getCategoryTheme(categories, { categoryName: "Transfer" }, 0).color }}
                                >
                                  <CategoryGlyph iconKey={getCategoryTheme(categories, { categoryName: "Transfer" }, 0).iconKey} />
                                </span>
                                <input
                                  className="table-edit-input"
                                  value="Transfer"
                                  readOnly
                                />
                              </div>
                            ) : (
                              <div className="entry-category-field">
                                <span
                                  className="category-icon category-icon-static"
                                  style={{ "--category-color": getCategoryTheme(categories, { categoryName: entry.categoryName }, 0).color }}
                                >
                                  <CategoryGlyph iconKey={getCategoryTheme(categories, { categoryName: entry.categoryName }, 0).iconKey} />
                                </span>
                                <select
                                  className="table-edit-input"
                                  value={entry.categoryName}
                                  onChange={(event) => updateEntry(entry.id, { categoryName: event.target.value })}
                                >
                                  {categoryOptions.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </label>
                          <label>
                            <span>{messages.entries.editWallet}</span>
                            <select
                              className="table-edit-input"
                              value={entry.accountName}
                              onChange={(event) => updateEntry(entry.id, { accountName: event.target.value })}
                            >
                              {accountOptions.map((option) => (
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
                            <label>
                              <span>{messages.entries.editTransferDirection}</span>
                              <select
                                className="table-edit-input"
                                value={entry.transferDirection ?? "out"}
                                onChange={(event) => updateEntry(entry.id, { transferDirection: event.target.value })}
                              >
                                <option value="out">Transfer out</option>
                                <option value="in">Transfer in</option>
                              </select>
                            </label>
                          ) : null}
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
                          {entry.entryType === "expense" ? (
                            <button
                              type="button"
                              className="subtle-action"
                              disabled={addingToSplitsEntryId === entry.id}
                              onClick={() => void addEntryToSplits(entry)}
                            >
                              {messages.entries.addToSplits}
                            </button>
                          ) : null}
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
