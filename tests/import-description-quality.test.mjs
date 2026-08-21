import assert from "node:assert/strict";
import test from "node:test";

import {
  getImportDescriptionQualityIssue
} from "../src/domain/import-description-quality.ts";

test("import description quality allows normal bank transaction descriptions", () => {
  assert.equal(getImportDescriptionQualityIssue("BILL PAYMENT INB 4524192012247528 INTERNET BANKING SINGAPORE"), undefined);
});

test("import description quality blocks oversized bank descriptions before ledger write", () => {
  const issue = getImportDescriptionQualityIssue("A".repeat(501));

  assert.match(issue ?? "", /unusually long/);
  assert.match(issue ?? "", /blocked before import/);
});

test("import description quality blocks statement boilerplate contamination", () => {
  const issue = getImportDescriptionQualityIssue("BILL PAYMENT Deposit Insurance Scheme TRANSACTION CODE DESCRIPTION Account No.");

  assert.match(issue ?? "", /statement boilerplate/);
  assert.match(issue ?? "", /blocked before import/);
});
