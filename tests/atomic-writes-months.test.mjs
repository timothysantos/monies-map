// Month plans and month totals: persistence commands are all-or-nothing. Each scenario runs against a real
// local D1 (Miniflare) seeded with the demo household. A success case pins
// the concrete rows a command writes; a failure case makes one statement
// fail partway through the command and proves the database is byte-for-byte
// what it was before (no partial rows).
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals
} from "./support/d1-workspace.mjs";
import {
  buildMonthlySnapshotRefreshMarkers,
  recalculateMonthlySnapshots,
  refreshMonthlySnapshots,
  refreshPendingMonthlySnapshots
} from "../src/domain/app-repository-snapshots.ts";
import {
  deleteMonthPlanRow,
  duplicateMonthPlan,
  resetMonthPlan,
  saveMonthPlanEntryLinks,
  saveMonthPlanRow
} from "../src/domain/app-repository-month-commands.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// ----------------------------------------------------------- month totals

test("a month-total recalculation that fails on a later scope keeps every scope's previous totals", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  const totalsBefore = await snapshotTotals(db, "2026-05");
  assert.ok(totalsBefore.length >= 3, "household and both people have totals");
  await db.prepare("UPDATE transactions SET amount_minor = amount_minor + 100 WHERE transaction_date LIKE '2026-05-%' AND entry_type = 'expense'").run();
  const faulty = failingStatement(db, /INSERT INTO monthly_snapshots/, { skip: 1 });

  await assert.rejects(recalculateMonthlySnapshots(faulty.db, "2026-05"), /injected_failure_missing_table/);

  assert.deepEqual(await snapshotTotals(db, "2026-05"), totalsBefore);
  await recalculateMonthlySnapshots(db, "2026-05");
  const expenseCount = (await rows(db, "SELECT id FROM transactions WHERE transaction_date LIKE '2026-05-%' AND entry_type = 'expense'")).length;
  const [household] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");
  const [householdBefore] = totalsBefore.filter((row) => row.person_scope === "household");
  assert.equal(household.total_expense_minor, householdBefore.total_expense_minor + expenseCount * 100);
});

test("a month refresh computed before a newer write neither overwrites its totals nor clears its marker", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  // Write A: a ledger change and its marker; its refresh is about to run.
  await db.batch([
    db.prepare("UPDATE transactions SET amount_minor = amount_minor + 100 WHERE id = (SELECT id FROM transactions WHERE transaction_date LIKE '2026-05-%' AND entry_type = 'expense' ORDER BY id LIMIT 1)"),
    ...buildMonthlySnapshotRefreshMarkers(db, ["2026-05"])
  ]);
  // Refresh A has read the ledger; write B (and B's own refresh) lands
  // before refresh A's batch does.
  let raced = false;
  const racing = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements) => {
          if (!raced) {
            raced = true;
            await createEntry(api, { date: "2026-05-20", description: "Atomic racing write", amountMinor: 7_000 });
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  await refreshMonthlySnapshots(racing, ["2026-05"]);

  assert.equal(raced, true);
  const stored = await snapshotTotals(db, "2026-05");
  await recalculateMonthlySnapshots(db, "2026-05");
  assert.deepEqual(stored, await snapshotTotals(db, "2026-05"), "stored totals include write B");
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
});

