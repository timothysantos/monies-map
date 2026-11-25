// Bare taps' pure rules (DOMAIN.md "Bare Tap"): which later run, bank alert
// or receipt may give a tap with no shop its details, how an import treats
// it, how the trip page lists it, and how each screen words it. Concrete
// facts in, concrete answers out; invented data.
import assert from "node:assert/strict";
import test from "node:test";

import { findTapForBankAlert } from "../src/domain/bank-alerts.ts";
import { chooseReceiptMatch } from "../src/domain/receipt-match.ts";
import { tripNeedsLook } from "../src/domain/trip-page.ts";
import {
  canKeepTap,
  findBareTapForSecondRun,
  findTapForSecondRun,
  isBareTap,
  planWaitingTapClears
} from "../src/domain/waiting-taps.ts";
import { BARE_TAP_SECOND_RUN_SECONDS, BARE_TAPS_PER_PERSON_PER_DAY } from "../src/domain/waiting-taps-config.ts";
import { readReceiptMatchResponse } from "../src/client/ask-receipt-batch.js";
import { waitingTapCopy } from "../src/client/copy/waiting-tap-copy.js";
import { remindersCopy } from "../src/client/copy/reminders-copy.js";
import { tripPageCopy } from "../src/client/copy/en-SG-trip.js";

const AT = "2026-11-20T09:54:00.000Z";
const after = (seconds) => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const bare = (overrides = {}) => ({
  id: "tap-bare",
  requestId: "apple-pay-1",
  personId: "person-tim",
  accountId: "acct-uob",
  otherCurrencyAccountId: "acct-citi",
  merchant: "",
  walletName: "Citibank Singapore",
  tapDate: "2026-11-20",
  receivedAt: AT,
  status: "waiting",
  ...overrides
});

test("the config bounds and which releases keep a tap", () => {
  assert.equal(BARE_TAP_SECOND_RUN_SECONDS, 120);
  assert.equal(BARE_TAPS_PER_PERSON_PER_DAY, 20);
  assert.deepEqual(
    ["apple-pay-api-2026-08-22-v2", "apple-pay-api-2026-08-24-v6", "apple-pay-api-2026-11-10-v7", "apple-pay-api-2026-11-17-v8", "", undefined, "playwright-contract"].map(canKeepTap),
    [true, true, true, true, false, false, false]
  );
  assert.equal(isBareTap({ merchant: "  " }), true);
  assert.equal(isBareTap({ merchant: "駿河屋" }), false);
});

test("a later run with the details finishes exactly one bare tap on the same card, same person, within the window", () => {
  const run = { personId: "person-tim", accountIds: ["acct-uob"], now: after(60) };
  assert.equal(findBareTapForSecondRun([bare()], run)?.id, "tap-bare");
  // Negatives.
  assert.equal(findBareTapForSecondRun([bare()], { ...run, now: after(BARE_TAP_SECOND_RUN_SECONDS + 1) }), null);
  assert.equal(findBareTapForSecondRun([bare()], { ...run, personId: "person-joyce" }), null);
  assert.equal(findBareTapForSecondRun([bare()], { ...run, accountIds: ["acct-ocbc"] }), null);
  assert.equal(findBareTapForSecondRun([bare(), bare({ id: "tap-2", receivedAt: after(30) })], run), null);
  assert.equal(findBareTapForSecondRun([bare({ status: "completed" })], run), null);
  // The shop-matching rule never takes a bare tap, and a run with no shop is never a second run.
  assert.equal(findTapForSecondRun([bare()], { ...run, merchant: "Lawson" }), null);
  assert.equal(findTapForSecondRun([bare({ merchant: "Lawson Ginza" })], { ...run, merchant: "" }), null);
});

test("an import clears a bare tap only through a confirmed statement covering its day, never by guessing a bank row", () => {
  const rows = [{ accountId: "acct-uob", dates: ["2026-11-20"], description: "FAMILYMART NAGOYA" }];
  assert.deepEqual(planWaitingTapClears([bare()], rows, []), []);
  const statement = (accountId) => ({ accountId, startDate: "2026-11-01", endDate: "2026-11-30" });
  // Both cards it could be on must be covered.
  assert.deepEqual(planWaitingTapClears([bare()], rows, [statement("acct-uob")]), []);
  assert.deepEqual(planWaitingTapClears([bare()], rows, [statement("acct-uob"), statement("acct-citi")]), [{ tapId: "tap-bare", status: "statement_no_match" }]);
});

test("a bank alert finishes one bare tap of the same person in its window; a tap whose shop agrees comes first", () => {
  const alert = { personId: "person-tim", merchant: "FAMILYMART NAGOYA", at: after(90) };
  assert.equal(findTapForBankAlert([bare()], alert).outcome, "one");
  assert.deepEqual(findTapForBankAlert([bare()], { ...alert, personId: "person-joyce" }), { outcome: "none" });
  assert.deepEqual(findTapForBankAlert([bare()], { ...alert, at: after(2 * 60 * 60) }), { outcome: "none" });
  assert.deepEqual(findTapForBankAlert([bare(), bare({ id: "tap-2" })], alert), { outcome: "several", count: 2 });
  const named = bare({ id: "tap-named", merchant: "FamilyMart Nagoya" });
  const both = findTapForBankAlert([bare(), named], alert);
  assert.deepEqual([both.outcome, both.outcome === "one" ? both.tap.id : null], ["one", "tap-named"]);
});

