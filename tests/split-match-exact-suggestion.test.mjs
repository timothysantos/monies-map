// Split expense <-> bank row suggestions. A manual split expense such as
// "SINGAPOREAIR Korea KOR KRW" (S$1,051.84 on 24 Jun) used to get no suggestion
// for the bank row "SINGAPORE6182478320308..." of exactly the same amount on
// the same day, because the two share no whole word. A row with the exact
// amount and date is now suggested when it is the only one, and a row another
// split already holds is never suggested at all (linking it is refused).
// Real local D1 (Miniflare) seeded with the demo household; `loadSplitMatchCandidates`
// is the query behind the Splits and Imports match review.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { createSplitExpenseRecord, linkSplitExpenseMatch, loadSplitMatchCandidates } from "../src/domain/app-repository-splits.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const DATE = "2031-03-14";
const MONTH = "2031-03";
const AMOUNT = 105_184;
let counter = 0;

// A clean slate: no seeded record waits for a match, so only the rows and
// splits a test adds can produce suggestions.
async function openClean(t) {
  const ctx = await openSeededDatabase(t, template);
  await ctx.db.prepare("DELETE FROM split_expenses WHERE linked_transaction_id IS NULL").run();
  await ctx.db.prepare("DELETE FROM split_settlements WHERE linked_transaction_id IS NULL").run();
  return ctx;
}

