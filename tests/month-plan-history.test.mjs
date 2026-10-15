// Plan history (DOMAIN.md "Plan history"): what Plan Studio's slider popover
// says about a row's past, carried on the Month page as one small tuple per
// plan row, [last month's plan, last month's actual, the average actual of
// the previous three months, how many of those months had the row]. It is
// built from the same row and entry rules as each past month's own Month page,
// so last month's figures equal what that page shows.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { buildMonthPageDto } from "../src/domain/pages/month-page.ts";
import { attachPlanHistory, historyMonthsFor, planRowHistoryKey } from "../src/domain/month-plan-history.ts";

const row = (id, label, categoryName, plannedMinor, actualMinor, extra = {}) => ({
  id, section: "budget_buckets", label, categoryName, plannedMinor, actualMinor, ownershipType: "direct", splits: [], ...extra
});

test("the three months before a month, most recent first, across a year end", () => {
  assert.deepEqual(historyMonthsFor("2026-05"), ["2026-04", "2026-03", "2026-02"]);
  assert.deepEqual(historyMonthsFor("2026-01"), ["2025-12", "2025-11", "2025-10"]);
});

test("a row matches by category and name, ignoring case", () => {
  assert.equal(planRowHistoryKey({ categoryName: "Food & Drinks", label: " Food " }), planRowHistoryKey({ categoryName: "food & drinks", label: "food" }));
  assert.notEqual(planRowHistoryKey({ categoryName: "Food", label: "Food" }), planRowHistoryKey({ categoryName: "Food", label: "Lunch" }));
});

test("history carries last month's plan and actual and the average actual of the months that had the row", () => {
  const current = { incomeRows: [], planRows: [row("now-food", "Food", "Food", 70_000, 0)] };
  const past = [
    { month: "2026-04", incomeRows: [], planRows: [row("a-food", "Food", "Food", 60_000, 55_000)] },
    { month: "2026-03", incomeRows: [], planRows: [row("m-food", "Food", "Food", 60_000, 65_000)] },
    { month: "2026-02", incomeRows: [], planRows: [] }
  ];
  const result = attachPlanHistory(current, past, "2026-05");
  assert.deepEqual(result.planRows[0].history, [60_000, 55_000, 60_000, 2]);
});

test("a row new this month has no history, and a row last seen two months ago has an average but no last month", () => {
  const current = { incomeRows: [], planRows: [row("a", "Gym", "Health", 5_000, 0), row("b", "Course", "Learning", 9_000, 0)] };
  const past = [
    { month: "2026-04", incomeRows: [], planRows: [] },
    { month: "2026-03", incomeRows: [], planRows: [row("c", "Course", "Learning", 8_000, 7_000)] }
  ];
  const result = attachPlanHistory(current, past, "2026-05");
  assert.equal(result.planRows[0].history, undefined, "no tuple when no past month had the row");
  assert.deepEqual(result.planRows[1].history, [null, null, 7_000, 1]);
});

test("income rows get history by owner label and the Savings line keeps its plan but no actual", () => {
  const current = {
    incomeRows: [{ id: "i1", label: "Salary", categoryName: "Salary", ownerName: "Tim", plannedMinor: 500_000, actualMinor: 0 }],
    planRows: [row("s1", "Savings", "Savings", 150_000, 0, { section: "planned_items" })]
  };
  const past = [{
    month: "2026-04",
    incomeRows: [{ id: "i0", label: "Salary", categoryName: "Salary", ownerName: "Tim", plannedMinor: 480_000, actualMinor: 481_000 }],
    planRows: [row("s0", "Savings", "Savings", 140_000, 90_000, { section: "planned_items" })]
  }];
  const result = attachPlanHistory(current, past, "2026-05");
  assert.deepEqual(result.incomeRows[0].history, [480_000, 481_000, 481_000, 1]);
  assert.deepEqual(result.planRows[0].history, [140_000, null, null, 0]);
});

test("the Month page DTO carries history that equals last month's own Month page (September against August)", async (t) => {
  const template = await createSeededTemplate();
  t.after(() => template.dispose());
  const { db } = await openSeededDatabase(t, template);
  const september = (await buildMonthPageDto(db, "person-tim", "2025-09", "direct_plus_shared")).monthPage;
  const august = (await buildMonthPageDto(db, "person-tim", "2025-08", "direct_plus_shared")).monthPage;
  const augustByKey = new Map(august.planSections.flatMap((section) => section.rows).map((r) => [planRowHistoryKey(r), r]));
  const withHistory = september.planSections.flatMap((section) => section.rows).filter((r) => r.history);
  assert.ok(withHistory.length >= 3, "the demo household has rows in both months");
  let compared = 0;
  for (const r of withHistory) {
    const last = augustByKey.get(planRowHistoryKey(r));
    if (!last || r.label === "Savings") continue;
    assert.equal(r.history[0], last.plannedMinor, `${r.label}: last month's plan`);
    assert.equal(r.history[1], last.actualMinor, `${r.label}: last month's actual`);
    compared += 1;
  }
  assert.ok(compared >= 3, "at least three rows compared against August's page");
  // The first month of the data has nothing before it.
  const earliest = (await buildMonthPageDto(db, "person-tim", "2025-06", "direct_plus_shared")).monthPage;
  assert.equal(earliest.planSections.flatMap((section) => section.rows).filter((r) => r.history).length, 0);
});

test("a month that is not tracked is never read: the page for a far-past month has no history", async (t) => {
  const template = await createSeededTemplate();
  t.after(() => template.dispose());
  const { db } = await openSeededDatabase(t, template);
  const page = (await buildMonthPageDto(db, "household", "2020-01", "direct_plus_shared")).monthPage;
  assert.equal(page.planSections.flatMap((section) => section.rows).filter((r) => r.history).length, 0);
});
