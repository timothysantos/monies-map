// Money jobs (DOMAIN.md "Money job"): each line of a month plan has a job.
// Planned income is money to come in; the rows labelled "Savings" are the
// savings target (the existing rule, month-projection.ts); rows in the
// Investments category are the investment goal; every other planned row is
// the spending budget (the plan rows: money-job-plan.ts). Shared by the
// Summary projection and the client's lead, savings bar and money jobs, so the
// server and the screen sort plan rows and entries the same way.
//
// Money filed under the Investments or Savings category is money the
// household moved, not spent: the savings bar and the jobs take it out of
// the spend and show it as invested or kept. Matching is by category name,
// as category-offset.ts does.

function normalizedName(name?: string | null) {
  return String(name ?? "").trim().toLowerCase();
}

export function isInvestmentsCategoryName(name?: string | null) {
  return normalizedName(name) === "investments";
}

export function isSavingsCategoryName(name?: string | null) {
  return normalizedName(name) === "savings";
}
