// The whole-group facts behind Splits' Just for fun lines ("settled or not,
// since 2 Apr"), as a small set of numbers instead of every record.
//
// The Splits page sends only the records outside settled sections (a
// settlement can cover hundreds), so the lines that describe the whole
// group cannot be counted on the page any more. The Worker counts them in
// SQL (split-group-facts-query.ts) into `SplitGroupFacets`, the same
// facets `buildGroupFacetsFromActivity` counts from activity rows, and
// `reduceGroupFacts` turns either into the facts the lines read. The rules
// are the ones the lines always used (money-signals/splits-signals.ts):
//   - an expense counts when its amount is above zero ("groupExpenses");
//   - money is added up only in the group's own currency ("in currency");
//   - a tie between two candidates goes to the earlier one in the activity
//     list (newest first by date, then id), as the old stable sorts did.
import { tidyName, weekdayIndex } from "./money-signals/format";

export interface SplitFactsActivity {
  kind: string;
  settlementStatus?: string;
  date: string;
  description?: string;
  totalAmountMinor: number;
  paidByPersonName?: string;
  categoryName?: string;
  currency?: string;
  paymentMethod?: string;
  // A settled-period correction is not a payment: the settle-up facts skip it.
  correction?: unknown;
}

// One candidate record for a "pick" (the priciest, the smallest named, the
// first, the latest). `order` is its place in the activity list.
export interface SplitFactsPick {
  description: string;
  amountMinor: number;
  date: string;
  currency: string;
  order: number;
}

export interface SplitGroupFacets {
  // Records (expenses and settle-ups, any amount) a settle-up covered.
  coveredCount: number;
  // The earliest expense of any amount.
  firstExpenseDate?: string;
  // The rest count expenses above zero, per currency where money is added.
  dates: Array<{ date: string; currency: string; count: number; sumMinor: number }>;
  descriptions: Array<{ description: string; currency: string; count: number; smallest: SplitFactsPick }>;
  categories: Array<{ name: string; currency: string; sumMinor: number }>;
  methods: Array<{ method: string; count: number }>;
  payers: Array<{ name: string; currency: string; count: number; sumMinor: number }>;
  // Per currency: the priciest, and the two latest (newest first).
  priciest: SplitFactsPick[];
  latest: SplitFactsPick[];
  // The first expense of any currency (earliest date).
  first?: SplitFactsPick;
  // Settle-ups above zero.
  settlements: Array<{ date: string; currency: string; count: number; maxMinor: number }>;
}

export interface SplitGroupFacts {
  hasCovered: boolean;
  firstExpenseDate?: string;
  expenseCount: number;
  inCurrencyCount: number;
  inCurrencyTotalMinor: number;
  priciest: { description: string; amountMinor: number } | null;
  payers: Array<{ name: string; count: number; amountMinor: number }>;
  busiestDay: { date: string; count: number } | null;
  weekdayTop: { index: number; count: number } | null;
  busiestMonth: { month: string; count: number } | null;
  monthCount: number;
  namedInCurrencyCount: number;
  smallestNamed: { description: string; amountMinor: number; date: string } | null;
  firstDay: { date: string; count: number; description: string } | null;
  priciestDay: { date: string; amountMinor: number } | null;
  inCurrencyDayCount: number;
  // The newest expense in the group's currency when it is alone on its date
  // and there is an earlier one; otherwise null.
  latest: { description: string; amountMinor: number; date: string } | null;
  repeated: { name: string; count: number } | null;
  span: { first: string; last: string } | null;
  currencies: string[];
  topCategory: { name: string; amountMinor: number } | null;
  categoryCount: number;
  paymentMix: Array<[string, number]>;
  settlementCount: number;
  largestSettlement: { amountMinor: number; date: string } | null;
}

const PAYMENT_METHODS = new Set(["card", "cash", "bank", "other"]);

// "the {name}": a description that already starts with "The" drops it.
export function factsCostName(description: string | undefined) {
  return tidyName(description).replace(/^the\s+/i, "");
}