async function addRow(db, { description, amountMinor = AMOUNT, date = DATE, currency = "SGD", entryType = "expense", owner = "person-tim" }) {
  const imp = await db.prepare("SELECT id FROM imports WHERE status = 'completed' LIMIT 1").first();
  const account = await db.prepare("SELECT id FROM accounts WHERE owner_person_id = ? LIMIT 1").bind(owner ?? "person-tim").first();
  const id = `exact-row-${(counter += 1)}`;
  await db
    .prepare(`INSERT INTO transactions (id, household_id, import_id, account_id, transaction_date, description, amount_minor, currency, entry_type, owner_person_id)
      VALUES (?, 'household-1', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, imp.id, account.id, date, description, amountMinor, currency, entryType, owner)
    .run();
  return id;
}

async function addSplit(db, overrides = {}) {
  const created = await createSplitExpenseRecord(db, {
    date: DATE,
    description: "SINGAPOREAIR Korea KOR KRW",
    categoryName: "Travel",
    payerPersonName: "Tim",
    amountMinor: AMOUNT,
    currency: "SGD",
    paymentMethod: "card",
    paymentStatus: "awaiting_statement",
    ...overrides
  });
  return created.splitExpenseId;
}

const expenseMatches = async (db) => (await loadSplitMatchCandidates(db, MONTH)).filter((match) => match.kind === "expense");

test("the exact amount on the exact day is suggested even with no shared word", async (t) => {
  const { db } = await openClean(t);
  const rowId = await addRow(db, { description: "SINGAPORE6182478320308 SINGAPORE SG" });
  const splitId = await addSplit(db);
  const matches = await expenseMatches(db);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].splitRecordId, splitId);
  assert.equal(matches[0].transactionId, rowId);
  assert.equal(matches[0].amountDeltaMinor, 0);
  assert.equal(matches[0].dateDeltaDays, 0);
  assert.equal(matches[0].confidenceLabel, "High");
  assert.equal(matches[0].requiresFxReview, false);
  assert.equal(matches[0].reviewLabel, "Same amount and date as this split expense");
});

test("a bank row one day off is still the same payment; two days off is not suggested without a word", async (t) => {
  const { db } = await openClean(t);
  const near = await addRow(db, { description: "SINGAPORE6182478320308", date: "2031-03-15" });
  await addSplit(db);
  const [match] = await expenseMatches(db);
  assert.equal(match.transactionId, near);
  assert.equal(match.dateDeltaDays, 1);
  assert.equal(match.confidenceLabel, "High");

  const far = await openClean(t);
  await addRow(far.db, { description: "SINGAPORE6182478320308", date: "2031-03-16" });
  await addSplit(far.db);
  assert.deepEqual(await expenseMatches(far.db), []);
});

test("two equal rows on the same day are a tie: nothing is suggested", async (t) => {
  const { db } = await openClean(t);
  await addRow(db, { description: "SINGAPORE6182478320308" });
  await addRow(db, { description: "MERCHANT XYZ 99" });
  await addSplit(db);
  assert.deepEqual(await expenseMatches(db), []);
});

test("a different amount, even by one cent, is not an exact match", async (t) => {
  const { db } = await openClean(t);
  await addRow(db, { description: "SINGAPORE6182478320308", amountMinor: AMOUNT + 1 });
  await addSplit(db);
  assert.deepEqual(await expenseMatches(db), []);
});

test("a row another split already holds is never suggested, with or without a shared word", async (t) => {
  const { db } = await openClean(t);
  const rowId = await addRow(db, { description: "SINGAPOREAIR KOREA 6182478" });
  const holder = await addSplit(db, { description: "Flights held", paymentMethod: "card" });
  await linkSplitExpenseMatch(db, { splitExpenseId: holder, transactionId: rowId });
  // A second split of the same amount and day, whose words match the row exactly.
  await addSplit(db, { description: "SINGAPOREAIR Korea flights" });
  assert.deepEqual(await expenseMatches(db), [], "linking would be refused, so it is not offered");
  await assert.rejects(
    async () => linkSplitExpenseMatch(db, { splitExpenseId: (await db.prepare("SELECT id FROM split_expenses WHERE linked_transaction_id IS NULL").first()).id, transactionId: rowId }),
    /already linked/
  );
  // And a free row beside it still suggests normally.
  const free = await addRow(db, { description: "SINGAPOREAIR KOREA FREE ROW" });
  const [match] = await expenseMatches(db);
  assert.equal(match.transactionId, free);
});

test("a held row does not make a tie: the one free row is the suggestion", async (t) => {
  const { db } = await openClean(t);
  const held = await addRow(db, { description: "HELD ROW 1" });
  const free = await addRow(db, { description: "FREE ROW 2" });
  const holder = await addSplit(db, { description: "Holder" });
  await linkSplitExpenseMatch(db, { splitExpenseId: holder, transactionId: held });
  await addSplit(db, { description: "Second flight" });
  const [match] = await expenseMatches(db);
  assert.equal(match.transactionId, free);
});

test("a transfer row or an income row is never a candidate", async (t) => {
  const { db } = await openClean(t);
  await addRow(db, { description: "PAYNOW TRANSFER 1", entryType: "transfer" });
  await addRow(db, { description: "REFUND 2", entryType: "income" });
  await addSplit(db);
  assert.deepEqual(await expenseMatches(db), []);
});

test("a row on the other person's account is not suggested by amount and date alone", async (t) => {
  const { db } = await openClean(t);
  await addRow(db, { description: "SINGAPORE6182478320308", owner: "person-joyce" });
  await addSplit(db, { payerPersonName: "Tim" });
  assert.deepEqual(await expenseMatches(db), [], "Tim paid; the row is on Joyce's card");
  // Her own split of the same amount does find it.
  await addSplit(db, { payerPersonName: "Joyce", description: "Her flight" });
  assert.equal((await expenseMatches(db)).length, 1);
});

test("a foreign-currency card split matches the home amount exactly, and cash does not", async (t) => {
  const { db } = await openClean(t);
  const rowId = await addRow(db, { description: "SINGAPORE6182478320308", amountMinor: 20_050 });
  const splitId = await addSplit(db, { description: "Airline KRW", amountMinor: 20_000_000, currency: "KRW", homeAmountMinor: 20_050 });
  const [match] = await expenseMatches(db);
  assert.equal(match.splitRecordId, splitId);
  assert.equal(match.transactionId, rowId);
  assert.equal(match.requiresFxReview, true);
  assert.equal(match.confidenceLabel, "Medium");
  assert.equal(match.splitCurrency, "KRW");
  assert.equal(match.transactionCurrency, "SGD");
  assert.equal(match.reviewLabel, "Same amount and date as this split expense");

  // Negative: a different home amount, or a split with no home amount, suggests nothing.
  const other = await openClean(t);
  await addRow(other.db, { description: "SINGAPORE6182478320308", amountMinor: 20_050 });
  await addSplit(other.db, { description: "Airline KRW", amountMinor: 20_000_000, currency: "KRW", homeAmountMinor: 20_051 });
  await addSplit(other.db, { description: "Airline KRW 2", amountMinor: 20_000_000, currency: "KRW" });
  assert.deepEqual(await expenseMatches(other.db), []);
  // Negative: the linker refuses a cross-currency link for a cash expense.
  const cash = await openClean(t);
  await addRow(cash.db, { description: "SINGAPORE6182478320308", amountMinor: 20_050 });
  await addSplit(cash.db, { description: "Airline KRW", amountMinor: 20_000_000, currency: "KRW", homeAmountMinor: 20_050, paymentMethod: "cash", paymentStatus: "recorded" });
  assert.deepEqual(await expenseMatches(cash.db), []);
});

test("ranking: exact amount, date and word beats exact amount and date alone; a word-only near match still works as before", async (t) => {
  const { db } = await openClean(t);
  await addRow(db, { description: "MERCHANT XYZ NO WORDS" });
  const withWord = await addRow(db, { description: "SINGAPOREAIR KOREA ROW" });
  await addSplit(db);
  const [match] = await expenseMatches(db);
  assert.equal(match.transactionId, withWord);
  assert.equal(match.reviewLabel, "Imported transaction could match this split expense");

  // Word-only, a few cents off: still suggested, still Medium, as before.
  const wordOnly = await openClean(t);
  const near = await addRow(wordOnly.db, { description: "SINGAPOREAIR KOREA ROW", amountMinor: AMOUNT + 100 });
  await addSplit(wordOnly.db);
  const [nearMatch] = await expenseMatches(wordOnly.db);
  assert.equal(nearMatch.transactionId, near);
  assert.equal(nearMatch.confidenceLabel, "Medium");
  assert.equal(nearMatch.reviewLabel, "Imported transaction could match this split expense");

  // An exact row with no word outranks a word-only row a few cents off.
  const both = await openClean(t);
  const exact = await addRow(both.db, { description: "MERCHANT XYZ NO WORDS" });
  await addRow(both.db, { description: "SINGAPOREAIR KOREA ROW", amountMinor: AMOUNT + 100 });
  await addSplit(both.db);
  const [bothMatch] = await expenseMatches(both.db);
  assert.equal(bothMatch.transactionId, exact);
});

test("a suggestion never links by itself: the split stays unlinked until the person confirms", async (t) => {
  const { db } = await openClean(t);
  const rowId = await addRow(db, { description: "SINGAPORE6182478320308" });
  const splitId = await addSplit(db);
  assert.equal((await expenseMatches(db)).length, 1);
  const before = await db.prepare("SELECT linked_transaction_id FROM split_expenses WHERE id = ?").bind(splitId).first();
  assert.equal(before.linked_transaction_id, null);
  await linkSplitExpenseMatch(db, { splitExpenseId: splitId, transactionId: rowId });
  assert.deepEqual(await expenseMatches(db), []);
});
