import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStatementText } from "../src/lib/statement-import.ts";

// iFAST Wrap monthly statements, extracted with pdf.js 4 from four real
// statements and masked item by item (name, address, adviser, account
// number); every two-decimal amount is scaled by an undisclosed factor. See
// tests/fixtures/pdf-statement-text/README.md.
function readFixture(name) {
  return readFileSync(new URL(`./fixtures/pdf-statement-text/${name}-sanitized.pdf-text.txt`, import.meta.url), "utf8");
}

function parseFixture(name) {
  return parseStatementText(readFixture(name), `${name}.pdf`);
}

const RSP_ROW = (date) => ({
  date,
  description: "iFAST RSP via eGIRO, LGI-iFAST Tactical Opportunities Plan",
  expense: "",
  income: "685.00",
  account: "Alex iFAST",
  category: "Transfer",
  note: "",
  type: "transfer"
});

test("the June statement gives its period, total assets and the one eGIRO contribution", () => {
  const parsed = parseFixture("ifast-wrap-jun-2026-real");
  assert.equal(parsed.parserKey, "ifast_wrap_pdf");
  assert.deepEqual(parsed.rows, [RSP_ROW("2026-06-08")]);
  assert.deepEqual(parsed.checkpoints, [{
    accountName: "Alex iFAST",
    checkpointMonth: "2026-06",
    statementStartDate: "2026-06-01",
    statementEndDate: "2026-06-30",
    statementBalanceMinor: 69181,
    accountLast4: "0194",
    investmentValue: {
      accountReference: "P0000194",
      currency: "SGD",
      totalAssetsMinor: 69181,
      marketValueMinor: 69181,
      cashMinor: 0,
      incomeMinor: 0
    },
    note: "Imported from iFAST Wrap statement"
  }]);
  assert.deepEqual(parsed.warnings, []);
});

test("the July statement ignores every unit switch and reads only the plan's RSP contribution", () => {
  const parsed = parseFixture("ifast-wrap-jul-2026-real");
  // The statement lists a Switch Sell, a Switch Buy and nine RSP unit rows:
  // none of them is money crossing the bank.
  assert.deepEqual(parsed.rows, [RSP_ROW("2026-07-08")]);
  assert.equal(parsed.checkpoints[0].checkpointMonth, "2026-07");
  assert.equal(parsed.checkpoints[0].statementEndDate, "2026-07-31");
  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 137467);
  assert.equal(parsed.checkpoints[0].investmentValue.cashMinor, 0);
});

test("the August statement reads one contribution on the 11th and the larger total assets", () => {
  const parsed = parseFixture("ifast-wrap-aug-2026-real");
  assert.deepEqual(parsed.rows, [RSP_ROW("2026-08-11")]);
  assert.deepEqual(
    [parsed.checkpoints[0].checkpointMonth, parsed.checkpoints[0].statementEndDate, parsed.checkpoints[0].statementBalanceMinor],
    ["2026-08", "2026-08-31", 205843]
  );
});

test("a month with no contribution still gives its total assets, and a reinvested dividend is not a row", () => {
  const parsed = parseFixture("ifast-wrap-sep-2026-real");
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(
    [parsed.checkpoints[0].checkpointMonth, parsed.checkpoints[0].statementEndDate, parsed.checkpoints[0].statementBalanceMinor, parsed.checkpoints[0].accountLast4],
    ["2026-09", "2026-09-30", 202390, "0194"]
  );
  assert.equal(parsed.checkpoints[0].investmentValue.incomeMinor, 0);
  assert.deepEqual(parsed.warnings, []);
});

test("the source label comes from the file name", () => {
  assert.equal(parseFixture("ifast-wrap-sep-2026-real").sourceLabel, "ifast-wrap-sep-2026-real");
});

// Rewrites the fixture's raw text items (the view the parser reads) to build
// a variant. Each replacement is a regular expression over the raw view.
function variant(name, replacements) {
  const text = readFixture(name);
  const marker = "__PDF_LAYOUT_TEXT__";
  const raw = replacements.reduce((current, [from, to]) => {
    assert.ok(from.test(current), `fixture has no ${from}`);
    return current.replace(from, to);
  }, text.split(marker)[0]);
  return `${raw}${marker}${text.split(marker).slice(1).join(marker)}`;
}

