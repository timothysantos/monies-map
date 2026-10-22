import assert from "node:assert/strict";
import test from "node:test";

import { importMessages } from "../src/client/copy/en-SG-imports.js";

test("each kind of existing ledger row has its own plain label", () => {
  assert.deepEqual(importMessages.duplicateMatchOrigin, {
    apple_pay_shortcut: "Apple Pay entry",
    ask: "Added in Ask",
    manual: "Manual entry",
    csv: "Mid-cycle export",
    pdf: "PDF statement"
  });
  assert.equal(importMessages.duplicateMatchOrigin.unknown, undefined);
});
