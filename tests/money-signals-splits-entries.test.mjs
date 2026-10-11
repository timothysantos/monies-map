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
    "Serene still owes you JP¥26,730 from the Japan trip.",
    "The balance from the Japan trip: Serene owes you JP¥26,730."
  ]);
  assert.equal(owed.phrasings[0].think, "Paying back the balance (\"settling up\") while the trip is fresh keeps it easy for both of you.");
  assert.deepEqual(owed.action, { id: "settle-group", label: "Settle group" });
  assert.deepEqual(owed.sorted, { fact: "Sorted: nothing is left to pay back from the Japan trip.", think: "Neither of you owes the other anything here." });

  const owes = splitBalanceSignal(splits({ viewId: "person-serene", viewLabel: "Serene", group: { ...JAPAN, balanceMinor: -2_673_000 } }));
  assert.equal(facts(owes)[0], "You owe Ethan JP¥26,730 from the Japan trip.");

  const household = splitBalanceSignal(splits({ audience: "household", viewId: "household", viewLabel: "Household" }));
  assert.deepEqual(facts(household), [
    "JP¥26,730 still needs paying back between you from the Japan trip.",
    "Not paid back yet from the Japan trip: JP¥26,730 between you.",
    "The balance from the Japan trip: JP¥26,730 still to pay back between you."
  ]);
  assert.ok(facts(household).every((fact) => !/Ethan|Serene|owes/.test(fact)));
  assert.equal(household.action, undefined);

  // A home group is not a trip.
  const home = splitBalanceSignal(splits({ group: { id: "home", name: "Home", balanceMinor: 12_345 }, formatMoney: sgd }));
  assert.equal(facts(home)[0], "Serene owes you $123.45 in the Home group.");
  assert.equal(home.phrasings[0].think, "Paying back the balance now and then (\"settling up\") keeps it small and easy for both of you.");
  assert.equal(home.sorted.fact, "Sorted: nothing is left to pay back in the Home group.");
  // Costs outside any group never read as a group called "Non-group expenses".
  const nonGroup = splitBalanceSignal(splits({ group: { id: "none", name: "Non-group expenses", balanceMinor: -26_025 }, formatMoney: sgd }));
  assert.deepEqual(facts(nonGroup), [
    "You owe Serene $260.25 for shared costs outside a group.",
    "You still owe Serene $260.25 for shared costs outside a group.",
    "The balance for shared costs outside a group: you owe Serene $260.25."
  ]);
  assert.equal(nonGroup.sorted.fact, "Sorted: nothing is left to pay back for shared costs outside a group.");
  assert.ok(facts(nonGroup).every((fact) => !/non-group/i.test(fact)));
  assert.equal(splitBalanceSignal(splits({ group: { ...JAPAN, balanceMinor: 0 } })), null);
  assert.equal(splitBalanceSignal(splits({ group: null })), null);
});

test("bank match: bank payments that may be shared costs entered by hand", () => {
  const one = bankMatchSignal(splits({ pendingMatchCount: 1 }));
  assert.deepEqual(facts(one), [
    "1 bank payment looks like a shared cost you already added by hand.",
    "A bank payment may be a shared cost you've already entered yourself.",
    "One bank payment may already be in your shared costs, added by hand."
  ]);
  assert.equal(one.phrasings[0].think, "If they're the same, matching them stops the cost being counted twice.");
  assert.deepEqual(one.action, { id: "review-matches", label: "Review matches" });
  const three = bankMatchSignal(splits({ pendingMatchCount: 3 }));
  assert.equal(facts(three)[0], "3 bank payments look like shared costs you already added by hand.");
  assert.equal(three.phrasings[0].think, "If they're the same, matching them stops the costs being counted twice.");
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
  assert.equal(signal.phrasings[0].think, "Nothing to fix here. It can start a friendly chat about who pays for what.");
  const recent = shareOfCostsSignal(splits({ today: "2026-05-01", activity: TRIP_ACTIVITY }));
  assert.match(facts(recent)[0], /over the last 3 months/);
  assert.equal(shareOfCostsSignal(splits({ audience: "household", viewId: "household", activity: TRIP_ACTIVITY })), null);
  assert.equal(shareOfCostsSignal(splits({ activity: TRIP_ACTIVITY.slice(0, 1) })), null);
});

