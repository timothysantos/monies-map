// First, so these rules load before the stylesheets the modules below import.
import "./month-route.css";
import { PlanIslandActions } from "./plan-island-actions";
import { spendingMinor } from "../domain/category-offset";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { messages } from "./copy/en-SG";
import { monthMessages } from "./copy/en-SG-month";
import { planStudioAddCopy } from "./copy/plan-studio-add-copy";
import MonthNoteDialog from "./month-note-dialog";
import { MonthPlanLinkDialog } from "./month-plan-link-dialog";
import { NoteSheetDialog } from "./note-sheet-dialog";
import { useDraftChanged } from "./use-draft-changed";
import { MonthPlanSheet } from "./month-plan-sheet";
import { useHashTarget } from "./use-hash-target";
import { buildMonthSliceFacts } from "./month-slice-facts";
import { FinancialInsight } from "./financial-insight";
import { checkInMemoryKey, useCheckInClock } from "./checkin-visit-memory";
import { moniesClient } from "./monies-client-service";
import { MonthLead, MonthMoneyIn, MonthNotesAndAccounts, MonthPanelHeader, useMonthLead } from "./month-overview";
import {
  buildMobileMonthIncomeDialog,
  buildMobileMonthPlanDialog,
  canInlineEditMonthRow,
  canInlineEditMonthPlanRow,
  canOpenMonthMobileSheet,
  getMonthRowOwnerLabel
} from "./month-row-editing";
import { MonthPlanStack } from "./month-plan-tables";
import { sectionForNewLine } from "./plan-line-section";
import { PlanModeSwitch } from "./plan-mode-switch";
import { usePlanMode } from "./plan-mode";
import {
  buildSavedMonthPlanFields,
  getMonthPlanEditSource,
  mergeMonthPlanSections,
  mergeMonthRowsById
} from "./month-state";
import { buildMonthMutationRefreshPlan } from "./month-workflow";
import { buildRequestErrorMessage } from "./request-errors";
import { getRowDateValue } from "./table-helpers";
import { selectMonthInsightEntries } from "./month-insight-facts";
import { selectMonthSpendingMix } from "./month-spending-mix";
import { SpendingMixSection } from "./spending-mix-section";
import { PaceLine } from "./pace-line";
import { useRepeatingCharges } from "./use-repeating-charges";
import { useMoneyPrivacy } from "./money-privacy";
import { buildMonthSignals, monthCalmLines, MONTH_TRIVIA_ROTATION } from "../domain/money-signals/month-signals";
import { withoutPlanSignals } from "../domain/money-signals/plan-signals";
import { useRouteWorkReport } from "./use-route-work-status";
import { isMonthSheetLayout, useIsMonthSheetLayout } from "./use-viewport";
// Mid-width table layout; ships with this lazy route, not the first screen.
import "./month-mid-width.css";
import "./month-plan-rows.css";

// Plan Studio (design.md "Plan Studio") is its own chunk, fetched when the
// page is in Plan view; Simple view never loads it. Until it arrives an empty
// block of the studio's size holds its place, so the page below does not jump.
const PlanStudio = lazy(() => import("./plan-studio.jsx"));
function PlanStudioReserve({ children = null }) {
  return (
    <div className="plan-studio-reserve" aria-hidden={children ? undefined : "true"} data-plan-studio-reserve>
      {children ? <div className="ps-toolbar">{children}</div> : null}
    </div>
  );
}

const MONTH_SECTION_STATE_CACHE = new Map();
const {
  accounts: accountService,
  categories: categoryService,
  entries: entryService,
  format: formatService,
  months: monthService
} = moniesClient;

// This panel owns the "editable month workspace":
// - local draft rows so the UI responds immediately
// - background refreshes so derived totals settle after saves
// - route-level dialogs such as notes, plan links, and mobile editors
//
// Without the shell's notice (isolated renders), a failed refresh is dropped.
function pickPlanLinkSelection(dialog) {
  return [dialog.rowId, [...(dialog.draftEntryIds ?? [])].sort()];
}

// The pace's read when the shell hands none (it then never runs).
function rejectRead() {
  return Promise.reject(new Error("No read"));
}

function runQuietly(task, _retry) {
  return Promise.resolve().then(task).catch(() => null);
}

