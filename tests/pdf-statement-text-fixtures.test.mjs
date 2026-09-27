import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStatementText } from "../src/lib/statement-import.ts";

// Fixtures are the browser `extractPdfText()` output shape: raw text items,
// then `__PDF_LAYOUT_TEXT__` (items glued), then `__PDF_SPACED_LAYOUT_TEXT__`
// (items space-joined). See tests/fixtures/pdf-statement-text/README.md.
function readStatementFixture(name) {
  return readFileSync(new URL(`./fixtures/pdf-statement-text/${name}`, import.meta.url), "utf8");
}

function parseFixture(name, fileName) {
  return parseStatementText(readStatementFixture(name), fileName);
}

// Money in (credit/deposit) is positive, money out (charge/withdrawal) is negative.
function signedMinor(row) {
  if (row.income) {
    assert.equal(row.expense, "", `row has both income and expense: ${row.description}`);
    return Math.round(Number(row.income) * 100);
  }
  return -Math.round(Number(row.expense) * 100);
}

function projectRow(row) {
  return {
    date: row.date,
    description: row.description,
    amountMinor: signedMinor(row),
    account: row.account,
    category: row.category,
    type: row.type,
    note: row.note
  };
}

function sumMinor(rows, account) {
  return rows.filter((row) => row.account === account).reduce((total, row) => total + signedMinor(row), 0);
}

function replaceOnce(text, search, replacement) {
  assert.ok(text.includes(search), `fixture no longer contains ${JSON.stringify(search)}`);
  return text.replace(search, replacement);
}

test("Citibank card PDF text parses both card sections with compact descriptions and signed amounts", () => {
  const parsed = parseFixture("citibank-card-aug-2026-sanitized.pdf-text.txt", "citibank-card-aug-2026.pdf");

  assert.equal(parsed.parserKey, "citibank_credit_card_pdf");
  assert.equal(parsed.sourceLabel, "citibank-card-aug-2026");
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 10);
  assert.deepEqual(parsed.rows.map(projectRow), [
    { date: "2026-08-03", description: "PAYMENTVIAFASTACCOUNTENDING1234", amountMinor: 120820, account: "Citi Rewards", category: "Transfer", type: "transfer", note: "" },
    { date: "2026-08-06", description: "SHOPEESGMP", amountMinor: -4790, account: "Citi Rewards", category: "Shopping", type: "expense", note: "" },
    { date: "2026-08-09", description: "GRAB*A-8ABCDEFGHIJK", amountMinor: -1640, account: "Citi Miles", category: "Taxi", type: "expense", note: "" },
    { date: "2026-08-11", description: "HBOMaxhelp.hbomax.com", amountMinor: -1898, account: "Citi Rewards", category: "Other", type: "expense", note: "" },
    { date: "2026-08-14", description: "M1LTD", amountMinor: -4815, account: "Citi Rewards", category: "Other", type: "expense", note: "" },
    { date: "2026-08-17", description: "JALAIRLINEONLINETOKYOJP", amountMinor: -108600, account: "Citi Miles", category: "Travel", type: "expense", note: "" },
    { date: "2026-08-20", description: "SHOPEESGMP", amountMinor: 762, account: "Citi Rewards", category: "Shopping", type: "income", note: "" },
    { date: "2026-08-23", description: "CCYCONVERSIONFEE", amountMinor: -4, account: "Citi Rewards", category: "Fees", type: "expense", note: "" },
    { date: "2026-08-23", description: "CLOUDFLARESANFRANCISCOUS", amountMinor: -425, account: "Citi Rewards", category: "Other", type: "expense", note: "" },
    { date: "2026-08-24", description: "KINOKUNIYABOOKSTORES", amountMinor: -3210, account: "Citi Miles", category: "Education", type: "expense", note: "" }
  ]);
  assert.deepEqual(parsed.rows[0], {
    date: "2026-08-03",
    description: "PAYMENTVIAFASTACCOUNTENDING1234",
    expense: "",
    income: "1208.20",
    account: "Citi Rewards",
    category: "Transfer",
    note: "",
    type: "transfer"
  });

  // Due date September 2026 certifies the August cycle. Citi Miles carries a
  // printed credit (negative) previous balance, and its grand total amount sits
  // on the line above the GRAND TOTAL label.
  assert.deepEqual(parsed.checkpoints, [
    {
      accountName: "Citi Rewards",
      checkpointMonth: "2026-08",
      statementStartDate: "2026-08-03",
      statementEndDate: "2026-08-23",
      statementBalanceMinor: 11170,
      note: "Imported from Citibank credit card statement"
    },
    {
      accountName: "Citi Miles",
      checkpointMonth: "2026-08",
      statementStartDate: "2026-08-09",
      statementEndDate: "2026-08-24",
      statementBalanceMinor: 110950,
      note: "Imported from Citibank credit card statement"
    }
  ]);
  assert.equal(120820 - sumMinor(parsed.rows, "Citi Rewards"), 11170);
  assert.equal(-2500 - sumMinor(parsed.rows, "Citi Miles"), 110950);
});

