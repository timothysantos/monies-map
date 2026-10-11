import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSummaryEntriesLocation,
  buildSummaryMutationRefreshPlan
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

// Opening a month from Summary is the Summary tab's month choice:
// tests/summary-month-choice.test.mjs.

test("summary mutation refresh plans keep note saves and drilldown returns narrow", () => {
  assert.deepEqual(buildSummaryMutationRefreshPlan({ kind: "note-save" }), {
    invalidateMonth: true,
    invalidateSummary: true,
    refreshShell: false
  });
  assert.deepEqual(buildSummaryMutationRefreshPlan({ kind: "drilldown-return" }), {
    invalidateMonth: false,
    invalidateSummary: true,
    refreshShell: false
  });
  assert.deepEqual(buildSummaryMutationRefreshPlan({ kind: "filter-only" }), {
    invalidateMonth: false,
    invalidateSummary: false,
    refreshShell: false
  });
});
