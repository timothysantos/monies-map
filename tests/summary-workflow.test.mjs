import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSummaryEntriesLocation,
  buildSummaryMonthLocation,
  SUMMARY_FOCUS_OVERALL
} from "../src/client/summary-workflow.js";

test("summary drilldown to entries keeps range context and replaces stale entry filters", () => {
  const location = buildSummaryEntriesLocation(
    "?view=household&month=2026-05&summary_start=2025-06&summary_end=2026-05&summary_focus=2025-10&entry_wallet=old-wallet",
    {
      entry_category: "Groceries",
      month: "2025-10"
    }
  );

  assert.deepEqual(location, {
    pathname: "/entries",
    search: "?view=household&month=2025-10&summary_start=2025-06&summary_end=2026-05&summary_focus=2025-10&entry_category=Groceries"
  });
});

test("summary drilldown to month keeps the surrounding summary route context", () => {
  const location = buildSummaryMonthLocation(
    "?view=household&month=2026-05&summary_start=2025-06&summary_end=2026-05&summary_focus=2025-10",
    "2025-10"
  );

  assert.deepEqual(location, {
    pathname: "/month",
    search: "?view=household&month=2025-10&summary_start=2025-06&summary_end=2026-05&summary_focus=2025-10"
  });
});

test("summary overall focus token stays explicit and shared", () => {
  assert.equal(SUMMARY_FOCUS_OVERALL, "overall");
});
