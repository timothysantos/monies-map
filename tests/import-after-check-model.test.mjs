import assert from "node:assert/strict";
import test from "node:test";

import { summarizeAfterImportCheck } from "../src/client/import-after-check-model.js";
import { importMessages } from "../src/client/copy/en-SG-imports.js";

const report = (kindCounts, clearTransferPairCount = 0) => ({ kindCounts, clearTransferPairCount });
const counts = (high = 0, check = 0, note = 0) => ({ high, check, note });

test("doubles and transfers with no other side are counted from the report", () => {
  assert.deepEqual(
    summarizeAfterImportCheck(report({
      wrong_card_duplicate: counts(1, 0),
      duplicate_entry: counts(0, 1),
      unmatched_transfer: counts(0, 4),
      // Not something an import causes: never counted here.
      plan_overspent: counts(3, 0),
      other_category: counts(0, 9)
    }, 2)),
    { doubleCount: 2, transferCount: 4, clearPairCount: 2, totalCount: 6 }
  );
});

test("negative: nothing to look at gives no card; background notes do not count", () => {
  assert.equal(summarizeAfterImportCheck(null), null);
  assert.equal(summarizeAfterImportCheck(report({})), null);
  assert.equal(summarizeAfterImportCheck(report({ duplicate_entry: counts(0, 0, 5), plan_overspent: counts(2) })), null);
});

test("clear pairs are never more than the transfers can make", () => {
  assert.equal(summarizeAfterImportCheck(report({ unmatched_transfer: counts(0, 3) }, 9)).clearPairCount, 1);
  assert.equal(summarizeAfterImportCheck(report({ unmatched_transfer: counts(0, 2) }, Number.NaN)).clearPairCount, 0);
});

test("the card says what to look at in plain words, singular and plural", () => {
  assert.equal(importMessages.afterImportCheckTitle(1), "1 thing to look at in your books");
  assert.equal(importMessages.afterImportCheckTitle(6), "6 things to look at in your books");
  assert.equal(importMessages.afterImportDoubles(1), "1 payment may be recorded twice.");
  assert.equal(importMessages.afterImportDoubles(2), "2 payments may be recorded twice.");
  assert.equal(importMessages.afterImportTransfers(1, 0), "1 transfer has no matching other side yet.");
  assert.equal(importMessages.afterImportTransfers(4, 2), "4 transfers have no matching other side yet. 2 pairs are clear enough to link in one step.");
  assert.equal(importMessages.afterImportTransfers(2, 1), "2 transfers have no matching other side yet. 1 pair is clear enough to link in one step.");
  assert.equal(importMessages.afterImportCheckOpen, "Check my books");
});
