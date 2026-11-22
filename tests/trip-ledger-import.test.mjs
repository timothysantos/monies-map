// Trip ledger import (docs/audits/trip-ledger-import.md): reading a trip
// ledger export, matching its purchases to entries and planning the changes.
// Pure functions; every fixture here is invented (no real shop, amount or
// person), in the export's own shape.
import assert from "node:assert/strict";
import test from "node:test";

import { inferTripDayZero, matchTripLedger, merchantSimilarity, readTripLedgerExport } from "../src/domain/trip-ledger-match.ts";
import {
  DEFAULT_TRIP_LEDGER_CONFIG,
  allocateProportionally,
  buildTripLedgerPlan,
  canonicalJson,
  hashTripLedgerPlan,
  readChargeParts,
  scaleShare
} from "../src/domain/trip-ledger-plan.ts";

const SAM = "person-sam";
const KAI = "person-kai";

function expense(overrides) {
  return {
    id: "x",
    day: 1,
    time: "",
    merchant: "Shop",
    items: "",
    category: "Food",
    payer: "You",
    jpy: 1000,
    sgd_cents: 830,
    status: "paid",
    owed_cents: 0,
    owed_jpy: 0,
    notes: "",
    allocation_pending: 0,
    payer_pending: 0,
    funding_card: "Bank Rewards Card",
    payment_wallet: "Wallet App",
    ...overrides
  };
}

function entry(overrides) {
  return {
    id: "txn-x",
    accountId: "acc-rewards",
    accountOwnerPersonId: SAM,
    accountIsJoint: false,
    date: "2031-03-02",
    postDate: null,
    time: null,
    description: "Shop",
    amountMinor: 830,
    entryType: "expense",
    originalAmountMinor: null,
    originalCurrency: null,
    statementCertified: false,
    categoryName: "Other",
    note: null,
    tripEventId: null,
    splitExpenseId: null,
    externalReference: null,
    ...overrides
  };
}

function snapshot(entries = [], waitingTaps = []) {
  return {
    householdId: "household-1",
    people: [{ id: KAI, name: "Kai", role: "partner" }, { id: SAM, name: "Sam", role: "owner" }],
    accounts: [
      { id: "acc-rewards", name: "Rewards Card", ownerPersonId: SAM, isJoint: false, kind: "credit_card", currency: "SGD", active: true },
      { id: "acc-miles", name: "Miles Card", ownerPersonId: SAM, isJoint: false, kind: "credit_card", currency: "SGD", active: true },
      { id: "acc-kai-card", name: "Everyday Card", ownerPersonId: KAI, isJoint: false, kind: "credit_card", currency: "SGD", active: true }
    ],
    categories: ["Food & Drinks", "Shopping", "Public Transport", "Travel", "Other"].map((name, index) => ({ id: `cat-${index}`, name })),
    tripEvents: [],
    splitGroups: [{ id: "split-group-home", name: "Home", currency: "SGD" }],
    entries,
    waitingTaps
  };
}

// Day 1 is 2 March 2031 (day 0 is the 1st).
function plan(expenses, entries, answers, waitingTaps = []) {
  const raw = { expenses, items: [] };
  const lines = readTripLedgerExport(raw, "2031-03-01");
  return buildTripLedgerPlan({
    lines,
    snapshot: snapshot(entries, waitingTaps),
    config: { ...DEFAULT_TRIP_LEDGER_CONFIG, tripName: "Hokkaido trip" },
    answers,
    dayZero: "2031-03-01",
    exportSha256: "ab".repeat(32)
  });
}

const lineOf = (result, id) => result.lines.find((line) => line.lineId === id);
const stepsOf = (result, id) => result.steps.filter((step) => step.lineId === id);

test("day 0 is read from the purchases that name their own date; a disagreeing one is reported", () => {
  const reading = inferTripDayZero({
    expenses: [
      { id: "konbini-20310303-1", day: 2, notes: "" },
      { id: "soba", day: 3, notes: "4 Mar 2031, Day 3. Paid by You." },
      { id: "cards", day: 4, notes: "5 Mar 2031 10:02, Day 4 (1 Mar = Day 0)." },
      { id: "misdated", day: 2, notes: "Receipt from 9 Mar 2031." },
      { id: "no-date", day: 1, notes: "" }
    ]
  });
  assert.equal(reading.dayZero, "2031-03-01");
  assert.equal(reading.agreeing, 3);
  assert.deepEqual(reading.conflicting, [{ id: "misdated", day: 2, date: "2031-03-09" }]);
  assert.deepEqual(reading.anchors, ["2031-03-01"]);
  // No dated purchase at all: no guess.
  assert.equal(inferTripDayZero({ expenses: [{ id: "a", day: 1, notes: "" }] }).dayZero, null);
});

