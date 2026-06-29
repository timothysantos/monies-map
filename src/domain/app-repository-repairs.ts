import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

const LEGACY_OCBC_VALUE_DATE_REPAIR_KEY = "repair-legacy-ocbc-value-date-post-dates-v1";

export async function repairLegacyOcbcValueDatePostDates(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_maintenance_tasks (
      key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      detail TEXT
    )
  `).run();

  const completed = await db
    .prepare("SELECT key FROM app_maintenance_tasks WHERE key = ?")
    .bind(LEGACY_OCBC_VALUE_DATE_REPAIR_KEY)
    .first<{ key: string }>();
  if (completed) {
    return;
  }

  const transactionColumns = await db
    .prepare("PRAGMA table_info(transactions)")
    .all<{ name: string }>();
  const transactionColumnNames = new Set(transactionColumns.results.map((column) => column.name));
  if (!transactionColumnNames.has("post_date") || !transactionColumnNames.has("note")) {
    await markRepairComplete(db, "Skipped: transactions table is missing post_date or note.");
    return;
  }

  const result = await db.prepare(`
    UPDATE transactions
    SET post_date = substr(note, instr(lower(note), 'value date: ') + 12, 10)
    WHERE household_id = ?
      AND note IS NOT NULL
      AND instr(lower(note), 'value date: ') > 0
      AND substr(note, instr(lower(note), 'value date: ') + 12, 10) GLOB '????-??-??'
      AND (post_date IS NULL OR post_date = transaction_date)
      AND account_id IN (
        SELECT accounts.id
        FROM accounts
        INNER JOIN institutions ON institutions.id = accounts.institution_id
        WHERE accounts.household_id = ?
          AND accounts.account_kind = 'bank'
          AND lower(institutions.name) LIKE '%ocbc%'
      )
  `).bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID).run();

  await markRepairComplete(db, `Updated ${result.meta?.changes ?? 0} legacy OCBC rows.`);
}

async function markRepairComplete(db: D1Database, detail: string) {
  await db
    .prepare(`
      INSERT INTO app_maintenance_tasks (key, completed_at, detail)
      VALUES (?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(key) DO UPDATE SET
        completed_at = CURRENT_TIMESTAMP,
        detail = excluded.detail
    `)
    .bind(LEGACY_OCBC_VALUE_DATE_REPAIR_KEY, detail)
    .run();
}
