import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCurrentTransactionSpreadsheet } from "../src/lib/statement-import/xls.ts";

function readWorkbookFixture(name) {
  const file = new URL(`./fixtures/uob-current-transactions/${name}`, import.meta.url);
  const buffer = readFileSync(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("parses a tiny UOB One current-transaction XLS stored in the OLE mini-stream", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("ACC_TXN_History_02052026194007.xls"),
    "ACC_TXN_History_02052026194007.xls"
  );

  assert.equal(parsed.parserKey, "uob_current_transactions_xls");
  assert.equal(parsed.checkpoints.length, 0);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    date: "2026-05-02",
    description: "Funds Transfer HDB mortgage SANTOS TIMOTHY OGAN",
    expense: "",
    income: "450.00",
    account: "UOB One",
    category: "Transfer",
    note: "",
    type: "transfer"
  });
});

test("parses a later tiny UOB One current-transaction XLS from the same source", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("ACC_TXN_History_04052026210351.xls"),
    "ACC_TXN_History_04052026210351.xls"
  );

  assert.equal(parsed.parserKey, "uob_current_transactions_xls");
  assert.equal(parsed.checkpoints.length, 0);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows.at(-1), {
    date: "2026-05-04",
    description: "One Bonus Interest",
    expense: "",
    income: "228.08",
    account: "UOB One",
    category: "Other - Income",
    note: "",
    type: "income"
  });
});

test("parses UOB One Card current-transaction XLS files via the original workbook stream path", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("CC_TXN_History_06052026211223-onecard-tim-06-may.xls"),
    "CC_TXN_History_06052026211223-onecard-tim-06-may.xls"
  );

  assert.equal(parsed.parserKey, "uob_credit_card_current_transactions_xls");
  assert.equal(parsed.checkpoints.length, 0);
  assert.equal(parsed.warnings.length, 0);
  assert.ok(parsed.rows.length > 0);
  assert.equal(parsed.rows[0].account, "UOB One Card");
});

test("parses UOB Lady's Card current-transaction XLS files via the original workbook stream path", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("CC_TXN_History_06052026211316-ladys-tim-06-may.xls"),
    "CC_TXN_History_06052026211316-ladys-tim-06-may.xls"
  );

  assert.equal(parsed.parserKey, "uob_credit_card_current_transactions_xls");
  assert.equal(parsed.checkpoints.length, 0);
  assert.equal(parsed.warnings.length, 0);
  assert.ok(parsed.rows.length > 0);
  assert.equal(parsed.rows[0].account, "UOB Lady's Card");
});
