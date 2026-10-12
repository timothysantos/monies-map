// A trip still filed as Other: a run of purchases abroad on nearby days that
// nobody has given a category yet. Month and Entries show it, so moving them
// to Travel makes the trip's cost easy to find next time.
import { phrase, shortDay, sortedLine, type CopyCatalogue, type FormatMoney } from "./format";
import type { MoneySignal } from "./types";

export interface TripSignalEntry {
  id: string;
  date: string;
  description?: string;
  categoryName?: string;
  entryType: string;
  amountMinor: number;
}

export const TRIP_COPY = {
  tripInOther: {
    phrasings: [
      "{count} overseas purchases from {range} ({total}{place}) are in Other. Moving them to Travel shows what the trip cost.",
      "{total} spent abroad from {range}{placeIn} is still in Other, across {count} purchases.",
      "The trip from {range}{placeIn} left {count} purchases ({total}) in Other.",
      "{count} purchases abroad from {range} ({total}) haven't got a category yet."
    ],
    think: [
      "Trips are easier to plan when last time's total is easy to find.",
      "Food or shopping bought abroad can stay where it is; it's the rest that's easiest to file as Travel.",
      "Once they're in Travel, the trip shows as one number beside the rest of the month."
    ],
    sorted: {
      fact: "Sorted: the trip from {range} is filed.",
      think: "Its cost now shows in one place."
    },
    action: "Show these entries"
  }
} satisfies CopyCatalogue;

// A purchase abroad: a foreign currency amount, a foreign city, or a
// country code the card network prints at the end ("... Seoul KR").
const CURRENCY_AMOUNT = /\b(KRW|JPY|IDR|PHP|THB|MYR|TWD|HKD|CNY|VND|USD|EUR|GBP|AUD)\s?\d[\d,]*(?:\.\d+)?\b/i;
const COUNTRY_SUFFIX = /\s(KR|JP|ID|PH|TH|TW|HK|CN|VN)$/;
const CITIES: Array<[RegExp, string]> = [
  [/SEOUL/i, "Seoul"], [/BUSAN/i, "Busan"], [/JEJU|SEOGWIPO/i, "Jeju"], [/TOKYO|SHINJUKU|SHIBUYA|GINZA/i, "Tokyo"],
  [/OSAKA/i, "Osaka"], [/KYOTO/i, "Kyoto"], [/NAGOYA/i, "Nagoya"], [/SAPPORO/i, "Sapporo"], [/FUKUOKA/i, "Fukuoka"],
  [/BALI|DENPASAR|SANUR|UBUD|KUTA/i, "Bali"], [/JAKARTA/i, "Jakarta"], [/MANILA|MAKATI|TAGUIG/i, "Manila"], [/CEBU/i, "Cebu"],
  [/BANGKOK/i, "Bangkok"], [/TAIPEI/i, "Taipei"], [/HONG ?KONG/i, "Hong Kong"]
];
const COUNTRY_BY_CODE: Record<string, string> = {
  KRW: "Korea", KR: "Korea", JPY: "Japan", JP: "Japan", IDR: "Indonesia", ID: "Indonesia", PHP: "the Philippines", PH: "the Philippines",
  THB: "Thailand", TH: "Thailand", TWD: "Taiwan", TW: "Taiwan", HKD: "Hong Kong", HK: "Hong Kong", CNY: "China", CN: "China", VND: "Vietnam", VN: "Vietnam"
};
const UNCATEGORIZED = /^(other|uncategori[sz]ed)?$/i;
const MIN_PURCHASES = 5;
const MIN_DAYS = 2;
// Purchases this many days apart still belong to one trip.
const TRIP_GAP_DAYS = 2;

function placeOf(description: string) {
  const city = CITIES.find(([pattern]) => pattern.test(description));
  if (city) {
    return city[1];
  }
  const code = description.match(CURRENCY_AMOUNT)?.[1]?.toUpperCase() ?? description.match(COUNTRY_SUFFIX)?.[1];
  return code ? COUNTRY_BY_CODE[code] ?? "" : "";
}

export function isOverseasPurchase(description: string | undefined) {
  const text = String(description ?? "").trim();
  return CURRENCY_AMOUNT.test(text) || COUNTRY_SUFFIX.test(text) || CITIES.some(([pattern]) => pattern.test(text));
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

// The biggest run of purchases abroad filed as Other in the entries given.
export function findTripInOther(entries: TripSignalEntry[]) {
  const abroad = entries
    .filter((entry) => entry.entryType === "expense" && UNCATEGORIZED.test(String(entry.categoryName ?? "").trim()) && isOverseasPurchase(entry.description))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  const trips: TripSignalEntry[][] = [];
  for (const entry of abroad) {
    const current = trips.at(-1);
    if (current && dayNumber(entry.date) - dayNumber(current.at(-1)!.date) <= TRIP_GAP_DAYS) {
      current.push(entry);
    } else {
      trips.push([entry]);
    }
  }
  return trips
    .filter((trip) => trip.length >= MIN_PURCHASES && new Set(trip.map((entry) => entry.date)).size >= MIN_DAYS)
    .map((trip) => ({ entries: trip, totalMinor: trip.reduce((total, entry) => total + Math.abs(entry.amountMinor), 0) }))
    .sort((left, right) => right.totalMinor - left.totalMinor)[0] ?? null;
}

// "1–6 Jan", or "30 Aug – 11 Sep" across months.
function dayRange(first: string, last: string) {
  // shortDay reads "Thu 1 Jan"; the weekday is dropped here.
  const [leftDay, leftMonth] = shortDay(first).split(" ").slice(1);
  const [rightDay, rightMonth] = shortDay(last).split(" ").slice(1);
  if (first === last) {
    return `${rightDay} ${rightMonth}`;
  }
  return leftMonth === rightMonth ? `${leftDay}–${rightDay} ${rightMonth}` : `${leftDay} ${leftMonth} – ${rightDay} ${rightMonth}`;
}

// To do: a trip's purchases are still in Other.
export function tripInOtherSignal(input: { entries: TripSignalEntry[]; formatMoney: FormatMoney }): MoneySignal | null {
  const trip = findTripInOther(input.entries);
  if (!trip) {
    return null;
  }
  const places = trip.entries.map((entry) => placeOf(String(entry.description ?? ""))).filter(Boolean);
  const counts = new Map<string, number>();
  for (const place of places) {
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  const place = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
  const first = trip.entries[0].date;
  const last = trip.entries.at(-1)!.date;
  const values = {
    count: trip.entries.length,
    total: input.formatMoney(trip.totalMinor),
    range: dayRange(first, last),
    place: place ? `, ${place}` : "",
    placeIn: place ? ` in ${place}` : ""
  };
  return {
    key: `trip-in-other:${first}:${last}`,
    kind: "quick_fix",
    weight: trip.totalMinor,
    numbers: { primaryMinor: trip.totalMinor, count: trip.entries.length },
    primaryText: values.total,
    phrasings: phrase(TRIP_COPY.tripInOther, values),
    sorted: sortedLine(TRIP_COPY.tripInOther.sorted, values),
    action: { id: "show-entries", label: TRIP_COPY.tripInOther.action, entryIds: trip.entries.map((entry) => entry.id) },
    topic: "plan"
  };
}
