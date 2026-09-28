// Summary's Money insights load with one dynamic import beside the Summary
// route (route-modules.js starts it; the panel never waits). Every caller
// shares the one promise, and the module carries what the panel reads.
import assert from "node:assert/strict";
import test from "node:test";

import { loadSummaryInsights } from "../src/client/money-insights-loader.js";

test("the Summary insights module loads once and carries the signals, schedule and calm lines", async () => {
  const [first, second] = await Promise.all([loadSummaryInsights(), loadSummaryInsights()]);
  assert.equal(first, second);
  assert.equal(typeof first.buildSummarySignals, "function");
  assert.equal(first.SUMMARY_CALM_LINES.length, 12);
  assert.equal(first.SUMMARY_TRIVIA_ROTATION.columns.length, 12);
  assert.equal(await loadSummaryInsights(), first);
});