test("the trip in numbers, a trivia type the year rotation schedules (never a moment)", () => {
  const signal = groupInNumbersTrivia(splits({ activity: TRIP_ACTIVITY }));
  assert.equal(signal.kind, "just_for_fun");
  assert.deepEqual(facts(signal), ["The trip in numbers: 3 shared costs, and the priciest was the Tokyo hotel (JP¥168,000)."]);
  // A description with a comma, or one that already starts with "The",
  // still reads cleanly.
  const withComma = groupInNumbersTrivia(splits({ activity: [{ ...TRIP_ACTIVITY[0], description: "Tokyo hotel, 4 nights" }, ...TRIP_ACTIVITY.slice(1)] }));
  assert.deepEqual(facts(withComma), ["The trip in numbers: 3 shared costs, and the priciest was the Tokyo hotel, 4 nights (JP¥168,000)."]);
  const withThe = groupInNumbersTrivia(splits({ activity: [{ ...TRIP_ACTIVITY[0], description: "The Peninsula Tokyo" }, ...TRIP_ACTIVITY.slice(1)] }));
  assert.deepEqual(facts(withThe), ["The trip in numbers: 3 shared costs, and the priciest was the Peninsula Tokyo (JP¥168,000)."]);
  assert.doesNotMatch(facts(withThe)[0], /the the/i);
  assert.equal(signal.triviaType, "in-numbers");
  // Right after the trip ends it is not pushed ahead of the rotation: that
  // could show it two months running.
  assert.equal(groupInNumbersTrivia(splits({ activity: TRIP_ACTIVITY, today: "2026-04-25" })).moment, false);
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
    "2 purchases this month, $40.00 in all, don't have a category yet.",
    "2 purchases this month have no category yet, $40.00 in all.",
    "$40.00 of spending this month has no category yet, across 2 purchases."
  ]);
  assert.equal(signal.phrasings[0].think, "They sit under \"Other\", so your spending by category can't show what they were for. Giving each one a category fills that in.");
  assert.deepEqual(signal.action, { id: "open-category", label: "Show these purchases", categoryName: "Other" });
  assert.deepEqual(signal.sorted, { fact: "Sorted: every purchase this month now has a category.", think: "Your spending by category now shows where all of it went." });
  const one = uncategorizedSignal(entries({ today: "2026-09-27", entries: list.slice(1) }));
  assert.deepEqual(facts(one), ["One purchase in August has no category yet: Lazada, $15.00.", "Lazada ($15.00) has no category yet.", "In August, Lazada for $15.00 is the only purchase without a category."]);
  assert.equal(uncategorizedSignal(entries({ entries: list.slice(2) })), null);
});

test("possible duplicate: the same amount from the same place within a week", () => {
  const first = entry("2026-08-03", "SPOTIFY", 1_098, "Subscriptions");
  const second = entry("2026-08-05", "Spotify", 1_098, "Subscriptions");
  const signal = possibleDuplicateSignal(entries({ entries: [first, second, entry("2026-08-20", "SPOTIFY", 1_098, "Subscriptions")] }));
  assert.deepEqual(facts(signal), [
    "Spotify charged $10.98 twice, on 3 and 5 Aug.",
    "Two payments of $10.98 each to Spotify, on 3 and 5 Aug.",
    "Spotify shows up twice for the same $10.98, on 3 and 5 Aug."
  ]);
  assert.equal(signal.phrasings[0].think, "It could be two real purchases, or one charged twice. A quick look settles it.");
  assert.deepEqual(signal.action, { id: "show-entries", label: "Show both payments", entryIds: [first.id, second.id] });
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
    "Your five largest payments came to $4,000.00, 67% of this month's spending.",
    "$4,000.00 of the $6,000.00 spent this month went on just five payments.",
    "Just five payments made up 67% of this month's spending: $4,000.00 of $6,000.00."
  ]);
  assert.equal(signal.phrasings[0].think, "A few big items usually shape a month more than many small ones. That's where a decision has the most effect.");
  assert.equal(signal.action.entryIds.length, 5);
  const even = Array.from({ length: 20 }, (_, index) => entry("2026-08-06", `Coffee ${index}`, 1_000));
  assert.equal(topFiveSignal(entries({ entries: even })), null);
});

test("smallest entry: the smallest purchase, never a fee", () => {
  const list = [entry("2026-08-02", "VENDING MACHINE", 120), entry("2026-08-03", "CARD FEE", 50, "Bank fees"), entry("2026-08-04", "NTUC", 5_000)];
  assert.deepEqual(facts(smallestEntryTrivia(entries({ entries: list }))), ["Smallest purchase this month: $1.20 at Vending Machine."]);
  assert.equal(smallestEntryTrivia(entries({ entries: list.slice(0, 2) })), null);
  assert.deepEqual(buildEntriesSignals(entries()), []);
});
