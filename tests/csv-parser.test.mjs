import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/lib/csv.ts";

test("parseCsv repairs unquoted commas inside description columns", () => {
  const rows = parseCsv([
    "date,description,expense,income,account,category,note,type",
    "2026-01-10,PAYNOW OTHR LI LITING, JOYCE Jeju bebemoon,,1164.70,UOB One,Other - Income,,income"
  ].join("\n"));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, "PAYNOW OTHR LI LITING, JOYCE Jeju bebemoon");
  assert.equal(rows[0].expense, "");
  assert.equal(rows[0].income, "1164.70");
  assert.equal(rows[0].account, "UOB One");
});
