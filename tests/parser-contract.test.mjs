import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStatementText } from "../src/lib/statement-import.ts";
import { parseOcbcActivityCsv } from "../src/lib/statement-import.ts";
import { parseCurrentTransactionSpreadsheet } from "../src/lib/statement-import/xls.ts";

function readWorkbookFixture(name) {
  const file = new URL(`./fixtures/uob-current-transactions/${name}`, import.meta.url);
  const buffer = readFileSync(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function readTextFixture(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("parseStatementText rejects unsupported statement layouts with a clear error", () => {
  assert.throws(
    () => parseStatementText("not a supported statement", "unsupported.pdf"),
    /Unsupported statement PDF/
  );
});

test("parseStatementText preserves UOB credit card post and event date lanes", () => {
  const parsed = parseStatementText(`
Credit Card(s) Statement
Statement Date
12 MAY 2026
UOB ONE CARD
1234-5678-9012-3456
PREVIOUS BALANCE
0.00
13 APR
11 APR
HONG KONG ZHAI DIMI S Singapore
Ref No. : 12712986102759374477422
11.40
14 APR
13 APR
PAYMENT VIA FAST
Ref No. : 12712986102759374477500
3.00 CR
SUB TOTAL
TOTAL BALANCE FOR UOB ONE CARD
8.40
End of Transaction Details
`, "uob-may.pdf");

  assert.equal(parsed.parserKey, "uob_credit_card_pdf");
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows.map((row) => ({
    date: row.date,
    note: row.note,
    description: row.description,
    expense: row.expense,
    income: row.income
  })), [
    {
      date: "2026-04-13",
      note: "txn date: 2026-04-11",
      description: "HONG KONG ZHAI DIMI S Singapore",
      expense: "11.40",
      income: ""
    },
    {
      date: "2026-04-14",
      note: "txn date: 2026-04-13",
      description: "PAYMENT VIA FAST",
      expense: "",
      income: "3.00"
    }
  ]);
  assert.deepEqual(parsed.checkpoints[0], {
    accountName: "UOB One Card",
    checkpointMonth: "2026-05",
    statementStartDate: "2026-04-13",
    statementEndDate: "2026-05-12",
    statementBalanceMinor: 840,
    note: "Imported from UOB credit card statement"
  });
});

test("parseStatementText supports OCBC Infinity Cashback credit card statements", () => {
  const parsed = parseStatementText(`
__PDF_SPACED_LAYOUT_TEXT__
STATEMENT DATE PAYMENT DUE DATE TOTAL CREDIT LIMIT TOTAL AVAILABLE CREDIT LIMIT TOTAL MINIMUM DUE
27 - 05 - 2026 19 - 06 - 2026 S $ 32 , 400 S $ 30 , 272 . 59 S $ 64 . 00
TRANSACTION DATE DESCRIPTION AMOUNT (SGD)
OCBC INFINITY CASHBACK
TIMOTHY SANTOS 5413-8301-0060-2572
LAST MONTH ' S BALANCE 1 , 349 . 33
04 / 05 PAYMENT - MONEY SEND ( 1 , 349 . 33 )
09 / 05 - 5038 PERCOLATE PTE LTD N / A SGP 2 , 149 . 00
30 / 04 CASH REBATE ( 21 . 59 )
SUBTOTAL 2 , 127 . 41
TOTAL 2,127.41
TOTAL AMOUNT DUE 2 , 127 . 41
`, "OCBC INFINITY CASHBACK-2572-May-26.pdf");

  assert.equal(parsed.parserKey, "ocbc_infinity_cashback_pdf");
  assert.equal(parsed.sourceLabel, "OCBC INFINITY CASHBACK-2572-May-26");
  assert.deepEqual(parsed.checkpoints[0], {
    accountName: "OCBC Infinity Cashback",
    checkpointMonth: "2026-05",
    statementStartDate: "2026-04-30",
    statementEndDate: "2026-05-27",
    statementBalanceMinor: 212741,
    previousBalanceMinor: 134933,
    note: "Imported from OCBC credit card statement"
  });
  assert.deepEqual(parsed.rows.map((row) => ({
    date: row.date,
    description: row.description,
    expense: row.expense,
    income: row.income,
    account: row.account,
    type: row.type
  })), [
    {
      date: "2026-04-30",
      description: "CASH REBATE",
      expense: "",
      income: "21.59",
      account: "OCBC Infinity Cashback",
      type: "income"
    },
    {
      date: "2026-05-04",
      description: "PAYMENT - MONEY SEND",
      expense: "",
      income: "1349.33",
      account: "OCBC Infinity Cashback",
      type: "transfer"
    },
    {
      date: "2026-05-09",
      description: "PERCOLATE PTE LTD N / A SGP",
      expense: "2149.00",
      income: "",
      account: "OCBC Infinity Cashback",
      type: "expense"
    }
  ]);
});

test("parseStatementText uses OCBC Infinity printed last-month balance for first statement opening balance", () => {
  const parsed = parseStatementText(`
__PDF_SPACED_LAYOUT_TEXT__
STATEMENT DATE PAYMENT DUE DATE TOTAL CREDIT LIMIT TOTAL AVAILABLE CREDIT LIMIT TOTAL MINIMUM DUE
27 - 04 - 2026 19 - 05 - 2026 S $ 32 , 400 S $ 31 , 050 . 67 S $ 40 . 00
TRANSACTION DATE DESCRIPTION AMOUNT (SGD)
OCBC INFINITY CASHBACK
TIMOTHY SANTOS 5413-8301-0060-2572
LAST MONTH ' S BALANCE 0 . 00
23 / 04 ROBOROCK SINGAPORE SINGAPORE SGP 1 , 349 . 33
SUBTOTAL 1 , 349 . 33
TOTAL 1,349.33
TOTAL AMOUNT DUE 1 , 349 . 33
`, "OCBC INFINITY CASHBACK-2572-Apr-26.pdf");

  assert.equal(parsed.parserKey, "ocbc_infinity_cashback_pdf");
  assert.deepEqual(parsed.checkpoints[0], {
    accountName: "OCBC Infinity Cashback",
    checkpointMonth: "2026-04",
    statementStartDate: "2026-04-23",
    statementEndDate: "2026-04-27",
    statementBalanceMinor: 134933,
    previousBalanceMinor: 0,
    note: "Imported from OCBC credit card statement"
  });
  assert.deepEqual(parsed.rows.map((row) => ({
    date: row.date,
    description: row.description,
    expense: row.expense,
    income: row.income,
    account: row.account,
    type: row.type
  })), [
    {
      date: "2026-04-23",
      description: "ROBOROCK SINGAPORE SINGAPORE SGP",
      expense: "1349.33",
      income: "",
      account: "OCBC Infinity Cashback",
      type: "expense"
    }
  ]);
});

test("parseStatementText supports OCBC Child Development Acc statements with no activity", () => {
  const parsed = parseStatementText(`
__PDF_SPACED_LAYOUT_TEXT__
RIVER LI SANTOS STATEMENT OF ACCOUNT
OCBC CENTRE BRANCH
CHILD DEVELOPMENT ACC (CDA) 29 MAY 2026 TO 31 MAY 2026
Account No. 705656593001
Transaction Value
Date Date Description Cheque Withdrawal Deposit Balance
BALANCE B/F 0.00
BALANCE C/F 0.00
Total Withdrawals/Deposits 0.00 0.00
`, "CHILD DEVELOPMENT ACC (CDA)-3001-May-26.pdf");

  assert.equal(parsed.parserKey, "ocbc_cda_pdf");
  assert.equal(parsed.sourceLabel, "CHILD DEVELOPMENT ACC (CDA)-3001-May-26");
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.checkpoints[0], {
    accountName: "Child Development Acc (CDA)",
    checkpointMonth: "2026-05",
    statementStartDate: "2026-05-29",
    statementEndDate: "2026-05-31",
    statementBalanceMinor: 0,
    note: "Imported from OCBC deposit statement"
  });
});

test("parseOcbcActivityCsv preserves a near-real OCBC 360 current-activity export", () => {
  const parsed = parseOcbcActivityCsv(
    readTextFixture("./fixtures/ocbc-activity/TransactionHistory_20260628140517-ocbc-360-sanitized.csv"),
    "TransactionHistory_20260628140517.csv"
  );

  assert.equal(parsed.parserKey, "ocbc_360_activity_csv");
  assert.equal(parsed.sourceLabel, "TransactionHistory_20260628140517");
  assert.equal(parsed.checkpoints.length, 0);
  assert.equal(parsed.rows.length, 14);
  assert.deepEqual(parsed.rows.slice(0, 3).map((row) => ({
    date: row.date,
    description: row.description,
    expense: row.expense,
    income: row.income,
    account: row.account,
    category: row.category,
    note: row.note,
    type: row.type
  })), [
    {
      date: "2026-05-29",
      description: "BILL PAYMENT INB INTERNET BANKING SINGAPORE0000000000000000",
      expense: "459.12",
      income: "",
      account: "OCBC 360",
      category: "Transfer",
      note: "",
      type: "transfer"
    },
    {
      date: "2026-05-30",
      description: "INTEREST CREDIT",
      expense: "",
      income: "2.14",
      account: "OCBC 360",
      category: "Other - Income",
      note: "transaction date: 2026-05-31",
      type: "income"
    },
    {
      date: "2026-06-02",
      description: "FUND TRANSFER OTHR - 00000000 REDACTED PAYEE to EXAMPLE PAYEE via PayNow-UEN",
      expense: "1000.00",
      income: "",
      account: "OCBC 360",
      category: "Transfer",
      note: "transaction date: 2026-05-31",
      type: "transfer"
    }
  ]);
  assert.deepEqual(parsed.rows.at(-1), {
    date: "2026-06-26",
    description: "FAST PAYMENT SALA-PayNow Transfer via PayNow-Mobile to REDACTED PAYEE",
    expense: "5000.00",
    income: "",
    account: "OCBC 360",
    category: "Transfer",
    note: "",
    type: "transfer"
  });
});

test("parseCurrentTransactionSpreadsheet rejects empty or unreadable XLS buffers", () => {
  const emptyBuffer = new ArrayBuffer(0);

  assert.throws(
    () => parseCurrentTransactionSpreadsheet(emptyBuffer, "empty.xls"),
    /Unsupported XLS file/
  );
});

test("parseCurrentTransactionSpreadsheet preserves the normalized UOB current-transaction contract", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("ACC_TXN_History_02052026194007.xls"),
    "ACC_TXN_History_02052026194007.xls"
  );

  assert.equal(parsed.parserKey, "uob_current_transactions_xls");
  assert.equal(parsed.sourceLabel, "ACC_TXN_History_02052026194007");
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(Object.keys(parsed.rows[0]).sort(), [
    "account",
    "category",
    "date",
    "description",
    "expense",
    "income",
    "note",
    "type"
  ]);
  assert.equal(parsed.checkpoints.length, 0);
  assert.equal(parsed.warnings.length, 0);
});

