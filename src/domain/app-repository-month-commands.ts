// Month plan commands (H15c): save, link and delete plan rows, month notes,
// and duplicating, resetting or deleting a month's plan. Each keeps its
// original SQL order. Reads and checks run first and every write of a command
// commits in one db.batch(); plan-row edits then refresh the month's
// snapshots (see app-repository-snapshots.ts).

import {
  buildMonthlySnapshotRefreshMarkers,
  loadPersonScopes,
  refreshMonthlySnapshotsAfterWrite
} from "./app-repository-snapshots";
import {
  buildSnapshotRowsForScope,
  nextMonthKey,
  normalizePlanMatchHint,
  shiftPlanDate,
  slugify
} from "./app-repository-helpers";
import { resolveAccountId, resolveCategoryId, resolvePersonId } from "./app-repository-lookups";
import { buildMonthlyPlanRowSplitStatements } from "./app-repository-split-sync";
import { loadMonthIncomeRows, loadMonthPlanRows } from "./app-repository-months";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

export async function duplicateMonthPlan(db: D1Database, sourceMonth: string) {
  const targetMonth = nextMonthKey(sourceMonth);
  const [sourceYear, sourceMonthNumber] = sourceMonth.split("-").map(Number);
  const [targetYear, targetMonthNumber] = targetMonth.split("-").map(Number);

  const existingTarget = await db
    .prepare(`
      SELECT COUNT(*) as count
      FROM monthly_plan_rows
      WHERE household_id = ? AND year = ? AND month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, targetYear, targetMonthNumber)
    .first<{ count: number }>();

  if ((existingTarget?.count ?? 0) > 0) {
    return { targetMonth, created: false };
  }

  const rows = await db
    .prepare(`
      SELECT
        id, person_id, ownership_type, section_key, category_id, label,
        plan_date, account_id, planned_amount_minor, notes
      FROM monthly_plan_rows
      WHERE household_id = ? AND year = ? AND month = ?
      ORDER BY created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, sourceYear, sourceMonthNumber)
    .all<{
      id: string;
      person_id: string | null;
      ownership_type: "direct" | "shared";
      section_key: "income" | "planned_items" | "budget_buckets";
      category_id: string | null;
      label: string;
      plan_date: string | null;
      account_id: string | null;
      planned_amount_minor: number;
      notes: string | null;
    }>();

  const rowIds = rows.results.map((row) => row.id);
  const splitMap = new Map<string, { person_id: string; ratio_basis_points: number }[]>();
  if (rowIds.length) {
    const placeholders = rowIds.map(() => "?").join(", ");
    const splits = await db
      .prepare(`
        SELECT monthly_plan_row_id, person_id, ratio_basis_points
        FROM monthly_plan_row_splits
        WHERE monthly_plan_row_id IN (${placeholders})
        ORDER BY created_at
      `)
      .bind(...rowIds)
      .all<{
        monthly_plan_row_id: string;
        person_id: string;
        ratio_basis_points: number;
      }>();

    for (const split of splits.results) {
      const current = splitMap.get(split.monthly_plan_row_id) ?? [];
      current.push(split);
      splitMap.set(split.monthly_plan_row_id, current);
    }
  }

  // The new month is an exact copy of the source month's plan, so its
  // planned totals are the source month's. Computing them now lets the copy
  // and its totals commit together.
  const personScopes = await loadPersonScopes(db);
  const sourcePlanRows = await loadMonthPlanRows(db, sourceMonth);
  const plannedTotalsByScope = await Promise.all(personScopes.map(async (personScope) => {
    const incomeRows = await loadMonthIncomeRows(db, personScope, sourceMonth);
    const visibleRows = buildSnapshotRowsForScope(sourcePlanRows, personScope);
    return {
      personScope,
      plannedExpenseMinor: visibleRows.reduce((sum, row) => sum + row.plannedMinor, 0),
      incomeMinor: incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0),
      savingsGoalMinor: visibleRows.filter((row) => row.label === "Savings").reduce((sum, row) => sum + row.plannedMinor, 0)
    };
  }));

  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results) {
    const nextId = `${row.id}-dup-${targetMonth}`;
    statements.push(db
      .prepare(`
        INSERT INTO monthly_plan_rows (
          id, household_id, year, month, person_id, ownership_type,
          section_key, category_id, label, plan_date, account_id,
          planned_amount_minor, actual_amount_minor, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        nextId,
        DEFAULT_HOUSEHOLD_ID,
        targetYear,
        targetMonthNumber,
        row.person_id,
        row.ownership_type,
        row.section_key,
        row.category_id,
        row.label,
        shiftPlanDate(row.plan_date, targetYear, targetMonthNumber),
        row.account_id,
        row.planned_amount_minor,
        0,
        row.notes
      ));

    for (const split of splitMap.get(row.id) ?? []) {
      statements.push(db
        .prepare(`
          INSERT INTO monthly_plan_row_splits (
            id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `${nextId}-${split.person_id}`,
          nextId,
          split.person_id,
          split.ratio_basis_points,
          0
        ));
    }
  }

  for (const { personScope, plannedExpenseMinor, incomeMinor, savingsGoalMinor } of plannedTotalsByScope) {
    statements.push(db
      .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        `snapshot-${personScope}-${targetMonth}`,
        DEFAULT_HOUSEHOLD_ID,
        targetYear,
        targetMonthNumber,
        personScope,
        incomeMinor,
        plannedExpenseMinor,
        0,
        savingsGoalMinor,
        incomeMinor - plannedExpenseMinor,
        0,
        `Created from ${sourceMonth} planning template.`
      ));
  }

  await db.batch(statements);
  return { targetMonth, created: true };
}

