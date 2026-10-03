// Statement fixes inside the import commit and its rollback (see "Statement
// Fix" in DOMAIN.md). The import commit calls these to read and check the
// approved fixes before it writes, to add the fixes' writes to its own
// batch, and to undo them when the import is rolled back. Nothing here writes
// on its own.
import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { getMonthEndDate } from "./app-repository-helpers";
import { getStatementFixRejection, type DiagnosisCard } from "./statement-mismatch-diagnosis";
import type { StatementFixDto } from "../types/dto";

export interface StatementFixEntry {
  id: string;
  account_id: string;
  account_name: string;
  transaction_date: string;
  post_date: string | null;
  description: string;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  bank_certification_status: "provisional" | "statement_certified";
  transfer_group_id: string | null;
}

export interface StatementFixPlan {
  fixes: StatementFixDto[];
  entriesById: Map<string, StatementFixEntry>;
  // Moved entry id -> the move, so the commit can find the entry on its old
  // account and certify it on the new one.
  movesByEntryId: Map<string, Extract<StatementFixDto, { kind: "move_to_statement_account" }>>;
  defersByEntryId: Map<string, Extract<StatementFixDto, { kind: "defer_to_next_statement" }>>;
}

const REFRESH_HINT = "Refresh the statement check and try again.";

// Reads every entry the fixes touch and checks each fix against the ledger
// as it is now. Throws before the commit writes anything.
export async function loadStatementFixPlan(db: D1Database, input: {
  fixes: StatementFixDto[];
  sourceType: "csv" | "pdf" | "manual";
  statementCards: Pick<DiagnosisCard, "accountId" | "checkpointMonth" | "endDate">[];
}): Promise<StatementFixPlan> {
  const plan: StatementFixPlan = {
    fixes: input.fixes,
    entriesById: new Map(),
    movesByEntryId: new Map(),
    defersByEntryId: new Map()
  };
  if (!input.fixes.length) {
    return plan;
  }

  const entryIds = Array.from(new Set(input.fixes.map((fix) => fix.entryId)));
  if (entryIds.length !== input.fixes.length) {
    throw new Error(`Only one fix can change an entry. ${REFRESH_HINT}`);
  }
  const placeholders = entryIds.map(() => "?").join(", ");
  const entries = await db
    .prepare(`
      SELECT transactions.id, transactions.account_id, accounts.account_name, transactions.transaction_date,
        transactions.post_date, transactions.description, transactions.amount_minor, transactions.entry_type,
        transactions.transfer_direction, transactions.bank_certification_status, transactions.transfer_group_id
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ? AND transactions.id IN (${placeholders})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...entryIds)
    .all<StatementFixEntry>();
  for (const entry of entries.results) {
    plan.entriesById.set(entry.id, entry);
  }

  const sourceAccountIds = Array.from(new Set(input.fixes.map((fix) => fix.kind === "move_to_statement_account" ? fix.fromAccountId : fix.accountId)));
  const checkpoints = await db
    .prepare(`
      SELECT account_id, checkpoint_month, statement_end_date
      FROM account_balance_checkpoints
      WHERE household_id = ? AND account_id IN (${sourceAccountIds.map(() => "?").join(", ")})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...sourceAccountIds)
    .all<{ account_id: string; checkpoint_month: string; statement_end_date: string | null }>();

  for (const fix of input.fixes) {
    const entry = plan.entriesById.get(fix.entryId);
    const sourceAccountId = fix.kind === "move_to_statement_account" ? fix.fromAccountId : fix.accountId;
    const rejection = getStatementFixRejection({
      fix,
      sourceType: input.sourceType,
      entry: entry ? {
        accountId: entry.account_id,
        bankCertificationStatus: entry.bank_certification_status,
        postDate: entry.post_date,
        transactionDate: entry.transaction_date,
        transferGroupId: entry.transfer_group_id
      } : undefined,
      statementCards: input.statementCards,
      sourceAccount: {
        id: sourceAccountId,
        name: entry?.account_name ?? "",
        savedCheckpoints: checkpoints.results
          .filter((checkpoint) => checkpoint.account_id === sourceAccountId)
          .map((checkpoint) => ({
            month: checkpoint.checkpoint_month,
            endDate: checkpoint.statement_end_date ?? getMonthEndDate(checkpoint.checkpoint_month)
          }))
      }
    });
    if (rejection) {
      throw new Error(`${rejection} ${REFRESH_HINT}`);
    }
    if (fix.kind === "move_to_statement_account") {
      plan.movesByEntryId.set(fix.entryId, fix);
    } else if (fix.kind === "defer_to_next_statement") {
      plan.defersByEntryId.set(fix.entryId, fix);
    }
  }
  return plan;
}

