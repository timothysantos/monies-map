import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { recordAuditEvent } from "./app-repository-audit";
import type { ReconciliationExceptionDto } from "../types/dto";

type ReconciliationExceptionKind = ReconciliationExceptionDto["kind"];
type ReconciliationExceptionSeverity = ReconciliationExceptionDto["severity"];

export async function loadReconciliationExceptions(db: D1Database): Promise<ReconciliationExceptionDto[]> {
  const rows = await db
    .prepare(`
      SELECT
        reconciliation_exceptions.id,
        reconciliation_exceptions.account_id,
        accounts.account_name,
        reconciliation_exceptions.transaction_id,
        transactions.transaction_date,
        transactions.description AS transaction_description,
        reconciliation_exceptions.checkpoint_month,
        reconciliation_exceptions.kind,
        reconciliation_exceptions.severity,
        reconciliation_exceptions.status,
        reconciliation_exceptions.title,
        reconciliation_exceptions.note,
        reconciliation_exceptions.resolution_note,
        reconciliation_exceptions.created_at,
        reconciliation_exceptions.updated_at,
        reconciliation_exceptions.resolved_at
      FROM reconciliation_exceptions
      LEFT JOIN accounts ON accounts.id = reconciliation_exceptions.account_id
      LEFT JOIN transactions ON transactions.id = reconciliation_exceptions.transaction_id
      WHERE reconciliation_exceptions.household_id = ?
      ORDER BY
        CASE reconciliation_exceptions.status WHEN 'open' THEN 0 ELSE 1 END,
        CASE reconciliation_exceptions.severity WHEN 'blocking' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
        reconciliation_exceptions.updated_at DESC
      LIMIT 80
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      account_id: string | null;
      account_name: string | null;
      transaction_id: string | null;
      transaction_date: string | null;
      transaction_description: string | null;
      checkpoint_month: string | null;
      kind: ReconciliationExceptionKind;
      severity: ReconciliationExceptionSeverity;
      status: "open" | "resolved";
      title: string;
      note: string | null;
      resolution_note: string | null;
      created_at: string;
      updated_at: string;
      resolved_at: string | null;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    accountId: row.account_id ?? undefined,
    accountName: row.account_name ?? undefined,
    transactionId: row.transaction_id ?? undefined,
    transactionDate: row.transaction_date ?? undefined,
    transactionDescription: row.transaction_description ?? undefined,
    checkpointMonth: row.checkpoint_month ?? undefined,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    title: row.title,
    note: row.note ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? undefined
  }));
}

export async function createReconciliationExceptionRecord(
  db: D1Database,
  input: {
    accountId?: string;
    transactionId?: string;
    checkpointMonth?: string;
    kind: ReconciliationExceptionKind;
    severity?: ReconciliationExceptionSeverity;
    title: string;
    note?: string;
  }
) {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Exception title is required.");
  }

  const id = `rex-${crypto.randomUUID()}`;
  await db
    .prepare(`
      INSERT INTO reconciliation_exceptions (
        id, household_id, account_id, transaction_id, checkpoint_month,
        kind, severity, status, title, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `)
    .bind(
      id,
      DEFAULT_HOUSEHOLD_ID,
      input.accountId ?? null,
      input.transactionId ?? null,
      input.checkpointMonth ?? null,
      input.kind,
      input.severity ?? "review",
      title,
      input.note?.trim() || null
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "reconciliation_exception",
    entityId: id,
    action: "reconciliation_exception_created",
    detail: `Opened reconciliation exception: ${title}.`
  });

  return { exceptionId: id };
}

export async function resolveReconciliationExceptionRecord(
  db: D1Database,
  input: {
    exceptionId: string;
    resolutionNote?: string;
  }
) {
  const existing = await db
    .prepare("SELECT title, status FROM reconciliation_exceptions WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.exceptionId)
    .first<{ title: string; status: "open" | "resolved" }>();

  if (!existing) {
    throw new Error("Unknown reconciliation exception.");
  }

  await db
    .prepare(`
      UPDATE reconciliation_exceptions
      SET status = 'resolved',
        resolution_note = ?,
        resolved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ? AND id = ?
    `)
    .bind(input.resolutionNote?.trim() || null, DEFAULT_HOUSEHOLD_ID, input.exceptionId)
    .run();

  await recordAuditEvent(db, {
    entityType: "reconciliation_exception",
    entityId: input.exceptionId,
    action: "reconciliation_exception_resolved",
    detail: `Resolved reconciliation exception: ${existing.title}.`
  });

  return { exceptionId: input.exceptionId, resolved: true };
}
