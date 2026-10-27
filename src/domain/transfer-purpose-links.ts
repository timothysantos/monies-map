// Statements and checks other commands run for a transfer's purpose
// (DOMAIN.md "Transfer Purpose"), kept apart from the command modules so
// linking a transfer pair (app-repository-entry-commands.ts) and matching a
// settle-up (app-repository-splits.ts) can put them in their own batch
// without importing another command module.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { TRANSFER_PURPOSE_COPY } from "./transfer-purpose";

export function buildClearPurposeStatement(db: D1Database, entryId: string) {
  return db
    .prepare(`
      UPDATE transactions
      SET
        transfer_purpose_category_id = NULL,
        transfer_purpose_person_id = NULL,
        transfer_purpose_source = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId);
}

// What linking a pair does to a purpose on its sending side (the link
// wins): the receiver becomes the other side's owner, and a pair between
// one person's own accounts (or to a side with no owner) loses it.
// Statements for the link's own batch; none when nothing changes.
// After a write that may change what the entry is (its type, direction or
// owner): a purpose that would no longer count is cleared in the same
// batch. A no-op for every other entry.
export function buildStalePurposeClearStatement(db: D1Database, entryId: string) {
  return db
    .prepare(`
      UPDATE transactions
      SET
        transfer_purpose_category_id = NULL,
        transfer_purpose_person_id = NULL,
        transfer_purpose_source = NULL
      WHERE household_id = ? AND id = ?
        AND transfer_purpose_category_id IS NOT NULL
        AND (
          entry_type != 'transfer'
          OR transfer_direction IS NOT 'out'
          OR owner_person_id IS NULL
          OR owner_person_id = transfer_purpose_person_id
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId);
}

export interface PurposeLinkRow {
  owner_person_id: string | null;
  transfer_purpose_category_id: string | null;
  transfer_purpose_person_id: string | null;
}

// D1 allows 100 bound values in a statement; the household takes one.
const PURPOSE_LINK_ID_CHUNK = 50;

export async function buildTransferPurposeLinkStatements(
  db: D1Database,
  input: { fromEntryId: string; toEntryId: string }
): Promise<D1PreparedStatement[]> {
  const rows = await loadPurposeLinkRows(db, [input.fromEntryId, input.toEntryId]);
  return buildTransferPurposeLinkStatementsFromRows(db, input, rows);
}

// The rows the purpose rules read for each entry of some pairs, in as few
// reads as D1's bound-value limit allows (a bulk link reads them all at once).
export async function loadPurposeLinkRows(db: D1Database, entryIds: string[]): Promise<Map<string, PurposeLinkRow>> {
  const ids = [...new Set(entryIds)];
  const found = new Map<string, PurposeLinkRow>();
  for (let start = 0; start < ids.length; start += PURPOSE_LINK_ID_CHUNK) {
    const chunk = ids.slice(start, start + PURPOSE_LINK_ID_CHUNK);
    const result = await db
      .prepare(`SELECT id, owner_person_id, transfer_purpose_category_id, transfer_purpose_person_id FROM transactions WHERE household_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`)
      .bind(DEFAULT_HOUSEHOLD_ID, ...chunk)
      .all<PurposeLinkRow & { id: string }>();
    for (const row of result.results) {
      found.set(row.id, row);
    }
  }
  return found;
}

export function buildTransferPurposeLinkStatementsFromRows(
  db: D1Database,
  input: { fromEntryId: string; toEntryId: string },
  rows: ReadonlyMap<string, PurposeLinkRow>
): D1PreparedStatement[] {
  const from = rows.get(input.fromEntryId);
  const to = rows.get(input.toEntryId);
  const statements: D1PreparedStatement[] = [];
  // The receiving side becomes a transfer in: a purpose stored there (it
  // was a sending side before) no longer counts.
  if (to?.transfer_purpose_category_id) {
    statements.push(buildClearPurposeStatement(db, input.toEntryId));
  }
  if (!from?.transfer_purpose_category_id) {
    return statements;
  }
  const receiver = to?.owner_person_id ?? null;
  if (!receiver || receiver === from.owner_person_id) {
    statements.push(buildClearPurposeStatement(db, input.fromEntryId));
  } else if (receiver !== from.transfer_purpose_person_id) {
    statements.push(db
      .prepare("UPDATE transactions SET transfer_purpose_person_id = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?")
      .bind(receiver, DEFAULT_HOUSEHOLD_ID, input.fromEntryId));
  }
  return statements;
}

// The plain refusal for using a transfer with a purpose (either side of
// its pair) as a settle-up, or null.
export async function transferPurposeSettleUpRefusal(db: D1Database, transactionId: string): Promise<string | null> {
  const row = await db
    .prepare(`
      SELECT categories.name AS category_name
      FROM transactions
      INNER JOIN categories ON categories.id = transactions.transfer_purpose_category_id
      WHERE transactions.household_id = ?
        AND transactions.entry_type = 'transfer'
        AND transactions.transfer_direction = 'out'
        AND (
          transactions.id = ?
          OR transactions.transfer_group_id IN (
            SELECT transfer_group_id FROM transactions WHERE household_id = ? AND id = ? AND transfer_group_id IS NOT NULL
          )
        )
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, transactionId, DEFAULT_HOUSEHOLD_ID, transactionId)
    .first<{ category_name: string }>();
  return row ? TRANSFER_PURPOSE_COPY.isPurpose(row.category_name) : null;
}
