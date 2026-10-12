// Money jobs (DOMAIN.md "Money job"): each line of a month plan has a job.
// Planned income is money to come in; the rows labelled "Savings" are the
// savings target (the existing rule, month-projection.ts); rows in the
// Investments category are the investment goal; every other planned row is
// the spending budget. Shared by the Summary projection (the range's planned
// investments) and the client's savings bar and money jobs Detail, so the
// server and the screen sort plan rows and entries the same way.
//
// Money filed under the Investments or Savings category is money the
// household moved, not spent: the savings bar and the jobs take it out of
// the spend and show it as invested or kept. Matching is by category name,
// as category-offset.ts does.

type PlanRowLike = { label?: string | null; categoryName?: string | null; plannedMinor?: number | null };

function normalizedName(name?: string | null) {
  return String(name ?? "").trim().toLowerCase();
}

export function isInvestmentsCategoryName(name?: string | null) {
  return normalizedName(name) === "investments";
}

export function isSavingsCategoryName(name?: string | null) {
  return normalizedName(name) === "savings";
}

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
