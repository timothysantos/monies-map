// Trips and events in Ask (DOMAIN.md "Trip or Event"; docs/flows/ask-flow.md
// "Trips and events"). Two things a person can ask:
//
// - set_trip_event: put entries on a trip or event, move them from another,
//   or take them off ("put these on Seoul trip", "add the hotel to the
//   trip", "take these off the trip", "new trip Jeju weekend 3-5 May"). The
//   model reports only the trip's name as written and which entries as said
//   (words of the shop, a currency word, a day or month word); the app finds
//   the entries (the entry in focus, the list Ask showed last, or a search of
//   the household's own rows) and the trip (by its name, with typos), and
//   answers with a change card: every entry before and after ("No trip or
//   event → Seoul trip"), saved only through POST /api/trip-events/entries/set
//   with its Undo. Over ten entries the card needs "Yes, put all N"; over
//   MAX_TRIP_EVENT_CHANGE it is refused. Nothing joins a trip by itself.
// - a money question about one ("how much was the Seoul trip?"): the reply
//   names the trip, the view, scope and month, and the page answers it from
//   the Entries trip view's own figures (src/client/ask-trip-answer.js), so
//   the figure is that view's Spent to the cent. No figure comes from here.
//
// The rules reader (readTripEventRules) is the offline backup: with AI off
// it reads the same messages into the same action, checked the same way.
//
// Pure: no database, no clock (the turn's `today`), nothing written.

import { matchCategoryRule } from "./app-repository-category-match-rules";
import { assumption, decideReadings, type AskAssumption, type AskReading } from "./ask-ambiguity";
import { BULK_RECATEGORISE_CONFIRM_ABOVE } from "./entry-category-bulk";
import { closestNames, editDistance, matchName, readDayWord, readMonthWord } from "./ask-turn-names";
import {
  askBack,
  scrubName,
  wordsOf,
  type AskTurnAction,
  type AskTurnContext,
  type AskTurnReply,
  type Ground
} from "./ask-turn";
import type { AskChangeEntry, AskChangeRow, AskChangeStep } from "./ask-turn-actions";
import { MAX_TRIP_EVENT_CHANGE, MAX_TRIP_EVENT_NAME_LENGTH, tripEventNameKey } from "./trip-events";

// A trip or event as the turn's context carries it: names and dates only.
export interface AskTurnTrip {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  putAway?: boolean;
}

// Which entries the change is about, as the route reads them.
export type AskTripSource =
  | { kind: "entry"; entryId: string }
  | { kind: "list"; month: string; search: string; categories: string[] }
  | { kind: "search"; words: string; currency: string | null; from: string; to: string };

export interface AskTripEventRequest {
  type: "trip_event";
  // The trip the entries go on; null takes them off.
  to: { id: string; name: string } | null;
  // Taking off: only from this trip (when one was named).
  fromTripId: string | null;
  // Making a new one: its name and the days the person gave (else the
  // entries' first and last day).
  make: { name: string; startDate: string | null; endDate: string | null } | null;
  source: AskTripSource;
}

// An entry the route read, with the trip it is on now.
export interface AskTripCandidate {
  entryId: string;
  date: string;
  description: string;
  originalDescription: string | null;
  amountMinor: number;
  currency: string;
  originalCurrency: string | null;
  categoryName: string;
  entryType: "expense" | "income" | "transfer";
  accountName?: string;
  tripEventId: string | null;
}

const PREVIEW_ROWS = 8;
const NAME_CHIP_MAX = 40;
const WORDS_MAX = 40;
// How far around a trip's dates a shop word is looked for when no day is
// said: bookings come weeks before, refunds a little after.
const BEFORE_TRIP_DAYS = 90;
const AFTER_TRIP_DAYS = 30;
// Without a trip's dates or a day: the last three months.
const RECENT_DAYS = 92;

// Currency words a person says, and the three-letter code each means.
const CURRENCY_WORDS: Readonly<Record<string, string>> = Object.freeze({
  won: "KRW",
  yen: "JPY",
  baht: "THB",
  ringgit: "MYR",
  rm: "MYR",
  rupiah: "IDR",
  rupee: "INR",
  rupees: "INR",
  euro: "EUR",
  euros: "EUR",
  pound: "GBP",
  pounds: "GBP",
  dong: "VND",
  peso: "PHP",
  pesos: "PHP",
  yuan: "CNY",
  rmb: "CNY",
  usd: "USD",
  aud: "AUD",
  hkd: "HKD",
  twd: "TWD"
});

