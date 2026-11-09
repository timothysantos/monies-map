// Trips and events (DOMAIN.md "Trip or Event", code `trip_event`): a named
// set of entries, such as "Seoul trip" or "Mum's 70th", across categories,
// people and months, so the household can see what it cost. Not the same as
// a Split Group, which is about who owes whom.
//
// Rules kept here, pure, so the commands, the Entries page and Ask share
// them:
// - an entry is on at most one trip or event;
// - a trip or event has a name, an icon and optional dates and currency;
//   dates and currency only help suggest entries and never decide what is
//   counted: only the entries put on it count;
// - one change puts at most MAX_TRIP_EVENT_CHANGE entries on (or off).

export const MAX_TRIP_EVENT_CHANGE = 200;
export const MAX_TRIP_EVENT_NAME_LENGTH = 60;

export const TRIP_EVENT_ICONS = ["plane", "cake", "house", "heart", "gift", "car", "star"] as const;
export type TripEventIcon = (typeof TRIP_EVENT_ICONS)[number];

export const TRIP_EVENT_ADDED_BY = ["person", "ask", "ask_auto", "suggestion"] as const;
export type TripEventAddedBy = (typeof TRIP_EVENT_ADDED_BY)[number];

export interface TripEventDto {
  id: string;
  name: string;
  iconKey: TripEventIcon;
  startDate?: string;
  endDate?: string;
  currency?: string;
  splitGroupId?: string;
  putAway?: true;
  entryCount: number;
  // When an entry was last put on it (or when it was made), for "Recent".
  lastUsedAt: string;
}

// What a page's rows need to show a chip: the trips those rows use.
export interface TripEventChipDto {
  name: string;
  iconKey: TripEventIcon;
}

export interface TripEventEntryChange {
  entryId: string;
  // null takes the entry off its trip or event.
  tripEventId: string | null;
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CURRENCY = /^[A-Z]{3}$/;

export function isTripEventIcon(value: unknown): value is TripEventIcon {
  return (TRIP_EVENT_ICONS as readonly string[]).includes(String(value));
}

export function isTripEventAddedBy(value: unknown): value is TripEventAddedBy {
  return (TRIP_EVENT_ADDED_BY as readonly string[]).includes(String(value));
}

// Spaces collapsed, trimmed; "" when nothing is left.
export function normalizeTripEventName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// The key two names are compared by: "Seoul Trip" and "seoul  trip" are the
// same trip or event.
export function tripEventNameKey(value: unknown): string {
  return normalizeTripEventName(value).toLowerCase();
}

// The icon a name suggests ("Seoul trip" → plane, "Mum's 70th" → cake,
// "New flat" → house), or star.
export function guessTripEventIcon(name: string): TripEventIcon {
  const text = name.toLowerCase();
  if (/\b(trip|flight|flights|holiday|holidays|travel|vacation|getaway|weekend away|abroad|tour)\b/.test(text)) return "plane";
  if (/\b(birthday|bday|\d+(st|nd|rd|th)|party|anniversary|celebration)\b/.test(text)) return "cake";
  if (/\b(flat|house|home|reno|renovation|move|moving|condo|hdb|apartment)\b/.test(text)) return "house";
  if (/\b(wedding|honeymoon|engagement)\b/.test(text)) return "heart";
  if (/\b(christmas|xmas|gift|gifts|hari raya|deepavali|chinese new year|cny)\b/.test(text)) return "gift";
  if (/\b(car|road trip|drive)\b/.test(text)) return "car";
  return "star";
}

export function readTripEventDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

export function readTripEventCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CURRENCY.test(code) ? code : null;
}

export interface TripEventInput {
  name: string;
  iconKey: TripEventIcon;
  startDate: string | null;
  endDate: string | null;
  currency: string | null;
  splitGroupId: string | null;
}

export class TripEventRefusedError extends Error {}

// A save's fields, checked: a name, an icon (guessed when left out), dates
// that are real days with the end not before the start (one date alone is a
// one-day event), a three-letter currency.
export function readTripEventInput(body: {
  name?: unknown;
  iconKey?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  currency?: unknown;
  splitGroupId?: unknown;
}): TripEventInput {
  const name = normalizeTripEventName(body.name);
  if (!name) throw new TripEventRefusedError("Give it a name.");
  if (name.length > MAX_TRIP_EVENT_NAME_LENGTH) throw new TripEventRefusedError(`Keep the name to ${MAX_TRIP_EVENT_NAME_LENGTH} letters or fewer.`);
  const iconKey = body.iconKey === undefined || body.iconKey === null || body.iconKey === ""
    ? guessTripEventIcon(name)
    : isTripEventIcon(body.iconKey) ? body.iconKey : null;
  if (!iconKey) throw new TripEventRefusedError("Choose one of the icons.");
  const hasStart = body.startDate !== undefined && body.startDate !== null && body.startDate !== "";
  const hasEnd = body.endDate !== undefined && body.endDate !== null && body.endDate !== "";
  const startDate = hasStart ? readTripEventDate(body.startDate) : null;
  const endDate = hasEnd ? readTripEventDate(body.endDate) : null;
  if ((hasStart && !startDate) || (hasEnd && !endDate)) throw new TripEventRefusedError("Choose real days for the dates.");
  const start = startDate ?? endDate;
  const end = endDate ?? startDate;
  if (start && end && end < start) throw new TripEventRefusedError("The last day can't be before the first.");
  const hasCurrency = body.currency !== undefined && body.currency !== null && body.currency !== "";
  const currency = hasCurrency ? readTripEventCurrency(body.currency) : null;
  if (hasCurrency && !currency) throw new TripEventRefusedError("Choose a currency such as KRW or JPY.");
  const splitGroupId = typeof body.splitGroupId === "string" && body.splitGroupId && body.splitGroupId !== "split-group-none"
    ? body.splitGroupId
    : null;
  return { name, iconKey, startDate: start, endDate: end, currency, splitGroupId };
}

// Whether `day` (YYYY-MM-DD) falls within the trip's dates.
export function isWithinTripEventDates(trip: Pick<TripEventDto, "startDate" | "endDate">, day: string): boolean {
  return Boolean(trip.startDate && trip.endDate && day >= trip.startDate && day <= trip.endDate);
}

// The picker's order (design: "Recents first"): the trip on now first, then
// the three used most recently, then the rest A to Z. Put-away ones are left
// out unless asked for.
export function orderTripEventsForPicker(
  trips: TripEventDto[],
  today: string,
  { includePutAway = false }: { includePutAway?: boolean } = {}
): { now: TripEventDto[]; recent: TripEventDto[]; rest: TripEventDto[] } {
  const shown = trips.filter((trip) => includePutAway || !trip.putAway);
  const now = shown.filter((trip) => isWithinTripEventDates(trip, today));
  const nowIds = new Set(now.map((trip) => trip.id));
  const others = shown.filter((trip) => !nowIds.has(trip.id));
  const recent = [...others].sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt) || left.name.localeCompare(right.name)).slice(0, 3);
  const recentIds = new Set(recent.map((trip) => trip.id));
  const rest = others.filter((trip) => !recentIds.has(trip.id)).sort((left, right) => left.name.localeCompare(right.name));
  return { now, recent, rest };
}
