// FROZEN COPY for tests: src/domain/money-signals/splits-signals.ts as it was
// before the Just for fun lines read whole-group facts (split-group-facts.ts),
// when they counted every record of the group on the page. The settled-rows
// tests compare the new lines with these, word for word. Do not update it.

// Splits' check-in signals, for the selected group, in the group's own
// currency (balances are never converted). A person view talks to that
// person; the household view says what is open between the two of you and
// never compares partners. The group's activity often stays the same for
// months (a finished trip), so its Just for fun types each read a different
// side of it, one per month.
import { addMonths, amountLine, approxMoney, daysBetween, joinWithAnd, monthYear, phrase, shortDay, sortedLine, sum, textLine, tidyName, timesWord, weekdayIndex, weekdayNameOf, type CopyCatalogue, type FormatMoney } from "../../src/domain/money-signals/format";
import { calmLinesFor } from "../../src/domain/money-signals/calm-lines";
import type { TriviaRotation } from "../../src/domain/money-signals/rotation";
import { isCoveredBySettleUp, isOpenExpense } from "../../src/domain/split-open-period";
import { triviaSignal } from "../../src/domain/money-signals/shared-signals";
import type { Audience, MoneySignal } from "../../src/domain/money-signals/types";

// A balance's think lines pair with every phrasing, for either direction
// and the household view, so none names who pays whom. The first teaches
// "settling up", the Settle group button's word for paying the balance back.
const TRIP_THINKS = [
  "Paying back the balance (\"settling up\") while the trip is fresh keeps it easy for both of you.",
  "The balance is simplest to clear while everyone still remembers who paid for what.",
  "Once the balance is paid back, nothing is left to chase.",
  "Clearing the balance now means the next trip starts from zero."
];
const SPLIT_SORTED = { fact: "Sorted: nothing is left to pay back {groupFrom}.", think: "Neither of you owes the other anything here." };

