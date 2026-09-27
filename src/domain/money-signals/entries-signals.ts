// Entries' check-in signals, over one month's list for the view and scope
// (before any search or filter, so the check-in says the same whatever is
// being looked at). Everything comes from the entries the page loaded.
// Entries' Just for fun types are about the list itself (its places,
// accounts, amounts and days); Month's are about the calendar and the
// plan, so the two pages never show the same trivia for a month.
import {
  dayPair,
  monthName,
  monthPhase,
  phrase,
  plural,
  shortDay,
  sortedLine,
  sum,
  tidyName,
  timesWord,
  weekdayIndex,
  type CopyCatalogue,
  type FormatMoney
} from "./format";
import { calmLinesFor } from "./checkin";
import type { TriviaRotation } from "./rotation";
import { triviaSignal } from "./shared-signals";
import type { Audience, MoneySignal } from "./types";

export const ENTRIES_COPY = {
  uncategorized: {
    phrasings: [
      "{count} entries {when} are still in Other.",
      "Still in Other: {count} entries, {total} in all.",
      "{count} entries {when} haven't found a category yet."
    ],
    phrasingsOne: [
      "1 entry {when} is still in Other: {name}.",
      "{name} is still in Other.",
      "Still in Other: {name}, {total}."
    ],
    think: [
      "Categories power every chart. Sorting these takes about a minute.",
      "A category on each entry keeps the monthly picture accurate.",
      "Once sorted, these show up in the right place on every chart.",
      "A few taps now and the totals by category tell the full story."
    ],
    thinkOne: [
      "Categories power every chart. Sorting it takes about a minute.",
      "A category on it keeps the monthly picture accurate.",
      "Once sorted, it shows up in the right place on every chart.",
      "A few taps now and the totals by category tell the full story."
    ],
    sorted: {
      fact: "Sorted: every entry {when} has a category.",
      think: "Every chart here now tells the whole story."
    },
    action: "Show those entries"
  },
  possibleDuplicate: {
    phrasings: [
      "{name} charged {amount} twice, on {dates}.",
      "Two entries for {name} at {amount} each, on {dates}.",
      "Same amount, same place, close together: {name}, {amount}, on {dates}."
    ],
    think: [
      "Might be right, might be a double charge. A quick look settles it.",
      "Double charges are rare but worth catching. The bank statement shows which it is.",
      "Two of the same close together is sometimes right, sometimes a slip. Either way it's quick to check.",
      "If both are real, nothing to do. If not, removing one keeps the month's totals right."
    ],
    action: "Show those entries"
  },
  topFive: {
    phrasings: [
      "Your five largest entries were {rate}% of {whose} spending ({top}).",
      "{top} of the {total} spent {when} came from just five entries.",
      "Five entries, {top}: that's {rate}% of {whose} spending of {total}."
    ],
    think: [
      "A few big items usually shape a month more than many small ones. That's where a decision has the most effect.",
      "Big items are where a month's shape comes from. They're also the easiest to plan for.",
      "The largest few entries usually explain most of a month.",
      "Most of a month's money goes out in a few decisions. These were the big ones."
    ],
    action: "Show those entries"
  },
  smallestEntry: {
    phrasings: ["Smallest entry {when}: {amount} at {name}."],
    think: ""
  },
  largestEntry: {
    phrasings: ["Largest entry {when}: {amount} at {name}."],
    think: ""
  },
  placesCount: {
    phrasings: ["Entries {when} came from {count} different places."],
    think: ""
  },
  oneOffPlaces: {
    phrasings: ["{count} places show up just once {when}."],
    think: ""
  },
  topPlace: {
    phrasings: ["Most spent at one place {when}: {name}, {amount} over {count} entries."],
    think: ""
  },
  topAccount: {
    phrasings: ["Most-used account or card {when}: {account}, with {count} entries."],
    think: ""
  },
  accountsCount: {
    phrasings: ["Entries {when} used {count} different accounts and cards."],
    think: ""
  },
  averageEntry: {
    phrasings: ["The average entry {when} came to {amount}, across {count} expenses."],
    think: ""
  },
  medianEntry: {
    phrasings: ["Half of the purchases {when} came to {amount} or less."],
    think: ""
  },
  firstEntry: {
    phrasings: ["First entry {when}: {name}, {amount}, on {day}."],
    think: ""
  },
  firstDay: {
    phrasings: ["First day with spending {when}: {day}, led by {name} at {amount}."],
    think: ""
  },
  entrySpan: {
    phrasings: ["Entries {when} run from {first} to {last}, across {days} different days."],
    think: ""
  },
  repeatedAmount: {
    phrasings: ["The most repeated amount {when}: {amount}, {times}."],
    think: ""
  },
  categoryCount: {
    phrasings: ["{category} had the most entries {when}: {count} of them."],
    think: ""
  },
  busiestDate: {
    phrasings: ["Busiest day {when}: {day}, with {count} entries."],
    think: ""
  },
  weekendEntries: {
    phrasings: ["{count} of the {total} entries {when} fell on a weekend."],
    think: ""
  },
  roundAmounts: {
    phrasings: ["{count} entries {when} were round amounts, with no cents."],
    think: ""
  },
  sharedEntries: {
    phrasings: ["{count} of the {total} entries {when} were shared costs."],
    think: ""
  },
  incomeEntries: {
    phrasings: ["Income {when}: {total} across {entries}."],
    think: ""
  }
} satisfies CopyCatalogue;

