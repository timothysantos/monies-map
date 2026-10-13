import { flowTone, signTone } from "../domain/money-tone";
import { plannedInvestMinor } from "../domain/money-job-plan";
import { buildSummaryLeadModel } from "./summary-lead-model";

// The Month top in the Lead · Support · Detail language (design.md): the
// Summary lead's shape for one month, plus the Remaining budget pill. The
// spend, plan, savings target and remaining budget are the Month metric
// cards' own figures (buildMonthMetricCards); income received and the
// realized savings are the month's Summary rollup, which the Month page
// already carries (summaryPage.months[0]). The investment goal is the
// month's Investments plan rows, and what was invested its category share
// and its transfers into and out of investment accounts
// (monthPage.planSections, monthPage.categoryShareChart,
// monthPage.investmentMoves), also already on the page. Nothing is fetched or recomputed another way, so the lead never
// disagrees with the cards it replaced. Returns null until the cards are
// there.
export function buildMonthLeadModel(metricCards = [], monthSummary = null, { planRows = [], categoryShare = [], investmentMoves = null } = {}) {
  const byLabel = new Map(metricCards.map((card) => [card.label, card]));
  const remaining = byLabel.get("Remaining budget");
  if (!remaining || !byLabel.has("Actual spend") || !byLabel.has("Planned spend")) {
    return null;
  }
  const actualIncomeMinor = monthSummary?.actualIncomeMinor ?? 0;
  const realizedSavingsMinor = monthSummary?.realizedSavingsMinor ?? actualIncomeMinor - byLabel.get("Actual spend").amountMinor;
  const lead = buildSummaryLeadModel([
    byLabel.get("Planned income"),
    { label: "Actual income", amountMinor: actualIncomeMinor, tone: flowTone(actualIncomeMinor) },
    byLabel.get("Planned spend"),
    byLabel.get("Actual spend"),
    byLabel.get("Savings target"),
    { label: "Realized savings", amountMinor: realizedSavingsMinor, tone: signTone(realizedSavingsMinor) },
    { label: "Planned investments", amountMinor: plannedInvestMinor(planRows), tone: "plan" }
  ].filter(Boolean), { categoryShare, investmentMoves });
  if (!lead) {
    return null;
  }
  return {
    ...lead,
    remaining: {
      label: remaining.label,
      amountMinor: remaining.amountMinor,
      tone: remaining.tone,
      detail: remaining.detail,
      detailPopover: remaining.detailPopover
    }
  };
}
