// Splits' check-in signals, for the selected group, in the group's own
// currency (balances are never converted). A person view talks to that
// person; the household view says what is open between the two of you and
// never compares partners. The group's activity often stays the same for
// months (a finished trip), so its Just for fun types each read a different
// side of it, one per month.
import { addMonths, approxMoney, daysBetween, joinWithAnd, monthYear, phrase, shortDay, sortedLine, sum, tidyName, timesWord, weekdayIndex, weekdayNameOf, type CopyCatalogue, type FormatMoney } from "./format";
import { calmLinesFor } from "./checkin";
import type { TriviaRotation } from "./rotation";
import { triviaSignal } from "./shared-signals";
import type { Audience, MoneySignal } from "./types";

const TRIP_THINKS = [
  "Settling while the trip is fresh keeps it light for both of you.",
  "Trips are easiest to settle while everyone remembers the details.",
  "A settled trip leaves only the memories to share.",
  "Clearing the balance now keeps the next trip simple to plan."
];
const SPLIT_SORTED = { fact: "Sorted: {groupName} is settled up.", think: "Nothing open between you on this one." };

export const SPLITS_COPY = {
  owedToYou: {
    phrasings: [
      "{other} owes you {amount} {groupFrom}.",
      "Still open {groupFrom}: {other} owes you {amount}.",
      "The balance {groupFrom}: {other} owes you {amount}."
    ],
    think: TRIP_THINKS,
    sorted: SPLIT_SORTED,
    action: "Settle group"
  },
  youOwe: {
    phrasings: [
      "You owe {other} {amount} {groupFrom}.",
      "Still open {groupFrom}: you owe {other} {amount}.",
      "The balance {groupFrom}: you owe {other} {amount}."
    ],
    think: TRIP_THINKS,
    sorted: SPLIT_SORTED,
    action: "Settle group"
  },
  openBetweenYou: {
    phrasings: [
      "{amount} is still open between you {groupFrom}.",
      "Still open {groupFrom}: {amount} between you.",
      "The balance {groupFrom}: {amount} still to settle between you."
    ],
    think: TRIP_THINKS,
    sorted: SPLIT_SORTED,
    action: "Settle group"
  },
  settleRegularly: {
    phrasings: [],
    think: [
      "Settling regularly keeps it light for both of you.",
      "Small balances are quick to clear.",
      "A regular settle-up keeps shared money simple.",
      "Clearing it now means a fresh start for the next round of shared costs."
    ]
  },
  bankMatch: {
    phrasings: [
      "{count} bank payments may match splits you entered by hand.",
      "{count} bank payments look like splits you already entered.",
      "{count} bank payments are waiting to be matched to splits."
    ],
    phrasingsOne: [
      "1 bank payment may match a split you entered by hand.",
      "A bank payment looks like a split you already entered.",
      "One bank payment is waiting to be matched to a split."
    ],
    think: [
      "Linking them avoids counting the same cost twice.",
      "Matched payments keep the split and the bank telling the same story.",
      "A quick review links each payment to its split.",
      "Once matched, each shared cost shows up exactly once."
    ],
    thinkOne: [
      "Linking it avoids counting the same cost twice.",
      "A matched payment keeps the split and the bank telling the same story.",
      "A quick review links the payment to its split.",
      "Once matched, the shared cost shows up exactly once."
    ],
    sorted: { fact: "Sorted: no bank payments are waiting to be matched.", think: "Each cost is counted once." },
    action: "Review matches"
  },
  shareOfCosts: {
    phrasings: [
      "You paid for {rate}% of shared costs {period} ({paid} of {total}).",
      "Of {total} in shared costs {period}, you paid {paid}.",
      "{paid} of the {total} in shared costs {period} came from you."
    ],
    think: [
      "Nothing to fix by itself. A good prompt for a friendly chat about how you split things.",
      "Who pays often evens out over time. This shows where it stands now.",
      "Uneven stretches are normal. Over a longer time it tends to balance.",
      "A split that feels fair to both of you is the right one."
    ]
  },
  tripInNumbers: {
    phrasings: ["The trip in numbers: {count} shared costs, and the priciest was the {name} ({amount})."],
    think: ""
  },
  groupInNumbers: {
    phrasings: ["This group in numbers: {count} shared costs, and the priciest was the {name} ({amount})."],
    think: ""
  },
  payerCount: {
    phrasings: ["You paid for {count} of the {total} shared costs {groupIn}, {amount} in all."],
    think: ""
  },
  busiestDay: {
    phrasings: ["Busiest day {groupIn}: {day}, with {count} shared costs."],
    think: ""
  },
  weekdayMost: {
    phrasings: ["{weekday} saw the most shared costs {groupIn}."],
    think: ""
  },
  busiestMonth: {
    phrasings: ["Busiest month {groupIn}: {month}, with {count} shared costs."],
    think: ""
  },
  sharedTotal: {
    phrasings: ["Shared costs {groupIn} add up to {amount}."],
    think: ""
  },
  averageCost: {
    phrasings: ["The average shared cost {groupIn}: about {amount}."],
    think: ""
  },
  priciestDay: {
    phrasings: ["The priciest day {groupIn}: {day}, with {amount} of shared costs."],
    think: ""
  },
  smallestCost: {
    phrasings: ["The smallest shared cost {groupIn}: {name}, {amount}."],
    think: ""
  },
  firstCost: {
    phrasings: ["The first shared cost {groupIn}: {name} on {day}."],
    think: ""
  },
  firstDay: {
    phrasings: ["Shared costs {groupIn} began on {day}, with {count} that day."],
    think: ""
  },
  latestCost: {
    phrasings: ["The latest shared cost {groupIn}: {name}, {amount}, on {day}."],
    think: ""
  },
  repeatedCost: {
    phrasings: ["The most repeated shared cost {groupIn}: {name}, {times}."],
    think: ""
  },
  costSpan: {
    phrasings: ["Shared costs {groupIn} span {count} days, from {first} to {last}."],
    think: ""
  },
  currencies: {
    phrasings: ["Shared costs {groupIn} came in {count} currencies: {list}."],
    think: ""
  },
  topCategory: {
    phrasings: ["{category} was the biggest category {groupIn}, at {amount}."],
    think: ""
  },
  categoriesCount: {
    phrasings: ["Shared costs {groupIn} spread across {count} categories."],
    think: ""
  },
  paymentMix: {
    phrasings: ["Shared costs {groupIn}: {parts}."],
    think: ""
  },
  largestSettlement: {
    phrasings: ["The largest settle-up {groupIn}: {amount} on {day}."],
    think: ""
  },
  settleCount: {
    phrasings: ["{count} settle-ups so far {groupIn}."],
    think: ""
  }
} satisfies CopyCatalogue;

