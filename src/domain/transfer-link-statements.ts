// The writes that link two entries as one transfer pair, shared by the single
// link (`linkTransferPair`, app-repository-entry-commands.ts) and the bulk link
// of clear pairs (app-repository-transfer-bulk-link.ts) so the two can never
// mean different things by "linked": one transfer group over both entries, the
// sender made a transfer out and the receiver a transfer in, both in the
// Transfer category and off any category offset, and one audit event.
// Statements only: the caller reads and checks first, adds its month refresh
// markers and commits everything in one db.batch().
import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

export function buildTransferLinkStatements(db: D1Database, input: {
  groupId: string;
  fromEntryId: string;
  toEntryId: string;
  transferCategoryId: string;
  note: string;
  // Groups either side was in before: dissolved first (a re-link).
  staleGroupIds?: string[];
  // A purpose on the sending side follows the link (transfer-purpose-links.ts).
  purposeStatements?: D1PreparedStatement[];
}): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const groupId of input.staleGroupIds ?? []) {
    statements.push(
      db
        .prepare("UPDATE transactions SET transfer_group_id = NULL WHERE household_id = ? AND transfer_group_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, groupId),
      db
        .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, groupId)
    );
  }
  statements.push(...(input.purposeStatements ?? []));
  const markSide = (entryId: string, direction: "in" | "out") => db
    .prepare(`
      UPDATE transactions
      SET
        transfer_group_id = ?,
        entry_type = 'transfer',
        transfer_direction = '${direction}',
        category_id = ?,
        offsets_category = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.groupId, input.transferCategoryId, entryId, DEFAULT_HOUSEHOLD_ID);
  statements.push(
    db
      .prepare("INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES (?, ?, ?, ?)")
      .bind(input.groupId, DEFAULT_HOUSEHOLD_ID, input.note, 1),
    markSide(input.fromEntryId, "out"),
    markSide(input.toEntryId, "in"),
    buildAuditEventStatement(db, {
      entityType: "transfer_group",
      entityId: input.groupId,
      action: "transfer_linked",
      detail: `Linked transfer pair ${input.fromEntryId} -> ${input.toEntryId}.`
    })
  );
  return statements;
}
