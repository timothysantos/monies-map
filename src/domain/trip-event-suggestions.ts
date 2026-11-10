// Suggestions for trips and events (DOMAIN.md "Trip or Event",
// "Suggestions"): which entries look like part of a trip, from its dates,
// its currency and its linked split group. Pure rules here; the reads are in
// app-repository-trip-events.ts. A suggestion never puts anything on a trip:
// the person ticks and taps, and the one command (setTripEventEntries) saves.
//
// - The review list (design 2d) groups a trip's likely entries:
//   "currency"  paid in the trip's currency (the Wallet amount the Apple Pay
//               Shortcut kept, or the amount the card printed on the bank
//               line, "KRW 142,000"), in the trip's dates: ticked;
//   "splits"    on the trip's linked split group, whatever the date (a hotel
//               deposit paid before): ticked;
//   "dollars"   everything else in the dates: not ticked;
//   "search"    "Booked before you went?": words, before the first day.
//   Home bills (rent, standing orders: an entry in a home-bill category) are
//   never ticked. Entries already on this trip, or on another one, are left
//   out: a suggestion never moves an entry from another trip.
// - The dashed chip (design 2f, owner decision 4 = A): an Apple Pay or
//   Shortcut entry, in an active trip's dates (today in them too), the trip
//   has a currency, and the entry was paid in it, or its wallet's last 3
//   other entries are already on the trip.
import { readCardForeignAmountMinor } from "./statement-row-matching";
import { isWithinTripEventDates } from "./trip-events";

// The household's own currency: an entry in it was not paid abroad.
export const HOME_CURRENCY = "SGD";
// The most rows one suggestions read lists (a bound on the read, far more
// than a week away makes), and the most a search lists.
export const MAX_SUGGESTION_ROWS = 400;
export const MAX_SPLIT_SUGGESTION_ROWS = 200;
export const MAX_SEARCH_ROWS = 30;
// "Booked before you went?" looks this far back from the first day.
export const SEARCH_MONTHS_BEFORE = 12;

// The currencies the New sheet offers, with the plain word used in "Paid in
// won". A trip's currency can be any three letters; an unknown one is named
// by its code.
export const TRIP_CURRENCIES = Object.freeze([
  { code: "KRW", word: "won", label: "Korean won ₩" },
  { code: "JPY", word: "yen", label: "Japanese yen ¥" },
  { code: "IDR", word: "rupiah", label: "Indonesian rupiah Rp" },
  { code: "THB", word: "baht", label: "Thai baht ฿" },
  { code: "MYR", word: "ringgit", label: "Malaysian ringgit RM" },
  { code: "VND", word: "dong", label: "Vietnamese dong ₫" },
  { code: "TWD", word: "Taiwan dollars", label: "Taiwan dollars NT$" },
  { code: "HKD", word: "Hong Kong dollars", label: "Hong Kong dollars HK$" },
  { code: "CNY", word: "yuan", label: "Chinese yuan ¥" },
  { code: "PHP", word: "pesos", label: "Philippine pesos ₱" },
  { code: "INR", word: "rupees", label: "Indian rupees ₹" },
  { code: "AUD", word: "Australian dollars", label: "Australian dollars A$" },
  { code: "NZD", word: "NZ dollars", label: "New Zealand dollars NZ$" },
  { code: "USD", word: "US dollars", label: "US dollars US$" },
  { code: "CAD", word: "Canadian dollars", label: "Canadian dollars C$" },
  { code: "EUR", word: "euros", label: "Euros €" },
  { code: "GBP", word: "pounds", label: "British pounds £" },
  { code: "CHF", word: "Swiss francs", label: "Swiss francs" }
]);
const CURRENCY_WORDS = new Map(TRIP_CURRENCIES.map((currency) => [currency.code, currency.word]));

export function tripCurrencyWord(code: string | null | undefined): string {
  return code ? CURRENCY_WORDS.get(code) ?? code : "";
}

// Home bills: the categories rent, standing orders and the household's
// running costs are filed under. Matched by name (the household can rename
// a category; a renamed one is simply not a home bill). The Repeating Charge
// engine is not on this branch, so the rule is the category alone. Tax is
// left out: an imported "KAKAO T TAXI" row can land in Tax, and a taxi
// abroad must stay ticked.
export const HOME_BILL_CATEGORY_NAMES = Object.freeze([
  "home", "rent", "bills", "utilities", "loans", "insurance", "subscriptions mo", "subscriptions yr"
]);
const HOME_BILL_KEYS = new Set(HOME_BILL_CATEGORY_NAMES);