export const SPLITS_CALM_LINE = "Nothing needs a look in this group right now.";
export const SPLITS_CALM_LINES = calmLinesFor("this group", SPLITS_CALM_LINE);

// Splits' year of Just for fun, by the current month for the selected
// group: twelve columns, one per month number, each a type and (for some) a
// reserve. See rotation.ts for the rule.
export const SPLITS_TRIVIA_ROTATION: TriviaRotation = {
  columns: [
    ["in-numbers"],
    ["payer", "weekday-most"],
    ["busiest-day", "total"],
    ["currencies", "top-category"],
    ["largest-settlement", "smallest-cost"],
    ["first-cost", "priciest-day"],
    ["latest-cost"],
    ["average-cost"],
    ["categories"],
    ["busiest-month", "repeated-cost"],
    ["settle-count", "span"],
    ["payment-mix"]
  ]
};

export interface SplitsSignalActivity {
  kind: string;
  date: string;
  description?: string;
  totalAmountMinor: number;
  paidByPersonName?: string;
  categoryName?: string;
  currency?: string;
  paymentMethod?: string;
}

export interface SplitsSignalInput {
  audience: Audience;
  viewId: string;
  viewLabel: string;
  people: Array<{ id: string; name: string }>;
  group: { id: string; name: string; balanceMinor: number; currency?: string } | null;
  // The group's current (not archived) activity.
  activity: SplitsSignalActivity[];
  pendingMatchCount: number;
  today: string;
  // Bound to the group's currency.
  formatMoney: FormatMoney;
}

