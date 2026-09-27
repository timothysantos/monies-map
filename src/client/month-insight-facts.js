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
  accountPills,
  formatMoney,
  formatMonthLabel
}) {
  const plannedSpendMinor = monthSummary?.estimatedExpensesMinor ?? 0;
  return buildFinancialInsightFacts({
    contextLabel: `${formatMonthLabel(monthPage.month)} month`,
    audienceKind: viewId === "household" ? "household" : "person",
    audienceName: viewId === "household" ? "" : viewLabel,
    records: selectMonthInsightEntries(monthPage, viewId),
    formatMoney,
    perspective: "cash_flow",
    decisionMapContext: {
      plannedSpendMinor,
      confidence: buildMonthConfidence(accountPills)
    }
  });
}

// "Snapshot confidence" reads the view's wallet health from its account
// pills (the query behind Summary's "Wallets in view"): statement checkpoint
// status and unresolved transfers. The reference account list has no
// health, so it cannot vouch for anything. Until the pills load, or for a
// view with no wallets, the confidence is not evaluated and the map says so.
function buildMonthConfidence(accountPills) {
  const visibleAccounts = Array.isArray(accountPills) ? accountPills : [];
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
