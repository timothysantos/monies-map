// Transfer links an import commit makes between a new statement row and an
// entry already in the ledger: an investment statement's contribution and the
// bank's GIRO row that paid it become one transfer instead of two entries.
// The same linking the Entries editor does (`linkTransferPair`), made inside
// the import's own batch and recorded with the bank entry's earlier
// classification so a rollback puts it back. Nothing here writes on its own.
import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import type { ImportTransferMatchDto } from "../types/dto";

interface CounterpartEntry {
  id: string;
  account_id: string;
  transaction_date: string;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  category_id: string | null;
  offsets_category: number;
  transfer_group_id: string | null;
}

export interface TransferLinkPlan {
  match: ImportTransferMatchDto;
  counterpart: CounterpartEntry;
}

// Checks, against the ledger as it is now, that the bank entry a preview
// offered is still there, unlinked, on another account and for the same
// amount on the opposite side. Throws before the commit writes anything.
export async function loadTransferLinkPlan(db: D1Database, input: {
  match: ImportTransferMatchDto;
  rowAccountId: string;
  rowAmountMinor: number;
  rowDirection: "in" | "out";
}): Promise<TransferLinkPlan> {
  const counterpart = await db
    .prepare(`
      SELECT id, account_id, transaction_date, description, amount_minor, entry_type, transfer_direction,
        category_id, offsets_category, transfer_group_id
      FROM transactions
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.match.transactionId)
    .first<CounterpartEntry>();
  const side = counterpart
    ? counterpart.entry_type === "transfer" ? counterpart.transfer_direction : counterpart.entry_type === "expense" ? "out" : counterpart.entry_type === "income" ? "in" : null
    : null;
  const wanted = input.rowDirection === "in" ? "out" : "in";
  if (
    !counterpart
    || counterpart.transfer_group_id
    || counterpart.account_id === input.rowAccountId
    || counterpart.amount_minor !== input.rowAmountMinor
    || side !== wanted
  ) {
    throw new Error("The bank entry this statement row pairs with is no longer available. Refresh the import preview and try again.");
  }
  return { match: input.match, counterpart };
}

// One transfer group over the new row and the bank entry; the bank entry
// becomes a transfer on the opposite side. `rowTransactionId` is inserted
// earlier in the same batch.
export function buildTransferLinkStatements(db: D1Database, input: {
  importId: string;
  plan: TransferLinkPlan;
  rowTransactionId: string;
  rowDirection: "in" | "out";
  transferCategoryId: string;
  sourceLabel: string;
}) {
  const { counterpart } = input.plan;
  const groupId = `tg-${crypto.randomUUID()}`;
  return [
    db
      .prepare("INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES (?, ?, ?, ?)")
      .bind(groupId, DEFAULT_HOUSEHOLD_ID, `Linked by the ${input.sourceLabel} import`, input.plan.match.basis === "reference" ? 1 : 0.8),
    db
      .prepare(`
        INSERT INTO import_transfer_links (
          id, household_id, import_id, transfer_group_id, transaction_id, counterpart_transaction_id,
          previous_entry_type, previous_transfer_direction, previous_category_id, previous_offsets_category
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        `import-transfer-link-${crypto.randomUUID()}`,
        DEFAULT_HOUSEHOLD_ID,
        input.importId,
        groupId,
        input.rowTransactionId,
        counterpart.id,
        counterpart.entry_type,
        counterpart.transfer_direction,
        counterpart.category_id,
        counterpart.offsets_category
      ),
    db
      .prepare(`
        UPDATE transactions
        SET transfer_group_id = ?, entry_type = 'transfer', transfer_direction = ?, category_id = ?, offsets_category = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ?
      `)
      .bind(groupId, input.rowDirection === "in" ? "out" : "in", input.transferCategoryId, DEFAULT_HOUSEHOLD_ID, counterpart.id),
    db
      .prepare("UPDATE transactions SET transfer_group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?")
      .bind(groupId, DEFAULT_HOUSEHOLD_ID, input.rowTransactionId),
    buildAuditEventStatement(db, {
      entityType: "transfer_group",
      entityId: groupId,
      action: "transfer_linked",
      detail: `Linked ${counterpart.description} on ${input.plan.match.accountName} to the ${input.sourceLabel} statement row as one transfer.`
    })
  ];
}

// Puts each bank entry back as it was and dissolves the group, only while the
// entry is still in the group the import made (a later edit wins).
export async function buildTransferLinkRollbackStatements(db: D1Database, importId: string) {
  const links = await db
    .prepare(`
      SELECT import_transfer_links.transfer_group_id, import_transfer_links.counterpart_transaction_id,
        import_transfer_links.previous_entry_type, import_transfer_links.previous_transfer_direction,
        import_transfer_links.previous_category_id, import_transfer_links.previous_offsets_category,
        transactions.transaction_date
      FROM import_transfer_links
      LEFT JOIN transactions ON transactions.id = import_transfer_links.counterpart_transaction_id
      WHERE import_transfer_links.household_id = ? AND import_transfer_links.import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{
      transfer_group_id: string;
      counterpart_transaction_id: string;
      previous_entry_type: "expense" | "income" | "transfer";
      previous_transfer_direction: "in" | "out" | null;
      previous_category_id: string | null;
      previous_offsets_category: number;
      transaction_date: string | null;
    }>();
  const statements: D1PreparedStatement[] = [];
  const months = new Set<string>();
  for (const link of links.results) {
    if (link.transaction_date) {
      months.add(link.transaction_date.slice(0, 7));
    }
    statements.push(
      db
        .prepare(`
          UPDATE transactions
          SET transfer_group_id = NULL, entry_type = ?, transfer_direction = ?, category_id = ?, offsets_category = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE household_id = ? AND id = ? AND transfer_group_id = ?
        `)
        .bind(
          link.previous_entry_type,
          link.previous_transfer_direction,
          link.previous_category_id,
          link.previous_offsets_category,
          DEFAULT_HOUSEHOLD_ID,
          link.counterpart_transaction_id,
          link.transfer_group_id
        ),
      db
        .prepare("UPDATE transactions SET transfer_group_id = NULL WHERE household_id = ? AND transfer_group_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, link.transfer_group_id),
      db
        .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, link.transfer_group_id)
    );
  }
  return { statements, months };
}

export function buildTransferLinkCleanupStatement(db: D1Database, importId: string) {
  return db
    .prepare("DELETE FROM import_transfer_links WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId);
}
