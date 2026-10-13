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

// What a period's income went to: one calculation for the Month and Summary
// lead, the savings bar, the money jobs (src/client/money-jobs-model.js
// re-exports it) and Ask's plan answer (ask-answer-facts.ts), so every
// screen reads the same spend and spend plan. The lead's spend counts every
// expense entry, including money filed under the Investments and Savings
// categories; that money was moved, not spent, so it comes out of the spend
// here: invested is the Investments category's share, and the Savings
// category's share is kept with whatever income was left over. The plan
// splits the same way: the savings target and the Investments plan rows come
// out of the planned spend.
const atLeastZero = (minor: number | null | undefined) => Math.max(0, minor ?? 0);

export interface MoneyUseInput {
  incomeMinor: number;
  spentMinor: number;
  investedMinor?: number;
  savedMovedMinor?: number;
  plannedSpendMinor?: number;
  savingsTargetMinor?: number;
  plannedInvestMinor?: number;
}

export function splitMoneyUse({
  incomeMinor,
  spentMinor,
  investedMinor = 0,
  savedMovedMinor = 0,
  plannedSpendMinor = 0,
  savingsTargetMinor = 0,
  plannedInvestMinor = 0
}: MoneyUseInput) {
  const income = atLeastZero(incomeMinor);
  const invested = atLeastZero(investedMinor);
  const movedToSavings = atLeastZero(savedMovedMinor);
  const spending = atLeastZero((spentMinor ?? 0) - invested - movedToSavings);
  const savePlan = atLeastZero(savingsTargetMinor);
  const investPlan = atLeastZero(plannedInvestMinor);
  return {
    income,
    spending,
    invested,
    movedToSavings,
    // Can be below zero: more went out than came in.
    kept: income - spending - invested,
    spendPlan: atLeastZero((plannedSpendMinor ?? 0) - savePlan - investPlan),
    savePlan,
    investPlan
  };
}