test("an exact match is certain, and the plan only annotates it", () => {
  const result = plan(
    [expense({ id: "fm", merchant: "Cornermart station", jpy: 1250, sgd_cents: 1037, time: "08:15", items: "Onigiri", category: "Food" })],
    [entry({ id: "txn-fm", description: "CORNERMART", amountMinor: 1037, originalAmountMinor: 125_000, originalCurrency: "JPY", time: "07:16" })]
  );
  const line = lineOf(result, "fm");
  assert.equal(line.confidence, "certain");
  assert.equal(line.entryId, "txn-fm");
  assert.equal(line.outcome, "matched");
  assert.deepEqual(stepsOf(result, "fm").map((step) => step.kind), ["set_category", "set_note"]);
  assert.equal(stepsOf(result, "fm")[0].categoryName, "Food & Drinks");
  assert.equal(stepsOf(result, "fm")[1].note, "08:15 local time · Onigiri");
  const trip = result.steps.find((step) => step.kind === "put_on_trip");
  assert.deepEqual(trip.entries, [{ lineId: "fm", entry: { id: "txn-fm" } }]);
  assert.ok(!result.steps.some((step) => step.kind === "create_entry"), "no second entry for a purchase already recorded");
});

test("an estimate against the card's posted amount (a few percent off) still matches; a certified entry keeps its bank facts", () => {
  const result = plan(
    [expense({ id: "corner", merchant: "Corner Store", jpy: 2600, sgd_cents: 2160, owed_cents: 1080, category: "Food", items: "Snacks for two" })],
    // The statement charged 3% more and posted two days later.
    [entry({ id: "txn-corner", description: "AMAZE* CORNER STORE OSAKA", amountMinor: 2225, date: "2031-03-04", statementCertified: true })]
  );
  const line = lineOf(result, "corner");
  assert.equal(line.confidence, "likely");
  assert.equal(line.entryId, "txn-corner");
  assert.equal(line.statementCertified, true);
  const kinds = stepsOf(result, "corner").map((step) => step.kind);
  assert.deepEqual(kinds, ["set_category", "set_note", "add_entry_to_splits"]);
  // Nothing in the plan touches amount, date or wallet.
  for (const step of stepsOf(result, "corner")) {
    for (const key of ["amountMinor", "date", "accountId"]) assert.ok(!(key in step), `${step.kind} carries no ${key}`);
  }
  // An even split stays even on the bank's amount: Kai owes half of 22.25.
  const split = stepsOf(result, "corner").find((step) => step.kind === "add_entry_to_splits");
  assert.equal(split.payerPersonId, SAM);
  assert.equal(split.entryAmountMinor, 2225);
  assert.equal(split.firstPersonShareMinor, 2225 - 1113);
});

test("a different amount in the trip's currency is another purchase, however close in SGD", () => {
  const result = plan(
    [expense({ id: "a", merchant: "Shop", jpy: 1000, sgd_cents: 830 })],
    [entry({ id: "txn-other", description: "Shop", amountMinor: 830, originalAmountMinor: 101_000, originalCurrency: "JPY" })]
  );
  assert.equal(lineOf(result, "a").confidence, "none");
  assert.equal(lineOf(result, "a").outcome, "new");
});

