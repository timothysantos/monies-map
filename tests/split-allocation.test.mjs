import assert from "node:assert/strict";
import test from "node:test";

import { homeCurrencyShareAmounts, rebalanceSplitSharesForTotal, splitAmountMinorWithRoundedRemainder } from "../src/domain/split-allocation.ts";

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

test("a travel split's home-currency shares are its stored basis applied to the ledger amount", () => {
  // JPY 10,000 split 50/50 on an SGD 93.01 row: floor on the first share,
  // balancing cent on the second; the shares add up to the ledger amount.
  assert.deepEqual(homeCurrencyShareAmounts([
    { ratioBasisPoints: 5000, amountMinor: 500_000 },
    { ratioBasisPoints: 5000, amountMinor: 500_000 }
  ], 9301), [4650, 4651]);
  // 70/30: 70% of 93.01 is 65.107.
  assert.deepEqual(homeCurrencyShareAmounts([
    { ratioBasisPoints: 7000, amountMinor: 700_000 },
    { ratioBasisPoints: 3000, amountMinor: 300_000 }
  ], 9301), [6510, 2791]);
  // A signed ledger amount converts by its size, like the home amount does.
  assert.deepEqual(homeCurrencyShareAmounts([
    { ratioBasisPoints: 7000, amountMinor: 700_000 },
    { ratioBasisPoints: 3000, amountMinor: 300_000 }
  ], -9301), [6510, 2791]);
  // An even split with an assigned odd cent stays even, as a same-currency
  // split does when it follows a new amount.
  assert.deepEqual(homeCurrencyShareAmounts([
    { ratioBasisPoints: 4999, amountMinor: 500 },
    { ratioBasisPoints: 5001, amountMinor: 501 }
  ], 9301), [4650, 4651]);
  // Any other share count floors each share and balances onto the last.
  assert.deepEqual(homeCurrencyShareAmounts([{ ratioBasisPoints: 10000, amountMinor: 1_000 }], 9301), [9301]);
  assert.deepEqual(homeCurrencyShareAmounts([
    { ratioBasisPoints: 3333, amountMinor: 3_333 },
    { ratioBasisPoints: 3333, amountMinor: 3_333 },
    { ratioBasisPoints: 3334, amountMinor: 3_334 }
  ], 100), [33, 33, 34]);
});
