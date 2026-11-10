// If this keeps up, the year (owner decision D7; DOMAIN.md "Pace"): what is
// kept by 31 Dec, Summary only, from April. Kept so far this year, plus this
// month's "left" range, plus each month still to come at the second-lowest
// to second-highest kept amount of the last 6 complete months (the middle
// four), so one bonus or one costly month never sets it.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPaceRange, yearEndKept } from "../src/domain/pace.ts";
import { paceYearWords } from "../src/client/pace-line-model.js";
import { paceCopy } from "../src/client/copy/pace-copy.js";
import { findAppJargon, findPaceProblems, findToneProblems } from "../src/domain/money-signals/tone.ts";

// January to April at $2,800 to $3,100 kept; May to October with a bonus in
// July ($9,000) and a costly August (-$500).
const KEPT = {
  "2026-01": 280_000, "2026-02": 290_000, "2026-03": 300_000, "2026-04": 310_000,
  "2026-05": 300_000, "2026-06": 320_000, "2026-07": 900_000, "2026-08": -50_000, "2026-09": 310_000, "2026-10": 330_000
};
const months = (kept = KEPT) => Object.entries(kept).map(([month, keptMinor]) => ({ month, keptMinor }));

test("November: kept so far, this month's left, and December at the middle four of May to October", () => {
  const year = yearEndKept(months(), "2026-11", 735_569, 771_354);
  assert.equal(year.year, "2026");
  assert.equal(year.keptSoFarMinor, 3_290_000);
  // Sorted: -$500, $3,000, $3,100, $3,200, $3,300, $9,000: the bonus and the costly month are left out.
  assert.equal(year.secondLowestMinor, 300_000);
  assert.equal(year.secondHighestMinor, 330_000);
  assert.equal(year.monthsLeft, 1);
  assert.equal(year.lowMinor, 3_290_000 + 735_569 + 300_000);
  assert.equal(year.highMinor, 3_290_000 + 771_354 + 330_000);
  assert.deepEqual(year.shown, { lowMinor: 4_320_000, highMinor: 4_400_000 });
});

test("the April gate: nothing in January to March; April counts 8 months still to come", () => {
  const history = { "2025-10": 200_000, "2025-11": 210_000, "2025-12": 600_000, "2026-01": 220_000, "2026-02": 0, "2026-03": 230_000 };
  assert.equal(yearEndKept(months(history), "2026-03", 100_000, 150_000), null);
  assert.equal(yearEndKept(months(history), "2026-01", 100_000, 150_000), null);
  const april = yearEndKept(months(history), "2026-04", 100_000, 150_000);
  assert.equal(april.monthsLeft, 8);
  // Sorted: $0, $2,000, $2,100, $2,200, $2,300, $6,000.
  assert.equal(april.secondLowestMinor, 200_000);
  assert.equal(april.secondHighestMinor, 230_000);
  assert.equal(april.keptSoFarMinor, 450_000);
  assert.equal(april.lowMinor, 450_000 + 100_000 + 8 * 200_000);
  assert.equal(april.highMinor, 450_000 + 150_000 + 8 * 230_000);
});

test("quiet with a gap: a month missing from this year or the last 6, or fewer than 6 months", () => {
  const withoutFeb = { ...KEPT };
  delete withoutFeb["2026-02"];
  assert.equal(yearEndKept(months(withoutFeb), "2026-11", 735_569, 771_354), null);
  const withoutSep = { ...KEPT };
  delete withoutSep["2026-09"];
  assert.equal(yearEndKept(months(withoutSep), "2026-11", 735_569, 771_354), null);
  assert.equal(yearEndKept(months({ "2026-01": 1, "2026-02": 2, "2026-03": 3 }), "2026-04", 0, 0), null);
});

// The design's November pace (tests/pace.test.mjs): $7,355.69 to $7,713.54 left.
function novemberPace() {
  let id = 0;
  const entry = (date, amountMinor, inSeries = false) => ({ id: `y${(id += 1)}`, date, amountMinor, inSeries });
  const entries = [];
  for (let day = 1; day <= 10; day += 1) entries.push(entry(`2026-11-${String(day).padStart(2, "0")}`, 13_508));
  entries.push(entry("2026-11-01", 18_630, true), entry("2026-11-05", 7_850, true), entry("2026-11-03", 448, true), entry("2026-11-09", 3_992, true), entry("2026-11-06", 48_000));
  const range = buildPaceRange({
    month: "2026-11",
    today: "2026-11-10",
    entries,
    usualMonths: [
      { month: "2026-08", everydayMinor: 11_840 * 31, days: 31 },
      { month: "2026-09", everydayMinor: 11_840 * 30, days: 30 },
      { month: "2026-10", everydayMinor: 12_258 * 31, days: 31 }
    ],
    bills: [
      { key: "a", name: "Netflix", date: "2026-11-14", lowMinor: 1_998, highMinor: 1_998 },
      { key: "b", name: "SP Group", date: "2026-11-18", lowMinor: 11_860, highMinor: 14_285 },
      { key: "c", name: "Singtel", date: "2026-11-22", lowMinor: 4_290, highMinor: 4_290 },
      { key: "d", name: "Spotify", date: "2026-11-27", lowMinor: 1_698, highMinor: 1_698 }
    ],
    incomeSoFarMinor: 0,
    incomeToCome: [{ name: "Salary", date: "2026-11-25", amountMinor: 1_242_000 }],
    monthsWithEntries: 12,
    importsBehind: false
  });
  return { month: "2026-11", range, spentSoFarMinor: 214_000 };
}
const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);
const summaryMonths = (kept = KEPT) => Object.entries(kept).map(([month, realDiffMinor]) => ({ month, realDiffMinor }));

test("Summary's year line: the same sums from Summary's months, and nothing when quiet or nothing comes in", () => {
  const pace = novemberPace();
  const line = paceYearWords({ pace, spentSoFarMinor: 214_000, months: summaryMonths(), money });
  assert.equal(line, "If this keeps up, about $43,200 to $44,000 kept in 2026 by 31 Dec.");
  assert.deepEqual([...findPaceProblems(line), ...findToneProblems(line), ...findAppJargon(line)], []);
  assert.equal(paceCopy.year("$43,200", "$44,000", "2026"), line);
  // A range that starts after January: quiet.
  const fromMay = Object.fromEntries(Object.entries(KEPT).filter(([month]) => month >= "2026-05"));
  assert.equal(paceYearWords({ pace, spentSoFarMinor: 214_000, months: summaryMonths(fromMay), money }), "");
  // Nothing comes in this month: no "left", so no year either.
  const noIncome = { ...pace, range: { ...pace.range, incomeMinor: 0 } };
  assert.equal(paceYearWords({ pace: noIncome, spentSoFarMinor: 214_000, months: summaryMonths(), money }), "");
  // March: before the April gate.
  assert.equal(paceYearWords({ pace: { ...pace, month: "2026-03" }, spentSoFarMinor: 214_000, months: summaryMonths(), money }), "");
});