test("two same-amount purchases at one shop on one day: by time when both have one, else interchangeable, and a real tie is ambiguous", () => {
  const two = [
    expense({ id: "topup-1", merchant: "Transit card top-up", jpy: 3000, sgd_cents: 2490, category: "Transport", time: "10:00" }),
    expense({ id: "topup-2", merchant: "Transit card top-up", jpy: 3000, sgd_cents: 2490, category: "Transport", time: "17:00", owed_cents: 2490 })
  ];
  const timed = plan(two, [
    entry({ id: "txn-late", description: "Transit card top-up", amountMinor: 2490, time: "16:00" }),
    entry({ id: "txn-early", description: "Transit card top-up", amountMinor: 2490, time: "09:00" })
  ]);
  assert.equal(lineOf(timed, "topup-1").entryId, "txn-early");
  assert.equal(lineOf(timed, "topup-2").entryId, "txn-late");
  // Two entries fit; the time of day tells them apart.
  assert.equal(lineOf(timed, "topup-2").confidence, "likely");

  const untimed = plan(two.map((item) => ({ ...item, time: "" })), [
    entry({ id: "txn-s1", description: "Transit card top-up", amountMinor: 2490 }),
    entry({ id: "txn-s2", description: "Transit card top-up", amountMinor: 2490 })
  ]);
  assert.deepEqual(["topup-1", "topup-2"].map((id) => lineOf(untimed, id).confidence), ["likely", "likely"]);
  assert.deepEqual(new Set(["topup-1", "topup-2"].map((id) => lineOf(untimed, id).entryId)), new Set(["txn-s1", "txn-s2"]));
  assert.match(lineOf(untimed, "topup-1").matchReasons[0], /either entry fits either line/);

  // Two purchases, one entry: nobody can tell which, so nothing is changed.
  const tie = plan(two.map((item) => ({ ...item, time: "" })), [entry({ id: "txn-only", description: "Transit card top-up", amountMinor: 2490 })]);
  for (const id of ["topup-1", "topup-2"]) {
    assert.equal(lineOf(tie, id).confidence, "ambiguous");
    assert.equal(lineOf(tie, id).outcome, "held");
    assert.deepEqual(lineOf(tie, id).candidates.map((candidate) => candidate.entryId), ["txn-only"]);
    assert.deepEqual(stepsOf(tie, id), []);
  }
  assert.ok(tie.questions.some((question) => question.id === "ambiguous-topup-1" && question.blocking));
});

