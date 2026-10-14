// "The model states intent, the server completes" (src/domain/ask-turn-names.ts):
// the readers that turn what was said into the household's own records.
// Names match fuzzily (a possessive, an initial, a typo), days and months
// read as words, amounts read as written, shares tell a percent from a dollar
// amount. Each also has its refusal: two names that fit equally are
// ambiguous, a made-up word is none, a percent is never an amount.
import assert from "node:assert/strict";
import test from "node:test";

import {
  amountsIn,
  findDayIn,
  findMonthIn,
  closestNames,
  matchName,
  normaliseName,
  numberFromWords,
  readAmountMinor,
  readDayWord,
  readMonthWord,
  readShareValue
} from "../src/domain/ask-turn-names.ts";

const PEOPLE = ["Tim", "Joyce"];
const WALLETS = ["Citi Rewards 4417", "UOB One", "DBS Joyce", "Amaze Card"];
const CATEGORIES = ["Food & Drinks", "Groceries", "Transport", "Other", "Other - Income", "Transfer", "Shopping"];

const indexOf = (query, names) => {
  const result = matchName(query, names);
  return result.kind === "match" ? names[result.index] : result.kind;
};

test("names match through a possessive, an initial, case, and a typo", () => {
  for (const said of ["Joyce", "joyce", "JOYCE", "joyce's", "Joyce’s", "J", "j", "Joyse", "joyce."]) {
    assert.equal(indexOf(said, PEOPLE), "Joyce", said);
  }
  assert.equal(indexOf("T", PEOPLE), "Tim");
  // A swapped pair of letters is one typo.
  assert.equal(indexOf("jocye", PEOPLE), "Joyce");
  assert.equal(indexOf("Bob", PEOPLE), "none");
  // Two people starting with the same letter: the initial alone is ambiguous.
  assert.equal(indexOf("J", ["Joyce", "Jun"]), "ambiguous");
  assert.equal(indexOf("Jun", ["Joyce", "Jun"]), "Jun");
});

test("wallets and categories match by a word of the name, a containing word, or a typo", () => {
  assert.equal(indexOf("citi", WALLETS), "Citi Rewards 4417");
  assert.equal(indexOf("the citi card", WALLETS), "Citi Rewards 4417");
  assert.equal(indexOf("uob", WALLETS), "UOB One");
  assert.equal(indexOf("amaze", WALLETS), "Amaze Card");
  assert.equal(indexOf("food", CATEGORIES), "Food & Drinks");
  assert.equal(indexOf("food and drinks", CATEGORIES), "Food & Drinks");
  assert.equal(indexOf("transportation", CATEGORIES), "Transport");
  assert.equal(indexOf("grocereis", CATEGORIES), "Groceries");
  assert.equal(indexOf("groceries", CATEGORIES), "Groceries");
  // "joyce" fits both a person and a wallet name here: a wallet list alone has one.
  assert.equal(indexOf("joyce", WALLETS), "DBS Joyce");
});

test("a name that fits two entries equally is ambiguous, one that fits none is none", () => {
  assert.equal(indexOf("other", CATEGORIES), "Other");
  assert.equal(indexOf("other income", CATEGORIES), "Other - Income");
  assert.equal(indexOf("card", ["Citi Card", "UOB Card"]), "ambiguous");
  assert.equal(indexOf("zzzz", CATEGORIES), "none");
  assert.equal(indexOf("", CATEGORIES), "none");
  assert.equal(indexOf(null, CATEGORIES), "none");
});

test("normaliseName folds possessives, accents and punctuation", () => {
  assert.equal(normaliseName("  Joyce's  "), "joyce");
  assert.equal(normaliseName("Café & Bar"), "cafe and bar");
  assert.equal(normaliseName("S$12"), "s 12");
});

test("the nearest names come first, for chips on a question back", () => {
  assert.deepEqual(closestNames("grocery", CATEGORIES, 2)[0], "Groceries");
  assert.equal(closestNames("", CATEGORIES, 2).length, 2);
});

test("amounts read as written: symbols, words, k, and a decimal comma", () => {
  assert.equal(readAmountMinor("42.50"), 4_250);
  assert.equal(readAmountMinor("$1,200"), 120_000);
  assert.equal(readAmountMinor("S$12"), 1_200);
  assert.equal(readAmountMinor("12 dollars"), 1_200);
  assert.equal(readAmountMinor("fifty bucks"), 5_000);
  assert.equal(readAmountMinor("1.2k"), 120_000);
  assert.equal(readAmountMinor("1,6"), 160);
  assert.equal(readAmountMinor("12,50"), 1_250);
  assert.equal(readAmountMinor("1,200,000"), 120_000_000);
  assert.equal(readAmountMinor(12), 1_200);
  assert.equal(readAmountMinor(".5"), 50);
  // Refusals: zero, negative, a percent, past S$10m, a word that is no number.
  assert.equal(readAmountMinor("0"), null);
  assert.equal(readAmountMinor("-5"), null);
  assert.equal(readAmountMinor("70%"), null);
  assert.equal(readAmountMinor("20000000"), null);
  assert.equal(readAmountMinor("lunch"), null);
  assert.equal(readAmountMinor("12.555"), null);
});

test("number words", () => {
  assert.equal(numberFromWords("fifty"), 50);
  assert.equal(numberFromWords("twenty five"), 25);
  assert.equal(numberFromWords("twenty-five"), 25);
  assert.equal(numberFromWords("a hundred"), 100);
  assert.equal(numberFromWords("two hundred and fifty"), 250);
  assert.equal(numberFromWords("one thousand"), 1000);
  assert.equal(numberFromWords("banana"), null);
});

