// Money jobs on the real Worker (DOMAIN.md "Money job"): the Summary page's
// "Planned investments" card is the range's Investments plan rows (a row
// labelled "Savings" is the savings target, never an investment), the same
// rows the Month page sends in its plan sections; what was invested is the
// Investments slice of the category share both pages already send. The
// planned month totals never carry the investment goal per month.
// Real local D1 (Miniflare) seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { plannedInvestMinor } from "../src/domain/money-job-plan.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

async function savePlanRow(api, row) {
  const { status, payload } = await api("/api/month-plan/save", {
    sectionKey: "planned_items",
    planDate: null,
    accountName: "",
    note: "",
    ownershipType: "direct",
    ownerName: "Tim",
    ...row
  });
  assert.equal(status, 200, JSON.stringify(payload));
}

const card = (page, label) => page.summaryPage.metricCards.find((item) => item.label === label)?.amountMinor;
const slice = (chart, label) => chart.find((item) => item.label === label)?.valueMinor ?? 0;
const planRows = (monthPage) => monthPage.monthPage.planSections.flatMap((section) => section.rows);

test("the Summary's planned investments are the range's Investments plan rows, and what was invested is the category share", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const before = await get(api, "/api/summary-page?view=person-tim&month=2026-05&scope=direct_plus_shared&summary_start=2025-10&summary_end=2026-05");
  assert.deepEqual(before.summaryPage.rangeMonths, ["2025-10", "2026-05"], "the demo tracks both months");
  assert.equal(card(before, "Planned investments"), 0, "the demo plans no investing in these months");

  await savePlanRow(api, { rowId: "money-jobs-ifast-05", month: "2026-05", categoryName: "Investments", label: "iFAST", plannedMinor: 150_000 });
  await savePlanRow(api, { rowId: "money-jobs-stashaway-10", month: "2025-10", categoryName: "Investments", label: "Stashaway", plannedMinor: 45_000 });
  // The savings target's own row, filed under Investments by mistake, stays the savings target.
  await savePlanRow(api, { rowId: "money-jobs-savings-05", month: "2026-05", categoryName: "Investments", label: "Savings", plannedMinor: 70_000 });
  await createEntry(api, { date: "2026-05-03", description: "iFAST GIRO", categoryName: "Investments", amountMinor: 120_000 });

  const summary = await get(api, "/api/summary-page?view=person-tim&month=2026-05&scope=direct_plus_shared&summary_start=2025-10&summary_end=2026-05");
  assert.equal(card(summary, "Planned investments"), 195_000);
  assert.equal(slice(summary.summaryPage.categoryShareChart, "Investments"), 120_000);
  assert.equal(card(summary, "Savings target") - card(before, "Savings target"), 70_000, "a Savings row is the savings target");
  for (const month of summary.summaryPage.months) {
    assert.equal("plannedInvestMinor" in month, false, `${month.month} carries no per-month investment goal`);
  }

  // The Month page sends the same rows and slice; the client sums them alike.
  const may = await get(api, "/api/month-page?view=person-tim&month=2026-05&scope=direct_plus_shared");
  assert.equal(plannedInvestMinor(planRows(may)), 150_000);
  assert.equal(slice(may.monthPage.categoryShareChart, "Investments"), 120_000);
  assert.equal("plannedInvestMinor" in may.summaryPage.months[0], false);

  // A range without those months plans no investing.
  const earlier = await get(api, "/api/summary-page?view=person-tim&month=2025-09&scope=direct_plus_shared&summary_start=2025-09&summary_end=2025-09");
  assert.equal(card(earlier, "Planned investments"), 0);
});
