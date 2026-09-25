import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

type AuditEventInput = {
  entityType: string;
  entityId: string;
  action: string;
  detail: string;
};

// The audit row for a write, to run in the same db.batch() as the write so
// an audited change and its audit event commit or fail together.
export function buildAuditEventStatement(db: D1Database, input: AuditEventInput) {
  return db
    .prepare(`
      INSERT INTO audit_events (id, household_id, entity_type, entity_id, action, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      `audit-${crypto.randomUUID()}`,
      DEFAULT_HOUSEHOLD_ID,
      input.entityType,
      input.entityId,
      input.action,
      input.detail
    );
}

export async function recordAuditEvent(db: D1Database, input: AuditEventInput) {
  await buildAuditEventStatement(db, input).run();
}