export const ENTRIES_CALM_LINE = "Nothing in this list needs a look right now.";
export const ENTRIES_CALM_LINES = calmLinesFor("this list", ENTRIES_CALM_LINE);

// Entries' year of Just for fun: twelve columns, one per month number,
// each a type and (for most) a reserve. See rotation.ts for the rule.
export const ENTRIES_TRIVIA_ROTATION: TriviaRotation = {
  columns: [
    ["smallest", "one-off-places"],
    ["places", "income"],
    ["top-account", "round-amounts"],
    ["average", "shared"],
    ["span"],
    ["largest"],
    ["repeated-amount", "top-place"],
    ["category-count"],
    ["first-day"],
    ["median"],
    ["accounts-count"],
    ["busiest-date", "weekend-entries"]
  ]
};

export interface EntriesSignalEntry {
  id: string;
  date: string;
  description?: string;
  categoryName?: string;
  accountName?: string;
  ownershipType?: string;
  entryType: string;
  // The view's amount (a person's share of a shared entry).
  amountMinor: number;
  linkedTransfer?: unknown;
}

export interface EntriesSignalInput {
  audience: Audience;
  month: string;
  today: string;
  entries: EntriesSignalEntry[];
  formatMoney: FormatMoney;
}

const UNCATEGORIZED = /^(other|uncategori[sz]ed)?$/i;
// A fee, interest or adjustment is not a purchase, so never the smallest one.
const NOT_A_PURCHASE = /fee|charge|interest|adjust|rounding|refund|cash ?back|rebate/i;
// A routine obligation or money moved is not a place to be curious about.
const NOT_A_PLACE = /bill|utilit|subscription|insurance|rent|mortgage|loan|saving|invest|tax|salary|income|transfer/i;
const MIN_LIST = 3;

function expenses(input: EntriesSignalInput) {
  return input.entries.filter((entry) => entry.entryType === "expense" && Math.abs(entry.amountMinor) > 0);
}

// Purchases with a readable place name (never a fee, or a PayNow or
// transfer reference, which tidyName leaves empty).
function namedPurchases(input: EntriesSignalInput) {
  return expenses(input)
    .filter((entry) => !NOT_A_PURCHASE.test(`${entry.categoryName ?? ""} ${entry.description ?? ""}`))
    .map((entry) => ({ entry, name: tidyName(entry.description) }))
    .filter((item) => item.name);
}

function places(input: EntriesSignalInput) {
  return namedPurchases(input).filter((item) => !NOT_A_PLACE.test(item.entry.categoryName ?? ""));
}

function amountOf(entry: EntriesSignalEntry) {
  return Math.abs(entry.amountMinor);
}

// The key with the highest count, only when no other key ties it.
function uniqueTop<K>(counts: Map<K, number>): [K, number] | null {
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) {
    return null;
  }
  return sorted[0];
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

function when(input: EntriesSignalInput) {
  return monthPhase(input.month, input.today) === "past"
    ? { when: `in ${monthName(input.month)}`, whose: `${monthName(input.month)}'s` }
    : { when: "this month", whose: "this month's" };
}

// Quick fix: expenses still in Other.
export function uncategorizedSignal(input: EntriesSignalInput): MoneySignal | null {
  const other = expenses(input).filter((entry) => UNCATEGORIZED.test(String(entry.categoryName ?? "").trim()));
  if (!other.length) {
    return null;
  }
  const totalMinor = sum(other.map(amountOf));
  const values = { count: other.length, total: input.formatMoney(totalMinor), name: tidyName(other[0].description) || "One entry", ...when(input) };
  const copy = ENTRIES_COPY.uncategorized;
  return {
    key: "uncategorized",
    kind: "quick_fix",
    weight: totalMinor,
    numbers: { primaryMinor: totalMinor, count: other.length },
    phrasings: phrase(copy, values, { one: other.length === 1 }),
    sorted: sortedLine(copy.sorted, values),
    action: { id: "open-category", label: copy.action, categoryName: String(other[0].categoryName || "Other") },
    topic: "later"
  };
}

