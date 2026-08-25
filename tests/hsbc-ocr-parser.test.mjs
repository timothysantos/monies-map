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

test("HSBC browser OCR computes checkpoint when total account label is damaged", async () => {
  const tsv = await readFile("tests/fixtures/hsbc-ocr/browser-2026/hsbc-visa-revolution-may-2026.browser.tsv", "utf8");
  const damagedTotalLabelTsv = tsv
    .replace(/(\t1261\t1088\t105\t20\t[^\t]+\t)Account/g, "$1Ascaunt")
    .replace(/(\t1379\t1088\t99\t20\t[^\t]+\t)Balance/g, "$1Balanze");
  const parsed = parseStatementText(`__OCR_TSV__\n${damagedTotalLabelTsv}`, "hsbc-visa-revolution-may-2026.sanitized.pdf");

  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 0);
  assert.deepEqual(
    parsed.rows.map((row) => [row.date, row.description, row.expense, row.income]),
    [
      ["2026-05-04", "IKEA SINGAPORE SG", "157.20", ""],
      ["2026-05-05", "PAYMENT VIA UOB VISA DIRECT SG", "", "157.20"]
    ]
  );
});

test("HSBC browser OCR imports Aug 2026 image statement rows below the summary band", () => {
  const tsv = buildOcrTsv([
    [171, 215, "HSBC"], [318, 215, "VISA"], [448, 215, "REVOLUTION"],
    [181, 600, "From"], [265, 600, "06"], [308, 600, "JUL"], [375, 600, "2026"],
    [454, 600, "to"], [492, 600, "05"], [535, 600, "AUG"], [614, 600, "2026"],
    [177, 861, "POST"], [312, 861, "TRAN"], [177, 902, "DATE"], [314, 902, "DATE"],
    [432, 902, "DESCRIPTION"], [854, 889, "AMOUNT(SGD)"],
    [1190, 893, "Previous"], [1304, 893, "Statement"], [1441, 893, "Balance"], [1688, 893, "0.00"],
    [1190, 932, "Payments"], [1321, 932, "&"], [1347, 932, "Credits"], [1633, 932, "4,134.05CR"],
    [1190, 971, "Purchases"], [1328, 971, "&"], [1356, 971, "Debits"], [1633, 971, "4,134.05"],
    [432, 1018, "Previous"], [531, 1018, "Statement"], [647, 1018, "Balance"], [1063, 1018, "0.00"],
    [1188, 1088, "Total"], [1261, 1088, "Account"], [1379, 1088, "Balance"], [1685, 1106, "0.00"],
    [185, 1058, "09"], [216, 1058, "Jul"], [309, 1058, "O7Jul««CEBUPACOST2FC"], [675, 1058, "«PAYPAL"], [1039, 1058, "622.39"],
    [449, 1105, "OM"], [511, 1105, "SO"],
    [185, 1164, "13"], [216, 1164, "Jul"], [311, 1164, "11"], [342, 1164, "Jul"], [432, 1164, "UNIQLO"], [530, 1164, "GREAT"], [618, 1164, "WORLD"], [1055, 1164, "19.80"],
    [431, 1196, "Singapore"], [572, 1196, "SG"],
    [185, 1250, "15"], [216, 1250, "Jul"], [311, 1250, "14"], [342, 1250, "Jul"], [431, 1250, "Shaw"], [495, 1250, "Theatres"], [597, 1250, "shaw.sg"], [701, 1250, "INTERNET"], [1052, 1250, "28.00"],
    [431, 1282, "SG"],
    [171, 1318, "“zou"], [308, 1318, "25d”"], [432, 1318, "FAMILY-COMELECTRONICS"], [1053, 1318, "7000”"],
    [431, 1369, "SINGAPORE"], [608, 1369, "SG"],
    [182, 1423, "29Jul"], [308, 1423, "27"], [342, 1423, "Jul."], [429, 1423, "APPLE"], [515, 1423, "STORE"], [606, 1423, "R669"], [1020, 1423, "3,384.86"],
    [171, 1455, "SINGAPORE"], [607, 1455, "8G"],
    [183, 1509, "03"], [217, 1509, "Aug"], [309, 1509, "01Aug"], [432, 1509, "PAYMENT"], [557, 1509, "VIA"], [609, 1509, "UOB"], [719, 1509, "VISA"], [1014, 1509, "4,134.05CR"],
    [171, 1542, "RECT"], [552, 1542, "SG"],
    [431, 1592, "Total"], [543, 1592, "Due"], [1038, 1589, "0.00"]
  ]);

  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "4835-8500-2086-8155-aug.pdf");

  assert.deepEqual(parsed.checkpoints, [{
    accountName: "HSBC Visa Revolution",
    checkpointMonth: "2026-08",
    statementStartDate: "2026-07-06",
    statementEndDate: "2026-08-05",
    statementBalanceMinor: 0,
    previousBalanceMinor: 0,
    note: "Imported from HSBC Visa Revolution OCR statement"
  }]);
  assert.deepEqual(
    parsed.rows.map((row) => [row.date, row.description, row.expense, row.income, row.category, row.note, row.type]),
    [
      ["2026-07-09", "CEBU PAC 06T2FC PAYPAL COM SG", "622.39", "", "Other", "txn date: 2026-07-07", "expense"],
      ["2026-07-13", "UNIQLO GREAT WORLD Singapore SG", "19.80", "", "Other", "txn date: 2026-07-11", "expense"],
      ["2026-07-15", "Shaw Theatres shaw.sg INTERNET SG", "28.00", "", "Entertainment", "txn date: 2026-07-14", "expense"],
      ["2026-07-28", "FAMILY-COM ELECTRONICS SINGAPORE SG", "79.00", "", "Other", "txn date: 2026-07-25", "expense"],
      ["2026-07-29", "APPLE STORE R669 SINGAPORE SG", "3384.86", "", "Other", "txn date: 2026-07-27", "expense"],
      ["2026-08-03", "PAYMENT VIA UOB VISA DIRECT SG", "", "4134.05", "Transfer", "txn date: 2026-08-01", "transfer"]
    ]
  );
});

