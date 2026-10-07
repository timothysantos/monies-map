import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanOcrDescriptionText,
  groupOcrLines,
  isOcrNoiseWord,
  joinOcrTsvPasses,
  ocrLegibilityScore,
  parseOcrAmount,
  readOcrDayMonth,
  readOcrTsvWords,
  resolveOcrAmountsAgainstTotals,
  splitOcrTsvPasses,
  withoutOcrNoise
} from "../src/lib/statement-import/ocr.ts";

const AUG_STATEMENT = { startDate: "2026-07-06", endDate: "2026-08-05" };
const OCT_STATEMENT = { startDate: "2026-09-07", endDate: "2026-10-05" };
const JAN_STATEMENT = { startDate: "2026-12-06", endDate: "2027-01-05" };

function word(left, top, text, { confidence = 90, height = 17, width = 50 } = {}) {
  return { page: 1, left, top, width, height, confidence, text };
}

test("readOcrDayMonth reads damaged months against the statement period", () => {
  assert.equal(readOcrDayMonth("010ct", OCT_STATEMENT), "2026-10-01");
  assert.equal(readOcrDayMonth("02O0ct", OCT_STATEMENT), "2026-10-02");
  assert.equal(readOcrDayMonth("25Jui", AUG_STATEMENT), "2026-07-25");
  assert.equal(readOcrDayMonth("07 Ju", AUG_STATEMENT), "2026-07-07");
  assert.equal(readOcrDayMonth("03Aug", AUG_STATEMENT), "2026-08-03");
  assert.equal(readOcrDayMonth("14Aug_—s", { startDate: "2026-08-06", endDate: "2026-09-06" }), "2026-08-14");
  // A day with no readable month is the one date with that day in the period.
  assert.equal(readOcrDayMonth("28", AUG_STATEMENT), "2026-07-28");
  assert.equal(readOcrDayMonth("25d”", AUG_STATEMENT), "2026-07-25");
  assert.equal(readOcrDayMonth("3", AUG_STATEMENT), "2026-08-03");
  // A transaction can predate the period it posts in, across a year end.
  assert.equal(readOcrDayMonth("30Dec", JAN_STATEMENT), "2026-12-30");
  assert.equal(readOcrDayMonth("02Jan", JAN_STATEMENT), "2027-01-02");
  assert.equal(readOcrDayMonth("01Dec", JAN_STATEMENT), "2026-12-01");
  assert.equal(readOcrDayMonth("01Dec", JAN_STATEMENT, { earlierDays: 0 }), undefined);
});

test("readOcrDayMonth refuses dates the text cannot support", () => {
  assert.equal(readOcrDayMonth("zou", AUG_STATEMENT), undefined, "no real digit");
  assert.equal(readOcrDayMonth("SINGAPORE", AUG_STATEMENT), undefined);
  assert.equal(readOcrDayMonth("45Oct", OCT_STATEMENT), undefined, "no such day");
  assert.equal(readOcrDayMonth("15Mar", OCT_STATEMENT), undefined, "outside the period");
  assert.equal(readOcrDayMonth("31Sep", OCT_STATEMENT), undefined, "September has 30 days");
  assert.equal(readOcrDayMonth("", OCT_STATEMENT), undefined);
});

test("parseOcrAmount reads OCR-damaged amounts and credit markers", () => {
  assert.deepEqual(parseOcrAmount("3,384.86"), { minor: 338486, isCredit: false, raw: "3,384.86" });
  assert.deepEqual(parseOcrAmount("4,134.05CR"), { minor: 413405, isCredit: true, raw: "4,134.05CR" });
  assert.deepEqual(parseOcrAmount("4,134.05¢R"), { minor: 413405, isCredit: true, raw: "4,134.05¢R" });
  assert.deepEqual(parseOcrAmount("523.70cR"), { minor: 52370, isCredit: true, raw: "523.70cR" });
  assert.equal(parseOcrAmount("1O9.50")?.minor, 10950, "letter O read as zero");
  assert.equal(parseOcrAmount("0,00")?.minor, 0, "comma read as the decimal point");
  assert.equal(parseOcrAmount("34,000,00")?.minor, 3400000);
  assert.equal(parseOcrAmount("“28.00”")?.minor, 2800, "quotes at the edges");
  assert.equal(parseOcrAmount("S$12.30")?.minor, 1230);
});

test("parseOcrAmount refuses text that is not clearly an amount", () => {
  assert.equal(parseOcrAmount("SO"), undefined);
  assert.equal(parseOcrAmount("6A.7O"), undefined, "a letter inside the number");
  assert.equal(parseOcrAmount("4S9.O"), undefined);
  assert.equal(parseOcrAmount("7000”"), undefined, "no decimals");
  assert.equal(parseOcrAmount("12.3"), undefined);
  assert.equal(parseOcrAmount("Py<malen@s"), undefined);
});

