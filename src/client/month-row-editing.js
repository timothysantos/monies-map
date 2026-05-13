import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { getMonthPlanEditSource } from "./month-state";
import { getRowDateValue } from "./table-helpers";

const { format: formatService } = moniesClient;

// Month plan rows use a few terms that are easy to forget when skimming:
// - "derived" rows are rollups shown in the current view, not the source row
//   that should be edited directly.
// - "shared" edits may show one person's weighted share in the table even
//   though the editor needs the full shared amount underneath.
// - "mobile dialog" is the fallback editor when the table would be too cramped.
const DERIVED_SHARE_NOTE_PATTERN = /\s*• weighted to .*? share/g;

export function stripDerivedMonthRowNote(note) {
  return (note ?? "")
    .replace(DERIVED_SHARE_NOTE_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function canInlineEditMonthRow({ isCombinedHouseholdView, row }) {
  return !isCombinedHouseholdView && !row.isDerived;
}

export function canInlineEditMonthPlanRow({ isCombinedHouseholdView, row }) {
  return !isCombinedHouseholdView && (
    !row.isDerived || (row.sourceRowIds?.length ?? 0) === 1
  );
}

export function canOpenMonthMobileSheet({ isCombinedHouseholdView, row }) {
  if (isCombinedHouseholdView) {
    return false;
  }

  if (!row.isDerived) {
    return true;
  }

  return (row.sourceRowIds?.length ?? 0) === 1;
}

export function getMonthPlanSharedEditHint({ row, viewId, viewLabel }) {
  if (!row.isDerived || !viewId || viewId === "household") {
    return "";
  }

  const matchingSplit = row.splits.find((split) => split.personId === viewId);
  if (!matchingSplit) {
    return "";
  }

  const sharePercent = Number((matchingSplit.ratioBasisPoints / 100).toFixed(2));
  const shareLabel = Number.isInteger(sharePercent) ? String(sharePercent) : sharePercent.toFixed(2);
  return `You're editing the shared total. This ${viewLabel} view shows ${viewLabel}'s ${shareLabel}% share after save.`;
}

export function buildMobileMonthIncomeDialog(row) {
  return {
    mode: "edit",
    kind: "income",
    rowId: row.id,
    title: messages.month.editIncomeSource,
    description: "Edit this month row without squeezing controls into the table.",
    categoryValue: row.categoryId ?? row.categoryName,
    label: row.label ?? "",
    plannedMinor: formatService.formatMinorInput(row.plannedMinor),
    note: row.note ?? "",
    actualMinor: row.actualMinor ?? 0,
    actualEntryIds: row.actualEntryIds ?? []
  };
}

export function buildMobileMonthPlanDialog({ monthKey, row, sectionKey, viewId, viewLabel }) {
  const sourceRow = getMonthPlanEditSource(row);
  return {
    mode: "edit",
    kind: "plan",
    rowId: row.id,
    sectionKey,
    title: sectionKey === "planned_items" ? messages.month.editPlannedItem : messages.month.editBudgetBucket,
    description: "Edit this month row without squeezing controls into the table.",
    categoryValue: sourceRow.categoryId ?? sourceRow.categoryName,
    label: sourceRow.label ?? "",
    plannedMinor: formatService.formatMinorInput(sourceRow.plannedMinor),
    planDate: sectionKey === "planned_items" ? getRowDateValue(sourceRow, monthKey) : "",
    accountName: sectionKey === "planned_items" ? (sourceRow.accountName ?? "") : "",
    note: sourceRow.note ?? "",
    actualMinor: row.actualMinor ?? 0,
    actualEntryIds: row.actualEntryIds ?? [],
    autoLabelFromCategory: false,
    autoPlannedFromCategory: false,
    lastPeriodActualMinor: sectionKey === "budget_buckets" ? row.lastPeriodActualMinor ?? 0 : undefined,
    lastPeriodMonth: sectionKey === "budget_buckets" ? row.lastPeriodMonth : undefined,
    sharedEditHint: getMonthPlanSharedEditHint({ row, viewId, viewLabel })
  };
}
