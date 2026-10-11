import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  joinOcrTsvPasses,
  parseStatementText,
  statementRowsToCsv
} from "../src/lib/statement-import.ts";

const AUG_TO_OCT_2026 = [
  {
    month: "aug",
    checkpointMonth: "2026-08",
    startDate: "2026-07-06",
    endDate: "2026-08-05",
    statementBalanceMinor: 0,
    rows: [
      ["2026-07-09", "CEBU PAC 06T2FC PAYPAL COM SG", "622.39", "", "Other", "txn date: 2026-07-07", "expense"],
      ["2026-07-13", "UNIQLO GREAT WORLD Singapore SG", "19.80", "", "Other", "txn date: 2026-07-11", "expense"],
      ["2026-07-15", "Shaw Theatres shaw.sg INTERNET SG", "28.00", "", "Entertainment", "txn date: 2026-07-14", "expense"],
      ["2026-07-28", "FAMILY-COM ELECTRONICS SINGAPORE SG", "79.00", "", "Other", "txn date: 2026-07-25", "expense"],
      ["2026-07-29", "APPLE STORE R669 SINGAPORE SG", "3384.86", "", "Other", "txn date: 2026-07-27", "expense"],
      ["2026-08-03", "PAYMENT VIA UOB VISA DIRECT SG", "", "4134.05", "Transfer", "txn date: 2026-08-01", "transfer"]
    ]
  },
  {
    month: "sep",
    checkpointMonth: "2026-09",
    startDate: "2026-08-06",
    endDate: "2026-09-06",
    statementBalanceMinor: 0,
    rows: [
      ["2026-08-08", "MOTHERCARE - PARAGON SINGAPORE SG", "459.00", "", "Other", "txn date: 2026-08-06", "expense"],
      ["2026-08-17", "IKEA SINGAPORE SG", "64.70", "", "Shopping", "txn date: 2026-08-14", "expense"],
      ["2026-09-02", "PAYMENT VIA UOB VISA DIRECT SG", "", "523.70", "Transfer", "txn date: 2026-09-02", "transfer"]
    ]
  },
  {
    month: "oct",
    checkpointMonth: "2026-10",
    startDate: "2026-09-07",
    endDate: "2026-10-05",
    statementBalanceMinor: 21835,
    rows: [
      ["2026-09-16", "KINOKUNIYA-TAKASHIMAYA SINGAPORE SG", "34.95", "", "Education", "txn date: 2026-09-15", "expense"],
      ["2026-09-19", "FAMILY-COM ELECTRONICS SINGAPORE SG", "98.00", "", "Other", "txn date: 2026-09-17", "expense"],
      ["2026-09-26", "I CREATIVE SALON LLP SINGAPORE SG", "37.00", "", "Beauty", "txn date: 2026-09-25", "expense"],
      ["2026-10-02", "Buyandship Limited Hong Kong HK", "18.00", "", "Other", "txn date: 2026-09-30", "expense"],
      ["2026-10-02", "DCC FEE", "0.18", "", "Fees", "txn date: 2026-10-02", "expense"],
      ["2026-10-03", "DCC FEE", "0.30", "", "Fees", "txn date: 2026-10-03", "expense"],
      ["2026-10-03", "Etsy WWW.ETSY.COM IE", "29.92", "", "Other", "txn date: 2026-10-01", "expense"]
    ]
  }
];

function readBrowserOcrFixture(month, pass = "") {
  return readFile(`tests/fixtures/hsbc-ocr/browser-2026/hsbc-visa-revolution-${month}-2026.browser${pass}.tsv`, "utf8");
}

function rowValues(parsed) {
  return parsed.rows.map((row) => [row.date, row.description, row.expense, row.income, row.category, row.note, row.type]);
}

function rowAmounts(parsed) {
  return parsed.rows.map((row) => [row.date, row.expense, row.income, row.note]);
}

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
    const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, `hsbc-visa-revolution-${item.month}_2026.pdf`);
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

