// The UOB PayNow-FAST reference reader (src/lib/paynow-reference.ts), proved
// against the sanitized near-real lines in tests/fixtures/uob-paynow (fake
// payees and UENs, the structure of the real bank text).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCsv } from "../src/lib/csv.ts";
import { payNowEntryTime, payNowMerchantCode, readPayNowReference } from "../src/lib/paynow-reference.ts";

const LINE = "PAYNOW-FAST OTHR SBA-202627699C PIB26100120520761 86 SLEEK TECH PTE LTD";

test("a UOB PayNow-FAST line gives its purchase date, time, company code and payee", () => {
  assert.deepEqual(readPayNowReference(LINE, "2026-10-01"), {
    date: "2026-10-01",
    time: "20:52:07",
    merchantCode: "202627699C",
    payeeText: "SLEEK TECH PTE LTD"
  });
  assert.equal(payNowEntryTime(LINE, "2026-10-01"), "20:52");
  assert.equal(payNowMerchantCode(LINE), "202627699C");
});

test("the owner-verified reference 2610012052076186 reads as 2026-10-01 20:52:07, joined or split", () => {
  const joined = readPayNowReference("PAYNOW-FAST OTHR SBA-202627699C PIB2610012052076186 SLEEK TECH PTE LTD", "2026-10-01");
  assert.deepEqual([joined.date, joined.time, joined.payeeText], ["2026-10-01", "20:52:07", "SLEEK TECH PTE LTD"]);
});

test("whitespace and line breaks in the bank text do not matter", () => {
  const wrapped = "PAYNOW-FAST OTHR\n  SBA-202627699C\nPIB26100120520761 86\nSLEEK TECH PTE LTD";
  assert.equal(readPayNowReference(wrapped, "2026-10-01").time, "20:52:07");
});

test("a purchase up to 3 days from the row's date counts; further drops date and time but keeps the code", () => {
  assert.equal(readPayNowReference(LINE, "2026-10-04").time, "20:52:07");
  assert.equal(readPayNowReference(LINE, "2026-09-28").time, "20:52:07");
  const far = readPayNowReference(LINE, "2026-10-05");
  assert.deepEqual([far.date, far.time, far.merchantCode], [null, null, "202627699C"]);
  assert.equal(readPayNowReference(LINE, "2026-09-27").time, null);
});

test("an impossible date or time is ignored", () => {
  for (const pib of ["PIB26023020520761", "PIB26133120520761", "PIB26100124520761", "PIB26100120612761", "PIB26100120526061"]) {
    const reading = readPayNowReference(`PAYNOW-FAST OTHR SBA-202627699C ${pib} 86 X PTE LTD`, "2026-10-01");
    assert.deepEqual([reading.date, reading.time], [null, null], pib);
  }
});

test("no row date means no time: the reference cannot be checked", () => {
  assert.equal(readPayNowReference(LINE).time, null);
  assert.equal(readPayNowReference(LINE, "not a date").time, null);
});

test("a truncated or missing PIB gives no time; a line with neither piece gives null", () => {
  assert.equal(readPayNowReference("PAYNOW-FAST OTHR SBA-202627699C PIB2610012052 SLEEK", "2026-10-01").time, null);
  assert.deepEqual(readPayNowReference("PAYNOW-FAST OTHR SBA-202627699C SLEEK TECH", "2026-10-01"), { date: null, time: null, merchantCode: "202627699C" });
  assert.equal(readPayNowReference("PAYNOW OTHR Lunch with friends", "2026-10-01"), null);
  assert.equal(readPayNowReference("", "2026-10-01"), null);
  assert.equal(readPayNowReference(null, "2026-10-01"), null);
});

test("a PIB on a line that is not a PayNow payment is not read", () => {
  assert.equal(readPayNowReference("GIRO PIB26100120520761 SBA-202627699C", "2026-10-01"), null);
});

test("only the documented UEN shapes are a company code", () => {
  const code = (uen) => readPayNowReference(`PAYNOW-FAST OTHR SBA-${uen} PIB26100120520761 X`, "2026-10-01").merchantCode;
  assert.equal(code("202627699C"), "202627699C", "local company");
  assert.equal(code("53123456A"), "53123456A", "business");
  assert.equal(code("T08LL1234A"), "T08LL1234A", "entity with a prefix");
  assert.equal(code("S99PF1234B"), "S99PF1234B");
  assert.equal(code("202627699c"), "202627699C", "case is folded");
  for (const bad of ["12345", "2026276990", "ABCDEFGHIJ", "202627699", "30262769XC", "202627699CX", "T08L1234A"]) {
    assert.equal(code(bad), undefined, bad);
  }
  assert.equal(readPayNowReference("PAYNOW-FAST OTHR 202627699C PIB26100120520761 X", "2026-10-01").merchantCode, undefined, "needs its <letters>- prefix");
});

test("OCBC PayNow lines carry no reference and read as nothing", () => {
  assert.equal(readPayNowReference("FAST PAYMENT OTHR-Monthly to REDACTED PAYEE via PayNow-Mobile", "2026-06-04"), null);
  assert.equal(readPayNowReference("FAST PAYMENT OTHR - 00000000 REDACTED PAYEE to EXAMPLE PAYEE via PayNow-UEN", "2026-06-04"), null);
});

test("the sanitized UOB fixture reads row by row", () => {
  const text = readFileSync(new URL("./fixtures/uob-paynow/uob-one-paynow-oct-2026-sanitized.csv", import.meta.url), "utf8");
  const read = parseCsv(text).map((row) => {
    const reading = readPayNowReference(row.description, row.date);
    return reading && [reading.time, reading.merchantCode ?? null];
  });
  assert.deepEqual(read, [
    ["20:52:07", "202627699C"],
    ["08:11:42", "202627699C"],
    ["12:30:05", "202699999E"],
    [null, "202627699C"], // PIB is 8 days before the row: no time
    [null, null], // minute 61 is not a time, and the line has no code
    null // a PayNow line with no reference
  ]);
});
