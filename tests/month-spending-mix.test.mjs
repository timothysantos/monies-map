// Spending Mix for a picked month. The Summary tab's month choice drives it:
// All months shows the range (the Summary page's categoryShareChart), a
// picked month shows that month from the Month page DTO it already loaded
// (monthPage.categoryShareChart), with no request of its own. That share is
// the same projection as the Summary page's categoryShareByMonth entry for
// the month, which the D1 test below holds for every view and scope.
import assert from "node:assert/strict";
import test from "node:test";

import { selectMonthSpendingMix } from "../src/client/month-spending-mix.js";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

const SEPTEMBER_SHARE = [
  { key: "Groceries", categoryId: "cat-groceries", label: "Groceries", valueMinor: 42_150, entryCount: 6 },
  { key: "Transport", categoryId: "cat-transport", label: "Transport", valueMinor: 9_800, entryCount: 4 },
  { key: "Shopping", categoryId: "cat-shopping", label: "Shopping", valueMinor: 2_050, entryCount: 1 }
];

test("a picked month's Spending Mix is that month's category share with its total", () => {
  const mix = selectMonthSpendingMix({ month: "2025-09", categoryShareChart: SEPTEMBER_SHARE });
  assert.deepEqual(mix, {
    month: "2025-09",
    data: SEPTEMBER_SHARE,
    totalMinor: 54_000,
    isEmpty: false
  });
  // The categories keep the projection's order (largest first) and keys, which
  // the category cards and their drilldowns read.
  assert.deepEqual(mix.data.map((item) => item.label), ["Groceries", "Transport", "Shopping"]);
});

test("switching months gives the new month's share, never the previous month's", () => {
  const september = selectMonthSpendingMix({ month: "2025-09", categoryShareChart: SEPTEMBER_SHARE });
  const october = selectMonthSpendingMix({
    month: "2025-10",
    categoryShareChart: [{ key: "Dining", label: "Dining", valueMinor: 7_500, entryCount: 3 }]
  });
  assert.equal(october.month, "2025-10");
  assert.equal(october.totalMinor, 7_500);
  assert.deepEqual(october.data.map((item) => item.label), ["Dining"]);
  assert.notDeepEqual(october.data, september.data);
});

test("a month with no spending is empty with a zero total, so the section shows its empty state", () => {
  assert.deepEqual(selectMonthSpendingMix({ month: "2025-08", categoryShareChart: [] }), {
    month: "2025-08",
    data: [],
    totalMinor: 0,
    isEmpty: true
  });
});

test("a Month page still hydrating (no category share yet) reads as empty, not as a broken chart", () => {
  assert.deepEqual(selectMonthSpendingMix({ month: "2025-08" }), { month: "2025-08", data: [], totalMinor: 0, isEmpty: true });
  assert.deepEqual(selectMonthSpendingMix(undefined), { month: "", data: [], totalMinor: 0, isEmpty: true });
  assert.deepEqual(selectMonthSpendingMix({ month: "2025-08", categoryShareChart: null }).data, []);
});

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("the Month page's category share equals the Summary page's share for that month in every view and scope", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const get = async (pathname) => {
    const response = await api(pathname);
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    return response.payload;
  };
  const start = "2026-02";
  const end = "2026-05";
  let comparedMonths = 0;
  let emptyMonths = 0;
  for (const view of ["household", "person-tim", "person-joyce"]) {
    for (const scope of ["direct", "shared", "direct_plus_shared"]) {
      const { summaryPage } = await get(`/api/summary-page?view=${view}&month=${end}&scope=${scope}&summary_start=${start}&summary_end=${end}`);
      assert.ok(summaryPage.rangeMonths.length >= 3, `${view} ${scope}: the range has months`);
      for (const month of summaryPage.rangeMonths) {
        const { monthPage } = await get(`/api/month-page?view=${view}&month=${month}&scope=${scope}`);
        const summaryShare = summaryPage.categoryShareByMonth.find((item) => item.month === month)?.data;
        assert.ok(summaryShare, `${view} ${scope} ${month}: Summary has the month's share`);
        const mix = selectMonthSpendingMix(monthPage);
        assert.equal(mix.month, month);
        assert.deepEqual(mix.data, summaryShare, `${view} ${scope} ${month}: Month and Summary agree`);
        comparedMonths += 1;
        emptyMonths += mix.isEmpty ? 1 : 0;
      }
    }
  }
  assert.ok(comparedMonths >= 27, `compared ${comparedMonths} months`);
  // A person's Shared scope in the seed has months with no spending at all:
  // the empty case is compared too, not only months with categories.
  assert.ok(emptyMonths > 0, "some compared months have no spending");
  assert.ok(emptyMonths < comparedMonths, "most compared months have spending");
});