// Worth a look: the same amount from the same place twice within a week.
export function possibleDuplicateSignal(input: EntriesSignalInput): MoneySignal | null {
  const candidates = expenses(input)
    .filter((entry) => !entry.linkedTransfer && tidyName(entry.description))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  let best: [EntriesSignalEntry, EntriesSignalEntry] | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    for (let next = index + 1; next < candidates.length; next += 1) {
      const [first, second] = [candidates[index], candidates[next]];
      const daysApart = (Date.parse(second.date) - Date.parse(first.date)) / 86_400_000;
      if (daysApart > 7) {
        break;
      }
      const sameCharge = amountOf(first) === amountOf(second)
        && tidyName(first.description).toLowerCase() === tidyName(second.description).toLowerCase();
      if (sameCharge && (!best || amountOf(first) > amountOf(best[0]))) {
        best = [first, second];
      }
    }
  }
  if (!best) {
    return null;
  }
  const [first, second] = best;
  const amountMinor = amountOf(first);
  const copy = ENTRIES_COPY.possibleDuplicate;
  return {
    key: `duplicate:${first.id}:${second.id}`,
    kind: "worth_a_look",
    weight: amountMinor,
    numbers: { primaryMinor: amountMinor },
    phrasings: phrase(copy, { name: tidyName(first.description), amount: input.formatMoney(amountMinor), dates: dayPair(first.date, second.date) }),
    action: { id: "show-entries", label: copy.action, entryIds: [first.id, second.id] },
    topic: "small-costs"
  };
}

// Worth a look: the five largest entries' share of the month's spending.
export function topFiveSignal(input: EntriesSignalInput): MoneySignal | null {
  const list = [...expenses(input)].sort((left, right) => amountOf(right) - amountOf(left) || left.id.localeCompare(right.id));
  if (list.length < 6) {
    return null;
  }
  const totalMinor = sum(list.map(amountOf));
  const top = list.slice(0, 5);
  const topMinor = sum(top.map(amountOf));
  const rate = Math.round((topMinor / totalMinor) * 100);
  if (totalMinor <= 0 || rate < 40) {
    return null;
  }
  const copy = ENTRIES_COPY.topFive;
  return {
    key: "top-five",
    kind: "worth_a_look",
    weight: topMinor,
    numbers: { primaryMinor: topMinor, rate },
    phrasings: phrase(copy, { rate, top: input.formatMoney(topMinor), total: input.formatMoney(totalMinor), ...when(input) }),
    action: { id: "show-entries", label: copy.action, entryIds: top.map((entry) => entry.id) },
    topic: "enjoy"
  };
}

// Just for fun: the month's smallest purchase with a readable name.
export function smallestEntryTrivia(input: EntriesSignalInput): MoneySignal | null {
  const smallest = namedPurchases(input)
    .sort((left, right) => amountOf(left.entry) - amountOf(right.entry) || left.entry.id.localeCompare(right.entry.id))[0];
  if (!smallest || expenses(input).length < MIN_LIST) {
    return null;
  }
  return triviaSignal("smallest", smallest.entry.id, ENTRIES_COPY.smallestEntry, {
    amount: input.formatMoney(amountOf(smallest.entry)),
    name: smallest.name,
    ...when(input)
  });
}

// Just for fun: the month's largest purchase at a place (not a bill).
export function largestEntryTrivia(input: EntriesSignalInput): MoneySignal | null {
  const largest = places(input)
    .sort((left, right) => amountOf(right.entry) - amountOf(left.entry) || left.entry.id.localeCompare(right.entry.id))[0];
  if (!largest || expenses(input).length < MIN_LIST) {
    return null;
  }
  return triviaSignal("largest", largest.entry.id, ENTRIES_COPY.largestEntry, {
    amount: input.formatMoney(amountOf(largest.entry)),
    name: largest.name,
    ...when(input)
  });
}

function placeCounts(input: EntriesSignalInput) {
  return countBy(places(input), (item) => item.name.toLowerCase());
}