test("HSBC browser OCR rejects active summaries when transaction rows are not readable", () => {
  const tsv = buildOcrTsv([
    [171, 215, "HSBC"], [318, 215, "VISA"], [448, 215, "REVOLUTION"],
    [181, 600, "From"], [265, 600, "06"], [308, 600, "JUL"], [375, 600, "2026"],
    [454, 600, "to"], [492, 600, "05"], [535, 600, "AUG"], [614, 600, "2026"],
    [1190, 893, "Previous"], [1304, 893, "Statement"], [1441, 893, "Balance"], [1688, 893, "0.00"],
    [1190, 932, "Payments"], [1321, 932, "&"], [1347, 932, "Credits"], [1633, 932, "100.00CR"],
    [1190, 971, "Purchases"], [1328, 971, "&"], [1356, 971, "Debits"], [1633, 971, "100.00"],
    [1188, 1088, "Total"], [1261, 1088, "Account"], [1379, 1088, "Balance"], [1685, 1106, "0.00"]
  ]);

  assert.throws(
    () => parseStatementText(`__OCR_TSV__\n${tsv}`, "4835-8500-2086-8155-aug.pdf"),
    /HSBC statement purchases did not reconcile/
  );
});

test("HSBC OCR parser rejects unrelated OCR TSV", () => {
  assert.throws(
    () => parseStatementText("__OCR_TSV__\nlevel\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tOther"),
    /Unsupported statement PDF|does not look like an HSBC Visa Revolution statement/
  );
});

function buildOcrTsv(words) {
  return [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    ...words.map(([left, top, text], index) => (
      `5\t1\t1\t1\t${index + 1}\t1\t${left}\t${top}\t50\t20\t90\t${text}`
    ))
  ].join("\n");
}