const TRIP = /trip|holiday|travel|vacation|getaway/i;
// A name that already says what it is: "Non-group expenses", "Flat splits".
const GROUPISH = /\b(group|splits?|expenses|costs)$/i;
const PAYMENT_WAYS: Record<string, string> = { card: "by card", cash: "in cash", bank: "by bank transfer", other: "another way" };

function isTrip(group: SplitsSignalInput["group"]) {
  return Boolean(group && TRIP.test(group.name));
}

// "from the Japan trip", or "in the Home group".
function groupFrom(group: NonNullable<SplitsSignalInput["group"]>) {
  if (isTrip(group)) {
    return `from the ${group.name}`;
  }
  return GROUPISH.test(group.name) ? `in ${group.name}` : `in the ${group.name} group`;
}

// "on the Japan trip", or "in the Home group".
function groupIn(group: NonNullable<SplitsSignalInput["group"]>) {
  return isTrip(group) ? `on the ${group.name}` : groupFrom(group);
}

function groupName(group: NonNullable<SplitsSignalInput["group"]>) {
  return isTrip(group) ? `the ${group.name}` : GROUPISH.test(group.name) ? group.name : `the ${group.name} group`;
}

// "the {name}": a description that already starts with "The" drops it.
function costName(item: SplitsSignalActivity) {
  return tidyName(item.description).replace(/^the\s+/i, "");
}

// The group's expenses, and the ones in its own currency (the only ones
// money is added up over).
function groupExpenses(input: SplitsSignalInput) {
  return input.activity.filter((item) => item.kind === "expense" && item.totalAmountMinor > 0);
}

function inGroupCurrency(input: SplitsSignalInput, items: SplitsSignalActivity[]) {
  const currency = input.group?.currency;
  return items.filter((item) => !currency || !item.currency || item.currency === currency);
}

function uniqueTop<K>(counts: Map<K, number>): [K, number] | null {
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return sorted[0] && (!sorted[1] || sorted[1][1] !== sorted[0][1]) ? sorted[0] : null;
}

function countBy<T, K>(items: T[], keyOf: (item: T) => K | undefined) {
  const counts = new Map<K, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined && key !== "") {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// Quick fix: the group's open balance, from the view's side.
export function splitBalanceSignal(input: SplitsSignalInput): MoneySignal | null {
  const group = input.group;
  if (!group || group.balanceMinor === 0) {
    return null;
  }
  const other = input.people.find((person) => person.id !== input.viewId)?.name ?? "the other person";
  const amountMinor = Math.abs(group.balanceMinor);
  const amount = input.formatMoney(amountMinor);
  const copy = input.audience === "household"
    ? SPLITS_COPY.openBetweenYou
    : group.balanceMinor > 0 ? SPLITS_COPY.owedToYou : SPLITS_COPY.youOwe;
  const values = { other, amount, groupFrom: groupFrom(group), groupName: groupName(group) };
  return {
    key: `split-balance:${group.id}`,
    kind: "quick_fix",
    weight: amountMinor,
    numbers: { primaryMinor: amountMinor },
    primaryText: amount,
    phrasings: phrase(copy, values, { think: isTrip(group) ? copy.think : SPLITS_COPY.settleRegularly.think }),
    sorted: sortedLine(copy.sorted, values),
    // Settle group is a person view's control; the household view has none.
    action: input.audience === "person" ? { id: "settle-group", label: copy.action } : undefined,
    topic: "settle"
  };
}

// Quick fix: bank payments that may match a split entered by hand.
export function bankMatchSignal(input: SplitsSignalInput): MoneySignal | null {
  const count = Math.max(0, Math.round(input.pendingMatchCount));
  if (!count) {
    return null;
  }
  const copy = SPLITS_COPY.bankMatch;
  return {
    key: "split-match",
    kind: "quick_fix",
    weight: 0,
    numbers: { primaryMinor: count },
    phrasings: phrase(copy, { count }, { one: count === 1 }),
    sorted: copy.sorted,
    action: { id: "review-matches", label: copy.action },
    topic: "settle"
  };
}

// Long view, person views only: the share of the group's costs this person
// paid, over the last 3 months (or the whole open batch of a quieter group).
export function shareOfCostsSignal(input: SplitsSignalInput): MoneySignal | null {
  if (input.audience !== "person" || !input.group) {
    return null;
  }
  const expenses = groupExpenses(input);
  const since = `${addMonths(input.today.slice(0, 7), -3)}${input.today.slice(7, 10)}`;
  const recent = expenses.filter((item) => item.date >= since);
  const [counted, period] = recent.length >= 2 ? [recent, "over the last 3 months"] : [expenses, "in this group"];
  const totalMinor = sum(counted.map((item) => item.totalAmountMinor));
  const paidMinor = sum(counted.filter((item) => item.paidByPersonName === input.viewLabel).map((item) => item.totalAmountMinor));
  if (counted.length < 2 || totalMinor <= 0) {
    return null;
  }
  return {
    key: "share-of-costs",
    kind: "long_view",
    weight: totalMinor,
    numbers: { primaryMinor: paidMinor },
    phrasings: phrase(SPLITS_COPY.shareOfCosts, {
      rate: Math.round((paidMinor / totalMinor) * 100),
      period,
      paid: input.formatMoney(paidMinor),
      total: input.formatMoney(totalMinor)
    }),
    topic: "settle"
  };
}

// Just for fun: the group (or trip) in numbers.
export function groupInNumbersTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input));
  if (!input.group || expenses.length < 2) {
    return null;
  }
  const priciest = [...expenses].sort((left, right) => right.totalAmountMinor - left.totalAmountMinor || left.date.localeCompare(right.date))[0];
  return triviaSignal("in-numbers", input.group.id, isTrip(input.group) ? SPLITS_COPY.tripInNumbers : SPLITS_COPY.groupInNumbers, {
    count: groupExpenses(input).length,
    name: costName(priciest) || "shared cost",
    amount: input.formatMoney(priciest.totalAmountMinor)
  });
}

