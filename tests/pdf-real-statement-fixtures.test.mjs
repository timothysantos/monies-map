import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractTransactionDateHint, normalizeDescriptionForMatch } from "../src/domain/app-repository-helpers.ts";
import { parseStatementText } from "../src/lib/statement-import.ts";

// Extracted with pdf.js 4 from real statements, then masked item by item
// (names, address, account and card numbers, payees, references, health and
// employer names) so all three text views stay aligned. Row amounts are scaled
// by an undisclosed per-file factor and every balance and total recomputed, so
// the statements reconcile without showing real amounts. See
// tests/fixtures/pdf-statement-text/README.md.
function parseFixture(name) {
  const text = readFileSync(new URL(`./fixtures/pdf-statement-text/${name}-sanitized.pdf-text.txt`, import.meta.url), "utf8");
  return parseStatementText(text, `${name}.pdf`);
}

function rowFacts(rows) {
  return rows.map((row) => [row.date, row.expense || `+${row.income}`, row.type, row.note]);
}

function netMinor(rows) {
  return rows.reduce((sum, row) => sum + Math.round(Number(row.income || 0) * 100) - Math.round(Number(row.expense || 0) * 100), 0);
}

// OCBC 360 prints Transaction Date then Value Date. The value date is the
// bank-facing (posted) date; the transaction date is the event date, carried
// the same way the OCBC 360 activity CSV carries it (DOMAIN.md date lanes).
test("a real OCBC 360 statement books each row on its value date and keeps the transaction date", () => {
  const parsed = parseFixture("ocbc-360-jun-2026-real");
  assert.equal(parsed.parserKey, "ocbc_360_pdf");
  assert.deepEqual(parsed.checkpoints.map((c) => [c.statementStartDate, c.statementEndDate, c.statementBalanceMinor]), [["2026-06-01", "2026-06-30", 697643]]);
  assert.equal(parsed.rows.length, 16);

  const transferIn = parsed.rows.find((row) => row.description.startsWith("FUND TRANSFER"));
  // Printed "31 MAY 02 JUN": made on 31 May, valued on 2 June.
  assert.deepEqual([transferIn.date, transferIn.note], ["2026-06-02", "transaction date: 2026-05-31"]);
  assert.equal(extractTransactionDateHint(transferIn.note), "2026-05-31");

  const lateJune = parsed.rows.filter((row) => row.note);
  assert.deepEqual(rowFacts(lateJune), [
    ["2026-06-02", "1370.00", "transfer", "transaction date: 2026-05-31"],
    ["2026-06-29", "6850.00", "transfer", "transaction date: 2026-06-28"]
  ]);
  // Same-day rows carry no note and every bank-facing date is in the period.
  assert.ok(parsed.rows.every((row) => row.date >= "2026-06-01" && row.date <= "2026-06-30"));
});

test("a real OCBC 360 row valued at month end but made the next day stays on the statement's month", () => {
  const parsed = parseFixture("ocbc-360-jul-2026-real");
  assert.deepEqual(parsed.checkpoints.map((c) => [c.statementStartDate, c.statementEndDate, c.statementBalanceMinor]), [["2026-07-01", "2026-07-31", 184881]]);
  assert.deepEqual(rowFacts(parsed.rows.filter((row) => row.note)), [
    ["2026-07-06", "830.00", "transfer", "transaction date: 2026-07-05"],
    // Printed "01 AUG 31 JUL".
    ["2026-07-31", "+0.08", "income", "transaction date: 2026-08-01"],
    ["2026-07-31", "1.66", "expense", "transaction date: 2026-08-01"]
  ]);
  assert.ok(parsed.rows.every((row) => row.date >= "2026-07-01" && row.date <= "2026-07-31"));
  assert.equal(parsed.rows.some((row) => /posted date/.test(row.note)), false);
});