export const SPLITS_COPY = {
  owedToYou: {
    phrasings: [
      "{other} owes you {amount} {groupFrom}.",
      "{other} still owes you {amount} {groupFrom}.",
      "The balance {groupFrom}: {other} owes you {amount}."
    ],
    think: TRIP_THINKS,
    sorted: SPLIT_SORTED,
    action: "Settle group"
  },
  youOwe: {
    phrasings: [
      "You owe {other} {amount} {groupFrom}.",
      "You still owe {other} {amount} {groupFrom}.",
      "The balance {groupFrom}: you owe {other} {amount}."
    ],
    think: TRIP_THINKS,
    sorted: SPLIT_SORTED,
    action: "Settle group"
  },
  openBetweenYou: {
    phrasings: [
      "{amount} still needs paying back between you {groupFrom}.",
      "Not paid back yet {groupFrom}: {amount} between you.",
      "The balance {groupFrom}: {amount} still to pay back between you."
    ],
    think: TRIP_THINKS,
    sorted: SPLIT_SORTED,
    action: "Settle group"
  },
  settleRegularly: {
    phrasings: [],
    think: [
      "Paying back the balance now and then (\"settling up\") keeps it small and easy for both of you.",
      "Small balances are quick to clear.",
      "Clearing it every so often keeps shared money simple between you.",
      "Clearing it now gives the next round of shared costs a fresh start."
    ]
  },
  settlementPayment: {
    phrasings: [
      "{fromWhose} {amount} payment to {to} on {date} matches the {settled} settlement. Matching it marks the settlement paid.",
      "The {amount} {from} paid {to} on {date} is the settlement from {settled}, waiting to be matched.",
      "{from} paid {to} {amount} on {date}, the same as the {settled} settlement.",
      "The {settled} settlement ({amount}) looks paid: {from} sent {to} that amount on {date}."
    ],
    think: [
      "Until it's matched, the payment counts as {fromWhose} spending and {toWhose} income.",
      "Linking the two payments as a transfer, then matching it under the settlement, marks it paid.",
      "Once matched, the settlement shows as paid and the payment stops counting as spending."
    ],
    sorted: {
      fact: "Sorted: the {settled} settlement is matched to its payment.",
      think: "It shows as paid."
    },
    action: "Show the payment"
  },
  settlementPaymentLinked: {
    phrasings: [
      "{fromWhose} {amount} transfer to {to} on {date} matches the {settled} settlement. Matching it marks the settlement paid.",
      "The {amount} {from} sent {to} on {date} is the settlement from {settled}, waiting to be matched.",
      "{from} sent {to} {amount} on {date}, the same as the {settled} settlement.",
      "The {settled} settlement ({amount}) looks paid: {from} sent {to} that amount on {date}."
    ],
    think: [
      "Matching it under the settlement marks it paid.",
      "Once matched, the settlement shows as paid.",
      "It's already a transfer, so only the match is left."
    ],
    sorted: {
      fact: "Sorted: the {settled} settlement is matched to its payment.",
      think: "It shows as paid."
    },
    action: "Show the payment"
  },
  bankMatch: {
    phrasings: [
      "{count} bank payments look like shared costs you already added by hand.",
      "{count} bank payments may be shared costs you've already entered yourself.",
      "{count} bank payments may already be in your shared costs, added by hand."
    ],
    phrasingsOne: [
      "1 bank payment looks like a shared cost you already added by hand.",
      "A bank payment may be a shared cost you've already entered yourself.",
      "One bank payment may already be in your shared costs, added by hand."
    ],
    think: [
      "If they're the same, matching them stops the costs being counted twice.",
      "Matching each payment to its shared cost means it's counted once, not twice.",
      "A quick look shows which are the same cost, so none is counted twice.",
      "Once matched, each shared cost is counted just once."
    ],
    thinkOne: [
      "If they're the same, matching them stops the cost being counted twice.",
      "Matching the payment to its shared cost means it's counted once, not twice.",
      "A quick look shows whether it's the same cost, so it isn't counted twice.",
      "Once matched, the shared cost is counted just once."
    ],
    sorted: { fact: "Sorted: no bank payments are left to match with your shared costs.", think: "Each shared cost is counted once." },
    action: "Review matches"
  },
  shareOfCosts: {
    phrasings: [
      "You paid for {rate}% of shared costs {period} ({paid} of {total}).",
      "Of {total} in shared costs {period}, you paid {paid}.",
      "{paid} of the {total} in shared costs {period} came from you."
    ],
    think: [
      "Nothing to fix here. It can start a friendly chat about who pays for what.",
      "Who pays often evens out over time. This shows where it stands now.",
      "Uneven stretches are normal. Over a longer time it tends to balance.",
      "If one of you earns more, a share above half can still be fair."
    ]
  },
  tripInNumbers: {
    phrasings: ["The trip in numbers{scope}: {count} shared costs, and the priciest was the {name} ({amount})."],
    think: ""
  },
  groupInNumbers: {
    phrasings: ["This group in numbers{scope}: {count} shared costs, and the priciest was the {name} ({amount})."],
    think: ""
  },
  // Every line below puts {groupIn} right after "shared cost(s)", so it
  // reads for a trip ("on the Japan trip"), a group ("in the Home group")
  // and costs outside any group ("outside a group"). These Just for fun
  // lines are about the whole group, settled or not: once anything in the
  // group was settled, {groupIn} says so and since when ("on the Japan trip
  // (settled or not, since 2 Apr)"), so none reads as the Splits chip's
  // open-period figure. A group never settled has one set, so says nothing.
  payerCount: {
    phrasings: ["You paid for {count} of the {total} shared costs {groupIn}, {amount} in all."],
    think: ""
  },
  busiestDay: {
    phrasings: ["The busiest day for shared costs {groupIn}: {day}, with {count} of them."],
    think: ""
  },
  weekdayMost: {
    phrasings: ["{weekday} saw the most shared costs {groupIn}."],
    think: ""
  },
  busiestMonth: {
    phrasings: ["The busiest month for shared costs {groupIn}: {month}, with {count} of them."],
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
    phrasings: ["The priciest day for shared costs {groupIn}: {day}, {amount} in all."],
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
    phrasings: ["{category} was the biggest kind of shared cost {groupIn}, at {amount}."],
    think: ""
  },
  categoriesCount: {
    phrasings: ["Shared costs {groupIn} spread across {count} categories."],
    think: ""
  },
  paymentMix: {
    phrasings: ["How shared costs {groupIn} were paid: {parts}."],
    think: ""
  },
  largestSettlement: {
    phrasings: ["The biggest repayment for shared costs {groupIn}: {amount} on {day}."],
    think: ""
  },
  settleCount: {
    phrasings: ["{count} repayments so far for shared costs {groupIn}."],
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
  // "settled" once a settle-up covers it (split-open-period.ts); a missing
  // status reads as open.
  settlementStatus?: string;
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
  // All of the group's activity, settled or not. Figures about "now" read the
  // open period from it; the Just for fun lines read it all and say so.
  activity: SplitsSignalActivity[];
  pendingMatchCount: number;
  // The household's settlements, for one waiting on its bank payment.
  settlementCheckpoints?: Array<{
    id: string;
    fromPersonName?: string;
    toPersonName?: string;
    settlementDate: string;
    paymentCandidate?: { date: string; amountMinor: number; entryIds: string[]; countedAsSpending: boolean };
  }>;
  today: string;
  // Bound to the group's currency.
  formatMoney: FormatMoney;
}

const TRIP = /trip|holiday|travel|vacation|getaway/i;
// A name that already says what it is: "Flat splits", "Bali costs".
const GROUPISH = /\b(group|splits?|expenses|costs)$/i;
const NON_GROUP = /^non-group\b/i;
const PAYMENT_WAYS: Record<string, string> = { card: "by card", cash: "in cash", bank: "by bank transfer", other: "another way" };

function isTrip(group: SplitsSignalInput["group"]) {
  return Boolean(group && TRIP.test(group.name));
}

// The costs that belong to no group ("Non-group expenses").
function isNonGroup(group: NonNullable<SplitsSignalInput["group"]>) {
  return group.id === "split-group-none" || NON_GROUP.test(group.name);
}

// After a balance: "from the Japan trip", "in the Home group", or "for
// shared costs outside a group".
function groupFrom(group: NonNullable<SplitsSignalInput["group"]>) {
  if (isNonGroup(group)) {
    return "for shared costs outside a group";
  }
  if (isTrip(group)) {
    return `from the ${group.name}`;
  }
  return GROUPISH.test(group.name) ? `in ${group.name}` : `in the ${group.name} group`;
}

// After "shared costs": "on the Japan trip", "in the Home group", or
// "outside a group".
function groupIn(group: NonNullable<SplitsSignalInput["group"]>, input?: SplitsSignalInput) {
  const base = isNonGroup(group) ? "outside a group" : isTrip(group) ? `on the ${group.name}` : groupFrom(group);
  return `${base}${input ? wholeGroupScope(input) : ""}`;
}

// What a whole-group line adds once part of the group is settled: it counts
// everything since the first cost, so it never reads as the open period.
function wholeGroupScope(input: SplitsSignalInput) {
  if (!input.activity.some(isCoveredBySettleUp)) {
    return "";
  }
  const first = input.activity.filter((item) => item.kind === "expense").map((item) => item.date).sort()[0];
  // The year only when it is not this year, so "since 3 Oct 2025" is never
  // read as last month.
  const year = first && first.slice(0, 4) !== input.today.slice(0, 4) ? ` ${first.slice(0, 4)}` : "";
  const since = first ? `${shortDay(first).replace(/^\w{3} /, "")}${year}` : "";
  return since ? ` (settled or not, since ${since})` : " (settled or not)";
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
  const values = { other, amount, groupFrom: groupFrom(group) };
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
    basis: {
      lines: [
        textLine("Group", isNonGroup(group) ? "Shared costs outside a group" : group.name),
        amountLine("Open balance", amountMinor, group.currency),
        ...(input.audience === "person"
          ? [textLine("Who owes whom", group.balanceMinor > 0 ? `${other} owes ${input.viewLabel}` : `${input.viewLabel} owes ${other}`)]
          : [])
      ],
      groupId: group.id
    },
    topic: "settle"
  };
}