const RECEIPT = { merchant: "FamilyMart Nagoya Kokusai", date: "2026-11-20", totalMinor: 44_000, currency: "JPY" };
const receiptTap = (overrides = {}) => ({ id: "tap-bare", date: "2026-11-20", merchant: "", accountName: "Citi Rewards", time: "17:54", ...overrides });

test("a receipt asks about a bare tap on its own day, one chip a tap, and Save gives it the receipt's shop and total", () => {
  const result = chooseReceiptMatch(RECEIPT, { entries: [], taps: [receiptTap()], rates: {} });
  assert.equal(result.kind, "several");
  assert.equal(result.options.length, 1);
  const [option] = result.options;
  assert.equal(option.description, "Payment on Citi Rewards at 5:54 pm");
  assert.equal(option.change.title, "FamilyMart Nagoya Kokusai");
  assert.deepEqual(option.change.save, [{ path: "/api/waiting-taps/complete", body: { tapId: "tap-bare", amount: "440", currency: "JPY", merchant: "FamilyMart Nagoya Kokusai" } }]);
  // The page keeps a single bare option as a question, not a ready change.
  assert.equal(readReceiptMatchResponse({ ok: true, match: result }).kind, "several");

  // Two bare taps that day: two chips, in time order.
  const two = chooseReceiptMatch(RECEIPT, { entries: [], taps: [receiptTap({ id: "tap-late", time: "19:10" }), receiptTap()], rates: {} });
  assert.deepEqual(two.options.map((item) => item.id), ["tap-bare", "tap-late"]);
});

test("a receipt never takes a bare tap from another day, nor when an entry or a tap with its shop fits", () => {
  assert.deepEqual(chooseReceiptMatch(RECEIPT, { entries: [], taps: [receiptTap({ date: "2026-11-19" })], rates: {} }), { kind: "none" });
  const named = receiptTap({ id: "tap-named", merchant: "FamilyMart Nagoya" });
  const result = chooseReceiptMatch(RECEIPT, { entries: [], taps: [receiptTap(), named], rates: {} });
  assert.deepEqual([result.kind, result.kind === "one" ? result.option.id : null], ["one", "tap-named"]);
  const entry = {
    id: "txn-a", date: "2026-11-20", description: "FAMILYMART NAGOYA", amountMinor: 381, currency: "SGD", entryType: "expense",
    categoryName: "Other", accountName: "Citi Rewards", note: "", originalAmountMinor: 44_000, originalCurrency: "JPY", certified: false
  };
  const withEntry = chooseReceiptMatch(RECEIPT, { entries: [entry], taps: [receiptTap()], rates: {} });
  assert.deepEqual([withEntry.kind, withEntry.kind === "one" ? withEntry.option.kind : null], ["one", "entry"]);
});

test("the trip page lists a bare tap like any payment with no amount, worded for no shop", () => {
  const now = new Date("2026-11-22T04:00:00.000Z");
  const items = tripNeedsLook({
    entries: [],
    taps: [{ id: "tap-bare", date: "2026-11-21", merchant: "", personName: "Tim", receivedAt: "2026-11-22T02:00:00.000Z" }],
    tripSplitGroupId: null,
    today: "2026-11-22",
    now
  });
  assert.deepEqual(items, [{ reason: "no_amount", id: "tap-bare", date: "2026-11-21", name: "", personName: "Tim" }]);
  assert.equal(tripPageCopy.lookWhy.no_amount(items[0]), "No details came through.");
  assert.equal(tripPageCopy.lookWhy.no_amount({ name: "Periplus" }), "The amount didn't come through.");
  assert.equal(tripPageCopy.lookBareName, "Apple Pay payment");
  assert.equal(tripPageCopy.lookBareAction, "Add the details");
});

test("the words for a bare tap on Entries' card and in Ask's reminder", () => {
  assert.equal(waitingTapCopy.bareLine({ dayWord: "today", time: "6:54 pm", accountName: "Citi Rewards" }), "Payment on Citi Rewards, today 6:54 pm. No details came through.");
  assert.equal(waitingTapCopy.amountLabel(waitingTapCopy.bareName("Citi Rewards")), "Amount for the payment on Citi Rewards");
  assert.equal(waitingTapCopy.shopLabel("Citi Rewards"), "Shop for the payment on Citi Rewards");
  assert.equal(waitingTapCopy.bareRemoved("Citi Rewards"), "Removed the payment on Citi Rewards. Nothing was saved.");
  const reminder = remindersCopy.waitingTap;
  assert.equal(reminder.bareTitle("Citi Rewards"), "Payment on Citi Rewards: no details came through");
  assert.equal(reminder.bareSentence({ dayText: "today", time: "18:54" }), "Paid today 18:54. Add the shop and amount, or say it wasn't a payment.");
  assert.equal(reminder.bareLaterTitle("Citi Rewards"), "Payment on Citi Rewards, details missing");
});