test("HSBC command-line OCR fixture keeps noisy rows and reports inferred totals", async () => {
  const tsv = await readFile("tests/fixtures/hsbc-ocr/hsbc-visa-revolution-sep-2026.cli.tsv", "utf8");
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-sep_2026-cli.pdf");

  assert.equal(parsed.rows.length, 7);
  assert.equal(parsed.rows.find((row) => row.description.includes("KINOKUNIYA"))?.expense, "34.95");
  assert.equal(parsed.ocrReview.inferredAmounts.some((item) => item.amount === "34.95"), true);
  assert.equal(parsed.ocrReview.wantsSecondPass, true);
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
    [185, 1058, "09"], [216, 1058, "Jul"], [309, 1058, "07"], [342, 1058, "Ju"], [432, 1058, "CEBUPACOST2FC"], [675, 1058, "«PAYPAL"], [1039, 1058, "622.39"],
    [449, 1105, "OM"], [511, 1105, "SO"],
    [185, 1164, "13"], [216, 1164, "Jul"], [309, 1164, "11"], [342, 1164, "Ju"], [432, 1164, "UNIQLO"], [530, 1164, "GREAT"], [618, 1164, "WORLD"], [1055, 1164, "19.80"],
    [431, 1196, "Singapore"], [572, 1196, "SG"],
    [185, 1250, "15"], [216, 1250, "Jul"], [311, 1250, "14"], [342, 1250, "Jul"], [431, 1250, "Shaw"], [495, 1250, "Theatres"], [597, 1250, "shaw.sg"], [701, 1250, "INTERNET"], [1052, 1250, "28.00"],
    [431, 1282, "SG"],
    [171, 1318, "“zou"], [308, 1318, "25d”"], [432, 1318, "FAMILY-COMELECTRONICS"], [1053, 1318, "7000”"],
    [431, 1369, "SINGAPORE"], [608, 1369, "SG"],
    [182, 1423, "29Jul"], [308, 1423, "27"], [342, 1423, "Ju."], [429, 1423, "APPLE"], [515, 1423, "STORE"], [606, 1423, "R669"], [1020, 1423, "3,384.86"],
    [171, 1455, "SINGAPORE"], [607, 1455, "8G"],
    [183, 1509, "03"], [217, 1509, "Aug"], [309, 1509, "01Aug"], [432, 1509, "PAYMENT"], [557, 1509, "VIA"], [609, 1509, "UOB"], [719, 1509, "VISA"], [1014, 1509, "4,134.05CR"],
    [171, 1542, "RECT"], [552, 1542, "SG"], [612, 1542, "ser"], [665, 1542, "ners"],
    [431, 1592, "Total"], [543, 1592, "Due"], [1038, 1589, "0.00"]
  ]);

  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-aug.pdf");

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

test("HSBC browser OCR returns a recovery review when transaction rows are not readable", () => {
  const tsv = buildOcrTsv([
    [171, 215, "HSBC"], [318, 215, "VISA"], [448, 215, "REVOLUTION"],
    [181, 600, "From"], [265, 600, "06"], [308, 600, "JUL"], [375, 600, "2026"],
    [454, 600, "to"], [492, 600, "05"], [535, 600, "AUG"], [614, 600, "2026"],
    [1190, 893, "Previous"], [1304, 893, "Statement"], [1441, 893, "Balance"], [1688, 893, "0.00"],
    [1190, 932, "Payments"], [1321, 932, "&"], [1347, 932, "Credits"], [1633, 932, "100.00CR"],
    [1190, 971, "Purchases"], [1328, 971, "&"], [1356, 971, "Debits"], [1633, 971, "100.00"],
    [1188, 1088, "Total"], [1261, 1088, "Account"], [1379, 1088, "Balance"], [1685, 1106, "0.00"]
  ]);

  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-aug.pdf");
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.reconciliation, { expectedDebitMinor: 10000, expectedCreditMinor: 10000, candidates: [] });
  assert.equal(parsed.ocrReview.wantsSecondPass, true);
});

