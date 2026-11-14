import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { normalizeSplitCurrency } from "../split-currency";
import { splitBalanceWords } from "../splits-projection";
import type { SummarySplitBalanceDto } from "../../types/dto";

// What Summary's Splits tile reads (design.md "Summary tiles"): one balance
// per split group, the figure the Splits page shows on that group's tile,
// counted in one grouped statement so no split row travels with Summary.
//
// The rule is the Splits page's own (splits-projection.ts, buildSplitsPage):
// a record counts toward the balance when it is open, meaning not deleted,
// its batch not closed and no active settlement checkpoint covering it. An
// expense is the other person's share when the viewer paid it, minus the
// viewer's share when the other paid; a settle-up moves the balance the other
// way. A person sees only the records they share in or paid or received; the
// household view reads the first person's side. A group with any record at
// all is listed (a balance of zero reads "Settled up"); a group never used is
// left out, and so is the whole field when there is none.
const MAX_GROUPS = 6;

const ACTIVE_COVERING = `
  SELECT checkpoint_items.record_kind, checkpoint_items.record_id
  FROM split_settlement_checkpoint_items AS checkpoint_items
  INNER JOIN split_settlement_checkpoints AS covering ON covering.id = checkpoint_items.checkpoint_id
  WHERE covering.household_id = ? AND covering.status NOT IN ('reopened', 'voided')`;

export const SPLIT_BALANCES_SQL = `
  WITH covered AS (${ACTIVE_COVERING}),
  ranked AS (
    SELECT split_expense_id, person_id, amount_minor,
      ROW_NUMBER() OVER (PARTITION BY split_expense_id ORDER BY created_at, rowid) AS rn
    FROM split_expense_shares
  ),
  records AS (
    SELECT COALESCE(split_expenses.split_group_id, 'split-group-none') AS group_id,
      CASE WHEN split_batches.closed_on IS NULL
        AND split_expenses.id NOT IN (SELECT record_id FROM covered WHERE record_kind = 'expense')
      THEN
        (CASE WHEN split_expenses.payer_person_id = COALESCE(first_share.person_id, '')
          THEN COALESCE(second_share.amount_minor, 0)
          ELSE -COALESCE(first_share.amount_minor, 0) END)
        * (CASE WHEN ? = COALESCE(second_share.person_id, '') THEN -1 ELSE 1 END)
      ELSE 0 END AS balance_minor
    FROM split_expenses
    LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
    LEFT JOIN ranked AS first_share ON first_share.split_expense_id = split_expenses.id AND first_share.rn = 1
    LEFT JOIN ranked AS second_share ON second_share.split_expense_id = split_expenses.id AND second_share.rn = 2
    WHERE split_expenses.household_id = ? AND split_expenses.deleted_at IS NULL
      AND (? = 'household' OR split_expenses.id IN (SELECT split_expense_id FROM split_expense_shares WHERE person_id = ?))
    UNION ALL
    SELECT COALESCE(split_settlements.split_group_id, 'split-group-none'),
      CASE WHEN split_batches.closed_on IS NULL
        AND split_settlements.id NOT IN (SELECT record_id FROM covered WHERE record_kind = 'settlement')
      THEN -(CASE WHEN split_settlements.to_person_id = ? THEN split_settlements.amount_minor
                  WHEN split_settlements.from_person_id = ? THEN -split_settlements.amount_minor
                  ELSE split_settlements.amount_minor END)
      ELSE 0 END
    FROM split_settlements
    LEFT JOIN split_batches ON split_batches.id = split_settlements.split_batch_id
    WHERE split_settlements.household_id = ? AND split_settlements.deleted_at IS NULL
      AND (? = 'household' OR split_settlements.from_person_id = ? OR split_settlements.to_person_id = ?)
  )
  SELECT records.group_id, COALESCE(split_groups.group_name, 'Non-group expenses') AS group_name,
    COALESCE(split_groups.currency, 'SGD') AS currency, SUM(records.balance_minor) AS balance_minor
  FROM records
  LEFT JOIN split_groups ON split_groups.id = records.group_id
  GROUP BY records.group_id
  ORDER BY ABS(SUM(records.balance_minor)) DESC, group_name
  LIMIT ${MAX_GROUPS}
`;

interface BalanceRow {
  group_id: string;
  group_name: string;
  currency: string | null;
  balance_minor: number;
}

export async function loadSummarySplitBalances(
  db: D1Database,
  viewId: string,
  personNameById: Record<string, string>
): Promise<SummarySplitBalanceDto[]> {
  const household = DEFAULT_HOUSEHOLD_ID;
  const result = await db.prepare(SPLIT_BALANCES_SQL).bind(
    household,
    viewId, household, viewId, viewId,
    viewId, viewId, household, viewId, viewId, viewId
  ).all<BalanceRow>();
  return result.results.map((row) => ({
    id: row.group_id,
    name: row.group_name,
    currency: normalizeSplitCurrency(row.currency),
    balanceMinor: row.balance_minor,
    owes: splitBalanceWords(row.balance_minor, viewId, personNameById)
  }));
}