test("Citibank card PDF text keeps summaries, footers, and foreign-amount lines out of rows", () => {
  const parsed = parseFixture("citibank-card-aug-2026-sanitized.pdf-text.txt", "citibank-card-aug-2026.pdf");
  const amounts = parsed.rows.map((row) => Math.abs(signedMinor(row)));

  // Account-summary balances, SUB-TOTAL, GRAND TOTAL, and the FOREIGN AMOUNT
  // continuation lines all carry money but are not transactions.
  for (const nonTransactionMinor of [11170, 110950, 122120, 109650, 113450, 334]) {
    assert.equal(amounts.includes(nonTransactionMinor), false, `unexpected row amount ${nonTransactionMinor}`);
  }
  for (const row of parsed.rows) {
    assert.doesNotMatch(row.description, /BALANCEPREVIOUS|SUB-TOTAL|GRANDTOTAL|FOREIGNAMOUNT|THANKYOU|Page\d/i);
  }
});

test("Citibank card PDF text rejects a statement whose rows do not reconcile to the grand total", () => {
  const text = replaceOnce(
    readStatementFixture("citibank-card-aug-2026-sanitized.pdf-text.txt"),
    "14AUGM1LTDSINGAPORESG48.15",
    "14AUGM1LTDSINGAPORESG"
  );

  assert.throws(
    () => parseStatementText(text, "citibank-card-aug-2026.pdf"),
    /Citibank card section did not reconcile for Citi Rewards\. Expected 111\.70, got 63\.55\./
  );
});

test("Citibank card PDF text rejects a card section with no grand total instead of reading points lines", () => {
  const text = replaceOnce(
    readStatementFixture("citibank-card-aug-2026-sanitized.pdf-text.txt"),
    "1,109.50\nGRANDTOTAL\n",
    ""
  );

  assert.throws(
    () => parseStatementText(text, "citibank-card-aug-2026.pdf"),
    /Could not read Citibank balances for Citi Miles\./
  );
});

