import assert from "node:assert/strict";
import test from "node:test";

import { buildInferredAmountKeys, isInferredAmountRow } from "../src/client/import-inferred-amounts.js";

const IKEA = { date: "2026-08-17", description: "IKEA SINGAPORE SG", amount: "64.70" };

test("a row whose amount was taken from the statement total is marked", () => {
  const keys = buildInferredAmountKeys([IKEA]);
  assert.equal(isInferredAmountRow({ date: "2026-08-17", description: "IKEA SINGAPORE SG", amountMinor: 6470 }, keys), true);
});

test("the mark goes once the user corrects the amount, and never lands on another row", () => {
  const keys = buildInferredAmountKeys([IKEA]);
  assert.equal(isInferredAmountRow({ date: "2026-08-17", description: "IKEA SINGAPORE SG", amountMinor: 6471 }, keys), false);
  assert.equal(isInferredAmountRow({ date: "2026-08-08", description: "MOTHERCARE - PARAGON SINGAPORE SG", amountMinor: 45900 }, keys), false);
  assert.equal(isInferredAmountRow({ date: "2026-08-17", description: "IKEA SINGAPORE SG", amountMinor: 6470 }, buildInferredAmountKeys(undefined)), false);
});

test("amounts are compared in cents, so 3384.86 and 0.18 match exactly", () => {
  const keys = buildInferredAmountKeys([
    { date: "2026-07-29", description: "APPLE STORE R669 SINGAPORE SG", amount: "3384.86" },
    { date: "2026-10-02", description: "DCC FEE", amount: "0.18" }
  ]);
  assert.equal(isInferredAmountRow({ date: "2026-07-29", description: "APPLE STORE R669 SINGAPORE SG", amountMinor: 338486 }, keys), true);
  assert.equal(isInferredAmountRow({ date: "2026-10-02", description: "DCC FEE", amountMinor: 18 }, keys), true);
});
