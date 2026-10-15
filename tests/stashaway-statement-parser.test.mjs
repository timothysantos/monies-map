import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStatementText } from "../src/lib/statement-import.ts";

// StashAway monthly "Statement of Account" PDFs (January to September 2026,
// one account), extracted with pdf.js 4 from real statements and masked item
// by item (owner, address, account reference code); every two-decimal dollar
// amount is scaled by one undisclosed factor and the returns cell of each
// summary row is recomputed so it still adds up. See
// tests/fixtures/pdf-statement-text/README.md.
function readFixture(name) {
  return readFileSync(new URL(`./fixtures/pdf-statement-text/${name}-sanitized.pdf-text.txt`, import.meta.url), "utf8");
}

const MARKER = "__PDF_LAYOUT_TEXT__";

// Rewrites the fixture's raw text items (the view the parser reads) to build a
// variant. Each replacement is a regular expression over the raw view.
function variant(name, replacements) {
  const text = readFixture(name);
  const raw = replacements.reduce((current, [from, to]) => {
    assert.ok(from.test(current), `fixture has no ${from}`);
    return current.replace(from, to);
  }, text.split(MARKER)[0]);
  return `${raw}${MARKER}${text.split(MARKER).slice(1).join(MARKER)}`;
}

function cut(name, before) {
  const raw = readFixture(name).split(MARKER)[0];
  const kept = raw.slice(0, raw.indexOf(before));
  return `${kept}\n${MARKER}\n${kept}\n__PDF_SPACED_LAYOUT_TEXT__\n${kept}`;
}

const MONTHS = [
  // month, last day, opening, returns, fees, closing (minor units)
  ["jan", "2026-01", "2026-01-31", 1519973, 24389, -1087, 1543275],
  ["feb", "2026-02", "2026-02-28", 1543275, 36654, -1100, 1578829],
  ["mar", "2026-03", "2026-03-31", 1578829, -55794, -1005, 1522030],
  ["apr", "2026-04", "2026-04-30", 1522030, 28401, -1095, 1549336],
  ["may", "2026-05", "2026-05-31", 1549336, 29197, -1067, 1577466],
  ["jun", "2026-06", "2026-06-30", 1577466, 9981, -1113, 1586334],
  ["jul", "2026-07", "2026-07-31", 1586334, -24080, -1087, 1561167],
  ["aug", "2026-08", "2026-08-31", 1561167, 10612, -1120, 1570659],
  ["sep", "2026-09", "2026-09-30", 1570659, -33762, -1126, 1535771]
];

for (const [month, checkpointMonth, endDate, openingMinor, returnsMinor, feesMinor, closingMinor] of MONTHS) {
  test(`the ${month} 2026 statement gives its period, reference, opening, returns, fees and closing balance`, () => {
    const parsed = parseStatementText(readFixture(`stashaway-${month}-2026-real`), `${month}.pdf`);
    assert.equal(parsed.parserKey, "stashaway_pdf");
    assert.deepEqual(parsed.rows, []);
    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(parsed.checkpoints, [{
      accountName: "Alex Sample Holder StashAway",
      checkpointMonth,
      statementStartDate: `${checkpointMonth}-01`,
      statementEndDate: endDate,
      statementBalanceMinor: closingMinor,
      accountLast4: "Z00X",
      investmentValue: {
        accountReference: "00 XYZ00X",
        currency: "SGD",
        totalAssetsMinor: closingMinor,
        marketValueMinor: closingMinor,
        cashMinor: 0,
        incomeMinor: 0,
        openingMinor,
        cashflowMinor: 0,
        returnsMinor,
        feesMinor
      },
      note: "Imported from StashAway statement"
    }]);
    // The printed figures add up: opening + cashflow + returns + fees = closing.
    assert.equal(openingMinor + returnsMinor + feesMinor, closingMinor);
  });
}

test("each statement opens at the previous statement's closing balance", () => {
  const closings = MONTHS.map(([month]) => parseStatementText(readFixture(`stashaway-${month}-2026-real`), "x.pdf").checkpoints[0].investmentValue);
  for (let index = 1; index < closings.length; index += 1) {
    assert.equal(closings[index].openingMinor, closings[index - 1].totalAssetsMinor);
  }
});