// Quick fix: bank payments that may be shared costs already entered by hand.
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
    basis: {
      lines: [textLine("Bank payments that may be shared costs already added", count)],
      ...(input.group ? { groupId: input.group.id } : {})
    },
    topic: "settle"
  };
}

// To do: a payment between the two people for exactly what an open
// settlement still needs (the server finds it, app-repository-splits.ts).
export function settlementPaymentSignal(input: SplitsSignalInput): MoneySignal | null {
  const checkpoint = (input.settlementCheckpoints ?? []).find((item) => item.paymentCandidate?.entryIds.length);
  const candidate = checkpoint?.paymentCandidate;
  if (!checkpoint || !candidate) {
    return null;
  }
  // A person view talks to that person: "Your $7,082.17 payment to Tim",
  // "Joyce paid you".
  const isViewer = (name?: string) => input.audience === "person" && Boolean(name) && name === input.viewLabel;
  const fromName = checkpoint.fromPersonName ?? "";
  const toName = checkpoint.toPersonName ?? "";
  const values = {
    from: isViewer(fromName) ? "you" : fromName,
    fromWhose: isViewer(fromName) ? "your" : `${fromName}'s`,
    to: isViewer(toName) ? "you" : toName,
    toWhose: isViewer(toName) ? "your" : `${toName}'s`,
    amount: input.formatMoney(candidate.amountMinor),
    date: shortDay(candidate.date),
    settled: shortDay(checkpoint.settlementDate)
  };
  const copy = candidate.countedAsSpending ? SPLITS_COPY.settlementPayment : SPLITS_COPY.settlementPaymentLinked;
  return {
    key: `settlement-payment:${checkpoint.id}`,
    kind: "quick_fix",
    weight: candidate.amountMinor,
    numbers: { primaryMinor: candidate.amountMinor },
    primaryText: values.amount,
    phrasings: phrase(copy, values),
    sorted: sortedLine(copy.sorted, values),
    action: { id: "show-entries", label: copy.action, entryIds: candidate.entryIds, month: candidate.date.slice(0, 7) },
    basis: {
      lines: [
        amountLine(`Payment from ${fromName} to ${toName} on ${shortDay(candidate.date)}`, candidate.amountMinor),
        textLine("Settle-up worked out on", shortDay(checkpoint.settlementDate)),
        textLine("Counted as spending", candidate.countedAsSpending ? "Yes" : "No")
      ],
      entries: { entryIds: candidate.entryIds, month: candidate.date.slice(0, 7) },
      ...(input.group ? { groupId: input.group.id } : {})
    },
    topic: "settle"
  };
}