// The prompt's lines for this action and the trips the household has.
export function describeTripEventAction() {
  return "- set_trip_event: entries onto a trip or event (trip_event.name as written) or off it (off true). Which: the entry or list in focus (no words), else words (shop), currency (\"won\") or when (\"last week\"). make true only for a new one (from, to).";
}

export function describeTripEvents(trips: readonly AskTurnTrip[] | undefined) {
  const shown = (trips ?? []).filter((trip) => !trip.putAway).slice(0, 20).map((trip) => scrubName(trip.name)).filter(Boolean);
  return shown.length ? `Trips and events: ${shown.join(", ")}.` : "";
}

// ---------------------------------------------------------------------------
// Stage 1: the model's action against the context

export function validateSetTripEvent(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  const trips = context.tripEvents;
  if (!trips) return { kind: "note", text: TRIP_COPY.notReady };
  const raw = action.trip_event ?? {};
  const off = raw.off === true;
  const make = raw.make === true && !off;
  const said = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";

  // Which trip.
  let to: { id: string; name: string } | null = null;
  let fromTripId: string | null = null;
  let making: AskTripEventRequest["make"] = null;
  let assumed: AskAssumption | null = null;
  if (said) {
    const found = findTrip(said, trips);
    if (found.kind === "ambiguous") return whichTripQuestion(found.trips, off);
    if (found.kind === "match") {
      if (off) fromTripId = found.trip.id;
      else to = { id: found.trip.id, name: found.trip.name };
      // "the trip" names no trip of its own: said as an assumption.
      if (isGenericName(said) && tripEventNameKey(said) !== tripEventNameKey(found.trip.name)) {
        assumed = assumption(TRIP_COPY.assumedOnly(found.trip.name));
      }
    } else if (make) {
      const name = groundedName(said, ground);
      if (!name) return askBack({ code: "field_missing", field: "trip_event.name" }, TRIP_COPY.newName, []);
      const dates = readTripDays(raw.from, raw.to, context.today);
      if (!dates.ok) return askBack({ code: "date_invalid", field: "trip_event.from" }, TRIP_COPY.whichDays, []);
      making = { name, startDate: dates.startDate, endDate: dates.endDate };
    } else {
      return unknownTripQuestion(said, trips, ground, off);
    }
  } else if (!off) {
    return whichTripQuestion(pickerOrder(trips, context.today).slice(0, 3), false);
  }

  // Which entries.
  const words = groundedWords(raw.words, ground);
  if (words === null) return askBack({ code: "field_missing", field: "trip_event.words" }, TRIP_COPY.whichEntries, []);
  const currency = readCurrency(raw.currency, ground);
  const when = readWhen(raw.when, context);
  if (when === "invalid") return askBack({ code: "date_invalid", field: "trip_event.when" }, TRIP_COPY.whichDay, []);
  const focusEntry = context.focus?.kind === "saved_entry" ? context.focus.entry : null;
  const narrowed = Boolean(words || currency || when);
  let source: AskTripSource | null = null;
  if (focusEntry && (!narrowed || action.target_entry === focusEntry.entryId)) {
    source = { kind: "entry", entryId: focusEntry.entryId };
  } else if (!narrowed && context.focus?.kind === "entry_list") {
    const { list } = context.focus;
    source = { kind: "list", month: list.month, search: list.search, categories: list.categories };
  } else if (narrowed) {
    const range = when ?? (context.focus?.kind === "entry_list"
      ? monthRange(context.focus.list.month)
      : tripWindow(to ? trips.find((trip) => trip.id === to?.id) ?? null : null, context.today));
    source = { kind: "search", words: words ?? "", currency, from: range.from, to: range.to };
  }
  if (!source) {
    if (making) {
      // "New trip Jeju weekend 3-5 May" with nothing in focus: the trip only.
      return makeOnly(making);
    }
    if (context.focus?.kind === "draft") return { kind: "note", text: TRIP_COPY.saveFirst };
    return askBack({ code: "field_missing", field: "trip_event.words" }, TRIP_COPY.whichEntries, []);
  }
  const reply: AskTurnReply = { kind: "resolve", request: { type: "trip_event", to, fromTripId, make: making, source } };
  return assumed ? { ...reply, assumptions: [assumed] } : reply;
}

function isGenericName(said: string) {
  return tripEventNameKey(said).split(/[^a-z0-9]+/).filter(Boolean).every((word) => GENERIC_TRIP_WORDS.has(word));
}

