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
    description: "Funds Transfer HDB mortgage TEST TEST TEST",
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

// UOB's card activity export can list the same block of transactions twice
// further down the sheet. A bank reference names one transaction, so a second
// row with a reference already read is the same purchase, not a new one.
test("keeps one row per bank reference when a UOB card export repeats a block", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("CC_TXN_History-onecard-repeated-block-nov-2026-sanitized.xls"),
    "CC_TXN_History-onecard-repeated-block-nov-2026-sanitized.xls"
  );

  assert.equal(parsed.parserKey, "uob_credit_card_current_transactions_xls");
  const referenced = parsed.rows.filter((row) => row.reference);
  assert.equal(new Set(referenced.map((row) => row.reference)).size, referenced.length);
  assert.equal(referenced.length, 209);
  assert.equal(parsed.rows.length - referenced.length, 9);

  // Two different purchases at the same stall on the same day both stay.
  const hawker = parsed.rows
    .filter((row) => row.description.startsWith("HAWKERS STREET - 100AM"))
    .map((row) => ({ expense: row.expense, reference: row.reference, transactionDate: row.transactionDate }));
  assert.deepEqual(hawker, [
    { expense: "5.90", reference: "74556226306110898197290", transactionDate: "2026-11-02" },
    { expense: "1.00", reference: "74556226306110898377694", transactionDate: "2026-11-02" }
  ]);
});

test("keeps same-day same-amount card rows that carry different bank references", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("CC_TXN_History-onecard-repeated-block-nov-2026-sanitized.xls"),
    "CC_TXN_History-onecard-repeated-block-nov-2026-sanitized.xls"
  );
  const kampung = parsed.rows.filter((row) => row.description.startsWith("FO ION- TODAY KAMPUNG"));
  assert.deepEqual(kampung.map((row) => row.reference), ["74541836310288074293253", "74541836310288074293261"]);
});