// Just for fun: how many different places the month's purchases came from.
export function placesCountTrivia(input: EntriesSignalInput): MoneySignal | null {
  const count = placeCounts(input).size;
  return count >= MIN_LIST ? triviaSignal("places", input.month, ENTRIES_COPY.placesCount, { count, ...when(input) }) : null;
}

// Just for fun: places that show up only once in the month.
export function oneOffPlacesTrivia(input: EntriesSignalInput): MoneySignal | null {
  const counts = placeCounts(input);
  const count = [...counts.values()].filter((value) => value === 1).length;
  return count >= 2 && counts.size >= MIN_LIST ? triviaSignal("one-off-places", input.month, ENTRIES_COPY.oneOffPlaces, { count, ...when(input) }) : null;
}

// Just for fun: the place with the most spent across two or more entries.
export function topPlaceTrivia(input: EntriesSignalInput): MoneySignal | null {
  const byPlace = new Map<string, { name: string; totalMinor: number; count: number }>();
  for (const { entry, name } of places(input)) {
    const current = byPlace.get(name.toLowerCase()) ?? { name, totalMinor: 0, count: 0 };
    current.totalMinor += amountOf(entry);
    current.count += 1;
    byPlace.set(name.toLowerCase(), current);
  }
  const [top, next] = [...byPlace.values()].filter((item) => item.count >= 2).sort((left, right) => right.totalMinor - left.totalMinor);
  if (!top || (next && next.totalMinor === top.totalMinor) || byPlace.size < MIN_LIST) {
    return null;
  }
  return triviaSignal("top-place", top.name, ENTRIES_COPY.topPlace, { name: top.name, amount: input.formatMoney(top.totalMinor), count: top.count, ...when(input) });
}

// Just for fun: the account or card with the most entries in the list.
export function topAccountTrivia(input: EntriesSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(input.entries, (entry) => entry.accountName?.trim()));
  if (!top || top[1] < 2 || input.entries.length < MIN_LIST) {
    return null;
  }
  return triviaSignal("top-account", top[0], ENTRIES_COPY.topAccount, { account: top[0], count: top[1], ...when(input) });
}

// Just for fun: how many accounts and cards the month's entries used.
export function accountsCountTrivia(input: EntriesSignalInput): MoneySignal | null {
  const count = countBy(input.entries, (entry) => entry.accountName?.trim()).size;
  return count >= 2 && input.entries.length >= MIN_LIST ? triviaSignal("accounts-count", input.month, ENTRIES_COPY.accountsCount, { count, ...when(input) }) : null;
}

// Just for fun: the average expense.
export function averageEntryTrivia(input: EntriesSignalInput): MoneySignal | null {
  const list = expenses(input);
  if (list.length < MIN_LIST) {
    return null;
  }
  const averageMinor = Math.round(sum(list.map(amountOf)) / list.length);
  return triviaSignal("average", input.month, ENTRIES_COPY.averageEntry, { amount: input.formatMoney(averageMinor), count: list.length, ...when(input) });
}

// Just for fun: the median purchase (never a fee or a PayNow). At least
// half the purchases are this amount or less.
export function medianEntryTrivia(input: EntriesSignalInput): MoneySignal | null {
  const amounts = namedPurchases(input)
    .map((item) => amountOf(item.entry))
    .sort((left, right) => left - right);
  if (amounts.length < 4) {
    return null;
  }
  const medianMinor = amounts[Math.ceil(amounts.length / 2) - 1];
  return triviaSignal("median", input.month, ENTRIES_COPY.medianEntry, { amount: input.formatMoney(medianMinor), ...when(input) });
}

// Just for fun: the first day with spending, and its entry (or the largest
// of several that day).
export function firstDayTrivia(input: EntriesSignalInput): MoneySignal | null {
  const named = namedPurchases(input);
  const firstDate = expenses(input).map((entry) => entry.date).sort()[0];
  if (!firstDate || expenses(input).length < MIN_LIST) {
    return null;
  }
  const sameDay = expenses(input).filter((entry) => entry.date === firstDate);
  const lead = named.filter((item) => item.entry.date === firstDate)
    .sort((left, right) => amountOf(right.entry) - amountOf(left.entry) || left.entry.id.localeCompare(right.entry.id))[0];
  if (!lead) {
    return null;
  }
  const copy = sameDay.length === 1 ? ENTRIES_COPY.firstEntry : ENTRIES_COPY.firstDay;
  return triviaSignal("first-day", firstDate, copy, { name: lead.name, amount: input.formatMoney(amountOf(lead.entry)), day: shortDay(firstDate), ...when(input) });
}

