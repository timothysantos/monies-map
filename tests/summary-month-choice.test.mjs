import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";

import {
  buildMonthSheetModel,
  buildSummaryMonthChoiceLocation,
  clampMonthToRange,
  readPinnedSummaryRange,
  stepMonthInRange
} from "../src/client/summary-month-choice.js";
import { buildSummaryPageParams, seedPinnedSummaryPage } from "../src/client/summary-query.js";
import { summaryPageKeyFromParams } from "../src/client/query-keys.js";

const RANGE = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02"];

test("picking a month opens Month for it and pins the range on screen", () => {
  assert.deepEqual(
    buildSummaryMonthChoiceLocation(
      "?view=person-tim&month=2026-02&scope=direct&summary_focus=2026-01",
      "2025-12",
      { startMonth: "2025-10", endMonth: "2026-02" }
    ),
    {
      pathname: "/month",
      search: "?view=person-tim&month=2025-12&scope=direct&summary_start=2025-10&summary_end=2026-02"
    }
  );
});

test("All months returns to Summary with the same range and keeps the last month", () => {
  assert.deepEqual(
    buildSummaryMonthChoiceLocation(
      "?view=household&month=2025-12&scope=direct_plus_shared&summary_start=2025-10&summary_end=2026-02",
      "",
      { startMonth: "2025-10", endMonth: "2026-02" }
    ),
    {
      pathname: "/summary",
      search: "?view=household&month=2025-12&scope=direct_plus_shared&summary_start=2025-10&summary_end=2026-02"
    }
  );
});

test("a month choice without a known range leaves the URL's range alone", () => {
  const location = buildSummaryMonthChoiceLocation("?view=household&month=2026-02", "2026-01", null);
  assert.equal(location.search, "?view=household&month=2026-01");
  // Half a range is not a range: nothing is pinned from it.
  assert.equal(
    buildSummaryMonthChoiceLocation("?view=household", "2026-01", { startMonth: "2025-10", endMonth: "" }).search,
    "?view=household&month=2026-01"
  );
});

test("readPinnedSummaryRange needs both bounds", () => {
  assert.deepEqual(
    readPinnedSummaryRange(new URLSearchParams("summary_start=2025-10&summary_end=2026-02")),
    { startMonth: "2025-10", endMonth: "2026-02" }
  );
  assert.equal(readPinnedSummaryRange(new URLSearchParams("summary_start=2025-10")), null);
  assert.equal(readPinnedSummaryRange(new URLSearchParams("")), null);
});

test("the month arrows step within the range and stop at its ends", () => {
  assert.equal(stepMonthInRange(RANGE, "2025-12", -1), "2025-11");
  assert.equal(stepMonthInRange(RANGE, "2025-12", 1), "2026-01");
  assert.equal(stepMonthInRange(RANGE, "2025-10", -1), "");
  assert.equal(stepMonthInRange(RANGE, "2026-02", 1), "");
  // A month outside the range has no neighbours in it.
  assert.equal(stepMonthInRange(RANGE, "2024-05", 1), "");
});

test("a picked month that leaves a new range moves to the nearest month in it", () => {
  assert.equal(clampMonthToRange("2025-12", RANGE), "2025-12");
  assert.equal(clampMonthToRange("2025-09", RANGE), "2025-10");
  assert.equal(clampMonthToRange("2026-05", RANGE), "2026-02");
  assert.equal(clampMonthToRange("2025-11", ["2025-06", "2025-10", "2026-05"]), "2025-10");
  assert.equal(clampMonthToRange("2025-11", []), "2025-11");
});