test("HSBC OCR parser rejects unrelated OCR TSV", () => {
  assert.throws(
    () => parseStatementText("__OCR_TSV__\nlevel\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tOther"),
    /Unsupported statement PDF|does not look like an HSBC Visa Revolution statement/
  );
});

// Real Aug-Oct 2026 statements, OCR'd in the browser twice (page layout
// modes 4 and 6) and sanitized. Each pass misreads something the other reads.
test("HSBC browser OCR imports Aug-Oct 2026 statements from two OCR passes", async () => {
  for (const item of AUG_TO_OCT_2026) {
    const text = joinOcrTsvPasses([await readBrowserOcrFixture(item.month), await readBrowserOcrFixture(item.month, "-pass2")]);
    const parsed = parseStatementText(text, `hsbc-visa-revolution-${item.month}_2026.pdf`);
    assert.deepEqual(parsed.checkpoints, [{
      accountName: "HSBC Visa Revolution",
      checkpointMonth: item.checkpointMonth,
      statementStartDate: item.startDate,
      statementEndDate: item.endDate,
      statementBalanceMinor: item.statementBalanceMinor,
      previousBalanceMinor: 0,
      note: "Imported from HSBC Visa Revolution OCR statement"
    }], item.month);
    assert.deepEqual(rowValues(parsed), item.rows, item.month);
    // Every amount was read by at least one pass, so none is inferred.
    assert.deepEqual(parsed.ocrReview, { passCount: 2, inferredAmounts: [], wantsSecondPass: false }, item.month);
  }
});

test("HSBC OCR drops a dotted rule Tesseract reads as one-pixel-tall words", async () => {
  // OCR of the sanitized May image PDF reads the dotted rule under IKEA as
  // "Si ans ns So aso sata Sista" at up to 35% confidence.
  const parsed = parseStatementText(`__OCR_TSV__\n${await readBrowserOcrFixture("may", "-sanitized-pdf")}`, "hsbc-visa-revolution-may_2026.pdf");
  assert.deepEqual(rowValues(parsed), [
    ["2026-05-04", "IKEA SINGAPORE SG", "157.20", "", "Shopping", "txn date: 2026-05-01", "expense"],
    ["2026-05-05", "PAYMENT VIA UOB VISA DIRECT SG", "", "157.20", "Transfer", "txn date: 2026-05-04", "transfer"]
  ]);
});

test("HSBC first OCR pass reads Oct 2026 transaction dates printed as 010ct", async () => {
  const parsed = parseStatementText(`__OCR_TSV__\n${await readBrowserOcrFixture("oct")}`, "hsbc-visa-revolution-oct_2026.pdf");
  assert.deepEqual(rowAmounts(parsed), AUG_TO_OCT_2026[2].rows.map(([date, , expense, income, , note]) => [date, expense, income, note]));
});

test("HSBC first OCR pass never moves a missing amount onto a row it read", async () => {
  // Pass 1 cannot read IKEA's 64.70. MOTHERCARE keeps the 459.00 it read and
  // IKEA takes the only amount the purchases total leaves; the parse asks for
  // a second pass to read it instead of inferring it.
  const parsed = parseStatementText(`__OCR_TSV__\n${await readBrowserOcrFixture("sep")}`, "hsbc-visa-revolution-sep_2026.pdf");
  assert.deepEqual(rowAmounts(parsed), [
    ["2026-08-08", "459.00", "", "txn date: 2026-08-06"],
    ["2026-08-17", "64.70", "", "txn date: 2026-08-14"],
    ["2026-09-02", "", "523.70", "txn date: 2026-09-02"]
  ]);
  const { cellRegions, referenceSize, ...review } = parsed.ocrReview;
  assert.deepEqual(review, {
    passCount: 1,
    inferredAmounts: [{ date: "2026-08-17", description: "IKEA SINGAPORE SG", amount: "64.70" }],
    wantsSecondPass: true
  });
  // The app is asked to read each row's two dates and its amount on their own.
  assert.deepEqual(referenceSize, { width: 1820, height: 2572 });
  assert.deepEqual(cellRegions.map((region) => [region.page, region.left, region.top, region.right, region.bottom, region.characters]), [
    [1, 160, 1067, 270, 1107, "date"], [1, 290, 1067, 400, 1107, "date"], [1, 960, 1067, 1160, 1107, "amount"],
    [1, 160, 1154, 270, 1194, "date"], [1, 290, 1154, 400, 1194, "date"], [1, 960, 1154, 1160, 1194, "amount"],
    [1, 160, 1208, 270, 1248, "date"], [1, 290, 1208, 400, 1248, "date"], [1, 960, 1208, 1160, 1248, "amount"]
  ]);
});

