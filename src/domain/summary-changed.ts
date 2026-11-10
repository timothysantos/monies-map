// "What changed this month" (Summary card; DOMAIN.md "What Changed Card"):
// the month so far against the same point of the month before (the 10th
// with the 10th, never a whole month), by category, with the shops behind
// each change. It is the same-day engine Ask's "What changed?" uses
// (ask-changed.ts, usual-so-far.ts): this file only chooses which of its
// rows the card shows and adds no number of its own. It looks back only;
// nothing here predicts.
//
// Rows: the 3 categories that went up most, then the 3 that went down most.
// A category that is also more than 20% and $50 above its usual so far
// carries the "more than usual" mark, and is added to the card even when it
// is not among those 3 (at most 2 such, as the Money insights lines it
// replaced were), so the card says everything those lines said.
import { buildChangedFacts, type ChangedRow } from "./ask-changed";
import { USUAL_BAND_MINOR, USUAL_BAND_RATIO, type UsualEntry } from "./ask-usual";
import { isInvestmentsCategoryName, isSavingsCategoryName } from "./money-jobs";
import { addMonths } from "./money-signals/format";
import { categoriesAboveUsual } from "./usual-so-far";
import type { PersonScope } from "../types/dto";

export const CHANGED_CARD_ROWS = 3;
export const CHANGED_CARD_MARKED_EXTRA = 2;

export interface SummaryChangedRowDto {
  category: string;
  direction: "up" | "down";
  diffMinor: number;
  // This month so far, and the same point last month; each is a figure that
  // opens exactly its entries.
  amountMinor: number;
  ids: string[];
  baseMinor: number;
  baseIds: string[];
  moreThanUsual: boolean;
  shops: Array<{ name: string; diffMinor: number; amountMinor: number; ids: string[] }>;
}

export interface SummaryChangedDto {
  viewId: string;
  scope: PersonScope;
  // The month in progress, the point reached (its day of the month) and the
  // month it is compared with.
  month: string;
  day: number;
  baseMonth: string;
  // Rises first (largest first), then falls. Empty when nothing moved much.
  rows: SummaryChangedRowDto[];
}

// Within 15% or $20 of last month's point is "about the same" (the same band
// as Ask's "about usual").
const moved = (row: ChangedRow) => Math.abs(row.diffMinor) > USUAL_BAND_MINOR && Math.abs(row.diffMinor) > row.baseMinor * USUAL_BAND_RATIO;

/** The card for the month in progress, or null with nothing to compare. */
export function buildSummaryChanged(input: { viewId: string; scope: PersonScope; today: string; entries: UsualEntry[] }): SummaryChangedDto | null {
  const month = input.today.slice(0, 7);
  const baseMonth = addMonths(month, -1);
  // Savings and investments are money put aside, not spending.
  const entries = input.entries.filter((entry) => !isInvestmentsCategoryName(entry.categoryName) && !isSavingsCategoryName(entry.categoryName));
  if (!entries.some((entry) => entry.date.slice(0, 7) === baseMonth) || !entries.some((entry) => entry.date.slice(0, 7) === month)) {
    return null;
  }
  const facts = buildChangedFacts({ month, base: "previous", viewId: input.viewId, scope: input.scope, entries, trackedMonths: [], today: input.today, maxRows: Number.MAX_SAFE_INTEGER });
  const above = new Set(categoriesAboveUsual(entries.map((entry) => ({ id: entry.id, date: entry.date, categoryName: entry.categoryName, entryType: entry.entryType, amountMinor: entry.amountMinor })), input.today).categories.map((group) => group.key));
  const pick = (rows: ChangedRow[]) => rows.filter(moved).slice(0, CHANGED_CARD_ROWS);
  const ups = pick(facts.increases);
  const downs = pick(facts.decreases);
  const shown = new Set([...ups, ...downs].map((row) => row.category));
  const extra = [...facts.increases, ...facts.decreases]
    .filter((row) => above.has(row.category) && !shown.has(row.category))
    .slice(0, CHANGED_CARD_MARKED_EXTRA);
  const byChange = (left: ChangedRow, right: ChangedRow) => Math.abs(right.diffMinor) - Math.abs(left.diffMinor) || left.category.localeCompare(right.category);
  const rises = [...ups, ...extra.filter((row) => row.diffMinor > 0)].sort(byChange);
  const falls = [...downs, ...extra.filter((row) => row.diffMinor < 0)].sort(byChange);
  const toDto = (direction: "up" | "down") => (row: ChangedRow): SummaryChangedRowDto => ({
    category: row.category,
    direction,
    diffMinor: row.diffMinor,
    amountMinor: row.amountMinor,
    ids: row.ids,
    baseMinor: row.baseMinor,
    baseIds: row.baseIds,
    moreThanUsual: above.has(row.category),
    shops: row.shops
  });
  return {
    viewId: input.viewId,
    scope: input.scope,
    month,
    day: Number(input.today.slice(8, 10)),
    baseMonth,
    rows: [...rises.map(toDto("up")), ...falls.map(toDto("down"))]
  };
}
