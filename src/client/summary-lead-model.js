import { flowTone, headroomTone, signTone, spendTone } from "../domain/money-tone";
import { isInvestmentsCategoryName, isSavingsCategoryName } from "../domain/money-jobs";
import { formatMonthLabel } from "./formatters";
import { splitMoneyUse } from "./money-jobs-model";

// The Summary top in the Lead · Support · Detail language (design.md): one
// lead card for spend against plan over the range, and two Support pills,
// Income (with planned income) and Saved (with the savings target). The
// figures start from the Summary page DTO's own metric cards
// (summary-projection.ts) and go through one split, splitMoneyUse
// (money-jobs-model.js; DOMAIN.md "Money job"): money filed under
// Investments or Savings was moved, not spent, and the savings target and
// the Investments plan rows are not spend plan. So the lead's "Spent" is the
// spend job's spending, its plan is the spend job's plan, its "under / over
// plan" agrees with the spend job, and Saved is the bar's "kept".
const CARD_LABELS = {
  plannedIncome: "Planned income",
  actualIncome: "Actual income",
  plannedSpend: "Planned spend",
  actualSpend: "Actual spend",
  savingsTarget: "Savings target",
  realizedSavings: "Realized savings"
};

// The money filed under Investments and under Savings in the period's
// category share (the same spending the Actual spend card counts).
function movedMoney(categoryShare) {
  let investedMinor = 0;
  let savedMovedMinor = 0;
  for (const slice of categoryShare ?? []) {
    if (isInvestmentsCategoryName(slice.label)) investedMinor += slice.valueMinor;
    else if (isSavingsCategoryName(slice.label)) savedMovedMinor += slice.valueMinor;
  }
  return { investedMinor, savedMovedMinor };
}

// Null when any of the six cards is missing (the page is still loading): the
// panel then shows the cards as they come. "Planned investments", the
// category share and the investment moves (the page's `investmentMoves`:
// transfers into and out of investment accounts, investment-moves.ts) are
// optional: without them nothing is invested or moved.
// `hasPlanRows` is the Month page's: a month with plan lines has a plan even
// when every line is zero.
export function buildSummaryLeadModel(metricCards = [], { categoryShare = [], investmentMoves = null, hasPlanRows = false } = {}) {
  const byLabel = new Map(metricCards.map((card) => [card.label, card]));
  const card = {};
  for (const [key, label] of Object.entries(CARD_LABELS)) {
    const found = byLabel.get(label);
    if (!found || typeof found.amountMinor !== "number") {
      return null;
    }
    card[key] = found;
  }

  const figures = splitMoneyUse({
    incomeMinor: card.actualIncome.amountMinor,
    spentMinor: card.actualSpend.amountMinor,
    ...movedMoney(categoryShare),
    movedIntoInvestmentsMinor: investmentMoves?.intoMinor ?? 0,
    takenFromInvestmentsMinor: investmentMoves?.outOfMinor ?? 0,
    plannedSpendMinor: card.plannedSpend.amountMinor,
    savingsTargetMinor: card.savingsTarget.amountMinor,
    plannedInvestMinor: byLabel.get("Planned investments")?.amountMinor ?? 0
  });
  const actualMinor = figures.spending;
  const plannedMinor = figures.spendPlan;
  const headroomMinor = plannedMinor - actualMinor;
  return {
    spent: { amountMinor: actualMinor, tone: spendTone(actualMinor, plannedMinor) },
    plannedSpendMinor: plannedMinor,
    percentOfPlan: plannedMinor > 0 ? Math.round((actualMinor / plannedMinor) * 100) : null,
    // Under plan (or exactly on it) is a met plan; over it, or spending with
    // no plan at all, is over. Nothing against nothing says neither.
    headroom: plannedMinor > 0 || actualMinor > 0
      ? { amountMinor: Math.abs(headroomMinor), isOver: headroomMinor < 0, tone: headroomTone(headroomMinor) }
      : null,
    income: { amountMinor: card.actualIncome.amountMinor, tone: card.actualIncome.tone, planMinor: card.plannedIncome.amountMinor },
    saved: { amountMinor: figures.kept, tone: signTone(figures.kept), planMinor: figures.savePlan },
    // Whether the period has any plan: it picks Plan or Simple until the
    // person chooses (lead-view.js).
    hasPlan: hasPlanRows || card.plannedIncome.amountMinor > 0 || card.plannedSpend.amountMinor > 0
      || figures.savePlan > 0 || figures.investPlan > 0,
    // The Simple view's lead, "Earned $x · Spent $y": the same split with no
    // plan. Spending is plain ink unless more went out than came in.
    simple: {
      earned: { amountMinor: figures.income, tone: flowTone(figures.income) },
      spent: { amountMinor: actualMinor, tone: spendTone(actualMinor, figures.income) }
    },
    // The split itself, for the savings bar and the money jobs.
    figures
  };
}

// "Oct 2025 – Sep 2026", or one month when the range is one month.
export function formatSummaryLeadRange(startMonth, endMonth) {
  if (!startMonth || !endMonth) {
    return "";
  }
  return startMonth === endMonth
    ? formatMonthLabel(startMonth)
    : `${formatMonthLabel(startMonth)} – ${formatMonthLabel(endMonth)}`;
}
