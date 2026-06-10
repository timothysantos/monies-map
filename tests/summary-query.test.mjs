import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSummaryAccountPillsParams,
  buildSummaryPageParams,
  buildSummaryPageView
} from "../src/client/summary-query.js";

test("buildSummaryPageParams keeps the summary route contract narrow", () => {
  assert.equal(
    buildSummaryPageParams({
      viewId: "person-tim",
      month: "2026-04",
      scope: "direct_plus_shared",
      summaryStart: "2025-06",
      summaryEnd: "2026-04"
    }).toString(),
    "view=person-tim&month=2026-04&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-04"
  );
});

test("buildSummaryAccountPillsParams only keys the visible view", () => {
  assert.equal(
    buildSummaryAccountPillsParams({ viewId: "household" }).toString(),
    "view=household"
  );
});

test("buildSummaryPageView merges wallet pills into the summary render view", () => {
  const view = buildSummaryPageView({
    appShell: {
      household: {
        people: [{ id: "person-tim", name: "Tim" }]
      }
    },
    selectedViewId: "person-tim",
    summaryPageData: {
      viewId: "person-tim",
      label: "Tim",
      summaryPage: {
        metricCards: [],
        availableMonths: ["2026-04"],
        rangeStartMonth: "2026-04",
        rangeEndMonth: "2026-04",
        rangeMonths: ["2026-04"],
        months: [],
        categoryShareChart: [],
        categoryShareByMonth: [],
        notes: []
      }
    },
    summaryAccountPillsData: {
      accountPills: [{ accountId: "acc-1", accountName: "UOB One", ownerLabel: "Tim", balanceMinor: 100 }]
    }
  });

  assert.deepEqual(view.summaryPage.accountPills, [
    { accountId: "acc-1", accountName: "UOB One", ownerLabel: "Tim", balanceMinor: 100 }
  ]);
});