test("a gain month has positive returns and a loss month negative returns, and fees are always a charge", () => {
  const jan = parseStatementText(readFixture("stashaway-jan-2026-real"), "x.pdf").checkpoints[0].investmentValue;
  const mar = parseStatementText(readFixture("stashaway-mar-2026-real"), "x.pdf").checkpoints[0].investmentValue;
  assert.ok(jan.returnsMinor > 0 && jan.totalAssetsMinor > jan.openingMinor);
  assert.ok(mar.returnsMinor < 0 && mar.totalAssetsMinor < mar.openingMinor);
  assert.ok(jan.feesMinor < 0 && mar.feesMinor < 0);
});

test("the source label comes from the file name", () => {
  assert.equal(parseStatementText(readFixture("stashaway-sep-2026-real"), "sep_tim_stashaway.pdf").sourceLabel, "sep_tim_stashaway");
});

test("fees and dividends inside the portfolio, buys and currency conversions are never rows", () => {
  // September lists a management fee, currency conversions, twelve dividends and many buys.
  const text = readFixture("stashaway-sep-2026-real");
  assert.ok(text.includes("Management fee (Aug 2026)") && text.includes("Currency Conversion to SGD") && text.includes("Dividend received"));
  assert.deepEqual(parseStatementText(text, "x.pdf").rows, []);
});

// ---- Deposits and withdrawals -------------------------------------------
// Every real statement we have shows a cashflow of $0.00, so the layout of a
// deposit or withdrawal row is inferred: the same cells as the management fee
// row (date, transaction, "-" for units, the Singapore dollar amount), with
// the transaction reading "Deposit" or "Withdrawal". These variants add such
// rows and move the cashflow and closing balance to match.

const SEP_TOTAL_ROW = (cashflow, closing) => [
  /(\$15,706\.59\n \n)\$0\.00(\n \n-\$337\.62\n \n-\$11\.26\n \n)\$15,357\.71/g,
  (match, before, after) => `${before}${cashflow}${after}${closing}`
];
const SEP_PORTFOLIO_ROW = (cashflow, closing) => [
  /(\$15,706\.59\n \n)-(\n \n-\$337\.62\n \n-\$11\.26\n \n)\$15,357\.71/,
  (match, before, after) => `${before}${cashflow}${after}${closing}`
];
const DATE_ROW = (day, text, amount) => `${day}\n \nSep 2026\n \n${text}\n \n-\n \n${amount}\n\n`;
const FIRST_SEP_ROW = /04\n \nSep 2026\n \nCurrency Conversion to SGD/;

test("dated deposit and withdrawal rows become a transfer in and a transfer out on their own dates", () => {
  const text = variant("stashaway-sep-2026-real", [
    SEP_TOTAL_ROW("$800.00", "$16,157.71"),
    SEP_PORTFOLIO_ROW("$800.00", "$16,157.71"),
    [FIRST_SEP_ROW, `${DATE_ROW("02", "Deposit", "$1,000.00")}${DATE_ROW("03", "Withdrawal", "-$200.00")}04\n \nSep 2026\n \nCurrency Conversion to SGD`]
  ]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows, [
    { date: "2026-09-02", description: "StashAway deposit", expense: "", income: "1000.00", account: "Alex Sample Holder StashAway", category: "Transfer", note: "", type: "transfer" },
    { date: "2026-09-03", description: "StashAway withdrawal", expense: "200.00", income: "", account: "Alex Sample Holder StashAway", category: "Transfer", note: "", type: "transfer" }
  ]);
  assert.equal(parsed.checkpoints[0].investmentValue.cashflowMinor, 80000);
  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 1615771);
  assert.deepEqual(parsed.warnings, []);
});

test("a withdrawal amount printed without a minus sign is still money out", () => {
  const text = variant("stashaway-sep-2026-real", [
    SEP_TOTAL_ROW("-$250.00", "$15,107.71"),
    SEP_PORTFOLIO_ROW("-$250.00", "$15,107.71"),
    [FIRST_SEP_ROW, `${DATE_ROW("10", "Withdrawal", "$250.00")}04\n \nSep 2026\n \nCurrency Conversion to SGD`]
  ]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.expense, row.income]), [["2026-09-10", "250.00", ""]]);
  assert.equal(parsed.checkpoints[0].investmentValue.cashflowMinor, -25000);
});