test("groupOcrLines joins words boxed off their row but not across rows", () => {
  const lines = groupOcrLines([
    word(431, 1077, "MOTHERCARE"),
    word(609, 1088, "-", { height: 2, width: 6 }),
    word(624, 1077, "PARAGON"),
    word(432, 1110, "SINGAPORE"),
    word(598, 1461, "WWW.ETSY.COM", { height: 43, width: 202 }),
    word(431, 1478, "Etsy", { height: 22 }),
    word(431, 1510, "IE"),
    // A redaction box read as one very tall word must not swallow the lines
    // it covers.
    word(163, 466, "TEST", { height: 184 }),
    word(180, 555, "Statement"),
    word(182, 601, "From")
  ]);
  assert.deepEqual(lines.map((line) => [line.top, line.text]), [
    [466, "TEST"],
    [555, "Statement"],
    [601, "From"],
    [1077, "MOTHERCARE - PARAGON"],
    [1110, "SINGAPORE"],
    [1478, "Etsy WWW.ETSY.COM"],
    [1510, "IE"]
  ]);
});

test("OCR noise filtering drops dotted rules but keeps low-confidence real words", () => {
  assert.equal(isOcrNoiseWord(word(171, 1231, "eceececeeeeeeeeeeeeeeeen", { confidence: 0 })), true);
  assert.equal(isOcrNoiseWord(word(653, 1318, "ssnnsssanssansssnsss==sses", { confidence: 0, width: 505 })), true);
  assert.equal(isOcrNoiseWord(word(493, 1058, "ee", { confidence: 8 })), true);
  assert.equal(isOcrNoiseWord(word(474, 1545, "E", { confidence: 0 })), true);
  assert.equal(isOcrNoiseWord(word(431, 1510, "PAYMENT", { confidence: 0 })), false, "an all-caps word at 0% is still a word");
  assert.equal(isOcrNoiseWord(word(431, 1077, "KINOKUNIYA-TAKASHIMAYA", { confidence: 14, width: 327 })), false);
  assert.equal(isOcrNoiseWord(word(431, 1164, "IKEA", { confidence: 8 })), false);
  assert.equal(isOcrNoiseWord(word(598, 1251, "shaw.sg", { confidence: 91 })), false);

  const lines = withoutOcrNoise(groupOcrLines([
    word(171, 1318, "Soro", { confidence: 0 }),
    word(233, 1318, "rrncnencensn", { confidence: 0 }),
    word(431, 1376, "HK", { confidence: 96 }),
    word(470, 1376, "coc", { confidence: 0 })
  ]));
  assert.deepEqual(lines.map((line) => line.text), ["HK"]);
});

test("cleanOcrDescriptionText reads a leading bar as I and drops column bars", () => {
  assert.equal(cleanOcrDescriptionText("| CREATIVE SALON LLP"), "I CREATIVE SALON LLP");
  assert.equal(cleanOcrDescriptionText("Buyandship Limited | Hong Kong"), "Buyandship Limited Hong Kong");
  assert.equal(cleanOcrDescriptionText("| creative"), "creative");
});

test("ocrLegibilityScore prefers the reading that kept the merchant name", () => {
  const kept = [word(0, 0, "KINOKUNIYA-TAKASHIMAYA", { confidence: 20 }), word(0, 0, "SINGAPORE", { confidence: 90 }), word(0, 0, "SG", { confidence: 89 })];
  const lost = [word(0, 0, "SINGAPORE", { confidence: 88 }), word(0, 0, "SG", { confidence: 88 })];
  const withJunk = [word(0, 0, "SINGAPORE", { confidence: 88 }), word(0, 0, "SG", { confidence: 88 }), word(0, 0, "EE", { confidence: 5 })];
  assert.ok(ocrLegibilityScore(kept) > ocrLegibilityScore(lost));
  assert.equal(ocrLegibilityScore(withJunk), ocrLegibilityScore(lost));
});

test("OCR passes round-trip through the package format", () => {
  const first = "1\t1\t0\t0\t0\t0\t0\t0\t1820\t2572\t-1\t\n5\t1\t1\t1\t1\t1\t10\t10\t20\t20\t90\tHSBC";
  const second = "1\t1\t0\t0\t0\t0\t0\t0\t2480\t3508\t-1\t\n5\t1\t1\t1\t1\t1\t10\t10\t20\t20\t80\tVISA";
  const packaged = joinOcrTsvPasses([first, `__OCR_TSV__\n${second}`]);
  assert.equal(packaged.match(/__OCR_TSV__/g).length, 2);
  assert.deepEqual(splitOcrTsvPasses(packaged), [first, second]);
  const words = readOcrTsvWords(second, { referenceWidth: 1820, referenceHeight: 2572 });
  assert.deepEqual(words.map((item) => [item.text, item.confidence, item.left]), [["VISA", 80, 7]], "scaled to the reference page");
});

