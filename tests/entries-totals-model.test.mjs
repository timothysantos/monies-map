import assert from "node:assert/strict";
import test from "node:test";

import { buildEntriesTotalsModel, describeEntryFilters } from "../src/client/entries-totals-model.js";

// The figures entry-totals.js computes for a view: gross is the whole
// amount, the plain figure is the viewed person's share of it.
function totals(overrides = {}) {
  return {
    grossSpendMinor: 167_927,
    spendMinor: 136_925,
    incomeMinor: 830_000,
    grossTransferOutMinor: 599_342,
    transferOutMinor: 599_342,
    ...overrides
  };
}

const INPUT = {
  entryTotals: totals(),
  entryOutflowMinor: 736_267,
  entryGrossOutflowMinor: 767_269,
  entryNetMinor: 693_075,
  month: "2026-08",
  personLabel: "Ethan"
};

test("the lead is Spent for the month with the person's share as its aside; the pills keep the strip's figures", () => {
  assert.deepEqual(buildEntriesTotalsModel(INPUT), {
    month: "Aug 2026",
    spent: { amountMinor: 167_927, tone: "neutral", shareMinor: 136_925 },
    pills: [
      { key: "income", amountMinor: 830_000, tone: "in", shareMinor: null },
      { key: "difference", amountMinor: 693_075, tone: "in", shareMinor: null },
      { key: "transfers", amountMinor: 599_342, tone: "neutral", shareMinor: null },
      { key: "outflow", amountMinor: 767_269, tone: "neutral", shareMinor: 736_267 }
    ],
    personLabel: "Ethan"
  });
});

test("a share shows only where it differs from the whole figure", () => {
  const whole = buildEntriesTotalsModel({
    ...INPUT,
    entryTotals: totals({ grossSpendMinor: 50_000, spendMinor: 50_000 }),
    entryOutflowMinor: 80_000,
    entryGrossOutflowMinor: 80_000
  });
  assert.equal(whole.spent.shareMinor, null);
  assert.equal(whole.pills.find((pill) => pill.key === "outflow").shareMinor, null);

  const transfers = buildEntriesTotalsModel({ ...INPUT, entryTotals: totals({ grossTransferOutMinor: 100_000, transferOutMinor: 40_000 }) });
  assert.equal(transfers.pills.find((pill) => pill.key === "transfers").shareMinor, 40_000);
});

test("spend, transfers and outflow are plain; income and a deficit carry their direction", () => {
  const deficit = buildEntriesTotalsModel({ ...INPUT, entryTotals: totals({ incomeMinor: 0 }), entryNetMinor: -437_167 });
  assert.deepEqual(deficit.pills.map((pill) => [pill.key, pill.tone]), [
    ["income", "neutral"], ["difference", "short"], ["transfers", "neutral"], ["outflow", "neutral"]
  ]);
  assert.equal(deficit.spent.tone, "neutral");
});

test("the filters row says All entries, or how many filters are on", () => {
  assert.equal(describeEntryFilters(0), "All entries");
  assert.equal(describeEntryFilters(1), "1 filter on");
  assert.equal(describeEntryFilters(3), "3 filters on");
});