test("HSBC first OCR pass asks for a second pass when a description is barely legible", async () => {
  const parsed = parseStatementText(`__OCR_TSV__\n${await readBrowserOcrFixture("aug")}`, "hsbc-visa-revolution-aug_2026.pdf");
  assert.deepEqual(rowAmounts(parsed), AUG_TO_OCT_2026[0].rows.map(([date, , expense, income, , note]) => [date, expense, income, note]));
  assert.equal(parsed.ocrReview.wantsSecondPass, true);
  assert.deepEqual(parsed.ocrReview.inferredAmounts, []);
});

test("HSBC OCR returns a recovery review when two amounts are unreadable", async () => {
  // Damage MOTHERCARE's 459.00 as well as IKEA's: the purchases total can no
  // longer say which row takes what, so nothing is guessed.
  const tsv = (await readBrowserOcrFixture("sep")).replace(/\t459\.00$/m, "\t4S9.O");
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-sep_2026.pdf");
  // The payment it could read goes to review; both purchases are listed for
  // their amounts to be typed from the PDF, and no amount is offered.
  assert.deepEqual(rowAmounts(parsed), [["2026-09-02", "", "523.70", "txn date: 2026-09-02"]]);
  assert.equal(parsed.reconciliation.expectedDebitMinor, 52370);
  assert.equal(parsed.reconciliation.expectedCreditMinor, 52370);
  assert.deepEqual(parsed.reconciliation.candidates.map((candidate) => [
    candidate.evidence, candidate.row.date, candidate.row.description, candidate.row.expense, candidate.amountMinor, candidate.isCredit
  ]), [
    ["unread-amount", "2026-08-08", "MOTHERCARE - PARAGON SINGAPORE SC", "", undefined, false],
    ["unread-amount", "2026-08-17", "IKEA SINGAPORE SG", "", undefined, false]
  ]);
});

test("HSBC OCR takes a lone purchase's amount from the total and reports it", () => {
  // With one purchase, the purchases total is that purchase's amount, and the
  // balance confirms the total. The misread 459.00 is replaced, reported as
  // inferred, and a second OCR pass is requested.
  const tsv = buildOcrTsv([
    [171, 215, "HSBC"], [318, 215, "VISA"], [448, 215, "REVOLUTION"],
    [181, 600, "From"], [265, 600, "06"], [308, 600, "AUG"], [375, 600, "2026"],
    [454, 600, "to"], [492, 600, "06"], [535, 600, "SEP"], [614, 600, "2026"],
    [1190, 893, "Previous"], [1304, 893, "Statement"], [1441, 893, "Balance"], [1688, 893, "0.00"],
    [1190, 932, "Payments"], [1321, 932, "&"], [1347, 932, "Credits"], [1633, 932, "0.00"],
    [1190, 971, "Purchases"], [1328, 971, "&"], [1356, 971, "Debits"], [1633, 971, "523.70"],
    [1188, 1088, "Total"], [1261, 1088, "Account"], [1379, 1088, "Balance"], [1685, 1106, "523.70"],
    [183, 1077, "08Aug"], [310, 1077, "06Aug"], [431, 1077, "MOTHERCARE"], [1040, 1077, "459.00"]
  ]);
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-sep.pdf");
  assert.deepEqual(rowAmounts(parsed), [["2026-08-08", "523.70", "", "txn date: 2026-08-06"]]);
  assert.deepEqual(parsed.ocrReview.inferredAmounts, [{ date: "2026-08-08", description: "MOTHERCARE", amount: "523.70" }]);
  assert.equal(parsed.ocrReview.wantsSecondPass, true);
  assert.equal(parsed.ocrReview.cellRegions.length, 3);
});

