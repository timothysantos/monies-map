import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { getAccountSelectOptions } from "./account-display";
import { CategoryAppearancePopover } from "./category-visuals";
import { getCategoriesForSelect, getCategory, getCategoryPatch } from "./category-utils";
import { messages } from "./copy/en-SG";
import { entryMatchesScope } from "./entry-helpers";
import { EntryMobileSheet } from "./entry-mobile-sheet";
import {
  buildPlanLinkCandidates,
  buildMonthMetricCards,
  getDefaultMonthSectionOpen,
  getPlanRowById,
  getVisibleMonthAccounts
} from "./month-helpers";
import { MonthMetricRow, MonthNotesAndAccounts, MonthPanelHeader } from "./month-overview";
import {
  buildMobileMonthIncomeDialog,
  buildMobileMonthPlanDialog,
  canInlineEditMonthRow,
  canInlineEditMonthPlanRow,
  canOpenMonthMobileSheet,
  getMonthPlanEditSource
} from "./month-row-editing";
import { LastPeriodBudgetHint, MonthPlanStack } from "./month-plan-tables";
import { ResponsiveSelect } from "./responsive-select";
import { getRowDateValue } from "./table-helpers";
import {
  formatDateOnly,
  formatMinorInput,
  money,
  parseDraftMoneyInput
} from "./formatters";

const MONTH_SECTION_STATE_CACHE = new Map();
const MOBILE_ADD_DIALOG_QUERY = "(max-width: 760px), (max-width: 1024px) and (orientation: portrait)";

// This panel owns the "editable month workspace":
// - local draft rows so the UI responds immediately
// - background refreshes so derived totals settle after saves
// - route-level dialogs such as notes, plan links, and mobile editors
//
// Important month-page terms:
// - "draft" rows exist only in the browser until the first save succeeds.
// - "pending derived" rows were saved, but totals/actuals still need the server
//   to recompute the downstream month and summary views.
// - "derived" plan rows are weighted or rolled-up rows shown in a scope view;
//   the editor often needs to map back to the source row values first.
function mergeMonthRowsById(currentRows, serverRows) {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const serverIds = new Set(serverRows.map((row) => row.id));
  const localTransientRows = currentRows.filter((row) => (
    (row.isDraft || row.isPendingDerived) && !serverIds.has(row.id)
  ));

  return [
    ...localTransientRows,
    ...serverRows.map((serverRow) => {
      const currentRow = currentById.get(serverRow.id);
      return currentRow
        ? {
            ...currentRow,
            ...serverRow,
            isDraft: false,
            isPendingDerived: false
          }
        : serverRow;
    })
  ];
}

function mergeMonthPlanSections(currentSections, serverSections) {
  const currentByKey = new Map(currentSections.map((section) => [section.key, section]));
  return serverSections.map((serverSection) => {
    const currentSection = currentByKey.get(serverSection.key);
    return currentSection
      ? {
          ...serverSection,
          rows: mergeMonthRowsById(currentSection.rows ?? [], serverSection.rows ?? [])
        }
      : serverSection;
  });
}

