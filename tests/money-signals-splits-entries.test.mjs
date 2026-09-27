// Splits' and Entries' check-in signals: each fires with its numbers and
// the approved wording, and stays silent when its condition is not met.
import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import {
  bankMatchSignal,
  buildSplitsSignals,
  groupInNumbersTrivia,
  shareOfCostsSignal,
  splitBalanceSignal
} from "../src/domain/money-signals/splits-signals.ts";
import {
  buildEntriesSignals,
  possibleDuplicateSignal,
  smallestEntryTrivia,
  topFiveSignal,
  uncategorizedSignal
} from "../src/domain/money-signals/entries-signals.ts";

const jpy = (minor) => formatCurrencyMinor(minor, "JPY");
const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
const facts = (signal) => signal.phrasings.map((phrasing) => phrasing.fact);
const PEOPLE = [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }];
const JAPAN = { id: "split-group-japan-trip", name: "Japan trip", balanceMinor: 2_673_000 };

function splits(overrides = {}) {
  return {
    audience: "person",
    viewId: "person-ethan",
    viewLabel: "Ethan",
    people: PEOPLE,
    group: JAPAN,
    activity: [],
    pendingMatchCount: 0,
    today: "2026-09-27",
    formatMoney: jpy,
    ...overrides
  };
}

test("split balance: owed to you, you owe, and neutral for the household, in the group's currency", () => {
  const owed = splitBalanceSignal(splits());
  assert.equal(owed.kind, "quick_fix");
  assert.deepEqual(facts(owed), [
    "Serene owes you JP¥26,730 from the Japan trip.",
    "Still open from the Japan trip: Serene owes you JP¥26,730.",
    "The balance from the Japan trip: Serene owes you JP¥26,730."
  ]);
  assert.equal(owed.phrasings[0].think, "Settling while the trip is fresh keeps it light for both of you.");
  assert.deepEqual(owed.action, { id: "settle-group", label: "Settle group" });
  assert.deepEqual(owed.sorted, { fact: "Sorted: the Japan trip is settled up.", think: "Nothing open between you on this one." });

  const owes = splitBalanceSignal(splits({ viewId: "person-serene", viewLabel: "Serene", group: { ...JAPAN, balanceMinor: -2_673_000 } }));
  assert.equal(facts(owes)[0], "You owe Ethan JP¥26,730 from the Japan trip.");

  const household = splitBalanceSignal(splits({ audience: "household", viewId: "household", viewLabel: "Household" }));
  assert.deepEqual(facts(household), [
    "JP¥26,730 is still open between you from the Japan trip.",
    "Still open from the Japan trip: JP¥26,730 between you.",
    "The balance from the Japan trip: JP¥26,730 still to settle between you."
  ]);
  assert.ok(facts(household).every((fact) => !/Ethan|Serene|owes/.test(fact)));
  assert.equal(household.action, undefined);

  // A home group is not a trip.
  const home = splitBalanceSignal(splits({ group: { id: "home", name: "Home", balanceMinor: 12_345 }, formatMoney: sgd }));
  assert.equal(facts(home)[0], "Serene owes you $123.45 in the Home group.");
  assert.equal(home.phrasings[0].think, "Settling regularly keeps it light for both of you.");
  assert.equal(facts(splitBalanceSignal(splits({ group: { id: "none", name: "Non-group expenses", balanceMinor: -26_025 }, formatMoney: sgd })))[1], "Still open in Non-group expenses: you owe Serene $260.25.");
  assert.equal(splitBalanceSignal(splits({ group: { ...JAPAN, balanceMinor: 0 } })), null);
  assert.equal(splitBalanceSignal(splits({ group: null })), null);
});