test("HSBC OCR returns a reconciliation review when the statement balance does not agree", () => {
  // The same lone purchase, but the printed balance contradicts the
  // purchases total, so the total cannot be trusted to replace the reading.
  const tsv = buildOcrTsv([
    [171, 215, "HSBC"], [318, 215, "VISA"], [448, 215, "REVOLUTION"],
    [181, 600, "From"], [265, 600, "06"], [308, 600, "AUG"], [375, 600, "2026"],
    [454, 600, "to"], [492, 600, "06"], [535, 600, "SEP"], [614, 600, "2026"],
    [1190, 893, "Previous"], [1304, 893, "Statement"], [1441, 893, "Balance"], [1688, 893, "0.00"],
    [1190, 932, "Payments"], [1321, 932, "&"], [1347, 932, "Credits"], [1633, 932, "0.00"],
    [1190, 971, "Purchases"], [1328, 971, "&"], [1356, 971, "Debits"], [1633, 971, "523.70"],
    [1188, 1088, "Total"], [1261, 1088, "Account"], [1379, 1088, "Balance"], [1685, 1106, "459.00"],
    [183, 1077, "08Aug"], [310, 1077, "06Aug"], [431, 1077, "MOTHERCARE"], [1040, 1077, "459.00"]
  ]);
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-sep.pdf");
  // A misread amount leaves no candidate: the user corrects it in the rows.
  assert.deepEqual(rowAmounts(parsed), [["2026-08-08", "459.00", "", "txn date: 2026-08-06"]]);
  assert.deepEqual(parsed.reconciliation, { expectedDebitMinor: 52370, expectedCreditMinor: 0, candidates: [] });
});

test("HSBC OCR second pass returns a hard reconciliation review when it still cannot reconcile", async () => {
  // MOTHERCARE's and IKEA's amounts are damaged in both passes, leaving two
  // unknown purchases that the total cannot split.
  const damage = (tsv) => tsv.replace(/\t459\.00$/m, "\t4S9.O").replace(/\t64\.70$/m, "\t6A.7O");
  const text = joinOcrTsvPasses([damage(await readBrowserOcrFixture("sep")), damage(await readBrowserOcrFixture("sep", "-pass2"))]);
  const parsed = parseStatementText(text, "hsbc-visa-revolution-sep_2026.pdf");
  assert.deepEqual(parsed.reconciliation.candidates.map((candidate) => [candidate.evidence, candidate.row.description, candidate.amountMinor]), [
    ["unread-amount", "MOTHERCARE - PARAGON SINGAPORE SG", undefined],
    ["unread-amount", "IKEA SINGAPORE SG", undefined]
  ]);
  assert.equal(parsed.ocrReview.wantsSecondPass, false);
});

test("HSBC OCR offers a dropped row's read amount when it is exactly the missing difference", async () => {
  // The Oct 2026 failure in production: Etsy's dates were unreadable, so its
  // line was not a row, yet OCR read its 29.92. The 29.92 is the one leftover
  // amount and equals the purchases difference, so it is offered with the date
  // of the row above it for the user to confirm against the PDF.
  const tsv = (await readBrowserOcrFixture("oct"))
    .replace(/\t03Oct$/m, "\t~")
    .replace(/\t010ct$/m, "\t~");
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-oct_2026.pdf");
  assert.equal(parsed.rows.length, 6);
  assert.equal(parsed.rows.some((row) => /Etsy/i.test(row.description)), false);
  assert.equal(parsed.reconciliation.expectedDebitMinor, 21835);
  assert.deepEqual(parsed.reconciliation.candidates.map((candidate) => [
    candidate.evidence, candidate.row.date, candidate.row.description, candidate.amountMinor, candidate.isCredit
  ]), [["leftover-amount", "2026-10-02", "Etsy WWW.ETSY.COM", 2992, false]]);
});