test("UOB card PDF text parses a two-card statement with post and transaction date lanes", () => {
  const parsed = parseFixture("uob-card-two-card-may-2026-sanitized.pdf-text.txt", "uob-card-may-2026.pdf");

  assert.equal(parsed.parserKey, "uob_credit_card_pdf");
  assert.equal(parsed.sourceLabel, "uob-card-may-2026");
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 10);
  assert.deepEqual(parsed.rows.map((row) => ({ ...projectRow(row), reference: row.reference })), [
    { date: "2026-04-13", description: "HONG KONG ZHAI DIMI S Singapore", amountMinor: -1140, account: "UOB One Card", category: "Other", type: "expense", note: "txn date: 2026-04-11", reference: "00000000000000000000001" },
    { date: "2026-04-14", description: "PAYMENT VIA FAST", amountMinor: 15000, account: "UOB One Card", category: "Transfer", type: "transfer", note: "txn date: 2026-04-13", reference: "00000000000000000000002" },
    { date: "2026-04-15", description: "2280 SINGAPORE", amountMinor: -2350, account: "UOB Lady's Card", category: "Other", type: "expense", note: "txn date: 2026-04-14", reference: "00000000000000000000006" },
    { date: "2026-04-18", description: "NTUC FAIRPRICE CO-OP SINGAPORE", amountMinor: -6435, account: "UOB Lady's Card", category: "Groceries", type: "expense", note: "txn date: 2026-04-17", reference: "00000000000000000000007" },
    { date: "2026-04-22", description: "OPENAI OPENAI.COM", amountMinor: -2949, account: "UOB One Card", category: "Subscriptions MO", type: "expense", note: "txn date: 2026-04-20", reference: "00000000000000000000003" },
    { date: "2026-05-02", description: "DON DON DONKI SINGAPORE", amountMinor: -1890, account: "UOB Lady's Card", category: "Groceries", type: "expense", note: "txn date: 2026-04-30", reference: "00000000000000000000008" },
    { date: "2026-05-03", description: "SHAW THEATRES SINGAPORE", amountMinor: -2800, account: "UOB Lady's Card", category: "Entertainment", type: "expense", note: "txn date: 2026-05-03", reference: "00000000000000000000009" },
    { date: "2026-05-05", description: "NTUC FAIRPRICE CO-OP SINGAPORE", amountMinor: 520, account: "UOB Lady's Card", category: "Groceries", type: "income", note: "txn date: 2026-05-04", reference: "00000000000000000000010" },
    { date: "2026-05-06", description: "Buyandship Limited Hong Kong", amountMinor: -1313, account: "UOB One Card", category: "Other", type: "expense", note: "txn date: 2026-05-05", reference: "00000000000000000000004" },
    { date: "2026-05-09", description: "BUS/MRT 000000000 SINGAPORE", amountMinor: -394, account: "UOB One Card", category: "Public Transport", type: "expense", note: "txn date: 2026-05-05", reference: "00000000000000000000005" }
  ]);

  // Lady's Card opens with a credit balance printed as "12.50 CR".
  assert.deepEqual(parsed.checkpoints, [
    {
      accountName: "UOB One Card",
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-13",
      statementEndDate: "2026-05-12",
      statementBalanceMinor: 5796,
      note: "Imported from UOB credit card statement"
    },
    {
      accountName: "UOB Lady's Card",
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-15",
      statementEndDate: "2026-05-12",
      statementBalanceMinor: 11705,
      note: "Imported from UOB credit card statement"
    }
  ]);
  assert.equal(15000 - sumMinor(parsed.rows, "UOB One Card"), 5796);
  assert.equal(-1250 - sumMinor(parsed.rows, "UOB Lady's Card"), 11705);
});

test("UOB card PDF text keeps summary, subtotal, and page furniture out of rows", () => {
  const parsed = parseFixture("uob-card-two-card-may-2026-sanitized.pdf-text.txt", "uob-card-may-2026.pdf");
  const amounts = parsed.rows.map((row) => Math.abs(signedMinor(row)));

  // Account-summary balances, the minimum payment, SUB TOTAL values, and
  // previous balances (other than the equal-valued payment) are not rows.
  for (const nonTransactionMinor of [5796, 11705, 5000, 9204, 12955, 1250]) {
    assert.equal(amounts.includes(nonTransactionMinor), false, `unexpected row amount ${nonTransactionMinor}`);
  }
  for (const row of parsed.rows) {
    assert.doesNotMatch(row.description, /Ref No|SUB TOTAL|TOTAL BALANCE|PREVIOUS BALANCE|Page \d|United Overseas Bank|Statement Date|Transaction Amount/);
  }
});

test("UOB card PDF text rejects a row whose amount is missing instead of borrowing the subtotal", () => {
  const text = replaceOnce(
    readStatementFixture("uob-card-two-card-may-2026-sanitized.pdf-text.txt"),
    "Ref No. : 00000000000000000000005\n3.94\n",
    "Ref No. : 00000000000000000000005\n"
  );

  assert.throws(
    () => parseStatementText(text, "uob-card-may-2026.pdf"),
    /UOB card section did not reconcile for UOB One Card\./
  );
});