// Just for fun: the first and last dates in the list, and the days between.
export function entrySpanTrivia(input: EntriesSignalInput): MoneySignal | null {
  const dates = [...new Set(input.entries.map((entry) => entry.date))].sort();
  if (dates.length < 2 || input.entries.length < MIN_LIST) {
    return null;
  }
  return triviaSignal("span", input.month, ENTRIES_COPY.entrySpan, { first: shortDay(dates[0]), last: shortDay(dates.at(-1)!), days: dates.length, ...when(input) });
}

// Just for fun: the amount that appears most often (twice or more, no tie).
export function repeatedAmountTrivia(input: EntriesSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(expenses(input), amountOf));
  if (!top || top[1] < 2) {
    return null;
  }
  return triviaSignal("repeated-amount", String(top[0]), ENTRIES_COPY.repeatedAmount, { amount: input.formatMoney(top[0]), times: timesWord(top[1]), ...when(input) });
}

// Just for fun: the category with the most expenses (never Other).
export function categoryCountTrivia(input: EntriesSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(expenses(input), (entry) => {
    const name = String(entry.categoryName ?? "").trim();
    return UNCATEGORIZED.test(name) ? undefined : name;
  }));
  if (!top || top[1] < 2) {
    return null;
  }
  return triviaSignal("category-count", top[0], ENTRIES_COPY.categoryCount, { category: top[0], count: top[1], ...when(input) });
}

// Just for fun: the date with the most entries (no tie).
export function busiestDateTrivia(input: EntriesSignalInput): MoneySignal | null {
  const top = uniqueTop(countBy(input.entries, (entry) => entry.date));
  if (!top || top[1] < 2 || input.entries.length < MIN_LIST) {
    return null;
  }
  return triviaSignal("busiest-date", top[0], ENTRIES_COPY.busiestDate, { day: shortDay(top[0]), count: top[1], ...when(input) });
}

// Just for fun: entries dated on a Saturday or Sunday.
export function weekendEntriesTrivia(input: EntriesSignalInput): MoneySignal | null {
  const count = input.entries.filter((entry) => [0, 6].includes(weekdayIndex(entry.date))).length;
  if (count < 2 || input.entries.length < 5) {
    return null;
  }
  return triviaSignal("weekend-entries", input.month, ENTRIES_COPY.weekendEntries, { count, total: input.entries.length, ...when(input) });
}

// Just for fun: expenses in whole dollars.
export function roundAmountsTrivia(input: EntriesSignalInput): MoneySignal | null {
  const count = expenses(input).filter((entry) => amountOf(entry) % 100 === 0).length;
  return count >= 2 && expenses(input).length >= MIN_LIST ? triviaSignal("round-amounts", input.month, ENTRIES_COPY.roundAmounts, { count, ...when(input) }) : null;
}

// Just for fun: shared entries in the list.
export function sharedEntriesTrivia(input: EntriesSignalInput): MoneySignal | null {
  const count = input.entries.filter((entry) => entry.ownershipType === "shared").length;
  if (count < 2 || count >= input.entries.length) {
    return null;
  }
  return triviaSignal("shared", input.month, ENTRIES_COPY.sharedEntries, { count, total: input.entries.length, ...when(input) });
}

// Just for fun: the month's income entries.
export function incomeEntriesTrivia(input: EntriesSignalInput): MoneySignal | null {
  const income = input.entries.filter((entry) => entry.entryType === "income" && entry.amountMinor > 0);
  if (!income.length || input.entries.length < MIN_LIST) {
    return null;
  }
  return triviaSignal("income", input.month, ENTRIES_COPY.incomeEntries, {
    entries: plural(income.length, "entry", "entries"),
    total: input.formatMoney(sum(income.map((entry) => entry.amountMinor))),
    ...when(input)
  });
}

export function buildEntriesSignals(input: EntriesSignalInput): MoneySignal[] {
  return [
    uncategorizedSignal(input),
    possibleDuplicateSignal(input),
    topFiveSignal(input),
    smallestEntryTrivia(input),
    largestEntryTrivia(input),
    placesCountTrivia(input),
    oneOffPlacesTrivia(input),
    topPlaceTrivia(input),
    topAccountTrivia(input),
    accountsCountTrivia(input),
    averageEntryTrivia(input),
    medianEntryTrivia(input),
    firstDayTrivia(input),
    entrySpanTrivia(input),
    repeatedAmountTrivia(input),
    categoryCountTrivia(input),
    busiestDateTrivia(input),
    weekendEntriesTrivia(input),
    roundAmountsTrivia(input),
    sharedEntriesTrivia(input),
    incomeEntriesTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
