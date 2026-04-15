import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { slugify } from "./app-repository-helpers";

function splitBatchName(groupName?: string | null, closed = false) {
  const base = groupName ?? "Non-group expenses";
  return closed ? `${base} settled batch` : `${base} current batch`;
}

async function getSplitGroupName(db: D1Database, groupId?: string | null) {
  if (!groupId) {
    return "Non-group expenses";
  }

  const row = await db
    .prepare("SELECT group_name FROM split_groups WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, groupId)
    .first<{ group_name: string }>();
  return row?.group_name ?? "Non-group expenses";
}

async function createSplitBatch(
  db: D1Database,
  input: { groupId?: string | null; openedOn: string; closedOn?: string | null }
) {
  const id = `split-batch-${slugify(input.groupId ?? "none")}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const groupName = await getSplitGroupName(db, input.groupId);
  await db
    .prepare(`
      INSERT INTO split_batches (
        id, household_id, split_group_id, batch_name, opened_on, closed_on
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEFAULT_HOUSEHOLD_ID,
      input.groupId ?? null,
      splitBatchName(groupName, Boolean(input.closedOn)),
      input.openedOn,
      input.closedOn ?? null
    )
    .run();
  return id;
}

export async function getOrCreateActiveSplitBatch(
  db: D1Database,
  input: { groupId?: string | null; date: string }
) {
  const active = await db
    .prepare(`
      SELECT id
      FROM split_batches
      WHERE household_id = ?
        AND (split_group_id IS ? OR split_group_id = ?)
        AND closed_on IS NULL
      ORDER BY opened_on DESC, created_at DESC
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.groupId ?? null, input.groupId ?? null)
    .first<{ id: string }>();

  if (active?.id) {
    return active.id;
  }

  return createSplitBatch(db, { groupId: input.groupId, openedOn: input.date, closedOn: null });
}

export async function closeSplitBatch(
  db: D1Database,
  input: { batchId: string; closedOn: string }
) {
  const currentBatch = await db
    .prepare(`
      SELECT split_group_id
      FROM split_batches
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.batchId, DEFAULT_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null }>();
  const groupName = await getSplitGroupName(db, currentBatch?.split_group_id ?? null);
  await db
    .prepare(`
      UPDATE split_batches
      SET closed_on = COALESCE(closed_on, ?),
          batch_name = CASE
            WHEN closed_on IS NULL THEN ?
            ELSE batch_name
          END
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.closedOn, splitBatchName(groupName, true), input.batchId, DEFAULT_HOUSEHOLD_ID)
    .run();
}

export async function backfillSplitBatches(db: D1Database) {
  const unassignedExpenseCount = await db
    .prepare("SELECT COUNT(*) AS count FROM split_expenses WHERE household_id = ? AND split_batch_id IS NULL")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();
  const unassignedSettlementCount = await db
    .prepare("SELECT COUNT(*) AS count FROM split_settlements WHERE household_id = ? AND split_batch_id IS NULL")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  if ((unassignedExpenseCount?.count ?? 0) === 0 && (unassignedSettlementCount?.count ?? 0) === 0) {
    return;
  }

  const rows = await db
    .prepare(`
      SELECT split_group_id, expense_date AS activity_date, 'expense' AS kind
      FROM split_expenses
      WHERE household_id = ? AND split_batch_id IS NULL
      UNION ALL
      SELECT split_group_id, settlement_date AS activity_date, 'settlement' AS kind
      FROM split_settlements
      WHERE household_id = ? AND split_batch_id IS NULL
      ORDER BY activity_date ASC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID)
    .all<{ split_group_id: string | null; activity_date: string; kind: "expense" | "settlement" }>();

  const grouped = new Map<string, { groupId: string | null; dates: string[]; latestSettlementDate?: string; latestExpenseDate?: string }>();
  for (const row of rows.results) {
    const key = row.split_group_id ?? "split-group-none";
    const current = grouped.get(key) ?? { groupId: row.split_group_id ?? null, dates: [] };
    current.dates.push(row.activity_date);
    if (row.kind === "settlement" && (!current.latestSettlementDate || row.activity_date > current.latestSettlementDate)) {
      current.latestSettlementDate = row.activity_date;
    }
    if (row.kind === "expense" && (!current.latestExpenseDate || row.activity_date > current.latestExpenseDate)) {
      current.latestExpenseDate = row.activity_date;
    }
    grouped.set(key, current);
  }

  for (const current of grouped.values()) {
    const shouldClose = Boolean(current.latestSettlementDate)
      && (!current.latestExpenseDate || current.latestExpenseDate <= current.latestSettlementDate);
    const batchId = await createSplitBatch(db, {
      groupId: current.groupId,
      openedOn: current.dates[0],
      closedOn: shouldClose ? current.latestSettlementDate ?? current.dates[current.dates.length - 1] : null
    });

    await db
      .prepare("UPDATE split_expenses SET split_batch_id = ? WHERE household_id = ? AND split_batch_id IS NULL AND split_group_id IS ?")
      .bind(batchId, DEFAULT_HOUSEHOLD_ID, current.groupId)
      .run();
    await db
      .prepare("UPDATE split_settlements SET split_batch_id = ? WHERE household_id = ? AND split_batch_id IS NULL AND split_group_id IS ?")
      .bind(batchId, DEFAULT_HOUSEHOLD_ID, current.groupId)
      .run();
  }
}