export function MonthPanel({ view, accounts, people, categories, householdMonthEntries, onCategoryAppearanceChange, onRefresh }) {
  const navigate = useNavigate();
  const monthUiKey = `${view.id}:${view.monthPage.month}:${view.monthPage.selectedScope}`;
  const [planSections, setPlanSections] = useState(view.monthPage.planSections);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [editingDrafts, setEditingDrafts] = useState({});
  const [incomeRows, setIncomeRows] = useState(view.monthPage.incomeRows);
  const [sectionOpen, setSectionOpen] = useState(() => MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? getDefaultMonthSectionOpen());
  const [noteDialog, setNoteDialog] = useState(null);
  const [planLinkDialog, setPlanLinkDialog] = useState(null);
  const [resetMonthText, setResetMonthText] = useState("");
  const [deleteMonthText, setDeleteMonthText] = useState("");
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [mobileAddDialog, setMobileAddDialog] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [useMobileMonthSheet, setUseMobileMonthSheet] = useState(false);
  const [isMonthDataRefreshing, setIsMonthDataRefreshing] = useState(false);
  const previousMonthActualCacheRef = useRef(new Map());
  const [tableSorts, setTableSorts] = useState({
    income: null,
    planned_items: null,
    budget_buckets: null
  });
  const categorySelectOptions = useMemo(() => getCategoriesForSelect(categories), [categories]);
  const isCombinedHouseholdView = view.id === "household" && view.monthPage.selectedScope === "direct_plus_shared";

  useEffect(() => {
    setPlanSections(view.monthPage.planSections);
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
    setIncomeRows(view.monthPage.incomeRows);
    setIsMonthDataRefreshing(false);
  }, [monthUiKey]);

  useEffect(() => {
    setPlanSections((current) => mergeMonthPlanSections(current, view.monthPage.planSections));
  }, [view.monthPage.planSections]);

  useEffect(() => {
    setIncomeRows((current) => mergeMonthRowsById(current, view.monthPage.incomeRows));
  }, [view.monthPage.incomeRows]);

  useEffect(() => {
    setSectionOpen(MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? getDefaultMonthSectionOpen());
  }, [monthUiKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_ADD_DIALOG_QUERY);
    const update = () => setUseMobileMonthSheet(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  // Summary cards borrow the selected month's rollup from the already-loaded
  // summary payload instead of refetching anything here.
  const selectedMonthSummary = useMemo(
    () => view.summaryPage.months.find((month) => month.month === view.monthPage.month) ?? null,
    [view]
  );
  const planLinkTargetRow = useMemo(
    () => planLinkDialog ? getPlanRowById(planSections, planLinkDialog.rowId) : null,
    [planLinkDialog, planSections]
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

    const allCandidates = buildPlanLinkCandidates({
      row: planLinkTargetRow,
      householdMonthEntries,
      monthEntries: view.monthPage.entries,
      monthKey: view.monthPage.month
    });
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
  }, [householdMonthEntries, planLinkDialog, planLinkTargetRow, view.monthPage.entries, view.monthPage.month]);

  const monthMetricCards = useMemo(
    () => buildMonthMetricCards({ planSections, incomeRows, currentMonthSummary: selectedMonthSummary }),
    [selectedMonthSummary, incomeRows, planSections]
  );
  const visibleAccounts = useMemo(
    () => getVisibleMonthAccounts(accounts, view.id),
    [accounts, view.id]
  );
  const visibleAccountOptions = useMemo(
    () => getAccountSelectOptions(visibleAccounts),
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
  const hasPendingDerivedMonthData = useMemo(
    () => incomeRows.some((row) => row.isPendingDerived)
      || planSections.some((section) => section.rows.some((row) => row.isPendingDerived)),
    [incomeRows, planSections]
  );

  function refreshMonthDataInBackground() {
    setIsMonthDataRefreshing(true);
    void onRefresh().catch(() => {}).finally(() => {
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
      if (entry.entryType !== "expense" || entry.categoryName !== categoryName) {
        return sum;
      }
      if (!entryMatchesScope(entry, view.id, view.monthPage.selectedScope)) {
        return sum;
      }
      return sum + entry.amountMinor;
    }, 0);

    return {
      month: previousMonth,
      actualMinor
    };
  }, [view.id, view.monthPage.month, view.monthPage.selectedScope]);

  async function persistMonthRow(sectionKey, row, nextPlannedMinor) {
    // The save API expects the canonical plan-row shape, even when the UI is
    // editing a temporary draft row or a derived table projection.
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
      plannedMinor: formatMinorInput(row.plannedMinor)
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
      plannedMinor: formatMinorInput(getMonthPlanEditSource(row).plannedMinor)
    });
  }

  async function finishEdit() {
    if (!editingSnapshot) {
      return;
    }

    const currentSnapshot = editingSnapshot;
    let nextPlannedMinor;
    if (currentSnapshot && Object.prototype.hasOwnProperty.call(editingDrafts, "plannedMinor")) {
      nextPlannedMinor = parseDraftMoneyInput(editingDrafts.plannedMinor);
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
        await persistMonthRow(currentSnapshot.sectionKey, {
          ...row,
          plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor
        }, nextPlannedMinor);
        upsertPlanRow(currentSnapshot.sectionKey, {
          ...row,
          plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor,
          isDraft: false,
          isPendingDerived: true
        });
      }
    }

    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
    refreshMonthDataInBackground();
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

  function isMobileAddDialogPreferred() {
    return useMobileMonthSheet || (typeof window !== "undefined" && window.matchMedia(MOBILE_ADD_DIALOG_QUERY).matches);
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
      note: sectionKey === "planned_items" ? messages.month.newPlannedItemNote : "",
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
      title: messages.month.addIncomeSource,
      description: "Add the row without squeezing controls into the month table.",
      categoryValue: nextRow.categoryId ?? nextRow.categoryName,
      label: nextRow.label,
      plannedMinor: formatMinorInput(nextRow.plannedMinor),
      note: nextRow.note ?? ""
    };
  }

  function buildCreateMobilePlanDialog(sectionKey) {
    const nextRow = buildPlanRow(sectionKey);
    return {
      mode: "create",
      kind: "plan",
      sectionKey,
      title: sectionKey === "planned_items" ? messages.month.addPlannedItem : messages.month.addBudgetBucket,
      description: "Add the row without squeezing controls into the month table.",
      categoryValue: nextRow.categoryId ?? nextRow.categoryName,
      label: nextRow.label,
      plannedMinor: formatMinorInput(nextRow.plannedMinor),
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
    const categoryPatch = getCategoryPatch(categories, categoryValue);
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
        plannedMinor: formatMinorInput(actualMinor)
      }));
    }
  }

  async function updateDraftBudgetBucketCategory(rowId, categoryValue) {
    const categoryPatch = getCategoryPatch(categories, categoryValue);
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
      plannedMinor: parseDraftMoneyInput(plannedMinor),
      autoPlannedFromCategory: false
    });
    setEditingDrafts((current) => ({
      ...current,
      plannedMinor
    }));
  }

  async function applyBudgetBucketDefaultsToMobileDialog(categoryValue) {
    const categoryPatch = getCategoryPatch(categories, categoryValue);
    const categoryName = categoryPatch.categoryName ?? "";
    const { actualMinor, month } = await loadPreviousMonthCategoryActualMinor(categoryName);

    setMobileAddDialog((current) => {
      if (!current || current.kind !== "plan" || current.sectionKey !== "budget_buckets") {
        return current;
      }

      const nextCategoryName = getCategoryPatch(categories, current.categoryValue).categoryName ?? "";
      if (nextCategoryName !== categoryName) {
        return current;
      }

      return {
        ...current,
        lastPeriodActualMinor: actualMinor,
        lastPeriodMonth: month,
        plannedMinor: current.autoPlannedFromCategory ? formatMinorInput(actualMinor) : current.plannedMinor
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
    setPlanSections((current) => current.map((item) => (
      item.key === sectionKey
        ? { ...item, rows: item.rows.filter((planRow) => planRow.id !== rowId) }
        : item
    )));
    setEditingRowId((current) => (current === rowId ? null : current));
    refreshMonthDataInBackground();
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
      updatePlanRow(noteDialog.sectionKey, noteDialog.rowId, { note: noteDialog.draft });
      const section = planSections.find((item) => item.key === noteDialog.sectionKey);
      const row = section?.rows.find((item) => item.id === noteDialog.rowId);
      if (row) {
        await persistMonthRow(noteDialog.sectionKey, { ...row, note: noteDialog.draft });
      }
    }

    setNoteDialog(null);
    refreshMonthDataInBackground();
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
    refreshMonthDataInBackground();
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

  function handleOpenEntriesForActual({ categoryName, entryIds = [] }) {
    const next = new URLSearchParams();
    next.set("view", view.id);
    next.set("month", view.monthPage.month);
    next.set("scope", view.monthPage.selectedScope);
    next.set("entries_scope", view.monthPage.selectedScope);

    if (view.id !== "household") {
      next.set("entry_person", view.label);
    }

    if (entryIds.length) {
      entryIds.forEach((entryId) => next.append("entry_id", entryId));
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

      const categoryPatch = getCategoryPatch(categories, nextValue);
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

    const currentDialog = mobileAddDialog;
    const plannedMinor = parseDraftMoneyInput(mobileAddDialog.plannedMinor);
    const selectedCategoryName = getCategoryPatch(categories, mobileAddDialog.categoryValue).categoryName ?? "";
    const basePatch = {
      ...getCategoryPatch(categories, mobileAddDialog.categoryValue),
      label: mobileAddDialog.label.trim() || (mobileAddDialog.kind === "income"
        ? "Other income"
        : mobileAddDialog.sectionKey === "planned_items"
          ? "New item"
          : selectedCategoryName || "New bucket"),
      plannedMinor,
      note: mobileAddDialog.note.trim() || null
    };

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

    if (currentDialog.mode === "create") {
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
    refreshMonthDataInBackground();
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

  function togglePlanLinkEntry(entryId, checked) {
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
      />

      <MonthMetricRow cards={monthMetricCards} isRefreshing={isMonthDataRefreshing || hasPendingDerivedMonthData} />

      <MonthPlanStack
        view={view}
        categories={categories}
        categorySelectOptions={categorySelectOptions}
        accounts={accounts}
        accountSelectOptions={getAccountSelectOptions(accounts)}
        incomeRows={incomeRows}
        planSections={planSections}
        sectionOpen={sectionOpen}
        tableSorts={tableSorts}
        editingRowId={editingRowId}
        editingDrafts={editingDrafts}
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
      />

      <MonthNotesAndAccounts
        monthNote={view.monthPage.monthNote}
        visibleAccounts={visibleAccounts}
        onEditMonthNote={() => setMonthNoteDialog({ draft: view.monthPage.monthNote ?? "" })}
        onOpenEntriesForAccount={handleOpenEntriesForAccount}
      />

      {mobileAddDialog ? (
        <EntryMobileSheet
          title={mobileAddDialog.title}
          description={mobileAddDialog.description ?? "Add the row without squeezing controls into the month table."}
          saveLabel={messages.month.doneEdit}
          onClose={() => setMobileAddDialog(null)}
          onSave={() => void saveMobileAddDialog()}
        >
          <div className="month-add-dialog-grid">
            {mobileAddDialog.sharedEditHint ? (
              <p className="month-shared-edit-hint">{mobileAddDialog.sharedEditHint}</p>
            ) : null}
            <label>
              <span>{messages.month.table.category}</span>
              <div className="month-add-dialog-category">
                <CategoryAppearancePopover
                  category={getCategory(categories, {
                    categoryId: mobileAddDialog.categoryValue,
                    categoryName: mobileAddDialog.categoryValue
                  })}
                  onChange={onCategoryAppearanceChange}
                />
                <ResponsiveSelect
                  className="table-edit-input"
                  title={messages.month.table.category}
                  value={mobileAddDialog.categoryValue ?? ""}
                  options={mobileCategoryOptions}
                  onValueChange={handleMobileAddDialogCategoryChange}
                />
              </div>
            </label>
            {mobileAddDialog.kind === "plan" && mobileAddDialog.sectionKey === "planned_items" ? (
              <label>
                <span>{messages.month.table.day}</span>
                <input
                  className="table-edit-input"
                  type="date"
                  value={mobileAddDialog.planDate ?? ""}
                  onChange={(event) => setMobileAddDialog((current) => current ? { ...current, planDate: event.target.value } : current)}
                />
              </label>
            ) : null}
            <label>
              <span>{messages.month.table.item}</span>
              <input
                className="table-edit-input"
                value={mobileAddDialog.label ?? ""}
                onChange={(event) => setMobileAddDialog((current) => current ? {
                  ...current,
                  label: event.target.value,
                  autoLabelFromCategory: false
                } : current)}
              />
            </label>
            <label>
              <span>{messages.month.table.planned}</span>
              <input
                className="table-edit-input"
                inputMode="decimal"
                value={mobileAddDialog.plannedMinor ?? ""}
                onChange={(event) => setMobileAddDialog((current) => current ? {
                  ...current,
                  plannedMinor: event.target.value,
                  autoPlannedFromCategory: false
                } : current)}
              />
              {mobileAddDialog.kind === "plan" && mobileAddDialog.sectionKey === "budget_buckets" ? (
                <LastPeriodBudgetHint
                  actualMinor={mobileAddDialog.lastPeriodActualMinor}
                  month={mobileAddDialog.lastPeriodMonth}
                />
              ) : null}
            </label>
            <label>
              <span>{messages.month.table.actual}</span>
              <button
                type="button"
                className="month-actual-drilldown month-actual-drilldown-mobile"
                disabled={!mobileAddDialog.actualEntryIds?.length}
                onClick={() => handleOpenEntriesForActual({
                  categoryName: mobileAddDialog.categoryValue,
                  entryIds: mobileAddDialog.actualEntryIds ?? []
                })}
              >
                <strong>{money(mobileAddDialog.actualMinor ?? 0)}</strong>
                <small>
                  {mobileAddDialog.actualEntryIds?.length
                    ? `View ${mobileAddDialog.actualEntryIds.length} contributing ${mobileAddDialog.actualEntryIds.length === 1 ? "entry" : "entries"}`
                    : "No contributing entries yet"}
                </small>
              </button>
            </label>
            {mobileAddDialog.kind === "plan" && mobileAddDialog.sectionKey === "planned_items" ? (
              <label>
                <span>{messages.month.table.account}</span>
                <ResponsiveSelect
                  className="table-edit-input"
                  title={messages.month.table.account}
                  value={mobileAddDialog.accountName ?? ""}
                  options={[{ value: "", label: messages.common.emptyValue }, ...mobileAccountOptions]}
                  onValueChange={(nextValue) => setMobileAddDialog((current) => current ? { ...current, accountName: nextValue } : current)}
                />
              </label>
            ) : null}
            <label className="month-add-dialog-note">
              <span>{messages.month.table.note}</span>
              <textarea
                className="table-edit-input table-edit-textarea"
                value={mobileAddDialog.note ?? ""}
                onChange={(event) => setMobileAddDialog((current) => current ? { ...current, note: event.target.value } : current)}
                rows={3}
              />
            </label>
          </div>
        </EntryMobileSheet>
      ) : null}

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

      {!useMobileMonthSheet ? (
        <Dialog.Root open={Boolean(planLinkDialog)} onOpenChange={(open) => { if (!open) setPlanLinkDialog(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="note-dialog-overlay" />
            <Dialog.Content className="note-dialog-content planned-link-dialog">
              <MonthPlanLinkContent
                planLinkDialog={planLinkDialog}
                row={planLinkPickerModel.row}
                allCandidates={planLinkPickerModel.allCandidates}
                candidates={planLinkPickerModel.candidates}
                selectedIds={planLinkPickerModel.selectedIds}
                onClose={() => setPlanLinkDialog(null)}
                onToggleFilter={togglePlanLinkFilter}
                onDescriptionFilterChange={updatePlanLinkDescriptionFilter}
                onToggleEntry={togglePlanLinkEntry}
                onSave={() => void savePlanLinkDialog()}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}

      {useMobileMonthSheet && planLinkDialog ? (
        <EntryMobileSheet
          title="Match planned item"
          description={`Link exact ledger entries to ${planLinkPickerModel.row?.label ?? "this planned item"}. Budget buckets still use category totals.`}
          saveLabel="Save matches"
          onClose={() => setPlanLinkDialog(null)}
          onSave={() => void savePlanLinkDialog()}
        >
          <MonthPlanLinkContent
            planLinkDialog={planLinkDialog}
            row={planLinkPickerModel.row}
            allCandidates={planLinkPickerModel.allCandidates}
            candidates={planLinkPickerModel.candidates}
            selectedIds={planLinkPickerModel.selectedIds}
            onToggleFilter={togglePlanLinkFilter}
            onDescriptionFilterChange={updatePlanLinkDescriptionFilter}
            onToggleEntry={togglePlanLinkEntry}
            isMobile
          />
        </EntryMobileSheet>
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

function MonthPlanLinkContent({
  planLinkDialog,
  row,
  allCandidates,
  candidates,
  selectedIds,
  onClose,
  onToggleFilter,
  onDescriptionFilterChange,
  onToggleEntry,
  onSave,
  isMobile = false
}) {
  const filters = [
    ["filterLinkedOnly", "Linked"],
    ["filterSameCategoryOnly", "Same category"],
    ["filterSameAccountOnly", "Same account"],
    ["filterCurrentMonthOnly", "This month only"]
  ];

  return (
    <>
      {!isMobile ? (
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
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      <div className="planned-link-filter-panel">
        <div className="planned-link-filter-chips" aria-label="Match filters">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`planned-link-filter-chip ${planLinkDialog?.[key] ? "is-active" : ""}`}
              onClick={() => onToggleFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="planned-link-filter-summary">
          Showing {candidates.length} of {allCandidates.length} candidate entries.
        </p>
        <label className="planned-link-search">
          <span>Description filter</span>
          <input
            type="text"
            className="table-edit-input"
            placeholder="Filter descriptions in this list"
            value={planLinkDialog?.descriptionFilter ?? ""}
            onChange={(event) => onDescriptionFilterChange(event.target.value)}
          />
        </label>
      </div>
      {candidates.length ? (
        <div className="planned-link-list">
          {candidates.map((entry) => (
            <label key={entry.id} className="planned-link-row">
              <input
                type="checkbox"
                checked={selectedIds.has(entry.id)}
                onChange={(event) => onToggleEntry(entry.id, event.target.checked)}
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
        <p className="empty-copy">No matching expense entries fit the current filters.</p>
      )}
      {!isMobile ? (
        <div className="note-dialog-actions">
          <button type="button" className="subtle-cancel" onClick={onClose}>
            {messages.month.cancelEdit}
          </button>
          <button type="button" className="dialog-primary" onClick={onSave}>
            Save matches
          </button>
        </div>
      ) : null}
    </>
  );
}

function getPreviousMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
