// Monthly snapshot projection (H15). Recalculates the per-scope monthly
// snapshot rows from plan rows, income rows and entries. Every write command
// that changes a month (entries, month plans, imports, seeding) calls this, so
// it lives below them to keep the command modules free of cycles.

import { buildSnapshotRowsForScope, sumVisibleExpenseMinor } from "./app-repository-helpers";
import { loadEntries } from "./app-repository-entries";
import { loadMonthIncomeRows, loadMonthPlanRows } from "./app-repository-months";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

export async function recalculateMonthlySnapshots(db: D1Database, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const [planRows, entries, existingSnapshots] = await Promise.all([
    loadMonthPlanRows(db, month),
    loadEntries(db, month),
    db
      .prepare(`
        SELECT person_scope, note
        FROM monthly_snapshots
        WHERE household_id = ? AND year = ? AND month = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber)
      .all<{ person_scope: string; note: string | null }>()
  ]);

  const notesByScope = new Map(existingSnapshots.results.map((row) => [row.person_scope, row.note ?? ""]));
  const scopes = await Promise.all((await loadPersonScopes(db)).map(async (personScope) => ({
    key: personScope,
    incomeRows: await loadMonthIncomeRows(db, personScope, month)
  })));

  for (const scope of scopes) {
    const visibleRows = buildSnapshotRowsForScope(planRows, scope.key);
    const visibleEntryCount = scope.key === "household"
      ? entries.length
      : entries.filter((entry) => entry.splits.some((split) => split.personId === scope.key)).length;
    const plannedExpenseMinor = visibleRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const actualExpenseMinor = sumVisibleExpenseMinor(entries, scope.key);
    const savingsGoalMinor = visibleRows
      .filter((row) => row.label === "Savings")
      .reduce((sum, row) => sum + row.plannedMinor, 0);
    const incomeMinor = scope.incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
    const sharedMinor = visibleRows
      .filter((row) => row.ownershipType === "shared")
      .reduce((sum, row) => sum + row.plannedMinor, 0);
    const preservedNote = notesByScope.get(scope.key) ?? null;

    if (!visibleRows.length && !visibleEntryCount && !scope.incomeRows.length && !preservedNote) {
      await db
        .prepare("DELETE FROM monthly_snapshots WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, scope.key)
        .run();
      continue;
    }

    await db
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
        `snapshot-${scope.key}-${month}`,
        DEFAULT_HOUSEHOLD_ID,
        year,
        monthNumber,
        scope.key,
        incomeMinor,
        plannedExpenseMinor,
        actualExpenseMinor,
        savingsGoalMinor,
        incomeMinor - actualExpenseMinor,
        sharedMinor,
        preservedNote
      )
      .run();
  }
}

export async function loadPersonScopes(db: D1Database) {
  const people = await db
    .prepare(`
      SELECT id
      FROM people
      WHERE household_id = ?
      ORDER BY created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string }>();

  return ["household", ...people.results.map((person) => person.id)];
}
