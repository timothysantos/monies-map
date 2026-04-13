import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowRightLeft,
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
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import {
  describeAccountHealth,
  formatAccountDisplayName,
  formatAuditAction
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
  daysBetween,
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
  normalizeMatchText,
  textOverlapScore,
  uniqueValues
} from "./entry-helpers";
import { FaqPanel } from "./faq-panel";
import {
  ImportRecentHistorySection,
  RECENT_IMPORTS_PAGE_SIZE
} from "./import-history";
import {
  buildMappedImportRows,
  buildRawImportRowFromPreviewRow,
  extractPdfText,
  getImportDirectOwnerForAccount,
  inferImportMapping,
  selectParsedStatementForCompare
} from "./import-helpers";
import {
  buildBootstrapErrorMessage,
  buildRequestErrorMessage,
  describeBootstrapError
} from "./request-errors";
import { SettingsAccountDialog, SettingsCategoryDialog, SettingsPersonDialog, SettingsReconciliationDialog } from "./settings-dialogs";
import {
  BarLine,
  CategoryGlyph,
  DeleteRowButton,
  FilterSelect,
  getIconComponent,
  MetricCard,
  SortableHeader
} from "./ui-components";
import {
  formatArchiveDate,
  getArchivedBatchSummary,
  groupSplitActivityByBatch,
  groupSplitActivityByDate
} from "./split-helpers";
import {
  formatRowDateLabel,
  getRowDateValue,
  sortRows
} from "./table-helpers";
import {
  buildCheckpointExportHref,
  decimalStringToMinor,
  formatCheckpointCoverage,
  formatCheckpointHistoryBalanceLine,
  formatCheckpointStatementInputMinor,
  formatDate,
  formatDateOnly,
  formatEditableMinorInput,
  formatMinorInput,
  formatMonthLabel,
  formatStatementCompareRow,
  formatStatementReconciliationLine,
  getContentDispositionFilename,
  minorToDecimalString,
  money,
  parseDraftMoneyInput,
  parseMoneyInput
} from "./formatters";
import { COLOR_OPTIONS, ICON_OPTIONS } from "./ui-options";
import { inspectCsv } from "../lib/csv";
import { getCurrentMonthKey } from "../lib/month";
import { parseCurrentTransactionSpreadsheet, parseStatementText, statementRowsToCsv } from "../lib/statement-import";

const SUMMARY_FOCUS_OVERALL = "overall";
const BOOTSTRAP_SYNC_CHANNEL = "monies-map-bootstrap-sync";
const BOOTSTRAP_SYNC_STORAGE_KEY = "monies-map-bootstrap-sync";
const MONTH_PICKER_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_MONTH_KEY = getCurrentMonthKey();
const MONTH_SECTION_STATE_CACHE = new Map();

const IMPORT_FIELD_OPTIONS = [
  { value: "ignore", label: "Don't import" },
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "expense", label: "Expense amount" },
  { value: "income", label: "Income amount" },
  { value: "account", label: "Account" },
  { value: "category", label: "Category" },
  { value: "note", label: "Note" },
  { value: "type", label: "Type" }
];

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
                        <p>{money(item.valueMinor)}</p>
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
                      <div className="plan-row-title">
                        <span className="plan-row-disclosure" aria-hidden="true">
                          <ChevronRight size={18} />
                        </span>
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
                <span className="summary-account-pill-name">{formatAccountDisplayName(account)}</span>
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

function SpendingMixChart({
  data,
  categories,
  totalLabel = messages.summary.totalSpend,
  compact = false,
  height = 360,
  innerRadius = 70,
  outerRadius = 120
}) {
  const total = data.reduce((sum, item) => sum + item.valueMinor, 0);
  const isNarrowViewport = typeof window !== "undefined" && window.innerWidth <= 760;
  const resolvedHeight = isNarrowViewport ? Math.min(height, compact ? 250 : 280) : height;
  const resolvedInnerRadius = isNarrowViewport ? Math.min(innerRadius, compact ? 54 : 62) : innerRadius;
  const resolvedOuterRadius = isNarrowViewport ? Math.min(outerRadius, compact ? 84 : 98) : outerRadius;
  const chartData = data.map((item, index) => ({
    ...item,
    ...getCategoryTheme(categories, item, index)
  }));

  return (
    <div className={`spending-mix-chart-shell ${compact ? "is-compact" : ""}`}>
      <div className={`spending-mix-chart ${compact ? "is-compact" : ""}`}>
        <ResponsiveContainer width="100%" height={resolvedHeight}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="valueMinor"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={resolvedInnerRadius}
              outerRadius={resolvedOuterRadius}
              paddingAngle={0}
              isAnimationActive={false}
              labelLine={false}
              label={(props) => renderPieCallout(props, total, { compact: isNarrowViewport })}
            >
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className={`donut-center recharts-donut-center ${compact ? "is-compact" : ""}`}>
          <span>{totalLabel}</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
    </div>
  );
}