// Just for fun, person views only: how many of the costs this person paid
// for. The household view never compares partners.
export function payerTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input));
  const paid = expenses.filter((item) => item.paidByPersonName === input.viewLabel);
  if (input.audience !== "person" || !input.group || expenses.length < 2 || !paid.length) {
    return null;
  }
  return triviaSignal("payer", input.group.id, SPLITS_COPY.payerCount, {
    count: paid.length,
    total: expenses.length,
    amount: input.formatMoney(sum(paid.map((item) => item.totalAmountMinor))),
    groupIn: groupIn(input.group)
  });
}

// Just for fun: the date with the most shared costs (no tie).
export function busiestDayTrivia(input: SplitsSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(groupExpenses(input), (item) => item.date));
  if (!input.group || !top || top[1] < 2) {
    return null;
  }
  return triviaSignal("busiest-day", top[0], SPLITS_COPY.busiestDay, { day: shortDay(top[0]), count: top[1], groupIn: groupIn(input.group) });
}

// Just for fun: the weekday with the most shared costs (no tie).
export function weekdayMostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = groupExpenses(input);
  const top = uniqueTop(countBy(expenses, (item) => weekdayIndex(item.date)));
  if (!input.group || !top || expenses.length < 3 || top[0] < 0) {
    return null;
  }
  return triviaSignal("weekday-most", String(top[0]), SPLITS_COPY.weekdayMost, { weekday: weekdayNameOf(top[0]), groupIn: groupIn(input.group) });
}

// Just for fun: the month with the most shared costs (no tie).
export function busiestMonthTrivia(input: SplitsSignalInput): MoneySignal | null {
  const counts = countBy(groupExpenses(input), (item) => item.date.slice(0, 7));
  const top = uniqueTop(counts);
  if (!input.group || !top || counts.size < 2) {
    return null;
  }
  return triviaSignal("busiest-month", top[0], SPLITS_COPY.busiestMonth, { month: monthYear(top[0]), count: top[1], groupIn: groupIn(input.group) });
}

// Just for fun: what the shared costs add up to.
export function sharedTotalTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input));
  if (!input.group || expenses.length < 2) {
    return null;
  }
  return triviaSignal("total", input.group.id, SPLITS_COPY.sharedTotal, { amount: input.formatMoney(sum(expenses.map((item) => item.totalAmountMinor))), groupIn: groupIn(input.group) });
}

