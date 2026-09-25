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
//
// Each marker write sets a new refresh token. A refresh reads the tokens
// before it reads the ledger, and its batch only writes totals and clears a
// marker while that month's token is unchanged. So a refresh computed before
// a newer write can neither overwrite newer totals nor clear the newer
// write's marker; the newer write's own refresh (or the next read) does it.

type RefreshMarker = { month_key: string; refresh_token: string };

import { buildSnapshotRowsForScope, sumVisibleExpenseMinor } from "./app-repository-helpers";
import { loadEntries } from "./app-repository-entries";
import { loadMonthIncomeRows, loadMonthPlanRows, loadSummaryMonths } from "./app-repository-months";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

// The statements that bring one month's snapshots in line with the current
// ledger and plan. Reads now; the caller runs the statements. With a marker,
// each statement only applies while that marker's token is still current.
export async function buildMonthlySnapshotStatements(db: D1Database, month: string, marker?: RefreshMarker) {
  const [year, monthNumber] = month.split("-").map(Number);
  const markerGuard = marker
    ? "EXISTS (SELECT 1 FROM monthly_snapshot_refreshes WHERE household_id = ? AND month_key = ? AND refresh_token = ?)"
    : null;
  const markerGuardValues = marker ? [DEFAULT_HOUSEHOLD_ID, marker.month_key, marker.refresh_token] : [];
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
        .prepare(`DELETE FROM monthly_snapshots WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?${markerGuard ? ` AND ${markerGuard}` : ""}`)
        .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, scope.key, ...markerGuardValues));
      continue;
    }

    // INSERT ... SELECT (not VALUES) so the upsert can carry the marker guard.
    statements.push(db
      .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${markerGuard ?? "1"}
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
        preservedNote,
        ...markerGuardValues
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
      INSERT INTO monthly_snapshot_refreshes (household_id, month_key, refresh_token)
      VALUES (?, ?, ?)
      ON CONFLICT(household_id, month_key) DO UPDATE SET
        refresh_token = excluded.refresh_token,
        requested_at = CURRENT_TIMESTAMP
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, month, crypto.randomUUID()));
}

async function loadRefreshMarkers(db: D1Database) {
  const markers = await db
    .prepare("SELECT month_key, refresh_token FROM monthly_snapshot_refreshes WHERE household_id = ? ORDER BY month_key")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<RefreshMarker>();
  return markers.results;
}

// Recalculates the marked months and clears their markers in one batch, so a
// month is never half refreshed. A month without a marker is already current
// (another refresh finished it) and is skipped.
async function refreshMarkedMonths(db: D1Database, markers: RefreshMarker[]) {
  if (!markers.length) {
    return;
  }

  const statements: D1PreparedStatement[] = [];
  for (const marker of markers) {
    statements.push(
      ...await buildMonthlySnapshotStatements(db, marker.month_key, marker),
      db
        .prepare("DELETE FROM monthly_snapshot_refreshes WHERE household_id = ? AND month_key = ? AND refresh_token = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, marker.month_key, marker.refresh_token)
    );
  }
  await db.batch(statements);
}

// Refreshes the given months if they are still marked.
export async function refreshMonthlySnapshots(db: D1Database, months: Iterable<string>) {
  const wanted = new Set(months);
  if (!wanted.size) {
    return;
  }
  await refreshMarkedMonths(db, (await loadRefreshMarkers(db)).filter((marker) => wanted.has(marker.month_key)));
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
  const pending = await loadRefreshMarkers(db);
  if (!pending.length) {
    return;
  }

  try {
    await refreshMarkedMonths(db, pending);
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
