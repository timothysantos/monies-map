// Entries the bank no longer lists (see "No Longer Listed Entry" in
// DOMAIN.md). An activity export lists every charge the bank holds over its
// dates, pending ones included. An entry an earlier export created, dated
// inside a later export's dates, that no row of the later export matches was
// dropped by the bank: a pending hold it released, or a charge it posted
// again at another amount (which comes in as the later export's own row).
//
// The preview lists them, the import commit removes them in its own batch,
// and the import's rollback re-creates them. Nothing here writes on its own.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildSplitRelinkStatements } from "./app-repository-splits";
import type { ImportNoLongerListedEntryDto, ImportPreviewRowDto } from "../types/dto";

// A ledger entry as the preview reads it.
export interface NoLongerListedCandidate {
  transaction_id: string;
  import_id: string | null;
  source_type: "csv" | "pdf" | "manual";
  account_id: string;
  account_name: string;
  transaction_date: string;
  post_date: string | null;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
  bank_certification_status: "provisional" | "statement_certified";
  transfer_group_id: string | null;
  original_currency: string | null;
  // The entry is a manual one an export promoted, not one it created.
  promotes_manual_entry: number | boolean | null;
}

// Only an entry an export created and nothing else vouches for: a purchase
// the user saved (an estimate or a promoted manual entry), a transfer and a
// statement-confirmed entry are never removed this way.
function isRemovableExportEntry(entry: NoLongerListedCandidate) {
  return entry.source_type === "csv"
    && Boolean(entry.import_id)
    && entry.bank_certification_status === "provisional"
    && !entry.promotes_manual_entry
    && !entry.original_currency
    && !entry.transfer_group_id;
}

export function findNoLongerListedEntries(input: {
  sourceType?: "csv" | "pdf" | "manual";
  previewRows: ImportPreviewRowDto[];
  ledgerRows: NoLongerListedCandidate[];
}): ImportNoLongerListedEntryDto[] {
  if (input.sourceType === "pdf") {
    return [];
  }
  // The dates the file covers for each account: its first and last row.
  const datesByAccountId = new Map<string, { first: string; last: string }>();
  for (const row of input.previewRows) {
    if (!row.accountId) {
      continue;
    }
    const dates = datesByAccountId.get(row.accountId);
    datesByAccountId.set(row.accountId, dates
      ? { first: row.date < dates.first ? row.date : dates.first, last: row.date > dates.last ? row.date : dates.last }
      : { first: row.date, last: row.date });
  }
  // Every entry a row matched, skipped or left for review is still listed.
  const listedIds = new Set(input.previewRows.flatMap((row) => [
    row.reconciliationTargetTransactionId,
    row.reconciliationMatch?.existingTransactionId,
    ...(row.reconciliationMatches ?? []).map((match) => match.existingTransactionId)
  ]).filter((id): id is string => Boolean(id)));

  return input.ledgerRows
    .filter((entry) => {
      const dates = datesByAccountId.get(entry.account_id);
      const bankDate = entry.post_date ?? entry.transaction_date;
      return dates
        && isRemovableExportEntry(entry)
        && bankDate >= dates.first
        && bankDate <= dates.last
        && !listedIds.has(entry.transaction_id);
    })
    .sort((left, right) => (left.post_date ?? left.transaction_date).localeCompare(right.post_date ?? right.transaction_date))
    .map((entry) => ({
      transactionId: entry.transaction_id,
      importId: entry.import_id!,
      accountId: entry.account_id,
      accountName: entry.account_name,
      date: entry.post_date ?? entry.transaction_date,
      description: entry.description,
      amountMinor: Number(entry.amount_minor),
      entryType: entry.entry_type
    }));
}

type EntrySnapshot = {
  transaction: {
    id: string;
    import_id: string;
    import_row_id: string | null;
    account_id: string;
    transfer_group_id: string | null;
    transaction_date: string;
    post_date: string | null;
    description: string;
    amount_minor: number;
    currency: string;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    category_id: string | null;
    owner_person_id: string | null;
    offsets_category: number;
    note: string | null;
  };
  splitExpenseIds: string[];
  splitSettlementIds: string[];
};

