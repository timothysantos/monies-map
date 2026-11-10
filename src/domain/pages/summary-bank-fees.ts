import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { buildLinkedSplitShareMap, LINKED_SPLIT_SHARES_SQL, type LinkedSplitShareRow } from "../app-repository-entries";
import { buildBankFeesYear, type BankFeeRow, type BankFeesYear } from "../bank-fees-year";
import { isSpendingCategoryName } from "../category-offset";
import { personEntryAmountMinor } from "../person-entry-amount";
import type { EntryDto, PersonScope } from "../../types/dto";

// Summary's "bank fees this year" (bank-fees-year.ts): the year of the
// range's last month, from 1 January to that month's end, in the view and
// scope. One read, bounded by the date window and by the words a fee's
// description starts with (the classifiers decide), run beside the Summary
// page's other reads; a person view adds the window's split shares in the
// same step, so a shared fee counts at their share as every figure does.
export const BANK_FEE_CANDIDATES_SQL = `
  SELECT
    transactions.id,
    transactions.account_id,
    accounts.account_kind,
    transactions.transaction_date,
    transactions.description,
    transactions.amount_minor,
    transactions.entry_type,
    transactions.owner_person_id,
    categories.name AS category_name
  FROM transactions
  INNER JOIN accounts ON accounts.id = transactions.account_id
  LEFT JOIN categories ON categories.id = transactions.category_id
  -- Every condition reads the entry's own columns, so the joins run only
  -- for the few rows that could be a fee.
  WHERE transactions.household_id = ?
    AND transactions.transaction_date >= ?
    AND transactions.transaction_date < ?
    AND transactions.entry_type IN ('expense', 'income')
    AND transactions.transfer_group_id IS NULL
    AND (
      transactions.description LIKE '%FEE%'
      OR transactions.description LIKE '%CHARGE%'
      OR transactions.description LIKE '%INTEREST%'
      OR transactions.description LIKE '%RETURNED%'
      OR transactions.description LIKE '%REJECT%'
      OR transactions.description LIKE '%UNSUCCESSFUL%'
      OR transactions.description LIKE '%INSUFFICIENT%'
      OR transactions.category_id IN (SELECT id FROM categories WHERE name = 'Fees')
    )
    AND (transactions.import_id IS NULL OR transactions.import_id IN (SELECT id FROM imports WHERE status = 'completed'))
`;

interface CandidateRow {
  id: string;
  account_id: string;
  account_kind: string;
  transaction_date: string;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income";
  owner_person_id: string | null;
  category_name: string | null;
}

const nextMonthStart = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
};

export async function loadBankFeesYear(
  db: D1Database,
  viewId: string,
  scope: PersonScope,
  focusMonth: string
): Promise<BankFeesYear | undefined> {
  if (!/^\d{4}-\d{2}$/.test(focusMonth)) {
    return undefined;
  }
  const year = focusMonth.slice(0, 4);
  const start = `${year}-01-01`;
  const end = nextMonthStart(focusMonth);
  const isPerson = viewId !== "household";
  const [candidates, shares] = await Promise.all([
    db.prepare(BANK_FEE_CANDIDATES_SQL).bind(DEFAULT_HOUSEHOLD_ID, start, end).all<CandidateRow>(),
    isPerson
      ? db.prepare(LINKED_SPLIT_SHARES_SQL).bind(DEFAULT_HOUSEHOLD_ID, start, end).all<LinkedSplitShareRow>().then((result) => buildLinkedSplitShareMap(result.results))
      : Promise.resolve(null)
  ]);
  const rows: BankFeeRow[] = [];
  for (const row of candidates.results) {
    let amountMinor: number | null = Math.abs(row.amount_minor);
    if (isPerson && shares) {
      const linkedShares = shares.get(row.id);
      amountMinor = personEntryAmountMinor({
        amountMinor,
        ownershipType: "direct",
        linkedSplitExpenseId: linkedShares ? row.id : undefined,
        linkedSplitShares: linkedShares,
        splits: row.owner_person_id ? [{ personId: row.owner_person_id, amountMinor }] : []
      } as unknown as EntryDto, viewId, scope);
    }
    if (amountMinor === null || amountMinor <= 0) {
      continue;
    }
    rows.push({
      id: row.id,
      accountId: row.account_id,
      accountKind: row.account_kind,
      date: row.transaction_date,
      description: row.description,
      amountMinor,
      direction: row.entry_type === "income" ? "in" : "out",
      offsetsSpending: row.entry_type === "income" && isSpendingCategoryName(row.category_name)
    });
  }
  return buildBankFeesYear(year, rows);
}
