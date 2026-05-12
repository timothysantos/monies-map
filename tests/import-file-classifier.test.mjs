import assert from "node:assert/strict";
import test from "node:test";

import { classifyImportFile } from "../src/client/import-file-classifier.js";

const creditCardContext = {
  accountName: "Citi Rewards",
  accountKind: "credit_card",
  institution: "Citibank"
};

const ocbcContext = {
  accountName: "OCBC 365 Credit Card",
  accountKind: "credit_card",
  institution: "OCBC"
};

test("classifyImportFile routes PDFs before other formats", () => {
  assert.equal(classifyImportFile({
    fileName: "statement.pdf",
    fileType: "application/pdf",
    text: "",
    activityContext: creditCardContext
  }), "pdf");
});

test("classifyImportFile routes UOB/OCBC/Citi CSV variants explicitly", () => {
  assert.equal(classifyImportFile({
    fileName: "ACCT_12345_06_05_2026-rewards.csv",
    fileType: "text/csv",
    text: "Citibank Cardmember",
    activityContext: creditCardContext
  }), "citibank-activity-csv");

  assert.equal(classifyImportFile({
    fileName: "TrxHistory_12345.csv",
    fileType: "text/csv",
    text: "Account details for: OCBC",
    activityContext: ocbcContext
  }), "ocbc-activity-csv");
});

test("classifyImportFile returns unknown for unsupported files", () => {
  assert.equal(classifyImportFile({
    fileName: "notes.txt",
    fileType: "text/plain",
    text: "hello",
    activityContext: creditCardContext
  }), "unknown");
});