export async function resetMonthPlan(db: D1Database, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const statements = buildClearMonthDataStatements(db, month, year, monthNumber);

  const personScopes = await loadPersonScopes(db);
  for (const personScope of personScopes) {
    statements.push(db
      .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          total_income_minor = excluded.total_income_minor,
          estimated_expense_minor = excluded.estimated_expense_minor,
          total_expense_minor = excluded.total_expense_minor,
          savings_goal_minor = excluded.savings_goal_minor,
          total_net_minor = excluded.total_net_minor,
          total_shared_minor = excluded.total_shared_minor,
          note = excluded.note
      `)
      .bind(
        `snapshot-${personScope}-${month}`,
        DEFAULT_HOUSEHOLD_ID,
        year,
        monthNumber,
        personScope,
        0,
        0,
        0,
        0,
        0,
        0,
        "Month reset to empty."
      ));
  }

  await db.batch(statements);
  return { month, reset: true };
}

export async function deleteMonthPlan(db: D1Database, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  await db.batch([
    ...buildClearMonthDataStatements(db, month, year, monthNumber),
    db
      .prepare(`
        DELETE FROM monthly_snapshots
        WHERE household_id = ?
          AND year = ?
          AND month = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
  ]);

  return { month, deleted: true };
}

export async function updateMonthlySnapshotNote(
  db: D1Database,
  input: {
    month: string;
    personScope: string;
    note: string;
  }
) {
  const [year, monthNumber] = input.month.split("-").map(Number);
  const existing = await db
    .prepare(`
      SELECT id
      FROM monthly_snapshots
      WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, input.personScope)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(`
        UPDATE monthly_snapshots
        SET note = ?
        WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?
      `)
      .bind(input.note, DEFAULT_HOUSEHOLD_ID, year, monthNumber, input.personScope)
      .run();

    return { month: input.month, personScope: input.personScope, updated: true };
  }

  await db
    .prepare(`
      INSERT INTO monthly_snapshots (
        id, household_id, year, month, person_scope,
        total_income_minor, estimated_expense_minor, total_expense_minor,
        savings_goal_minor, total_net_minor, total_shared_minor, note
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?)
    `)
    .bind(
      `snapshot-${input.personScope}-${input.month}`,
      DEFAULT_HOUSEHOLD_ID,
      year,
      monthNumber,
      input.personScope,
      input.note
    )
    .run();

  return { month: input.month, personScope: input.personScope, updated: true };
}

export async function saveMonthPlanRow(
  db: D1Database,
  input: {
    rowId: string;
    month: string;
    sectionKey: "income" | "planned_items" | "budget_buckets";
    categoryName: string;
    label: string;
    planDate?: string | null;
    accountName?: string | null;
    plannedMinor: number;
    note?: string | null;
    ownershipType: "direct" | "shared";
    ownerName?: string;
    splitBasisPoints?: number;
  }
) {
  const [year, monthNumber] = input.month.split("-").map(Number);
  const categoryId = await resolveCategoryId(db, input.categoryName);
  const accountId = await resolveAccountId(db, input.accountName ?? undefined);
  const personId = input.ownershipType === "direct"
    ? await resolvePersonId(db, input.ownerName)
    : null;

  const existing = await db
    .prepare(`
      SELECT actual_amount_minor
      FROM monthly_plan_rows
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.rowId)
    .first<{ actual_amount_minor: number }>();

  const splitStatements = await buildMonthlyPlanRowSplitStatements(db, {
    rowId: input.rowId,
    ownershipType: input.ownershipType,
    plannedMinor: input.plannedMinor,
    ownerName: input.ownerName,
    splitBasisPoints: input.splitBasisPoints
  });

  const rowStatement = existing
    ? db
      .prepare(`
        UPDATE monthly_plan_rows
        SET
          year = ?,
          month = ?,
          person_id = ?,
          ownership_type = ?,
          section_key = ?,
          category_id = ?,
          label = ?,
          plan_date = ?,
          account_id = ?,
          planned_amount_minor = ?,
          notes = ?
        WHERE household_id = ? AND id = ?
      `)
      .bind(
        year,
        monthNumber,
        personId,
        input.ownershipType,
        input.sectionKey,
        categoryId,
        input.label,
        input.sectionKey === "planned_items" ? (input.planDate ?? null) : null,
        input.sectionKey === "planned_items" ? accountId : null,
        input.plannedMinor,
        input.note ?? null,
        DEFAULT_HOUSEHOLD_ID,
        input.rowId
      )
    : db
      .prepare(`
        INSERT INTO monthly_plan_rows (
          id, household_id, year, month, person_id, ownership_type,
          section_key, category_id, label, plan_date, account_id,
          planned_amount_minor, actual_amount_minor, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        input.rowId,
        DEFAULT_HOUSEHOLD_ID,
        year,
        monthNumber,
        personId,
        input.ownershipType,
        input.sectionKey,
        categoryId,
        input.label,
        input.sectionKey === "planned_items" ? (input.planDate ?? null) : null,
        input.sectionKey === "planned_items" ? accountId : null,
        input.plannedMinor,
        0,
        input.note ?? null
      );

  await db.batch([rowStatement, ...splitStatements, ...buildMonthlySnapshotRefreshMarkers(db, [input.month])]);
  await refreshMonthlySnapshotsAfterWrite(db, [input.month]);
  return { rowId: input.rowId, updated: true, created: !existing };
}

export async function saveMonthPlanEntryLinks(
  db: D1Database,
  input: {
    rowId: string;
    month: string;
    transactionIds: string[];
  }
) {
  const row = await db
    .prepare(`
      SELECT
        monthly_plan_rows.section_key,
        monthly_plan_rows.person_id,
        monthly_plan_rows.category_id,
        monthly_plan_rows.account_id,
        monthly_plan_rows.label
      FROM monthly_plan_rows
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.rowId)
    .first<{
      section_key: "income" | "planned_items" | "budget_buckets";
      person_id: string | null;
      category_id: string | null;
      account_id: string | null;
      label: string;
    }>();

  if (!row || row.section_key !== "planned_items") {
    throw new Error("Only planned items can be linked to entries.");
  }

  const uniqueTransactionIds = [...new Set(input.transactionIds.filter(Boolean))];

  if (uniqueTransactionIds.length) {
    const placeholders = uniqueTransactionIds.map(() => "?").join(", ");
    const validTransactions = await db
      .prepare(`
        SELECT id
        FROM transactions
        WHERE household_id = ?
          AND entry_type = 'expense'
          AND id IN (${placeholders})
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...uniqueTransactionIds)
      .all<{ id: string }>();
    const validIds = new Set(validTransactions.results.map((transaction) => transaction.id));
    const invalid = uniqueTransactionIds.find((transactionId) => !validIds.has(transactionId));
    if (invalid) {
      throw new Error("One or more selected entries cannot be linked.");
    }
  }

  const linkedTransactions = uniqueTransactionIds.length
    ? await db
        .prepare(`
          SELECT
            transactions.id,
            transactions.description,
            transactions.amount_minor,
            transactions.account_id,
            transactions.category_id
          FROM transactions
          WHERE transactions.household_id = ?
            AND transactions.id IN (${uniqueTransactionIds.map(() => "?").join(", ")})
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, ...uniqueTransactionIds)
        .all<{
          id: string;
          description: string;
          amount_minor: number;
          account_id: string | null;
          category_id: string | null;
        }>()
    : { results: [] as Array<{ id: string; description: string; amount_minor: number; account_id: string | null; category_id: string | null }> };

  const statements = [db.prepare("DELETE FROM monthly_plan_entry_links WHERE monthly_plan_row_id = ?").bind(input.rowId)];

  for (const transactionId of uniqueTransactionIds) {
    statements.push(db
      .prepare(`
        INSERT INTO monthly_plan_entry_links (
          id, monthly_plan_row_id, transaction_id
        ) VALUES (?, ?, ?)
      `)
      .bind(`mple-${input.rowId}-${transactionId}`, input.rowId, transactionId));
  }

  const labelNormalized = normalizePlanMatchHint(row.label);
  for (const transaction of linkedTransactions.results) {
    const descriptionPattern = normalizePlanMatchHint(transaction.description);
    if (!descriptionPattern) {
      continue;
    }

    statements.push(db
      .prepare(`
        INSERT INTO monthly_plan_match_hints (
          id, household_id, person_id, category_id, account_id,
          label_normalized, description_pattern, amount_minor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET amount_minor = excluded.amount_minor, updated_at = CURRENT_TIMESTAMP
      `)
      .bind(
        `mpmh-${slugify([row.person_id ?? "household", row.category_id ?? "any-category", transaction.account_id ?? "any-account", labelNormalized, descriptionPattern].join("-"))}`,
        DEFAULT_HOUSEHOLD_ID,
        row.person_id,
        transaction.category_id ?? row.category_id,
        transaction.account_id ?? row.account_id,
        labelNormalized,
        descriptionPattern,
        transaction.amount_minor
      ));
  }

  statements.push(...buildMonthlySnapshotRefreshMarkers(db, [input.month]));
  await db.batch(statements);
  await refreshMonthlySnapshotsAfterWrite(db, [input.month]);
  return { rowId: input.rowId, linkedEntryCount: uniqueTransactionIds.length };
}

export async function deleteMonthPlanRow(
  db: D1Database,
  input: {
    rowId: string;
    month: string;
  }
) {
  await db.batch([
    db
      .prepare("DELETE FROM monthly_plan_entry_links WHERE monthly_plan_row_id = ?")
      .bind(input.rowId),
    db
      .prepare("DELETE FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?")
      .bind(input.rowId),
    db
      .prepare("DELETE FROM monthly_plan_rows WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.rowId),
    ...buildMonthlySnapshotRefreshMarkers(db, [input.month])
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, [input.month]);
  return { rowId: input.rowId, deleted: true };
}

// Removes a month's entries and plan (and the links into them).
function buildClearMonthDataStatements(db: D1Database, month: string, year: number, monthNumber: number) {
  const monthStart = `${month}-01`;
  const nextMonthStart = nextMonthKey(month) + "-01";
  return [
    db
      .prepare(`
        UPDATE split_expenses
        SET linked_transaction_id = NULL
        WHERE household_id = ?
          AND linked_transaction_id IN (
            SELECT id
            FROM transactions
            WHERE household_id = ?
              AND transaction_date >= ?
              AND transaction_date < ?
          )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, monthStart, nextMonthStart),
    db
      .prepare(`
        UPDATE split_settlements
        SET linked_transaction_id = NULL
        WHERE household_id = ?
          AND linked_transaction_id IN (
            SELECT id
            FROM transactions
            WHERE household_id = ?
              AND transaction_date >= ?
              AND transaction_date < ?
          )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, monthStart, nextMonthStart),
    db
      .prepare(`
        DELETE FROM monthly_plan_entry_links
        WHERE transaction_id IN (
          SELECT id
          FROM transactions
          WHERE household_id = ?
            AND transaction_date >= ?
            AND transaction_date < ?
        )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, monthStart, nextMonthStart),
    db
      .prepare(`
        DELETE FROM transactions
        WHERE household_id = ?
          AND transaction_date >= ?
          AND transaction_date < ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, monthStart, nextMonthStart),
    db
      .prepare(`
        DELETE FROM monthly_plan_entry_links
        WHERE monthly_plan_row_id IN (
          SELECT id
          FROM monthly_plan_rows
          WHERE household_id = ?
            AND year = ?
            AND month = ?
        )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber),
    db
      .prepare(`
        DELETE FROM monthly_plan_row_splits
        WHERE monthly_plan_row_id IN (
          SELECT id
          FROM monthly_plan_rows
          WHERE household_id = ?
            AND year = ?
            AND month = ?
        )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber),
    db
      .prepare(`
        DELETE FROM monthly_plan_rows
        WHERE household_id = ?
          AND year = ?
          AND month = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
  ];
}