// Long view, person views only: the share of the group's costs this person
// paid, over the last 3 months of the open period (or the whole open period of
// a quieter group). Only expenses no settle-up has covered count, so the total
// is the Splits chip's own figure (split-open-period.ts) or a stated slice of it.
export function shareOfCostsSignal(input: SplitsSignalInput): MoneySignal | null {
  if (input.audience !== "person" || !input.group) {
    return null;
  }
  const expenses = groupExpenses(input).filter(isOpenExpense);
  const since = `${addMonths(input.today.slice(0, 7), -3)}${input.today.slice(7, 10)}`;
  const recent = expenses.filter((item) => item.date >= since);
  const wholeOpenPeriod = input.activity.some(isCoveredBySettleUp) ? "since the last settle-up" : "in this group";
  const [counted, period] = recent.length >= 2 ? [recent, "over the last 3 months"] : [expenses, wholeOpenPeriod];
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
    scope: wholeGroupScope(input),
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
    groupIn: groupIn(input.group, input)
  });
}

// Just for fun: the date with the most shared costs (no tie).
export function busiestDayTrivia(input: SplitsSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(groupExpenses(input), (item) => item.date));
  if (!input.group || !top || top[1] < 2) {
    return null;
  }
  return triviaSignal("busiest-day", top[0], SPLITS_COPY.busiestDay, { day: shortDay(top[0]), count: top[1], groupIn: groupIn(input.group, input) });
}

// Just for fun: the weekday with the most shared costs (no tie).
export function weekdayMostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = groupExpenses(input);
  const top = uniqueTop(countBy(expenses, (item) => weekdayIndex(item.date)));
  if (!input.group || !top || expenses.length < 3 || top[0] < 0) {
    return null;
  }
  return triviaSignal("weekday-most", String(top[0]), SPLITS_COPY.weekdayMost, { weekday: weekdayNameOf(top[0]), groupIn: groupIn(input.group, input) });
}

// Just for fun: the month with the most shared costs (no tie).
export function busiestMonthTrivia(input: SplitsSignalInput): MoneySignal | null {
  const counts = countBy(groupExpenses(input), (item) => item.date.slice(0, 7));
  const top = uniqueTop(counts);
  if (!input.group || !top || counts.size < 2) {
    return null;
  }
  return triviaSignal("busiest-month", top[0], SPLITS_COPY.busiestMonth, { month: monthYear(top[0]), count: top[1], groupIn: groupIn(input.group, input) });
}

// Just for fun: what the shared costs add up to.
export function sharedTotalTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input));
  if (!input.group || expenses.length < 2) {
    return null;
  }
  return triviaSignal("total", input.group.id, SPLITS_COPY.sharedTotal, { amount: input.formatMoney(sum(expenses.map((item) => item.totalAmountMinor))), groupIn: groupIn(input.group, input) });
}

