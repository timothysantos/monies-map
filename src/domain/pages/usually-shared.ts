import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { loadSplitGroups } from "../app-repository-splits";
import { normalizeSplitCurrency } from "../split-currency";
import { SPLIT_SUGGESTION_POLICY, NON_GROUP_SPLIT_ID } from "../split-suggestion";
import { suggestUsuallyShared, USUALLY_SHARED_POLICY, type UsuallySharedCandidate } from "../usually-shared";
import { HISTORY_ROWS_SQL, loadSharePeople, toHistoryEntry, type HistoryRow } from "./split-suggestion";
import type { UsuallySharedGroupDto } from "../../types/dto";

// The "Usually shared, not on Splits yet" list (GET /api/splits/usually-shared,
// DOMAIN.md "Usually Shared"). Not a page DTO: the Splits page asks for it
// from its own lazy section. It reads the two people Splits shares between,
// the split groups, the expenses of the last `days` days that are on no
// split, and the same two people's expense history of the 12 months before
// them, then leaves every judgement to the pure sweep (usually-shared.ts),
// which asks the single-entry rule (split-suggestion.ts). Both entry reads are
// bounded by a date window and a LIMIT, never a whole table.

export interface UsuallySharedDto {
  groups: UsuallySharedGroupDto[];
  entryCount: number;
  shopCount: number;
}

interface CandidateRow {
  id: string;
  transaction_date: string;
  entry_type: string;
  description: string;
  category_name: string | null;
  owner_person_id: string | null;
  currency: string;
  amount_minor: number;
}

export async function buildUsuallySharedDto(
  db: D1Database,
  input: { today: string; days?: number }
): Promise<UsuallySharedDto> {
  const days = Math.max(1, Math.min(input.days ?? USUALLY_SHARED_POLICY.candidateDays, USUALLY_SHARED_POLICY.candidateDays));
  const sharePeople = await loadSharePeople(db);
  if (sharePeople.length !== 2) {
    return { groups: [], entryCount: 0, shopCount: 0 };
  }
  const [first, second] = sharePeople;
  const owners = [first.id, second.id];

  // Candidates first: with none, the larger history read is skipped.
  const candidateRows = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.entry_type,
        transactions.description,
        categories.name AS category_name,
        COALESCE(transactions.owner_person_id, accounts.owner_person_id) AS owner_person_id,
        transactions.currency,
        transactions.amount_minor
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ?
        AND transactions.entry_type = 'expense'
        AND transactions.amount_minor > 0
        AND transactions.transaction_date BETWEEN date(?, ?) AND ?
        AND COALESCE(transactions.owner_person_id, accounts.owner_person_id) IN (?, ?)
        AND NOT EXISTS (
          SELECT 1 FROM split_expenses
          WHERE split_expenses.household_id = transactions.household_id
            AND split_expenses.linked_transaction_id = transactions.id
            AND split_expenses.deleted_at IS NULL
        )
      ORDER BY transactions.transaction_date DESC, transactions.id
      LIMIT ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.today, `-${days} days`, input.today, first.id, second.id, USUALLY_SHARED_POLICY.maxCandidates)
    .all<CandidateRow>();
  if (!candidateRows.results.length) {
    return { groups: [], entryCount: 0, shopCount: 0 };
  }

  const [groups, historyRows] = await Promise.all([
    loadSplitGroups(db),
    db
      .prepare(`${HISTORY_ROWS_SQL}
        WHERE transactions.household_id = ?
          AND transactions.entry_type = 'expense'
          AND transactions.transaction_date BETWEEN date(?, ?) AND ?
          AND COALESCE(transactions.owner_person_id, accounts.owner_person_id) IN (?, ?)
        ORDER BY transactions.transaction_date DESC, transactions.id
        LIMIT ?
      `)
      .bind(
        DEFAULT_HOUSEHOLD_ID,
        input.today,
        `-${SPLIT_SUGGESTION_POLICY.lookbackDays + days} days`,
        input.today,
        owners[0],
        owners[1],
        USUALLY_SHARED_POLICY.maxHistory
      )
      .all<HistoryRow>()
  ]);

  const candidates: UsuallySharedCandidate[] = candidateRows.results.map((row) => ({
    entryId: row.id,
    date: row.transaction_date,
    entryType: row.entry_type,
    description: row.description,
    categoryName: row.category_name,
    ownerPersonId: row.owner_person_id,
    currency: normalizeSplitCurrency(row.currency),
    amountMinor: row.amount_minor
  }));
  const found = suggestUsuallyShared({
    candidates,
    history: historyRows.results.map(toHistoryEntry),
    groups: [
      // Non-group expenses take any currency; the sweep sets it per entry.
      { id: NON_GROUP_SPLIT_ID, name: "Non-group expenses", currency: "SGD" },
      ...groups.map((group) => ({ id: group.id, name: group.name, currency: group.currency }))
    ],
    sharePeople
  });
  return {
    groups: found,
    entryCount: found.reduce((sum, group) => sum + group.entries.length, 0),
    shopCount: found.length
  };
}