// A money question about one trip ("how much was the Seoul trip?"): the
// trip, by its name; the page answers it from the trip view's figures.
export function validateTripQuestion(said: unknown, context: AskTurnContext, viewId: string, scope: string): AskTurnReply {
  const trips = context.tripEvents;
  if (!trips) return { kind: "note", text: TRIP_COPY.notReady };
  const name = typeof said === "string" ? said.trim() : "";
  if (!name) {
    return askBack({ code: "field_missing", field: "question.trip", valid: trips.map((trip) => scrubName(trip.name)).slice(0, 12) }, TRIP_COPY.whichTripQuestion, pickerOrder(trips, context.today).slice(0, 4).map((trip) => chip(TRIP_COPY.chips.howMuch(trip.name), trip.name)));
  }
  const found = findTrip(name, trips);
  if (found.kind === "match") {
    return { kind: "trip_answer", tripEventId: found.trip.id, name: found.trip.name, viewId, scope, month: context.month };
  }
  const options = found.kind === "ambiguous" ? found.trips : closestTrips(name, trips, 4);
  return askBack(
    { code: found.kind === "ambiguous" ? "ambiguous_name" : "unknown_trip_event", field: "question.trip", valid: trips.map((trip) => scrubName(trip.name)).slice(0, 12), got: name.slice(0, 40) },
    found.kind === "ambiguous" ? TRIP_COPY.whichTripQuestion : TRIP_COPY.noSuchTrip(name),
    options.map((trip) => chip(TRIP_COPY.chips.howMuch(trip.name), trip.name))
  );
}

// "Open the Seoul trip" (open_page with page.trip as said): the trip's own
// page (DOMAIN.md "Trip page"), found by its name the way a money question
// finds it. No name, two that fit, or none asks back with "Open …" chips.
export function validateTripPage(said: unknown, context: AskTurnContext): AskTurnReply {
  const trips = context.tripEvents;
  if (!trips) return { kind: "note", text: TRIP_COPY.notReady };
  const name = typeof said === "string" ? said.trim() : "";
  const valid = trips.map((trip) => scrubName(trip.name)).slice(0, 12);
  if (!name) {
    return askBack({ code: "field_missing", field: "page.trip", valid }, TRIP_COPY.whichTripQuestion, pickerOrder(trips, context.today).slice(0, 4).map((trip) => chip(TRIP_COPY.chips.open(trip.name), trip.name)));
  }
  const found = findTrip(name, trips);
  if (found.kind === "match") {
    return { kind: "open_page", page: "trip", params: { trip: found.trip.id, name: found.trip.name, view: context.viewId, month: context.month } };
  }
  const options = found.kind === "ambiguous" ? found.trips : closestTrips(name, trips, 4);
  return askBack(
    { code: found.kind === "ambiguous" ? "ambiguous_name" : "unknown_trip_event", field: "page.trip", valid, got: name.slice(0, 40) },
    found.kind === "ambiguous" ? TRIP_COPY.whichTripQuestion : TRIP_COPY.noSuchTrip(name),
    options.map((trip) => chip(TRIP_COPY.chips.open(trip.name), trip.name))
  );
}

type TripMatch =
  | { kind: "match"; trip: AskTurnTrip }
  | { kind: "ambiguous"; trips: AskTurnTrip[] }
  | { kind: "none" };

// A name as said against the household's trips: the same name first (by
// its name key), then the shared name matcher (a word of it, typos).
// "the holiday" with two holidays is ambiguous: they would save
// differently, so the person chooses (decideReadings).
export function findTrip(said: string, trips: readonly AskTurnTrip[]): TripMatch {
  const key = tripEventNameKey(said);
  const same = trips.find((trip) => tripEventNameKey(trip.name) === key);
  if (same) return { kind: "match", trip: same };
  const match = matchName(said, trips.map((trip) => trip.name));
  if (match.kind === "none") return { kind: "none" };
  // Every word that tells trips apart must fit the trip's name: "Tokyo
  // trip" is not Seoul trip because both say "trip".
  const fitting = (match.kind === "match" ? [match.index] : match.indexes).filter((index) => fitsWords(said, trips[index].name));
  const readings = fitting.map((index): AskReading<AskTurnTrip> => ({
    value: trips[index],
    label: trips[index].name,
    effect: `trip:${trips[index].id}`,
    basis: "stated"
  }));
  const decision = decideReadings(readings);
  if (decision.kind === "proceed") return { kind: "match", trip: decision.chosen.value };
  if (decision.kind === "ask") return { kind: "ambiguous", trips: decision.options.map((reading) => reading.value) };
  return { kind: "none" };
}

