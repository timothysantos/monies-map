// Entries' check-in signals, over one month's list for the view and scope
// (before any search or filter, so the check-in says the same whatever is
// being looked at). Everything comes from the entries the page loaded.
import {
  dayPair,
  monthName,
  monthPhase,
  phrase,
  sum,
  tidyName,
  type CopyCatalogue,
  type FormatMoney
} from "./format";
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
    think: "Categories power every chart. Sorting these takes about a minute.",
    thinkOne: "Categories power every chart. Sorting it takes about a minute.",
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
    think: "Might be right, might be a double charge. A quick look settles it.",
    action: "Show those entries"
  },
  topFive: {
    phrasings: [
      "Your five largest entries were {rate}% of {whose} spending ({top}).",
      "{top} of the {total} spent {when} came from just five entries.",
      "Five entries, {top}: that's {rate}% of {whose} spending of {total}."
    ],
    think: "A few big items usually shape a month more than many small ones. That's where a decision has the most effect.",
    action: "Show those entries"
  },
  smallestEntry: {
    phrasings: ["Smallest entry {when}: {amount} at {name}."],
    think: ""
  }
} satisfies CopyCatalogue;

export const ENTRIES_CALM_LINE = "Nothing in this list needs a look right now.";

export interface EntriesSignalEntry {
  id: string;
  date: string;
  description?: string;
  categoryName?: string;
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

function expenses(input: EntriesSignalInput) {
  return input.entries.filter((entry) => entry.entryType === "expense" && Math.abs(entry.amountMinor) > 0);
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
  const totalMinor = sum(other.map((entry) => Math.abs(entry.amountMinor)));
  const values = { count: other.length, total: input.formatMoney(totalMinor), name: tidyName(other[0].description) || "One entry", ...when(input) };
  const copy = ENTRIES_COPY.uncategorized;
  return {
    key: "uncategorized",
    kind: "quick_fix",
    weight: totalMinor,
    numbers: { primaryMinor: totalMinor, count: other.length },
    phrasings: phrase(copy, values, { one: other.length === 1 }),
    sorted: phrase({ phrasings: [copy.sorted.fact], think: copy.sorted.think }, values)[0],
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
      const sameCharge = Math.abs(first.amountMinor) === Math.abs(second.amountMinor)
        && tidyName(first.description).toLowerCase() === tidyName(second.description).toLowerCase();
      if (sameCharge && (!best || Math.abs(first.amountMinor) > Math.abs(best[0].amountMinor))) {
        best = [first, second];
      }
    }
  }
  if (!best) {
    return null;
  }
  const [first, second] = best;
  const amountMinor = Math.abs(first.amountMinor);
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
  const list = [...expenses(input)].sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor) || left.id.localeCompare(right.id));
  if (list.length < 6) {
    return null;
  }
  const totalMinor = sum(list.map((entry) => Math.abs(entry.amountMinor)));
  const top = list.slice(0, 5);
  const topMinor = sum(top.map((entry) => Math.abs(entry.amountMinor)));
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

// Just for fun: the month's smallest purchase.
export function smallestEntryTrivia(input: EntriesSignalInput): MoneySignal | null {
  const smallest = expenses(input)
    .filter((entry) => !NOT_A_PURCHASE.test(`${entry.categoryName ?? ""} ${entry.description ?? ""}`) && tidyName(entry.description))
    .sort((left, right) => Math.abs(left.amountMinor) - Math.abs(right.amountMinor) || left.id.localeCompare(right.id))[0];
  if (!smallest || expenses(input).length < 3) {
    return null;
  }
  return triviaSignal(`smallest:${smallest.id}`, ENTRIES_COPY.smallestEntry, {
    amount: input.formatMoney(Math.abs(smallest.amountMinor)),
    name: tidyName(smallest.description),
    ...when(input)
  });
}

export function buildEntriesSignals(input: EntriesSignalInput): MoneySignal[] {
  return [
    uncategorizedSignal(input),
    possibleDuplicateSignal(input),
    topFiveSignal(input),
    smallestEntryTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
