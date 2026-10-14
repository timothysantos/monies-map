// Card history suggestion (DOMAIN.md "Card Suggestion"): when a new expense is
// at a shop the household has mostly paid for on another card, ask whether it
// was on that card. Pure and deterministic: the household's own last 12
// months at the same shop; at least 3 entries and at least 70% on one other
// card; transfers, estimates in another currency and the entry itself are
// ignored; the card must be active and in the card's own currency.
import assert from "node:assert/strict";
import test from "node:test";

import { CARD_HISTORY_POLICY, suggestCardForEntry } from "../src/domain/card-history-suggestion.ts";

const CARDS = [
  { id: "acct-citi", name: "Citi Rewards", currency: "SGD", isActive: true },
  { id: "acct-uob", name: "UOB One", currency: "SGD", isActive: true },
  { id: "acct-old", name: "Old Card", currency: "SGD", isActive: false },
  { id: "acct-amaze", name: "Amaze USD", currency: "USD", isActive: true }
];

const target = (overrides = {}) => ({ description: "Grab *Ride", accountId: "acct-uob", date: "2026-10-12", ...overrides });

let nextId = 0;
function past(overrides = {}) {
  nextId += 1;
  return {
    entryId: `txn-${nextId}`,
    date: "2026-08-01",
    entryType: "expense",
    description: "GRAB RIDE",
    accountId: "acct-citi",
    originalCurrency: null,
    ...overrides
  };
}

const suggest = (history, overrides = {}, accounts = CARDS) => suggestCardForEntry({ target: target(overrides), history, accounts });

test("the policy is 12 months, at least 3 entries, at least 70%", () => {
  assert.deepEqual({ ...CARD_HISTORY_POLICY }, { lookbackDays: 365, minEntries: 3, minShare: 0.7 });
});

test("three of three past entries on another card suggests that card, with the evidence", () => {
  assert.deepEqual(suggest([past(), past(), past()]), {
    accountId: "acct-citi",
    accountName: "Citi Rewards",
    currentAccountId: "acct-uob",
    currentAccountName: "UOB One",
    merchant: "Grab *Ride",
    entryCount: 3,
    matchedCount: 3
  });
});

test("exactly 70% is enough; just under is not", () => {
  const seven = Array.from({ length: 7 }, () => past());
  const three = Array.from({ length: 3 }, () => past({ accountId: "acct-uob" }));
  assert.equal(suggest([...seven, ...three])?.accountId, "acct-citi");
  assert.equal(suggest([...seven.slice(0, 6), ...three, past({ accountId: "acct-uob" })]), null);
});

test("fewer than 3 entries suggests nothing", () => {
  assert.equal(suggest([past(), past()]), null);
  assert.equal(suggest([]), null);
});

test("history split across cards suggests nothing", () => {
  assert.equal(suggest([past(), past(), past({ accountId: "acct-uob" }), past({ accountId: "acct-uob" })]), null);
  assert.equal(suggest([past(), past(), past({ accountId: "acct-uob" })]), null, "2 of 3 is 67%");
});

test("a shop mostly on the card already chosen suggests nothing", () => {
  assert.equal(suggest([past({ accountId: "acct-uob" }), past({ accountId: "acct-uob" }), past({ accountId: "acct-uob" })]), null);
});

test("an estimate in another currency, a transfer, an old entry, a later entry and the entry itself are not history", () => {
  const history = [
    past(),
    past(),
    past({ originalCurrency: "IDR" }),
    past({ entryType: "transfer" }),
    past({ date: "2025-10-11" }),
    past({ date: "2026-10-13" }),
    past({ entryId: "txn-self" })
  ];
  assert.equal(suggest(history, { entryId: "txn-self" }), null, "only 2 usable entries are left");
  assert.equal(suggest([...history, past()], { entryId: "txn-self" })?.matchedCount, 3);
});

test("another shop does not count, and the shop name matches the way Ask matches names", () => {
  const elsewhere = [past({ description: "GOJEK" }), past({ description: "GOJEK" }), past({ description: "GOJEK" })];
  assert.equal(suggest(elsewhere), null);
  const spelled = [past({ description: "grab ride singapore" }), past({ description: "GRAB   RIDE" }), past({ description: "Grab Ride (SG)" })];
  assert.equal(suggest(spelled)?.accountId, "acct-citi");
  assert.equal(suggest([past(), past(), past()], { description: "   " }), null);
});

test("a card that is inactive, unknown or in another currency is never suggested", () => {
  assert.equal(suggest([past({ accountId: "acct-old" }), past({ accountId: "acct-old" }), past({ accountId: "acct-old" })]), null);
  assert.equal(suggest([past({ accountId: "acct-gone" }), past({ accountId: "acct-gone" }), past({ accountId: "acct-gone" })]), null);
  const usd = [past({ accountId: "acct-amaze" }), past({ accountId: "acct-amaze" }), past({ accountId: "acct-amaze" })];
  assert.equal(suggest(usd), null, "the chosen card is SGD");
  assert.equal(suggest(usd, { accountId: "acct-amaze" })?.accountId, undefined);
  assert.equal(suggest([past(), past(), past()], { accountId: "acct-gone" }), null, "an unknown chosen card is not second-guessed");
});

test("a bad date asks nothing", () => {
  assert.equal(suggest([past(), past(), past()], { date: "soon" }), null);
});