export function MonthPanel({ view, accounts, people, categories, onCategoryAppearanceChange, onRefresh, runBackgroundRefresh = runQuietly, isDemoEnvironment = false, cardsUsable = false, fetchRequiredQuery = undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { areTotalsVisible } = useMoneyPrivacy();
  const monthUiKey = `${view.id}:${view.monthPage.month}:${view.monthPage.selectedScope}`;
  const [planSections, setPlanSections] = useState(view.monthPage.planSections ?? []);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [editingDrafts, setEditingDrafts] = useState(/** @type {Record<string, any>} */ ({}));
  const [incomeRows, setIncomeRows] = useState(view.monthPage.incomeRows ?? []);
  const [sectionOpen, setSectionOpen] = useState(() => MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? monthService.getDefaultSectionOpen());
  const [noteDialog, setNoteDialog] = useState(null);
  const [isSavingRowNote, setIsSavingRowNote] = useState(false);
  const [rowNoteError, setRowNoteError] = useState("");
  const rowNoteSaveInFlightRef = useRef(false);
  const rowRemoveInFlightRef = useRef(false);
  const [planLinkDialog, setPlanLinkDialog] = useState(null);
  const [isSavingPlanLinks, setIsSavingPlanLinks] = useState(false);
  const [planLinkError, setPlanLinkError] = useState("");
  // Set synchronously so a double click cannot start a second save before
  // the saving state renders.
  const planLinkSaveInFlightRef = useRef(false);
  const [resetMonthText, setResetMonthText] = useState("");
  const [deleteMonthText, setDeleteMonthText] = useState("");
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [isSavingMonthNote, setIsSavingMonthNote] = useState(false);
  const [monthNoteError, setMonthNoteError] = useState("");
  const [isDraftingMonthNote, setIsDraftingMonthNote] = useState(false);
  const [isSavingMonthRow, setIsSavingMonthRow] = useState(false);
  const [monthRowError, setMonthRowError] = useState("");
  const [mobileAddDialog, setMobileAddDialog] = useState(null);
  // Studio | Tables (plan-mode.js). Studio stays mounted, hidden, once it has
  // been shown, so changes held there survive a look at Tables.
  const [planMode, setPlanMode] = usePlanMode();
  const [studioDirty, setStudioDirty] = useState(false);
  const [studioSaving, setStudioSaving] = useState(false);
  const studioShownRef = useRef(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const useMobileMonthSheet = useIsMonthSheetLayout();
  const [isMonthDataRefreshing, setIsMonthDataRefreshing] = useState(false);
  const [isRemovingMonthRow, setIsRemovingMonthRow] = useState(false);
  const previousMonthActualCacheRef = useRef(new Map());
  const [tableSorts, setTableSorts] = useState({
    income: null,
    planned_items: null,
    budget_buckets: null
  });
  const categorySelectOptions = useMemo(() => categoryService.listForSelect(categories), [categories]);
  const isCombinedHouseholdView = view.id === "household" && view.monthPage.selectedScope === "direct_plus_shared";

  useEffect(() => {
    setPlanSections(view.monthPage.planSections ?? []);
    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
    setNoteDialog(null);
    setPlanLinkDialog(null);
    setMonthNoteDialog(null);
    setMobileAddDialog(null);
    setTableSorts({
      income: null,
      planned_items: null,
      budget_buckets: null
    });
    setIncomeRows(view.monthPage.incomeRows ?? []);
    setIsMonthDataRefreshing(false);
  }, [monthUiKey]);

  useEffect(() => {
    setPlanSections((current) => mergeMonthPlanSections(current ?? [], view.monthPage.planSections ?? []));
  }, [view.monthPage.planSections]);

  useEffect(() => {
    setIncomeRows((current) => mergeMonthRowsById(current ?? [], view.monthPage.incomeRows ?? []));
  }, [view.monthPage.incomeRows]);

  useEffect(() => {
    setSectionOpen(MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? monthService.getDefaultSectionOpen());
  }, [monthUiKey]);

  // Summary cards borrow the selected month's rollup from the already-loaded
  // summary payload instead of refetching anything here.
  const selectedMonthSummary = useMemo(
    () => view.summaryPage?.months?.find((month) => month.month === view.monthPage.month) ?? null,
    [view]
  );
  const planLinkRowId = planLinkDialog?.rowId ?? null;
  // Only the ticked entries are the draft; the filters are just the view.
  const hasPlanLinkChanges = useDraftChanged(planLinkDialog, pickPlanLinkSelection);
  const planLinkTargetRow = useMemo(
    () => planLinkRowId ? monthService.getPlanRowById(planSections, planLinkRowId) : null,
    [planLinkRowId, planSections]
  );
  // Scoring every month entry is the expensive part, so it runs when the
  // picker opens on a row, not on each checkbox or filter change. Candidate
  // objects then keep their identity and memoized candidate rows skip.
  const planLinkCandidates = useMemo(
    () => planLinkTargetRow
      ? monthService.buildPlanLinkCandidates({
        row: planLinkTargetRow,
        monthEntries: view.monthPage.entries,
        monthKey: view.monthPage.month
      })
      : [],
    [planLinkTargetRow, view.monthPage.entries, view.monthPage.month]
  );
  const planLinkPickerModel = useMemo(() => {
    if (!planLinkTargetRow) {
      return {
        row: null,
        allCandidates: [],
        candidates: [],
        selectedIds: new Set()
      };
    }

    const allCandidates = planLinkCandidates;
    const selectedIds = new Set(planLinkDialog?.draftEntryIds ?? []);
    const rowCategory = (planLinkTargetRow.categoryName ?? "").trim().toLowerCase();
    const rowAccount = (planLinkTargetRow.accountName ?? "").trim().toLowerCase();
    const filterText = (planLinkDialog?.descriptionFilter ?? "").trim().toLowerCase();
    const candidates = allCandidates.filter((entry) => {
      const isSelected = selectedIds.has(entry.id);
      const entryCategory = (entry.categoryName ?? "").trim().toLowerCase();
      const entryAccount = (entry.accountName ?? "").trim().toLowerCase();
      const description = (entry.description ?? "").trim().toLowerCase();
      if (planLinkDialog?.filterLinkedOnly && !isSelected) {
        return false;
      }
      if (!isSelected && planLinkDialog?.filterSameCategoryOnly && rowCategory && entryCategory !== rowCategory) {
        return false;
      }
      if (!isSelected && planLinkDialog?.filterSameAccountOnly && rowAccount && entryAccount !== rowAccount) {
        return false;
      }
      if (!isSelected && planLinkDialog?.filterCurrentMonthOnly && entry.date.slice(0, 7) !== view.monthPage.month) {
        return false;
      }
      if (filterText && !description.includes(filterText)) {
        return false;
      }
      return true;
    });

    return {
      row: planLinkTargetRow,
      allCandidates,
      candidates,
      selectedIds
    };
  }, [planLinkCandidates, planLinkDialog, planLinkTargetRow, view.monthPage.month]);

  const monthMetricCards = useMemo(
    () => monthService.buildMetricCards({ planSections, incomeRows, currentMonthSummary: selectedMonthSummary }),
    [selectedMonthSummary, incomeRows, planSections]
  );
  const visibleAccounts = useMemo(
    () => monthService.getVisibleAccounts(accounts, view.id),
    [accounts, view.id]
  );
  // The Accounts section and the check-in's statement-gap Quick fix read
  // balances and statement health from the view's account pills.
  const accountsWithHealth = useMemo(
    () => monthService.withAccountHealth(visibleAccounts, view.accountPills),
    [view.accountPills, visibleAccounts]
  );
  // Spending Mix for this month, from the Month page DTO (no request).
  const monthSpendingMix = useMemo(() => selectMonthSpendingMix(view.monthPage), [view.monthPage]);
  // The check-in counts the entries the Actual spend card counts (a person's
  // own, in the selected scope), not every household entry the DTO carries.
  const insightEntries = useMemo(
    () => selectMonthInsightEntries(view.monthPage, view.id),
    [view.id, view.monthPage]
  );
  const checkInClock = useCheckInClock();
  // The lead's model and the page's Plan | Simple view (lead-view.js).
  const monthLead = useMonthLead({
    cards: monthMetricCards,
    monthSummary: selectedMonthSummary,
    planSections,
    categoryShare: view.monthPage.categoryShareChart,
    investmentMoves: view.monthPage.investmentMoves ?? null
  });
  const isSimple = monthLead.leadView === "simple";
  // A month with no plan rows and no income has nothing for Plan Studio to
  // show: it neither loads nor holds space.
  const hasPlanStudioRows = (incomeRows?.length ?? 0) > 0 || (planSections ?? []).some((section) => (section.rows?.length ?? 0) > 0);
  // A month with nothing planned has only the tables, where its first line is
  // added; otherwise the person's mode (Studio by default).
  const effectivePlanMode = hasPlanStudioRows ? planMode : "tables";
  if (effectivePlanMode === "studio") studioShownRef.current = true;
  // The Sliders | List switch: in the toolbar's row while sliders show, on a
  // row of its own over the list (which has no toolbar).
  const planModeSwitch = hasPlanStudioRows ? (
    <PlanModeSwitch mode={planMode} onChange={setPlanMode} studioDirty={studioDirty} inline />
  ) : null;
  // A Spending Mix slice's plan and merchants, from what the page holds.
  const monthSliceFacts = useMemo(
    () => buildMonthSliceFacts({ planRows: planSections.flatMap((section) => section.rows ?? []), entries: insightEntries }),
    [insightEntries, planSections]
  );
  // A plan figure's "Open plan" (figure-menu.js) lands on the plan.
  useHashTarget(!isSimple && Boolean(monthLead.model));
  // If this keeps up (DOMAIN.md "Pace"): today's month only, read once the
  // page is usable, the same answer Summary's Subscriptions and bills card
  // reads (one request for both). Month's insight lines use it too.
  const isPaceMonth = view.monthPage.month === checkInClock.today.slice(0, 7);
  const { answer: repeatingAnswer } = useRepeatingCharges({
    queryClient,
    viewId: view.id,
    scope: view.monthPage.selectedScope,
    enabled: Boolean(cardsUsable && fetchRequiredQuery && isPaceMonth),
    fetchRequiredQuery: fetchRequiredQuery ?? rejectRead
  });
  const pace = isPaceMonth && repeatingAnswer?.pace?.month === view.monthPage.month && repeatingAnswer.pace.range ? repeatingAnswer.pace : null;
  const checkIn = useMemo(() => ({
    memoryKey: checkInMemoryKey("month", view.id),
    contextKey: `${view.monthPage.month}|${view.monthPage.selectedScope}${isSimple ? "|simple" : ""}`,
    // Simple shows no plan, so it leaves out the insights about the plan.
    signals: (isSimple ? withoutPlanSignals : (signals) => signals)(buildMonthSignals({
      audience: view.id === "household" ? "household" : "person",
      viewLabel: view.label,
      month: view.monthPage.month,
      today: checkInClock.today,
      entries: insightEntries,
      planSections,
      incomeRows,
      summary: selectedMonthSummary,
      accountPills: view.accountPills,
      formatMoney: formatService.unmaskedMoney,
      pace
    })),
    page: "month",
    period: view.monthPage.month,
    triviaRotation: MONTH_TRIVIA_ROTATION,
    calmLines: monthCalmLines(view.monthPage.month),
    alsoLabel: "Also this month",
    clock: checkInClock,
    // Wallet health arrives beside the month page; until it does, nothing
    // may be called sorted from a partial picture.
    ready: Array.isArray(view.accountPills)
  }), [checkInClock, incomeRows, insightEntries, isSimple, pace, planSections, selectedMonthSummary, view.accountPills, view.id, view.label, view.monthPage.month, view.monthPage.selectedScope]);
  const visibleAccountOptions = useMemo(
    () => accountService.getSelectOptions(visibleAccounts),
    [visibleAccounts]
  );
  const mobileCategoryOptions = useMemo(
    () => categorySelectOptions.map((category) => ({
      value: category.id,
      label: category.name,
      iconKey: category.iconKey,
      colorHex: category.colorHex
    })),
    [categorySelectOptions]
  );
  const mobileAccountOptions = useMemo(
    () => visibleAccountOptions.map((account) => ({
      value: account.value,
      label: account.label
    })),
    [visibleAccountOptions]
  );
  // Month panels can mount before the route payload fully settles, so keep
  // the initial derived-state checks tolerant of missing arrays.
  const safePlanSections = planSections ?? [];
  const safeIncomeRows = incomeRows ?? [];
  const hasPendingDerivedMonthData = useMemo(
    () => safeIncomeRows.some((row) => row.isPendingDerived)
      || safePlanSections.some((section) => (section.rows ?? []).some((row) => row.isPendingDerived)),
    [safeIncomeRows, safePlanSections]
  );

  // The save already succeeded; a failed refresh keeps the saved rows and
  // raises the shell's refresh notice, whose retry runs this again.
  function refreshMonthDataInBackground(options) {
    setIsMonthDataRefreshing(true);
    void runBackgroundRefresh(
      () => onRefresh(options),
      () => refreshMonthDataInBackground(options)
    ).finally(() => {
      setIsMonthDataRefreshing(false);
    });
  }

  function updatePlanRow(sectionKey, rowId, patch) {
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

  function upsertIncomeRow(nextRow, { prepend = false } = {}) {
    setIncomeRows((current) => {
      const existingIndex = current.findIndex((row) => row.id === nextRow.id);
      if (existingIndex === -1) {
        return prepend ? [nextRow, ...current] : [...current, nextRow];
      }

      return current.map((row) => (row.id === nextRow.id ? nextRow : row));
    });
  }

  function upsertPlanRow(sectionKey, nextRow, { prepend = false } = {}) {
    setPlanSections((current) => current.map((section) => {
      if (section.key !== sectionKey) {
        return section;
      }

      const existingIndex = section.rows.findIndex((row) => row.id === nextRow.id);
      if (existingIndex === -1) {
        return {
          ...section,
          rows: prepend ? [nextRow, ...section.rows] : [...section.rows, nextRow]
        };
      }

      return {
        ...section,
        rows: section.rows.map((row) => (row.id === nextRow.id ? nextRow : row))
      };
    }));
  }

  const loadPreviousMonthCategoryActualMinor = useCallback(async (categoryName) => {
    if (!categoryName) {
      return {
        month: getPreviousMonthKey(view.monthPage.month),
        actualMinor: 0
      };
    }

    const previousMonth = getPreviousMonthKey(view.monthPage.month);
    const cacheKey = `${view.id}:${view.monthPage.selectedScope}:${previousMonth}`;
    let monthPagePromise = previousMonthActualCacheRef.current.get(cacheKey);
    if (!monthPagePromise) {
      monthPagePromise = fetch(
        `/api/month-page?view=${encodeURIComponent(view.id)}&month=${encodeURIComponent(previousMonth)}&scope=${encodeURIComponent(view.monthPage.selectedScope)}`,
        { cache: "no-store" }
      )
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Failed to load previous month defaults.");
          }
          return response.json();
        })
        .then((data) => data.monthPage);
      previousMonthActualCacheRef.current.set(cacheKey, monthPagePromise);
    }

    const monthPage = await monthPagePromise;
    const actualMinor = (monthPage?.entries ?? []).reduce((sum, entry) => {
      if (entry.categoryName !== categoryName || !entryService.entryMatchesScope(entry, view.id, view.monthPage.selectedScope)) {
        return sum;
      }
      // Expenses add and paybacks take away, as in the budget bucket.
      return sum + spendingMinor(entry);
    }, 0);

    return {
      month: previousMonth,
      actualMinor: Math.max(0, actualMinor)
    };
  }, [view.id, view.monthPage.month, view.monthPage.selectedScope]);

  // What a Plan Studio row's menu can do, through the dialogs and commands the
  // plan tables use: the note, the line's details (the plan-row sheet), the
  // entries it matches, and removing it. A line made of several stored rows
  // (the household view) has none.
  function studioMenuActionsFor(row) {
    if (isCombinedHouseholdView || !row.editable) return {};
    const isIncome = row.section === "income";
    const source = isIncome
      ? incomeRows.find((item) => item.id === row.key)
      : planSections.find((section) => section.key === row.section)?.rows.find((item) => item.id === row.key);
    if (!source) return {};
    const kind = isIncome ? "income" : "plan";
    return {
      editNote: () => openNoteDialog(kind, source.id, row.section, source.note),
      editDetails: () => setMobileAddDialog(isIncome
        ? buildMobileMonthIncomeDialog(source)
        : buildMobileMonthPlanDialog({ monthKey: view.monthPage.month, row: source, sectionKey: row.section, viewId: view.id, viewLabel: view.label })),
      matchEntries: row.section === "planned_items" ? () => void openPlanLinkDialog(source) : undefined,
      remove: isIncome
        ? (incomeRows.length > 1 ? () => handleRemoveIncomeRow(source.id) : undefined)
        : () => handleRemovePlanRow(row.section, source.id)
    };
  }

  // "Add a line" in Studio: a dated line is a planned item and an undated one
  // a budget bucket (sectionForNewLine), decided when it is saved; income is its
  // own section. The same plan-row sheet the tables use on a phone.
  function handleStudioAddLine(kind) {
    if (kind === "income") {
      setMobileAddDialog(buildCreateMobileIncomeDialog());
      return;
    }
    const nextRow = buildPlanRow("budget_buckets");
    setMobileAddDialog({
      ...buildCreateMobilePlanDialog("budget_buckets"),
      studioAdd: true,
      title: planStudioAddCopy.addLine,
      studioSubtitle: planStudioAddCopy.newLineSubtitle
    });
    void applyBudgetBucketDefaultsToMobileDialog(nextRow.categoryId ?? nextRow.categoryName);
  }

  // The lines "Add to Savings" creates when the person has none yet: an
  // "Extra income" line under Money in and a "Savings" line, with the same
  // category, owner and note defaults as adding each one by hand.
  function makeStudioExtraLine(kind, plannedMinor) {
    if (kind === "income") {
      return { ...buildIncomeRow({ label: planStudioAddCopy.extraIncomeLabel }), plannedMinor, isDraft: false };
    }
    return { ...buildPlanRow("budget_buckets", { categoryName: "Savings", categoryId: categories.find((category) => category.name === "Savings")?.id, label: "Savings" }), plannedMinor, isDraft: false, autoLabelFromCategory: false, autoPlannedFromCategory: false };
  }

  // Plan Studio's "Save plan": every changed row in one all-or-nothing
  // request (409 when the plan changed underneath, nothing written). The
  // rows then show what was saved while the month reloads in the background.
  async function savePlanStudio({ changes, updates, created = [] }) {
    const response = await fetch("/api/month-plan/apply-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: view.monthPage.month, changes })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw Object.assign(new Error(payload?.error || "Failed to save the plan."), { status: response.status });
    }
    const byKey = new Map(updates.map((update) => [update.key, update]));
    setIncomeRows((current) => current.map((row) => (
      byKey.has(row.id) ? { ...row, plannedMinor: byKey.get(row.id).plannedMinor, isPendingDerived: true } : row
    )));
    setPlanSections((current) => current.map((section) => ({
      ...section,
      rows: section.rows.map((row) => {
        const update = byKey.get(row.id);
        if (!update) return row;
        const saved = buildSavedMonthPlanFields({ plannedMinor: update.plannedMinor });
        return { ...row, ...saved, isPendingDerived: true };
      })
    })));
    // Lines the save created show at once, so the totals do not wait for the reload.
    for (const { sectionKey, row } of created) {
      if (sectionKey === "income") upsertIncomeRow({ ...row, isPendingDerived: true });
      else upsertPlanRow(sectionKey, { ...row, isPendingDerived: true });
    }
    refreshMonthDataInBackground(buildMonthMutationRefreshPlan({ kind: "plan-row-edit" }));
  }

  async function persistMonthRow(sectionKey, row, nextPlannedMinor) {
    // The save API expects the canonical plan-row shape, even when the UI is
    // editing a temporary draft row or a derived table projection.
    const response = await fetch("/api/month-plan/save", {
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
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.error || "Failed to save month row.");
    }
  }

  function beginIncomeEdit(row) {
    const prefersMobileDialog = isMobileAddDialogPreferred();
    if (!canInlineEditMonthRow({ isCombinedHouseholdView, row })) {
      return;
    }
    if (editingRowId === row.id) {
      return;
    }

    if (prefersMobileDialog) {
      setMobileAddDialog(buildMobileMonthIncomeDialog(row));
      openMonthSection("income");
      return;
    }

    setEditingRowId(row.id);
    setEditingSnapshot({ kind: "income", rowId: row.id, original: { ...row } });
    setEditingDrafts({
      plannedMinor: formatService.formatMinorInput(row.plannedMinor)
    });
  }

  function beginPlanEdit(sectionKey, row) {
    const prefersMobileDialog = isMobileAddDialogPreferred();
    if (!canInlineEditMonthPlanRow({ isCombinedHouseholdView, row }) && !(prefersMobileDialog && canOpenMonthMobileSheet({ isCombinedHouseholdView, row }))) {
      return;
    }
    if (editingRowId === row.id) {
      return;
    }

    if (prefersMobileDialog) {
      setMobileAddDialog(buildMobileMonthPlanDialog({
        monthKey: view.monthPage.month,
        row,
        sectionKey,
        viewId: view.id,
        viewLabel: view.label
      }));
      openMonthSection(sectionKey);
      return;
    }

    if (row.isDerived) {
      const sourceRow = getMonthPlanEditSource(row);
      setPlanSections((current) => current.map((section) => (
        section.key === sectionKey
          ? {
              ...section,
              rows: section.rows.map((currentRow) => (
                currentRow.id === row.id
                  ? {
                      ...currentRow,
                      plannedMinor: sourceRow.plannedMinor,
                      note: sourceRow.note
                    }
                  : currentRow
              ))
            }
          : section
      )));
    }

    setEditingRowId(row.id);
    setEditingSnapshot({ kind: "plan", sectionKey, rowId: row.id, original: { ...row } });
    setEditingDrafts({
      plannedMinor: formatService.formatMinorInput(getMonthPlanEditSource(row).plannedMinor)
    });
  }

  async function finishEdit() {
    if (!editingSnapshot) {
      return;
    }

    const currentSnapshot = editingSnapshot;
    setIsSavingMonthRow(true);
    setMonthRowError("");
    try {
      let nextPlannedMinor;
      if (currentSnapshot && Object.prototype.hasOwnProperty.call(editingDrafts, "plannedMinor")) {
        nextPlannedMinor = formatService.parseDraftMoneyInput(editingDrafts.plannedMinor);
        if (currentSnapshot.kind === "income") {
          handleIncomeRowChange(currentSnapshot.rowId, { plannedMinor: nextPlannedMinor });
        } else {
          updatePlanRow(currentSnapshot.sectionKey, currentSnapshot.rowId, { plannedMinor: nextPlannedMinor });
        }
      }

      if (currentSnapshot.kind === "income") {
        const row = incomeRows.find((item) => item.id === currentSnapshot.rowId);
        if (row) {
          await persistMonthRow("income", {
            ...row,
            plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor
          }, nextPlannedMinor);
          upsertIncomeRow({
            ...row,
            plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor,
            isDraft: false,
            isPendingDerived: true
          });
        }
      } else {
        const section = planSections.find((item) => item.key === currentSnapshot.sectionKey);
        const row = section?.rows.find((item) => item.id === currentSnapshot.rowId);
        if (row) {
          const savedPlannedMinor = typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor;
          await persistMonthRow(currentSnapshot.sectionKey, {
            ...row,
            plannedMinor: savedPlannedMinor
          }, nextPlannedMinor);
          upsertPlanRow(currentSnapshot.sectionKey, {
            ...row,
            ...buildSavedMonthPlanFields({ plannedMinor: savedPlannedMinor, note: row.note }),
            isDraft: false,
            isPendingDerived: true
          });
        }
      }

      setEditingRowId(null);
      setEditingSnapshot(null);
      setEditingDrafts({});
      refreshMonthDataInBackground(buildMonthMutationRefreshPlan({
        kind: "plan-row-edit"
      }));
    } catch (error) {
      setMonthRowError(error instanceof Error ? error.message : "Failed to save month row.");
    } finally {
      setIsSavingMonthRow(false);
    }
  }

  function cancelEdit() {
    if (!editingSnapshot) {
      setEditingRowId(null);
      return;
    }

    if (editingSnapshot.kind === "income") {
      setIncomeRows((current) => editingSnapshot.original.isDraft
        ? current.filter((row) => row.id !== editingSnapshot.rowId)
        : current.map((row) => (
          row.id === editingSnapshot.rowId ? editingSnapshot.original : row
        )));
    } else {
      setPlanSections((current) => current.map((section) => (
        section.key === editingSnapshot.sectionKey
          ? editingSnapshot.original.isDraft
            ? { ...section, rows: section.rows.filter((row) => row.id !== editingSnapshot.rowId) }
            : {
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

  // Read at the moment of the click so a resize that has not re-rendered yet
  // still opens the layout the viewport shows now.
  function isMobileAddDialogPreferred() {
    return isMonthSheetLayout();
  }

  function openMonthSection(sectionKey) {
    setSectionOpen((current) => {
      const next = {
        ...current,
        [sectionKey]: true
      };
      MONTH_SECTION_STATE_CACHE.set(monthUiKey, next);
      return next;
    });
  }

  function buildPlanRow(sectionKey, patch = {}) {
    const nextId = `month-plan-${crypto.randomUUID()}`;
    const defaultCategoryName = sectionKey === "planned_items" ? "Savings" : "Food & Drinks";
    const ownerName = view.id === "household" ? undefined : view.label;
    const ownerPerson = ownerName ? people.find((person) => person.name === ownerName) : null;
    const ownershipType = view.monthPage.selectedScope === "shared" ? "shared" : "direct";

    return {
      id: nextId,
      section: sectionKey,
      categoryName: defaultCategoryName,
      categoryId: categories.find((category) => category.name === defaultCategoryName)?.id,
      label: sectionKey === "planned_items" ? "New item" : defaultCategoryName,
      dayLabel: sectionKey === "planned_items" ? `${view.monthPage.month}-01` : undefined,
      dayOfWeek: undefined,
      plannedMinor: 0,
      actualMinor: 0,
      accountName: sectionKey === "planned_items" ? "" : undefined,
      note: sectionKey === "planned_items" ? monthMessages.newPlannedItemNote : "",
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
      isDraft: true,
      autoLabelFromCategory: sectionKey === "budget_buckets",
      autoPlannedFromCategory: sectionKey === "budget_buckets",
      lastPeriodActualMinor: sectionKey === "budget_buckets" ? 0 : undefined,
      lastPeriodMonth: sectionKey === "budget_buckets" ? getPreviousMonthKey(view.monthPage.month) : undefined,
      ...patch
    };
  }

  function buildCreateMobileIncomeDialog() {
    const nextRow = buildIncomeRow();
    return {
      mode: "create",
      kind: "income",
      title: monthMessages.addIncomeSource,
      ownerLabel: getMonthRowOwnerLabel(nextRow),
      categoryValue: nextRow.categoryId ?? nextRow.categoryName,
      label: nextRow.label,
      plannedMinor: formatService.formatMinorInput(nextRow.plannedMinor),
      note: nextRow.note ?? ""
    };
  }

  function buildCreateMobilePlanDialog(sectionKey) {
    const nextRow = buildPlanRow(sectionKey);
    return {
      mode: "create",
      kind: "plan",
      sectionKey,
      title: sectionKey === "planned_items" ? monthMessages.addPlannedItem : monthMessages.addBudgetBucket,
      ownerLabel: getMonthRowOwnerLabel(nextRow),
      categoryValue: nextRow.categoryId ?? nextRow.categoryName,
      label: nextRow.label,
      plannedMinor: formatService.formatMinorInput(nextRow.plannedMinor),
      planDate: sectionKey === "planned_items" ? getRowDateValue(nextRow, view.monthPage.month) : "",
      accountName: sectionKey === "planned_items" ? nextRow.accountName ?? "" : "",
      note: sectionKey === "budget_buckets" ? "" : nextRow.note ?? "",
      autoLabelFromCategory: sectionKey === "budget_buckets",
      autoPlannedFromCategory: sectionKey === "budget_buckets",
      lastPeriodActualMinor: sectionKey === "budget_buckets" ? 0 : undefined,
      lastPeriodMonth: sectionKey === "budget_buckets" ? getPreviousMonthKey(view.monthPage.month) : undefined
    };
  }

  async function applyBudgetBucketDefaultsToDraft({ rowId, categoryValue }) {
    const categoryPatch = categoryService.buildPatch(categories, categoryValue);
    const categoryName = categoryPatch.categoryName ?? "";
    const { actualMinor, month } = await loadPreviousMonthCategoryActualMinor(categoryName);

    let shouldSyncDraft = false;
    setPlanSections((current) => current.map((section) => (
      section.key !== "budget_buckets"
        ? section
        : {
            ...section,
            rows: section.rows.map((row) => {
              if (row.id !== rowId || row.categoryName !== categoryName || !row.isDraft) {
                return row;
              }

              shouldSyncDraft = Boolean(row.autoPlannedFromCategory);
              return {
                ...row,
                lastPeriodActualMinor: actualMinor,
                lastPeriodMonth: month,
                plannedMinor: row.autoPlannedFromCategory ? actualMinor : row.plannedMinor
              };
            })
          }
    )));

    if (shouldSyncDraft && editingRowId === rowId) {
      setEditingDrafts((current) => ({
        ...current,
        plannedMinor: formatService.formatMinorInput(actualMinor)
      }));
    }
  }

  async function updateDraftBudgetBucketCategory(rowId, categoryValue) {
    const categoryPatch = categoryService.buildPatch(categories, categoryValue);
    const categoryName = categoryPatch.categoryName ?? "";

    setPlanSections((current) => current.map((section) => (
      section.key !== "budget_buckets"
        ? section
        : {
            ...section,
            rows: section.rows.map((row) => {
              if (row.id !== rowId) {
                return row;
              }

              return {
                ...row,
                ...categoryPatch,
                label: row.autoLabelFromCategory ? categoryName : row.label,
                lastPeriodActualMinor: row.lastPeriodActualMinor ?? 0
              };
            })
          }
    )));

    await applyBudgetBucketDefaultsToDraft({ rowId, categoryValue });
  }

  function updateDraftBudgetBucketLabel(rowId, label) {
    updatePlanRow("budget_buckets", rowId, {
      label,
      autoLabelFromCategory: false
    });
  }

  function updateDraftBudgetBucketPlannedMinor(rowId, plannedMinor) {
    updatePlanRow("budget_buckets", rowId, {
      plannedMinor: formatService.parseDraftMoneyInput(plannedMinor),
      autoPlannedFromCategory: false
    });
    setEditingDrafts((current) => ({
      ...current,
      plannedMinor
    }));
  }

  async function applyBudgetBucketDefaultsToMobileDialog(categoryValue) {
    const categoryPatch = categoryService.buildPatch(categories, categoryValue);
    const categoryName = categoryPatch.categoryName ?? "";
    const { actualMinor, month } = await loadPreviousMonthCategoryActualMinor(categoryName);

    setMobileAddDialog((current) => {
      if (!current || current.kind !== "plan" || current.sectionKey !== "budget_buckets") {
        return current;
      }

      const nextCategoryName = categoryService.buildPatch(categories, current.categoryValue).categoryName ?? "";
      if (nextCategoryName !== categoryName) {
        return current;
      }

      return {
        ...current,
        lastPeriodActualMinor: actualMinor,
        lastPeriodMonth: month,
        plannedMinor: current.autoPlannedFromCategory ? formatService.formatMinorInput(actualMinor) : current.plannedMinor
      };
    });
  }

  function handleAddPlanRow(sectionKey) {
    const nextRow = buildPlanRow(sectionKey);

    if (isMobileAddDialogPreferred()) {
      setMobileAddDialog(buildCreateMobilePlanDialog(sectionKey));
      if (sectionKey === "budget_buckets") {
        void applyBudgetBucketDefaultsToMobileDialog(nextRow.categoryId ?? nextRow.categoryName);
      }
      openMonthSection(sectionKey);
      return;
    }

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
    openMonthSection(sectionKey);
    setEditingRowId(nextRow.id);
    setEditingSnapshot({ kind: "plan", sectionKey, rowId: nextRow.id, original: { ...nextRow } });
    setEditingDrafts({
      plannedMinor: "0.00"
    });
    if (sectionKey === "budget_buckets") {
      void applyBudgetBucketDefaultsToDraft({ rowId: nextRow.id, categoryValue: nextRow.categoryId ?? nextRow.categoryName });
    }
  }

  // One delete at a time; the screen drops the row only after the server
  // confirms, so totals never show a delete that did not happen.
  async function deleteMonthPlanRowOnServer(rowId) {
    if (rowRemoveInFlightRef.current) {
      throw new Error(monthMessages.rowDeleteFailed);
    }
    rowRemoveInFlightRef.current = true;
    setIsRemovingMonthRow(true);
    try {
      const response = await fetch("/api/month-plan/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId,
          month: view.monthPage.month
        })
      });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, monthMessages.rowDeleteFailed));
      }
    } finally {
      rowRemoveInFlightRef.current = false;
      setIsRemovingMonthRow(false);
    }
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

    // Throws on failure so the delete confirmation keeps the row and shows why.
    await deleteMonthPlanRowOnServer(rowId);
    setPlanSections((current) => current.map((item) => (
      item.key === sectionKey
        ? { ...item, rows: item.rows.filter((planRow) => planRow.id !== rowId) }
        : item
    )));
    setEditingRowId((current) => (current === rowId ? null : current));
    refreshMonthDataInBackground(buildMonthMutationRefreshPlan({
      kind: "plan-link-save",
      affectsEntries: true,
      affectsSplits: true,
      affectsSummary: true
    }));
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
    setRowNoteError("");
    setNoteDialog({
      kind,
      rowId,
      sectionKey,
      draft: note ?? ""
    });
  }

  // The table shows the new note only after the save succeeds; a failure
  // keeps the dialog and its draft open with the error.
  async function commitNoteDialog() {
    if (!noteDialog || rowNoteSaveInFlightRef.current) {
      return;
    }

    const { kind, rowId, sectionKey, draft } = noteDialog;
    const row = kind === "income"
      ? incomeRows.find((item) => item.id === rowId)
      : planSections.find((item) => item.key === sectionKey)?.rows.find((item) => item.id === rowId);
    if (!row) {
      setNoteDialog(null);
      return;
    }

    rowNoteSaveInFlightRef.current = true;
    setIsSavingRowNote(true);
    setRowNoteError("");
    try {
      await persistMonthRow(kind === "income" ? "income" : sectionKey, { ...row, note: draft });
    } catch (error) {
      setRowNoteError(error instanceof Error && error.message ? error.message : monthMessages.rowNoteSaveFailed);
      return;
    } finally {
      rowNoteSaveInFlightRef.current = false;
      setIsSavingRowNote(false);
    }

    if (kind === "income") {
      handleIncomeRowChange(rowId, { note: draft });
    } else {
      updatePlanRow(sectionKey, rowId, buildSavedMonthPlanFields({ note: draft }));
    }
    setNoteDialog(null);
    refreshMonthDataInBackground();
  }

  function closeNoteDialog() {
    if (rowNoteSaveInFlightRef.current) {
      return;
    }
    setNoteDialog(null);
    setRowNoteError("");
  }

  async function commitMonthNoteDialog() {
    if (!monthNoteDialog) {
      return;
    }

    setIsSavingMonthNote(true);
    setMonthNoteError("");
    try {
      const response = await fetch("/api/month-note/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: view.monthPage.month,
          personScope: view.id,
          note: monthNoteDialog.draft
        })
      });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, monthMessages.monthNoteSaveFailed));
      }

      setMonthNoteDialog(null);
      refreshMonthDataInBackground(buildMonthMutationRefreshPlan({
        kind: "plan-row-edit"
      }));
    } catch (error) {
      setMonthNoteError(error instanceof Error && error.message ? error.message : monthMessages.monthNoteSaveFailed);
    } finally {
      setIsSavingMonthNote(false);
    }
  }

  async function handleDraftMonthNote() {
    if (isDraftingMonthNote) {
      return;
    }
    setIsDraftingMonthNote(true);
    setMonthNoteError("");
    try {
      const response = await fetch("/api/ai-assist/monthly-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          viewId: view.id,
          month: view.monthPage.month,
          scope: view.monthPage.selectedScope
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Could not draft a monthly summary.");
      }
      setMonthNoteDialog({ draft: data.narrative ?? view.monthPage.monthNote ?? "" });
      if (data.reason) {
        setMonthNoteError(`${data.reason} A deterministic draft was used instead.`);
      }
    } catch (error) {
      setMonthNoteError(error instanceof Error ? error.message : "Could not draft a monthly summary.");
    } finally {
      setIsDraftingMonthNote(false);
    }
  }

  function handleOpenEntriesForAccount(account) {
    const next = new URLSearchParams();
    next.set("view", view.id);
    next.set("month", view.monthPage.month);
    next.set("entry_wallet", account.name);
    next.set("scope", view.monthPage.selectedScope);
    next.set("entries_scope", view.monthPage.selectedScope);

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

  function handleCheckInAction(action) {
    if (action.id === "review-statement") {
      navigate("/imports");
    } else if (action.id === "show-entries") {
      handleOpenEntriesForActual({ entryIds: action.entryIds ?? [], month: action.month });
    } else if (action.id === "open-category") {
      handleOpenEntriesForActual({ categoryName: action.categoryName });
    }
  }

  function handleOpenEntriesForActual({ categoryName = undefined, entryIds = [], entryType = "", month = undefined }) {
    const next = new URLSearchParams();
    next.set("view", view.id);
    next.set("month", month ?? view.monthPage.month);
    next.set("scope", view.monthPage.selectedScope);
    next.set("entries_scope", view.monthPage.selectedScope);

    if (view.id !== "household") {
      next.set("entry_person", view.label);
    }

    if (entryIds.length) {
      entryIds.forEach((entryId) => next.append("entry_id", entryId));
    } else if (entryType) {
      next.set("entry_type", entryType);
    } else if (categoryName) {
      next.set("entry_category", categoryName);
    }

    navigate({
      pathname: "/entries",
      search: `?${next.toString()}`
    });
  }

  function buildIncomeRow(patch = {}) {
    const nextId = `month-income-${crypto.randomUUID()}`;
    const ownerName = view.id === "household" ? undefined : view.label;
    const ownerPerson = ownerName ? people.find((person) => person.name === ownerName) : null;

    return {
      id: nextId,
      categoryName: "Income",
      categoryId: categories.find((category) => category.name === "Income")?.id,
      label: "Other income",
      plannedMinor: 0,
      actualMinor: 0,
      note: monthMessages.extraIncomeNote,
      ownershipType: "direct",
      personId: ownerPerson?.id,
      ownerName,
      splits: ownerPerson ? [{
        personId: ownerPerson.id,
        personName: ownerPerson.name,
        ratioBasisPoints: 10000,
        amountMinor: 0
      }] : [],
      isDraft: true,
      ...patch
    };
  }

  function handleAddIncomeRow() {
    const nextRow = buildIncomeRow();

    if (isMobileAddDialogPreferred()) {
      setMobileAddDialog(buildCreateMobileIncomeDialog());
      openMonthSection("income");
      return;
    }

    setIncomeRows((current) => [nextRow, ...current]);
    setTableSorts((current) => ({
      ...current,
      income: null
    }));
    openMonthSection("income");
    setEditingRowId(nextRow.id);
    setEditingSnapshot({ kind: "income", rowId: nextRow.id, original: { ...nextRow } });
    setEditingDrafts({
      plannedMinor: "0.00"
    });
  }

  function handleMobileAddDialogCategoryChange(nextValue) {
    setMobileAddDialog((current) => {
      if (!current) {
        return current;
      }

      const categoryPatch = categoryService.buildPatch(categories, nextValue);
      const categoryName = categoryPatch.categoryName ?? "";
      return {
        ...current,
        categoryValue: nextValue,
        label: current.kind === "plan" && current.sectionKey === "budget_buckets" && current.autoLabelFromCategory
          ? categoryName
          : current.label
      };
    });

    if (mobileAddDialog?.kind === "plan" && mobileAddDialog.sectionKey === "budget_buckets") {
      void applyBudgetBucketDefaultsToMobileDialog(nextValue);
    }
  }

  async function saveMobileAddDialog() {
    if (!mobileAddDialog) {
      return;
    }

    const selectedCategoryName = categoryService.buildPatch(categories, mobileAddDialog.categoryValue).categoryName ?? "";
    // A line added from Studio is stored by its date: dated is a planned item,
    // undated a budget bucket (classifyNewLine).
    const currentDialog = mobileAddDialog.studioAdd
      ? { ...mobileAddDialog, sectionKey: sectionForNewLine(mobileAddDialog.planDate) }
      : mobileAddDialog;
    setIsSavingMonthRow(true);
    setMonthRowError("");
    const plannedMinor = formatService.parseDraftMoneyInput(mobileAddDialog.plannedMinor);
    const basePatch = {
      ...categoryService.buildPatch(categories, mobileAddDialog.categoryValue),
      label: mobileAddDialog.label.trim() || (mobileAddDialog.kind === "income"
        ? "Other income"
        : currentDialog.sectionKey === "planned_items"
          ? "New item"
          : selectedCategoryName || "New bucket"),
      plannedMinor,
      note: mobileAddDialog.note.trim() || null
    };

    try {
      if (currentDialog.kind === "income") {
        const incomeRow = currentDialog.mode === "edit"
          ? incomeRows.find((row) => row.id === currentDialog.rowId)
          : null;
        const nextIncomeRow = incomeRow ? {
          ...incomeRow,
          ...basePatch
        } : buildIncomeRow(basePatch);
        await persistMonthRow("income", nextIncomeRow, plannedMinor);
        upsertIncomeRow({
          ...nextIncomeRow,
          isDraft: false,
          isPendingDerived: true
        }, { prepend: currentDialog.mode === "create" });
        if (currentDialog.mode === "create") {
          setTableSorts((current) => ({
            ...current,
            income: null
          }));
        }
        openMonthSection("income");
      } else {
        const sectionKey = currentDialog.sectionKey;
        const planSection = planSections.find((section) => section.key === sectionKey);
        const planRow = currentDialog.mode === "edit"
          ? planSection?.rows.find((row) => row.id === currentDialog.rowId)
          : null;
        const editablePlanRow = planRow ? getMonthPlanEditSource(planRow) : null;
        const nextPlanRow = editablePlanRow ? {
          ...editablePlanRow,
          ...basePatch,
          dayLabel: sectionKey === "planned_items" ? currentDialog.planDate : editablePlanRow.dayLabel,
          accountName: sectionKey === "planned_items" ? currentDialog.accountName : editablePlanRow.accountName
        } : buildPlanRow(sectionKey, {
          ...basePatch,
          dayLabel: sectionKey === "planned_items" ? currentDialog.planDate : undefined,
          accountName: sectionKey === "planned_items" ? currentDialog.accountName : undefined
        });
        await persistMonthRow(sectionKey, nextPlanRow, plannedMinor);
        upsertPlanRow(sectionKey, {
          ...nextPlanRow,
          ...buildSavedMonthPlanFields({ plannedMinor, note: nextPlanRow.note }),
          isDraft: false,
          isPendingDerived: true
        }, { prepend: currentDialog.mode === "create" });
        if (currentDialog.mode === "create") {
          setTableSorts((current) => ({
            ...current,
            [sectionKey]: null
          }));
        }
        openMonthSection(sectionKey);
      }

      if (currentDialog.mode === "create" && currentDialog.studioAdd) {
        // Studio adds one line at a time: back to the list, where it appears.
        setMobileAddDialog(null);
      } else if (currentDialog.mode === "create") {
        if (currentDialog.kind === "income") {
          setMobileAddDialog(buildCreateMobileIncomeDialog());
        } else {
          const nextDialog = buildCreateMobilePlanDialog(currentDialog.sectionKey);
          setMobileAddDialog(nextDialog);
          if (currentDialog.sectionKey === "budget_buckets") {
            void applyBudgetBucketDefaultsToMobileDialog(nextDialog.categoryValue);
          }
        }
      } else {
        setMobileAddDialog(null);
      }
      refreshMonthDataInBackground();
    } catch (error) {
      setMonthRowError(error instanceof Error ? error.message : "Failed to save month row.");
    } finally {
      setIsSavingMonthRow(false);
    }
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

    await deleteMonthPlanRowOnServer(rowId);
    setIncomeRows((current) => current.filter((item) => item.id !== rowId));
    setEditingRowId((current) => (current === rowId ? null : current));
    refreshMonthDataInBackground();
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

  async function openPlanLinkDialog(row) {
    if (editingSnapshot?.rowId === row.id) {
      await finishEdit();
    }

    setPlanLinkError("");
    setPlanLinkDialog({
      rowId: row.id,
      draftEntryIds: row.linkedEntryIds ?? [],
      filterLinkedOnly: false,
      filterSameCategoryOnly: true,
      filterSameAccountOnly: false,
      filterCurrentMonthOnly: true,
      descriptionFilter: ""
    });
  }

  // Closes only on success. A failed save keeps the dialog or sheet and its
  // draft open with the error; while the save is in flight Escape, Cancel and
  // a second submit are ignored.
  async function savePlanLinkDialog() {
    if (!planLinkDialog || planLinkSaveInFlightRef.current) {
      return;
    }

    planLinkSaveInFlightRef.current = true;
    setIsSavingPlanLinks(true);
    setPlanLinkError("");
    try {
      const response = await fetch("/api/month-plan/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId: planLinkDialog.rowId,
          month: view.monthPage.month,
          transactionIds: planLinkDialog.draftEntryIds
        })
      });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, monthMessages.planLinkSaveFailed));
      }
    } catch (error) {
      setPlanLinkError(error instanceof Error && error.message ? error.message : monthMessages.planLinkSaveFailed);
      return;
    } finally {
      planLinkSaveInFlightRef.current = false;
      setIsSavingPlanLinks(false);
    }

    setPlanLinkDialog(null);
    refreshMonthDataInBackground();
  }

  function closePlanLinkDialog() {
    if (planLinkSaveInFlightRef.current) {
      return;
    }
    setPlanLinkDialog(null);
    setPlanLinkError("");
  }

  function togglePlanLinkFilter(key) {
    setPlanLinkDialog((current) => current ? {
      ...current,
      [key]: !current[key]
    } : current);
  }

  function updatePlanLinkDescriptionFilter(value) {
    setPlanLinkDialog((current) => current ? {
      ...current,
      descriptionFilter: value
    } : current);
  }

  // Stable so memoized candidate rows do not re-render when the dialog does.
  const togglePlanLinkEntry = useCallback((entryId, checked) => {
    setPlanLinkDialog((current) => {
      if (!current) {
        return current;
      }
      const nextIds = new Set(current.draftEntryIds);
      if (checked) {
        nextIds.add(entryId);
      } else {
        nextIds.delete(entryId);
      }
      return {
        ...current,
        draftEntryIds: [...nextIds]
      };
    });
  }, []);

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

  const [, setSearchParams] = useSearchParams();
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isResettingMonth, setIsResettingMonth] = useState(false);
  const [isDeletingMonth, setIsDeletingMonth] = useState(false);
  // Every open editor, typed confirmation or in-flight write blocks optional
  // background work while it is open.
  useRouteWorkReport({
    busy: Boolean(editingRowId)
      || Boolean(noteDialog)
      || Boolean(planLinkDialog)
      || Boolean(monthNoteDialog)
      || Boolean(mobileAddDialog)
      || actionsOpen
      || isSavingMonthNote
      || isSavingRowNote
      || isDraftingMonthNote
      || isSavingMonthRow
      || isRemovingMonthRow
      || isMonthDataRefreshing
      || hasPendingDerivedMonthData
      || isDuplicating
      || isResettingMonth
      || isDeletingMonth
      || resetMonthText !== ""
      || deleteMonthText !== ""
  });

  // Month actions throw on failure; MonthPanelHeader keeps the popover or
  // confirmation dialog open and shows the error.
  async function handleDuplicateMonth() {
    setIsDuplicating(true);
    try {
      const response = await fetch(`/api/months/duplicate?source=${view.monthPage.month}`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, monthMessages.duplicateMonthFailed));
      }
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
      const response = await fetch(`/api/months/reset?month=${view.monthPage.month}`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, monthMessages.resetMonthFailed));
      }
      await onRefresh();
      setResetMonthText("");
    } finally {
      setIsResettingMonth(false);
    }
  }

  async function handleDeleteMonth() {
    setIsDeletingMonth(true);
    try {
      const response = await fetch(`/api/months/delete?month=${view.monthPage.month}`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, monthMessages.deleteMonthFailed));
      }
      await onRefresh();
      setDeleteMonthText("");
    } finally {
      setIsDeletingMonth(false);
    }
  }

  // The note dialogs name whose note it is: the month and the view, and for a
  // plan row its label.
  const monthLabelForNotes = `${formatService.formatMonthLabel(view.monthPage.month)} · ${view.label}`;
  const rowNoteRow = noteDialog
    ? (noteDialog.kind === "income"
      ? incomeRows.find((item) => item.id === noteDialog.rowId)
      : planSections.find((item) => item.key === noteDialog.sectionKey)?.rows.find((item) => item.id === noteDialog.rowId))
    : null;
  const rowNoteLabel = rowNoteRow?.label || "Plan row";

  return (
    <article className="panel month-panel">
      <MonthPanelHeader
        view={view}
        actionsOpen={actionsOpen}
        isDuplicating={isDuplicating}
        isResettingMonth={isResettingMonth}
        isDeletingMonth={isDeletingMonth}
        resetMonthText={resetMonthText}
        deleteMonthText={deleteMonthText}
        onActionsOpenChange={setActionsOpen}
        onScopeChange={(scopeKey) => {
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set("scope", scopeKey);
            return next;
          });
        }}
        onDuplicateMonth={handleDuplicateMonth}
        onResetMonthTextChange={setResetMonthText}
        onDeleteMonthTextChange={setDeleteMonthText}
        onResetMonth={handleResetMonth}
        onDeleteMonth={handleDeleteMonth}
        isDemoEnvironment={isDemoEnvironment}
      />

      <MonthLead
        model={monthLead.model}
        leadView={monthLead.leadView}
        onLeadViewChange={monthLead.setLeadView}
        month={view.monthPage.month}
        categoryShare={view.monthPage.categoryShareChart}
        isRefreshing={isMonthDataRefreshing || hasPendingDerivedMonthData}
      />

      {/* If this keeps up (DOMAIN.md "Pace"), under the lead. */}
      <PaceLine
        pace={pace}
        spentSoFarMinor={selectedMonthSummary?.realExpensesMinor ?? null}
        planMinor={isSimple ? null : selectedMonthSummary?.estimatedExpensesMinor ?? null}
        money={formatService.money}
        hidden={!areTotalsVisible}
      />

      <FinancialInsight
        audienceName={view.id === "household" ? "" : view.label}
        checkIn={checkIn}
        onCheckInAction={handleCheckInAction}
        className="financial-insight-month"
      />

      {/* The Summary tab's picked month drives Spending Mix: this month's
          spending by category, read from the Month page already loaded. It
          sits after the money insights (the read-out) and before the plan
          tables (the editing work), as on All months it sits above Intent
          vs Outcome. A card's arrow opens Entries for the category in this
          month and scope, like the tables' Actual drilldowns. */}
      <SpendingMixSection
        className="month-spending-mix"
        donutData={monthSpendingMix.data}
        categories={categories}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
        period={`${view.monthPage.month}:${view.monthPage.month}`}
        sliceFacts={monthSliceFacts}
      />

      {/* Simple (lead-view.js): money in, and a way back to Plan, in the
          plan tables' place; the plan is edited in Plan. */}
      {monthLead.leadView === "simple" ? (
        <MonthMoneyIn
          entries={insightEntries}
          onOpenEntries={(entryIds) => handleOpenEntriesForActual({ entryIds })}
          onPlanThisMonth={() => monthLead.setLeadView("plan")}
        />
      ) : <>
      {hasPlanStudioRows ? <PlanIslandActions mode={effectivePlanMode} disabled={studioSaving} onModeChange={setPlanMode} /> : null}
      {hasPlanStudioRows && effectivePlanMode === "tables" ? (
        <PlanModeSwitch mode={planMode} onChange={setPlanMode} studioDirty={studioDirty} />
      ) : null}
      {hasPlanStudioRows && studioShownRef.current ? (
      <Suspense fallback={<PlanStudioReserve>{effectivePlanMode === "studio" ? planModeSwitch : null}</PlanStudioReserve>}>
        <PlanStudio
          visible={effectivePlanMode === "studio"}
          modeSwitch={effectivePlanMode === "studio" ? planModeSwitch : null}
          makeLine={makeStudioExtraLine}
          ownerName={view.id === "household" ? "" : view.label}
          menuActionsFor={studioMenuActionsFor}
          onAddLine={handleStudioAddLine}
          onDirtyChange={setStudioDirty}
          onSavingChange={setStudioSaving}
          month={view.monthPage.month}
          monthLabel={formatService.formatMonthLabel(view.monthPage.month)}
          categories={categories}
          incomeRows={incomeRows}
          planSections={planSections}
          figures={monthLead.model?.figures ?? null}
          today={checkInClock.today}
          onSave={savePlanStudio}
          readOnly={isCombinedHouseholdView}
          readOnlyHint={monthMessages.readOnlyCombinedHint}
        />
      </Suspense>
      ) : null}
      {effectivePlanMode === "tables" ? (
      <MonthPlanStack
        view={view}
        categories={categories}
        categorySelectOptions={categorySelectOptions}
        accounts={accounts}
        accountSelectOptions={accountService.getSelectOptions(accounts)}
        incomeRows={incomeRows}
        planSections={planSections}
        sectionOpen={sectionOpen}
        tableSorts={tableSorts}
        editingRowId={editingRowId}
        editingDrafts={editingDrafts}
        isSavingEdit={isSavingMonthRow}
        isCombinedHouseholdView={isCombinedHouseholdView}
        monthKey={monthKey}
        onToggleSection={toggleSection}
        onAddIncomeRow={handleAddIncomeRow}
        onAddPlanRow={handleAddPlanRow}
        onBudgetBucketCategoryChange={updateDraftBudgetBucketCategory}
        onBudgetBucketLabelChange={updateDraftBudgetBucketLabel}
        onBudgetBucketPlannedMinorDraftChange={updateDraftBudgetBucketPlannedMinor}
        onBeginIncomeEdit={beginIncomeEdit}
        onBeginPlanEdit={beginPlanEdit}
        onIncomeRowChange={handleIncomeRowChange}
        onPlanRowChange={updatePlanRow}
        onEditingDraftChange={(patch) => setEditingDrafts((current) => ({ ...current, ...patch }))}
        onFinishEdit={finishEdit}
        onCancelEdit={cancelEdit}
        onRemoveIncomeRow={handleRemoveIncomeRow}
        onRemovePlanRow={handleRemovePlanRow}
        onOpenNoteDialog={openNoteDialog}
        onOpenPlanLinkDialog={openPlanLinkDialog}
        onOpenEntriesForActual={handleOpenEntriesForActual}
        onSortChange={handleSortChange}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
        saveErrorMessage={monthRowError}
      />
      ) : null}</>}

      <MonthNotesAndAccounts
        monthNote={view.monthPage.monthNote}
        visibleAccounts={accountsWithHealth}
        onEditMonthNote={() => setMonthNoteDialog({ draft: view.monthPage.monthNote ?? "" })}
        onDraftMonthNote={() => void handleDraftMonthNote()}
        isDraftingMonthNote={isDraftingMonthNote}
        onOpenEntriesForAccount={handleOpenEntriesForAccount}
      />

      {mobileAddDialog ? (
        <MonthPlanSheet
          dialog={mobileAddDialog}
          monthKey={monthKey}
          categories={categories}
          categoryOptions={mobileCategoryOptions}
          accountOptions={mobileAccountOptions}
          errorMessage={monthRowError}
          isSaving={isSavingMonthRow}
          onChange={(patch) => setMobileAddDialog((current) => current ? { ...current, ...patch } : current)}
          onCategoryChange={handleMobileAddDialogCategoryChange}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onOpenEntriesForActual={handleOpenEntriesForActual}
          onClose={() => setMobileAddDialog(null)}
          onSave={() => void saveMobileAddDialog()}
        />
      ) : null}

      {noteDialog ? (
        <NoteSheetDialog
          title="Edit note"
          description="Write the planning context without squeezing it into the table."
          leadTitle={rowNoteLabel}
          leadSubtitle={monthLabelForNotes}
          value={noteDialog.draft ?? ""}
          onChange={(draft) => setNoteDialog((current) => current ? { ...current, draft } : current)}
          errorMessage={rowNoteError}
          isSaving={isSavingRowNote}
          saveLabel={isSavingRowNote ? messages.common.saving : monthMessages.doneEdit}
          cancelLabel={monthMessages.cancelEdit}
          closeLabel="Close note editor"
          onSave={commitNoteDialog}
          onClose={closeNoteDialog}
        />
      ) : null}

      {planLinkDialog ? (
        <MonthPlanLinkDialog
          asSheet={useMobileMonthSheet}
          planLinkDialog={planLinkDialog}
          row={planLinkPickerModel.row}
          category={categoryService.get(categories, { categoryName: planLinkPickerModel.row?.categoryName })}
          allCandidates={planLinkPickerModel.allCandidates}
          candidates={planLinkPickerModel.candidates}
          selectedIds={planLinkPickerModel.selectedIds}
          isSaving={isSavingPlanLinks}
          isDirty={hasPlanLinkChanges}
          errorMessage={planLinkError}
          onClose={closePlanLinkDialog}
          onToggleFilter={togglePlanLinkFilter}
          onDescriptionFilterChange={updatePlanLinkDescriptionFilter}
          onToggleEntry={togglePlanLinkEntry}
          onSave={() => void savePlanLinkDialog()}
        />
      ) : null}

      {monthNoteDialog ? (
        <MonthNoteDialog
          monthLabel={monthLabelForNotes}
          value={monthNoteDialog.draft ?? ""}
          onChange={(draft) => setMonthNoteDialog((current) => current ? { ...current, draft } : current)}
          errorMessage={monthNoteError}
          isSaving={isSavingMonthNote}
          onSave={commitMonthNoteDialog}
          onClose={() => {
            if (!isSavingMonthNote) {
              setMonthNoteDialog(null);
            }
          }}
        />
      ) : null}
    </article>
  );
}

function getPreviousMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