test("a purchase with no entry becomes a new estimate the statement can pair with", () => {
  const result = plan([expense({ id: "mochi", merchant: "Mochi Stand", jpy: 1100, sgd_cents: 912, items: "Matcha; sesame", category: "Food", time: "14:05" })], []);
  const [create] = stepsOf(result, "mochi");
  assert.equal(lineOf(result, "mochi").outcome, "new");
  assert.deepEqual({
    kind: create.kind,
    accountId: create.accountId,
    date: create.date,
    description: create.description,
    amountMinor: create.amountMinor,
    originalAmountMinor: create.originalAmountMinor,
    originalCurrency: create.originalCurrency,
    shared: create.shared,
    externalReference: create.externalReference,
    categoryName: create.categoryName
  }, {
    kind: "create_entry",
    accountId: "acc-rewards",
    date: "2031-03-02",
    description: "Mochi Stand",
    amountMinor: 912,
    originalAmountMinor: 110_000,
    originalCurrency: "JPY",
    shared: false,
    externalReference: "trip-ledger:hokkaido-trip:mochi",
    categoryName: "Food & Drinks"
  });
  assert.match(create.note, /^14:05 local time · Matcha; sesame\nPaid JPY 1,100\. SGD amount as the card's activity showed it/);
  assert.deepEqual(result.steps.find((step) => step.kind === "put_on_trip").entries, [{ lineId: "mochi", entry: { externalReference: "trip-ledger:hokkaido-trip:mochi" } }]);
  assert.deepEqual(result.steps.filter((step) => step.kind === "create_trip").map((step) => [step.name, step.startDate, step.currency]), [["Hokkaido trip", "2031-03-02", "JPY"]]);
});

test("a purchase the card charged in parts becomes one entry per charge, the share split by size to the cent", () => {
  const result = plan([expense({
    id: "order",
    day: 0,
    merchant: "Online shop",
    jpy: 30_000,
    sgd_cents: 24_900,
    owed_cents: 10_001,
    category: "Shopping",
    funding_card: "Bank Miles Card",
    payment_wallet: null,
    status: "pending",
    notes: "Two pending charges: ¥20,000 / S$166.00 + ¥10,000 / S$83.00 = ¥30,000 / S$249.00."
  })], []);
  const creates = stepsOf(result, "order").filter((step) => step.kind === "create_entry");
  assert.deepEqual(creates.map((step) => [step.accountId, step.amountMinor, step.originalAmountMinor, step.firstPersonShareMinor, step.externalReference]), [
    ["acc-miles", 16_600, 2_000_000, 16_600 - 6_667, "trip-ledger:hokkaido-trip:order:1"],
    ["acc-miles", 8_300, 1_000_000, 8_300 - 3_334, "trip-ledger:hokkaido-trip:order:2"]
  ]);
  assert.equal(result.totals.owed.afterImport, -10_001);
  assert.deepEqual(allocateProportionally(10_001, [16_600, 8_300]), [6_667, 3_334]);
  // Parts that do not add up to the purchase are not used.
  assert.equal(readChargeParts({ notes: "¥1 / S$1.00 + ¥2 / S$2.00 = ¥3 / S$3.00", homeMinor: 999, foreignMinor: 300 }).length, 1);
});

test("paid by the other person with no entry: a Splits expense paid by them, the owner's share to the cent", () => {
  const result = plan([
    // Kai paid; Sam owns some items: an uneven share.
    expense({ id: "pens", payer: "Kai", merchant: "Pen Shop", jpy: 8800, sgd_cents: 7300, owed_cents: 3700, category: "Shopping", funding_card: null, payment_wallet: null, status: "estimated" }),
    // Kai paid for Kai: nothing owed, nothing to record.
    expense({ id: "kai-own", payer: "Kai", merchant: "Cafe", jpy: 800, sgd_cents: 663, owed_cents: 0, funding_card: null, payment_wallet: null })
  ], [
    // An entry on Sam's card for the same amount is not Kai's purchase.
    entry({ id: "txn-sam", description: "Pen Shop", amountMinor: 7300, accountId: "acc-rewards" })
  ]);
  const line = lineOf(result, "pens");
  assert.equal(line.outcome, "splits-only");
  assert.equal(line.entryId, null);
  const [step] = stepsOf(result, "pens");
  assert.deepEqual({ kind: step.kind, payer: step.payerPersonName, amount: step.amountMinor, first: step.firstPersonShareMinor, group: step.splitGroup },
    { kind: "create_split_expense", payer: "Kai", amount: 7300, first: 3700, group: { newName: "Hokkaido trip" } });
  assert.equal(lineOf(result, "kai-own").outcome, "nothing");
  assert.deepEqual(stepsOf(result, "kai-own"), []);
  assert.equal(result.totals.owed.afterImport, 3700);
  assert.deepEqual(result.entriesWithoutLine.map((item) => item.entryId), ["txn-sam"]);
});

test("paid by the other person with an entry on their own card: Add to Splits from that entry, paid by them", () => {
  const result = plan(
    [expense({ id: "soba", payer: "Kai", merchant: "Soba Bar", jpy: 4000, sgd_cents: 3317, owed_cents: 1659, funding_card: null, payment_wallet: null })],
    [entry({ id: "txn-kai", accountId: "acc-kai-card", accountOwnerPersonId: KAI, description: "SOBA BAR SAPPORO", amountMinor: 3400 })]
  );
  const split = stepsOf(result, "soba").find((step) => step.kind === "add_entry_to_splits");
  assert.equal(split.payerPersonId, KAI);
  // 16.59 of 33.17 is an even split (the odd cent): it stays even on 34.00.
  assert.equal(split.firstPersonShareMinor, 1700);
  assert.equal(scaleShare(3700, 7300, 7310), 3705);
  assert.equal(scaleShare(0, 100, 120), 0);
  assert.equal(scaleShare(100, 100, 120), 120);
});

test("allocation pending, an unknown amount, an unknown category or wallet: held with a question, never imported as a guess", () => {
  const result = plan([
    expense({ id: "booking", merchant: "Booking site", jpy: null, sgd_cents: 52_000, owed_cents: null, allocation_pending: 1, category: "Travel", funding_card: "Bank Miles Card" }),
    expense({ id: "supper", payer: "You", merchant: "Night market", jpy: null, sgd_cents: null, status: "unknown", owed_cents: 0 }),
    expense({ id: "books", merchant: "Bookshop", category: "Cameras / books" }),
    expense({ id: "mystery-card", merchant: "Roadside stand", funding_card: "Visa · contactless", payment_wallet: null })
  ], []);
  for (const id of ["booking", "supper", "books", "mystery-card"]) {
    assert.equal(lineOf(result, id).outcome, "held", id);
    assert.deepEqual(stepsOf(result, id), [], id);
  }
  const blocking = result.questions.filter((question) => question.blocking).map((question) => question.id).sort();
  assert.deepEqual(blocking, ["category-cameras-books", "hold-booking", "hold-supper", "wallet-visa-contactless"]);
  assert.match(result.questions.find((question) => question.id === "hold-booking").text, /who is it for/);
  // The ledger's own figures still count what they can: the booking was paid.
  assert.equal(result.totals.spending.find((row) => row.personName === "Sam").ledgerPaid, 52_000 + 830 + 830);
  assert.ok(result.totals.spendingDifferences.some((item) => item.lineId === "booking" && /^Held/.test(item.why)));

  // Once answered, the same lines go through.
  const answered = plan([
    expense({ id: "books", merchant: "Bookshop", category: "Cameras / books" }),
    expense({ id: "mystery-card", merchant: "Roadside stand", funding_card: "Visa · contactless", payment_wallet: null })
  ], [], { categories: { "Cameras / books": "Shopping" }, wallets: { "Visa · contactless": "acc-miles" } });
  assert.deepEqual(["books", "mystery-card"].map((id) => lineOf(answered, id).outcome), ["new", "new"]);
  assert.equal(stepsOf(answered, "mystery-card")[0].accountId, "acc-miles");
  // An answer naming a category the household does not have is refused.
  assert.throws(() => plan([expense({ id: "books", category: "Cameras / books" })], [], { categories: { "Cameras / books": "Cameras" } }), /not in the household's category list/);
});

test("the owed totals compare the ledger's figure with what Splits would record, line by line", () => {
  const result = plan([
    expense({ id: "lunch", merchant: "Lunch", sgd_cents: 4810, owed_cents: 2405 }),
    expense({ id: "bag", payer: "Kai", merchant: "Umbrella", sgd_cents: 31_500, owed_cents: 31_500, funding_card: null, payment_wallet: null }),
    expense({ id: "held", merchant: "Books", category: "Cameras / books", sgd_cents: 1000, owed_cents: 500 })
  ], []);
  // Ledger: Sam owes Kai 315.00 - 24.05 - 5.00.
  assert.equal(result.totals.owed.ledger, 31_500 - 2405 - 500);
  assert.equal(result.totals.owed.afterImport, 31_500 - 2405);
  assert.deepEqual(result.totals.owed.differences.map((item) => [item.lineId, item.ledger, item.afterImport]), [["held", -500, 0]]);
  const sam = result.totals.spending.find((row) => row.personName === "Sam");
  assert.deepEqual([sam.ledgerPaid, sam.importPaidInEntries, sam.importShare], [4810 + 1000, 4810, 4810 - 2405 + 31_500]);
});

test("a second preview after the import finds its own entries and proposes nothing again", () => {
  const first = plan([expense({ id: "mochi", merchant: "Mochi Stand", jpy: 1100, sgd_cents: 912 })], []);
  const created = first.steps.find((step) => step.kind === "create_entry");
  const again = plan([expense({ id: "mochi", merchant: "Mochi Stand", jpy: 1100, sgd_cents: 912 })], [
    entry({ id: "txn-made", description: "Mochi Stand", amountMinor: 912, originalAmountMinor: 110_000, originalCurrency: "JPY", externalReference: created.externalReference, tripEventId: "trip-1" })
  ]);
  assert.equal(lineOf(again, "mochi").outcome, "matched");
  assert.deepEqual(stepsOf(again, "mochi"), []);
});

test("merchant names: Receipt Match's shop test, a card's cut-off name or the first word is the same shop", () => {
  assert.equal(merchantSimilarity("Cornermart station", "AMAZE* CORNERMART"), "strong");
  assert.equal(merchantSimilarity("Soba Bar · Station branch", "SOBA BAR SAPPORO"), "strong");
  // Receipt Match's own test: two shared shop words are the same shop, one is not.
  assert.equal(merchantSimilarity("North Paper Store", "PAPER STORE OTARU"), "strong");
  assert.equal(merchantSimilarity("Kita Paper Garden Hall", "OTARU PAPER WORKS"), "weak");
  assert.equal(merchantSimilarity("Bean Cafe", "Tea House"), "none");
});

test("the plan hash is stable for the same plan and changes with any change", async () => {
  const one = plan([expense({ id: "a" })], []);
  const two = plan([expense({ id: "a" })], []);
  assert.equal(await hashTripLedgerPlan(one), await hashTripLedgerPlan(two));
  assert.notEqual(await hashTripLedgerPlan(one), await hashTripLedgerPlan({ ...one, steps: one.steps.slice(1) }));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }] }), "{\"a\":[2,{\"c\":\"x\",\"d\":null}],\"b\":1}");
});