test("the month sheet shows spend against plan, newest first, rose only over plan", () => {
  const model = buildMonthSheetModel([
    { month: "2025-11", realExpensesMinor: 121_826, estimatedExpensesMinor: 300_896 },
    { month: "2025-12", realExpensesMinor: 126_471, estimatedExpensesMinor: 0 },
    { month: "2026-01", realExpensesMinor: 442_849, estimatedExpensesMinor: 300_896 },
    { month: "2026-02", realExpensesMinor: 0, estimatedExpensesMinor: 0 }
  ]);
  assert.deepEqual(model.total, {
    actualMinor: 691_146,
    plannedMinor: 601_792,
    barPercent: 100,
    tone: "short",
    toneClass: "money-short",
    isOver: true
  });
  assert.deepEqual(model.years.map((year) => year.year), ["2026", "2025"]);
  assert.deepEqual(model.years[0].months.map((month) => month.month), ["2026-02", "2026-01"]);
  assert.deepEqual(model.years[1].months.map((month) => month.month), ["2025-12", "2025-11"]);
  const [february, january] = model.years[0].months;
  const [december, november] = model.years[1].months;
  assert.deepEqual(november, { month: "2025-11", actualMinor: 121_826, plannedMinor: 300_896, barPercent: 40, tone: "neutral", toneClass: "money-neutral", isOver: false });
  assert.deepEqual(january, { month: "2026-01", actualMinor: 442_849, plannedMinor: 300_896, barPercent: 100, tone: "short", toneClass: "money-short", isOver: true });
  // Spending with no plan is over plan, as the Summary month cards show it.
  assert.equal(december.isOver, true);
  assert.equal(december.barPercent, 100);
  // Nothing spent and nothing planned is an empty, neutral bar.
  assert.deepEqual(february, { month: "2026-02", actualMinor: 0, plannedMinor: 0, barPercent: 0, tone: "neutral", toneClass: "money-neutral", isOver: false });
});

test("an empty range gives an empty sheet, not an error", () => {
  assert.deepEqual(buildMonthSheetModel([]), {
    total: { actualMinor: 0, plannedMinor: 0, barPercent: 0, tone: "neutral", toneClass: "money-neutral", isOver: false },
    years: []
  });
});

test("a pinned Summary request names the range end, so every month of a range shares one cache entry", () => {
  const forMonth = (month) => buildSummaryPageParams({
    viewId: "household",
    month,
    scope: "direct_plus_shared",
    summaryStart: "2025-10",
    summaryEnd: "2026-02"
  }).toString();
  assert.equal(forMonth("2025-11"), "view=household&month=2026-02&scope=direct_plus_shared&summary_start=2025-10&summary_end=2026-02");
  assert.equal(forMonth("2025-11"), forMonth("2026-01"));
  // An implicit range still anchors on the month.
  assert.equal(
    buildSummaryPageParams({ viewId: "household", month: "2025-11", scope: "direct_plus_shared" }).toString(),
    "view=household&month=2025-11&scope=direct_plus_shared"
  );
});

test("pinning the range reuses the loaded Summary page instead of fetching it again", () => {
  const queryClient = new QueryClient();
  const loadedParams = buildSummaryPageParams({ viewId: "household", month: "2026-02", scope: "direct_plus_shared" });
  const pinnedParams = buildSummaryPageParams({
    viewId: "household",
    month: "2025-12",
    scope: "direct_plus_shared",
    summaryStart: "2025-10",
    summaryEnd: "2026-02"
  });
  const page = { viewId: "household", summaryPage: { rangeStartMonth: "2025-10", rangeEndMonth: "2026-02" } };

  // Nothing loaded yet: nothing to reuse.
  assert.equal(seedPinnedSummaryPage(queryClient, loadedParams, pinnedParams), false);
  assert.equal(queryClient.getQueryData(summaryPageKeyFromParams(pinnedParams)), undefined);

  queryClient.setQueryData(summaryPageKeyFromParams(loadedParams), page);
  assert.equal(seedPinnedSummaryPage(queryClient, loadedParams, pinnedParams), true);
  assert.deepEqual(queryClient.getQueryData(summaryPageKeyFromParams(pinnedParams)), page);

  // A pinned page already cached (perhaps fresher) is never replaced.
  const fresher = { ...page, label: "fresher" };
  queryClient.setQueryData(summaryPageKeyFromParams(pinnedParams), fresher);
  assert.equal(seedPinnedSummaryPage(queryClient, loadedParams, pinnedParams), false);
  assert.deepEqual(queryClient.getQueryData(summaryPageKeyFromParams(pinnedParams)), fresher);
});
