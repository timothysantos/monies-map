import type { SummaryAccountPillDto } from "../../types/dto";
import { todayInAppTimeZone } from "../../lib/app-calendar";
import { loadAccounts } from "../app-repository";
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { buildCardBillFacts, cardBillWindowStart, type CardBillTransactionRow } from "../card-bill-projection";
import { accountsForSummary } from "../summary-projection";
import { loadRoutePageContext } from "../route-context";

// Summary account pills are a separate slice query so note edits and range
// changes do not force the wallet metadata to reload with the main page DTO.
// Card pills also carry the latest bill and unreversed bank charges, for
// the check-in (card-bill-projection.ts).
export async function buildSummaryAccountPillsDto(
  db: D1Database,
  selectedViewId = "household"
): Promise<{ viewId: string; label: string; accountPills: SummaryAccountPillDto[] }> {
  const { viewId, label } = await loadRoutePageContext(db, selectedViewId);
  const accounts = await loadAccounts(db);
  const today = todayInAppTimeZone();
  const cardEntries = await loadCardEntries(db, cardBillWindowStart(today));
  const cardFacts = buildCardBillFacts({ accounts, transactions: cardEntries, today });

  return {
    viewId,
    label,
    accountPills: accountsForSummary(viewId, accounts).map((pill) => ({ ...pill, ...cardFacts.get(pill.accountId) }))
  };
}

// The card accounts' entries from the window start: payments towards the
// latest bill and the bank charges to check for reversals.
async function loadCardEntries(db: D1Database, windowStart: string) {
  const result = await db
    .prepare(`
      SELECT transactions.id, transactions.account_id, transactions.transaction_date, transactions.post_date,
        transactions.description, transactions.amount_minor, transactions.entry_type, transactions.transfer_direction
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND accounts.account_kind = 'credit_card'
        AND transactions.transaction_date >= ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, windowStart)
    .all<CardBillTransactionRow>();
  return result.results;
}
