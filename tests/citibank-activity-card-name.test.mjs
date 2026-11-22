import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCitibankActivityCsv } from "../src/lib/statement-import/citibank-activity-csv.ts";

// A real Citi Rewards activity export (sanitized). The card a row belongs to
// comes from the file name; the selected account is only the fallback.
const CSV = readFileSync(new URL("./fixtures/citibank-activity/ACCT_349_19_10_2026-sanitized.csv", import.meta.url), "utf8");

function accountsFor(fileName, accountName) {
  const parsed = parseCitibankActivityCsv(CSV, fileName, { accountName, accountKind: "credit_card", institution: "Citibank" });
  return [...new Set(parsed.rows.map((row) => row.account))];
}

test("a file named citirewards goes to Citi Rewards even when Citi Miles is selected", () => {
  assert.deepEqual(accountsFor("tim_citirewards_midcycle_ACCT_349_17_10_2026.csv", "Citi Miles"), ["Citi Rewards"]);
});

test("a file named citimiles goes to Citi Miles even when Citi Rewards is selected", () => {
  assert.deepEqual(accountsFor("tim_citimiles_midcycle_ACCT_360_17_10_2026.csv", "Citi Rewards"), ["Citi Miles"]);
});

test("the separate-word names still work", () => {
  assert.deepEqual(accountsFor("citi_rewards_midcycle.csv", "Citi Miles"), ["Citi Rewards"]);
  assert.deepEqual(accountsFor("ACCT_360_17_10_2026-miles.csv", "Citi Rewards"), ["Citi Miles"]);
});

test("a name with neither word keeps the selected card, and words inside other words do not count", () => {
  assert.deepEqual(accountsFor("ACCT_349_17_10_2026.csv", "Citi Rewards"), ["Citi Rewards"]);
  assert.deepEqual(accountsFor("smiles_export.csv", "Citi Rewards"), ["Citi Rewards"]);
});

// The file never names its card, so the parse says where the account came
// from: the preview shows it before anything is saved.
function sourceFor(fileName, accountName) {
  return parseCitibankActivityCsv(CSV, fileName, accountName ? { accountName, accountKind: "credit_card", institution: "Citibank" } : undefined).accountSource;
}

test("the parse says whether the card came from the file's name or from the selected account", () => {
  assert.equal(sourceFor("tim_citirewards_midcycle_ACCT_349_17_10_2026.csv", "Citi Miles"), "file_name");
  assert.equal(sourceFor("ACCT_349_17_10_2026.csv", "Citi Miles"), "selected_account");
  assert.equal(sourceFor("smiles_export.csv", "Citi Rewards"), "selected_account");
});
