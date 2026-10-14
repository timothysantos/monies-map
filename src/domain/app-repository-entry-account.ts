// Move one entry to another card (Ask's card suggestion, DOMAIN.md "Card
// Suggestion"): only the entry's account changes. Its date, amount, note,
// category, owner and Splits stay exactly as they are, which the general
// entry update cannot promise from a card that does not hold every field.
// Reads and checks run first; the change, its audit event and the month
// refresh markers then commit as one db.batch().

import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshotsAfterWrite } from "./app-repository-snapshots";

export async function updateEntryAccountRecord(
  db: D1Database,
  input: { entryId: string; accountId: string }
): Promise<{ entryId: string; updated: boolean }> {
  const entry = await db
    .prepare(`
      SELECT
        transactions.description,
        transactions.transaction_date,
        transactions.post_date,
        transactions.currency,
        transactions.entry_type,
        transactions.account_id,
        transactions.transfer_group_id,
        transactions.bank_certification_status,
        accounts.account_name AS from_account_name,
        EXISTS (
          SELECT 1 FROM split_expenses
          WHERE split_expenses.household_id = transactions.household_id
            AND split_expenses.linked_transaction_id = transactions.id
            AND split_expenses.deleted_at IS NULL
        ) AS on_splits
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ? AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .first<{
      description: string;
      transaction_date: string;
      post_date: string | null;
      currency: string;
      entry_type: string;
      account_id: string;
      transfer_group_id: string | null;
      bank_certification_status: string;
      from_account_name: string;
      on_splits: number;
    }>();
  if (!entry) {
    throw new Error("Entry not found.");
  }
  if (entry.account_id === input.accountId) {
    return { entryId: input.entryId, updated: false };
  }
  if (entry.entry_type !== "expense" || entry.transfer_group_id) {
    throw new Error("Only an expense that is not linked as a transfer can move to another card.");
  }
  if (entry.bank_certification_status !== "provisional") {
    throw new Error("A statement has already confirmed this entry's card, so it stays where it is.");
  }
  if (entry.on_splits) {
    throw new Error("Take this entry off Splits before moving it to another card.");
  }

  const target = await db
    .prepare("SELECT account_name, currency, is_active, owner_person_id FROM accounts WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId)
    .first<{ account_name: string; currency: string; is_active: number; owner_person_id: string | null }>();
  if (!target || !target.is_active) {
    throw new Error("Choose an active card.");
  }
  if (target.currency.toUpperCase() !== entry.currency.toUpperCase()) {
    throw new Error(`That card is in ${target.currency.toUpperCase()}, not ${entry.currency.toUpperCase()}.`);
  }

  const months = new Set([entry.transaction_date.slice(0, 7), (entry.post_date ?? entry.transaction_date).slice(0, 7)]);
  await db.batch([
    // The entry keeps whoever it belonged to: its own owner, else the owner
    // of the card it leaves.
    db
      .prepare(`
        UPDATE transactions
        SET
          owner_person_id = COALESCE(owner_person_id, (SELECT owner_person_id FROM accounts WHERE id = transactions.account_id)),
          account_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ?
      `)
      .bind(input.accountId, DEFAULT_HOUSEHOLD_ID, input.entryId),
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: input.entryId,
      action: "entry_account_updated",
      detail: `Moved ${entry.description} on ${entry.transaction_date} from ${entry.from_account_name} to ${target.account_name}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);
  return { entryId: input.entryId, updated: true };
}