test("only a net cashflow figure becomes one entry on the last day of the period, and says so", () => {
  const text = variant("stashaway-sep-2026-real", [SEP_TOTAL_ROW("$500.00", "$15,857.71"), SEP_PORTFOLIO_ROW("$500.00", "$15,857.71")]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows, [
    { date: "2026-09-30", description: "StashAway net deposits, Sep 2026", expense: "", income: "500.00", account: "Alex Sample Holder StashAway", category: "Transfer", note: "", type: "transfer" }
  ]);
  assert.deepEqual(parsed.warnings, [
    "StashAway printed no dated deposits or withdrawals for this month, only the net $500.00, so one entry for it is dated 30 Sep 2026."
  ]);
});

test("a net withdrawal with no rows is one transfer out", () => {
  const text = variant("stashaway-sep-2026-real", [SEP_TOTAL_ROW("-$75.50", "$15,282.21"), SEP_PORTFOLIO_ROW("-$75.50", "$15,282.21")]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.description, row.expense, row.income]), [["2026-09-30", "StashAway net withdrawals, Sep 2026", "75.50", ""]]);
  assert.match(parsed.warnings[0], /net \$75\.50/);
});

test("rows that do not add up to the printed cashflow are replaced by the net entry", () => {
  const text = variant("stashaway-sep-2026-real", [
    SEP_TOTAL_ROW("$800.00", "$16,157.71"),
    SEP_PORTFOLIO_ROW("$800.00", "$16,157.71"),
    [FIRST_SEP_ROW, `${DATE_ROW("02", "Deposit", "$1,000.00")}04\n \nSep 2026\n \nCurrency Conversion to SGD`]
  ]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.income]), [["2026-09-30", "800.00"]]);
  assert.match(parsed.warnings[0], /do not add up to its cashflow of \$800\.00/);
});

test("offsetting deposit and withdrawal rows that net to the printed zero cashflow are both kept", () => {
  const text = variant("stashaway-sep-2026-real", [
    [FIRST_SEP_ROW, `${DATE_ROW("02", "Deposit", "$1,000.00")}${DATE_ROW("03", "Withdrawal", "-$1,000.00")}04\n \nSep 2026\n \nCurrency Conversion to SGD`]
  ]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.description, row.income, row.expense]), [
    ["2026-09-02", "StashAway deposit", "1000.00", ""],
    ["2026-09-03", "StashAway withdrawal", "", "1000.00"]
  ]);
  assert.deepEqual(parsed.warnings, []);
});

// ---- Several portfolios -----------------------------------------------------

test("several portfolios whose closing balances add up to the total give the total", () => {
  const text = variant("stashaway-sep-2026-real", [[
    /General Investing\n \n\$15,706\.59\n \n-\n \n-\$337\.62\n \n-\$11\.26\n \n\$15,357\.71/,
    "General Investing\n \n$10,000.00\n \n-\n \n-$200.00\n \n-$6.00\n \n$9,794.00\n\nSimple Portfolio\n \n$5,706.59\n \n-\n \n-$137.62\n \n-$5.26\n \n$5,563.71"
  ]]);
  assert.equal(readFixture("stashaway-sep-2026-real").includes("General Investing\n \n$15,706.59"), true);
  const parsed = parseStatementText(text, "x.pdf");
  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 1535771);
  assert.deepEqual(parsed.warnings, []);
});

test("portfolios that do not add up to the total warn and the statement total is used", () => {
  const text = variant("stashaway-sep-2026-real", [[
    /General Investing\n \n\$15,706\.59\n \n-\n \n-\$337\.62\n \n-\$11\.26\n \n\$15,357\.71/,
    "General Investing\n \n$10,000.00\n \n-\n \n-$200.00\n \n-$6.00\n \n$9,794.00\n\nSimple Portfolio\n \n$5,706.59\n \n-\n \n-$137.62\n \n-$5.26\n \n$5,000.00"
  ]]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 1535771);
  assert.deepEqual(parsed.warnings, ["The portfolios' closing balances do not add up to the statement's total; the total was used."]);
});