test("matching skips held lines and never matches an entry to two purchases", () => {
  const lines = readTripLedgerExport({ expenses: [
    expense({ id: "one", merchant: "Kiosk", sgd_cents: 500, jpy: 600 }),
    expense({ id: "two", merchant: "Kiosk", sgd_cents: 500, jpy: 600, allocation_pending: 1 })
  ], items: [] }, "2031-03-01");
  const result = matchTripLedger({ lines, entries: [entry({ id: "txn-kiosk", description: "Kiosk", amountMinor: 500 })], payerPersonIdFor: () => SAM });
  assert.deepEqual(result.matches.map((match) => [match.lineId, match.confidence, match.entryId]), [["one", "certain", "txn-kiosk"], ["two", "none", null]]);
});

test("an Apple Pay yen estimate the Shortcut saved is matched, never doubled; the asymmetric estimate room is Receipt Match's", () => {
  const result = plan(
    [expense({ id: "konbini", merchant: "Corner Store Ginza", jpy: 1480, sgd_cents: 1240, category: "Food", time: "19:02" })],
    // Saved by the Shortcut at the day's rate: a little under the card's amount.
    [entry({ id: "txn-tap", description: "CORNER STORE", amountMinor: 1228, originalAmountMinor: 148_000, originalCurrency: "JPY", externalReference: "shortcut:abc", time: "18:03" })]
  );
  assert.equal(lineOf(result, "konbini").confidence, "certain");
  assert.equal(lineOf(result, "konbini").entryId, "txn-tap");
  assert.ok(!result.steps.some((step) => step.kind === "create_entry"));
  // Without the kept yen amount: 2% under is the most an entry may be under.
  const under = plan([expense({ id: "a", merchant: "Shop", sgd_cents: 1000, jpy: null })], [entry({ id: "txn-under", description: "Shop", amountMinor: 975 })]);
  assert.equal(lineOf(under, "a").confidence, "none");
  const over = plan([expense({ id: "a", merchant: "Shop", sgd_cents: 1000, jpy: null })], [entry({ id: "txn-over", description: "Shop", amountMinor: 1045 })]);
  assert.equal(lineOf(over, "a").entryId, "txn-over");
});