test("UOB One savings PDF text parses multiline rows across a page break and reconciles the running balance", () => {
  const parsed = parseFixture("uob-one-savings-apr-2026-sanitized.pdf-text.txt", "uob-one-apr-2026.pdf");

  assert.equal(parsed.parserKey, "uob_savings_pdf");
  assert.equal(parsed.sourceLabel, "uob-one-apr-2026");
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 4);
  assert.deepEqual(parsed.rows.map(projectRow), [
    { date: "2026-04-03", description: "Bill Payment mBK-CITIBANK CARD 0000000000001234", amountMinor: -120820, account: "UOB One", category: "Transfer", type: "transfer", note: "" },
    // The duty-to-check footer, Chinese notice, and page-2 header follow this
    // row in the text stream and must not leak into its description.
    { date: "2026-04-15", description: "Inward Credit-FAST SALA REDACTED EMPLOYER PTE LTD", amountMinor: 650000, account: "UOB One", category: "Salary", type: "income", note: "" },
    { date: "2026-04-20", description: "Funds Transfer mBK-REDACTED PAYEE", amountMinor: -100000, account: "UOB One", category: "Transfer", type: "transfer", note: "" },
    { date: "2026-04-30", description: "Interest Credit", amountMinor: 329, account: "UOB One", category: "Other - Income", type: "income", note: "" }
  ]);
  assert.deepEqual(parsed.checkpoints, [{
    accountName: "UOB One",
    checkpointMonth: "2026-04",
    statementStartDate: "2026-04-01",
    statementEndDate: "2026-04-30",
    statementBalanceMinor: 929509,
    note: "Imported from UOB savings statement"
  }]);
  assert.equal(500000 + sumMinor(parsed.rows, "UOB One"), 929509);
  assert.equal(parsed.rows.some((row) => /BALANCE B\/F|^Total/i.test(row.description)), false);
});

test("UOB One savings PDF text rejects a row whose running balance does not follow", () => {
  const text = replaceOnce(
    readStatementFixture("uob-one-savings-apr-2026-sanitized.pdf-text.txt"),
    "Funds Transfer\n1,000.00\n9,291.80",
    "Funds Transfer\n1,000.00\n9,219.80"
  );

  assert.throws(
    () => parseStatementText(text, "uob-one-apr-2026.pdf"),
    /UOB savings running balance did not reconcile for 2026-04-20 Funds Transfer/
  );
});

test("OCBC 360 PDF text parses continuation lines across a disclosure page and reconciles to BALANCE C/F", () => {
  const parsed = parseFixture("ocbc-360-may-2026-sanitized.pdf-text.txt", "360 ACCOUNT-0001-May-26.pdf");

  assert.equal(parsed.parserKey, "ocbc_360_pdf");
  assert.equal(parsed.sourceLabel, "360 ACCOUNT-0001-May-26");
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 5);
  // Rows are booked on the Value Date column and keep the Transaction Date as
  // a note ("01 MAY 02 MAY", "31 MAY 30 MAY"), matching the OCBC 360 activity
  // CSV and DOMAIN.md date lanes. Real-statement proof:
  // tests/pdf-real-statement-fixtures.test.mjs.
  assert.deepEqual(parsed.rows.map(projectRow), [
    { date: "2026-05-02", description: "FAST PAYMENT via PayNow-Mobile to REDACTED PERSON", amountMinor: -20000, account: "OCBC 360", category: "Transfer", type: "transfer", note: "transaction date: 2026-05-01" },
    { date: "2026-05-05", description: "GIRO - SALARY REDACTED EMPLOYER PTE LTD SALA", amountMinor: 650000, account: "OCBC 360", category: "Salary", type: "income", note: "" },
    { date: "2026-05-18", description: "BILL PAYMENT INB 0000000000001234 INTERNET BANKING SINGAPORE", amountMinor: -79172, account: "OCBC 360", category: "Transfer", type: "transfer", note: "" },
    { date: "2026-05-22", description: "FUND TRANSFER OTHR - 00000000 to REDACTED PAYEE", amountMinor: -100000, account: "OCBC 360", category: "Transfer", type: "transfer", note: "" },
    { date: "2026-05-30", description: "INTEREST CREDIT", amountMinor: 214, account: "OCBC 360", category: "Other - Income", type: "income", note: "transaction date: 2026-05-31" }
  ]);
  assert.deepEqual(parsed.checkpoints, [{
    accountName: "OCBC 360",
    checkpointMonth: "2026-05",
    statementStartDate: "2026-05-01",
    statementEndDate: "2026-05-31",
    statementBalanceMinor: 951042,
    note: "Imported from OCBC 360 statement"
  }]);
  assert.equal(500000 + sumMinor(parsed.rows, "OCBC 360"), 951042);
  for (const row of parsed.rows) {
    assert.doesNotMatch(row.description, /Deposit Insurance|TRANSACTION CODE|STATEMENT OF ACCOUNT|Account No\.|Total Withdrawals|CHECK YOUR STATEMENT/i);
  }
});