test("figures that do not add up to the closing balance warn and the printed closing balance is used", () => {
  const text = variant("stashaway-sep-2026-real", [[/-\$11\.26\n \n\$15,357\.71\n\nTotal/, "-$11.26\n \n$15,360.00\n\nTotal"], [/(Total\n \n\$15,706\.59\n \n\$0\.00\n \n-\$337\.62\n \n-\$11\.26\n \n)\$15,357\.71/, (match, before) => `${before}$15,360.00`]]);
  const parsed = parseStatementText(text, "x.pdf");
  assert.equal(parsed.checkpoints[0].statementBalanceMinor, 1536000);
  assert.deepEqual(parsed.warnings, ["The statement's opening balance, cashflow, returns and fees do not add up to its closing balance; the printed closing balance was used."]);
});

// ---- Refusals and detection --------------------------------------------------

test("a statement whose reporting currency is not SGD is refused in plain words", () => {
  const text = variant("stashaway-sep-2026-real", [[/Reporting Currency:\n \nSGD/, "Reporting Currency:\n \nUSD"]]);
  assert.throws(() => parseStatementText(text, "x.pdf"), /This StashAway statement is in USD\. Only Singapore dollar \(SGD\) statements can be imported\./);
});

test("a statement cut short before its account summary is refused with a clear message", () => {
  const text = cut("stashaway-sep-2026-real", "ACCOUNT SUMMARY");
  assert.throws(
    () => parseStatementText(text, "x.pdf"),
    /This StashAway statement looks cut short: its account summary is missing\. Download the full statement again and add it\./
  );
});

test("a statement with the summary heading but no figures is refused the same way", () => {
  const text = variant("stashaway-sep-2026-real", [[/Investment\n\nPortfolios\n\n\$15,706\.59[\s\S]*?(?=Opening balance is based)/, ""]]);
  assert.throws(() => parseStatementText(text, "x.pdf"), /looks cut short/);
});

test("a statement without its period is refused", () => {
  const text = variant("stashaway-sep-2026-real", [[/Statement of Account\n\n01\n \nSep 2026\n \n-\n \n30 Sep 2026/, "Statement of Account"]]);
  assert.throws(() => parseStatementText(text, "x.pdf"), /Could not find the StashAway statement period\./);
});

test("a period that spans more than one calendar month is refused", () => {
  const text = variant("stashaway-sep-2026-real", [[/30 Sep 2026\n\nAccount Owner/, "31 Oct 2026\n\nAccount Owner"]]);
  assert.throws(() => parseStatementText(text, "x.pdf"), /one calendar month/);
});

test("bank statements are not mistaken for a StashAway statement, even when a row names StashAway", () => {
  const ocbc = readFixture("ocbc-360-jul-2026-real").replace("IFAST FINANCIAL PL-", "ASIA WEALTH PLATFORM PTE LTD STASHAWAY ACCOUNT SUMMARY");
  assert.equal(parseStatementText(ocbc, "ocbc.pdf").parserKey, "ocbc_360_pdf");
  const uob = readFixture("uob-one-savings-apr-2026").replace(/\n/, "\nASIA WEALTH PLATFORM PTE LTD STASHAWAY\nACCOUNT SUMMARY\n");
  assert.equal(parseStatementText(uob, "uob.pdf").parserKey, "uob_savings_pdf");
});

test("an iFAST statement stays an iFAST statement", () => {
  assert.equal(parseStatementText(readFixture("ifast-wrap-sep-2026-real"), "x.pdf").parserKey, "ifast_wrap_pdf");
});

test("a StashAway statement is not read as a bank or iFAST statement", () => {
  for (const [month] of MONTHS) {
    assert.equal(parseStatementText(readFixture(`stashaway-${month}-2026-real`), "x.pdf").parserKey, "stashaway_pdf");
  }
});

test("the error for unsupported text now names StashAway among the supported statements", () => {
  assert.throws(() => parseStatementText("hello\n__PDF_LAYOUT_TEXT__\nhello", "x.pdf"), /Unsupported statement PDF.*StashAway/);
});
