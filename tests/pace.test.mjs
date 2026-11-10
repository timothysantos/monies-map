// If this keeps up (src/domain/pace.ts; DOMAIN.md "Pace"): the design's
// November must give exactly $4,706.46 to $5,064.31 (shown $4,700 to
// $5,100), and $7,355.69 to $7,713.54 left (shown $7,350 to $7,750). Quiet
// when it should be, lumpy costs counted once, rounding outward.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPaceRange, everydayMinor, paceOneOffs, paceTotals, roundOutward, roundRange } from "../src/domain/pace.ts";

let counter = 0;
const entry = (date, amountMinor, inSeries = false) => ({ id: `p${(counter += 1)}`, date, amountMinor, inSeries });

// November 1 to 10: $1,350.80 of everyday spending, $309.20 of bills already
// paid, and the $480.00 aircon service on the 6th.
function novemberEntries() {
  const everyday = [];
  for (let day = 1; day <= 10; day += 1) {
    everyday.push(entry(`2026-11-${String(day).padStart(2, "0")}`, day === 10 ? 13_508 - 2 * 0 : 13_508));
  }
  return [
    ...everyday,
    entry("2026-11-01", 18_630, true),
    entry("2026-11-05", 7_850, true),
    entry("2026-11-03", 448, true),
    entry("2026-11-09", 3_992, true),
    entry("2026-11-06", 48_000)
  ];
}

const facts = (extra = {}) => ({
  month: "2026-11",
  today: "2026-11-10",
  entries: novemberEntries(),
  usualMonths: [
    { month: "2026-08", everydayMinor: 11_840 * 31, days: 31 },
    { month: "2026-09", everydayMinor: 11_840 * 30, days: 30 },
    { month: "2026-10", everydayMinor: 12_258 * 31, days: 31 }
  ],
  bills: [
    { key: "NETFLIX COM|monthly", name: "Netflix", date: "2026-11-14", lowMinor: 1_998, highMinor: 1_998 },
    { key: "SP SERVICES|monthly", name: "SP Group", date: "2026-11-18", lowMinor: 11_860, highMinor: 14_285 },
    { key: "SINGTEL MOBILE|monthly", name: "Singtel", date: "2026-11-22", lowMinor: 4_290, highMinor: 4_290 },
    { key: "SPOTIFY|monthly", name: "Spotify", date: "2026-11-27", lowMinor: 1_698, highMinor: 1_698 }
  ],
  incomeSoFarMinor: 0,
  incomeToCome: [{ name: "Salary", date: "2026-11-25", amountMinor: 1_242_000 }],
  monthsWithEntries: 12,
  importsBehind: false,
  ...extra
});

const spent = (list) => list.reduce((sum, item) => sum + item.amountMinor, 0);

test("the design's November: exact ends, shown rounded outward, and what is left", () => {
  const input = facts();
  assert.equal(spent(input.entries), 214_000);
  const range = buildPaceRange(input);
  assert.equal(range.daysLeft, 20);
  assert.equal(range.thisRateMinor, 13_508);
  assert.equal(range.usualRateMinor, 11_840);
  assert.equal(range.everydayLowMinor, 236_800);
  assert.equal(range.everydayHighMinor, 270_160);
  assert.equal(range.billsLowMinor, 19_846);
  assert.equal(range.billsHighMinor, 22_271);
  const totals = paceTotals(214_000, range);
  assert.equal(totals.lowMinor, 470_646);
  assert.equal(totals.highMinor, 506_431);
  assert.deepEqual(totals.shown, { lowMinor: 470_000, highMinor: 510_000 });
  assert.equal(totals.leftLowMinor, 735_569);
  assert.equal(totals.leftHighMinor, 771_354);
  assert.deepEqual(totals.leftShown, { lowMinor: 735_000, highMinor: 775_000 });
  assert.deepEqual(range.oneOffs.map((item) => item.amountMinor), [48_000]);
});

test("quiet: days 1 to 5, too little history, a past month, imports behind", () => {
  assert.deepEqual(buildPaceRange(facts({ today: "2026-11-05" })), { quiet: "early" });
  assert.deepEqual(buildPaceRange(facts({ monthsWithEntries: 2 })), { quiet: "history" });
  assert.deepEqual(buildPaceRange(facts({ usualMonths: facts().usualMonths.slice(1) })), { quiet: "history" });
  assert.deepEqual(buildPaceRange(facts({ month: "2026-10" })), { quiet: "past" });
  assert.deepEqual(buildPaceRange(facts({ importsBehind: true })), { quiet: "imports" });
  assert.ok("addLowMinor" in buildPaceRange(facts({ today: "2026-11-06" })));
});

test("a lumpy cost is counted once: the aircon moves both ends by exactly $480.00", () => {
  const withAircon = facts();
  const without = facts({ entries: novemberEntries().filter((item) => item.amountMinor !== 48_000) });
  const a = paceTotals(spent(withAircon.entries), buildPaceRange(withAircon));
  const b = paceTotals(spent(without.entries), buildPaceRange(without));
  assert.equal(a.lowMinor - b.lowMinor, 48_000);
  assert.equal(a.highMinor - b.highMinor, 48_000);
  // A $1,248.00 yearly insurance due on the 28th is added once on its day.
  const insured = facts({ bills: [...facts().bills, { key: "NTUC INCOME|yearly", name: "NTUC Income", date: "2026-11-28", lowMinor: 124_800, highMinor: 124_800 }] });
  assert.equal(paceTotals(214_000, buildPaceRange(insured)).lowMinor, 470_646 + 124_800);
  // Series charges and one-offs are not part of the everyday pace.
  assert.equal(everydayMinor(novemberEntries()), 135_080);
  assert.deepEqual(paceOneOffs([entry("2026-11-01", 1_000), entry("2026-11-02", 1_200), entry("2026-11-03", 1_100), entry("2026-11-05", 4_000), entry("2026-11-04", 4_000, true)]).map((item) => item.amountMinor), [4_000]);
});

test("two rates within 10% of each other widen to 10% either side of their middle", () => {
  const close = facts({ usualMonths: facts().usualMonths.map((month) => ({ ...month, everydayMinor: 13_000 * month.days })) });
  const range = buildPaceRange(close);
  const middle = (13_508 + 13_000) / 2;
  assert.equal(range.everydayLowMinor, Math.round(20 * middle * 0.9));
  assert.equal(range.everydayHighMinor, Math.round(20 * middle * 1.1));
});

test("Coming up's total: one amount rounds to its nearest step, never widened; a range rounds outward", () => {
  assert.deepEqual(roundRange(1_998, 1_998), { lowMinor: 2_000, highMinor: 2_000 });
  assert.deepEqual(roundRange(53_210, 53_210), { lowMinor: 53_000, highMinor: 53_000 });
  assert.deepEqual(roundRange(301, 301), { lowMinor: 1_000, highMinor: 1_000 });
  assert.deepEqual(roundRange(50_210, 53_990), { lowMinor: 50_000, highMinor: 54_000 });
});

test("rounding is outward at $10, $50 and $100", () => {
  assert.deepEqual(roundOutward(45_612, 51_201), { lowMinor: 45_000, highMinor: 52_000 });
  assert.deepEqual(roundOutward(470_646, 506_431), { lowMinor: 470_000, highMinor: 510_000 });
  assert.deepEqual(roundOutward(1_234_567, 1_345_678), { lowMinor: 1_230_000, highMinor: 1_350_000 });
});