// Just for fun: the average shared cost.
export function averageCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input));
  if (!input.group || expenses.length < 3) {
    return null;
  }
  return triviaSignal("average-cost", input.group.id, SPLITS_COPY.averageCost, {
    amount: approxMoney(input.formatMoney, sum(expenses.map((item) => item.totalAmountMinor)) / expenses.length),
    groupIn: groupIn(input.group)
  });
}

// Just for fun: the smallest shared cost with a readable name.
export function smallestCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input)).filter(costName);
  const smallest = [...expenses].sort((left, right) => left.totalAmountMinor - right.totalAmountMinor || left.date.localeCompare(right.date))[0];
  if (!input.group || !smallest || expenses.length < 3) {
    return null;
  }
  return triviaSignal("smallest-cost", `${smallest.date}:${smallest.totalAmountMinor}`, SPLITS_COPY.smallestCost, { name: costName(smallest), amount: input.formatMoney(smallest.totalAmountMinor), groupIn: groupIn(input.group) });
}

function byDate(items: SplitsSignalActivity[]) {
  return [...items].sort((left, right) => left.date.localeCompare(right.date));
}

// Just for fun: the group's first expense, or its first day when several
// share that date (so "first" is always true).
export function firstCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = byDate(groupExpenses(input));
  const first = expenses[0];
  if (!input.group || !first || expenses.length < 2) {
    return null;
  }
  const sameDay = expenses.filter((item) => item.date === first.date).length;
  if (sameDay > 1) {
    return triviaSignal("first-cost", first.date, SPLITS_COPY.firstDay, { day: shortDay(first.date), count: sameDay, groupIn: groupIn(input.group) });
  }
  return costName(first) ? triviaSignal("first-cost", first.date, SPLITS_COPY.firstCost, { name: costName(first), day: shortDay(first.date), groupIn: groupIn(input.group) }) : null;
}

// Just for fun: the date with the most money in shared costs (no tie).
export function priciestDayTrivia(input: SplitsSignalInput): MoneySignal | null {
  const totals = new Map<string, number>();
  for (const item of inGroupCurrency(input, groupExpenses(input))) {
    totals.set(item.date, (totals.get(item.date) ?? 0) + item.totalAmountMinor);
  }
  const top = uniqueTop(totals);
  if (!input.group || !top || totals.size < 2) {
    return null;
  }
  return triviaSignal("priciest-day", top[0], SPLITS_COPY.priciestDay, { day: shortDay(top[0]), amount: input.formatMoney(top[1]), groupIn: groupIn(input.group) });
}

// Just for fun: the group's latest expense (alone on its date).
export function latestCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = byDate(inGroupCurrency(input, groupExpenses(input))).reverse();
  const [latest, before] = expenses;
  if (!input.group || !latest || !before || latest.date === before.date || !costName(latest)) {
    return null;
  }
  return triviaSignal("latest-cost", latest.date, SPLITS_COPY.latestCost, { name: costName(latest), amount: input.formatMoney(latest.totalAmountMinor), day: shortDay(latest.date), groupIn: groupIn(input.group) });
}

// Just for fun: the cost entered most often (twice or more, no tie).
export function repeatedCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(groupExpenses(input), (item) => costName(item) || undefined));
  if (!input.group || !top || top[1] < 2) {
    return null;
  }
  return triviaSignal("repeated-cost", top[0], SPLITS_COPY.repeatedCost, { name: top[0], times: timesWord(top[1]), groupIn: groupIn(input.group) });
}

// Just for fun: the days from the first shared cost to the last.
export function costSpanTrivia(input: SplitsSignalInput): MoneySignal | null {
  const dates = [...new Set(groupExpenses(input).map((item) => item.date))].sort();
  if (!input.group || dates.length < 2) {
    return null;
  }
  return triviaSignal("span", input.group.id, SPLITS_COPY.costSpan, {
    count: daysBetween(dates[0], dates.at(-1)!) + 1,
    first: shortDay(dates[0]),
    last: shortDay(dates.at(-1)!),
    groupIn: groupIn(input.group)
  });
}

