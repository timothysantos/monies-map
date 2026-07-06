import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { recordAuditEvent } from "./app-repository-audit";

const LEGACY_OCBC_VALUE_DATE_REPAIR_KEY = "repair-legacy-ocbc-value-date-post-dates-v1";
const LEGACY_SHARED_LEDGER_OWNERSHIP_REPAIR_KEY = "repair-legacy-shared-ledger-ownership-v1";

export interface LegacyLedgerOwnershipRepairStatus {
  legacySharedCount: number;
  repairableCount: number;
  skippedCount: number;
  legacySplitCount: number;
  obsoleteDirectSplitCount: number;
  completedAt?: string;
  detail?: string;
}

async function ensureMaintenanceTasksTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_maintenance_tasks (
      key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      detail TEXT
    )
  `).run();
}

export async function repairLegacyOcbcValueDatePostDates(db: D1Database) {
  await ensureMaintenanceTasksTable(db);

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
    await markRepairComplete(db, LEGACY_OCBC_VALUE_DATE_REPAIR_KEY, "Skipped: transactions table is missing post_date or note.");
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

  await markRepairComplete(db, LEGACY_OCBC_VALUE_DATE_REPAIR_KEY, `Updated ${result.meta?.changes ?? 0} legacy OCBC rows.`);
}

export async function loadLegacyLedgerOwnershipRepairStatus(db: D1Database): Promise<LegacyLedgerOwnershipRepairStatus> {
  await ensureMaintenanceTasksTable(db);

  const [legacyShared, repairable, skipped, legacySplits, obsoleteDirectSplits, marker] = await Promise.all([
    countFirst(db, `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE household_id = ?
        AND ownership_type = 'shared'
    `, [DEFAULT_HOUSEHOLD_ID]),
    countFirst(db, `
      SELECT COUNT(*) AS count
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND transactions.ownership_type = 'shared'
        AND accounts.owner_person_id IS NOT NULL
    `, [DEFAULT_HOUSEHOLD_ID]),
    countFirst(db, `
      SELECT COUNT(*) AS count
      FROM transactions
      LEFT JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND transactions.ownership_type = 'shared'
        AND accounts.owner_person_id IS NULL
    `, [DEFAULT_HOUSEHOLD_ID]),
    countFirst(db, `
      SELECT COUNT(*) AS count
      FROM transaction_splits
      INNER JOIN transactions ON transactions.id = transaction_splits.transaction_id
      WHERE transactions.household_id = ?
    `, [DEFAULT_HOUSEHOLD_ID]),
    countFirst(db, `
      SELECT COUNT(*) AS count
      FROM transaction_splits
      INNER JOIN transactions ON transactions.id = transaction_splits.transaction_id
      WHERE transactions.household_id = ?
        AND transactions.ownership_type = 'direct'
    `, [DEFAULT_HOUSEHOLD_ID]),
    db
      .prepare("SELECT completed_at, detail FROM app_maintenance_tasks WHERE key = ?")
      .bind(LEGACY_SHARED_LEDGER_OWNERSHIP_REPAIR_KEY)
      .first<{ completed_at: string; detail: string | null }>()
  ]);

  return {
    legacySharedCount: legacyShared,
    repairableCount: repairable,
    skippedCount: skipped,
    legacySplitCount: legacySplits,
    obsoleteDirectSplitCount: obsoleteDirectSplits,
    completedAt: marker?.completed_at,
    detail: marker?.detail ?? undefined
  };
}

export async function repairLegacySharedLedgerOwnership(db: D1Database): Promise<LegacyLedgerOwnershipRepairStatus> {
  await ensureMaintenanceTasksTable(db);

  const before = await loadLegacyLedgerOwnershipRepairStatus(db);

  const updateResult = await db.prepare(`
    UPDATE transactions
    SET
      ownership_type = 'direct',
      owner_person_id = (
        SELECT accounts.owner_person_id
        FROM accounts
        WHERE accounts.id = transactions.account_id
      )
    WHERE household_id = ?
      AND ownership_type = 'shared'
      AND EXISTS (
        SELECT 1
        FROM accounts
        WHERE accounts.id = transactions.account_id
          AND accounts.owner_person_id IS NOT NULL
      )
  `).bind(DEFAULT_HOUSEHOLD_ID).run();

  const splitDeleteResult = await db.prepare(`
    DELETE FROM transaction_splits
    WHERE transaction_id IN (
      SELECT id
      FROM transactions
      WHERE household_id = ?
        AND ownership_type = 'direct'
    )
  `).bind(DEFAULT_HOUSEHOLD_ID).run();

  const updatedCount = updateResult.meta?.changes ?? 0;
  const deletedSplitCount = splitDeleteResult.meta?.changes ?? 0;
  const detail = `Repaired ${updatedCount} legacy shared ledger row${updatedCount === 1 ? "" : "s"} from account owners; deleted ${deletedSplitCount} obsolete ledger split row${deletedSplitCount === 1 ? "" : "s"}; skipped ${before.skippedCount} row${before.skippedCount === 1 ? "" : "s"} without account owner.`;
  await markRepairComplete(db, LEGACY_SHARED_LEDGER_OWNERSHIP_REPAIR_KEY, detail);

  if (updatedCount > 0 || deletedSplitCount > 0) {
    await recordAuditEvent(db, {
      entityType: "maintenance",
      entityId: LEGACY_SHARED_LEDGER_OWNERSHIP_REPAIR_KEY,
      action: "legacy_shared_ledger_ownership_repaired",
      detail
    });
  }

  return loadLegacyLedgerOwnershipRepairStatus(db);
}

async function countFirst(db: D1Database, sql: string, values: unknown[]) {
  const statement = db.prepare(sql);
  const row = await statement.bind(...values).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function markRepairComplete(db: D1Database, key: string, detail: string) {
  await db
    .prepare(`
      INSERT INTO app_maintenance_tasks (key, completed_at, detail)
      VALUES (?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(key) DO UPDATE SET
        completed_at = CURRENT_TIMESTAMP,
        detail = excluded.detail
    `)
    .bind(key, detail)
    .run();
}