// The account a statement row's certification target is on before the
// commit: a moved entry is still on its old account until this batch runs.
export function getCertificationLookupAccountId(plan: StatementFixPlan, targetEntryId: string | undefined, rowAccountId: string) {
  const move = targetEntryId ? plan.movesByEntryId.get(targetEntryId) : undefined;
  return move && move.toAccountId === rowAccountId ? move.fromAccountId : rowAccountId;
}

// A move exists so the statement can certify the entry on its card. Moving
// without certifying would leave the entry uncertified beside a new copy, so
// the commit is refused. A deferred entry is, by definition, not on the
// statement, so it cannot be certified by it.
export function assertStatementFixesMatchCertification(plan: StatementFixPlan, certifiedEntryIds: Set<string>) {
  for (const entryId of plan.movesByEntryId.keys()) {
    if (!certifiedEntryIds.has(entryId)) {
      throw new Error(`A moved entry must be certified by its statement row. ${REFRESH_HINT}`);
    }
  }
  for (const entryId of plan.defersByEntryId.keys()) {
    if (certifiedEntryIds.has(entryId)) {
      throw new Error(`A deferred entry cannot also be certified by this statement. ${REFRESH_HINT}`);
    }
  }
}

// The fixes' writes. They run before the rows' certification in the same
// batch: a moved entry must be on its statement card when the certification
// update (guarded by account) runs.
export function buildStatementFixCommitStatements(db: D1Database, input: {
  plan: StatementFixPlan;
  importId: string;
  sourceLabel: string;
  accountNamesById: Map<string, string>;
}) {
  const statements: D1PreparedStatement[] = [];
  const months = new Set<string>();
  for (const fix of input.plan.fixes) {
    const entry = input.plan.entriesById.get(fix.entryId)!;
    months.add(entry.transaction_date.slice(0, 7));
    months.add((entry.post_date ?? entry.transaction_date).slice(0, 7));
    if (fix.kind === "move_to_statement_account") {
      const toName = input.accountNamesById.get(fix.toAccountId) ?? "";
      statements.push(
        db
          .prepare(`
            UPDATE transactions
            SET account_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND id = ? AND account_id = ? AND bank_certification_status = 'provisional'
          `)
          .bind(fix.toAccountId, DEFAULT_HOUSEHOLD_ID, fix.entryId, fix.fromAccountId),
        buildFixRecordStatement(db, input.importId, fix.entryId, {
          kind: fix.kind,
          fromAccountId: fix.fromAccountId,
          toAccountId: fix.toAccountId,
          previousPostDate: entry.post_date,
          newPostDate: entry.post_date
        }),
        buildAuditEventStatement(db, {
          entityType: "transaction",
          entityId: fix.entryId,
          action: "entry_moved_by_statement",
          detail: `Moved ${entry.description} from ${entry.account_name} to ${toName}: the ${input.sourceLabel} statement lists it under ${toName}.`
        })
      );
      continue;
    }
    if (fix.kind !== "defer_to_next_statement") {
      continue;
    }

    statements.push(
      db
        .prepare(`
          UPDATE transactions
          SET post_date = ?, updated_at = CURRENT_TIMESTAMP
          WHERE household_id = ? AND id = ? AND account_id = ? AND post_date IS NULL AND bank_certification_status = 'provisional'
        `)
        .bind(fix.postDate, DEFAULT_HOUSEHOLD_ID, fix.entryId, fix.accountId),
      buildFixRecordStatement(db, input.importId, fix.entryId, {
        kind: fix.kind,
        fromAccountId: fix.accountId,
        toAccountId: fix.accountId,
        previousPostDate: entry.post_date,
        newPostDate: fix.postDate
      }),
      buildAuditEventStatement(db, {
        entityType: "transaction",
        entityId: fix.entryId,
        action: "entry_deferred_by_statement",
        detail: `Set the posted date of ${entry.description} on ${entry.account_name} to ${fix.postDate}: it is not on the ${input.sourceLabel} statement, so it belongs to the next one.`
      })
    );
    months.add(fix.postDate.slice(0, 7));
  }
  return { statements, months };
}