test("a repair of more than a hundred marked months refreshes and clears them all", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const months = Array.from({ length: 101 }, (_, index) => {
    const date = new Date(Date.UTC(2010, index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  months.push("2026-05");
  await db.batch(buildMonthlySnapshotRefreshMarkers(db, months));
  await db.prepare("DELETE FROM monthly_snapshots WHERE year = 2026 AND month = 5").run();

  await refreshPendingMonthlySnapshots(db);

  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  assert.deepEqual((await snapshotTotals(db, "2026-05")).map((row) => row.person_scope), ["household", "person-joyce", "person-tim"]);
});

// ------------------------------------------------------------- month plans

const PLAN_ROW = { rowId: "atomic-row", month: "2026-05", sectionKey: "planned_items", categoryName: "Groceries", label: "Atomic item", planDate: "2026-05-10", accountName: "UOB One", plannedMinor: 50_000, ownershipType: "shared", splitBasisPoints: 6_000 };

test("saving a shared plan row writes the row, both splits and the planned total", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, "2026-05");
  const [householdBefore] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");

  assert.deepEqual(await saveMonthPlanRow(db, PLAN_ROW), { rowId: "atomic-row", updated: true, created: true });

  assert.deepEqual(await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ? ORDER BY id", "atomic-row"), [
    { person_id: "person-tim", ratio_basis_points: 6_000, amount_minor: 30_000 },
    { person_id: "person-joyce", ratio_basis_points: 4_000, amount_minor: 20_000 }
  ]);
  const [householdAfter] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");
  assert.equal(householdAfter.estimated_expense_minor, householdBefore.estimated_expense_minor + 50_000);
});

test("a plan row save that fails on its splits keeps the previous row and splits", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await saveMonthPlanRow(db, PLAN_ROW);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO monthly_plan_row_splits/);

  await assert.rejects(saveMonthPlanRow(faulty.db, { ...PLAN_ROW, plannedMinor: 70_000, splitBasisPoints: 5_000 }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("plan entry links that fail on a match hint save no links", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-05-10", description: "Atomic linked groceries", amountMinor: 4_210 });
  await saveMonthPlanRow(db, PLAN_ROW);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO monthly_plan_match_hints/);

  await assert.rejects(saveMonthPlanEntryLinks(faulty.db, { rowId: "atomic-row", month: "2026-05", transactionIds: [entryId] }), /injected_failure_missing_table/);

  assertSameDatabase(await dumpDatabase(db), before);
});

test("a plan row delete that fails on the row keeps its splits and links", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await saveMonthPlanRow(db, PLAN_ROW);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM monthly_plan_rows/);

  await assert.rejects(deleteMonthPlanRow(faulty.db, { rowId: "atomic-row", month: "2026-05" }), /injected_failure_missing_table/);

  assertSameDatabase(await dumpDatabase(db), before);
});

test("duplicating a month copies its plan rows and writes the new month's planned totals", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const sourceRows = await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE year = 2026 AND month = 5 ORDER BY id");
  assert.ok(sourceRows.length > 0);

  assert.deepEqual(await duplicateMonthPlan(db, "2026-05"), { targetMonth: "2026-06", created: true });

  assert.deepEqual(
    await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE year = 2026 AND month = 6 ORDER BY id"),
    sourceRows.map((row) => ({ id: `${row.id}-dup-2026-06`, planned_amount_minor: row.planned_amount_minor }))
  );
  const totals = await rows(db, "SELECT person_scope, estimated_expense_minor, total_expense_minor, note FROM monthly_snapshots WHERE year = 2026 AND month = 6 ORDER BY person_scope");
  const plannedHousehold = (await rows(db, "SELECT SUM(planned_amount_minor) AS total FROM monthly_plan_rows WHERE year = 2026 AND month = 6 AND section_key <> 'income'"))[0].total;
  assert.deepEqual(totals.find((row) => row.person_scope === "household"), {
    person_scope: "household",
    estimated_expense_minor: plannedHousehold,
    total_expense_minor: 0,
    note: "Created from 2026-05 planning template."
  });
  assert.deepEqual(totals.map((row) => row.person_scope), ["household", "person-joyce", "person-tim"]);
});

test("a month duplicate that fails on the new month's totals copies no plan rows", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO monthly_snapshots/, { skip: 1 });

  await assert.rejects(duplicateMonthPlan(faulty.db, "2026-05"), /injected_failure_missing_table/);

  assertSameDatabase(await dumpDatabase(db), before);
});

test("a month reset that fails on the plan rows keeps the month's entries and plan", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM monthly_plan_rows/);

  await assert.rejects(resetMonthPlan(faulty.db, "2026-05"), /injected_failure_missing_table/);

  assertSameDatabase(await dumpDatabase(db), before);
});