test("OCBC 360 PDF text rejects a row whose amount disagrees with the running balance", () => {
  const text = replaceOnce(
    readStatementFixture("ocbc-360-may-2026-sanitized.pdf-text.txt"),
    "22 MAY 22 MAY FUND TRANSFER 1,000.00 9,508.28",
    "22 MAY 22 MAY FUND TRANSFER 100.00 9,508.28"
  );

  assert.throws(
    () => parseStatementText(text, "360 ACCOUNT-0001-May-26.pdf"),
    /OCBC 360 row did not reconcile around 2026-05-22\. Expected row amount 1000\.00, got 100\.00\./
  );
});

test("OCBC 365 card PDF text parses spaced amounts and dates across a year boundary", () => {
  const parsed = parseFixture("ocbc-365-card-jan-2027-sanitized.pdf-text.txt", "OCBC 365 CREDIT CARD-3333-Jan-27.pdf");

  assert.equal(parsed.parserKey, "ocbc_365_credit_card_pdf");
  assert.equal(parsed.sourceLabel, "OCBC 365 CREDIT CARD-3333-Jan-27");
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 7);
  assert.deepEqual(parsed.rows.map(projectRow), [
    { date: "2026-12-28", description: "COLD STORAGE - JELITA SINGAPORE SGP", amountMinor: -8430, account: "OCBC 365 Credit Card", category: "Groceries", type: "expense", note: "" },
    { date: "2026-12-29", description: "PAYMENT BY INTERNET", amountMinor: 61245, account: "OCBC 365 Credit Card", category: "Transfer", type: "transfer", note: "" },
    { date: "2026-12-31", description: "CASH REBATE", amountMinor: 2000, account: "OCBC 365 Credit Card", category: "Other - Income", type: "income", note: "" },
    { date: "2027-01-02", description: "SHELL SERVICE STATION SINGAPORE SGP", amountMinor: -12000, account: "OCBC 365 Credit Card", category: "Other", type: "expense", note: "" },
    { date: "2027-01-09", description: "NETFLIX . COM SINGAPORE SGP", amountMinor: -1998, account: "OCBC 365 Credit Card", category: "Subscriptions MO", type: "expense", note: "" },
    { date: "2027-01-15", description: "COLD STORAGE - JELITA SINGAPORE SGP", amountMinor: 1290, account: "OCBC 365 Credit Card", category: "Groceries", type: "income", note: "" },
    { date: "2027-01-20", description: "DIN TAI FUNG - PARAGON SINGAPORE SGP", amountMinor: -25682, account: "OCBC 365 Credit Card", category: "Food & Drinks", type: "expense", note: "" }
  ]);
  assert.deepEqual(parsed.checkpoints, [{
    accountName: "OCBC 365 Credit Card",
    checkpointMonth: "2027-01",
    statementStartDate: "2026-12-28",
    statementEndDate: "2027-01-27",
    statementBalanceMinor: 44820,
    previousBalanceMinor: 61245,
    note: "Imported from OCBC credit card statement"
  }]);
  assert.equal(61245 - sumMinor(parsed.rows, "OCBC 365 Credit Card"), 44820);
  for (const row of parsed.rows) {
    assert.doesNotMatch(row.description, /LAST MONTH|SUBTOTAL|TOTAL AMOUNT|Oversea-Chinese|Page \d|- 3333/);
  }
});

test("OCBC 365 card PDF text rejects a statement whose rows do not reach the printed subtotal", () => {
  const text = replaceOnce(
    readStatementFixture("ocbc-365-card-jan-2027-sanitized.pdf-text.txt"),
    "31 / 12 CASH REBATE ( 20 . 00 )\n",
    ""
  );

  assert.throws(
    () => parseStatementText(text, "OCBC 365 CREDIT CARD-3333-Jan-27.pdf"),
    /OCBC card section did not reconcile\. Expected 448\.20, got 468\.20\./
  );
});