test("an Apple Pay tap still waiting for its amount holds the purchase instead of adding a second entry", () => {
  const result = plan(
    [expense({ id: "kiosk", merchant: "Station Kiosk", jpy: 650, sgd_cents: 540 })],
    [],
    undefined,
    [{ id: "tap-1", personId: SAM, accountId: "acc-rewards", merchant: "STATION KIOSK", date: "2031-03-02" }]
  );
  assert.equal(lineOf(result, "kiosk").outcome, "held");
  assert.deepEqual(stepsOf(result, "kiosk"), []);
  assert.match(result.questions.find((question) => question.id === "tap-kiosk").text, /waiting for its amount/);
  // A tap of the other person, or at another shop, does not hold it.
  const other = plan([expense({ id: "kiosk", merchant: "Station Kiosk", jpy: 650, sgd_cents: 540 })], [], undefined,
    [{ id: "tap-2", personId: KAI, accountId: "acc-kai-card", merchant: "STATION KIOSK", date: "2031-03-02" }, { id: "tap-3", personId: SAM, accountId: "acc-rewards", merchant: "Bakery", date: "2031-03-02" }]);
  assert.equal(lineOf(other, "kiosk").outcome, "new");
});

test("a wallet the owner only thinks is right is used, and said so in the preview and the entry's note", () => {
  const result = plan(
    [expense({ id: "stand", merchant: "Roadside stand", funding_card: "Visa · contactless", payment_wallet: null, items: "Coffee" })],
    [],
    { wallets: { "Visa · contactless": { accountId: "acc-miles", certain: false } } }
  );
  const line = lineOf(result, "stand");
  assert.equal(line.walletNotCertain, "Miles Card");
  assert.match(line.changes[0], /^Wallet not certain: Miles Card\. New entry on Miles Card/);
  const [create] = stepsOf(result, "stand");
  assert.equal(create.accountId, "acc-miles");
  assert.match(create.note, /\nWallet not certain: Miles Card\. Paid JPY 1,000\./);
  // A plain answer is certain.
  assert.equal(lineOf(plan([expense({ id: "stand", funding_card: "Visa · contactless" })], [], { wallets: { "Visa · contactless": "acc-miles" } }), "stand").walletNotCertain, null);
});
