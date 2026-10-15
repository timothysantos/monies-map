// The words an investment statement import uses are the same for every
// provider: none names iFAST or StashAway, and the earlier-statement notice
// says plainly where each statement stands.
import assert from "node:assert/strict";
import test from "node:test";

import { importMessages } from "../src/client/copy/en-SG-imports.js";

const SAMPLE_ARGUMENTS = ["Tim Investments","$15,357.71", "30 Sep", "OCBC 360", "1 Sep"];

test("no investment statement string names a provider", () => {
  const keys = Object.keys(importMessages).filter((key) => /^(investmentStatement|saveInvestmentValue|willSaveInvestmentValues)/.test(key));
  assert.ok(keys.length >= 6, `found ${keys.join(", ")}`);
  for (const key of keys) {
    const value = importMessages[key];
    const text = typeof value === "function" ? value(...SAMPLE_ARGUMENTS) : value;
    assert.doesNotMatch(text, /ifast|stashaway/i, key);
  }
});

test("the earlier-statement notice gives both figures and the earlier date, and says nothing is blocked", () => {
  assert.equal(
    importMessages.investmentStatementStartsAfter("$15,706.59", "$15,500.00", "31 Aug"),
    "This statement starts at $15,706.59, but the earlier statement ended at $15,500.00 on 31 Aug. A statement may be missing in between."
  );
});
