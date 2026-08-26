import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExternalSettlement,
  calculateNetSettlement,
  classifyCheckpointItem
} from "../src/domain/split-settlement-policy.ts";

test("nets opposing group balances into one person-level settlement", () => {
  assert.deepEqual(
    calculateNetSettlement(
      [
        { groupId: "okaeri", amountMinor: 1090577 },
        { groupId: "b-river", amountMinor: -323208 }
      ],
      "Tim",
      "Joyce"
    ),
    {
      fromPersonName: "Joyce",
      toPersonName: "Tim",
      amountMinor: 767369,
      requiresLedgerMatch: true
    }
  );
});

test("an exact internal offset creates no bank matching obligation", () => {
  assert.deepEqual(
    calculateNetSettlement(
      [
        { groupId: "one", amountMinor: 5000 },
        { groupId: "two", amountMinor: -5000 }
      ],
      "Tim",
      "Joyce"
    ),
    {
      fromPersonName: null,
      toPersonName: null,
      amountMinor: 0,
      requiresLedgerMatch: false
    }
  );
});

test("negative net balance reverses the payment direction", () => {
  const settlement = calculateNetSettlement(
    [{ groupId: "trip", amountMinor: -12500 }],
    "Tim",
    "Joyce"
  );

  assert.equal(settlement.fromPersonName, "Tim");
  assert.equal(settlement.toPersonName, "Joyce");
  assert.equal(settlement.amountMinor, 12500);
});

test("a ledger row only fully settles the checkpoint when the amount is exact", () => {
  assert.deepEqual(applyExternalSettlement(767369, 767369), {
    matched: true,
    overpaid: false,
    remainingMinor: 0
  });
  assert.deepEqual(applyExternalSettlement(767369, 500000), {
    matched: false,
    overpaid: false,
    remainingMinor: 267369
  });
});

test("an overpaid ledger row is surfaced instead of silently closing the checkpoint", () => {
  assert.deepEqual(applyExternalSettlement(767369, 800000), {
    matched: false,
    overpaid: true,
    remainingMinor: 0
  });
});

test("multiple bank-limit transfers accumulate until the checkpoint is fully paid", () => {
  assert.deepEqual(applyExternalSettlement(767369, 300000), {
    matched: false,
    overpaid: false,
    remainingMinor: 467369
  });
  assert.deepEqual(applyExternalSettlement(467369, 467369), {
    matched: true,
    overpaid: false,
    remainingMinor: 0
  });
});

test("a cumulative transfer series still surfaces an overpayment", () => {
  assert.deepEqual(applyExternalSettlement(467369, 500000), {
    matched: false,
    overpaid: true,
    remainingMinor: 0
  });
});

test("a backdated item in a new batch remains open after an older checkpoint", () => {
  const checkpoint = { batchId: "batch-12", closedOn: "2026-08-20" };

  assert.equal(
    classifyCheckpointItem(
      { id: "old-included", batchId: "batch-12", activityDate: "2026-08-10" },
      checkpoint
    ),
    "settled"
  );
  assert.equal(
    classifyCheckpointItem(
      { id: "late-import", batchId: "batch-13", activityDate: "2026-08-10" },
      checkpoint
    ),
    "open_after_settlement"
  );
  assert.equal(
    classifyCheckpointItem(
      { id: "new-item", batchId: "batch-13", activityDate: "2026-08-21" },
      checkpoint
    ),
    "open"
  );
});

test("checkpoint identity is batch-based, not date-based", () => {
  assert.equal(
    classifyCheckpointItem(
      { id: "corrected-row", batchId: "batch-14", activityDate: "2026-08-01" },
      { batchId: "batch-12", closedOn: "2026-08-20" }
    ),
    "open_after_settlement"
  );
});