const consistentBalance = (summary, debitMinor, creditMinor) => summary.previous + debitMinor - creditMinor === summary.balance;
const totalsOf = (summary) => ({ debitMinor: summary.purchases, creditMinor: summary.credits });
const SEP_SUMMARY = { previous: 0, purchases: 52370, credits: 52370, balance: 0 };

test("resolveOcrAmountsAgainstTotals fills the single unread row and keeps every read one", () => {
  const resolved = resolveOcrAmountsAgainstTotals({
    rows: [
      { readings: [{ minor: 45900, isCredit: false }], creditWhenUnread: false },
      { readings: [], creditWhenUnread: false },
      { readings: [{ minor: 52370, isCredit: true }], creditWhenUnread: true }
    ],
    summaries: [SEP_SUMMARY],
    totalsOf,
    isSummaryConsistent: consistentBalance
  });
  assert.deepEqual(resolved, {
    amounts: [{ minor: 45900, isCredit: false }, { minor: 6470, isCredit: false }, { minor: 52370, isCredit: true }],
    inferredRowIndexes: [1],
    summary: SEP_SUMMARY
  });
});

test("resolveOcrAmountsAgainstTotals lets the totals choose between two passes", () => {
  // Pass 2 misread the purchases total (623.70) and pass 1 misread nothing it
  // could read; MOTHERCARE was read as 459.00 by pass 1 and 489.00 by pass 2.
  const resolved = resolveOcrAmountsAgainstTotals({
    rows: [
      { readings: [{ minor: 48900, isCredit: false }, { minor: 45900, isCredit: false }], creditWhenUnread: false },
      { readings: [{ minor: 6470, isCredit: false }], creditWhenUnread: false },
      { readings: [{ minor: 52370, isCredit: true }], creditWhenUnread: true }
    ],
    summaries: [{ ...SEP_SUMMARY, purchases: 62370 }, SEP_SUMMARY],
    totalsOf,
    isSummaryConsistent: consistentBalance
  });
  assert.deepEqual(resolved.amounts.map((amount) => amount.minor), [45900, 6470, 52370]);
  assert.deepEqual(resolved.inferredRowIndexes, []);
  assert.equal(resolved.summary, SEP_SUMMARY);
});

test("resolveOcrAmountsAgainstTotals corrects only a lone row of its kind", () => {
  const lone = resolveOcrAmountsAgainstTotals({
    rows: [
      { readings: [{ minor: 18720, isCredit: false }], creditWhenUnread: false },
      { readings: [{ minor: 15720, isCredit: true }], creditWhenUnread: true }
    ],
    summaries: [{ previous: 0, purchases: 15720, credits: 15720, balance: 0 }],
    totalsOf,
    isSummaryConsistent: consistentBalance
  });
  assert.deepEqual(lone.amounts.map((amount) => amount.minor), [15720, 15720]);
  assert.deepEqual(lone.inferredRowIndexes, [0]);

  const twoPurchases = resolveOcrAmountsAgainstTotals({
    rows: [
      { readings: [{ minor: 10000, isCredit: false }], creditWhenUnread: false },
      { readings: [{ minor: 5000, isCredit: false }], creditWhenUnread: false }
    ],
    summaries: [{ previous: 0, purchases: 16000, credits: 0, balance: 16000 }],
    totalsOf,
    isSummaryConsistent: consistentBalance
  });
  assert.equal(twoPurchases, undefined, "either purchase could be the misread one");
});

test("resolveOcrAmountsAgainstTotals refuses two unread rows and an inconsistent summary", () => {
  const twoUnread = resolveOcrAmountsAgainstTotals({
    rows: [
      { readings: [], creditWhenUnread: false },
      { readings: [], creditWhenUnread: false },
      { readings: [{ minor: 52370, isCredit: true }], creditWhenUnread: true }
    ],
    summaries: [SEP_SUMMARY],
    totalsOf,
    isSummaryConsistent: consistentBalance
  });
  assert.equal(twoUnread, undefined);

  const unbalanced = resolveOcrAmountsAgainstTotals({
    rows: [{ readings: [{ minor: 45900, isCredit: false }], creditWhenUnread: false }],
    summaries: [{ previous: 0, purchases: 52370, credits: 0, balance: 45900 }],
    totalsOf,
    isSummaryConsistent: consistentBalance
  });
  assert.equal(unbalanced, undefined, "the balance contradicts the purchases total");
});