function closestTrips(said: string, trips: readonly AskTurnTrip[], count: number) {
  const shown = trips.filter((trip) => !trip.putAway);
  const names = closestNames(said, shown.map((trip) => trip.name), count);
  return names.map((name) => shown.find((trip) => trip.name === name)).filter((trip): trip is AskTurnTrip => Boolean(trip));
}

// Now, then the most recent (the picker's order without its use times).
function pickerOrder(trips: readonly AskTurnTrip[], today: string) {
  const shown = trips.filter((trip) => !trip.putAway);
  const now = shown.filter((trip) => trip.startDate && trip.endDate && today >= trip.startDate && today <= trip.endDate);
  return [...now, ...shown.filter((trip) => !now.includes(trip))];
}

// A chip is a whole message a tap sends; one too long to fit is the name.
function chip(text: string, name: string) {
  return text.length <= NAME_CHIP_MAX ? text : name.slice(0, NAME_CHIP_MAX);
}

function whichTripQuestion(trips: readonly AskTurnTrip[], off: boolean): AskTurnReply {
  const options = trips.slice(0, 4).map((trip) => chip(off ? TRIP_COPY.chips.takeOff(trip.name) : TRIP_COPY.chips.putOn(trip.name), trip.name));
  return askBack({ code: trips.length > 1 ? "ambiguous_name" : "field_missing", field: "trip_event.name", valid: trips.map((trip) => scrubName(trip.name)).slice(0, 12) }, TRIP_COPY.whichTrip, options);
}

// A name that is none of the household's: the nearest ones, and making it.
function unknownTripQuestion(said: string, trips: readonly AskTurnTrip[], ground: Ground, off: boolean): AskTurnReply {
  const name = groundedName(said, ground);
  const nearest = closestTrips(said, trips, name && !off ? 3 : 4);
  const options = nearest.map((trip) => chip(off ? TRIP_COPY.chips.takeOff(trip.name) : TRIP_COPY.chips.putOn(trip.name), trip.name));
  if (name && !off) options.push(chip(TRIP_COPY.chips.make(name), name));
  return askBack(
    { code: "unknown_trip_event", field: "trip_event.name", valid: trips.map((trip) => scrubName(trip.name)).slice(0, 12), got: said.slice(0, 40) },
    TRIP_COPY.noSuchTrip(name || said),
    options
  );
}

// A new trip with no entries in focus: made through its own save, and Undo
// deletes it again (its entries, none, stay as they are).
function makeOnly(making: NonNullable<AskTripEventRequest["make"]>): AskTurnReply {
  const rows: AskChangeRow[] = [{ field: "name", before: "", after: making.name }];
  if (making.startDate) rows.push({ field: "dates", before: "", after: making.startDate === making.endDate || !making.endDate ? making.startDate : `${making.startDate} – ${making.endDate}` });
  return {
    kind: "change",
    change: {
      type: "trip_event_create",
      title: making.name,
      rows,
      entries: [],
      count: 0,
      confirmCount: null,
      rule: null,
      save: [{ path: "/api/trip-events/save", body: { name: making.name, ...(making.startDate ? { startDate: making.startDate, endDate: making.endDate ?? making.startDate } : {}) } }],
      undo: [{ path: "/api/trip-events/delete", body: {}, fromResult: { key: "tripEvent.id", as: "tripEventId" } }],
      month: (making.startDate ?? "").slice(0, 7),
      refresh: ["entries"]
    }
  };
}

// ---------------------------------------------------------------------------
// Stage 2: with the household's rows

