// Monthly snapshot projection (H15). Recalculates the per-scope monthly
// snapshot rows from plan rows, income rows and entries. Every write command
// that changes a month (entries, month plans, imports, seeding) calls this, so
// it lives below them to keep the command modules free of cycles.
//
// Snapshots are derived from the committed ledger, so they cannot be computed
// inside the write's own batch. A write instead puts refresh markers for its
// months in its batch (buildMonthlySnapshotRefreshMarkers), then refreshes
// them in a second batch that also clears the markers. If that refresh never
// lands, the markers stay and the next Summary or Month read repairs them.

import { buildSnapshotRowsForScope, sumVisibleExpenseMinor } from "./app-repository-helpers";
import { loadEntries } from "./app-repository-entries";
import { loadMonthIncomeRows, loadMonthPlanRows, loadSummaryMonths } from "./app-repository-months";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

// The statements that bring one month's snapshots in line with the current
// ledger and plan. Reads now; the caller runs the statements.
export async function buildMonthlySnapshotStatements(db: D1Database, month: string) {
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

  const statements: D1PreparedStatement[] = [];
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
      statements.push(db
        .prepare("DELETE FROM monthly_snapshots WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, scope.key));
      continue;
    }

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
      ));
  }
  return statements;
}

// Recalculates one month's snapshots for every scope in one batch.
export async function recalculateMonthlySnapshots(db: D1Database, month: string) {
  await db.batch(await buildMonthlySnapshotStatements(db, month));
}

// Refresh markers for the months a write touches. Put these in the write's
// own batch, then call refreshMonthlySnapshotsAfterWrite.
export function buildMonthlySnapshotRefreshMarkers(db: D1Database, months: Iterable<string>) {
  return [...new Set(months)].map((month) => db
    .prepare(`
      INSERT INTO monthly_snapshot_refreshes (household_id, month_key)
      VALUES (?, ?)
      ON CONFLICT(household_id, month_key) DO NOTHING
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, month));
}

// Recalculates the given months and clears their refresh markers, all in one
// batch, so a month is never half refreshed and never unmarked while stale.
export async function refreshMonthlySnapshots(db: D1Database, months: Iterable<string>) {
  const uniqueMonths = [...new Set(months)];
  if (!uniqueMonths.length) {
    return;
  }

  const statements: D1PreparedStatement[] = [];
  for (const month of uniqueMonths) {
    statements.push(...await buildMonthlySnapshotStatements(db, month));
  }
  statements.push(db
    .prepare(`DELETE FROM monthly_snapshot_refreshes WHERE household_id = ? AND month_key IN (${uniqueMonths.map(() => "?").join(", ")})`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...uniqueMonths));
  await db.batch(statements);
}

// The follow-up to a committed write. The write already succeeded, so a
// failed refresh must not report the write as failed; its markers remain and
// the next Summary or Month read repairs the months.
export async function refreshMonthlySnapshotsAfterWrite(db: D1Database, months: Iterable<string>) {
  try {
    await refreshMonthlySnapshots(db, months);
  } catch (error) {
    console.error("Monthly snapshot refresh failed; left for repair on the next read", error);
  }
}

// Repairs months left stale by a refresh that did not land. Costs one small
// read when nothing is pending.
export async function refreshPendingMonthlySnapshots(db: D1Database) {
  const pending = await db
    .prepare("SELECT month_key FROM monthly_snapshot_refreshes WHERE household_id = ? ORDER BY month_key")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ month_key: string }>();
  if (!pending.results.length) {
    return;
  }

  try {
    await refreshMonthlySnapshots(db, pending.results.map((row) => row.month_key));
  } catch (error) {
    // Serve the stale totals rather than fail the page; the markers stay.
    console.error("Pending monthly snapshot repair failed", error);
  }
}

// Summary months for a scope, after repairing any stale months.
export async function loadRepairedSummaryMonths(db: D1Database, personScope: string) {
  await refreshPendingMonthlySnapshots(db);
  return loadSummaryMonths(db, personScope);
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
