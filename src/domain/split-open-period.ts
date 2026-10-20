// The one definition of a split group's open period, shared by every figure
// on the Splits page: the lead chip, the entry count's expenses, the category
// donut and the Money insights that talk about "now".
//
// An expense is in the open period when no settle-up has covered it: it is
// not in a closed batch (Settle group) and not in a settlement checkpoint
// whose status is not `reopened` or `voided`. splits-projection.ts reports
// that as `settlementStatus` on every activity item ("settled" is covered),
// and this module reads only that field, so there is no second rule.
//
// Amounts are the expense totals in the group's own currency, never
// converted. Deleted expenses are never in the activity.
import type { DonutChartDatumDto } from "../types/dto";

export interface OpenPeriodItem {
  kind: string;
  totalAmountMinor: number;
  settlementStatus?: string;
  categoryName?: string;
  shares?: Array<{ personId: string; amountMinor: number }>;
}

export function isCoveredBySettleUp(item: Pick<OpenPeriodItem, "settlementStatus">) {
  return item.settlementStatus === "settled";
}

export function isOpenExpense(item: Pick<OpenPeriodItem, "kind" | "settlementStatus">) {
  return item.kind === "expense" && !isCoveredBySettleUp(item);
}

export interface SettledSectionItem extends OpenPeriodItem {
  date: string;
  settlementCheckpointId?: string;
  currency?: string;
}

export interface SettledSectionCheckpoint {
  id: string;
  settlementDate: string;
  status: string;
  settledAt?: string;
}

export interface SettledSection<T> {
  checkpointId: string;
  settlementDate: string;
  // True once the people are square: the bank payment is matched, the
  // balances cancelled out, or the payment was marked paid. False while a
  // simplified settlement still waits for its payment.
  isPaid: boolean;
  items: T[];
  // Every record in the section, expenses and settle-ups alike.
  entryCount: number;
  // The expense totals only, in the group's own currency (the chip's rule).
  spendMinor: number;
}

/**
 * The Splits activity list in two parts: the open records, and the records a
 * settlement checkpoint covers, one section per checkpoint (newest first).
 * "Covered" is `isCoveredBySettleUp`, the open period's own rule, so a
 * reopened or voided checkpoint's records are open again. A covered record
 * with no checkpoint is in a closed batch: it belongs to the archive, so it
 * is in neither part.
 */
export function partitionActivityBySettlement<T extends SettledSectionItem>(
  activity: T[],
  checkpoints: SettledSectionCheckpoint[] = []
) {
  const open: T[] = [];
  const byCheckpoint = new Map<string, T[]>();
  for (const item of activity) {
    if (!isCoveredBySettleUp(item)) {
      open.push(item);
    } else if (item.settlementCheckpointId) {
      const items = byCheckpoint.get(item.settlementCheckpointId) ?? [];
      items.push(item);
      byCheckpoint.set(item.settlementCheckpointId, items);
    }
  }
  const sections: Array<SettledSection<T>> = [...byCheckpoint].map(([checkpointId, items]) => {
    const checkpoint = checkpoints.find((candidate) => candidate.id === checkpointId);
    const latestItemDate = items.map((item) => item.date).sort().at(-1) ?? "";
    return {
      checkpointId,
      settlementDate: checkpoint?.settlementDate ?? latestItemDate,
      isPaid: isSettlementPaid(checkpoint),
      items,
      entryCount: items.length,
      spendMinor: items.reduce((sum, item) => sum + (item.kind === "expense" ? item.totalAmountMinor : 0), 0)
    };
  });
  sections.sort(compareSettledSections);
  return { open, sections };
}

// Paid once the bank payment is matched, the balances cancelled out, or the
// payment was marked paid (a section whose checkpoint is unknown reads paid).
export function isSettlementPaid(checkpoint: Pick<SettledSectionCheckpoint, "status" | "settledAt"> | undefined) {
  return !checkpoint || ["matched", "internally_offset"].includes(checkpoint.status) || Boolean(checkpoint.settledAt);
}