// OCBC prints no cycle start. The cycle runs from the day after the
// previous statement date, so a card whose first row comes late in the
// cycle still covers the whole cycle (a hand-entered purchase on an early
// day is then checked against this statement, not blamed on the balance
// before it). The card number printed above the previous balance gives the
// account its last four digits.
test("a real OCBC 365 card statement reads parenthesised credits and a card suffix prefix", () => {
  const parsed = parseFixture("ocbc-365-card-jun-2026-real");
  assert.equal(parsed.parserKey, "ocbc_365_credit_card_pdf");
  assert.deepEqual(parsed.checkpoints.map((c) => [c.statementStartDate, c.statementEndDate, c.previousBalanceMinor, c.statementBalanceMinor, c.accountLast4]), [["2026-05-02", "2026-06-01", 94215, 1, "7528"]]);
  assert.equal(parsed.rows.length, 11);
  assert.deepEqual(parsed.rows.filter((row) => row.income).map((row) => [row.date, row.description, row.income, row.type]), [
    ["2026-05-18", "PAYMENT BY INTERNET", "942.15", "transfer"],
    ["2026-05-20", "CASH REBATE", "2.36", "income"],
    ["2026-05-29", "PAYMENT BY INTERNET", "546.35", "transfer"]
  ]);
  assert.deepEqual(parsed.rows[0], {
    date: "2026-05-11", description: "FAIRPRICE FINEST - VA", expense: "51.60", income: "", account: "OCBC 365 Credit Card", category: "Groceries", note: "", type: "expense"
  });
  // Previous balance minus the net movement is the statement balance.
  assert.equal(94215 - netMinor(parsed.rows), 1);
});

test("a real OCBC 365 card statement with a past-due reminder beside the card name still parses", () => {
  const parsed = parseFixture("ocbc-365-card-sep-2026-real");
  assert.equal(parsed.parserKey, "ocbc_365_credit_card_pdf");
  assert.deepEqual(parsed.checkpoints.map((c) => [c.accountName, c.statementStartDate, c.statementEndDate, c.previousBalanceMinor, c.statementBalanceMinor, c.accountLast4]), [["OCBC 365 Credit Card", "2026-08-02", "2026-09-01", 10186, 24056, "7528"]]);
  // The payment-slip card number on page 3 (all zeros here) is not read.
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.description, row.expense || `+${row.income}`, row.category]), [
    ["2026-08-24", "CASH REBATE", "+0.25", "Other - Income"],
    // The bank's own charges are Fees, not shopping.
    ["2026-08-24", "LATE CHARGE", "91.00", "Fees"],
    ["2026-08-25", "SHOPEE SG MP", "3.63", "Shopping"],
    ["2026-08-25", "SHOPEE SG MP", "40.34", "Shopping"],
    ["2026-09-01", "INTEREST CHARGE", "3.98", "Fees"]
  ]);
  assert.equal(10186 - netMinor(parsed.rows), 24056);
});

test("a tampered real OCBC 365 card amount is rejected, not imported", () => {
  const text = readFileSync(new URL("./fixtures/pdf-statement-text/ocbc-365-card-sep-2026-real-sanitized.pdf-text.txt", import.meta.url), "utf8");
  assert.throws(() => parseStatementText(text.replaceAll("40.34", "41.34"), "sep.pdf"), /did not reconcile/);
});

