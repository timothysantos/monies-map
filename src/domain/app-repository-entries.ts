import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { getMonthBounds, groupSplits } from "./app-repository-helpers";
import { getCurrentMonthKey } from "../lib/month";
import type { EntryDto, LinkedTransferDto } from "../types/dto";

export async function loadEntries(db: D1Database, month = getCurrentMonthKey()): Promise<EntryDto[]> {
  const [monthStart, nextMonth] = getMonthBounds(month);
  return loadEntriesForDateRange(db, monthStart, nextMonth);
}

export async function loadEntriesForMonths(db: D1Database, months: string[]): Promise<EntryDto[]> {
  if (!months.length) {
    return [];
  }

  const sortedMonths = [...months].sort();
  const [monthStart] = getMonthBounds(sortedMonths[0]);
  const [, monthEnd] = getMonthBounds(sortedMonths[sortedMonths.length - 1]);
  return loadEntriesForDateRange(db, monthStart, monthEnd);
}

async function loadEntriesForDateRange(db: D1Database, monthStart: string, nextMonth: string): Promise<EntryDto[]> {
  const entries = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.ownership_type,
        transactions.amount_minor,
        transactions.offsets_category,
        transactions.note,
        transactions.transfer_group_id,
        people.display_name AS owner_name,
        accounts.account_name AS account_name,
        categories.name AS category_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN people ON people.id = transactions.owner_person_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date < ?
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
      ORDER BY transactions.transaction_date, transactions.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, monthStart, nextMonth)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      ownership_type: "direct" | "shared";
      amount_minor: number;
      offsets_category: number;
      note: string | null;
      transfer_group_id: string | null;
      owner_name: string | null;
      account_name: string;
      category_name: string | null;
    }>();

  const splits = await db
    .prepare(`
      SELECT
        transaction_splits.transaction_id,
        transaction_splits.person_id,
        transaction_splits.ratio_basis_points,
        transaction_splits.amount_minor,
        people.display_name
      FROM transaction_splits
      INNER JOIN people ON people.id = transaction_splits.person_id
      INNER JOIN transactions ON transactions.id = transaction_splits.transaction_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date < ?
      ORDER BY transaction_splits.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, monthStart, nextMonth)
    .all<{
      transaction_id: string;
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
      display_name: string;
    }>();

  const splitMap = groupSplits(splits.results, "transaction_id");
  const entriesByTransferGroup = new Map<string, typeof entries.results>();

  for (const entry of entries.results) {
    if (!entry.transfer_group_id) {
      continue;
    }

    const current = entriesByTransferGroup.get(entry.transfer_group_id) ?? [];
    current.push(entry);
    entriesByTransferGroup.set(entry.transfer_group_id, current);
  }

  return entries.results.map((row) => {
    let linkedTransfer: LinkedTransferDto | undefined;
    if (row.transfer_group_id) {
      const siblings = entriesByTransferGroup.get(row.transfer_group_id) ?? [];
      const counterpart = siblings.find((candidate) => candidate.id !== row.id);
      if (counterpart) {
        linkedTransfer = {
          transactionId: counterpart.id,
          accountName: counterpart.account_name,
          amountMinor: counterpart.amount_minor,
          transactionDate: counterpart.transaction_date
        };
      }
    }

    return {
      id: row.id,
      date: row.transaction_date,
      description: row.description,
      accountName: row.account_name,
      categoryName: row.category_name ?? "Other",
      entryType: row.entry_type,
      transferDirection: row.transfer_direction ?? undefined,
      ownershipType: row.ownership_type,
      ownerName: row.owner_name ?? undefined,
      amountMinor: row.amount_minor,
      offsetsCategory: Boolean(row.offsets_category),
      note: row.note ?? undefined,
      linkedTransfer,
      splits: splitMap.get(row.id) ?? []
    };
  });
}
