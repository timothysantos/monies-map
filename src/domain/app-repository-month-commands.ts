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

interface MonthPlanRowSaveInput {
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

export async function saveMonthPlanRow(db: D1Database, input: MonthPlanRowSaveInput) {
  const { statements, created } = await buildMonthPlanRowSaveStatements(db, input);
  await db.batch([...statements, ...buildMonthlySnapshotRefreshMarkers(db, [input.month])]);
  await refreshMonthlySnapshotsAfterWrite(db, [input.month]);
  return { rowId: input.rowId, updated: true, created };
}

// One plan row's save: reads and lookups first, then the row and its
// splits as statements for the caller's single batch (saveMonthPlanRow,
// applyMonthPlanChanges).
async function buildMonthPlanRowSaveStatements(db: D1Database, input: MonthPlanRowSaveInput) {
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

  return { statements: [rowStatement, ...splitStatements], created: !existing };
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
    ...buildMonthPlanRowDeleteStatements(db, input.rowId),
    ...buildMonthlySnapshotRefreshMarkers(db, [input.month])
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, [input.month]);
  return { rowId: input.rowId, deleted: true };
}

function buildMonthPlanRowDeleteStatements(db: D1Database, rowId: string) {
  return [
    db
      .prepare("DELETE FROM monthly_plan_entry_links WHERE monthly_plan_row_id = ?")
      .bind(rowId),
    db
      .prepare("DELETE FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?")
      .bind(rowId),
    db
      .prepare("DELETE FROM monthly_plan_rows WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, rowId)
  ];
}

// A plan change refused because the plan is not what the draft was made
// from (a line changed or was removed, or a new line's id is taken), or
// because the change list itself is not valid. Nothing is written.
export class MonthPlanChangeError extends Error {
  constructor(message: string, readonly status: 400 | 409) {
    super(message);
    this.name = "MonthPlanChangeError";
  }
}

export const MONTH_PLAN_CHANGES_MAX = 80;
const MONTH_PLAN_LINE_MAX_MINOR = 1_000_000_000;
const PLAN_CHANGED_MESSAGE = "The plan changed since this draft was made. Ask again to see it as it is now.";
const PLAN_SECTIONS = new Set(["income", "planned_items", "budget_buckets"]);

type MonthPlanChange =
  | { action: "update"; rowId: string; expectedMinor: number; plannedMinor: number }
  | { action: "delete"; rowId: string; expectedMinor: number }
  | ({ action: "create" } & Omit<MonthPlanRowSaveInput, "month">);

interface StoredPlanRow {
  id: string;
  section_key: "income" | "planned_items" | "budget_buckets";
  label: string;
  plan_date: string | null;
  planned_amount_minor: number;
  notes: string | null;
  ownership_type: "direct" | "shared";
  category_name: string | null;
  account_name: string | null;
  owner_name: string | null;
}

/**
 * Several plan-row changes for one month, all or nothing (Ask's plan
 * draft: DOMAIN.md "Plan Draft"). Each update and create is the same row
 * and split statements saveMonthPlanRow writes, each delete the same as
 * deleteMonthPlanRow's; the whole list, with the month's refresh marker,
 * commits in one batch. Read and check first: every updated or deleted
 * line must still hold `expectedMinor`, and every new line's id must be
 * free, or nothing is written (409). Returns the changes that put the plan
 * back as it was (Undo).
 */
export async function applyMonthPlanChanges(db: D1Database, input: { month: string; changes: MonthPlanChange[] }) {
  const { month, changes } = input;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Array.isArray(changes) || !changes.length || changes.length > MONTH_PLAN_CHANGES_MAX) {
    throw new MonthPlanChangeError("Missing month plan changes", 400);
  }
  const seen = new Set<string>();
  for (const change of changes) {
    if (!isValidChange(change) || seen.has(change.rowId)) {
      throw new MonthPlanChangeError("Invalid month plan change", 400);
    }
    seen.add(change.rowId);
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const stored = await db
    .prepare(`
      SELECT
        monthly_plan_rows.id,
        monthly_plan_rows.section_key,
        monthly_plan_rows.label,
        monthly_plan_rows.plan_date,
        monthly_plan_rows.planned_amount_minor,
        monthly_plan_rows.notes,
        monthly_plan_rows.ownership_type,
        categories.name AS category_name,
        accounts.account_name AS account_name,
        people.display_name AS owner_name
      FROM monthly_plan_rows
      LEFT JOIN categories ON categories.id = monthly_plan_rows.category_id
      LEFT JOIN accounts ON accounts.id = monthly_plan_rows.account_id
      LEFT JOIN people ON people.id = monthly_plan_rows.person_id
      WHERE monthly_plan_rows.household_id = ? AND monthly_plan_rows.year = ? AND monthly_plan_rows.month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
    .all<StoredPlanRow>();
  const byId = new Map(stored.results.map((row) => [row.id, row]));
  const createIds = changes.filter((change) => change.action === "create").map((change) => change.rowId);
  const takenIds = createIds.length
    ? (await db
      .prepare(`SELECT id FROM monthly_plan_rows WHERE id IN (${createIds.map(() => "?").join(", ")})`)
      .bind(...createIds)
      .all<{ id: string }>()).results.map((row) => row.id)
    : [];
  if (takenIds.length) {
    throw new MonthPlanChangeError(PLAN_CHANGED_MESSAGE, 409);
  }
  // A shared row's split share is the first person's, as the Month editor sends it.
  const sharedRowIds = changes
    .filter((change) => change.action !== "create" && byId.get(change.rowId)?.ownership_type === "shared")
    .map((change) => change.rowId);
  const firstShares = new Map<string, number>();
  if (sharedRowIds.length) {
    const firstPerson = await db
      .prepare("SELECT id FROM people WHERE household_id = ? ORDER BY created_at LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .first<{ id: string }>();
    const shares = await db
      .prepare(`SELECT monthly_plan_row_id, ratio_basis_points FROM monthly_plan_row_splits WHERE person_id = ? AND monthly_plan_row_id IN (${sharedRowIds.map(() => "?").join(", ")})`)
      .bind(firstPerson?.id ?? "", ...sharedRowIds)
      .all<{ monthly_plan_row_id: string; ratio_basis_points: number }>();
    for (const share of shares.results) {
      firstShares.set(share.monthly_plan_row_id, share.ratio_basis_points);
    }
  }

  const statements: D1PreparedStatement[] = [];
  const undo: MonthPlanChange[] = [];
  for (const change of changes) {
    if (change.action === "create") {
      const { action: _action, ...row } = change;
      statements.push(...(await buildMonthPlanRowSaveStatements(db, { ...row, month })).statements);
      undo.push({ action: "delete", rowId: change.rowId, expectedMinor: change.plannedMinor });
      continue;
    }
    const current = byId.get(change.rowId);
    if (!current || current.planned_amount_minor !== change.expectedMinor) {
      throw new MonthPlanChangeError(PLAN_CHANGED_MESSAGE, 409);
    }
    const saved = savedRowInput(current, month, firstShares.get(current.id));
    if (change.action === "delete") {
      statements.push(...buildMonthPlanRowDeleteStatements(db, change.rowId));
      const { month: _month, ...restored } = saved;
      undo.push({ action: "create", ...restored });
      continue;
    }
    statements.push(...(await buildMonthPlanRowSaveStatements(db, { ...saved, plannedMinor: change.plannedMinor })).statements);
    undo.push({ action: "update", rowId: change.rowId, expectedMinor: change.plannedMinor, plannedMinor: change.expectedMinor });
  }

  await db.batch([...statements, ...buildMonthlySnapshotRefreshMarkers(db, [month])]);
  await refreshMonthlySnapshotsAfterWrite(db, [month]);
  // Undo runs the changes back in reverse order.
  return { month, applied: changes.length, undo: undo.reverse() };
}

// A stored row as saveMonthPlanRow takes it, so an update rewrites every
// other field exactly as it was.
function savedRowInput(row: StoredPlanRow, month: string, firstShareBasisPoints?: number): MonthPlanRowSaveInput {
  return {
    rowId: row.id,
    month,
    sectionKey: row.section_key,
    categoryName: row.category_name ?? "",
    label: row.label,
    planDate: row.plan_date,
    accountName: row.account_name,
    plannedMinor: row.planned_amount_minor,
    note: row.notes,
    ownershipType: row.ownership_type,
    ...(row.ownership_type === "direct" && row.owner_name ? { ownerName: row.owner_name } : {}),
    ...(row.ownership_type === "shared" && firstShareBasisPoints !== undefined ? { splitBasisPoints: firstShareBasisPoints } : {})
  };
}

function isAmount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MONTH_PLAN_LINE_MAX_MINOR;
}

function isValidChange(change: unknown): change is MonthPlanChange {
  if (!change || typeof change !== "object") return false;
  const value = change as Record<string, unknown>;
  if (typeof value.rowId !== "string" || !value.rowId || value.rowId.length > 200) return false;
  if (value.action === "update") return isAmount(value.expectedMinor) && isAmount(value.plannedMinor);
  if (value.action === "delete") return isAmount(value.expectedMinor);
  if (value.action !== "create") return false;
  return PLAN_SECTIONS.has(String(value.sectionKey))
    && typeof value.label === "string" && value.label.trim().length > 0 && value.label.length <= 120
    && typeof value.categoryName === "string" && value.categoryName.length <= 120
    && isAmount(value.plannedMinor)
    && (value.ownershipType === "direct" ? typeof value.ownerName === "string" && value.ownerName.length > 0 : value.ownershipType === "shared")
    && (value.splitBasisPoints === undefined || (Number.isInteger(value.splitBasisPoints) && Number(value.splitBasisPoints) >= 0 && Number(value.splitBasisPoints) <= 10_000))
    && (value.planDate === undefined || value.planDate === null || (typeof value.planDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.planDate)))
    && (value.accountName === undefined || value.accountName === null || typeof value.accountName === "string")
    && (value.note === undefined || value.note === null || (typeof value.note === "string" && value.note.length <= 500));
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