test("amountsIn finds what a message wrote, never a percent", () => {
  const found = amountsIn("koufu lunch 12.50, then S$1,200 and fifty and 1.2k, Joyce pays 70%");
  assert.ok(found.has(1_250) && found.has(120_000) && found.has(5_000));
  assert.ok(!found.has(7_000), "70% is a share, not an amount");
  assert.ok(!found.has(70) && !found.has(100));
  assert.ok(amountsIn("Joyce's share 1.6").has(160));
  assert.ok(!amountsIn("Joyce's share 1.6%").has(100) && !amountsIn("Joyce's share 1.6%").has(160));
});

test("days read as words from today", () => {
  const today = "2026-10-14"; // a Wednesday
  assert.equal(readDayWord("today", today), "2026-10-14");
  assert.equal(readDayWord("Yesterday", today), "2026-10-13");
  assert.equal(readDayWord("2 days ago", today), "2026-10-12");
  assert.equal(readDayWord("two days ago", today), "2026-10-12");
  assert.equal(readDayWord("friday", today), "2026-10-09");
  assert.equal(readDayWord("last friday", today), "2026-10-09");
  assert.equal(readDayWord("wednesday", today), "2026-10-14");
  assert.equal(readDayWord("last wednesday", today), "2026-10-07");
  assert.equal(readDayWord("12 oct", today), "2026-10-12");
  assert.equal(readDayWord("oct 12", today), "2026-10-12");
  assert.equal(readDayWord("12 December", today), "2025-12-12");
  assert.equal(readDayWord("12/10", today), "2026-10-12");
  assert.equal(readDayWord("12/10/26", today), "2026-10-12");
  assert.equal(readDayWord("2026-09-03", today), "2026-09-03");
  assert.equal(readDayWord("31 feb", today), null);
  assert.equal(readDayWord("someday", today), null);
});

test("months read as words from today", () => {
  const today = "2026-10-14";
  assert.equal(readMonthWord("2026-09", today), "2026-09");
  assert.equal(readMonthWord("September", today), "2026-09");
  assert.equal(readMonthWord("sep", today), "2026-09");
  assert.equal(readMonthWord("in september", today), "2026-09");
  assert.equal(readMonthWord("december", today), "2025-12");
  assert.equal(readMonthWord("sep 2024", today), "2024-09");
  assert.equal(readMonthWord("last month", today), "2026-09");
  assert.equal(readMonthWord("this month", today), "2026-10");
  assert.equal(readMonthWord("3 months ago", today), "2026-07");
  assert.equal(readMonthWord("10/2025", today), "2025-10");
  assert.equal(readMonthWord("next month", today), "2026-11");
  assert.equal(readMonthWord("Jan", "2026-01-05"), "2026-01");
  assert.equal(readMonthWord("last month", "2026-01-05"), "2025-12");
  assert.equal(readMonthWord("month", today), null);
  assert.equal(readMonthWord("", today), null);
});

test("a share is a percent, an amount, all, or a bare number the caller places", () => {
  assert.deepEqual(readShareValue("all"), { kind: "all" });
  assert.deepEqual(readShareValue("everything"), { kind: "all" });
  assert.deepEqual(readShareValue("70%"), { kind: "percent", percent: 70 });
  assert.deepEqual(readShareValue("70 percent"), { kind: "percent", percent: 70 });
  assert.deepEqual(readShareValue("half"), { kind: "percent", percent: 50 });
  assert.deepEqual(readShareValue("$1.60"), { kind: "amount", minor: 160 });
  assert.deepEqual(readShareValue("1.6 dollars"), { kind: "amount", minor: 160 });
  assert.deepEqual(readShareValue("1.6"), { kind: "bare", number: 1.6 });
  assert.deepEqual(readShareValue(1.6), { kind: "bare", number: 1.6 });
  assert.equal(readShareValue("lots"), null);
  assert.equal(readShareValue(""), null);
  assert.equal(readShareValue(null), null);
});

test("the one day or month a message names is what the card gets", () => {
  const today = "2026-10-14";
  assert.equal(findDayIn("grab to work $18 yesterday", today), "2026-10-13");
  assert.equal(findDayIn("lunch 12 on last friday", today), "2026-10-09");
  assert.equal(findDayIn("it was 3 days ago", today), "2026-10-11");
  assert.equal(findDayIn("paid on 5 oct for dinner", today), "2026-10-05");
  assert.equal(findDayIn("how did september go?", today), null);
  // Two different days, or none, is not one day.
  assert.equal(findDayIn("yesterday and today", today), null);
  assert.equal(findDayIn("koufu lunch 12.50", today), null);
  assert.equal(findMonthIn("how did September go?", today), "2026-09");
  assert.equal(findMonthIn("why was last month so expensive", today), "2026-09");
  assert.equal(findMonthIn("where did my money go this month", today), "2026-10");
  assert.equal(findMonthIn("show grab rides in sep", today), "2026-09");
  assert.equal(findMonthIn("set groceries to 300 for next month", today), "2026-11");
  assert.equal(findMonthIn("sep 2024 spending", today), "2024-09");
  // Two months (a comparison or a range) is not one; "may" the verb is not May.
  assert.equal(findMonthIn("compare september with august", today), null);
  assert.equal(findMonthIn("I may want that", today), null);
  assert.equal(findMonthIn("how much did I invest", today), null);
});
