// Statement corrections: the fixes a Settings statement comparison suggests
// for data that is already saved (DOMAIN.md, "Statement Correction"). An
// entry the statement lists under another card moves there; a second,
// provisional copy of a purchase the statement already matched is removed.
// Both are recorded in statement_corrections and can be undone. Each command
// reads and checks first, then writes everything in one batch.
import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { getSignedLedgerAmountMinor } from "./app-repository-helpers";
import { loadAccounts } from "./app-repository-settings";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshotsAfterWrite } from "./app-repository-snapshots";
import { buildSavedCheckpointBalances } from "./statement-compare-projection";
import { findCheckpointsBrokenByCorrections, getCorrectionBalanceChanges } from "./statement-mismatch-diagnosis";
import type { StatementFixDto } from "../types/dto";

export type StatementCorrectionDto = Extract<StatementFixDto, { kind: "move_to_statement_account" | "remove_duplicate_entry" }>;

interface CorrectionEntry {
  id: string;
  account_id: string;
  import_id: string | null;
  transaction_date: string;
  post_date: string | null;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  bank_certification_status: "provisional" | "statement_certified";
  transfer_group_id: string | null;
}

const REFRESH_HINT = "Compare the statement again and retry.";

// A correction the ledger as it is now does not allow; the route answers 409.
export class StatementCorrectionRefusedError extends Error {}