test("HSBC OCR never gives a dropped row's amount to an unread row", async () => {
  // Etsy's line is dropped and DCC FEE's 0.30 is unreadable too. One unknown
  // purchase would normally take the difference, but the leftover 29.92 shows
  // a whole row may be missing, so DCC FEE is not given 30.22: both are listed.
  const tsv = (await readBrowserOcrFixture("oct"))
    .replace(/\t03Oct$/m, "\t~")
    .replace(/\t010ct$/m, "\t~")
    .replace(/\t0\.30$/m, "\t0.3");
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-oct_2026.pdf");
  assert.equal(parsed.rows.some((row) => row.description === "DCC FEE" && row.expense === "30.22"), false);
  assert.deepEqual(parsed.reconciliation.candidates.map((candidate) => [candidate.evidence, candidate.row.description, candidate.amountMinor]), [
    ["unread-amount", "DCC FEE", undefined],
    ["leftover-amount", "Etsy WWW.ETSY.COM", 2992]
  ]);
});

test("HSBC OCR reads a row's amount from its merchant's second line", () => {
  const tsv = buildOcrTsv([
    [171, 215, "HSBC"], [318, 215, "VISA"], [448, 215, "REVOLUTION"],
    [181, 600, "From"], [265, 600, "06"], [308, 600, "AUG"], [375, 600, "2026"],
    [454, 600, "to"], [492, 600, "06"], [535, 600, "SEP"], [614, 600, "2026"],
    [1190, 893, "Previous"], [1304, 893, "Statement"], [1441, 893, "Balance"], [1688, 893, "0.00"],
    [1190, 932, "Payments"], [1321, 932, "&"], [1347, 932, "Credits"], [1633, 932, "0.00"],
    [1190, 971, "Purchases"], [1328, 971, "&"], [1356, 971, "Debits"], [1633, 971, "523.70"],
    [1188, 1088, "Total"], [1261, 1088, "Account"], [1379, 1088, "Balance"], [1685, 1106, "523.70"],
    [183, 1077, "08Aug"], [310, 1077, "06Aug"], [431, 1077, "MOTHERCARE"], [1040, 1077, "459.00"],
    [184, 1164, "17Aug"], [311, 1164, "14Aug"], [431, 1164, "IKEA"],
    [431, 1196, "SINGAPORE"], [607, 1196, "SG"], [1053, 1196, "64.70"]
  ]);
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "hsbc-visa-revolution-sep.pdf");
  assert.deepEqual(rowAmounts(parsed), [
    ["2026-08-08", "459.00", "", "txn date: 2026-08-06"],
    ["2026-08-17", "64.70", "", "txn date: 2026-08-14"]
  ]);
  assert.equal(parsed.reconciliation, undefined);
  assert.deepEqual(parsed.ocrReview.inferredAmounts, []);
});

function buildOcrTsv(words) {
  return [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    ...words.map(([left, top, text], index) => (
      `5\t1\t1\t1\t${index + 1}\t1\t${left}\t${top}\t50\t20\t90\t${text}`
    ))
  ].join("\n");
}

// Cells the parser pointed at, OCR'd one by one (sanitized image PDFs): each
// row's two dates and its amount, restricted to their characters.
function cellPass(month) {
  return readBrowserOcrFixture(month, "-cells").then((tsv) => ({ kind: "cells", tsv }));
}