function renderPieCallout(props, total, options = {}) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props;
  const { compact = false } = options;
  if (!percent) {
    return null;
  }

  if (compact && percent < 0.03) {
    return null;
  }

  const radians = (Math.PI / 180) * -midAngle;
  const stemOffset = compact ? 4 : 6;
  const midOffset = compact ? 10 : 22;
  const badgeOffset = compact ? 20 : 46;
  const textOffset = compact ? 18 : 34;
  const badgeSize = compact ? 28 : 44;
  const iconSize = compact ? 12 : 18;
  const fontSize = compact ? 10 : 15;
  const sx = cx + Math.cos(radians) * (outerRadius + stemOffset);
  const sy = cy + Math.sin(radians) * (outerRadius + stemOffset);
  const mx = cx + Math.cos(radians) * (outerRadius + midOffset);
  const my = cy + Math.sin(radians) * (outerRadius + midOffset);
  const bx = cx + Math.cos(radians) * (outerRadius + badgeOffset);
  const by = cy + Math.sin(radians) * (outerRadius + badgeOffset);
  const isRight = Math.cos(radians) >= 0;
  const tx = bx + (isRight ? textOffset : -textOffset);
  const percentage = ((payload.valueMinor / total) * 100).toFixed(1);
  const Icon = getIconComponent(payload.iconKey);

  return (
    <g>
      <path d={`M${sx},${sy} L${mx},${my} L${bx},${by}`} stroke={payload.color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.82" />
      <foreignObject x={bx - (badgeSize / 2)} y={by - (badgeSize / 2)} width={badgeSize} height={badgeSize}>
        <div className="donut-callout-badge" style={{ "--category-color": payload.color, "--callout-size": `${badgeSize}px` }}>
          <Icon size={iconSize} strokeWidth={2.2} />
        </div>
      </foreignObject>
      <text x={tx} y={by + 1} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" fill={payload.color} fontSize={fontSize} fontWeight="700">
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

function MonthPanel({ view, accounts, people, categories, householdMonthEntries, onCategoryAppearanceChange, onRefresh }) {
  const navigate = useNavigate();
  const defaultSectionOpen = useCallback(() => ({
    income: false,
    planned_items: true,
    budget_buckets: true
  }), []);
  const monthUiKey = `${view.id}:${view.monthPage.month}:${view.monthPage.selectedScope}`;
  const [planSections, setPlanSections] = useState(view.monthPage.planSections);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [editingDrafts, setEditingDrafts] = useState({});
  const [incomeRows, setIncomeRows] = useState([]);
  const [sectionOpen, setSectionOpen] = useState(() => MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? defaultSectionOpen());
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
  }, [view, defaultSectionOpen]);

  useEffect(() => {
    setSectionOpen(MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? defaultSectionOpen());
  }, [monthUiKey, defaultSectionOpen]);

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

  function getSectionTotals(rows) {
    const plannedMinor = rows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const actualMinor = rows.reduce((sum, row) => sum + row.actualMinor, 0);
    return {
      plannedMinor,
      actualMinor,
      varianceMinor: plannedMinor - actualMinor
    };
  }

  function getPlanRowById(rowId) {
    return planSections.flatMap((section) => section.rows).find((row) => row.id === rowId);
  }

  function getPlanLinkCandidates(row) {
    if (!row) {
      return [];
    }

    const linkedIds = new Set(row.linkedEntryIds ?? []);
    const rowCategory = normalizeMatchText(row.categoryName);
    const rowAccount = normalizeMatchText(row.accountName);
    const rowLabel = normalizeMatchText(row.label);
    const rowDate = getRowDateValue(row, view.monthPage.month);
    const rowAmount = Number(row.plannedMinor ?? 0);
    const hints = row.planMatchHints ?? [];
    const uniqueEntries = new Map();

    for (const entry of [...(householdMonthEntries ?? []), ...view.monthPage.entries]) {
      if (entry.entryType === "expense") {
        uniqueEntries.set(entry.id, entry);
      }
    }

    return [...uniqueEntries.values()]
      .map((entry) => {
        const entryCategory = normalizeMatchText(entry.categoryName);
        const entryAccount = normalizeMatchText(entry.accountName);
        const entryDescription = normalizeMatchText(entry.description);
        const reasons = [];
        let score = 0;

        if (linkedIds.has(entry.id)) {
          score += 1000;
          reasons.push("linked");
        }

        if (rowCategory && entryCategory === rowCategory) {
          score += 45;
          reasons.push("same category");
        }

        if (rowAccount && entryAccount === rowAccount) {
          score += 25;
          reasons.push("same account");
        }

        if (rowAmount > 0 && entry.amountMinor > 0) {
          const amountGap = Math.abs(rowAmount - entry.amountMinor);
          if (amountGap === 0) {
            score += 40;
            reasons.push("same amount");
          } else if (amountGap <= Math.max(100, Math.round(rowAmount * 0.08))) {
            score += 24;
            reasons.push("near amount");
          }
        }

        if (rowLabel && textOverlapScore(rowLabel, entryDescription) >= 0.5) {
          score += 35;
          reasons.push("description looks similar");
        }

        for (const hint of hints) {
          const hintPattern = normalizeMatchText(hint.descriptionPattern);
          if (hintPattern && entryDescription.includes(hintPattern)) {
            score += 120;
            reasons.push("remembered description");
          }
          if (typeof hint.amountMinor === "number" && hint.amountMinor === entry.amountMinor) {
            score += 24;
            reasons.push("remembered amount");
          }
          if (hint.accountName && normalizeMatchText(hint.accountName) === entryAccount) {
            score += 14;
          }
        }

        if (rowDate) {
          const dateGap = Math.abs(daysBetween(entry.date, rowDate));
          if (dateGap <= 3) {
            score += 18;
            reasons.push("near planned date");
          } else if (dateGap <= 10) {
            score += 8;
          }
        }

        return {
          ...entry,
          matchScore: score,
          matchReasons: [...new Set(reasons.filter((reason) => reason !== "linked"))]
        };
      })
      .filter((entry) => linkedIds.has(entry.id) || entry.matchScore > 0 || !hints.length)
      .sort((left, right) => right.matchScore - left.matchScore || right.date.localeCompare(left.date) || left.description.localeCompare(right.description))
      .slice(0, 80);
  }

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
              const row = planLinkDialog ? getPlanRowById(planLinkDialog.rowId) : null;
              const candidates = getPlanLinkCandidates(row);
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

function SplitsPanel({ view, categories, people, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [expenseDialog, setExpenseDialog] = useState(null);
  const [settlementDialog, setSettlementDialog] = useState(null);
  const [linkedEntryDialog, setLinkedEntryDialog] = useState(null);
  const [formError, setFormError] = useState("");
  const [dismissedMatchIds, setDismissedMatchIds] = useState([]);
  const groups = view.splitsPage.groups;
  const groupOptions = useMemo(
    () => [{ id: "split-group-none", name: messages.splits.nonGroup }, ...groups.filter((group) => group.id !== "split-group-none")],
    [groups]
  );
  const defaultGroupId = groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const selectedGroupId = searchParams.get("split_group") ?? defaultGroupId;
  const selectedMode = searchParams.get("split_mode") ?? "entries";
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const visibleActivity = view.splitsPage.activity.filter((item) => item.groupId === (activeGroup?.id ?? "split-group-none"));
  const currentActivity = useMemo(
    () => visibleActivity.filter((item) => !item.isArchived),
    [visibleActivity]
  );
  const archivedActivity = useMemo(
    () => visibleActivity.filter((item) => item.isArchived),
    [visibleActivity]
  );
  const groupedCurrentActivity = useMemo(() => groupSplitActivityByDate(currentActivity), [currentActivity]);
  const archivedBatches = useMemo(() => groupSplitActivityByBatch(archivedActivity), [archivedActivity]);
  const selectedArchivedBatch = archiveDialog?.batchId
    ? archivedBatches.find((batch) => batch.batchId === archiveDialog.batchId) ?? null
    : null;
  const visibleMatches = view.splitsPage.matches.filter((item) => (
    item.groupId === (activeGroup?.id ?? "split-group-none") && !dismissedMatchIds.includes(item.id)
  ));
  const pendingMatchCount = view.splitsPage.matches.filter((item) => !dismissedMatchIds.includes(item.id)).length;
  const expenseMatchCount = view.splitsPage.matches.filter((item) => item.kind === "expense" && !dismissedMatchIds.includes(item.id)).length;
  const settlementMatchCount = view.splitsPage.matches.filter((item) => item.kind === "settlement" && !dismissedMatchIds.includes(item.id)).length;
  const groupBalanceMinor = activeGroup?.balanceMinor ?? 0;
  const groupSummaryLabel = groupBalanceMinor === 0
    ? messages.splits.settledUp
    : groupBalanceMinor > 0
      ? messages.splits.youAreOwed
      : messages.splits.youOwe;
  const totalExpenseMinor = currentActivity
    .filter((item) => item.kind === "expense")
    .reduce((sum, item) => sum + item.totalAmountMinor, 0);
  const linkedEntriesById = useMemo(
    () => new Map(view.monthPage.entries.map((entry) => [entry.id, entry])),
    [view.monthPage.entries]
  );
  const donutRows = useMemo(
    () => view.splitsPage.donutChart.map((item, index) => ({
      ...item,
      theme: getCategoryTheme(categories, { categoryName: item.label }, index)
    })),
    [categories, view.splitsPage.donutChart]
  );
  const categoryOptions = categories
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    .map((category) => category.name);

  useEffect(() => {
    setDismissedMatchIds([]);
    setShowBreakdown(false);
    setFormError("");
    setLinkedEntryDialog(null);
    setArchiveDialog(null);
  }, [view.id, view.splitsPage.month]);

  function updateSplitView(patch) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (patch.groupId) {
        next.set("split_group", patch.groupId);
      }
      if (patch.mode) {
        next.set("split_mode", patch.mode);
      }
      return next;
    });
  }

  function renderActivityGroups(groupsToRender, archived = false) {
    return groupsToRender.map((group) => (
      <section key={`${archived ? "archived" : "current"}-${group.date}`} className={`split-date-group ${archived ? "is-archived" : ""}`}>
        <header className="split-date-header">
          <strong>{formatDateOnly(group.date)}</strong>
          <span>{group.items.length} {messages.splits.entries}</span>
        </header>
        <div className="split-date-items">
          {group.items.map((item, index) => {
            const theme = getCategoryTheme(categories, { categoryName: item.categoryName ?? "Other" }, index);
            return (
              <article key={item.id} className="split-activity-card">
                <div className="split-activity-leading">
                  <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                    <CategoryGlyph iconKey={theme.iconKey} />
                  </span>
                </div>
                <div className="split-activity-copy">
                  <strong>{item.description}</strong>
                  <p>{item.kind === "expense" ? `${item.paidByPersonName} paid ${money(item.totalAmountMinor)}` : `${item.fromPersonName} paid ${item.toPersonName}`}</p>
                  {item.note ? <span className="share-row-meta">{item.note}</span> : null}
                  <div className="split-card-actions">
                    <button type="button" className="subtle-action" onClick={() => (item.kind === "expense" ? openExpenseEditor(item) : openSettlementEditor(item))}>
                      {messages.splits.editSplit}
                    </button>
                    {item.linkedTransactionId ? (
                      <button type="button" className="subtle-action" onClick={() => openLinkedEntryEditor(item)}>
                        {messages.splits.editLinkedEntry}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="split-activity-trailing">
                  <strong className={item.viewerDirectionLabel.includes("borrowed") || item.viewerDirectionLabel.includes("owe") ? "tone-negative" : "tone-positive"}>
                    {item.viewerDirectionLabel}
                  </strong>
                  <span>{money(item.viewerAmountMinor ?? item.totalAmountMinor)}</span>
                  <span className="share-row-meta">{item.matched ? messages.splits.linked : messages.splits.manual}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    ));
  }

  function openArchiveList() {
    setArchiveDialog({ batchId: null });
  }

  function openArchivedBatch(batchId) {
    setArchiveDialog({ batchId });
  }

  async function saveGroup() {
    if (!groupDialog?.name?.trim()) {
      setFormError("Group name is required.");
      return;
    }

    setFormError("");
    const response = await fetch("/api/splits/groups/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: groupDialog.name })
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to create split group.");
      return;
    }

    setGroupDialog(null);
    await onRefresh();
    updateSplitView({ groupId: data.groupId, mode: "entries" });
  }

  async function saveExpense() {
    if (!expenseDialog?.description?.trim() || !expenseDialog.date || !expenseDialog.payerPersonName || !expenseDialog.categoryName) {
      setFormError("Expense description, date, payer, and category are required.");
      return;
    }

    setFormError("");
    const isEditing = Boolean(expenseDialog?.id);
    const response = await fetch(isEditing ? "/api/splits/expenses/update" : "/api/splits/expenses/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        splitExpenseId: expenseDialog.id,
        groupId: expenseDialog.groupId === "split-group-none" ? null : expenseDialog.groupId,
        date: expenseDialog.date,
        description: expenseDialog.description,
        categoryName: expenseDialog.categoryName,
        payerPersonName: expenseDialog.payerPersonName,
        amountMinor: Number(expenseDialog.amountMinor ?? 0),
        note: expenseDialog.note,
        splitBasisPoints: Number(expenseDialog.splitBasisPoints ?? 5000)
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to create split expense.");
      return;
    }

    setExpenseDialog(null);
    await onRefresh();
  }

  async function saveSettlement() {
    if (!settlementDialog?.date || !settlementDialog.fromPersonName || !settlementDialog.toPersonName) {
      setFormError("Settlement date and both people are required.");
      return;
    }

    setFormError("");
    const isEditing = Boolean(settlementDialog?.id);
    const response = await fetch(isEditing ? "/api/splits/settlements/update" : "/api/splits/settlements/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settlementId: settlementDialog.id,
        groupId: settlementDialog.groupId === "split-group-none" ? null : settlementDialog.groupId,
        date: settlementDialog.date,
        fromPersonName: settlementDialog.fromPersonName,
        toPersonName: settlementDialog.toPersonName,
        amountMinor: Number(settlementDialog.amountMinor ?? 0),
        note: settlementDialog.note
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to create settlement.");
      return;
    }

    setSettlementDialog(null);
    await onRefresh();
  }

  async function confirmMatch(match) {
    const endpoint = match.kind === "expense" ? "/api/splits/matches/link-expense" : "/api/splits/matches/link-settlement";
    const body = match.kind === "expense"
      ? { splitExpenseId: match.splitRecordId, transactionId: match.transactionId }
      : { settlementId: match.splitRecordId, transactionId: match.transactionId };
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    await onRefresh();
  }

  function openExpenseEditor(item) {
    const splitPercent = item.totalAmountMinor
      ? Math.round(((item.viewerAmountMinor ?? item.totalAmountMinor / 2) / item.totalAmountMinor) * 100)
      : 50;
    setFormError("");
    setExpenseDialog({
      id: item.id,
      groupId: item.groupId,
      date: item.date,
      description: item.description,
      categoryName: item.categoryName ?? (categoryOptions[0] ?? "Other"),
      payerPersonName: item.paidByPersonName ?? people[0]?.name ?? "",
      amountMinor: item.totalAmountMinor,
      note: item.note ?? "",
      splitBasisPoints: splitPercent * 100
    });
  }

  function openSettlementEditor(item) {
    setFormError("");
    setSettlementDialog({
      id: item.id,
      groupId: item.groupId,
      date: item.date,
      fromPersonName: item.fromPersonName ?? people[1]?.name ?? "",
      toPersonName: item.toPersonName ?? people[0]?.name ?? "",
      amountMinor: item.totalAmountMinor,
      note: item.note ?? ""
    });
  }

  function openLinkedEntryEditor(item) {
    const entry = item.linkedTransactionId ? linkedEntriesById.get(item.linkedTransactionId) : null;
    if (!entry) {
      return;
    }

    setFormError("");
    setLinkedEntryDialog({
      entryId: entry.id,
      date: entry.date,
      description: entry.description,
      accountName: entry.accountName,
      categoryName: entry.categoryName,
      amountMinor: entry.totalAmountMinor ?? entry.amountMinor,
      entryType: entry.entryType,
      transferDirection: entry.transferDirection,
      ownershipType: entry.ownershipType,
      ownerName: entry.ownerName ?? "",
      note: entry.note ?? "",
      splitBasisPoints: entry.viewerSplitRatioBasisPoints ?? entry.splits[0]?.ratioBasisPoints ?? 5000
    });
  }

  async function saveLinkedEntry() {
    if (!linkedEntryDialog?.entryId || !linkedEntryDialog.date || !linkedEntryDialog.description || !linkedEntryDialog.accountName || !linkedEntryDialog.categoryName) {
      setFormError("Linked entry is missing required fields.");
      return;
    }

    setFormError("");
    const response = await fetch("/api/entries/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(linkedEntryDialog)
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to update linked entry.");
      return;
    }

    setLinkedEntryDialog(null);
    await onRefresh();
  }

  function openNewExpenseDialog() {
    setFormError("");
    setExpenseDialog({
      groupId: activeGroup?.id ?? "split-group-none",
      date: new Date().toISOString().slice(0, 10),
      description: "",
      categoryName: categoryOptions[0] ?? "Other",
      payerPersonName: (view.id !== "household"
        ? people.find((person) => person.id === view.id)?.name
        : people[0]?.name) ?? "",
      amountMinor: 0,
      note: "",
      splitBasisPoints: 5000
    });
  }

  return (
    <article className="panel panel-accent panel-splits">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.splits}</h2>
          <p className="panel-context">{messages.splits.viewing(view.label)}</p>
        </div>
        {selectedMode !== "matches" ? (
          <button
            type="button"
            className="subtle-action split-settle-header"
            onClick={() => {
              setFormError("");
              setSettlementDialog({
                groupId: activeGroup?.id ?? "split-group-none",
                date: new Date().toISOString().slice(0, 10),
                fromPersonName: people[1]?.name ?? "",
                toPersonName: people[0]?.name ?? "",
                amountMinor: Math.abs(groupBalanceMinor),
                note: ""
              });
            }}
            disabled={!activeGroup || groupBalanceMinor === 0}
          >
            {messages.splits.settleUp}
          </button>
        ) : null}
      </div>

      <section className="splits-groups-row">
        <div className="splits-group-pills">
          {groups.map((group) => {
            const Icon = getIconComponent(group.iconKey);
            return (
              <button
                key={group.id}
                type="button"
                className={`split-group-pill ${group.id === activeGroup?.id && selectedMode !== "matches" ? "is-active" : ""}`}
                onClick={() => updateSplitView({ groupId: group.id, mode: "entries" })}
              >
                <span className="split-group-pill-icon"><Icon size={18} strokeWidth={2.1} /></span>
                <span className="split-group-pill-content">
                  <strong>{group.name}</strong>
                  <span>{group.summaryText}</span>
                  <span>{group.entryCount} {messages.splits.entries}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={`split-group-pill split-matches-pill ${selectedMode === "matches" ? "is-active" : ""}`}
            onClick={() => updateSplitView({ groupId: activeGroup?.id ?? defaultGroupId, mode: "matches" })}
          >
            <span className="split-group-pill-content">
              <strong>{messages.splits.matches}</strong>
              <span>{pendingMatchCount ? messages.splits.toReview(pendingMatchCount) : messages.splits.allClear}</span>
              <span>{expenseMatchCount} expense, {settlementMatchCount} settle-up</span>
            </span>
          </button>
          <button
            type="button"
            className="split-group-pill split-group-pill-create"
            onClick={() => {
              setFormError("");
              setGroupDialog({ name: "" });
            }}
            aria-label={messages.splits.createGroup}
          >
            <strong>{messages.splits.addGroup}</strong>
          </button>
        </div>
      </section>

      <section className="entries-summary-strip splits-summary-strip">
        <button
          type="button"
          className={`summary-chevron ${showBreakdown ? "is-open" : ""}`}
          aria-label="Toggle split donut"
          onClick={() => setShowBreakdown((current) => !current)}
        >
          <ChevronRight size={18} />
        </button>
        <div className="entries-summary-metrics">
          <span>{messages.entries.totalSpend} <strong>{money(totalExpenseMinor)}</strong></span>
          <span>{groupSummaryLabel} <strong className={groupBalanceMinor >= 0 ? "tone-positive" : "tone-negative"}>{money(Math.abs(groupBalanceMinor))}</strong></span>
        </div>
        <div className="splits-summary-actions">
          <button
            type="button"
            className="subtle-action"
            onClick={openNewExpenseDialog}
          >
            {messages.splits.addExpense}
          </button>
        </div>
      </section>

      {showBreakdown ? (
        <section className="split-donut-panel">
          {donutRows.length ? (
            <div className="entries-breakdown-panel split-breakdown-panel">
              <div className="entries-breakdown-chart">
                <SpendingMixChart
                  data={view.splitsPage.donutChart}
                  categories={categories}
                  totalLabel={messages.entries.totalSpend}
                  compact
                  height={300}
                  innerRadius={58}
                  outerRadius={96}
                />
              </div>
              <div className="entries-breakdown-list category-list">
                {donutRows.map((item) => (
                  <div key={item.key} className="category-row">
                    <div className="category-key">
                      <span className="category-icon category-icon-static" style={{ "--category-color": item.theme.color }}>
                        <CategoryGlyph iconKey={item.theme.iconKey} />
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{messages.common.triplet(money(item.valueMinor), `${item.entryCount} ${item.entryCount === 1 ? "entry" : "entries"}`, `${((item.valueMinor / Math.max(totalExpenseMinor, 1)) * 100).toFixed(1)}%`)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="lede compact">{messages.splits.noEntries}</p>
          )}
        </section>
      ) : null}

      {selectedMode === "matches" ? (
        <section className="split-list-section">
          <div className="panel-subhead">
            <div>
              <h2>{messages.splits.matches}</h2>
              <p className="lede compact">{pendingMatchCount ? messages.splits.toReview(pendingMatchCount) : messages.splits.noMatches}</p>
            </div>
          </div>
          <div className="split-match-list">
            {visibleMatches.length ? visibleMatches.map((match) => (
              <div key={match.id} className="split-match-card">
                <div>
                  <strong>{match.reviewLabel}</strong>
                  <p>{messages.common.triplet(formatDate(match.transactionDate), money(match.amountMinor), match.confidenceLabel)}</p>
                  <p>{match.transactionDescription}</p>
                </div>
                <div className="split-match-actions">
                  <button type="button" className="subtle-action" onClick={() => setDismissedMatchIds((current) => [...current, match.id])}>
                    {messages.splits.keepSeparate}
                  </button>
                  <button type="button" className="dialog-primary" onClick={() => void confirmMatch(match)}>
                    {messages.splits.match}
                  </button>
                </div>
              </div>
            )) : (
              <p className="lede compact">{messages.splits.noMatches}</p>
            )}
          </div>
        </section>
      ) : (
        <section className="split-list-section">
          <button
            type="button"
            data-splits-fab-trigger="true"
            className="entries-fab-trigger"
            onClick={openNewExpenseDialog}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="split-activity-list">
            {groupedCurrentActivity.length ? renderActivityGroups(groupedCurrentActivity) : null}
            {!groupedCurrentActivity.length && !archivedBatches.length ? <p className="lede compact">{messages.splits.noEntries}</p> : null}
            <button
              type="button"
              className={`split-archive-trigger ${archivedBatches.length ? "" : "is-empty"}`}
              onClick={archivedBatches.length ? openArchiveList : undefined}
              disabled={!archivedBatches.length}
            >
              <span>Archived batches</span>
              <small>
                {archivedBatches.length
                  ? `${archivedBatches.length} settled ${archivedBatches.length === 1 ? "batch" : "batches"}`
                  : "No settled batches yet"}
              </small>
            </button>
          </div>
        </section>
      )}

      <Dialog.Root open={Boolean(archiveDialog)} onOpenChange={(open) => { if (!open) setArchiveDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content split-archive-dialog">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{selectedArchivedBatch ? selectedArchivedBatch.label : "Archived batches"}</Dialog.Title>
              <Dialog.Description>
                {selectedArchivedBatch
                  ? (selectedArchivedBatch.closedAt ? `Settled ${formatDateOnly(selectedArchivedBatch.closedAt)}` : "Settled batch")
                  : "Closed settle-up batches stay here as muted history."}
              </Dialog.Description>
            </div>
            {selectedArchivedBatch ? (
              <div className="split-archive-dialog-body">
                <button type="button" className="subtle-action split-archive-back" onClick={() => setArchiveDialog({ batchId: null })}>
                  Back to archived batches
                </button>
                <div className="split-archive-batch-detail">
                  {renderActivityGroups(selectedArchivedBatch.groups, true)}
                </div>
              </div>
            ) : (
              <div className="split-archive-dialog-body split-archive-list-dialog">
                {archivedBatches.map((batch) => {
                  const summary = getArchivedBatchSummary(batch, view.id);
                  return (
                    <button key={batch.batchId} type="button" className="split-archive-row" onClick={() => openArchivedBatch(batch.batchId)}>
                      <span className="split-archive-row-date">{formatArchiveDate(batch.closedAt)}</span>
                      <span className="split-archive-row-icon category-icon category-icon-static" style={{ "--category-color": "#c58b62" }}>
                        <ArrowRightLeft size={16} />
                      </span>
                      <span className="split-archive-row-copy">
                        <strong>{summary.title}</strong>
                        <small>{summary.subtitle}</small>
                      </span>
                      <span className="split-archive-row-meta">{batch.items.length} {batch.items.length === 1 ? "entry" : "entries"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setArchiveDialog(null)}>Close</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(groupDialog)} onOpenChange={(open) => { if (!open) setGroupDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{messages.splits.createGroup}</Dialog.Title>
              <Dialog.Description>Add a named split group for shared expenses.</Dialog.Description>
            </div>
            <label className="split-dialog-field">
              <span>{messages.splits.groupName}</span>
              <input className="table-edit-input" value={groupDialog?.name ?? ""} onChange={(event) => setGroupDialog((current) => current ? { ...current, name: event.target.value } : current)} />
            </label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setGroupDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveGroup()}>{messages.splits.saveGroup}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(expenseDialog)} onOpenChange={(open) => { if (!open) setExpenseDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{expenseDialog?.id ? messages.splits.editSplit : messages.splits.createExpense}</Dialog.Title>
              <Dialog.Description>Create or edit a split expense without touching the bank import workflow.</Dialog.Description>
            </div>
            <div className="split-dialog-section">
              <div className="entry-core-grid split-dialog-grid">
                <label className="split-dialog-field">
                <span>Group</span>
                <select className="table-edit-input" value={expenseDialog?.groupId ?? "split-group-none"} onChange={(event) => setExpenseDialog((current) => current ? { ...current, groupId: event.target.value } : current)}>
                  {groupOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseDate}</span>
                <input className="table-edit-input" type="date" value={expenseDialog?.date ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, date: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expensePaidBy}</span>
                <select className="table-edit-input" value={expenseDialog?.payerPersonName ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, payerPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseCategory}</span>
                <select className="table-edit-input" value={expenseDialog?.categoryName ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, categoryName: event.target.value } : current)}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                </label>
              </div>
            </div>
            <div className="split-dialog-section split-dialog-section-compact">
              <div className="split-dialog-inline">
                <label className="split-dialog-field">
                <span>{messages.splits.expenseAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(expenseDialog?.amountMinor ?? 0)} onChange={(event) => setExpenseDialog((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseSplit}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" max="100" value={Number(expenseDialog?.splitBasisPoints ?? 5000) / 100} onChange={(event) => setExpenseDialog((current) => current ? { ...current, splitBasisPoints: Math.round(Number(event.target.value || 0) * 100) } : current)} />
                </label>
              </div>
            </div>
            <div className="split-dialog-section">
              <div className="entry-writing-grid split-dialog-writing-grid">
                <label className="split-dialog-field">
                <span>{messages.splits.expenseDescription}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={expenseDialog?.description ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, description: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={expenseDialog?.note ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, note: event.target.value } : current)} />
                </label>
              </div>
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setExpenseDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveExpense()}>{messages.splits.saveExpense}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(settlementDialog)} onOpenChange={(open) => { if (!open) setSettlementDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{settlementDialog?.id ? messages.splits.editSplit : messages.splits.createSettlement}</Dialog.Title>
              <Dialog.Description>Record or edit a settle-up and match the bank transfer later from the Matches view.</Dialog.Description>
            </div>
            <div className="split-dialog-section">
              <div className="entry-core-grid split-dialog-grid">
                <label className="split-dialog-field">
                <span>Group</span>
                <select className="table-edit-input" value={settlementDialog?.groupId ?? "split-group-none"} onChange={(event) => setSettlementDialog((current) => current ? { ...current, groupId: event.target.value } : current)}>
                  {groupOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.settlementDate}</span>
                <input className="table-edit-input" type="date" value={settlementDialog?.date ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, date: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.settlementFrom}</span>
                <select className="table-edit-input" value={settlementDialog?.fromPersonName ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, fromPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.settlementTo}</span>
                <select className="table-edit-input" value={settlementDialog?.toPersonName ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, toPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
                </label>
              </div>
            </div>
            <div className="split-dialog-section split-dialog-section-compact">
              <div className="split-dialog-inline">
                <label className="split-dialog-field">
                <span>{messages.splits.settlementAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(settlementDialog?.amountMinor ?? 0)} onChange={(event) => setSettlementDialog((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
                </label>
              </div>
            </div>
            <div className="split-dialog-section">
              <label className="split-dialog-field">
                <span>{messages.splits.expenseNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={4} value={settlementDialog?.note ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, note: event.target.value } : current)} />
              </label>
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setSettlementDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveSettlement()}>{messages.splits.saveSettlement}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(linkedEntryDialog)} onOpenChange={(open) => { if (!open) setLinkedEntryDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{messages.splits.editLinkedEntry}</Dialog.Title>
              <Dialog.Description>Edit the same ledger entry that also appears on the Entries page. Changes here update that row there too.</Dialog.Description>
            </div>
            <div className="linked-entry-notice">
              <strong>Linked to Entries</strong>
              <p>This form edits the underlying ledger row. When you save here, the matching entry in `Entries` updates too.</p>
            </div>
            <div className="split-dialog-section">
              <div className="entry-core-grid split-dialog-grid">
                <label className="split-dialog-field">
                <span>{messages.entries.editDate}</span>
                <input className="table-edit-input" type="date" value={linkedEntryDialog?.date ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, date: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editWallet}</span>
                <input className="table-edit-input" value={linkedEntryDialog?.accountName ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, accountName: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editCategory}</span>
                <select className="table-edit-input" value={linkedEntryDialog?.categoryName ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, categoryName: event.target.value } : current)}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                </label>
              </div>
            </div>
            <div className="split-dialog-section split-dialog-section-compact">
              <div className="split-dialog-inline">
                <label className="split-dialog-field">
                <span>{messages.entries.editAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(linkedEntryDialog?.amountMinor ?? 0)} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editOwner}</span>
                <select className="table-edit-input" value={linkedEntryDialog?.ownershipType === "shared" ? "Shared" : (linkedEntryDialog?.ownerName ?? "")} onChange={(event) => {
                  const nextValue = event.target.value;
                  setLinkedEntryDialog((current) => current ? {
                    ...current,
                    ownershipType: nextValue === "Shared" ? "shared" : "direct",
                    ownerName: nextValue === "Shared" ? undefined : nextValue
                  } : current);
                }}>
                  {[...people.map((person) => person.name), "Shared"].map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                </label>
                {linkedEntryDialog?.ownershipType === "shared" ? (
                  <label className="split-dialog-field">
                  <span>{messages.entries.editSplit}</span>
                  <input className="table-edit-input table-edit-input-money" type="number" min="0" max="100" value={Number(linkedEntryDialog?.splitBasisPoints ?? 5000) / 100} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, splitBasisPoints: Math.round(Number(event.target.value || 0) * 100) } : current)} />
                  </label>
                ) : null}
              </div>
            </div>
            <div className="split-dialog-section">
              <div className="entry-writing-grid split-dialog-writing-grid">
                <label className="split-dialog-field">
                <span>{messages.entries.editDescription}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={linkedEntryDialog?.description ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, description: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={linkedEntryDialog?.note ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, note: event.target.value } : current)} />
                </label>
              </div>
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setLinkedEntryDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveLinkedEntry()}>Save linked entry</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}

function ImportsPanel({ importsPage, viewId, viewLabel, accounts, categories, people, onRefresh }) {
  // Keep import flow state centralized while the UI is being split up: CSV paste,
  // PDF/XLS parsing, preview, checkpoints, and commit all share this payload.
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
  const [statementCheckpoints, setStatementCheckpoints] = useState([]);
  const [statementImportMeta, setStatementImportMeta] = useState({ sourceType: "csv", parserKey: "generic_csv" });
  const [uploadStatus, setUploadStatus] = useState(null);
  const [isParsingStatement, setIsParsingStatement] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentImportsOpen, setRecentImportsOpen] = useState(false);
  const [recentImportPage, setRecentImportPage] = useState(1);
  const [dismissedOverlapIds, setDismissedOverlapIds] = useState([]);
  const fileInputRef = useRef(null);
  const mappingSectionRef = useRef(null);
  const previewSectionRef = useRef(null);
  const hasAutoScrolledMappingRef = useRef(false);
  const hasAutoScrolledPreviewRef = useRef(false);

  const csvInspection = useMemo(() => inspectCsv(csvText), [csvText]);
  const headerSignature = csvInspection.headers.join("|");
  const defaultAccountDirectOwnerName = useMemo(
    () => getImportDirectOwnerForAccount(accounts, people, defaultAccountName, undefined),
    [accounts, defaultAccountName, people]
  );

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
    if (ownershipType !== "direct" || !defaultAccountDirectOwnerName || ownerName === defaultAccountDirectOwnerName) {
      return;
    }

    setOwnerName(defaultAccountDirectOwnerName);
  }, [defaultAccountDirectOwnerName, ownerName, ownershipType]);

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

    if (defaultAccountDirectOwnerName) {
      if (ownerName !== defaultAccountDirectOwnerName) {
        setOwnerName(defaultAccountDirectOwnerName);
      }
      return;
    }

    const matchedPerson = people.find((person) => person.id === viewId);
    if (matchedPerson && ownerName !== matchedPerson.name) {
      setOwnerName(matchedPerson.name);
    }
  }, [defaultAccountDirectOwnerName, ownerName, people, viewId]);

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

  const missingRequiredFields = [
    !mappedFields.date ? "date" : null,
    !mappedFields.description ? "description" : null,
    !mappedFields.amount && !mappedFields.expense && !mappedFields.income ? "amount/expense/income" : null
  ].filter(Boolean);
  const readyForMapping = csvInspection.headers.length > 0;
  const readyForPreview = mappedRows.length > 0 && missingRequiredFields.length === 0 && duplicateMappings.length === 0;
  const currentStage = preview ? 3 : readyForMapping ? 2 : 1;
  const hasBlockingCategoryPolicy = unknownCategoryMode === "block" && Boolean(preview?.unknownCategories?.length);
  const knownAccountNames = useMemo(() => new Set(accounts.map((account) => account.name)), [accounts]);
  const detectedPreviewAccountNames = useMemo(
    () => Array.from(new Set(previewRows.map((row) => row.accountName).filter(Boolean))).sort(),
    [previewRows]
  );
  const unknownPreviewAccountNames = useMemo(
    () => detectedPreviewAccountNames.filter((accountName) => !knownAccountNames.has(accountName)),
    [detectedPreviewAccountNames, knownAccountNames]
  );
  const showStatementAccountMapping = preview && detectedPreviewAccountNames.length > 0 && (
    statementImportMeta.sourceType === "pdf" || unknownPreviewAccountNames.length > 0
  );
  const hasUnmappedAccounts = previewRows.some((row) => !row.accountName || !knownAccountNames.has(row.accountName));
  const duplicateCheckpointAccounts = useMemo(() => {
    const counts = new Map();
    for (const checkpoint of statementCheckpoints) {
      if (!checkpoint.accountName) {
        continue;
      }
      counts.set(checkpoint.accountName, (counts.get(checkpoint.accountName) ?? 0) + 1);
    }
    return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([accountName]) => accountName);
  }, [statementCheckpoints]);
  const hasDuplicateCheckpointAccounts = duplicateCheckpointAccounts.length > 0;
  const visibleOverlapImports = useMemo(
    () => (preview?.overlapImports ?? []).filter((item) => !dismissedOverlapIds.includes(item.id)),
    [dismissedOverlapIds, preview?.overlapImports]
  );
  const statementReconciliations = preview?.statementReconciliations ?? [];
  const hasStatementReconciliationMismatch = statementReconciliations.some((item) => item.status !== "matched");
  const isCommitDisabled = isSubmitting
    || isParsingStatement
    || !previewRows.length
    || hasUnmappedAccounts
    || hasBlockingCategoryPolicy
    || hasDuplicateCheckpointAccounts;
  const hasImportDraft = Boolean(
    preview
    || previewRows.length
    || csvText
    || importNote
    || statementCheckpoints.length
    || uploadStatus
    || previewError
    || sourceLabel !== "Imported CSV"
  );
  const recentImportPageCount = Math.max(1, Math.ceil(importsPage.recentImports.length / RECENT_IMPORTS_PAGE_SIZE));
  const paginatedRecentImports = useMemo(() => {
    const startIndex = (recentImportPage - 1) * RECENT_IMPORTS_PAGE_SIZE;
    return importsPage.recentImports.slice(startIndex, startIndex + RECENT_IMPORTS_PAGE_SIZE);
  }, [importsPage.recentImports, recentImportPage]);
  const recentImportStart = importsPage.recentImports.length
    ? ((recentImportPage - 1) * RECENT_IMPORTS_PAGE_SIZE) + 1
    : 0;
  const recentImportEnd = Math.min(recentImportPage * RECENT_IMPORTS_PAGE_SIZE, importsPage.recentImports.length);
  const recentImportGroups = useMemo(() => {
    const grouped = new Map();
    for (const item of paginatedRecentImports) {
      const dateKey = item.importedAt.slice(0, 10);
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey).push(item);
    }
    return Array.from(grouped.entries()).map(([date, items]) => ({ date, items }));
  }, [paginatedRecentImports]);

  useEffect(() => {
    setRecentImportPage((current) => Math.min(Math.max(current, 1), recentImportPageCount));
  }, [recentImportPageCount]);

  useEffect(() => {
    if (!readyForMapping) {
      hasAutoScrolledMappingRef.current = false;
      return;
    }
    if (hasAutoScrolledMappingRef.current) {
      return;
    }
    hasAutoScrolledMappingRef.current = true;
    mappingSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [readyForMapping]);

  useEffect(() => {
    if (!preview) {
      hasAutoScrolledPreviewRef.current = false;
      return;
    }
    if (hasAutoScrolledPreviewRef.current) {
      return;
    }
    hasAutoScrolledPreviewRef.current = true;
    previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [preview]);

  function handleCsvTextChange(nextText) {
    setCsvText(nextText);
    setStatementCheckpoints([]);
    setStatementImportMeta({ sourceType: "csv", parserKey: "generic_csv" });
    setUploadStatus(null);
  }

  function handleDefaultAccountChange(nextAccountName) {
    setDefaultAccountName(nextAccountName);
    const nextOwnerName = getImportDirectOwnerForAccount(accounts, people, nextAccountName, undefined);
    if (ownershipType === "direct" && nextOwnerName) {
      setOwnerName(nextOwnerName);
    }
  }

  function resetImportForm() {
    setSourceLabel("Imported CSV");
    setImportNote("");
    setCsvText("");
    setDefaultAccountName(accounts[0]?.name ?? "");
    setOwnershipType("direct");
    setOwnerName(people[0]?.name ?? "");
    setSplitPercent("50");
    setUnknownCategoryMode("other");
    setColumnMappings({});
    setPreview(null);
    setPreviewRows([]);
    setPreviewError("");
    setStatementCheckpoints([]);
    setStatementImportMeta({ sourceType: "csv", parserKey: "generic_csv" });
    setUploadStatus(null);
    setIsParsingStatement(false);
    setIsDragActive(false);
    setDismissedOverlapIds([]);
    hasAutoScrolledMappingRef.current = false;
    hasAutoScrolledPreviewRef.current = false;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleUploadImportFile(event) {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }

    await processImportFile(file);
    event.target.value = "";
  }

  async function processImportFile(file) {
    setPreviewError("");
    setUploadStatus({ tone: "active", message: messages.imports.uploadReading(file.name) });
    setPreview(null);
    setPreviewRows([]);
    setIsParsingStatement(true);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadExtracting(file.name) });
        const text = await extractPdfText(file);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseStatementText(text, file.name);

        setSourceLabel(parsed.sourceLabel);
        setStatementCheckpoints(parsed.checkpoints);
        setStatementImportMeta({ sourceType: "pdf", parserKey: parsed.parserKey });
        setCsvText(statementRowsToCsv(parsed.rows));
        if (parsed.checkpoints[0]?.accountName) {
          setDefaultAccountName(parsed.checkpoints[0].accountName);
        }

        setUploadStatus({ tone: "active", message: messages.imports.uploadPreviewing(parsed.rows.length) });
        await previewImportRows({
          rows: parsed.rows,
          nextSourceLabel: parsed.sourceLabel,
          nextDefaultAccountName: parsed.checkpoints[0]?.accountName ?? defaultAccountName,
          nextStatementCheckpoints: parsed.checkpoints
        });
        setUploadStatus({ tone: "success", message: messages.imports.uploadReady(parsed.rows.length) });
        return;
      }

      if (/\.xls$/i.test(file.name) || file.type === "application/vnd.ms-excel") {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseCurrentTransactionSpreadsheet(await file.arrayBuffer(), file.name);

        setSourceLabel(parsed.sourceLabel);
        setStatementCheckpoints([]);
        setStatementImportMeta({ sourceType: "csv", parserKey: parsed.parserKey });
        setCsvText(statementRowsToCsv(parsed.rows));
        if (parsed.rows[0]?.account) {
          setDefaultAccountName(parsed.rows[0].account);
        }

        setUploadStatus({ tone: "active", message: messages.imports.uploadPreviewing(parsed.rows.length) });
        await previewImportRows({
          rows: parsed.rows,
          nextSourceLabel: parsed.sourceLabel,
          nextDefaultAccountName: parsed.rows[0]?.account ?? defaultAccountName,
          nextStatementCheckpoints: []
        });
        setUploadStatus({ tone: "success", message: messages.imports.uploadReady(parsed.rows.length) });
        return;
      }

      const nextText = await file.text();
      setDismissedOverlapIds([]);
      setCsvText(nextText);
      setStatementCheckpoints([]);
      setStatementImportMeta({ sourceType: "csv", parserKey: "generic_csv" });
      setUploadStatus({ tone: "success", message: messages.imports.uploadCsvReady(file.name) });
    } catch (error) {
      setPreview(null);
      setPreviewRows([]);
      const message = error instanceof Error ? error.message : "Statement import failed.";
      setPreviewError(message);
      setUploadStatus({ tone: "error", message });
    } finally {
      setIsParsingStatement(false);
    }
  }

  async function previewImportRows({
    rows,
    nextSourceLabel = sourceLabel,
    nextDefaultAccountName = defaultAccountName,
    nextStatementCheckpoints = statementCheckpoints
  }) {
    setPreviewError("");
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sourceLabel: nextSourceLabel,
        rows,
        defaultAccountName: nextDefaultAccountName,
        ownershipType,
        ownerName,
        splitBasisPoints: Math.round(Number(splitPercent || "50") * 100),
        statementCheckpoints: nextStatementCheckpoints.map((checkpoint) => ({
          ...checkpoint,
          statementBalanceMinor: Number(checkpoint.statementBalanceMinor ?? 0)
        }))
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setPreview(null);
      setPreviewRows([]);
      throw new Error(data.error ?? "Import preview failed.");
    }
    setDismissedOverlapIds((current) => current.filter((id) => data.preview?.overlapImports?.some((item) => item.id === id)));
    setPreview(data.preview);
    setPreviewRows(data.preview?.previewRows ?? []);
  }

  async function handlePreview() {
    if (!readyForPreview) {
      return;
    }

    setIsSubmitting(true);
    try {
      await previewImportRows({ rows: mappedRows });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDropImportFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    const [file] = event.dataTransfer.files ?? [];
    if (file) {
      void processImportFile(file);
    }
  }

  function handleDragOverImportFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  }

  function handleDragLeaveImportFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  }

  async function handleCommit() {
    if (!previewRows.length) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/imports/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceLabel: preview?.sourceLabel ?? sourceLabel,
          sourceType: statementImportMeta.sourceType,
          parserKey: statementImportMeta.parserKey,
          note: importNote,
          statementCheckpoints: statementCheckpoints.map((checkpoint) => ({
            ...checkpoint,
            statementBalanceMinor: Number(checkpoint.statementBalanceMinor ?? 0)
          })),
          rows: previewRows.map((row) => ({
            ...row,
            splitBasisPoints: Number(row.splitBasisPoints ?? 10000)
          }))
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPreviewError(data.error ?? messages.imports.commitFailed);
        return;
      }
      resetImportForm();
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

  function getPreviewAccountOwnerPatch(accountName, row) {
    if (row.ownershipType !== "direct") {
      return {};
    }

    const nextOwnerName = getImportDirectOwnerForAccount(accounts, people, accountName, row.ownerName ?? ownerName);
    return nextOwnerName ? { ownerName: nextOwnerName } : {};
  }

  function updateStatementCheckpoint(index, patch) {
    setStatementCheckpoints((current) => current.map((checkpoint, checkpointIndex) => (
      checkpointIndex === index ? { ...checkpoint, ...patch } : checkpoint
    )));
  }

  function remapPreviewAccount(fromAccountName, toAccountName) {
    if (!toAccountName) {
      return;
    }

    const nextRows = previewRows.map((row) => (
      row.accountName === fromAccountName
        ? { ...row, accountName: toAccountName, ...getPreviewAccountOwnerPatch(toAccountName, row) }
        : row
    ));
    const nextCheckpoints = statementCheckpoints.map((checkpoint) => (
      checkpoint.accountName === fromAccountName ? { ...checkpoint, accountName: toAccountName } : checkpoint
    ));
    setPreviewRows(nextRows);
    setStatementCheckpoints(nextCheckpoints);
    setUploadStatus({ tone: "active", message: messages.imports.accountMappingRefreshing });
    setIsSubmitting(true);
    void previewImportRows({
      rows: nextRows.map(buildRawImportRowFromPreviewRow),
      nextStatementCheckpoints: nextCheckpoints
    })
      .then(() => {
        setUploadStatus({ tone: "success", message: messages.imports.accountMappingRefreshed });
      })
      .catch((error) => {
        setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
        setUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "Import preview failed." });
      })
      .finally(() => setIsSubmitting(false));
  }

  function handleRefreshStatementReconciliation() {
    if (!previewRows.length) {
      return;
    }

    setUploadStatus({ tone: "active", message: messages.imports.statementReconciliationRefreshing });
    setIsSubmitting(true);
    void previewImportRows({ rows: previewRows.map(buildRawImportRowFromPreviewRow) })
      .then(() => {
        setUploadStatus({ tone: "success", message: messages.imports.statementReconciliationRefreshed });
      })
      .catch((error) => {
        setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
        setUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "Import preview failed." });
      })
      .finally(() => setIsSubmitting(false));
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
          {hasImportDraft ? (
            <button type="button" className="subtle-action" onClick={resetImportForm} disabled={isSubmitting}>
              {messages.imports.startOver}
            </button>
          ) : null}
        </div>

        <ImportSelectFileStage
          currentStage={currentStage}
          sourceLabel={sourceLabel}
          onSourceLabelChange={setSourceLabel}
          defaultAccountName={defaultAccountName}
          onDefaultAccountChange={handleDefaultAccountChange}
          accounts={accounts}
          ownershipType={ownershipType}
          onOwnershipTypeChange={setOwnershipType}
          ownerName={ownerName}
          onOwnerNameChange={setOwnerName}
          people={people}
          splitPercent={splitPercent}
          onSplitPercentChange={setSplitPercent}
          importNote={importNote}
          onImportNoteChange={setImportNote}
          csvText={csvText}
          onCsvTextChange={handleCsvTextChange}
          fileInputRef={fileInputRef}
          onUploadImportFile={handleUploadImportFile}
          isDragActive={isDragActive}
          isParsingStatement={isParsingStatement}
          onDragOverImportFile={handleDragOverImportFile}
          onDragLeaveImportFile={handleDragLeaveImportFile}
          onDropImportFile={handleDropImportFile}
          uploadStatus={uploadStatus}
          rollbackPolicy={importsPage.rollbackPolicy}
        />

        {readyForMapping ? (
          <ImportMappingStage
            mappingSectionRef={mappingSectionRef}
            currentStage={currentStage}
            csvInspection={csvInspection}
            unknownCategoryMode={unknownCategoryMode}
            onUnknownCategoryModeChange={setUnknownCategoryMode}
            missingRequiredFields={missingRequiredFields}
            duplicateMappings={duplicateMappings}
            columnMappings={columnMappings}
            onColumnMappingChange={(header, nextValue) => {
              setColumnMappings((current) => ({ ...current, [header]: nextValue }));
            }}
            isSubmitting={isSubmitting}
            isParsingStatement={isParsingStatement}
            readyForPreview={readyForPreview}
            onPreview={handlePreview}
            previewError={previewError}
          />
        ) : null}

        <div ref={previewSectionRef} className={`import-stage-card ${currentStage === 3 ? "is-current" : ""}`}>
          <div className="import-stage-head">
            <div className="section-head">
              <h3>{messages.imports.previewRows}</h3>
              <span className="panel-context">
                {preview ? messages.imports.transactionCount(preview.importedRows) : messages.imports.previewEmpty}
              </span>
            </div>
            <div className="import-stage-head-actions">
              <span className={`import-stage-label ${currentStage === 3 ? "is-current" : ""}`}>
                {messages.imports.steps[2]}
              </span>
              {preview ? (
                <button
                  type="button"
                  className="subtle-action"
                  onClick={resetImportForm}
                >
                  {messages.imports.startOver}
                </button>
              ) : null}
            </div>
          </div>
          {preview ? <p className="import-stage-note">{messages.imports.previewReady}</p> : null}
          {previewRows.length > 100 ? (
            <p className="import-stage-note">{messages.imports.largeImportNotice(previewRows.length)}</p>
          ) : null}

          {showStatementAccountMapping ? (
            <div className="import-warning import-warning-action">
              <strong>{unknownPreviewAccountNames.length ? messages.imports.unknownAccounts : messages.imports.accountMappingTitle}</strong>
              <p className="lede compact">{messages.imports.accountMappingDetail}</p>
              <div className="statement-account-map-grid">
                {detectedPreviewAccountNames.map((accountName) => (
                  <label key={accountName} className="entries-filter statement-account-map-row">
                    <span className="entries-filter-label">{messages.imports.detectedAccount(accountName)}</span>
                    <select
                      className="table-edit-input"
                      value={knownAccountNames.has(accountName) ? accountName : ""}
                      onChange={(event) => remapPreviewAccount(accountName, event.target.value)}
                    >
                      <option value="">{messages.imports.chooseAccount}</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.name}>{account.name}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {preview?.unknownCategories?.length ? (
            <div className="import-warning import-warning-attention">
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
              {visibleOverlapImports.length ? (
                <span className="pill warning">{messages.imports.overlappingImports(visibleOverlapImports.length)}</span>
              ) : null}
            </div>
          ) : null}

          {visibleOverlapImports.length ? (
            <div className="import-warning import-warning-overlap">
              <strong>{messages.imports.previewOverlapTitle}</strong>
              <p className="lede compact">{messages.imports.previewOverlapDetail}</p>
              <div className="stack">
                {visibleOverlapImports.map((item) => (
                  <div key={item.id} className="import-card import-card-compact">
                    <div className="import-history-main">
                      <strong>{item.sourceLabel}</strong>
                      <span className="import-history-inline">
                        {messages.common.triplet(
                          item.importedAt ? formatDate(item.importedAt) : messages.common.emptyValue,
                          messages.imports.transactionCount(item.transactionCount),
                          item.sourceType ? item.sourceType.toUpperCase() : messages.common.emptyValue
                        )}
                      </span>
                      {item.startDate && item.endDate ? (
                        <span className="import-history-inline">{messages.imports.importCoverage(formatDateOnly(item.startDate), formatDateOnly(item.endDate))}</span>
                      ) : null}
                      {item.accountNames.length ? <span className="import-history-inline">{item.accountNames.join(", ")}</span> : null}
                    </div>
                    <div className="import-meta import-meta-compact">
                      <button type="button" className="subtle-action" onClick={() => setDismissedOverlapIds((current) => [...new Set([...current, item.id])])}>
                        {messages.imports.dismissOverlap}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {statementReconciliations.length ? (
            <div className={`import-warning ${hasStatementReconciliationMismatch ? "import-warning-attention" : "import-warning-reconciled"}`}>
              <div className="import-warning-head">
                <div>
                  <strong>{messages.imports.statementReconciliationTitle}</strong>
                  <p className="lede compact">
                    {hasStatementReconciliationMismatch
                      ? messages.imports.statementReconciliationMismatchDetail
                      : messages.imports.statementReconciliationMatchedDetail}
                  </p>
                </div>
                <button type="button" className="subtle-action" onClick={handleRefreshStatementReconciliation} disabled={isSubmitting}>
                  {messages.imports.statementReconciliationRefresh}
                </button>
              </div>
              <div className="stack">
                {statementReconciliations.map((item) => (
                  <div key={`${item.accountName}-${item.checkpointMonth}`} className="import-card import-card-compact statement-reconciliation-row">
                    <div className="import-history-main">
                      <strong>{messages.imports.statementReconciliationAccount(item.accountName, formatMonthLabel(item.checkpointMonth))}</strong>
                      {item.statementStartDate && item.statementEndDate ? (
                        <span className="import-history-inline">{messages.imports.importCoverage(formatDateOnly(item.statementStartDate), formatDateOnly(item.statementEndDate))}</span>
                      ) : null}
                      <span className="import-history-inline">{formatStatementReconciliationLine(item)}</span>
                    </div>
                    <div className="import-meta import-meta-compact">
                      <span className={`pill ${item.status === "matched" ? "success" : "warning"}`}>
                        {messages.imports.statementReconciliationStatus[item.status]}
                      </span>
                      {item.deltaMinor != null && item.deltaMinor !== 0 ? (
                        <p>{messages.imports.statementReconciliationDelta(money(Math.abs(item.deltaMinor)))}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {preview && statementCheckpoints.length ? (
            <div className="import-warning import-warning-review">
              <strong>{messages.imports.statementCheckpointsTitle(statementCheckpoints.length)}</strong>
              <p className="lede compact">{messages.imports.statementCheckpointsDetail(statementCheckpoints.length)}</p>
              {hasDuplicateCheckpointAccounts ? (
                <p className="form-error">{messages.imports.duplicateCheckpointAccounts(duplicateCheckpointAccounts.join(", "))}</p>
              ) : null}
              <div className="statement-checkpoint-grid">
                {statementCheckpoints.map((checkpoint, index) => (
                  <div key={`${checkpoint.accountName}-${index}`} className="statement-checkpoint-row">
                    <label className="entries-filter">
                      <span className="entries-filter-label">{messages.imports.statementCheckpointAccount}</span>
                      <select
                        className="table-edit-input"
                        value={checkpoint.accountName}
                        onChange={(event) => updateStatementCheckpoint(index, { accountName: event.target.value })}
                      >
                        {checkpoint.accountName && !knownAccountNames.has(checkpoint.accountName) ? (
                          <option value={checkpoint.accountName}>{checkpoint.accountName}</option>
                        ) : null}
                        {accounts.map((account) => (
                          <option key={account.id} value={account.name}>{account.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="entries-filter">
                      <span className="entries-filter-label">{messages.imports.statementCheckpointMonth}</span>
                      <input className="table-edit-input" type="month" value={checkpoint.checkpointMonth} onChange={(event) => updateStatementCheckpoint(index, { checkpointMonth: event.target.value })} />
                    </label>
                    <label className="entries-filter">
                      <span className="entries-filter-label">{messages.imports.statementCheckpointStart}</span>
                      <input className="table-edit-input" type="date" value={checkpoint.statementStartDate ?? ""} onChange={(event) => updateStatementCheckpoint(index, { statementStartDate: event.target.value })} />
                    </label>
                    <label className="entries-filter">
                      <span className="entries-filter-label">{messages.imports.statementCheckpointEnd}</span>
                      <input className="table-edit-input" type="date" value={checkpoint.statementEndDate ?? ""} onChange={(event) => updateStatementCheckpoint(index, { statementEndDate: event.target.value })} />
                    </label>
                    <label className="entries-filter">
                      <span className="entries-filter-label">{messages.imports.statementCheckpointBalance}</span>
                      <input className="table-edit-input" value={formatMinorInput(checkpoint.statementBalanceMinor)} onChange={(event) => updateStatementCheckpoint(index, { statementBalanceMinor: parseMoneyInput(event.target.value, checkpoint.statementBalanceMinor) })} />
                    </label>
                    <label className="entries-filter">
                      <span className="entries-filter-label">{messages.imports.statementCheckpointNote}</span>
                      <input className="table-edit-input" value={checkpoint.note ?? ""} onChange={(event) => updateStatementCheckpoint(index, { note: event.target.value })} />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {preview?.duplicateCandidates?.length ? (
            <div className="import-warning import-warning-attention">
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
            <ImportPreviewRowsTable
              previewRows={previewRows}
              accounts={accounts}
              categories={categories}
              people={people}
              knownAccountNames={knownAccountNames}
              isCommitDisabled={isCommitDisabled}
              onCommit={handleCommit}
              onUpdatePreviewRow={updatePreviewRow}
              getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
            />
          ) : (
            <p className="lede compact">{messages.imports.previewEmpty}</p>
          )}
        </div>
      </section>

      <ImportRecentHistorySection
        recentImports={importsPage.recentImports}
        recentImportGroups={recentImportGroups}
        recentImportsOpen={recentImportsOpen}
        recentImportPage={recentImportPage}
        recentImportPageCount={recentImportPageCount}
        recentImportStart={recentImportStart}
        recentImportEnd={recentImportEnd}
        onToggleOpen={() => setRecentImportsOpen((current) => !current)}
        onPreviousPage={() => setRecentImportPage((current) => Math.max(1, current - 1))}
        onNextPage={() => setRecentImportPage((current) => Math.min(recentImportPageCount, current + 1))}
        onRollback={handleRollback}
      />
    </article>
  );
}

// Stage 2 maps arbitrary CSV headers into the fixed import DTO the preview API expects.
function ImportMappingStage({
  mappingSectionRef,
  currentStage,
  csvInspection,
  unknownCategoryMode,
  onUnknownCategoryModeChange,
  missingRequiredFields,
  duplicateMappings,
  columnMappings,
  onColumnMappingChange,
  isSubmitting,
  isParsingStatement,
  readyForPreview,
  onPreview,
  previewError
}) {
  const stageClassName = currentStage === 2 ? "is-current" : currentStage > 2 ? "is-complete" : "";

  return (
    <div ref={mappingSectionRef} className={`import-stage-card ${stageClassName}`}>
      <div className="import-stage-head">
        <div className="section-head">
          <h3>{messages.imports.mappingTitle}</h3>
          <span className="panel-context">{messages.imports.mappingDetail(csvInspection.rows.length)}</span>
        </div>
        <span className={`import-stage-label ${stageClassName}`}>
          {messages.imports.steps[1]}
        </span>
      </div>

      <div className="import-mapping-topline">
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.nonExistingCategories}</span>
          <select className="table-edit-input" value={unknownCategoryMode} onChange={(event) => onUnknownCategoryModeChange(event.target.value)}>
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
              onChange={(event) => onColumnMappingChange(header, event.target.value)}
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
        <button type="button" className="subtle-action is-primary" disabled={isSubmitting || isParsingStatement || !readyForPreview} onClick={onPreview}>
          {messages.imports.preview}
        </button>
      </div>
      {readyForPreview ? <p className="import-stage-note">{messages.imports.mappingNext}</p> : null}
      {previewError ? <div className="import-warning"><strong>{previewError}</strong></div> : null}
    </div>
  );
}

// Preview rows are still edited through ImportsPanel so account ownership fixes
// and commit payloads stay consistent with the preview API response.
function ImportPreviewRowsTable({
  previewRows,
  accounts,
  categories,
  people,
  knownAccountNames,
  isCommitDisabled,
  onCommit,
  onUpdatePreviewRow,
  getPreviewAccountOwnerPatch
}) {
  return (
    <>
      <ImportCommitButton disabled={isCommitDisabled} onCommit={onCommit} />
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
                  <input className="table-edit-input" type="date" value={row.date} onChange={(event) => onUpdatePreviewRow(row.rowId, { date: event.target.value })} />
                </td>
                <td>
                  <input className="table-edit-input" value={row.description} onChange={(event) => onUpdatePreviewRow(row.rowId, { description: event.target.value })} />
                </td>
                <td className={getAmountToneClass(row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor)}>
                  <input
                    className="table-edit-input import-amount-input"
                    value={formatMinorInput(row.amountMinor)}
                    onChange={(event) => onUpdatePreviewRow(row.rowId, { amountMinor: parseMoneyInput(event.target.value, row.amountMinor) })}
                  />
                </td>
                <td>
                  <select className="table-edit-input" value={row.entryType} onChange={(event) => onUpdatePreviewRow(row.rowId, { entryType: event.target.value })}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </td>
                <td>
                  <select
                    className="table-edit-input"
                    value={row.accountName ?? ""}
                    onChange={(event) => {
                      const nextAccountName = event.target.value || undefined;
                      onUpdatePreviewRow(row.rowId, {
                        accountName: nextAccountName,
                        ...getPreviewAccountOwnerPatch(nextAccountName, row)
                      });
                    }}
                  >
                    <option value="">{messages.entries.allWallets}</option>
                    {row.accountName && !knownAccountNames.has(row.accountName) ? (
                      <option value={row.accountName}>{row.accountName}</option>
                    ) : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.name}>{account.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="table-edit-input" value={row.categoryName ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { categoryName: event.target.value || undefined })}>
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
                        onUpdatePreviewRow(row.rowId, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5000 });
                        return;
                      }
                      onUpdatePreviewRow(row.rowId, { ownershipType: "direct", ownerName: nextOwner, splitBasisPoints: 10000 });
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
                      onChange={(event) => onUpdatePreviewRow(row.rowId, { splitBasisPoints: Math.round(Number(event.target.value || "50") * 100) })}
                    />
                  ) : (
                    messages.common.emptyValue
                  )}
                </td>
                <td>
                  <input className="table-edit-input" value={row.note ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { note: event.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ImportCommitButton disabled={isCommitDisabled} onCommit={onCommit} isBottom />
    </>
  );
}

function ImportCommitButton({ disabled, onCommit, isBottom = false }) {
  return (
    <div className={`import-actions import-actions-end ${isBottom ? "import-actions-bottom" : ""}`}>
      <button
        type="button"
        className="import-commit-button"
        disabled={disabled}
        onClick={onCommit}
      >
        {messages.imports.commit}
      </button>
    </div>
  );
}

// Stage 1 stays presentational: it collects source defaults and hands files or
// pasted CSV back to ImportsPanel so every source uses the same preview flow.
function ImportSelectFileStage({
  currentStage,
  sourceLabel,
  onSourceLabelChange,
  defaultAccountName,
  onDefaultAccountChange,
  accounts,
  ownershipType,
  onOwnershipTypeChange,
  ownerName,
  onOwnerNameChange,
  people,
  splitPercent,
  onSplitPercentChange,
  importNote,
  onImportNoteChange,
  csvText,
  onCsvTextChange,
  fileInputRef,
  onUploadImportFile,
  isDragActive,
  isParsingStatement,
  onDragOverImportFile,
  onDragLeaveImportFile,
  onDropImportFile,
  uploadStatus,
  rollbackPolicy
}) {
  const stageClassName = currentStage === 1 ? "is-current" : currentStage > 1 ? "is-complete" : "";

  return (
    <div className={`import-stage-card ${stageClassName}`}>
      <div className="import-stage-head">
        <div className="section-head">
          <h3>{messages.imports.selectFileTitle}</h3>
          <span className="panel-context">{messages.imports.selectFileDetail}</span>
        </div>
        <span className={`import-stage-label ${stageClassName}`}>
          {messages.imports.steps[0]}
        </span>
      </div>

      <div className="import-form-grid">
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.sourceLabel}</span>
          <input
            className="table-edit-input"
            value={sourceLabel}
            onChange={(event) => onSourceLabelChange(event.target.value)}
            placeholder={messages.imports.sourceLabelPlaceholder}
          />
        </label>
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.defaultAccount}</span>
          <select className="table-edit-input" value={defaultAccountName} onChange={(event) => onDefaultAccountChange(event.target.value)}>
            <option value="">{messages.entries.allWallets}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.name}>{account.name}</option>
            ))}
          </select>
        </label>
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.ownership}</span>
          <select className="table-edit-input" value={ownershipType} onChange={(event) => onOwnershipTypeChange(event.target.value)}>
            <option value="direct">Direct</option>
            <option value="shared">{messages.entries.shared}</option>
          </select>
        </label>
        <label className="entries-filter">
          <span className="entries-filter-label">{messages.imports.owner}</span>
          <select className="table-edit-input" value={ownerName} disabled={ownershipType !== "direct"} onChange={(event) => onOwnerNameChange(event.target.value)}>
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
            onChange={(event) => onSplitPercentChange(event.target.value)}
          />
        </label>
        <label className="entries-filter import-note-field">
          <span className="entries-filter-label">{messages.imports.importNote}</span>
          <input
            className="table-edit-input"
            value={importNote}
            onChange={(event) => onImportNoteChange(event.target.value)}
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
            onChange={(event) => onCsvTextChange(event.target.value)}
            placeholder={messages.imports.csvPlaceholder}
          />
        </label>
        <div className="import-sidecar">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv,.pdf,application/pdf,.xls,application/vnd.ms-excel" hidden onChange={onUploadImportFile} />
          <div
            className={`import-dropzone ${isDragActive ? "is-active" : ""} ${isParsingStatement ? "is-busy" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={onDragOverImportFile}
            onDragOver={onDragOverImportFile}
            onDragLeave={onDragLeaveImportFile}
            onDrop={onDropImportFile}
          >
            <strong>{messages.imports.dropzoneTitle}</strong>
            <span>{messages.imports.dropzoneDetail}</span>
          </div>
          {uploadStatus ? (
            <div className={`import-upload-status is-${uploadStatus.tone}`} role={uploadStatus.tone === "error" ? "alert" : "status"}>
              <strong>{uploadStatus.tone === "error" ? messages.imports.uploadStatusError : uploadStatus.tone === "success" ? messages.imports.uploadStatusReady : messages.imports.uploadStatusWorking}</strong>
              <span>{uploadStatus.message}</span>
            </div>
          ) : null}
          <div className="import-step-hint">
            <strong>{messages.imports.selectFileNextUpload}</strong>
            <p>{messages.imports.selectFileNextPaste}</p>
          </div>
          <p className="lede compact">{messages.imports.defaultsHint}</p>
          <p className="lede compact">{messages.imports.trustHint}</p>
          <p className="lede compact">{rollbackPolicy}</p>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ settingsPage, accounts, categories, people, viewId, viewLabel, onRefresh }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emptyStateText, setEmptyStateText] = useState("");
  const [demoStateOpen, setDemoStateOpen] = useState(false);
  const [settingsSectionsOpen, setSettingsSectionsOpen] = useState({
    people: false,
    accounts: false,
    categories: false,
    trust: false,
    transfers: false,
    activity: false
  });
  const [personDialog, setPersonDialog] = useState(null);
  const [accountDialog, setAccountDialog] = useState(null);
  const [accountDialogError, setAccountDialogError] = useState("");
  const [categoryDialog, setCategoryDialog] = useState(null);
  const [reconciliationDialog, setReconciliationDialog] = useState(null);
  const [checkpointHistoryYear, setCheckpointHistoryYear] = useState("");
  const [statementComparePanel, setStatementComparePanel] = useState(null);
  const [statementCompareResult, setStatementCompareResult] = useState(null);
  const [statementCompareStatus, setStatementCompareStatus] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const visibleAccounts = useMemo(() => {
    const scopedAccounts = viewId === "household"
      ? accounts
      : accounts.filter((account) => account.isJoint || account.ownerPersonId === viewId);

    return scopedAccounts
      .slice()
      .sort((left, right) => (
        Number(right.isActive) - Number(left.isActive)
        || left.institution.localeCompare(right.institution)
        || left.name.localeCompare(right.name)
      ));
  }, [accounts, viewId]);
  const visibleCategories = useMemo(
    () => categories.slice().sort((left, right) => left.name.localeCompare(right.name)),
    [categories]
  );
  const recentActivityGroups = useMemo(() => {
    const grouped = new Map();
    for (const event of settingsPage.recentAuditEvents) {
      const key = event.createdAt.slice(0, 10);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(event);
    }
    return Array.from(grouped.entries()).map(([date, events]) => ({ date, events }));
  }, [settingsPage.recentAuditEvents]);
  const checkpointHistoryYears = useMemo(() => (
    Array.from(new Set((reconciliationDialog?.history ?? []).map((item) => item.month.slice(0, 4)).filter(Boolean)))
      .sort((left, right) => right.localeCompare(left))
  ), [reconciliationDialog?.history]);
  const visibleCheckpointHistory = useMemo(() => (
    (reconciliationDialog?.history ?? []).filter((item) => !checkpointHistoryYear || item.month.startsWith(`${checkpointHistoryYear}-`))
  ), [checkpointHistoryYear, reconciliationDialog?.history]);

  useEffect(() => {
    if (!reconciliationDialog) {
      setCheckpointHistoryYear("");
      return;
    }

    if (checkpointHistoryYears.length && !checkpointHistoryYears.includes(checkpointHistoryYear)) {
      setCheckpointHistoryYear(checkpointHistoryYears[0]);
    }
  }, [checkpointHistoryYear, checkpointHistoryYears, reconciliationDialog]);

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
    setAccountDialogError("");
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
    setAccountDialogError("");
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
      accountKind: account.kind,
      checkpointMonth: account.latestCheckpointMonth ?? "",
      statementStartDate: account.latestCheckpointStartDate ?? "",
      statementEndDate: account.latestCheckpointEndDate ?? "",
      statementBalance: formatCheckpointStatementInputMinor(
        account.latestCheckpointBalanceMinor ?? account.balanceMinor ?? 0,
        account.kind
      ),
      note: account.latestCheckpointNote ?? "",
      history: account.checkpointHistory ?? []
    });
  }

  function openStatementComparePanel(account, checkpoint) {
    if (!checkpoint?.month) {
      return;
    }

    setSettingsSectionsOpen((current) => ({ ...current, accounts: true }));
    setStatementComparePanel({
      accountId: account.id,
      accountName: account.name,
      checkpointMonth: checkpoint.month,
      statementStartDate: checkpoint.statementStartDate,
      statementEndDate: checkpoint.statementEndDate,
      deltaMinor: checkpoint.deltaMinor
    });
    setStatementCompareResult(null);
    setStatementCompareStatus(null);
    setReconciliationDialog(null);
  }

  function openStatementComparePanelFromDialog(item) {
    if (!reconciliationDialog?.accountId) {
      return;
    }

    openStatementComparePanel(
      {
        id: reconciliationDialog.accountId,
        name: reconciliationDialog.accountName
      },
      item
    );
  }

  function openCreateCategoryDialog() {
    setCategoryDialog({
      mode: "create",
      categoryId: "",
      name: "",
      slug: "",
      iconKey: FALLBACK_THEME.iconKey,
      colorHex: FALLBACK_THEME.colorHex
    });
  }

  function openEditCategoryDialog(category) {
    setCategoryDialog({
      mode: "edit",
      categoryId: category.id,
      name: category.name,
      slug: category.slug,
      iconKey: category.iconKey,
      colorHex: category.colorHex
    });
  }

  function openEditPersonDialog(person) {
    setPersonDialog({
      personId: person.id,
      name: person.name
    });
  }

  async function handleSaveAccount() {
    if (!accountDialog) {
      return;
    }

    setIsSubmitting(true);
    setAccountDialogError("");
    try {
      const endpoint = accountDialog.mode === "create" ? "/api/accounts/create" : "/api/accounts/update";
      const response = await fetch(endpoint, {
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

      if (!response.ok) {
        setAccountDialogError(await buildRequestErrorMessage(response, "Account save failed."));
        return;
      }

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
          statementStartDate: reconciliationDialog.statementStartDate || null,
          statementEndDate: reconciliationDialog.statementEndDate || null,
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

  async function handleDeleteCheckpoint(item) {
    if (!reconciliationDialog?.accountId) {
      return;
    }

    setIsSubmitting(true);
    try {
      await fetch("/api/accounts/checkpoints/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: reconciliationDialog.accountId,
          checkpointMonth: item.month
        })
      });
      setReconciliationDialog((current) => current ? {
        ...current,
        history: current.history.filter((historyItem) => historyItem.month !== item.month)
      } : current);
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDownloadCheckpointExport(item) {
    if (!reconciliationDialog?.accountId) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(buildCheckpointExportHref(reconciliationDialog.accountId, item.month), {
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, "Checkpoint export failed."));
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = getContentDispositionFilename(response.headers.get("Content-Disposition"))
        ?? `checkpoint-${reconciliationDialog.accountId}-${item.month}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Checkpoint export failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCompareStatementUpload(target, event) {
    const [file] = event.target.files ?? [];
    event.target.value = "";
    if (!file || !target?.accountId || !target?.checkpointMonth) {
      return;
    }

    setIsSubmitting(true);
    setStatementCompareResult(null);
    setStatementCompareStatus({ tone: "active", message: messages.settings.statementCompareReading(file.name) });
    try {
      let rows = [];
      let uploadedStatementStartDate;
      let uploadedStatementEndDate;
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        const parsed = parseStatementText(await extractPdfText(file), file.name);
        const selectedStatement = selectParsedStatementForCompare(parsed, target);
        rows = selectedStatement.rows;
        uploadedStatementStartDate = selectedStatement.checkpoint?.statementStartDate;
        uploadedStatementEndDate = selectedStatement.checkpoint?.statementEndDate;
      } else {
        rows = inspectCsv(await file.text()).rows;
      }

      setStatementCompareStatus({ tone: "active", message: messages.settings.statementCompareChecking(rows.length) });
      const response = await fetch("/api/accounts/checkpoints/compare-statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: target.accountId,
          checkpointMonth: target.checkpointMonth,
          uploadedStatementStartDate,
          uploadedStatementEndDate,
          rows
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Statement compare failed.");
      }

      setStatementCompareResult(data.comparison);
      setStatementCompareStatus({ tone: "success", message: messages.settings.statementCompareReady(data.comparison) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement compare failed.";
      setStatementCompareStatus({ tone: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEditCheckpoint(item) {
    setReconciliationDialog((current) => current ? {
      ...current,
      checkpointMonth: item.month,
      statementStartDate: item.statementStartDate ?? "",
      statementEndDate: item.statementEndDate ?? "",
      statementBalance: formatCheckpointStatementInputMinor(item.statementBalanceMinor, current.accountKind),
      note: item.note ?? ""
    } : current);
  }

  async function handleSaveCategory() {
    if (!categoryDialog?.name?.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint = categoryDialog.mode === "create" ? "/api/categories/create" : "/api/categories/update";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: categoryDialog.categoryId || undefined,
          name: categoryDialog.name,
          slug: categoryDialog.slug,
          iconKey: categoryDialog.iconKey,
          colorHex: categoryDialog.colorHex
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to save category");
      }
      setCategoryDialog(null);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to save category");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSavePerson() {
    if (!personDialog?.personId || !personDialog.name?.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/people/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: personDialog.personId,
          name: personDialog.name
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to update person");
      }
      setPersonDialog(null);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to update person");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCategory(category) {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/categories/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: category.id })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to delete category");
      }
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete category");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openTransferReview(entryId) {
    const params = new URLSearchParams(searchParams);
    params.set("view", viewId);
    params.set("month", searchParams.get("month") ?? DEFAULT_MONTH_KEY);
    params.set("entry_type", "transfer");
    params.set("editing_entry", entryId);
    navigate({ pathname: "/entries", search: params.toString() });
  }

  function toggleSettingsSection(sectionKey) {
    setSettingsSectionsOpen((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey]
    }));
  }

  return (
    <article className="panel settings-page">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.settings}</h2>
          <span className="panel-context">{messages.settings.viewing(viewLabel)}</span>
        </div>
      </div>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("people")}
          aria-expanded={settingsSectionsOpen.people}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.peopleTitle}</h3>
              <p>{messages.settings.peopleDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.people ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.people ? (
          <div className="settings-people-grid">
            {people.map((person) => (
              <div key={person.id} className="settings-account-row settings-person-card">
                <div className="settings-account-main">
                  <strong>{person.name}</strong>
                  <p>{messages.settings.personUsageHint}</p>
                </div>
                <div className="settings-account-actions">
                  <button type="button" className="icon-action" aria-label={messages.settings.editPerson} onClick={() => openEditPersonDialog(person)}>
                    <SquarePen size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("accounts")}
          aria-expanded={settingsSectionsOpen.accounts}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.accountsTitle}</h3>
              <p>{messages.settings.accountsDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.accounts ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.accounts ? (
          <>
            <div className="settings-actions">
              <button type="button" className="subtle-action" onClick={openCreateAccountDialog}>
                {messages.settings.addAccount}
              </button>
            </div>
            <p className="lede compact">{messages.settings.accountBalanceHint}</p>
            <div className="settings-accounts-grid">
              {visibleAccounts.map((account) => {
                const latestCheckpoint = account.latestCheckpointMonth
                  ? account.checkpointHistory?.find((item) => item.month === account.latestCheckpointMonth)
                  : null;
                return (
                  <div key={account.id} className={`settings-account-row settings-account-card ${!account.isActive ? "is-archived" : ""}`}>
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
                      {latestCheckpoint && account.latestCheckpointDeltaMinor != null && account.latestCheckpointDeltaMinor !== 0 ? (
                        <button type="button" className="settings-text-link" onClick={() => openStatementComparePanel(account, latestCheckpoint)}>
                          {messages.settings.statementCompareOpen}
                        </button>
                      ) : null}
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
                );
              })}
            </div>
            {statementComparePanel ? (
              <div className="settings-statement-compare-inline">
                <div className="settings-statement-compare-head">
                  <div>
                    <strong>{messages.settings.statementComparePanelTitle(statementComparePanel.accountName, formatMonthLabel(statementComparePanel.checkpointMonth))}</strong>
                            <p>{messages.settings.statementComparePanelDetail}</p>
                            {statementComparePanel.deltaMinor != null ? (
                              <p className="settings-account-health is-mismatch">{messages.settings.statementCompareDelta(money(Math.abs(statementComparePanel.deltaMinor)))}</p>
                            ) : null}
                            {statementComparePanel.statementStartDate && statementComparePanel.statementEndDate ? (
                              <p>{messages.settings.statementCompareCheckpointPeriod(formatDateOnly(statementComparePanel.statementStartDate), formatDateOnly(statementComparePanel.statementEndDate))}</p>
                            ) : null}
                  </div>
                  <button type="button" className="subtle-cancel" onClick={() => setStatementComparePanel(null)}>
                    Cancel
                  </button>
                </div>
                <input
                  id="statement-compare-account-upload"
                  type="file"
                  accept=".csv,text/csv,.pdf,application/pdf"
                  hidden
                  onChange={(event) => void handleCompareStatementUpload(statementComparePanel, event)}
                />
                <button
                  type="button"
                  className="subtle-action is-primary"
                  disabled={isSubmitting}
                  onClick={() => document.getElementById("statement-compare-account-upload")?.click()}
                >
                  {messages.settings.statementCompareUpload}
                </button>
                {statementCompareStatus ? (
                  <section className={`settings-statement-compare is-${statementCompareStatus.tone}`}>
                    <strong>{messages.settings.statementCompareTitle}</strong>
                    <p>{statementCompareStatus.message}</p>
                  </section>
                ) : null}
                {statementCompareResult ? (
                  <StatementCompareResultView
                    result={statementCompareResult}
                    deltaMinor={statementComparePanel.deltaMinor}
                    accounts={accounts}
                    categories={categories}
                    people={people}
                    onRowsMatched={(statementRow, ledgerRow) => {
                      setStatementCompareResult((current) => current ? {
                        ...current,
                        matchedRowCount: current.matchedRowCount + 1,
                        unmatchedStatementRows: current.unmatchedStatementRows.filter((row) => row.id !== statementRow.id),
                        unmatchedLedgerRows: current.unmatchedLedgerRows.filter((row) => row.id !== ledgerRow.id),
                        possibleMatches: current.possibleMatches.filter((candidate) => (
                          candidate.statementRow.id !== statementRow.id
                          && candidate.ledgerRow.id !== ledgerRow.id
                        ))
                      } : current);
                      setStatementComparePanel((current) => current ? {
                        ...current,
                        deltaMinor: typeof current.deltaMinor === "number"
                          ? current.deltaMinor + statementRow.signedAmountMinor - ledgerRow.signedAmountMinor
                          : current.deltaMinor
                      } : current);
                      setStatementCompareStatus({ tone: "success", message: messages.settings.statementCompareDirectionFixed });
                      void onRefresh();
                    }}
                    onEntryAdded={(rowId) => {
                      setStatementCompareResult((current) => current ? {
                        ...current,
                        ledgerRowCount: current.ledgerRowCount + 1,
                        unmatchedStatementRows: current.unmatchedStatementRows.filter((row) => row.id !== rowId)
                      } : current);
                      setStatementCompareStatus({ tone: "success", message: messages.settings.statementCompareEntryAdded });
                      void onRefresh();
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("categories")}
          aria-expanded={settingsSectionsOpen.categories}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.categoriesTitle}</h3>
              <p>{messages.settings.categoriesDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.categories ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.categories ? (
          <>
            <div className="settings-actions">
              <button type="button" className="subtle-action" onClick={openCreateCategoryDialog}>
                {messages.settings.addCategory}
              </button>
            </div>
            <div className="settings-categories-grid">
              {visibleCategories.map((category) => (
                <div key={category.id} className="settings-account-row settings-category-card">
                  <span
                    className="category-icon category-icon-static settings-category-icon"
                    style={{ "--category-color": category.colorHex }}
                  >
                    <CategoryGlyph iconKey={category.iconKey} />
                  </span>
                  <div className="settings-account-main">
                    <strong>{category.name}</strong>
                    <p>{messages.common.triplet(category.slug, category.iconKey, category.colorHex)}</p>
                  </div>
                  <div className="settings-account-actions">
                    <button type="button" className="icon-action" aria-label={messages.settings.editCategory} onClick={() => openEditCategoryDialog(category)}>
                      <SquarePen size={16} />
                    </button>
                    <DeleteRowButton
                      label={category.name}
                      triggerLabel={messages.settings.deleteCategory}
                      confirmLabel={messages.settings.deleteCategory}
                      destructive={false}
                      prompt={messages.settings.deleteCategoryDetail(category.name)}
                      onConfirm={() => handleDeleteCategory(category)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("trust")}
          aria-expanded={settingsSectionsOpen.trust}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.trustRulesTitle}</h3>
              <p>{messages.settings.trustRulesDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.trust ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.trust ? (
          <div className="settings-trust-grid">
            <div className="settings-demo-meta-item">
              <span>{messages.settings.trustOpeningTitle}</span>
              <strong>{messages.settings.trustOpeningDetail}</strong>
              <p>{messages.settings.trustOpeningAction}</p>
            </div>
            <div className="settings-demo-meta-item">
              <span>{messages.settings.trustCheckpointTitle}</span>
              <strong>{messages.settings.trustCheckpointDetail}</strong>
              <p>{messages.settings.trustCheckpointAction}</p>
            </div>
            <div className="settings-demo-meta-item">
              <span>{messages.settings.trustTransfersTitle}</span>
              <strong>{messages.settings.trustTransfersDetail}</strong>
              <p>{messages.settings.trustTransfersAction}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("transfers")}
          aria-expanded={settingsSectionsOpen.transfers}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.unresolvedTransfersTitle}</h3>
              <p>{messages.settings.unresolvedTransfersDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.transfers ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.transfers ? (
          <>
            <div className="settings-transfer-list">
              {settingsPage.unresolvedTransfers.length ? settingsPage.unresolvedTransfers.map((item) => (
                <div key={item.entryId} className="settings-account-row settings-transfer-row">
                  <div className="settings-account-main settings-transfer-main">
                    <strong>{item.description}</strong>
                    <p>{messages.common.triplet(formatDateOnly(item.date), item.accountName, item.transferDirection === "in" ? "Transfer in" : "Transfer out")}</p>
                  </div>
                  <strong className="settings-transfer-amount">{money(item.transferDirection === "out" ? -item.amountMinor : item.amountMinor)}</strong>
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
          </>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("activity")}
          aria-expanded={settingsSectionsOpen.activity}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.recentActivityTitle}</h3>
              <p>{messages.settings.recentActivityDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.activity ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.activity ? (
          <div className="settings-activity-groups">
            {recentActivityGroups.length ? recentActivityGroups.map((group) => (
              <section key={group.date} className="settings-activity-group">
                <div className="settings-activity-date">{formatDateOnly(group.date)}</div>
                <div className="settings-activity-list">
                  {group.events.map((event) => (
                    <div key={event.id} className="settings-account-row settings-activity-row">
                      <div className="settings-account-main">
                        <strong>{formatAuditAction(event.action)}</strong>
                        <p>{event.detail}</p>
                      </div>
                      <p className="settings-account-meta">{formatDate(event.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )) : (
              <p className="lede compact">{messages.common.emptyValue}</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => setDemoStateOpen((current) => !current)}
          aria-expanded={demoStateOpen}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.demoTitle}</h3>
              <p>{messages.settings.demoDetail}</p>
            </div>
            <div className="settings-demo-meta">
              <div className="settings-demo-meta-item">
                <span>{messages.settings.salaryPerPerson}</span>
                <strong>{money(settingsPage.demo.salaryPerPersonMinor)}</strong>
              </div>
              <div className="settings-demo-meta-item">
                <span>{messages.settings.state}</span>
                <strong>{settingsPage.demo.emptyState ? messages.settings.emptyMode : messages.settings.seededMode}</strong>
              </div>
              <div className="settings-demo-meta-item">
                <span>{messages.settings.seededAt}</span>
                <strong>{formatDate(settingsPage.demo.lastSeededAt)}</strong>
              </div>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${demoStateOpen ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {demoStateOpen ? (
          <>
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
                      <div>
                        <Dialog.Title>{messages.settings.emptyState}</Dialog.Title>
                        <Dialog.Description>{messages.settings.emptyStateDetail}</Dialog.Description>
                      </div>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="icon-action subtle-cancel"
                          aria-label="Close empty-state dialog"
                        >
                          <X size={16} />
                        </button>
                      </Dialog.Close>
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
          </>
        ) : null}
      </section>

      <SettingsPersonDialog
        dialog={personDialog}
        isSubmitting={isSubmitting}
        onChange={setPersonDialog}
        onClose={() => setPersonDialog(null)}
        onSave={handleSavePerson}
      />

      <SettingsAccountDialog
        dialog={accountDialog}
        error={accountDialogError}
        people={people}
        isSubmitting={isSubmitting}
        onChange={setAccountDialog}
        onClose={() => {
          setAccountDialog(null);
          setAccountDialogError("");
        }}
        onSave={handleSaveAccount}
      />

      <SettingsCategoryDialog
        dialog={categoryDialog}
        isSubmitting={isSubmitting}
        onChange={setCategoryDialog}
        onClose={() => setCategoryDialog(null)}
        onSave={handleSaveCategory}
      />

      <SettingsReconciliationDialog
        dialog={reconciliationDialog}
        isSubmitting={isSubmitting}
        checkpointHistoryYears={checkpointHistoryYears}
        checkpointHistoryYear={checkpointHistoryYear}
        visibleCheckpointHistory={visibleCheckpointHistory}
        onChange={setReconciliationDialog}
        onHistoryYearChange={setCheckpointHistoryYear}
        onClose={() => {
          setReconciliationDialog(null);
          setStatementCompareResult(null);
          setStatementCompareStatus(null);
        }}
        onSave={handleSaveReconciliation}
        onEditCheckpoint={handleEditCheckpoint}
        onDownloadCheckpoint={handleDownloadCheckpointExport}
        onCompareCheckpoint={openStatementComparePanelFromDialog}
        renderCheckpointDeleteAction={(item) => (
          <DeleteRowButton
            label={formatMonthLabel(item.month)}
            triggerLabel={messages.settings.checkpointDelete}
            confirmLabel={messages.settings.checkpointDelete}
            destructive={false}
            prompt={messages.settings.checkpointDeleteDetail(formatMonthLabel(item.month))}
            onConfirm={() => handleDeleteCheckpoint(item)}
          />
        )}
        formatCheckpointMonth={(item) => formatMonthLabel(item.month)}
        formatCheckpointCoverage={formatCheckpointCoverage}
        formatCheckpointBalanceLine={(item) => formatCheckpointHistoryBalanceLine(item, reconciliationDialog?.accountKind)}
        formatCheckpointDelta={(item) => (item.deltaMinor === 0 ? "Matched" : `Delta ${money(Math.abs(item.deltaMinor))}`)}
      />

    </article>
  );
}

function StatementCompareResultView({ result, deltaMinor, accounts, categories, people, onEntryAdded, onRowsMatched }) {
  const directionMismatches = result.possibleMatches.filter((candidate) => candidate.amountDirectionMismatch);
  const duplicateStatementGroups = result.duplicateStatementGroups ?? [];
  const duplicateLedgerGroups = result.duplicateLedgerGroups ?? [];
  return (
    <section className="settings-statement-compare">
      <strong>{messages.settings.statementCompareSummary(result)}</strong>
      {deltaMinor != null ? (
        <p className="settings-account-health is-mismatch">{messages.settings.statementCompareDelta(money(Math.abs(deltaMinor)))}</p>
      ) : null}
      <div className="settings-statement-compare-periods">
        <p>{messages.settings.statementCompareCheckpointPeriod(
          result.statementStartDate ? formatDateOnly(result.statementStartDate) : messages.common.emptyValue,
          formatDateOnly(result.statementEndDate)
        )}</p>
        <p>{messages.settings.statementCompareUploadedPeriod(
          result.uploadedStatementStartDate ? formatDateOnly(result.uploadedStatementStartDate) : messages.common.emptyValue,
          result.uploadedStatementEndDate ? formatDateOnly(result.uploadedStatementEndDate) : messages.common.emptyValue
        )}</p>
      </div>
      {result.possibleMatches.length ? (
        <div className="settings-statement-compare-block">
          <h3>{messages.settings.statementComparePossibleTitle}</h3>
          {result.possibleMatches.slice(0, 5).map((candidate) => (
            <p key={`${candidate.statementRow.id}-${candidate.ledgerRow.id}`}>
              {messages.settings.statementComparePossibleRow(candidate)}
            </p>
          ))}
        </div>
      ) : null}
      {directionMismatches.length ? (
        <div className="settings-statement-compare-block is-warning">
          <h3>{messages.settings.statementCompareDirectionTitle}</h3>
          <p className="settings-statement-compare-explainer">{messages.settings.statementCompareDirectionDetail}</p>
          {directionMismatches.slice(0, 5).map((candidate) => (
            <StatementCompareDirectionMismatch
              key={`${candidate.statementRow.id}-${candidate.ledgerRow.id}`}
              candidate={candidate}
              categories={categories}
              onRowsMatched={onRowsMatched}
            />
          ))}
        </div>
      ) : null}
      <div className="settings-statement-compare-block">
        <h3>{messages.settings.statementCompareDuplicateTitle}</h3>
        {duplicateStatementGroups.length || duplicateLedgerGroups.length ? (
          <>
            <p>{messages.settings.statementCompareDuplicateSummary(duplicateStatementGroups.length, duplicateLedgerGroups.length)}</p>
            <StatementCompareDuplicateGroups title={messages.settings.statementCompareDuplicateStatement} groups={duplicateStatementGroups} />
            <StatementCompareDuplicateGroups title={messages.settings.statementCompareDuplicateLedger} groups={duplicateLedgerGroups} />
          </>
        ) : (
          <p>{messages.settings.statementCompareDuplicateNone}</p>
        )}
      </div>
      <div className="settings-statement-compare-grid">
        <div>
          <h3>{messages.settings.statementCompareMissingTitle}</h3>
          {result.unmatchedStatementRows.length ? result.unmatchedStatementRows.slice(0, 12).map((row) => (
            <StatementCompareMissingRow
              key={row.id}
              row={row}
              result={result}
              accounts={accounts}
              categories={categories}
              people={people}
              onEntryAdded={onEntryAdded}
            />
          )) : <p>{messages.settings.statementCompareNone}</p>}
        </div>
        <div>
          <h3>{messages.settings.statementCompareExtraTitle}</h3>
          {result.unmatchedLedgerRows.length ? result.unmatchedLedgerRows.slice(0, 12).map((row) => (
            <StatementCompareDisplayRow key={row.id} row={row} />
          )) : <p>{messages.settings.statementCompareNone}</p>}
        </div>
      </div>
    </section>
  );
}

function StatementCompareDuplicateGroups({ title, groups }) {
  if (!groups.length) {
    return null;
  }

  return (
    <div className="settings-statement-duplicate-groups">
      <strong>{title}</strong>
      {groups.slice(0, 5).map((group, index) => (
        <div className="settings-statement-duplicate-group" key={`${title}-${index}`}>
          {group.rows.map((row) => <StatementCompareDisplayRow key={row.id} row={row} />)}
        </div>
      ))}
    </div>
  );
}

function StatementCompareDirectionMismatch({ candidate, categories, onRowsMatched }) {
  const defaultCategoryName = candidate.statementRow.entryType === "transfer"
    ? "Transfer"
    : candidate.statementRow.categoryName && categories.some((category) => category.name === candidate.statementRow.categoryName)
      ? candidate.statementRow.categoryName
      : categories.find((category) => category.name === "Other - Income")?.name
        ?? categories.find((category) => category.name === "Other")?.name
        ?? categories[0]?.name
        ?? "";
  const [draft, setDraft] = useState(() => ({
    entryType: candidate.statementRow.entryType,
    transferDirection: candidate.statementRow.transferDirection ?? (candidate.statementRow.entryType === "transfer" ? candidate.statementRow.signedAmountMinor > 0 ? "in" : "out" : undefined),
    categoryName: defaultCategoryName
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  function updateDraft(patch) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.entryType === "transfer") {
        next.categoryName = "Transfer";
        next.transferDirection = next.transferDirection ?? "out";
      } else {
        next.transferDirection = undefined;
        if (next.categoryName === "Transfer") {
          next.categoryName = defaultCategoryName === "Transfer"
            ? categories.find((category) => category.name === "Other")?.name ?? categories[0]?.name ?? ""
            : defaultCategoryName;
        }
      }
      return next;
    });
  }

  async function saveDraft() {
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/entries/update-classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: candidate.ledgerRow.id,
          entryType: draft.entryType,
          transferDirection: draft.transferDirection,
          categoryName: draft.categoryName
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update ledger row.");
      }
      setOpen(false);
      onRowsMatched?.(candidate.statementRow, candidate.ledgerRow);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Failed to update ledger row.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-statement-direction-row">
      <StatementCompareDisplayRow row={candidate.statementRow} label={messages.settings.statementCompareMissingTitle} />
      <div>
        <StatementCompareDisplayRow row={candidate.ledgerRow} label={messages.settings.statementCompareExtraTitle} />
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button type="button" className="settings-text-link">{messages.settings.statementCompareFixDirection}</button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="settings-statement-entry-popover" sideOffset={8} align="end">
              <strong>{messages.settings.statementCompareFixDirectionTitle}</strong>
              <div className="settings-statement-entry-form">
                <label className="table-edit-field">
                  <span>{messages.imports.table.type}</span>
                  <select className="table-edit-input" value={draft.entryType} onChange={(event) => updateDraft({ entryType: event.target.value })}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </label>
                {draft.entryType === "transfer" ? (
                  <label className="table-edit-field">
                    <span>Direction</span>
                    <select className="table-edit-input" value={draft.transferDirection ?? "out"} onChange={(event) => updateDraft({ transferDirection: event.target.value })}>
                      <option value="out">Out</option>
                      <option value="in">In</option>
                    </select>
                  </label>
                ) : (
                  <label className="table-edit-field">
                    <span>{messages.imports.table.category}</span>
                    <select className="table-edit-input" value={draft.categoryName} onChange={(event) => updateDraft({ categoryName: event.target.value })}>
                      {categories.map((category) => (
                        <option key={category.id} value={category.name}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {error ? <p className="form-error">{error}</p> : null}
              <div className="dialog-actions">
                <button type="button" className="subtle-cancel" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="dialog-primary" disabled={isSaving || !draft.entryType || !draft.categoryName} onClick={() => void saveDraft()}>
                  {messages.settings.statementCompareFixDirectionSave}
                </button>
              </div>
              <Popover.Arrow className="category-popover-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

function StatementCompareDisplayRow({ row, label }) {
  return (
    <div className="settings-statement-row">
      {label ? <span className="settings-statement-row-label">{label}</span> : null}
      <span>{formatDateOnly(row.date)}</span>
      <strong className={getAmountToneClass(row.signedAmountMinor)}>{money(row.signedAmountMinor)}</strong>
      <p>{row.description}</p>
    </div>
  );
}

function StatementCompareMissingRow({ row, result, accounts, categories, people, onEntryAdded }) {
  const account = accounts.find((item) => item.name === result.accountName);
  const preferredOwnerName = people.find((person) => person.name === account?.ownerLabel)?.name ?? people[0]?.name ?? "";
  const defaultCategoryName = row.entryType === "transfer"
    ? "Transfer"
    : row.categoryName && categories.some((category) => category.name === row.categoryName)
      ? row.categoryName
      : categories.find((category) => category.name === "Other")?.name ?? categories[0]?.name ?? "";
  const [draft, setDraft] = useState(() => ({
    date: row.date,
    description: row.description,
    accountName: result.accountName,
    categoryName: defaultCategoryName,
    amountMinor: row.amountMinor,
    entryType: row.entryType,
    transferDirection: row.transferDirection ?? (row.entryType === "transfer" ? row.signedAmountMinor > 0 ? "in" : "out" : undefined),
    ownershipType: "direct",
    ownerName: preferredOwnerName,
    note: row.note ?? ""
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  function updateDraft(patch) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.entryType === "transfer") {
        next.categoryName = "Transfer";
        next.transferDirection = next.transferDirection ?? "out";
      } else if (next.categoryName === "Transfer") {
        next.categoryName = defaultCategoryName === "Transfer" ? "Other" : defaultCategoryName;
        next.transferDirection = undefined;
      } else {
        next.transferDirection = undefined;
      }
      if (next.ownershipType !== "direct") {
        next.ownerName = undefined;
      } else {
        next.ownerName = next.ownerName || preferredOwnerName;
      }
      return next;
    });
  }

  async function saveDraft() {
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/entries/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to add ledger entry.");
      }
      setOpen(false);
      onEntryAdded?.(row.id);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Failed to add ledger entry.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-statement-row settings-statement-row-action">
      <span>{formatDateOnly(row.date)}</span>
      <strong className={getAmountToneClass(row.signedAmountMinor)}>{money(row.signedAmountMinor)}</strong>
      <p>{row.description}</p>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" className="settings-text-link">{messages.settings.statementCompareAddEntry}</button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="settings-statement-entry-popover" sideOffset={8} align="end">
            <strong>{messages.settings.statementCompareAddEntryTitle}</strong>
            <div className="settings-statement-entry-form">
              <label className="table-edit-field">
                <span>{messages.imports.table.date}</span>
                <input className="table-edit-input" type="date" value={draft.date} onChange={(event) => updateDraft({ date: event.target.value })} />
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.account}</span>
                <select className="table-edit-input" value={draft.accountName} onChange={(event) => updateDraft({ accountName: event.target.value })}>
                  {accounts.map((accountOption) => (
                    <option key={accountOption.id} value={accountOption.name}>{accountOption.name}</option>
                  ))}
                </select>
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.description}</span>
                <input className="table-edit-input" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.amount}</span>
                <input className="table-edit-input" value={formatMinorInput(draft.amountMinor)} onChange={(event) => updateDraft({ amountMinor: parseMoneyInput(event.target.value, draft.amountMinor) })} />
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.type}</span>
                <select className="table-edit-input" value={draft.entryType} onChange={(event) => updateDraft({ entryType: event.target.value })}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>
              {draft.entryType === "transfer" ? (
                <label className="table-edit-field">
                  <span>Direction</span>
                  <select className="table-edit-input" value={draft.transferDirection ?? "out"} onChange={(event) => updateDraft({ transferDirection: event.target.value })}>
                    <option value="out">Out</option>
                    <option value="in">In</option>
                  </select>
                </label>
              ) : (
                <label className="table-edit-field">
                  <span>{messages.imports.table.category}</span>
                  <select className="table-edit-input" value={draft.categoryName} onChange={(event) => updateDraft({ categoryName: event.target.value })}>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="table-edit-field">
                <span>{messages.imports.table.owner}</span>
                <select className="table-edit-input" value={draft.ownershipType === "shared" ? "shared" : draft.ownerName} onChange={(event) => {
                  if (event.target.value === "shared") {
                    updateDraft({ ownershipType: "shared", ownerName: undefined });
                  } else {
                    updateDraft({ ownershipType: "direct", ownerName: event.target.value });
                  }
                }}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                  <option value="shared">{messages.entries.shared}</option>
                </select>
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.note}</span>
                <input className="table-edit-input" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} />
              </label>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="dialog-primary" disabled={isSaving || !draft.date || !draft.description || !draft.accountName || !draft.categoryName || !draft.amountMinor} onClick={() => void saveDraft()}>
                {messages.settings.statementCompareAddEntrySave}
              </button>
            </div>
            <Popover.Arrow className="category-popover-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
