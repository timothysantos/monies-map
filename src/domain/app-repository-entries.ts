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
        transactions.account_id,
        transactions.bank_certification_status,
        transactions.statement_certified_at,
        transactions.import_id,
        imports.source_type AS import_source_type,
        imports.source_label AS import_source_label,
        split_expenses.id AS linked_split_expense_id,
        people.display_name AS owner_name,
        accounts.account_name AS account_name,
        CASE
          WHEN accounts.is_joint = 1 THEN 'Shared'
          ELSE account_owners.display_name
        END AS account_owner_label,
        categories.name AS category_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN people ON people.id = transactions.owner_person_id
      LEFT JOIN people AS account_owners ON account_owners.id = accounts.owner_person_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      LEFT JOIN split_expenses
        ON split_expenses.household_id = transactions.household_id
       AND split_expenses.linked_transaction_id = transactions.id
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
      account_id: string;
      bank_certification_status: "provisional" | "statement_certified";
      statement_certified_at: string | null;
      import_id: string | null;
      import_source_type: "csv" | "pdf" | "manual" | null;
      import_source_label: string | null;
      linked_split_expense_id: string | null;
      owner_name: string | null;
      account_name: string;
      account_owner_label: string | null;
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
      accountId: row.account_id,
      accountName: row.account_name,
      accountOwnerLabel: row.account_owner_label ?? undefined,
      categoryName: row.category_name ?? "Other",
      entryType: row.entry_type,
      transferDirection: row.transfer_direction ?? undefined,
      ownershipType: row.ownership_type,
      ownerName: row.owner_name ?? undefined,
      amountMinor: row.amount_minor,
      offsetsCategory: Boolean(row.offsets_category),
      note: row.note ?? undefined,
      bankCertificationStatus: getEntryBankCertificationStatus(row),
      bankCertificationLabel: getEntryBankCertificationLabel(row),
      importedSourceType: row.import_source_type ?? undefined,
      importedSourceLabel: row.import_source_label ?? undefined,
      statementCertifiedAt: row.statement_certified_at ?? undefined,
      linkedTransfer,
      linkedSplitExpenseId: row.linked_split_expense_id ?? undefined,
      splits: splitMap.get(row.id) ?? []
    };
  });
}

function getEntryBankCertificationStatus(row: {
  bank_certification_status: "provisional" | "statement_certified";
  import_id: string | null;
}): EntryDto["bankCertificationStatus"] {
  if (row.bank_certification_status === "statement_certified") {
    return "statement_certified";
  }

  return row.import_id ? "import_provisional" : "manual_provisional";
}

function getEntryBankCertificationLabel(row: {
  bank_certification_status: "provisional" | "statement_certified";
  import_id: string | null;
}) {
  if (row.bank_certification_status === "statement_certified") {
    return "Statement certified";
  }

  return row.import_id ? "Import provisional" : "Manual provisional";
}