// Just for fun: the average shared cost.
export function averageCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input));
  if (!input.group || expenses.length < 3) {
    return null;
  }
  return triviaSignal("average-cost", input.group.id, SPLITS_COPY.averageCost, {
    amount: approxMoney(input.formatMoney, sum(expenses.map((item) => item.totalAmountMinor)) / expenses.length),
    groupIn: groupIn(input.group, input)
  });
}

// Just for fun: the smallest shared cost with a readable name.
export function smallestCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = inGroupCurrency(input, groupExpenses(input)).filter(costName);
  const smallest = [...expenses].sort((left, right) => left.totalAmountMinor - right.totalAmountMinor || left.date.localeCompare(right.date))[0];
  if (!input.group || !smallest || expenses.length < 3) {
    return null;
  }
  return triviaSignal("smallest-cost", `${smallest.date}:${smallest.totalAmountMinor}`, SPLITS_COPY.smallestCost, { name: costName(smallest), amount: input.formatMoney(smallest.totalAmountMinor), groupIn: groupIn(input.group, input) });
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
    return triviaSignal("first-cost", first.date, SPLITS_COPY.firstDay, { day: shortDay(first.date), count: sameDay, groupIn: groupIn(input.group, input) });
  }
  return costName(first) ? triviaSignal("first-cost", first.date, SPLITS_COPY.firstCost, { name: costName(first), day: shortDay(first.date), groupIn: groupIn(input.group, input) }) : null;
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
  return triviaSignal("priciest-day", top[0], SPLITS_COPY.priciestDay, { day: shortDay(top[0]), amount: input.formatMoney(top[1]), groupIn: groupIn(input.group, input) });
}

// Just for fun: the group's latest expense (alone on its date).
export function latestCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = byDate(inGroupCurrency(input, groupExpenses(input))).reverse();
  const [latest, before] = expenses;
  if (!input.group || !latest || !before || latest.date === before.date || !costName(latest)) {
    return null;
  }
  return triviaSignal("latest-cost", latest.date, SPLITS_COPY.latestCost, { name: costName(latest), amount: input.formatMoney(latest.totalAmountMinor), day: shortDay(latest.date), groupIn: groupIn(input.group, input) });
}

// Just for fun: the cost entered most often (twice or more, no tie).
export function repeatedCostTrivia(input: SplitsSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(groupExpenses(input), (item) => costName(item) || undefined));
  if (!input.group || !top || top[1] < 2) {
    return null;
  }
  return triviaSignal("repeated-cost", top[0], SPLITS_COPY.repeatedCost, { name: top[0], times: timesWord(top[1]), groupIn: groupIn(input.group, input) });
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
    groupIn: groupIn(input.group, input)
  });
}

// Just for fun: the currencies the shared costs came in (two or more).
export function currenciesTrivia(input: SplitsSignalInput): MoneySignal | null {
  const currencies = [...new Set(groupExpenses(input).map((item) => item.currency).filter((currency): currency is string => Boolean(currency)))].sort();
  if (!input.group || currencies.length < 2) {
    return null;
  }
  return triviaSignal("currencies", input.group.id, SPLITS_COPY.currencies, { count: currencies.length, list: joinWithAnd(currencies), groupIn: groupIn(input.group, input) });
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
  return triviaSignal("top-category", top[0], SPLITS_COPY.topCategory, { category: top[0], amount: input.formatMoney(top[1]), groupIn: groupIn(input.group, input) });
}

// Just for fun: how many categories the shared costs spread across.
export function categoriesCountTrivia(input: SplitsSignalInput): MoneySignal | null {
  const count = categoryTotals(input).size;
  return input.group && count >= 2 ? triviaSignal("categories", input.group.id, SPLITS_COPY.categoriesCount, { count, groupIn: groupIn(input.group, input) }) : null;
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
    groupIn: groupIn(input.group, input)
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
  return triviaSignal("largest-settlement", largest.date, SPLITS_COPY.largestSettlement, { amount: input.formatMoney(largest.totalAmountMinor), day: shortDay(largest.date), groupIn: groupIn(input.group, input) });
}

// Just for fun: how many settle-ups there have been (two or more).
export function settleCountTrivia(input: SplitsSignalInput): MoneySignal | null {
  const count = settlements(input).length;
  return input.group && count >= 2 ? triviaSignal("settle-count", input.group.id, SPLITS_COPY.settleCount, { count, groupIn: groupIn(input.group, input) }) : null;
}

export function buildSplitsSignals(input: SplitsSignalInput): MoneySignal[] {
  return [
    splitBalanceSignal(input),
    settlementPaymentSignal(input),
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