// Newest settlement first.
export function compareSettledSections(left: { settlementDate: string; checkpointId: string }, right: { settlementDate: string; checkpointId: string }) {
  return right.settlementDate.localeCompare(left.settlementDate) || left.checkpointId.localeCompare(right.checkpointId);
}

/**
 * A settled section without its rows: what the Splits page sends for each
 * settlement and group (the rows load when the section is opened). The same
 * numbers partitionActivityBySettlement gives the section with its rows.
 */
export interface SettledSectionSummary {
  checkpointId: string;
  groupId: string;
  settlementDate: string;
  isPaid: boolean;
  entryCount: number;
  spendMinor: number;
  currency: string;
}

/**
 * Spend of the open period, how many expenses it holds, and whether any record
 * of the group was ever settled (which is what lets a label say "since last
 * settle-up").
 */
export function summariseOpenPeriod<T extends OpenPeriodItem>(activity: T[]) {
  const openExpenses: T[] = [];
  let spendMinor = 0;
  let hasSettledBefore = false;
  for (const item of activity) {
    if (isCoveredBySettleUp(item)) {
      hasSettledBefore = true;
    } else if (item.kind === "expense") {
      openExpenses.push(item);
      spendMinor += item.totalAmountMinor;
    }
  }
  return { spendMinor, expenseCount: openExpenses.length, hasSettledBefore, openExpenses };
}

// One person's own share of an expense; the household sees the whole amount.
export function expenseAmountForView(item: OpenPeriodItem, viewId: string) {
  if (viewId === "household") {
    return item.totalAmountMinor;
  }
  return item.shares?.find((share) => share.personId === viewId)?.amountMinor ?? 0;
}

/**
 * The category donut of the group's open period. The household view charts
 * the full expense amounts (its centre equals the chip); a person view charts
 * that person's own share of each expense. Built from the same activity list
 * the chip adds up, so the two cannot describe different sets.
 */
export function buildOpenPeriodDonut(
  activity: OpenPeriodItem[],
  categories: Array<{ id?: string; name: string }>,
  viewId: string
): DonutChartDatumDto[] {
  const byLabel = new Map<string, { valueMinor: number; entryCount: number }>();
  for (const item of summariseOpenPeriod(activity).openExpenses) {
    const amountMinor = expenseAmountForView(item, viewId);
    if (amountMinor <= 0) {
      continue;
    }
    const label = item.categoryName || "Other";
    const current = byLabel.get(label) ?? { valueMinor: 0, entryCount: 0 };
    current.valueMinor += amountMinor;
    current.entryCount += 1;
    byLabel.set(label, current);
  }
  return [...byLabel.entries()]
    .map(([label, { valueMinor, entryCount }]) => ({
      key: label,
      categoryId: categories.find((category) => category.name === label)?.id,
      label,
      valueMinor,
      entryCount
    }))
    .sort((left, right) => right.valueMinor - left.valueMinor || left.label.localeCompare(right.label));
}

/**
 * Everything the Splits lead card and its donut read for one group, from the
 * group's activity: `groupActivity` is all of it (it decides whether the group
 * was ever settled), `shownActivity` is the part on screen (not in a closed
 * batch, narrowed by the search) that the chip and the donut describe.
 */
export function deriveGroupFigures(input: {
  groupActivity: OpenPeriodItem[];
  shownActivity: OpenPeriodItem[];
  categories: Array<{ id?: string; name: string }>;
  viewId: string;
}) {
  return {
    spendMinor: summariseOpenPeriod(input.shownActivity).spendMinor,
    hasSettledBefore: summariseOpenPeriod(input.groupActivity).hasSettledBefore,
    donutChart: buildOpenPeriodDonut(input.shownActivity, input.categories, input.viewId)
  };
}