test("a real Citi Rewards statement parses from pdf.js 4 text with its grand total", () => {
  const parsed = parseFixture("citibank-rewards-aug-2026-real");
  assert.equal(parsed.parserKey, "citibank_credit_card_pdf");
  assert.deepEqual(parsed.checkpoints.map((c) => [c.accountName, c.statementStartDate, c.statementEndDate, c.statementBalanceMinor]), [["Citi Rewards", "2026-07-12", "2026-08-11", 14882]]);
  // pdf.js 4 splits "StatementDate" from "August11,2026" (with text-layer
  // zeros); the printed statement date still closes the cycle.
  assert.equal(parsed.checkpoints[0].previousBalanceMinor, 62056);
  assert.equal(parsed.rows.length, 16);
  assert.deepEqual(parsed.rows.filter((row) => row.income).map((row) => [row.date, row.income, row.type]), [["2026-08-03", "1433.84", "transfer"]]);
  assert.deepEqual(parsed.rows.find((row) => row.description.startsWith("FORTYTWO")), {
    date: "2026-07-30", description: "FORTYTWO", expense: "600.32", income: "", account: "Citi Rewards", category: "Other", note: "", type: "expense"
  });
  // The trailing location ("SingaporeSG", "SG") is stripped once; a merchant
  // name that itself ends in .sg keeps it.
  assert.deepEqual(parsed.rows.filter((row) => /anywheel|ROCKONLINE|Netflix/.test(row.description)).map((row) => row.description), [
    "www.anywheel.sg",
    "Netflix.com Los Gatos",
    "ROCKONLINE.SG"
  ]);
  // Rows imported before this fix ("www.anywheel.") still match as duplicates.
  assert.equal(normalizeDescriptionForMatch("www.anywheel."), normalizeDescriptionForMatch("www.anywheel.sg"));
  assert.equal(normalizeDescriptionForMatch("ROCKONLINE."), normalizeDescriptionForMatch("ROCKONLINE.SG"));
  // The previous balance plus the net movement is the grand total.
  const previous = Number(/BALANCEPREVIOUSSTATEMENT([\d,]+\.\d{2})/.exec(readFileSync(new URL("./fixtures/pdf-statement-text/citibank-rewards-aug-2026-real-sanitized.pdf-text.txt", import.meta.url), "utf8"))[1].replace(/,/g, "")) * 100;
  assert.equal(Math.round(previous) - netMinor(parsed.rows), 14882);
});

// What a card statement asks for. OCBC's Sept 2026 statement for a card
// whose August bill went unpaid prints "IMMEDIATE" for the due date and the
// past-due reminder beside the card's name. (The sanitized fixture zeroes
// the minimum, so none is read.)
test("a real OCBC 365 statement for an unpaid card is due at once and says it is past due", () => {
  const [checkpoint] = parseFixture("ocbc-365-card-sep-2026-real").checkpoints;
  assert.equal(checkpoint.paymentDueDate, "2026-09-01");
  assert.equal(checkpoint.minimumPaymentMinor, undefined);
  assert.deepEqual(checkpoint.notices, [{ code: "past_due" }]);
});

// The Oct 2026 statement replaced the reminder with the penalty rate notice,
// worded and split as pdf.js read it from the real PDF, and printed a real
// due date and minimum.
test("an OCBC 365 statement's penalty interest notice, due date and minimum are read", () => {
  const text = readFileSync(new URL("./fixtures/pdf-statement-text/ocbc-365-card-sep-2026-real-sanitized.pdf-text.txt", import.meta.url), "utf8")
    .replace(
      "OCBC 365 CREDIT CARD Just a reminder that your account is past due . Kindly arrange payment to regularise",
      "OCBC 365 CREDIT CARD Note : You are currently being charged a penalty interest rate of 30 . 78 % per annum . For"
    )
    .replace("01 - 09 - 2026 IMMEDIATE S $ 5 , 000 S $ 0 , 000 . 00 S $ 000 . 00", "01 - 09 - 2026 23 - 09 - 2026 S $ 5 , 000 S $ 4 , 966 . 85 S $ 33 . 15");
  const [checkpoint] = parseStatementText(text, "OCBC 365 CREDIT CARD-7528-Sep-26.pdf").checkpoints;
  assert.deepEqual([checkpoint.paymentDueDate, checkpoint.minimumPaymentMinor, checkpoint.notices], ["2026-09-23", 3315, [{ code: "penalty_interest", annualRatePercent: 30.78 }]]);
});

test("a statement with nothing to pay has no due date, and a real Citi statement's due date is read", () => {
  // OCBC prints "N . A" when the card owes nothing.
  const [ocbc] = parseFixture("ocbc-365-card-jun-2026-real").checkpoints;
  assert.deepEqual([ocbc.paymentDueDate, ocbc.minimumPaymentMinor, ocbc.notices], [undefined, undefined, undefined]);
  const [citi] = parseFixture("citibank-rewards-aug-2026-real").checkpoints;
  assert.equal(citi.paymentDueDate, "2026-09-05");
});