export function buildTripEventChange(request: AskTripEventRequest, candidates: AskTripCandidate[], trips: readonly AskTurnTrip[], context: Pick<AskTurnContext, "month">): AskTurnReply {
  const nameOf = (id: string | null) => (id ? trips.find((trip) => trip.id === id)?.name ?? "" : "");
  let found = candidates;
  if (request.source.kind === "search") {
    const { words, currency } = request.source;
    found = found
      .filter((entry) => entry.entryType !== "transfer")
      .filter((entry) => !words || matchesWords(entry, words))
      .filter((entry) => !currency || entry.originalCurrency?.toUpperCase() === currency || entry.currency.toUpperCase() === currency);
  }
  if (request.source.kind === "list") {
    const { search, categories } = request.source;
    found = found
      .filter((entry) => entry.entryType !== "transfer")
      .filter((entry) => !search || matchesWords(entry, search))
      .filter((entry) => !categories.length || categories.includes(entry.categoryName));
  }
  if (!found.length) return { kind: "note", text: TRIP_COPY.noneFound };
  const target = request.make ? "new" : request.to?.id ?? null;
  const targetName = request.make?.name ?? request.to?.name ?? "";
  const moving = found
    .filter((entry) => (target === null ? entry.tripEventId !== null && (!request.fromTripId || entry.tripEventId === request.fromTripId) : entry.tripEventId !== target))
    .sort((left, right) => left.date.localeCompare(right.date) || left.entryId.localeCompare(right.entryId));
  if (!moving.length) {
    return { kind: "note", text: target === null ? TRIP_COPY.noneOnATrip : TRIP_COPY.alreadyOn(targetName, found.length) };
  }
  if (moving.length > MAX_TRIP_EVENT_CHANGE) {
    return { kind: "note", text: TRIP_COPY.tooMany(moving.length, MAX_TRIP_EVENT_CHANGE) };
  }

  // One row for each trip the entries come from: never moved without it showing.
  const rows: AskChangeRow[] = [];
  for (const entry of moving) {
    const before = nameOf(entry.tripEventId);
    if (!rows.some((row) => row.before === before)) rows.push({ field: "trip", before, after: targetName });
  }
  const entries: AskChangeEntry[] = moving.slice(0, PREVIEW_ROWS).map((entry) => ({
    entryId: entry.entryId,
    date: entry.date,
    description: entry.description,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    categoryName: entry.categoryName,
    ...(entry.accountName ? { accountName: entry.accountName } : {}),
    trip: { before: nameOf(entry.tripEventId), after: targetName }
  }));
  const confirm = moving.length > BULK_RECATEGORISE_CONFIRM_ABOVE ? moving.length : null;
  const body: Record<string, unknown> = {
    changes: moving.map((entry) => ({ entryId: entry.entryId, tripEventId: target })),
    addedBy: "ask"
  };
  if (request.make) {
    body.newTripEvent = {
      name: request.make.name,
      startDate: request.make.startDate ?? moving[0].date,
      endDate: request.make.endDate ?? (request.make.startDate ? request.make.startDate : moving[moving.length - 1].date)
    };
  }
  const undo: AskChangeStep[] = [{ path: "/api/trip-events/undo", body: {}, fromResult: { key: "undoId", as: "undoId" } }];
  return {
    kind: "change",
    change: {
      type: "trip_event",
      title: targetName || TRIP_COPY.takeOffTitle,
      rows,
      entries,
      count: moving.length,
      confirmCount: confirm,
      rule: null,
      save: [{ path: "/api/trip-events/entries/set", body }],
      undo,
      month: moving[moving.length - 1].date.slice(0, 7) || context.month,
      refresh: ["entries"]
    }
  };
}

function matchesWords(entry: Pick<AskTripCandidate, "description" | "originalDescription">, words: string) {
  const rule = { id: "ask-trip-words", pattern: words, categoryId: "", categoryName: "match", priority: 0, isActive: true };
  return [entry.originalDescription, entry.description].some((text) => Boolean(text) && matchCategoryRule(String(text), [rule]) === "match");
}

// ---------------------------------------------------------------------------
// Reading what was said

// Shop words the person wrote ("hotel", "olive young"): "" when none were
// given, null when they are not the person's own words.
function groundedWords(value: unknown, ground: Ground): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().replace(/^(the|a|an|my|our)\s+/i, "").replace(/\s+(one|ones|entry|entries)$/i, "") : "";
  if (!text) return "";
  if (text.length > WORDS_MAX || !/\p{L}{2,}/u.test(text)) return null;
  return wordsOf(text).every((word) => ground.words.has(word)) ? scrubName(text) || null : null;
}

