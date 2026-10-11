import { headroomTone } from "../domain/money-tone";
import { formatMonthLabel } from "./formatters";

// The Summary top in the Lead · Support · Detail language (design.md): one
// lead card for spend against plan over the range, and two Support pills,
// Income (with planned income) and Saved (with the savings target). Every
// figure and tone is the Summary page DTO's own metric card
// (summary-projection.ts), so the lead never disagrees with the numbers the
// cards showed before; only the layout changed.
const CARD_LABELS = {
  plannedIncome: "Planned income",
  actualIncome: "Actual income",
  plannedSpend: "Planned spend",
  actualSpend: "Actual spend",
  savingsTarget: "Savings target",
  realizedSavings: "Realized savings"
};

// Null when any of the six cards is missing (the page is still loading): the
// panel then shows the cards as they come.
export function buildSummaryLeadModel(metricCards = []) {
  const byLabel = new Map(metricCards.map((card) => [card.label, card]));
  const card = {};
  for (const [key, label] of Object.entries(CARD_LABELS)) {
    const found = byLabel.get(label);
    if (!found || typeof found.amountMinor !== "number") {
      return null;
    }
    card[key] = found;
  }

  const actualMinor = card.actualSpend.amountMinor;
  const plannedMinor = card.plannedSpend.amountMinor;
  const headroomMinor = plannedMinor - actualMinor;
  return {
    spent: { amountMinor: actualMinor, tone: card.actualSpend.tone },
    plannedSpendMinor: plannedMinor,
    percentOfPlan: plannedMinor > 0 ? Math.round((actualMinor / plannedMinor) * 100) : null,
    // Under plan (or exactly on it) is a met plan; over it, or spending with
    // no plan at all, is over. Nothing against nothing says neither.
    headroom: plannedMinor > 0 || actualMinor > 0
      ? { amountMinor: Math.abs(headroomMinor), isOver: headroomMinor < 0, tone: headroomTone(headroomMinor) }
      : null,
    progress: { valueMinor: actualMinor, planMinor: plannedMinor },
    income: { amountMinor: card.actualIncome.amountMinor, tone: card.actualIncome.tone, planMinor: card.plannedIncome.amountMinor },
    saved: { amountMinor: card.realizedSavings.amountMinor, tone: card.realizedSavings.tone, planMinor: card.savingsTarget.amountMinor }
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