export async function applyStatementCorrections(db: D1Database, input: {
  accountId: string;
  checkpointMonth: string;
  corrections: StatementCorrectionDto[];
}) {
  if (!input.corrections.length) {
    throw new StatementCorrectionRefusedError("No statement corrections to apply.");
  }
  const entryIds = input.corrections.map((correction) => correction.entryId);
  if (new Set(entryIds).size !== entryIds.length) {
    throw new StatementCorrectionRefusedError("Each entry can be corrected only once.");
  }

  const accounts = await loadAccounts(db);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  if (!accountsById.get(input.accountId)?.checkpointHistory?.some((checkpoint) => checkpoint.month === input.checkpointMonth)) {
    throw new StatementCorrectionRefusedError("Save this statement before correcting entries from it.");
  }
  const coveringIds = input.corrections.flatMap((correction) => correction.kind === "remove_duplicate_entry" ? [correction.coveredByEntryId] : []);
  const entriesById = await loadCorrectionEntries(db, [...entryIds, ...coveringIds]);
  const linkedEntryIds = await loadLinkedEntryIds(db, entryIds);

  const balanceChanges = [];
  for (const correction of input.corrections) {
    const entry = entriesById.get(correction.entryId);
    const rejection = getCorrectionRejection(correction, entry, {
      accountsById,
      checkpointMonth: input.checkpointMonth,
      coveringEntry: correction.kind === "remove_duplicate_entry" ? entriesById.get(correction.coveredByEntryId) : undefined,
      isLinked: linkedEntryIds.has(correction.entryId)
    });
    if (rejection) {
      throw new StatementCorrectionRefusedError(`${entry?.description ?? "An entry"} can't be corrected: ${rejection} ${REFRESH_HINT}`);
    }
    balanceChanges.push(...getCorrectionBalanceChanges(correction, {
      accountId: entry!.account_id,
      signedAmountMinor: getSignedLedgerAmountMinor(entry!),
      clearedDate: entry!.post_date ?? entry!.transaction_date
    }));
  }

  // Never trade one balanced statement for another: a saved statement that
  // matches now must still match after every correction together.
  const broken = findCheckpointsBrokenByCorrections({ checkpoints: buildSavedCheckpointBalances(accounts), changes: balanceChanges });
  if (broken.length) {
    throw new StatementCorrectionRefusedError(`These corrections would unbalance the saved ${broken[0].accountName} statement for ${broken[0].month}. ${REFRESH_HINT}`);
  }

  const snapshots = await loadEntrySnapshots(db, input.corrections.filter((correction) => correction.kind === "remove_duplicate_entry").map((correction) => correction.entryId));
  const months = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  const correctionIds: string[] = [];
  for (const correction of input.corrections) {
    const entry = entriesById.get(correction.entryId)!;
    addEntryMonths(months, entry);
    const correctionId = `statement-correction-${crypto.randomUUID()}`;
    correctionIds.push(correctionId);
    if (correction.kind === "move_to_statement_account") {
      const toName = accountsById.get(correction.toAccountId)!.name;
      statements.push(
        db
          .prepare(`
            UPDATE transactions
            SET account_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND id = ? AND account_id = ? AND bank_certification_status = 'provisional'
          `)
          .bind(correction.toAccountId, DEFAULT_HOUSEHOLD_ID, entry.id, correction.fromAccountId),
        buildCorrectionRecordStatement(db, correctionId, {
          entryId: entry.id,
          kind: correction.kind,
          accountId: input.accountId,
          checkpointMonth: input.checkpointMonth,
          fromAccountId: correction.fromAccountId,
          toAccountId: correction.toAccountId
        }),
        buildAuditEventStatement(db, {
          entityType: "transaction",
          entityId: entry.id,
          action: "entry_moved_by_statement_compare",
          detail: `Moved ${entry.description} from ${accountsById.get(correction.fromAccountId)!.name} to ${toName}: the ${input.checkpointMonth} statement lists it under ${toName}.`
        })
      );
      continue;
    }

    const covering = entriesById.get(correction.coveredByEntryId)!;
    const accountName = accountsById.get(entry.account_id)!.name;
    statements.push(
      buildCorrectionRecordStatement(db, correctionId, {
        entryId: entry.id,
        kind: correction.kind,
        accountId: input.accountId,
        checkpointMonth: input.checkpointMonth,
        fromAccountId: entry.account_id,
        toAccountId: entry.account_id,
        coveredByEntryId: covering.id,
        snapshotJson: JSON.stringify(snapshots.get(entry.id))
      }),
      db
        .prepare("UPDATE reconciliation_exceptions SET transaction_id = NULL WHERE household_id = ? AND transaction_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, entry.id),
      db
        .prepare("DELETE FROM transactions WHERE household_id = ? AND id = ? AND bank_certification_status = 'provisional'")
        .bind(DEFAULT_HOUSEHOLD_ID, entry.id),
      buildAuditEventStatement(db, {
        entityType: "transaction",
        entityId: entry.id,
        action: "entry_removed_as_statement_duplicate",
        detail: `Removed a second copy of ${entry.description} on ${accountName}: the ${input.checkpointMonth} statement matches it to the entry on ${accountsById.get(covering.account_id)?.name ?? accountName}.`
      })
    );
  }

  await db.batch([...statements, ...buildMonthlySnapshotRefreshMarkers(db, months)]);
  await refreshMonthlySnapshotsAfterWrite(db, Array.from(months));
  return { correctionIds, appliedCount: input.corrections.length };
}

export async function undoStatementCorrections(db: D1Database, input: { correctionIds: string[] }) {
  if (!input.correctionIds.length) {
    throw new StatementCorrectionRefusedError("No statement corrections to undo.");
  }
  const result = await db
    .prepare(`
      SELECT id, transaction_id, correction_kind, from_account_id, to_account_id, entry_snapshot_json, undone_at
      FROM statement_corrections
      WHERE household_id = ? AND id IN (${input.correctionIds.map(() => "?").join(", ")})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...input.correctionIds)
    .all<{
      id: string;
      transaction_id: string;
      correction_kind: StatementCorrectionDto["kind"];
      from_account_id: string;
      to_account_id: string;
      entry_snapshot_json: string | null;
      undone_at: string | null;
    }>();
  const corrections = result.results;
  if (corrections.length !== new Set(input.correctionIds).size) {
    throw new StatementCorrectionRefusedError("That correction is no longer recorded.");
  }
  if (corrections.some((correction) => correction.undone_at)) {
    throw new StatementCorrectionRefusedError("That correction is already undone.");
  }

  const entriesById = await loadCorrectionEntries(db, corrections.map((correction) => correction.transaction_id));
  const months = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  for (const correction of corrections) {
    const entry = entriesById.get(correction.transaction_id);
    if (correction.correction_kind === "move_to_statement_account") {
      if (!entry || entry.account_id !== correction.to_account_id || entry.bank_certification_status !== "provisional") {
        throw new StatementCorrectionRefusedError(`${entry?.description ?? "The moved entry"} has changed since it was moved, so the move can't be undone.`);
      }
      addEntryMonths(months, entry);
      statements.push(
        db
          .prepare(`
            UPDATE transactions
            SET account_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND id = ? AND account_id = ? AND bank_certification_status = 'provisional'
          `)
          .bind(correction.from_account_id, DEFAULT_HOUSEHOLD_ID, entry.id, correction.to_account_id),
        buildAuditEventStatement(db, {
          entityType: "transaction",
          entityId: entry.id,
          action: "statement_correction_undone",
          detail: `Moved ${entry.description} back: undid a statement correction.`
        })
      );
    } else {
      if (entry) {
        throw new StatementCorrectionRefusedError(`${entry.description} is already back in the ledger.`);
      }
      const snapshot = parseEntrySnapshot(correction.entry_snapshot_json);
      if (snapshot.import_id && !(await isCompletedImport(db, String(snapshot.import_id)))) {
        throw new StatementCorrectionRefusedError(`${snapshot.description} came from an import that has since been rolled back, so it can't be restored.`);
      }
      addEntryMonths(months, snapshot as unknown as CorrectionEntry);
      const columns = Object.keys(snapshot);
      statements.push(
        db
          .prepare(`INSERT INTO transactions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
          .bind(...columns.map((column) => snapshot[column])),
        buildAuditEventStatement(db, {
          entityType: "transaction",
          entityId: correction.transaction_id,
          action: "statement_correction_undone",
          detail: `Restored ${snapshot.description}: undid a statement correction.`
        })
      );
    }
    statements.push(
      db
        .prepare("UPDATE statement_corrections SET undone_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ? AND undone_at IS NULL")
        .bind(DEFAULT_HOUSEHOLD_ID, correction.id)
    );
  }

  await db.batch([...statements, ...buildMonthlySnapshotRefreshMarkers(db, months)]);
  await refreshMonthlySnapshotsAfterWrite(db, Array.from(months));
  return { undoneCount: corrections.length };
}

function getCorrectionRejection(
  correction: StatementCorrectionDto,
  entry: CorrectionEntry | undefined,
  context: {
    accountsById: Map<string, { id: string; name: string; isActive?: boolean; checkpointHistory?: { month: string }[] }>;
    checkpointMonth: string;
    coveringEntry?: CorrectionEntry;
    isLinked: boolean;
  }
) {
  if (!entry) {
    return "it is no longer in the ledger.";
  }
  if (entry.bank_certification_status !== "provisional") {
    return "a statement already certifies it.";
  }
  if (entry.transfer_group_id) {
    return "it is linked as a transfer.";
  }
  if (correction.kind === "move_to_statement_account") {
    if (entry.account_id !== correction.fromAccountId) {
      return "it is no longer on that account.";
    }
    const toAccount = context.accountsById.get(correction.toAccountId);
    if (!toAccount || toAccount.id === entry.account_id || toAccount.isActive === false) {
      return "the statement's account is not available.";
    }
    // The destination's own saved statement for the month is what the move
    // is checked against.
    if (!toAccount.checkpointHistory?.some((checkpoint) => checkpoint.month === context.checkpointMonth)) {
      return `${toAccount.name} has no saved statement for this month.`;
    }
    return undefined;
  }
  if (entry.account_id !== correction.accountId) {
    return "it is no longer on that account.";
  }
  if (context.isLinked) {
    return "it is linked to a plan or a split.";
  }
  const covering = context.coveringEntry;
  if (
    !covering
    || covering.id === entry.id
    || covering.entry_type !== entry.entry_type
    || getSignedLedgerAmountMinor(covering) !== getSignedLedgerAmountMinor(entry)
  ) {
    return "the entry the statement matched is gone or has changed.";
  }
  return undefined;
}

async function loadCorrectionEntries(db: D1Database, ids: string[]) {
  if (!ids.length) {
    return new Map<string, CorrectionEntry>();
  }
  const result = await db
    .prepare(`
      SELECT id, account_id, import_id, transaction_date, post_date, description, amount_minor, entry_type,
        transfer_direction, bank_certification_status, transfer_group_id
      FROM transactions
      WHERE household_id = ? AND id IN (${ids.map(() => "?").join(", ")})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...ids)
    .all<CorrectionEntry>();
  return new Map(result.results.map((row) => [row.id, { ...row, amount_minor: Number(row.amount_minor) }]));
}

// Entries a removal would cut loose from a plan, a split or a settlement.
async function loadLinkedEntryIds(db: D1Database, ids: string[]) {
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(`
      SELECT transaction_id AS id FROM monthly_plan_entry_links WHERE transaction_id IN (${placeholders})
      UNION SELECT linked_transaction_id FROM split_expenses WHERE linked_transaction_id IN (${placeholders})
      UNION SELECT linked_transaction_id FROM split_settlements WHERE linked_transaction_id IN (${placeholders})
      UNION SELECT matched_transaction_id FROM split_settlement_checkpoints WHERE matched_transaction_id IN (${placeholders})
      UNION SELECT transaction_id FROM split_settlement_checkpoint_matches WHERE transaction_id IN (${placeholders})
    `)
    .bind(...ids, ...ids, ...ids, ...ids, ...ids)
    .all<{ id: string }>();
  return new Set(result.results.map((row) => row.id));
}

// The whole ledger row, so an undo puts back exactly what was removed.
async function loadEntrySnapshots(db: D1Database, ids: string[]) {
  if (!ids.length) {
    return new Map<string, Record<string, unknown>>();
  }
  const result = await db
    .prepare(`SELECT * FROM transactions WHERE household_id = ? AND id IN (${ids.map(() => "?").join(", ")})`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...ids)
    .all<Record<string, unknown>>();
  return new Map(result.results.map((row) => [String(row.id), row]));
}

function parseEntrySnapshot(json: string | null) {
  const snapshot = json ? JSON.parse(json) as Record<string, string | number | null> : null;
  if (!snapshot?.id || !Object.keys(snapshot).every((column) => /^[a-z0-9_]+$/.test(column))) {
    throw new StatementCorrectionRefusedError("The removed entry was not recorded, so it can't be restored.");
  }
  return snapshot;
}

async function isCompletedImport(db: D1Database, importId: string) {
  const row = await db
    .prepare("SELECT status FROM imports WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .first<{ status: string }>();
  return row?.status === "completed";
}

function addEntryMonths(months: Set<string>, entry: Pick<CorrectionEntry, "transaction_date" | "post_date">) {
  months.add(entry.transaction_date.slice(0, 7));
  if (entry.post_date) {
    months.add(entry.post_date.slice(0, 7));
  }
}

function buildCorrectionRecordStatement(db: D1Database, correctionId: string, input: {
  entryId: string;
  kind: StatementCorrectionDto["kind"];
  accountId: string;
  checkpointMonth: string;
  fromAccountId: string;
  toAccountId: string;
  coveredByEntryId?: string;
  snapshotJson?: string;
}) {
  return db
    .prepare(`
      INSERT INTO statement_corrections (
        id, household_id, transaction_id, correction_kind, account_id, checkpoint_month,
        from_account_id, to_account_id, covered_by_transaction_id, entry_snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      correctionId,
      DEFAULT_HOUSEHOLD_ID,
      input.entryId,
      input.kind,
      input.accountId,
      input.checkpointMonth,
      input.fromAccountId,
      input.toAccountId,
      input.coveredByEntryId ?? null,
      input.snapshotJson ?? null
    );
}
