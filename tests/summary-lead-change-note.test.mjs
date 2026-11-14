// The lead card's change note is written out in summary-lead-model.js so no
// module is shared with the lazy Spending mix chunk (the first-screen file
// budget). It must give exactly the answers of Spending mix's own note and
// words (spend-change-model.js, spending-mix-copy.js).
import assert from "node:assert/strict";
import test from "node:test";

import { spendingMixCopy } from "../src/client/copy/spending-mix-copy.js";
import { buildSpendChangeNote } from "../src/client/spend-change-model.js";
import { buildLeadChangeNote } from "../src/client/summary-lead-model.js";

const CASES = [
  { months: 6, currentMinor: 500_000, previousMinor: 530_000, partial: false },
  { months: 1, currentMinor: 130_000, previousMinor: 100_000, partial: false },
  { months: 11, currentMinor: 900_000, previousMinor: 1_000_000, partial: true },
  { months: 3, currentMinor: 300_000, previousMinor: 300_000, partial: false },
  { months: 3, currentMinor: 300_400, previousMinor: 300_000, partial: false },
  { months: 2, currentMinor: 90_000, previousMinor: 9_999, partial: false },
  { months: 2, currentMinor: 90_000, previousMinor: 10_000, partial: true },
  { months: 1, currentMinor: 0, previousMinor: 20_000, partial: false }
];

test("the lead note is Spending mix's note and words for every case, including the ones that say nothing", () => {
  for (const spendChange of CASES) {
    const mine = buildLeadChangeNote(spendChange);
    const theirs = buildSpendChangeNote(spendChange);
    if (!theirs) {
      assert.equal(mine, null, JSON.stringify(spendChange));
      continue;
    }
    assert.deepEqual(mine, { arrow: theirs.arrow, percent: theirs.percent, tone: theirs.tone, words: spendingMixCopy.changeVs(spendChange.months, spendChange.partial) }, JSON.stringify(spendChange));
  }
});

test("the lead note shows nothing with no history, or with money hidden", () => {
  assert.equal(buildLeadChangeNote(undefined), null);
  assert.equal(buildLeadChangeNote(CASES[0], { hidden: true }), null);
  assert.deepEqual(buildLeadChangeNote(CASES[1]), { arrow: "▲", percent: 30, tone: "rose", words: "vs the month before" });
  assert.deepEqual(buildLeadChangeNote(CASES[0]), { arrow: "▼", percent: 6, tone: "mint", words: "vs the 6 months before" });
});
