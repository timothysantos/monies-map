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
  monthSummary,
  accounts,
  formatMoney,
  formatMonthLabel
}) {
  const plannedSpendMinor = monthSummary?.estimatedExpensesMinor ?? 0;
  const actualSpendMinor = monthSummary?.realExpensesMinor ?? 0;
  return buildFinancialInsightFacts({
    contextLabel: `${formatMonthLabel(monthPage.month)} month`,
    audienceKind: viewId === "household" ? "household" : "person",
    audienceName: viewId === "household" ? "" : viewLabel,
    records: selectMonthInsightEntries(monthPage, viewId),
    formatMoney,
    perspective: "cash_flow",
    accountingAdvice: actualSpendMinor > plannedSpendMinor && plannedSpendMinor > 0
      ? "Actual spending is above the planned budget. Check the largest category and any pending bank rows before changing the plan or assuming the overspend is a one-off."
      : "Keep the plan, actual entries, and any pending bank rows current before reallocating unused budget or treating the remaining amount as free to spend.",
    decisionMapContext: {
      plannedSpendMinor,
      confidence: buildMonthConfidence(accounts)
    }
  });
}

function buildMonthConfidence(accounts) {
  const visibleAccounts = accounts ?? [];
  const evaluated = visibleAccounts.length > 0;
  return visibleAccounts.reduce((result, account) => ({
    evaluated,
    reconciliationMismatchCount: result.reconciliationMismatchCount + (account.reconciliationStatus === "mismatch" ? 1 : 0),
    needsCheckpointCount: result.needsCheckpointCount + (account.reconciliationStatus === "needs_checkpoint" ? 1 : 0),
    unresolvedTransferCount: result.unresolvedTransferCount + Number(account.unresolvedTransferCount ?? 0)
  }), {
    evaluated,
    reconciliationMismatchCount: 0,
    needsCheckpointCount: 0,
    unresolvedTransferCount: 0
  });
}