test("bank match: bank payments that may match a split entered by hand", () => {
  const one = bankMatchSignal(splits({ pendingMatchCount: 1 }));
  assert.deepEqual(facts(one), [
    "1 bank payment may match a split you entered by hand.",
    "A bank payment looks like a split you already entered.",
    "One bank payment is waiting to be matched to a split."
  ]);
  assert.equal(one.phrasings[0].think, "Linking it avoids counting the same cost twice.");
  assert.deepEqual(one.action, { id: "review-matches", label: "Review matches" });
  assert.equal(facts(bankMatchSignal(splits({ pendingMatchCount: 3 })))[0], "3 bank payments may match splits you entered by hand.");
  assert.equal(bankMatchSignal(splits()), null);
});

const TRIP_ACTIVITY = [
  { kind: "expense", date: "2026-04-10", description: "Tokyo hotel", totalAmountMinor: 16_800_000, paidByPersonName: "Ethan" },
  { kind: "expense", date: "2026-04-12", description: "Shinkansen", totalAmountMinor: 5_600_000, paidByPersonName: "Serene" },
  { kind: "expense", date: "2026-04-13", description: "Ryokan", totalAmountMinor: 7_600_000, paidByPersonName: "Ethan" },
  { kind: "settlement", date: "2026-04-20", description: "Cash settle-up", totalAmountMinor: 1_000_000 }
];

test("share of costs: a person view's long view, never the household's", () => {
  const signal = shareOfCostsSignal(splits({ activity: TRIP_ACTIVITY }));
  assert.equal(signal.kind, "long_view");
  assert.deepEqual(facts(signal), [
    "You paid for 81% of shared costs in this group (JP¥244,000 of JP¥300,000).",
    "Of JP¥300,000 in shared costs in this group, you paid JP¥244,000.",
    "JP¥244,000 of the JP¥300,000 in shared costs in this group came from you."
  ]);
  assert.equal(signal.phrasings[0].think, "Nothing to fix by itself. A good prompt for a friendly chat about how you split things.");
  const recent = shareOfCostsSignal(splits({ today: "2026-05-01", activity: TRIP_ACTIVITY }));
  assert.match(facts(recent)[0], /over the last 3 months/);
  assert.equal(shareOfCostsSignal(splits({ audience: "household", viewId: "household", activity: TRIP_ACTIVITY })), null);
  assert.equal(shareOfCostsSignal(splits({ activity: TRIP_ACTIVITY.slice(0, 1) })), null);
});

test("the trip in numbers, the moment's line right after a trip ends", () => {
  const signal = groupInNumbersTrivia(splits({ activity: TRIP_ACTIVITY }));
  assert.equal(signal.kind, "just_for_fun");
  assert.deepEqual(facts(signal), ["The trip in numbers: 3 shared costs, and the priciest was Tokyo hotel at JP¥168,000."]);
  assert.equal(signal.moment, false);
  assert.equal(groupInNumbersTrivia(splits({ activity: TRIP_ACTIVITY, today: "2026-04-25" })).moment, true);
  assert.match(facts(groupInNumbersTrivia(splits({ group: { id: "home", name: "Home", balanceMinor: 0 }, activity: TRIP_ACTIVITY })))[0], /^This group in numbers/);
  assert.equal(groupInNumbersTrivia(splits({ activity: TRIP_ACTIVITY.slice(0, 1) })), null);
  assert.deepEqual(buildSplitsSignals(splits({ group: { ...JAPAN, balanceMinor: 0 }, activity: [] })), []);
});

let nextId = 0;
function entry(date, description, amountMinor, categoryName = "Shopping", entryType = "expense") {
  nextId += 1;
  return { id: `e${nextId}`, date, description, amountMinor, categoryName, entryType };
}

function entries(overrides = {}) {
  return { audience: "household", month: "2026-08", today: "2026-08-20", entries: [], formatMoney: sgd, ...overrides };
}