function addTo<K>(map: Map<K, number>, key: K, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

// The top key when no other key has the same count (the lines' rule).
function uniqueTop<K>(counts: Map<K, number>): [K, number] | null {
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return sorted[0] && (!sorted[1] || sorted[1][1] !== sorted[0][1]) ? sorted[0] : null;
}

const byPricier = (left: SplitFactsPick, right: SplitFactsPick) => right.amountMinor - left.amountMinor || left.date.localeCompare(right.date) || left.order - right.order;
const bySmaller = (left: SplitFactsPick, right: SplitFactsPick) => left.amountMinor - right.amountMinor || left.date.localeCompare(right.date) || left.order - right.order;
const byEarlier = (left: SplitFactsPick, right: SplitFactsPick) => left.date.localeCompare(right.date) || left.order - right.order;
// The order a stable date sort, reversed, leaves them in: newest date first,
// and on one date the one later in the activity list first.
const byNewerLast = (left: SplitFactsPick, right: SplitFactsPick) => right.date.localeCompare(left.date) || right.order - left.order;

function better(current: SplitFactsPick | undefined, candidate: SplitFactsPick, compare: (left: SplitFactsPick, right: SplitFactsPick) => number) {
  return !current || compare(candidate, current) < 0 ? candidate : current;
}

/** The facets of one group's activity (all of it, settled or not). */
export function buildGroupFacetsFromActivity(activity: SplitFactsActivity[]): SplitGroupFacets {
  const dates = new Map<string, { date: string; currency: string; count: number; sumMinor: number }>();
  const descriptions = new Map<string, { description: string; currency: string; count: number; smallest: SplitFactsPick }>();
  const categories = new Map<string, { name: string; currency: string; sumMinor: number }>();
  const methods = new Map<string, number>();
  const payers = new Map<string, { name: string; currency: string; count: number; sumMinor: number }>();
  const priciest = new Map<string, SplitFactsPick>();
  const latest = new Map<string, SplitFactsPick[]>();
  const settlements = new Map<string, { date: string; currency: string; count: number; maxMinor: number }>();
  let coveredCount = 0;
  let firstExpenseDate: string | undefined;
  let first: SplitFactsPick | undefined;

  activity.forEach((item, order) => {
    if (item.settlementStatus === "settled") {
      coveredCount += 1;
    }
    const currency = String(item.currency ?? "");
    if (item.kind === "settlement" && item.totalAmountMinor > 0 && !item.correction) {
      const key = `${item.date}|${currency}`;
      const current = settlements.get(key) ?? { date: item.date, currency, count: 0, maxMinor: 0 };
      current.count += 1;
      current.maxMinor = Math.max(current.maxMinor, item.totalAmountMinor);
      settlements.set(key, current);
    }
    if (item.kind !== "expense") {
      return;
    }
    if (!firstExpenseDate || item.date < firstExpenseDate) {
      firstExpenseDate = item.date;
    }
    if (item.totalAmountMinor <= 0) {
      return;
    }
    const description = String(item.description ?? "");
    const pick: SplitFactsPick = { description, amountMinor: item.totalAmountMinor, date: item.date, currency, order };
    const dateKey = `${item.date}|${currency}`;
    const day = dates.get(dateKey) ?? { date: item.date, currency, count: 0, sumMinor: 0 };
    day.count += 1;
    day.sumMinor += item.totalAmountMinor;
    dates.set(dateKey, day);
    const descriptionKey = `${description}|${currency}`;
    const named = descriptions.get(descriptionKey);
    descriptions.set(descriptionKey, named
      ? { ...named, count: named.count + 1, smallest: better(named.smallest, pick, bySmaller) }
      : { description, currency, count: 1, smallest: pick });
    const categoryName = String(item.categoryName ?? "");
    const categoryKey = `${categoryName}|${currency}`;
    const category = categories.get(categoryKey) ?? { name: categoryName, currency, sumMinor: 0 };
    category.sumMinor += item.totalAmountMinor;
    categories.set(categoryKey, category);
    addTo(methods, String(item.paymentMethod ?? ""), 1);
    const payerName = String(item.paidByPersonName ?? "");
    const payerKey = `${payerName}|${currency}`;
    const payer = payers.get(payerKey) ?? { name: payerName, currency, count: 0, sumMinor: 0 };
    payer.count += 1;
    payer.sumMinor += item.totalAmountMinor;
    payers.set(payerKey, payer);
    priciest.set(currency, better(priciest.get(currency), pick, byPricier));
    latest.set(currency, [...(latest.get(currency) ?? []), pick].sort(byNewerLast).slice(0, 2));
    first = better(first, pick, byEarlier);
  });

  return {
    coveredCount,
    firstExpenseDate,
    dates: [...dates.values()],
    descriptions: [...descriptions.values()],
    categories: [...categories.values()],
    methods: [...methods.entries()].map(([method, count]) => ({ method, count })),
    payers: [...payers.values()],
    priciest: [...priciest.values()],
    latest: [...latest.values()].flat(),
    first,
    settlements: [...settlements.values()]
  };
}

/**
 * The facts the Just for fun lines read, from a group's facets and the
 * group's currency (the only currency money is added up in; none counts
 * every record, as the lines did for a group without one).
 */
export function reduceGroupFacts(facets: SplitGroupFacets, groupCurrency?: string): SplitGroupFacts {
  const target = groupCurrency ?? "";
  const inCurrency = (currency: string) => !target || !currency || currency === target;

  const dayCounts = new Map<string, number>();
  const dayTotals = new Map<string, number>();
  const weekdayCounts = new Map<number, number>();
  const monthCounts = new Map<string, number>();
  const currencies = new Set<string>();
  let expenseCount = 0;
  let inCurrencyCount = 0;
  let inCurrencyTotalMinor = 0;
  for (const day of facets.dates) {
    expenseCount += day.count;
    addTo(dayCounts, day.date, day.count);
    addTo(weekdayCounts, weekdayIndex(day.date), day.count);
    addTo(monthCounts, day.date.slice(0, 7), day.count);
    if (day.currency) {
      currencies.add(day.currency);
    }
    if (inCurrency(day.currency)) {
      inCurrencyCount += day.count;
      inCurrencyTotalMinor += day.sumMinor;
      addTo(dayTotals, day.date, day.sumMinor);
    }
  }

  const repeatedCounts = new Map<string, number>();
  let namedInCurrencyCount = 0;
  let smallest: SplitFactsPick | undefined;
  for (const entry of facets.descriptions) {
    const name = factsCostName(entry.description);
    if (!name) {
      continue;
    }
    addTo(repeatedCounts, name, entry.count);
    if (inCurrency(entry.currency)) {
      namedInCurrencyCount += entry.count;
      smallest = better(smallest, entry.smallest, bySmaller);
    }
  }

  const categoryTotals = new Map<string, number>();
  for (const category of facets.categories) {
    const name = category.name.trim();
    if (inCurrency(category.currency) && name && !/^(other|uncategori[sz]ed)$/i.test(name)) {
      addTo(categoryTotals, name, category.sumMinor);
    }
  }

  const methodCounts = new Map<string, number>();
  for (const method of facets.methods) {
    if (PAYMENT_METHODS.has(method.method)) {
      addTo(methodCounts, method.method, method.count);
    }
  }

  const payerTotals = new Map<string, { name: string; count: number; amountMinor: number }>();
  for (const payer of facets.payers) {
    if (!inCurrency(payer.currency)) {
      continue;
    }
    const current = payerTotals.get(payer.name) ?? { name: payer.name, count: 0, amountMinor: 0 };
    current.count += payer.count;
    current.amountMinor += payer.sumMinor;
    payerTotals.set(payer.name, current);
  }

  const priciest = facets.priciest.filter((pick) => inCurrency(pick.currency)).sort(byPricier)[0];
  const latestTwo = facets.latest.filter((pick) => inCurrency(pick.currency)).sort(byNewerLast).slice(0, 2);
  const latest = latestTwo.length === 2 && latestTwo[0].date !== latestTwo[1].date ? latestTwo[0] : null;

  let settlementCount = 0;
  let largestSettlement: { amountMinor: number; date: string } | null = null;
  for (const settlement of facets.settlements) {
    settlementCount += settlement.count;
    if (inCurrency(settlement.currency)
      && (!largestSettlement || settlement.maxMinor > largestSettlement.amountMinor
        || (settlement.maxMinor === largestSettlement.amountMinor && settlement.date < largestSettlement.date))) {
      largestSettlement = { amountMinor: settlement.maxMinor, date: settlement.date };
    }
  }

  const busiestDay = uniqueTop(dayCounts);
  const weekdayTop = uniqueTop(weekdayCounts);
  const busiestMonth = uniqueTop(monthCounts);
  const priciestDay = uniqueTop(dayTotals);
  const repeated = uniqueTop(repeatedCounts);
  const topCategory = uniqueTop(categoryTotals);
  const sortedDates = [...dayCounts.keys()].sort();
  const first = facets.first;

  return {
    hasCovered: facets.coveredCount > 0,
    firstExpenseDate: facets.firstExpenseDate,
    expenseCount,
    inCurrencyCount,
    inCurrencyTotalMinor,
    priciest: priciest ? { description: priciest.description, amountMinor: priciest.amountMinor } : null,
    payers: [...payerTotals.values()].sort((left, right) => left.name.localeCompare(right.name)),
    busiestDay: busiestDay ? { date: busiestDay[0], count: busiestDay[1] } : null,
    weekdayTop: weekdayTop ? { index: weekdayTop[0], count: weekdayTop[1] } : null,
    busiestMonth: busiestMonth ? { month: busiestMonth[0], count: busiestMonth[1] } : null,
    monthCount: monthCounts.size,
    namedInCurrencyCount,
    smallestNamed: smallest ? { description: smallest.description, amountMinor: smallest.amountMinor, date: smallest.date } : null,
    firstDay: first ? { date: first.date, count: dayCounts.get(first.date) ?? 0, description: first.description } : null,
    priciestDay: priciestDay ? { date: priciestDay[0], amountMinor: priciestDay[1] } : null,
    inCurrencyDayCount: dayTotals.size,
    latest: latest ? { description: latest.description, amountMinor: latest.amountMinor, date: latest.date } : null,
    repeated: repeated ? { name: repeated[0], count: repeated[1] } : null,
    span: sortedDates.length >= 2 ? { first: sortedDates[0], last: sortedDates.at(-1)! } : null,
    currencies: [...currencies].sort(),
    topCategory: topCategory ? { name: topCategory[0], amountMinor: topCategory[1] } : null,
    categoryCount: categoryTotals.size,
    paymentMix: [...methodCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
    settlementCount,
    largestSettlement
  };
}

/** The facts of one group's activity, counted on the page. */
export function buildGroupFactsFromActivity(activity: SplitFactsActivity[], groupCurrency?: string) {
  return reduceGroupFacts(buildGroupFacetsFromActivity(activity), groupCurrency);
}