export function isHomeBill(categoryName: string | null | undefined): boolean {
  return HOME_BILL_KEYS.has(String(categoryName ?? "").trim().toLowerCase());
}

// One entry as the suggestion reads see it.
export interface TripSuggestionSourceRow {
  id: string;
  date: string;
  description: string;
  originalDescription?: string | null;
  amountMinor: number;
  originalAmountMinor?: number | null;
  originalCurrency?: string | null;
  categoryName: string | null;
  who: string | null;
  accountName: string | null;
  tripEventId: string | null;
  splitGroupId: string | null;
}

export interface TripSuggestionEntryDto {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  categoryName: string;
  who?: string;
  accountName?: string;
  // The amount in the trip's currency, when the entry shows one.
  foreignAmountMinor?: number;
  foreignCurrency?: string;
  ticked: boolean;
  homeBill?: true;
}

export type TripSuggestionGroupKey = "currency" | "splits" | "dollars" | "search";

export interface TripSuggestionGroupDto {
  key: TripSuggestionGroupKey;
  entries: TripSuggestionEntryDto[];
}

export interface TripSuggestionsDto {
  available: boolean;
  tripEventId: string | null;
  startDate?: string;
  endDate?: string;
  currency?: string;
  splitGroupName?: string;
  groups: TripSuggestionGroupDto[];
  // How many listed entries are home bills (left unticked).
  homeBillCount: number;
  // The dates hold more entries than one read lists.
  truncated: boolean;
}

// The amount in `currency` an entry shows: the Wallet amount the Shortcut
// kept, or the one the card printed on its bank line. undefined when none.
export function foreignAmountIn(row: Pick<TripSuggestionSourceRow, "description" | "originalDescription" | "originalAmountMinor" | "originalCurrency">, currency: string | null | undefined): number | undefined {
  if (!currency || currency === HOME_CURRENCY) return undefined;
  if (row.originalCurrency === currency && Number.isFinite(Number(row.originalAmountMinor))) {
    return Number(row.originalAmountMinor);
  }
  return readCardForeignAmountMinor(row.description ?? "", currency)
    ?? (row.originalDescription ? readCardForeignAmountMinor(row.originalDescription, currency) : undefined);
}

// The foreign currency an entry was paid in, if it shows one: the kept
// Wallet currency, or a known code followed by an amount on the bank line.
export function foreignCurrencyOf(row: Pick<TripSuggestionSourceRow, "description" | "originalDescription" | "originalCurrency">): string | null {
  if (row.originalCurrency && row.originalCurrency !== HOME_CURRENCY) return row.originalCurrency;
  const text = `${row.description ?? ""} ${row.originalDescription ?? ""}`.replace(/\s+/g, " ");
  for (const match of text.matchAll(/\b([A-Z]{3}) \d/g)) {
    if (match[1] !== HOME_CURRENCY && CURRENCY_WORDS.has(match[1])) return match[1];
  }
  return null;
}

function toEntryDto(row: TripSuggestionSourceRow, currency: string | null, ticked: boolean): TripSuggestionEntryDto {
  const homeBill = isHomeBill(row.categoryName);
  const foreign = foreignAmountIn(row, currency);
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amountMinor: row.amountMinor,
    categoryName: row.categoryName ?? "Other",
    ...(row.who ? { who: row.who } : {}),
    ...(row.accountName ? { accountName: row.accountName } : {}),
    ...(foreign !== undefined && currency ? { foreignAmountMinor: foreign, foreignCurrency: currency } : {}),
    ticked: ticked && !homeBill,
    ...(homeBill ? { homeBill: true as const } : {})
  };
}

const byDate = (left: TripSuggestionSourceRow, right: TripSuggestionSourceRow) =>
  left.date.localeCompare(right.date) || left.description.localeCompare(right.description) || left.id.localeCompare(right.id);

