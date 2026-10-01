// A card statement prints its closing date but not the day its cycle opened.
// The cycle opens the day after the previous month's statement date, so the
// statement period covers rows that posted before the first printed row.
import assert from "node:assert/strict";
import test from "node:test";

import { estimateMonthlyStatementCycleStartDate } from "../src/lib/statement-import/shared.ts";

test("a cycle opens the day after the same date a month earlier", () => {
  assert.equal(estimateMonthlyStatementCycleStartDate("2026-05-12"), "2026-04-13");
  assert.equal(estimateMonthlyStatementCycleStartDate("2026-09-01"), "2026-08-02");
});

test("a month-end statement date is clamped to the shorter previous month", () => {
  // 31 Mar closes the cycle that opened after 28 Feb.
  assert.equal(estimateMonthlyStatementCycleStartDate("2026-03-31"), "2026-03-01");
  assert.equal(estimateMonthlyStatementCycleStartDate("2028-03-30"), "2028-03-01");
});

test("a January statement opens in December of the previous year", () => {
  assert.equal(estimateMonthlyStatementCycleStartDate("2027-01-10"), "2026-12-11");
});

test("an earlier printed row moves the start back so no row falls before it", () => {
  assert.equal(estimateMonthlyStatementCycleStartDate("2026-05-12", "2026-04-10"), "2026-04-10");
  // A later first row never narrows the cycle.
  assert.equal(estimateMonthlyStatementCycleStartDate("2026-05-12", "2026-04-15"), "2026-04-13");
});
