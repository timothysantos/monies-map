import { household as demoHousehold } from "./demo-data";

const DEMO_HOUSEHOLD_ID = demoHousehold.id;

export async function recordAuditEvent(
  db: D1Database,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    detail: string;
  }
) {
  await db
    .prepare(`
      INSERT INTO audit_events (id, household_id, entity_type, entity_id, action, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      `audit-${crypto.randomUUID()}`,
      DEMO_HOUSEHOLD_ID,
      input.entityType,
      input.entityId,
      input.action,
      input.detail
    )
    .run();
}
