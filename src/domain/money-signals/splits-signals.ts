// Splits' check-in signals, for the selected group, in the group's own
// currency (balances are never converted). A person view talks to that
// person; the household view says what is open between the two of you and
// never compares partners.
import { addMonths, daysBetween, phrase, sum, type CopyCatalogue, type FormatMoney } from "./format";
import { triviaSignal } from "./shared-signals";
import type { Audience, MoneySignal } from "./types";

export const SPLITS_COPY = {
  owedToYou: {
    phrasings: [
      "{other} owes you {amount} {groupFrom}.",
      "Still open {groupFrom}: {other} owes you {amount}.",
      "The balance {groupFrom}: {other} owes you {amount}."
    ],
    think: "Settling while the trip is fresh keeps it light for both of you.",
    sorted: { fact: "Sorted: {groupName} is settled up.", think: "Nothing open between you on this one." },
    action: "Settle group"
  },
  youOwe: {
    phrasings: [
      "You owe {other} {amount} {groupFrom}.",
      "Still open {groupFrom}: you owe {other} {amount}.",
      "The balance {groupFrom}: you owe {other} {amount}."
    ],
    think: "Settling while the trip is fresh keeps it light for both of you.",
    sorted: { fact: "Sorted: {groupName} is settled up.", think: "Nothing open between you on this one." },
    action: "Settle group"
  },
  openBetweenYou: {
    phrasings: [
      "{amount} is still open between you {groupFrom}.",
      "Still open {groupFrom}: {amount} between you.",
      "The balance {groupFrom}: {amount} still to settle between you."
    ],
    think: "Settling while the trip is fresh keeps it light for both of you.",
    sorted: { fact: "Sorted: {groupName} is settled up.", think: "Nothing open between you on this one." },
    action: "Settle group"
  },
  settleRegularly: {
    phrasings: [],
    think: "Settling regularly keeps it light for both of you."
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
    think: "Linking them avoids counting the same cost twice.",
    thinkOne: "Linking it avoids counting the same cost twice.",
    sorted: { fact: "Sorted: no bank payments are waiting to be matched.", think: "Each cost is counted once." },
    action: "Review matches"
  },
  shareOfCosts: {
    phrasings: [
      "You paid for {rate}% of shared costs {period} ({paid} of {total}).",
      "Of {total} in shared costs {period}, you paid {paid}.",
      "{paid} of the {total} in shared costs {period} came from you."
    ],
    think: "Nothing to fix by itself. A good prompt for a friendly chat about how you split things."
  },
  tripInNumbers: {
    phrasings: ["The trip in numbers: {count} shared costs, and the priciest was the {name} ({amount})."],
    think: ""
  },
  groupInNumbers: {
    phrasings: ["This group in numbers: {count} shared costs, and the priciest was the {name} ({amount})."],
    think: ""
  }
} satisfies CopyCatalogue;

export const SPLITS_CALM_LINE = "Nothing needs a look in this group right now.";

export interface SplitsSignalActivity {
  kind: string;
  date: string;
  description?: string;
  totalAmountMinor: number;
  paidByPersonName?: string;
}

export interface SplitsSignalInput {
  audience: Audience;
  viewId: string;
  viewLabel: string;
  people: Array<{ id: string; name: string }>;
  group: { id: string; name: string; balanceMinor: number } | null;
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

function groupName(group: NonNullable<SplitsSignalInput["group"]>) {
  return isTrip(group) ? `the ${group.name}` : GROUPISH.test(group.name) ? group.name : `the ${group.name} group`;
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
    sorted: phrase({ phrasings: [copy.sorted.fact], think: copy.sorted.think }, values)[0],
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
  const expenses = input.activity.filter((item) => item.kind === "expense" && item.totalAmountMinor > 0);
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

// Just for fun: the group (or trip) in numbers. Right after a trip ends it
// is the moment's line.
export function groupInNumbersTrivia(input: SplitsSignalInput): MoneySignal | null {
  const expenses = input.activity.filter((item) => item.kind === "expense" && item.totalAmountMinor > 0);
  if (!input.group || expenses.length < 2) {
    return null;
  }
  const priciest = [...expenses].sort((left, right) => right.totalAmountMinor - left.totalAmountMinor || left.date.localeCompare(right.date))[0];
  const lastDate = expenses.map((item) => item.date).sort().at(-1) ?? "";
  const sinceLast = daysBetween(lastDate, input.today);
  const trip = isTrip(input.group);
  return triviaSignal(`group-in-numbers:${input.group.id}`, trip ? SPLITS_COPY.tripInNumbers : SPLITS_COPY.groupInNumbers, {
    count: expenses.length,
    // "the {name}": a description that already starts with "The" drops it.
    name: String(priciest.description || "shared cost").trim().replace(/^the\s+/i, ""),
    amount: input.formatMoney(priciest.totalAmountMinor)
  }, { moment: trip && sinceLast >= 2 && sinceLast <= 30 });
}

export function buildSplitsSignals(input: SplitsSignalInput): MoneySignal[] {
  return [
    splitBalanceSignal(input),
    bankMatchSignal(input),
    shareOfCostsSignal(input),
    groupInNumbersTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