// A new trip's name: the person's own words, at most the name's limit.
function groundedName(value: string, ground: Ground): string {
  const text = value.replace(/["“”']/g, "").replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_TRIP_EVENT_NAME_LENGTH) return "";
  return wordsOf(text).every((word) => ground.words.has(word)) ? text : "";
}

// "won", "in yen", "KRW": a three-letter code, when the person said it.
function readCurrency(value: unknown, ground: Ground): string | null {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/^(in|paid in)\s+/, "") : "";
  if (!text || !ground.words.has(text)) return null;
  if (CURRENCY_WORDS[text]) return CURRENCY_WORDS[text];
  return /^[a-z]{3}$/.test(text) ? text.toUpperCase() : null;
}

// "yesterday", "last week", "this week", "last 3 days", "september": the
// days it covers. null when nothing was said.
function readWhen(value: unknown, context: Pick<AskTurnContext, "today">): { from: string; to: string } | null | "invalid" {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (!text) return null;
  const today = context.today;
  if (text === "this week") return { from: addDays(today, -mondayOffset(today)), to: today };
  if (text === "last week") {
    const monday = addDays(today, -mondayOffset(today) - 7);
    return { from: monday, to: addDays(monday, 6) };
  }
  const lastDays = /^(?:the )?(?:last|past) (\d{1,2}) days$/.exec(text);
  if (lastDays) return { from: addDays(today, -Number(lastDays[1]) + 1), to: today };
  const day = readDayWord(text, today);
  if (day) return { from: day, to: day };
  const month = readMonthWord(text, today);
  if (month) return monthRange(month);
  return "invalid";
}

function mondayOffset(day: string) {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function monthRange(month: string) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

// Where a shop word is looked for when no day is said.
function tripWindow(trip: AskTurnTrip | null, today: string) {
  if (trip?.startDate) {
    return { from: addDays(trip.startDate, -BEFORE_TRIP_DAYS), to: addDays(trip.endDate ?? trip.startDate, AFTER_TRIP_DAYS) };
  }
  return { from: addDays(today, -RECENT_DAYS), to: today };
}

// A new trip's days as said ("3 may", "5 may"): the nearest such day, ahead
// or behind (a trip can be planned before it starts). One day alone is a
// one-day event.
export function readTripDays(fromValue: unknown, toValue: unknown, today: string): { ok: true; startDate: string | null; endDate: string | null } | { ok: false } {
  const read = (value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return { said: false, day: null as string | null };
    return { said: true, day: nearestDay(text, today) };
  };
  const start = read(fromValue);
  const end = read(toValue);
  if ((start.said && !start.day) || (end.said && !end.day)) return { ok: false };
  const first = start.day ?? end.day;
  let last = end.day ?? start.day;
  if (first && last && last < first) {
    // "28 dec to 2 jan": the end is in the year after.
    const next = `${Number(last.slice(0, 4)) + 1}${last.slice(4)}`;
    if (next < first) return { ok: false };
    last = next;
  }
  return { ok: true, startDate: first, endDate: last };
}

function nearestDay(text: string, today: string): string | null {
  const day = readDayWord(text, today);
  if (!day) return null;
  // readDayWord reads the most recent such day; a day without a year more
  // than half a year back is the coming one.
  if (!/\b\d{4}\b/.test(text) && day < addDays(today, -183)) {
    const next = `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
    return Number.isNaN(Date.parse(`${next}T00:00:00Z`)) ? null : next;
  }
  return day;
}

function addDays(day: string, delta: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The rules: the offline backup

const FOCUS_WORDS = new Set(["it", "this", "this one", "that", "that one", "these", "those", "them", "all of them", "all these", "all those", "these ones", "those ones", "all", "everything", "these entries", "those entries", "the lot"]);
const TRIP_WORDS = /\b(trip|holiday|holidays|vacation|event|getaway)\b/;

// The same messages the model reads, read by rules into the same action:
// "put / add / move <these | it | the X one | paid in won> on / to <name>",
// "take these off (the trip | <name>)", "new trip <name> <dates>", "make
// <name>" (the question's chip), and "how much was / did we spend on
// <name>?". Null for anything else, so other readers keep their messages:
// a name has to be one of the household's trips (or say trip, holiday or
// event), and an amount makes it an entry, never a trip.
export function readTripEventRules(text: string, trips: readonly AskTurnTrip[], context: { categoryNames: readonly string[] }): AskTurnAction | null {
  // Case is kept: a new trip's name is the person's as they wrote it.
  const message = String(text ?? "").replace(/[’‘]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  if (!message || !trips) return null;
  const knows = (name: string) => namesTrip(name, trips) || TRIP_WORDS.test(name.toLowerCase());

  // "open the Seoul trip", "show me Bali trip": the trip's own page (DOMAIN.md
  // "Trip page"), only for a name that is one of the household's trips.
  const open = /^(?:please )?(?:open|show(?: me)?|go to|take me to)(?: the| our| my)? (.+?)(?: page)?\s*\??$/i.exec(message);
  if (open && namesTrip(open[1].trim(), trips)) {
    return action("open_page", { page: { name: "trip", trip: open[1].trim(), month: null, person: null } });
  }

  const money = /^(?:how much (?:did|have) (?:we|i|you) (?:spend|spent|pay|paid) (?:on|for|in|during) |how much (?:was|were|did|is) |what did |what was the (?:total|cost) (?:of|for) )(?:the |our |my )?(.+?)(?: cost| come to)?\s*\??$/i.exec(message);
  if (money) {
    const name = money[1].trim();
    // "how much did I spend on Groceries?" is a category's, never a trip's.
    if (!name || context.categoryNames.some((category) => tripEventNameKey(category) === tripEventNameKey(name))) return null;
    if (!namesTrip(name, trips)) return null;
    return action("answer_question", { question: { topic: "trip", trip: name } });
  }

  // "new trip Jeju weekend 3-5 May", and the question's chip: Make "Jeju weekend".
  const make = /^(?:new|make (?:a )?new|start (?:a )?new|create (?:a )?(?:new )?)\s*(?:trip|event|holiday)(?: or event)?\s*:?\s+(.+)$/i.exec(message) ?? /^make\s+"(.+)"$/i.exec(message);
  if (make) {
    const { name, from, to } = splitTripDays(make[1]);
    if (!name || /\$|\d+\.\d{2}/.test(name)) return null;
    return action("set_trip_event", { trip_event: { name, make: true, from, to } });
  }

  const lower = message.toLowerCase();
  if (/\$|\b\d+(?:\.\d+)?\b/.test(lower.replace(/\b(?:last|past) \d{1,2} days\b/g, ""))) {
    // An amount: an entry ("add coffee 5 to citi"), never a trip.
    return null;
  }

  const takeOff = /^(?:please )?(?:take|remove|move) (.+?) (?:off|out of|from) (?:the |our |its |their )?(.+)$/i.exec(message);
  if (takeOff) {
    const which = readWhich(takeOff[1].toLowerCase());
    const name = /^(trip|event|holiday|trip or event)$/i.test(takeOff[2]) ? null : takeOff[2];
    if (!which || (name && !knows(name))) return null;
    return action("set_trip_event", { trip_event: { name, off: true, ...which } });
  }

  // "move everything paid in won to Seoul trip": of the places the message
  // could split, a trip's own name wins over a mere "trip" word.
  const lead = /^(?:please )?(?:put|add|move|tag|file) /i.exec(message);
  if (lead) {
    const body = message.slice(lead[0].length);
    const splits = [...body.matchAll(/ (?:on|onto|to|into|in|under|for) (?:the |our |my )?/gi)]
      .map((match) => ({ which: body.slice(0, match.index), name: body.slice((match.index ?? 0) + match[0].length).trim() }))
      .filter((split) => split.which && split.name);
    const chosen = splits.find((split) => namesTrip(split.name, trips)) ?? splits.find((split) => TRIP_WORDS.test(split.name.toLowerCase()));
    if (!chosen) return null;
    const which = readWhich(chosen.which.toLowerCase());
    if (!which) return null;
    return action("set_trip_event", { trip_event: { name: chosen.name, ...which } });
  }
  return null;
}

// Whether a name said is one of the trips (findTrip, with its word check).
// "my grab trip" names no trip; "seol trip" does.
function namesTrip(said: string, trips: readonly AskTurnTrip[]) {
  return findTrip(said, trips).kind !== "none";
}

// Every word of what was said, leaving out "trip", "holiday", "the", within
// a typo of a word of the trip's name ("seol" is "Seoul").
const GENERIC_TRIP_WORDS = new Set(["trip", "trips", "holiday", "holidays", "event", "events", "the", "our", "my", "a", "s"]);
function fitsWords(said: string, name: string) {
  const words = tripEventNameKey(said).split(/[^a-z0-9]+/).filter((word) => word && !GENERIC_TRIP_WORDS.has(word));
  const nameWords = tripEventNameKey(name).split(/[^a-z0-9]+/).filter(Boolean);
  return words.every((word) => nameWords.some((other) => other === word || other.startsWith(word) || (word.length >= 4 && editDistance(word, other, 2) <= (word.length >= 7 ? 2 : 1))));
}

// "these", "it", "the hotel", "the Olive Young one", "everything paid in
// won", "last week's", "the hotel yesterday": which entries, as the action's
// words, currency and when.
function readWhich(phrase: string): { words: string | null; currency: string | null; when: string | null } | null {
  let rest = phrase.trim();
  if (FOCUS_WORDS.has(rest)) return { words: null, currency: null, when: null };
  let currency: string | null = null;
  rest = rest.replace(/\b(?:paid |spent )?in (won|yen|baht|ringgit|rupiah|euros?|pounds?|dong|pesos?|yuan|krw|jpy|thb|myr|idr|usd|eur|gbp|aud|nzd|hkd|twd|vnd|cny|php|inr|chf)\b/, (_, word: string) => {
    currency = word;
    return "";
  });
  let when: string | null = null;
  rest = rest.replace(/\b(?:from |on )?(yesterday|today|last week|this week|(?:the )?(?:last|past) \d{1,2} days|last month|this month)(?:'s)?\b/, (_, word: string) => {
    when = word;
    return "";
  });
  const words = rest.replace(/^(?:the |a |my |our |those |these |all the |everything )+/, "").replace(/\s+(?:one|ones|entry|entries|ones too)$/, "").replace(/\s+/g, " ").trim();
  const focus = !words || FOCUS_WORDS.has(words) || /^(?:entries|ones|things|payments|charges|stuff)$/.test(words);
  if (focus && !currency && !when) return { words: null, currency: null, when: null };
  return { words: focus ? null : words, currency, when };
}

// "Jeju weekend 3-5 may", "Jeju weekend from 3 may to 5 may", "Mum's 70th
// on 12 july": the name, and the days as said.
function splitTripDays(text: string): { name: string; from: string | null; to: string | null } {
  const month = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
  const trimmed = text.trim().replace(/["“”]/g, "");
  const flags = "i";
  const patterns: Array<[RegExp, (match: RegExpExecArray) => { from: string; to: string }]> = [
    [new RegExp(`\\s+(?:from |on )?(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2}) ${month}(?: (\\d{4}))?$`, flags), (m) => ({ from: `${m[1]} ${m[3]}${m[4] ? ` ${m[4]}` : ""}`, to: `${m[2]} ${m[3]}${m[4] ? ` ${m[4]}` : ""}` })],
    [new RegExp(`\\s+(?:from |on )?(\\d{1,2} ${month})\\s*(?:-|–|to|until)\\s*(\\d{1,2} ${month})$`, flags), (m) => ({ from: m[1], to: m[3] })],
    [new RegExp(`\\s+(?:from |on )?${month} (\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})$`, flags), (m) => ({ from: `${m[2]} ${m[1]}`, to: `${m[3]} ${m[1]}` })],
    [new RegExp(`\\s+(?:on )?(\\d{1,2} ${month})$`, flags), (m) => ({ from: m[1], to: m[1] })]
  ];
  for (const [pattern, read] of patterns) {
    const match = pattern.exec(trimmed);
    if (match) {
      return { name: trimmed.slice(0, match.index).trim(), ...read(match) };
    }
  }
  return { name: trimmed, from: null, to: null };
}

function action(name: "set_trip_event" | "answer_question" | "open_page", parts: Record<string, unknown>): AskTurnAction {
  return {
    action: name,
    entry: null,
    split: null,
    settlement: null,
    plan: null,
    question: null,
    search: null,
    page: null,
    clarify: null,
    note: null,
    ...parts
  } as AskTurnAction;
}

// Every line Ask says about trips and events, in plain words.
export const TRIP_COPY = {
  notReady: "Trips and events aren't set up here yet.",
  whichTrip: "Which trip or event?",
  whichTripQuestion: "Which trip or event do you mean?",
  noSuchTrip: (name: string) => `There's no trip or event called "${scrubName(name)}". Did you mean one of these?`,
  newName: "What should the new trip or event be called?",
  whichDays: "Which days is it? For example: 3 to 5 May.",
  whichDay: "Which days do you mean? For example: yesterday, last week or September.",
  whichEntries: "Which entries? Say the shop, a day or \"paid in won\", or find them first and say \"put these on\" the trip.",
  saveFirst: "Save this entry first, then put it on a trip or event.",
  noneFound: "I couldn't find any entries like that. Try the shop's name as the bank shows it, or find them first and say \"put these on\" the trip.",
  noneOnATrip: "None of these are on a trip or event.",
  alreadyOn: (name: string, count: number) => (count === 1 ? `It's already on ${scrubName(name)}.` : `They're already on ${scrubName(name)}.`),
  tooMany: (count: number, max: number) => `That's ${count} entries, more than Ask puts on a trip at once (${max}). Choose them on Entries instead.`,
  takeOffTitle: "No trip or event",
  assumedOnly: (name: string) => `You didn't name one, so I used ${scrubName(name)}.`,
  chips: {
    putOn: (name: string) => `Put them on ${name}`,
    takeOff: (name: string) => `Take them off ${name}`,
    make: (name: string) => `Make "${name}"`,
    howMuch: (name: string) => `How much was ${name}?`,
    open: (name: string) => `Open ${name}`
  }
};
