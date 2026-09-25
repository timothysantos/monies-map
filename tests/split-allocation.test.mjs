import assert from "node:assert/strict";
import test from "node:test";

import { rebalanceSplitSharesForTotal, splitAmountMinorWithRoundedRemainder } from "../src/domain/split-allocation.ts";

test("a split follows a new total by its stored ratio with the floor on the first share", () => {
  assert.deepEqual(rebalanceSplitSharesForTotal([
    { ratioBasisPoints: 2500, amountMinor: 1500 },
    { ratioBasisPoints: 7500, amountMinor: 4500 }
  ], 8050), [
    { ratioBasisPoints: 2500, amountMinor: 2012 },
    { ratioBasisPoints: 7500, amountMinor: 6038 }
  ]);
  // Same rounding as a newly created split.
  assert.deepEqual(splitAmountMinorWithRoundedRemainder(8050, 2500), { firstAmount: 2012, secondAmount: 6038 });
});

test("an even split with an assigned odd cent stays an even split on the new total", () => {
  const even = [
    { ratioBasisPoints: 5000, amountMinor: 4025 },
    { ratioBasisPoints: 5000, amountMinor: 4026 }
  ];
  assert.deepEqual(rebalanceSplitSharesForTotal([
    { ratioBasisPoints: 4999, amountMinor: 2032 },
    { ratioBasisPoints: 5001, amountMinor: 2033 }
  ], 8051), even);
  assert.deepEqual(rebalanceSplitSharesForTotal([
    { ratioBasisPoints: 5001, amountMinor: 2033 },
    { ratioBasisPoints: 4999, amountMinor: 2032 }
  ], 8051), even);
});

test("a zero share and a full share keep their ratio instead of becoming an even split", () => {
  assert.deepEqual(rebalanceSplitSharesForTotal([
    { ratioBasisPoints: 0, amountMinor: 0 },
    { ratioBasisPoints: 10000, amountMinor: 1 }
  ], 8050), [
    { ratioBasisPoints: 0, amountMinor: 0 },
    { ratioBasisPoints: 10000, amountMinor: 8050 }
  ]);
});

test("a split without exactly two shares is rejected before any write", () => {
  assert.throws(
    () => rebalanceSplitSharesForTotal([{ ratioBasisPoints: 10000, amountMinor: 6000 }], 8050),
    /exactly two shares/
  );
  assert.throws(
    () => rebalanceSplitSharesForTotal([
      { ratioBasisPoints: 3334, amountMinor: 2000 },
      { ratioBasisPoints: 3333, amountMinor: 2000 },
      { ratioBasisPoints: 3333, amountMinor: 2000 }
    ], 8050),
    /exactly two shares/
  );
});