// The review list for one trip (or a draft one): rows in its dates and rows
// on its linked split group, grouped and ticked. Each entry is listed once:
// paid in the currency first, then the splits, then the rest.
export function buildTripEventSuggestions(input: {
  tripEventId: string | null;
  startDate: string | null;
  endDate: string | null;
  currency: string | null;
  splitGroupId: string | null;
  splitGroupName?: string | null;
  inDates: TripSuggestionSourceRow[];
  onSplits: TripSuggestionSourceRow[];
  truncated?: boolean;
}): TripSuggestionsDto {
  const currency = input.currency && input.currency !== HOME_CURRENCY ? input.currency : null;
  const seen = new Set<string>();
  const free = (row: TripSuggestionSourceRow) => !row.tripEventId && !seen.has(row.id);
  const take = (rows: TripSuggestionSourceRow[], ticked: boolean) => {
    const picked = rows.filter(free).sort(byDate);
    picked.forEach((row) => seen.add(row.id));
    return picked.map((row) => toEntryDto(row, currency, ticked));
  };
  const dated = input.startDate && input.endDate
    ? input.inDates.filter((row) => row.date >= input.startDate! && row.date <= input.endDate!)
    : [];
  const currencyRows = currency ? take(dated.filter((row) => foreignAmountIn(row, currency) !== undefined), true) : [];
  const splitRows = input.splitGroupId ? take(input.onSplits.filter((row) => row.splitGroupId === input.splitGroupId), true) : [];
  const otherRows = take(dated, false);
  const groups: TripSuggestionGroupDto[] = [
    { key: "currency" as const, entries: currencyRows },
    { key: "splits" as const, entries: splitRows },
    { key: "dollars" as const, entries: otherRows }
  ].filter((group) => group.entries.length);
  return {
    available: true,
    tripEventId: input.tripEventId,
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
    ...(currency ? { currency } : {}),
    ...(input.splitGroupId && input.splitGroupName ? { splitGroupName: input.splitGroupName } : {}),
    groups,
    homeBillCount: groups.reduce((count, group) => count + group.entries.filter((entry) => entry.homeBill).length, 0),
    truncated: Boolean(input.truncated)
  };
}

// "Booked before you went?": the search's rows, none ticked, none on a trip.
export function buildTripEventSearchResults(rows: TripSuggestionSourceRow[], currency: string | null): TripSuggestionGroupDto {
  return {
    key: "search",
    entries: rows.filter((row) => !row.tripEventId).sort(byDate).reverse().slice(0, MAX_SEARCH_ROWS).map((row) => toEntryDto(row, currency, false))
  };
}

// The words of a search: up to 5, each 2 or more letters, lower case.
export function readSearchWords(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.toLowerCase().split(/\s+/).map((word) => word.replace(/[%_\\]/g, "")).filter((word) => word.length >= 2).slice(0, 5);
}

// The day `months` months before `isoDate` (clamped to the month's end).
export function monthsBefore(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

// A New sheet started from picked rows: their first and last day, and the
// foreign currency most of them were paid in (none when no row shows one).
export function tripEventDefaultsFromEntries(rows: Array<Pick<TripSuggestionSourceRow, "date" | "description" | "originalDescription" | "originalCurrency">>): {
  startDate: string | null;
  endDate: string | null;
  currency: string | null;
} {
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = foreignCurrencyOf(row);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const [currency] = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? [null];
  return { startDate: dates[0] ?? null, endDate: dates.at(-1) ?? null, currency };
}

// ---- The dashed chip (design 2f) -------------------------------------------

export interface ActiveTripEvent {
  id: string;
  name: string;
  iconKey: string;
  startDate: string;
  endDate: string;
  currency: string;
}

export interface ChipCandidate {
  id: string;
  date: string;
  accountId: string;
  originalCurrency: string | null;
}

// A wallet's most recent entries in the active trips' dates, newest first,
// with the trip each is on (null when none).
export type WalletHistory = Map<string, Array<{ id: string; tripEventId: string | null }>>;

// Which Apple Pay or Shortcut entries get the dashed "Seoul trip?" chip, and
// for which trip: entry id → trip id. `candidates` are already only the
// Shortcut's entries on no trip; `trips` only those on today (with dates and
// a currency, not put away).
export function suggestTripEventsForNewEntries(input: {
  today: string;
  trips: ActiveTripEvent[];
  candidates: ChipCandidate[];
  walletHistory: WalletHistory;
}): Map<string, string> {
  const suggestions = new Map<string, string>();
  const trips = input.trips
    .filter((trip) => trip.currency && trip.currency !== HOME_CURRENCY && isWithinTripEventDates(trip, input.today))
    .sort((left, right) => right.startDate.localeCompare(left.startDate) || left.id.localeCompare(right.id));
  if (!trips.length) return suggestions;
  for (const entry of input.candidates) {
    if (entry.date > input.today) continue;
    for (const trip of trips) {
      if (!isWithinTripEventDates(trip, entry.date)) continue;
      const paidInIt = entry.originalCurrency === trip.currency;
      const lastThree = (input.walletHistory.get(entry.accountId) ?? []).filter((row) => row.id !== entry.id).slice(0, 3);
      const walletOnIt = lastThree.length === 3 && lastThree.every((row) => row.tripEventId === trip.id);
      if (paidInIt || walletOnIt) {
        suggestions.set(entry.id, trip.id);
        break;
      }
    }
  }
  return suggestions;
}
