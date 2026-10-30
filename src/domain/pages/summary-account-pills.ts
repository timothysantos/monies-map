import type { SummaryAccountPillDto } from "../../types/dto";
import { todayInAppTimeZone } from "../../lib/app-calendar";
import { loadAccounts, loadHousehold } from "../app-repository-settings";
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { accountRoutineWindowStart, buildAccountRoutineFacts, type RoutineEntryRow } from "../account-routines";
import { buildCardBillFacts, cardBillWindowStart } from "../card-bill-projection";
import { accountsForSummary } from "../summary-projection";
import { resolvePageViewId } from "../route-context";
import { resolvePageLabel } from "../page-labels";
import { loadLatestInvestmentValues } from "../import-investment-values";

// Summary account pills are a separate slice query so note edits and range
// changes do not force the wallet metadata to reload with the main page DTO.
// Card pills also carry the latest bill and unreversed bank charges
// (card-bill-projection.ts); bank account pills carry what changed in the
// account's monthly routine (account-routines.ts). Both are for the
// check-in.
export async function buildSummaryAccountPillsDto(
  db: D1Database,
  selectedViewId = "household"
): Promise<{ viewId: string; label: string; accountPills: SummaryAccountPillDto[] }> {
  const today = todayInAppTimeZone();
  const cardWindowStart = cardBillWindowStart(today);
  const routineWindowStart = accountRoutineWindowStart(today);
  // Every read at once; the pills need only the people (for the view) from
  // the page context, not its categories or tracked months.
  const [household, accounts, entries, investmentValues] = await Promise.all([
    loadHousehold(db),
    loadAccounts(db),
    loadAccountEntries(db, cardWindowStart, routineWindowStart),
    // An investment account's latest statement value (investment statements
    // only; a household without any adds nothing to the payload).
    loadLatestInvestmentValues(db)
  ]);
  const viewId = resolvePageViewId(selectedViewId, household.people);
  const label = resolvePageLabel(viewId, Object.fromEntries(household.people.map((person) => [person.id, person.name])));
  const cardFacts = buildCardBillFacts({ accounts, transactions: entries.filter((row) => row.account_kind === "credit_card" && row.transaction_date >= cardWindowStart), today });
  const routineFacts = buildAccountRoutineFacts({ accounts, transactions: entries.filter((row) => row.account_kind === "bank"), today });

  return {
    viewId,
    label,
    accountPills: accountsForSummary(viewId, accounts).map((pill) => {
      const investmentValue = investmentValues.get(pill.accountId);
      return {
        ...pill,
        ...cardFacts.get(pill.accountId),
        ...routineFacts.get(pill.accountId),
        ...(investmentValue ? { investmentValue } : {})
      };
    })
  };
}

// One read for both: the card accounts' entries from the card window (the
// payments towards the latest bill and the charges to check for reversals)
// and the bank accounts' entries from the routine window.
async function loadAccountEntries(db: D1Database, cardWindowStart: string, routineWindowStart: string) {
  const result = await db
    .prepare(`
      SELECT transactions.id, transactions.account_id, transactions.transaction_date, transactions.post_date,
        transactions.description, transactions.amount_minor, transactions.entry_type, transactions.transfer_direction,
        transactions.transfer_group_id, categories.name AS category_name, accounts.account_kind
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ?
        AND (
          (accounts.account_kind = 'credit_card' AND transactions.transaction_date >= ?)
          OR (accounts.account_kind = 'bank' AND transactions.transaction_date >= ?)
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, cardWindowStart, routineWindowStart)
    .all<RoutineEntryRow & { post_date: string | null; account_kind: string }>();
  return result.results;
}