test("uncategorized: entries still in Other, with the filter action and a sorted line", () => {
  const list = [entry("2026-08-02", "SHOPEE SG", 2_500, "Other"), entry("2026-08-03", "LAZADA", 1_500, "Other"), entry("2026-08-04", "NTUC", 5_000, "Groceries")];
  const signal = uncategorizedSignal(entries({ entries: list }));
  assert.deepEqual(facts(signal), [
    "2 entries this month are still in Other.",
    "Still in Other: 2 entries, $40.00 in all.",
    "2 entries this month haven't found a category yet."
  ]);
  assert.equal(signal.phrasings[0].think, "Categories power every chart. Sorting these takes about a minute.");
  assert.deepEqual(signal.action, { id: "open-category", label: "Show those entries", categoryName: "Other" });
  assert.deepEqual(signal.sorted, { fact: "Sorted: every entry this month has a category.", think: "Every chart here now tells the whole story." });
  const one = uncategorizedSignal(entries({ today: "2026-09-27", entries: list.slice(1) }));
  assert.deepEqual(facts(one), ["1 entry in August is still in Other: Lazada.", "Lazada is still in Other.", "Still in Other: Lazada, $15.00."]);
  assert.equal(uncategorizedSignal(entries({ entries: list.slice(2) })), null);
});

test("possible duplicate: the same amount from the same place within a week", () => {
  const first = entry("2026-08-03", "SPOTIFY", 1_098, "Subscriptions");
  const second = entry("2026-08-05", "Spotify", 1_098, "Subscriptions");
  const signal = possibleDuplicateSignal(entries({ entries: [first, second, entry("2026-08-20", "SPOTIFY", 1_098, "Subscriptions")] }));
  assert.deepEqual(facts(signal), [
    "Spotify charged $10.98 twice, on 3 and 5 Aug.",
    "Two entries for Spotify at $10.98 each, on 3 and 5 Aug.",
    "Same amount, same place, close together: Spotify, $10.98, on 3 and 5 Aug."
  ]);
  assert.equal(signal.phrasings[0].think, "Might be right, might be a double charge. A quick look settles it.");
  assert.deepEqual(signal.action, { id: "show-entries", label: "Show those entries", entryIds: [first.id, second.id] });
  // A month apart, or different amounts: silent.
  assert.equal(possibleDuplicateSignal(entries({ entries: [first, entry("2026-08-20", "SPOTIFY", 1_098)] })), null);
  assert.equal(possibleDuplicateSignal(entries({ entries: [first, entry("2026-08-04", "SPOTIFY", 1_198)] })), null);
});

test("top five: the five largest entries' share, with the money beside it", () => {
  const list = [
    entry("2026-08-01", "Rent", 200_000), entry("2026-08-02", "Flights", 80_000), entry("2026-08-03", "Sofa", 60_000),
    entry("2026-08-04", "Dinner", 30_000), entry("2026-08-05", "Groceries", 30_000),
    ...Array.from({ length: 10 }, (_, index) => entry("2026-08-06", `Coffee ${index}`, 20_000))
  ];
  const signal = topFiveSignal(entries({ entries: list }));
  assert.deepEqual(facts(signal), [
    "Your five largest entries were 67% of this month's spending ($4,000.00).",
    "$4,000.00 of the $6,000.00 spent this month came from just five entries.",
    "Five entries, $4,000.00: that's 67% of this month's spending of $6,000.00."
  ]);
  assert.equal(signal.phrasings[0].think, "A few big items usually shape a month more than many small ones. That's where a decision has the most effect.");
  assert.equal(signal.action.entryIds.length, 5);
  const even = Array.from({ length: 20 }, (_, index) => entry("2026-08-06", `Coffee ${index}`, 1_000));
  assert.equal(topFiveSignal(entries({ entries: even })), null);
});

test("smallest entry: the smallest purchase, never a fee", () => {
  const list = [entry("2026-08-02", "VENDING MACHINE", 120), entry("2026-08-03", "CARD FEE", 50, "Bank fees"), entry("2026-08-04", "NTUC", 5_000)];
  assert.deepEqual(facts(smallestEntryTrivia(entries({ entries: list }))), ["Smallest entry this month: $1.20 at Vending Machine."]);
  assert.equal(smallestEntryTrivia(entries({ entries: list.slice(0, 2) })), null);
  assert.deepEqual(buildEntriesSignals(entries()), []);
});
