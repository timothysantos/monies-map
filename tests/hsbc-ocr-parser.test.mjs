import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseStatementText,
  statementRowsToCsv
} from "../src/lib/statement-import.ts";

test("HSBC Visa Revolution OCR TSV imports statement rows and checkpoint", async () => {
  const tsv = await readFile("tests/fixtures/hsbc-ocr/hsbc-visa-revolution-apr-2026.tsv", "utf8");
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "HSBC-8155-apr-2026.pdf");

  assert.equal(parsed.parserKey, "hsbc_visa_revolution_ocr_pdf");
  assert.equal(parsed.sourceLabel, "HSBC-8155-apr-2026");
  assert.deepEqual(parsed.checkpoints, [{
    accountName: "HSBC Visa Revolution",
    checkpointMonth: "2026-04",
    statementStartDate: "2026-03-06",
    statementEndDate: "2026-04-05",
    statementBalanceMinor: 0,
    previousBalanceMinor: 0,
    note: "Imported from HSBC Visa Revolution OCR statement"
  }]);
  assert.deepEqual(parsed.rows, [
    {
      date: "2026-03-09",
      description: "IKEA - ONLINE SINGAPORE",
      expense: "117.80",
      income: "",
      account: "HSBC Visa Revolution",
      category: "Shopping",
      note: "txn date: 2026-03-06",
      type: "expense"
    },
    {
      date: "2026-04-04",
      description: "PAYMENT VIA UOB VISA DIRECT SG",
      expense: "",
      income: "117.80",
      account: "HSBC Visa Revolution",
      category: "Transfer",
      note: "txn date: 2026-04-02",
      type: "transfer"
    }
  ]);
  assert.match(parsed.warnings[0], /local OCR/i);

  const csv = statementRowsToCsv(parsed.rows);
  assert.match(csv, /^date,description,expense,income,account,category,note,type/m);
  assert.match(csv, /2026-03-09,IKEA - ONLINE SINGAPORE,117\.80,,HSBC Visa Revolution,Shopping,txn date: 2026-03-06,expense/);
  assert.match(csv, /2026-04-04,PAYMENT VIA UOB VISA DIRECT SG,,117\.80,HSBC Visa Revolution,Transfer,txn date: 2026-04-02,transfer/);
});

test("HSBC browser OCR fixtures import Feb-Jul 2026 statements", async () => {
  const cases = [
    {
      month: "feb",
      checkpointMonth: "2026-02",
      startDate: "2026-01-06",
      endDate: "2026-02-05",
      rows: []
    },
    {
      month: "mar",
      checkpointMonth: "2026-03",
      startDate: "2026-02-06",
      endDate: "2026-03-05",
      rows: [
        ["2026-02-23", "IKEA SINGAPORE SG", "683.00", "", "Shopping", "txn date: 2026-02-20", "expense"],
        ["2026-03-04", "PAYMENT VIA UOB VISA DIRECT SG", "", "683.00", "Transfer", "txn date: 2026-03-03", "transfer"]
      ]
    },
    {
      month: "apr",
      checkpointMonth: "2026-04",
      startDate: "2026-03-06",
      endDate: "2026-04-05",
      rows: [
        ["2026-03-09", "IKEA - ONLINE SINGAPORE", "117.80", "", "Shopping", "txn date: 2026-03-06", "expense"],
        ["2026-04-04", "PAYMENT VIA UOB VISA DIRECT SG", "", "117.80", "Transfer", "txn date: 2026-04-02", "transfer"]
      ]
    },
    {
      month: "may",
      checkpointMonth: "2026-05",
      startDate: "2026-04-06",
      endDate: "2026-05-05",
      rows: [
        ["2026-05-04", "IKEA SINGAPORE SG", "157.20", "", "Shopping", "txn date: 2026-05-01", "expense"],
        ["2026-05-05", "PAYMENT VIA UOB VISA DIRECT SG", "", "157.20", "Transfer", "txn date: 2026-05-04", "transfer"]
      ]
    },
    {
      month: "jun",
      checkpointMonth: "2026-06",
      startDate: "2026-05-06",
      endDate: "2026-06-05",
      rows: []
    },
    {
      month: "jul",
      checkpointMonth: "2026-07",
      startDate: "2026-06-06",
      endDate: "2026-07-05",
      rows: []
    }
  ];

  for (const item of cases) {
    const tsv = await readFile(`tests/fixtures/hsbc-ocr/browser-2026/hsbc-visa-revolution-${item.month}-2026.browser.tsv`, "utf8");
    const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, `4835-8500-2086-8155-${item.month}_2026.pdf`);
    assert.equal(parsed.parserKey, "hsbc_visa_revolution_ocr_pdf");
    assert.deepEqual(parsed.checkpoints, [{
      accountName: "HSBC Visa Revolution",
      checkpointMonth: item.checkpointMonth,
      statementStartDate: item.startDate,
      statementEndDate: item.endDate,
      statementBalanceMinor: 0,
      previousBalanceMinor: 0,
      note: "Imported from HSBC Visa Revolution OCR statement"
    }]);
    assert.deepEqual(
      parsed.rows.map((row) => [
        row.date,
        row.description,
        row.expense,
        row.income,
        row.category,
        row.note,
        row.type
      ]),
      item.rows,
      item.month
    );
  }
});

test("HSBC OCR parser rejects unrelated OCR TSV", () => {
  assert.throws(
    () => parseStatementText("__OCR_TSV__\nlevel\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tOther"),
    /Unsupported statement PDF|does not look like an HSBC Visa Revolution statement/
  );
});