test("a plan row that redeems to the bank is a transfer out of the investment account", () => {
  const text = variant("ifast-wrap-jul-2026-real", [[/RSP\n \neGIRO\n \nSGD 685\.00/, "Redemption\n \nBank Transfer\n \nSGD 120.50"]]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.expense, row.income, row.type]), [["2026-07-08", "120.50", "", "transfer"]]);
  assert.equal(parsed.rows[0].description, "iFAST Redemption via Bank Transfer, LGI-iFAST Tactical Opportunities Plan");
});

test("a lump sum and a plan name wrapped over two cells are read from a split amount", () => {
  const text = variant("ifast-wrap-jul-2026-real", [[
    /LGI-iFAST Tactical Opportunities Plan\n \nRSP\n \neGIRO\n \nSGD 685\.00/,
    "LGI-iFAST Tactical\nOpportunities Plan\n \nLump Sum\n \nCash\n \nSGD\n1,250.00"
  ]]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows.map((row) => [row.description, row.income]), [["iFAST Lump Sum via Cash, LGI-iFAST Tactical Opportunities Plan", "1250.00"]]);
});

test("a statement whose summary has cash solutions adds them to the market value", () => {
  const text = variant("ifast-wrap-jul-2026-real", [[/SGD 0\.00\n \nSGD 1,374\.67\n\nINCOME SUMMARY/, "SGD 25.00\n \nSGD 1,399.67\n\nINCOME SUMMARY"]]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 139967);
  assert.equal(parsed.checkpoints[0].investmentValue.cashMinor, 2500);
  assert.equal(parsed.checkpoints[0].investmentValue.marketValueMinor, 137467);
});

test("income from the income summary is kept on the value, never as a row", () => {
  const text = variant("ifast-wrap-sep-2026-real", [[/Total Income\n\nSGD 0\.00\n \nSGD 0\.00\n \nSGD 0\.00/, "Total Income\n\nSGD 1.10\n \nSGD 2.20\n \nSGD 3.30"]]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.checkpoints[0].investmentValue.incomeMinor, 330);
});

test("a negative profit and loss column does not disturb the total", () => {
  // September's holdings print negative P/L (SGD -x.xx); the value is the account summary's.
  const parsed = parseFixture("ifast-wrap-sep-2026-real");
  assert.ok(readFixture("ifast-wrap-sep-2026-real").includes("SGD -"));
  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 202390);
});

test("a statement in another currency is refused in plain words", () => {
  const text = variant("ifast-wrap-jul-2026-real", [[/Statement Currency\n \nSGD/, "Statement Currency\n \nUSD"]]);
  assert.throws(() => parseStatementText(text, "x.pdf"), /USD/);
});

test("a truncated statement (transaction page missing) fails with a clear message", () => {
  const full = readFixture("ifast-wrap-jul-2026-real");
  const raw = full.split("__PDF_LAYOUT_TEXT__")[0];
  const cut = raw.slice(0, raw.indexOf("INVESTMENT TRANSACTION"));
  assert.throws(
    () => parseStatementText(`${cut}\n__PDF_LAYOUT_TEXT__\n${cut}\n__PDF_SPACED_LAYOUT_TEXT__\n${cut}`, "x.pdf"),
    /iFAST statement.*cut short/i
  );
});

test("a statement with no account summary figures is refused", () => {
  const text = variant("ifast-wrap-jul-2026-real", [[/SGD 1,374\.67\n \nSGD 0\.00\n \nSGD 1,374\.67\n\nINCOME SUMMARY/, "\n\nINCOME SUMMARY"]]);
  assert.throws(() => parseStatementText(text, "x.pdf"), /account summary/i);
});

test("bank statements are not mistaken for an iFAST statement, even when they mention iFAST", () => {
  const ocbc = readFixture("ocbc-360-jul-2026-real").replace("IFAST FINANCIAL PL-", "IFAST FINANCIAL PL- P0000194");
  assert.equal(parseStatementText(ocbc, "ocbc.pdf").parserKey, "ocbc_360_pdf");
  assert.equal(parseStatementText(readFixture("uob-one-savings-apr-2026"), "uob.pdf").parserKey, "uob_savings_pdf");
});

test("text that is neither a recognised bank nor an iFAST statement is still refused", () => {
  assert.throws(() => parseStatementText("hello\n__PDF_LAYOUT_TEXT__\nhello", "x.pdf"), /Unsupported statement PDF/);
});
