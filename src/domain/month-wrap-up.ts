// The month wrap-up (DOMAIN.md "Month Wrap-up"): one calm checklist on the
// Month page that helps close a month. It adds no rule of its own about
// money: every check reads an existing projection (What changed, the Import
// inbox's expected statements, the Splits balance, the "Usually shared"
// rule, the plan variance, the monthly note) and says whether something is
// left to do. Guidance only: nothing records a month as closed, and nothing
// here predicts.
//
// Pure and small, so the server projection (month-wrap-up-projection.ts)
// and the lazy Month card share it.
import { budgetLinesOverPlan } from "./money-signals/month-signals";
import { daysInMonth } from "./money-signals/format";
import type { MonthWrapUpDto } from "../types/dto";

export const MONTH_WRAP_UP_CONFIG = Object.freeze({
  // The month in progress shows its wrap-up in its last this-many days.
  lastDaysOfMonth: 3,
  // The "What changed" rows the card lists before "See all".
  changedRows: 3,
  // Split balances it names, biggest first.
  splitBalances: 3
});

/** The month's last day, "2026-10-31". */
export function lastDayOfMonth(month: string) {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

/**
 * Whether a month can be wrapped up today: a month that has ended, or the
 * month in progress in its last few days. Never a future month.
 */
export function monthWrapUpIsOpen(month: string, today: string) {
  const current = today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > current) {
    return false;
  }
  if (month < current) {
    return true;
  }
  return Number(today.slice(8, 10)) > daysInMonth(month) - MONTH_WRAP_UP_CONFIG.lastDaysOfMonth;
}

/** The day the month is read up to: its last day, or today in the month in progress. */
export function monthWrapUpEndDate(month: string, today: string) {
  const last = lastDayOfMonth(month);
  return today < last ? today : last;
}

export type MonthWrapUpCheckId = "other" | "estimates" | "statements" | "splits" | "plan" | "note";

interface PlanRowFacts {
  id: string;
  label?: string;
  categoryName?: string;
  plannedMinor: number;
  actualMinor: number;
}

export interface MonthWrapUpCheck {
  id: MonthWrapUpCheckId;
  done: boolean;
}

export interface MonthWrapUpPlanLine {
  id: string;
  name: string;
  plannedMinor: number;
  actualMinor: number;
  overMinor: number;
}

export interface MonthWrapUpChecks {
  checks: MonthWrapUpCheck[];
  // The category budgets over plan (the plan check's lines), furthest first.
  overPlan: MonthWrapUpPlanLine[];
  // Whether the month has a plan at all (a category budget with an amount).
  hasPlan: boolean;
  doneCount: number;
  // Every check done: the card folds to one line.
  wrappedUp: boolean;
}

/**
 * The checklist: the server's facts plus the two the Month page already
 * holds (its plan sections and its note). A check with nothing to do is
 * done, never hidden; a check that cannot apply is left out (no statement
 * accounts in the view, no plan for the month). "What changed" is
 * information, not a check.
 */
export function buildMonthWrapUpChecks(input: {
  wrapUp: Pick<MonthWrapUpDto, "other" | "estimates" | "statements" | "splits">;
  planSections: Array<{ key: string; rows?: PlanRowFacts[] }>;
  monthNote: string | null | undefined;
}): MonthWrapUpChecks {
  const { wrapUp } = input;
  const hasPlan = input.planSections.some((section) => section.key === "budget_buckets" && (section.rows ?? []).some((row) => row.plannedMinor > 0));
  const overPlan = budgetLinesOverPlan(input.planSections).map((row) => ({
    id: row.id,
    name: row.label || row.categoryName || "",
    plannedMinor: row.plannedMinor,
    actualMinor: row.actualMinor,
    overMinor: row.actualMinor - row.plannedMinor
  }));
  const checks: MonthWrapUpCheck[] = [
    { id: "other", done: wrapUp.other.ids.length === 0 },
    { id: "estimates", done: wrapUp.estimates.ids.length === 0 }
  ];
  if (wrapUp.statements.accountCount > 0) {
    checks.push({ id: "statements", done: wrapUp.statements.missing.length === 0 });
  }
  checks.push({ id: "splits", done: wrapUp.splits.balances.length === 0 && wrapUp.splits.usuallySharedIds.length === 0 });
  if (hasPlan) {
    checks.push({ id: "plan", done: overPlan.length === 0 });
  }
  checks.push({ id: "note", done: Boolean(String(input.monthNote ?? "").trim()) });
  const doneCount = checks.filter((check) => check.done).length;
  return { checks, overPlan, hasPlan, doneCount, wrappedUp: doneCount === checks.length };
}