for (const [scenarioId, fixtureName, expectedAccountName] of [
  ["I13", "CC_TXN_History_06052026211223-onecard-tim-06-may.xls", "UOB One Card"],
  ["I14", "CC_TXN_History_06052026211316-ladys-tim-06-may.xls", "UOB Lady's Card"]
]) {
  test(`parseCurrentTransactionSpreadsheet preserves the ${scenarioId} UOB credit-card contract`, () => {
    const parsed = parseCurrentTransactionSpreadsheet(
      readWorkbookFixture(fixtureName),
      fixtureName
    );

    assert.equal(parsed.parserKey, "uob_credit_card_current_transactions_xls");
    assert.equal(parsed.rows[0].account, expectedAccountName);
    assert.equal(parsed.sourceLabel.endsWith(fixtureName.replace(/\.xls$/i, "")), true);
    assert.equal(parsed.rows.length > 0, true);
    assert.deepEqual(Object.keys(parsed.rows[0]).sort(), [
      "account",
      "category",
      "date",
      "description",
      "expense",
      "income",
      "note",
      "postedDate",
      "reference",
      "transactionDate",
      "type"
    ]);
    assert.match(parsed.rows[0].transactionDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(parsed.rows[0].postedDate, parsed.rows[0].date);
    assert.equal(parsed.checkpoints.length, 0);
    assert.equal(parsed.warnings.length, 0);
  });
}