// The commit's removal of the entries the user did not keep. Each is checked
// again against the ledger as it is now (an entry changed since the preview
// is left alone) and saved whole for the rollback. Returns the statements for
// the import commit's batch and the months they change.
export async function buildNoLongerListedEntryRemoval(db: D1Database, importId: string, entries: Array<{ transactionId: string; importId: string }>) {
  const statements: D1PreparedStatement[] = [];
  const months = new Set<string>();
  const requested = new Map(entries.map((entry) => [entry.transactionId, entry.importId]));
  if (!requested.size) {
    return { statements, months };
  }
  const ids = [...requested.keys()];
  const placeholders = ids.map(() => "?").join(", ");
  const [found, splitExpenses, splitSettlements] = await Promise.all([
    db
      .prepare(`
        SELECT transactions.id, transactions.import_id, transactions.import_row_id, transactions.account_id,
          transactions.transfer_group_id, transactions.transaction_date, transactions.post_date,
          transactions.description, transactions.amount_minor, transactions.currency, transactions.entry_type,
          transactions.transfer_direction, transactions.category_id, transactions.owner_person_id,
          transactions.offsets_category, transactions.note
        FROM transactions
        INNER JOIN imports ON imports.id = transactions.import_id
        LEFT JOIN import_rows ON import_rows.id = transactions.import_row_id
        WHERE transactions.household_id = ?
          AND transactions.id IN (${placeholders})
          AND imports.source_type = 'csv'
          AND imports.status = 'completed'
          AND transactions.bank_certification_status = 'provisional'
          AND transactions.original_currency IS NULL
          AND transactions.transfer_group_id IS NULL
          AND import_rows.promoted_entry_snapshot_json IS NULL
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...ids)
      .all<EntrySnapshot["transaction"]>(),
    db
      .prepare(`SELECT id, linked_transaction_id FROM split_expenses WHERE household_id = ? AND linked_transaction_id IN (${placeholders})`)
      .bind(DEFAULT_HOUSEHOLD_ID, ...ids)
      .all<{ id: string; linked_transaction_id: string }>(),
    db
      .prepare(`SELECT id, linked_transaction_id FROM split_settlements WHERE household_id = ? AND linked_transaction_id IN (${placeholders})`)
      .bind(DEFAULT_HOUSEHOLD_ID, ...ids)
      .all<{ id: string; linked_transaction_id: string }>()
  ]);

  for (const transaction of found.results) {
    if (requested.get(transaction.id) !== transaction.import_id) {
      continue;
    }
    const snapshot: EntrySnapshot = {
      transaction,
      splitExpenseIds: splitExpenses.results.filter((row) => row.linked_transaction_id === transaction.id).map((row) => row.id),
      splitSettlementIds: splitSettlements.results.filter((row) => row.linked_transaction_id === transaction.id).map((row) => row.id)
    };
    statements.push(
      db
        .prepare(`
          INSERT INTO import_no_longer_listed_entries (id, household_id, import_id, transaction_id, entry_import_id, entry_snapshot_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(`unlisted-${crypto.randomUUID()}`, DEFAULT_HOUSEHOLD_ID, importId, transaction.id, transaction.import_id, JSON.stringify(snapshot)),
      db
        .prepare("UPDATE split_expenses SET linked_transaction_id = NULL WHERE household_id = ? AND linked_transaction_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, transaction.id),
      db
        .prepare("UPDATE split_settlements SET linked_transaction_id = NULL WHERE household_id = ? AND linked_transaction_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, transaction.id),
      db
        .prepare("DELETE FROM transactions WHERE household_id = ? AND id = ? AND import_id = ? AND bank_certification_status = 'provisional'")
        .bind(DEFAULT_HOUSEHOLD_ID, transaction.id, transaction.import_id)
    );
    addEntryMonths(months, transaction);
  }
  return { statements, months };
}

// A rollback of the export that created an entry a later export removed
// would leave the later export's rollback re-creating an entry of a
// rolled-back import: the later export goes first.
export async function hasLaterNoLongerListedRemoval(db: D1Database, importId: string) {
  const found = await db
    .prepare(`
      SELECT 1 AS found
      FROM import_no_longer_listed_entries
      INNER JOIN imports ON imports.id = import_no_longer_listed_entries.import_id
      WHERE import_no_longer_listed_entries.household_id = ?
        AND import_no_longer_listed_entries.entry_import_id = ?
        AND imports.status = 'completed'
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .first<{ found: number }>();
  return Boolean(found);
}

// The rollback re-creates the entries this export removed, with their split
// links, and forgets them.
export async function buildNoLongerListedEntryRestore(db: D1Database, importId: string) {
  const statements: D1PreparedStatement[] = [];
  const months = new Set<string>();
  const removed = await db
    .prepare("SELECT entry_snapshot_json FROM import_no_longer_listed_entries WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{ entry_snapshot_json: string }>();
  for (const row of removed.results) {
    const { transaction, splitExpenseIds, splitSettlementIds } = JSON.parse(row.entry_snapshot_json) as EntrySnapshot;
    statements.push(db
      .prepare(`
        INSERT OR IGNORE INTO transactions (
          id, household_id, import_id, import_row_id, account_id, transfer_group_id,
          transaction_date, post_date, description, amount_minor, currency,
          entry_type, transfer_direction, category_id, owner_person_id,
          offsets_category, note, bank_certification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisional', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .bind(
        transaction.id, DEFAULT_HOUSEHOLD_ID, transaction.import_id, transaction.import_row_id, transaction.account_id,
        transaction.transfer_group_id, transaction.transaction_date, transaction.post_date, transaction.description,
        transaction.amount_minor, transaction.currency, transaction.entry_type, transaction.transfer_direction,
        transaction.category_id, transaction.owner_person_id, transaction.offsets_category, transaction.note
      ));
    statements.push(...await buildSplitRelinkStatements(db, {
      entry: { id: transaction.id, amountMinor: transaction.amount_minor, currency: transaction.currency, entryType: transaction.entry_type },
      splitExpenseIds,
      rolledBackImportId: importId
    }));
    for (const settlementId of splitSettlementIds) {
      statements.push(db
        .prepare("UPDATE split_settlements SET linked_transaction_id = ? WHERE household_id = ? AND id = ?")
        .bind(transaction.id, DEFAULT_HOUSEHOLD_ID, settlementId));
    }
    addEntryMonths(months, transaction);
  }
  statements.push(db
    .prepare("DELETE FROM import_no_longer_listed_entries WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId));
  return { statements, months };
}

function addEntryMonths(months: Set<string>, transaction: { transaction_date: string; post_date: string | null }) {
  months.add(transaction.transaction_date.slice(0, 7));
  if (transaction.post_date) {
    months.add(transaction.post_date.slice(0, 7));
  }
}
