// The plan side of the money jobs (DOMAIN.md "Money job"): which planned
// rows are the savings target and which are the investment goal. Kept apart
// from money-jobs.ts, whose category names the first screen needs: only the
// Month route and the Summary projection read plan rows.
import { isInvestmentsCategoryName } from "./money-jobs";

type PlanRowLike = { label?: string | null; categoryName?: string | null; plannedMinor?: number | null };

/** A savings target row (the label rule the savings target has always used). */
export function isSavingsTargetRow(row: PlanRowLike) {
  return row.label === "Savings";
}

/** A planned row whose job is investing. */
export function isInvestmentPlanRow(row: PlanRowLike) {
  return !isSavingsTargetRow(row) && isInvestmentsCategoryName(row.categoryName);
}

export function plannedInvestMinor(rows: PlanRowLike[]) {
  return rows.filter(isInvestmentPlanRow).reduce((sum, row) => sum + (row.plannedMinor ?? 0), 0);
}