test("HSBC cell reads settle every Aug-Oct 2026 amount and date without inferring any", async () => {
  for (const item of AUG_TO_OCT_2026) {
    const text = joinOcrTsvPasses([
      await readBrowserOcrFixture(item.month),
      await readBrowserOcrFixture(item.month, "-pass2"),
      await cellPass(item.month)
    ]);
    const parsed = parseStatementText(text, `hsbc-visa-revolution-${item.month}_2026.pdf`);
    assert.deepEqual(rowValues(parsed), item.rows, item.month);
    assert.deepEqual(parsed.ocrReview.inferredAmounts, [], item.month);
    assert.equal(parsed.reconciliation, undefined, item.month);
  }
});

test("HSBC cell reads read March's IKEA 683.00 that the page pass missed", async () => {
  // OCR of the sanitized March image PDF cannot read IKEA's amount, so the
  // page pass alone takes it from the purchases total.
  const pagePass = await readBrowserOcrFixture("mar", "-sanitized-pdf");
  const first = parseStatementText(`__OCR_TSV__\n${pagePass}`, "hsbc-visa-revolution-mar_2026.pdf");
  assert.deepEqual(first.ocrReview.inferredAmounts.map((item) => item.amount), ["683.00"]);
  const parsed = parseStatementText(joinOcrTsvPasses([pagePass, await cellPass("mar")]), "hsbc-visa-revolution-mar_2026.pdf");
  assert.deepEqual(rowAmounts(parsed), [
    ["2026-02-23", "683.00", "", "txn date: 2026-02-20"],
    ["2026-03-04", "", "683.00", "txn date: 2026-03-03"]
  ]);
  assert.deepEqual(parsed.ocrReview.inferredAmounts, []);
});

test("HSBC cell reads recover a row whose dates the page passes could not read", async () => {
  // Etsy's dates are unreadable on the page, so its line is only a leftover;
  // its cells read 03 Oct, 01 Oct and 29.92, and the row comes back whole.
  const damagedFirst = (await readBrowserOcrFixture("oct")).replace(/\t03Oct$/m, "\t~").replace(/\t010ct$/m, "\t~");
  const parsed = parseStatementText(joinOcrTsvPasses([damagedFirst, await cellPass("oct")]), "hsbc-visa-revolution-oct_2026.pdf");
  assert.equal(parsed.reconciliation, undefined);
  assert.deepEqual(parsed.ocrReview.inferredAmounts, []);
  assert.deepEqual(
    parsed.rows.filter((row) => /Etsy/.test(row.description)).map((row) => [row.date, row.description, row.expense, row.note]),
    [["2026-10-03", "Etsy WWW.ETSY.COM", "29.92", "txn date: 2026-10-01"]]
  );
});

test("HSBC cell reads cannot slip a wrong amount past the statement totals", async () => {
  // A cell misreads IKEA as 84.70. Without another reading the totals refuse
  // it and the statement goes to the recovery review, never certified.
  const wrongCells = (await readBrowserOcrFixture("sep", "-cells")).replace(/\t64\.70$/m, "\t84.70");
  const parsed = parseStatementText(
    joinOcrTsvPasses([await readBrowserOcrFixture("sep"), { kind: "cells", tsv: wrongCells }]),
    "hsbc-visa-revolution-sep_2026.pdf"
  );
  assert.equal(parsed.reconciliation.expectedDebitMinor, 52370);
  assert.equal(parsed.rows.some((row) => row.description === "IKEA SINGAPORE SG" && row.expense === "64.70"), false);
  // With the second page pass's 64.70 as well, the totals pick the right one.
  const withSecond = parseStatementText(
    joinOcrTsvPasses([await readBrowserOcrFixture("sep"), await readBrowserOcrFixture("sep", "-pass2"), { kind: "cells", tsv: wrongCells }]),
    "hsbc-visa-revolution-sep_2026.pdf"
  );
  assert.equal(withSecond.reconciliation, undefined);
  assert.equal(withSecond.rows.find((row) => row.description === "IKEA SINGAPORE SG").expense, "64.70");
});