function buildFixRecordStatement(db: D1Database, importId: string, entryId: string, fix: {
  kind: StatementFixDto["kind"];
  fromAccountId: string;
  toAccountId: string;
  previousPostDate: string | null;
  newPostDate: string | null;
}) {
  return db
    .prepare(`
      INSERT INTO import_statement_fixes (
        id, household_id, import_id, transaction_id, fix_kind, from_account_id, to_account_id,
        previous_post_date, new_post_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      `statement-fix-${crypto.randomUUID()}`,
      DEFAULT_HOUSEHOLD_ID,
      importId,
      entryId,
      fix.kind,
      fix.fromAccountId,
      fix.toAccountId,
      fix.previousPostDate,
      fix.newPostDate
    );
}

export interface RecordedStatementFix {
  transaction_id: string;
  fix_kind: StatementFixDto["kind"];
  from_account_id: string;
  to_account_id: string;
  previous_post_date: string | null;
  new_post_date: string | null;
  from_account_name: string | null;
  to_account_name: string | null;
  description: string | null;
  transaction_date: string | null;
}

export async function loadRecordedStatementFixes(db: D1Database, importId: string) {
  const result = await db
    .prepare(`
      SELECT import_statement_fixes.transaction_id, import_statement_fixes.fix_kind,
        import_statement_fixes.from_account_id, import_statement_fixes.to_account_id,
        import_statement_fixes.previous_post_date, import_statement_fixes.new_post_date,
        from_account.account_name AS from_account_name, to_account.account_name AS to_account_name,
        transactions.description, transactions.transaction_date
      FROM import_statement_fixes
      LEFT JOIN accounts AS from_account ON from_account.id = import_statement_fixes.from_account_id
      LEFT JOIN accounts AS to_account ON to_account.id = import_statement_fixes.to_account_id
      LEFT JOIN transactions ON transactions.id = import_statement_fixes.transaction_id
      WHERE import_statement_fixes.household_id = ? AND import_statement_fixes.import_id = ?
      ORDER BY import_statement_fixes.rowid
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<RecordedStatementFix>();
  return result.results;
}

// Undoes the fixes. Runs after the certification restore in the rollback
// batch, so a moved entry is provisional again when it moves back. A fix is
// undone only while the entry is as the fix left it; a later edit wins.
export function buildStatementFixRollbackStatements(db: D1Database, input: {
  importId: string;
  fixes: RecordedStatementFix[];
}) {
  const statements: D1PreparedStatement[] = [];
  const months = new Set<string>();
  for (const fix of input.fixes) {
    if (fix.transaction_date) {
      months.add(fix.transaction_date.slice(0, 7));
    }
    if (fix.fix_kind === "move_to_statement_account") {
      statements.push(
        db
          .prepare(`
            UPDATE transactions
            SET account_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND id = ? AND account_id = ?
          `)
          .bind(fix.from_account_id, DEFAULT_HOUSEHOLD_ID, fix.transaction_id, fix.to_account_id),
        buildAuditEventStatement(db, {
          entityType: "transaction",
          entityId: fix.transaction_id,
          action: "entry_moved_back_by_rollback",
          detail: `Moved ${fix.description ?? "an entry"} back from ${fix.to_account_name ?? "its statement card"} to ${fix.from_account_name ?? "its original account"}: the statement import was rolled back.`
        })
      );
      continue;
    }
    statements.push(db
      .prepare(`
        UPDATE transactions
        SET post_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ? AND post_date = ? AND bank_certification_status = 'provisional'
      `)
      .bind(fix.previous_post_date, DEFAULT_HOUSEHOLD_ID, fix.transaction_id, fix.new_post_date));
    if (fix.new_post_date) {
      months.add(fix.new_post_date.slice(0, 7));
    }
  }
  return { statements, months };
}

export function buildStatementFixCleanupStatement(db: D1Database, importId: string) {
  return db
    .prepare("DELETE FROM import_statement_fixes WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId);
}