// Just for fun: the currencies the shared costs came in (two or more).
export function currenciesTrivia(input: SplitsSignalInput): MoneySignal | null {
  const currencies = [...new Set(groupExpenses(input).map((item) => item.currency).filter((currency): currency is string => Boolean(currency)))].sort();
  if (!input.group || currencies.length < 2) {
    return null;
  }
  return triviaSignal("currencies", input.group.id, SPLITS_COPY.currencies, { count: currencies.length, list: joinWithAnd(currencies), groupIn: groupIn(input.group) });
}

function categoryTotals(input: SplitsSignalInput) {
  const totals = new Map<string, number>();
  for (const item of inGroupCurrency(input, groupExpenses(input))) {
    const category = String(item.categoryName ?? "").trim();
    if (category && !/^(other|uncategori[sz]ed)$/i.test(category)) {
      totals.set(category, (totals.get(category) ?? 0) + item.totalAmountMinor);
    }
  }
  return totals;
}

// Just for fun: the group's biggest category (no tie, two or more).
export function topCategoryTrivia(input: SplitsSignalInput): MoneySignal | null {
  const totals = categoryTotals(input);
  const top = uniqueTop(totals);
  if (!input.group || !top || totals.size < 2) {
    return null;
  }
  return triviaSignal("top-category", top[0], SPLITS_COPY.topCategory, { category: top[0], amount: input.formatMoney(top[1]), groupIn: groupIn(input.group) });
}

// Just for fun: how many categories the shared costs spread across.
export function categoriesCountTrivia(input: SplitsSignalInput): MoneySignal | null {
  const count = categoryTotals(input).size;
  return input.group && count >= 2 ? triviaSignal("categories", input.group.id, SPLITS_COPY.categoriesCount, { count, groupIn: groupIn(input.group) }) : null;
}

// Just for fun: how the shared costs were paid (two or more ways).
export function paymentMixTrivia(input: SplitsSignalInput): MoneySignal | null {
  const counts = [...countBy(groupExpenses(input), (item) => PAYMENT_WAYS[item.paymentMethod ?? ""] ? item.paymentMethod : undefined).entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
  if (!input.group || counts.length < 2) {
    return null;
  }
  return triviaSignal("payment-mix", input.group.id, SPLITS_COPY.paymentMix, {
    parts: joinWithAnd(counts.map(([method, count]) => `${count} ${PAYMENT_WAYS[String(method)]}`)),
    groupIn: groupIn(input.group)
  });
}

function settlements(input: SplitsSignalInput) {
  return input.activity.filter((item) => item.kind === "settlement" && item.totalAmountMinor > 0);
}

// Just for fun: the largest settle-up.
export function largestSettlementTrivia(input: SplitsSignalInput): MoneySignal | null {
  const largest = [...inGroupCurrency(input, settlements(input))].sort((left, right) => right.totalAmountMinor - left.totalAmountMinor || left.date.localeCompare(right.date))[0];
  if (!input.group || !largest) {
    return null;
  }
  return triviaSignal("largest-settlement", largest.date, SPLITS_COPY.largestSettlement, { amount: input.formatMoney(largest.totalAmountMinor), day: shortDay(largest.date), groupIn: groupIn(input.group) });
}

// Just for fun: how many settle-ups there have been (two or more).
export function settleCountTrivia(input: SplitsSignalInput): MoneySignal | null {
  const count = settlements(input).length;
  return input.group && count >= 2 ? triviaSignal("settle-count", input.group.id, SPLITS_COPY.settleCount, { count, groupIn: groupIn(input.group) }) : null;
}

export function buildSplitsSignals(input: SplitsSignalInput): MoneySignal[] {
  return [
    splitBalanceSignal(input),
    bankMatchSignal(input),
    shareOfCostsSignal(input),
    groupInNumbersTrivia(input),
    payerTrivia(input),
    busiestDayTrivia(input),
    weekdayMostTrivia(input),
    busiestMonthTrivia(input),
    sharedTotalTrivia(input),
    averageCostTrivia(input),
    smallestCostTrivia(input),
    firstCostTrivia(input),
    priciestDayTrivia(input),
    latestCostTrivia(input),
    repeatedCostTrivia(input),
    costSpanTrivia(input),
    currenciesTrivia(input),
    topCategoryTrivia(input),
    categoriesCountTrivia(input),
    paymentMixTrivia(input),
    largestSettlementTrivia(input),
    settleCountTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
