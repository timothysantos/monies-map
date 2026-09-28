import { buildFinancialInsightFacts } from "../domain/ai-assistance-insights";
import { effectiveScopeForView, filterEntriesForView } from "../domain/person-view-scope";

// The Month money check-in's computed facts. The page DTO's `entries` holds
// every household entry of the month (adjusted for the view) because plan
// linking needs them all, so the check-in first keeps the entries the Actual
// spend card counts: every entry for the household, and for a person only
// their own entries in the selected scope, each at their own amount (the
// same filter the Worker applies in month-page.ts). Its spend therefore
// equals the card in every view and scope, and a scope change changes the
// facts, and with them the wording cache key.

export function selectMonthInsightEntries(monthPage, viewId) {
  return filterEntriesForView(
    monthPage?.entries ?? [],
    viewId,
    effectiveScopeForView(viewId, monthPage?.selectedScope)
  );
}

export function buildMonthInsightFacts({
  viewId,
  viewLabel,
  monthPage,
  formatMoney,
  formatMonthLabel
}) {
  return buildFinancialInsightFacts({
    contextLabel: `${formatMonthLabel(monthPage.month)} month`,
    audienceKind: viewId === "household" ? "household" : "person",
    audienceName: viewId === "household" ? "" : viewLabel,
    records: selectMonthInsightEntries(monthPage, viewId),
    formatMoney
  });
}
