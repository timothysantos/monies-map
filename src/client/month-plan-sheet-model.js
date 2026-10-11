import { headroomTone, incomeVarianceTone } from "../domain/money-tone";

// The plan-row sheet's lead (month-plan-sheet.jsx): the planned amount is
// the lead, actual against it under the bar. A spending row (planned item,
// budget bucket) says what is left, or how much it is over in rose; an
// income row says what is still to come (rose, as the Month table's income
// variance) and nothing once it is in. A new row has no actual yet, so no bar.
export function buildPlanSheetLead({ kind, mode, actualMinor = 0, plannedMinor = 0 }) {
  const isIncome = kind === "income";
  const gapMinor = plannedMinor - actualMinor;
  let end = null;
  if (isIncome) {
    const tone = incomeVarianceTone(plannedMinor, actualMinor);
    end = tone === "short" ? { amountMinor: gapMinor, word: "toCome", tone } : null;
  } else {
    end = { amountMinor: Math.abs(gapMinor), word: gapMinor >= 0 ? "left" : "over", tone: headroomTone(gapMinor) };
  }
  return {
    showProgress: mode === "edit",
    progress: { valueMinor: actualMinor, planMinor: plannedMinor, overIsShort: !isIncome },
    actualWord: isIncome ? "received" : "spent",
    end
  };
}
