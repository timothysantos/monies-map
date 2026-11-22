// Trip ledger import, part 1: reading a trip ledger export and matching its
// purchases to the household's ledger entries (docs/audits/trip-ledger-import.md).
//
// A trip ledger is a separate tool's list of receipts photographed on a
// trip: each purchase has a trip day number, a shop, the amount in the
// trip's currency, an SGD figure (the card's amount, or an estimate), who
// paid and what the other person owes. This module is pure: no storage, no
// network, no AI. It never guesses an amount or a share; a purchase whose
// amount, payer or sharing is not settled is held, not matched.
import { isCardMerchantPrefixMatch, readCardForeignAmountMinor } from "./statement-row-matching";

export type TripLedgerConfidence = "certain" | "likely" | "ambiguous" | "none";

// One purchase in the ledger, normalized. Amounts are minor units: SGD
// cents, and the trip currency times 100 (JPY 1,250 is 125_000), the same as
// `transactions.original_amount_minor`.
export interface TripLedgerLine {
  id: string;
  day: number | null;
  date: string | null;
  // Receipt local time "HH:MM" in the trip's own time zone, when written.
  time: string | null;
  merchant: string;
  itemsText: string;
  items: { name: string; quantity: number; totalForeign: number | null }[];
  category: string;
  payerName: string;
  foreignMinor: number | null;
  homeMinor: number | null;
  status: string;
  // What the person who did not pay owes the payer, in home minor units.
  owedHomeMinor: number | null;
  allocationPending: boolean;
  payerPending: boolean;
  fundingCard: string | null;
  paymentWallet: string | null;
  notes: string;
}

// Why a line cannot be imported as it stands. Such a line is never
// imported as a guess; it waits for the owner's answer.
export function readLineHold(line: TripLedgerLine): string | null {
  if (line.allocationPending) return "The ledger says who it is for is not settled yet.";
  if (line.payerPending) return "The ledger says who paid is not settled yet.";
  if (line.homeMinor === null || line.homeMinor <= 0) return "The ledger has no amount for it.";
  if (line.status === "unknown") return "The ledger marks the amount as unknown.";
  if (line.owedHomeMinor === null) return "The ledger has no share for it.";
  if (line.owedHomeMinor < 0 || line.owedHomeMinor > line.homeMinor) return "The ledger's share is more than the amount.";
  if (!line.date) return "The ledger's day could not be placed on a date.";
  return null;
}

type RawRecord = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value)).trim();
const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const toMinor = (major: number | null) => (major === null ? null : Math.round(major * 100));

// Reads the export's purchases. `dayZero` is the calendar date of day 0
// (inferTripDayZero), so day N is dayZero + N.
export function readTripLedgerExport(raw: unknown, dayZero: string | null): TripLedgerLine[] {
  const root = (raw ?? {}) as RawRecord;
  const expenses = Array.isArray(root.expenses) ? (root.expenses as RawRecord[]) : [];
  const items = Array.isArray(root.items) ? (root.items as RawRecord[]) : [];
  return expenses.map((expense) => {
    const id = text(expense.id);
    const day = numberOrNull(expense.day);
    const time = /^\d{1,2}:\d{2}$/.test(text(expense.time)) ? text(expense.time).padStart(5, "0") : null;
    return {
      id,
      day,
      date: dayZero && day !== null ? addDays(dayZero, day) : null,
      time,
      merchant: text(expense.merchant),
      itemsText: text(expense.items),
      items: items
        .filter((item) => text(item.expense_id) === id)
        .map((item) => ({ name: text(item.name), quantity: numberOrNull(item.quantity) ?? 1, totalForeign: numberOrNull(item.total_jpy) })),
      category: text(expense.category),
      payerName: text(expense.payer),
      foreignMinor: toMinor(numberOrNull(expense.jpy)),
      homeMinor: numberOrNull(expense.sgd_cents) === null ? null : Math.round(numberOrNull(expense.sgd_cents)!),
      status: text(expense.status).toLowerCase(),
      owedHomeMinor: numberOrNull(expense.owed_cents) === null ? null : Math.round(numberOrNull(expense.owed_cents)!),
      allocationPending: Boolean(numberOrNull(expense.allocation_pending)),
      payerPending: Boolean(numberOrNull(expense.payer_pending)),
      fundingCard: text(expense.funding_card) || null,
      paymentWallet: text(expense.payment_wallet) || null,
      notes: text(expense.notes)
    };
  });
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// The calendar dates a purchase's own id and notes name ("…-20310305-…",
// "5 Mar 2031", "Wednesday 5 March 2031", "2031-03-05"), plus an explicit
// "(1 Mar = Day 0)" anchor.
function readDateEvidence(expense: RawRecord): { dates: string[]; dayZeroAnchors: string[] } {
  const dates = new Set<string>();
  const anchors = new Set<string>();
  const id = text(expense.id);
  for (const match of id.matchAll(/(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?=[^0-9]|$)/g)) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    if (isValidIsoDate(iso)) dates.add(iso);
  }
  const notes = text(expense.notes);
  for (const match of notes.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    if (isValidIsoDate(iso)) dates.add(iso);
  }
  for (const match of notes.matchAll(/\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (20\d{2})\b/gi)) {
    const iso = `${match[3]}-${String(MONTHS.indexOf(match[2].toLowerCase()) + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    if (isValidIsoDate(iso)) dates.add(iso);
  }
  const year = [...dates][0]?.slice(0, 4);
  for (const match of notes.matchAll(/\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* = day 0\b/gi)) {
    if (!year) continue;
    const iso = `${year}-${String(MONTHS.indexOf(match[2].toLowerCase()) + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    if (isValidIsoDate(iso)) anchors.add(iso);
  }
  return { dates: [...dates], dayZeroAnchors: [...anchors] };
}

export interface TripDayZeroReading {
  dayZero: string | null;
  // How many purchases name a date that fits this day 0, and which do not.
  agreeing: number;
  conflicting: { id: string; day: number; date: string }[];
  anchors: string[];
}

// The calendar date of trip day 0, read from the purchases that name their
// own date. The date most of them agree on wins; a purchase whose date and
// day disagree is reported, never silently moved.
export function inferTripDayZero(raw: unknown): TripDayZeroReading {
  const root = (raw ?? {}) as RawRecord;
  const expenses = Array.isArray(root.expenses) ? (root.expenses as RawRecord[]) : [];
  const votes = new Map<string, number>();
  const observations: { id: string; day: number; date: string; implied: string }[] = [];
  const anchors = new Set<string>();
  for (const expense of expenses) {
    const day = numberOrNull(expense.day);
    const evidence = readDateEvidence(expense);
    evidence.dayZeroAnchors.forEach((anchor) => anchors.add(anchor));
    if (day === null) continue;
    // A purchase naming two dates (a charge date and a receipt date) gives
    // no clear vote.
    if (evidence.dates.length !== 1) continue;
    const implied = addDays(evidence.dates[0], -day);
    observations.push({ id: text(expense.id), day, date: evidence.dates[0], implied });
    votes.set(implied, (votes.get(implied) ?? 0) + 1);
  }
  anchors.forEach((anchor) => votes.set(anchor, (votes.get(anchor) ?? 0) + 1));
  const ranked = [...votes].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const dayZero = ranked[0]?.[0] ?? null;
  return {
    dayZero,
    agreeing: observations.filter((item) => item.implied === dayZero).length,
    conflicting: observations.filter((item) => item.implied !== dayZero).map(({ id, day, date }) => ({ id, day, date })),
    anchors: [...anchors]
  };
}

// A ledger entry as the matcher sees it. `ownerPersonId` is the wallet's
// owner (the Split Payer rule: a wallet that belongs to one person means
// that person paid).
export interface TripLedgerCandidateEntry {
  id: string;
  accountId: string;
  accountOwnerPersonId: string | null;
  accountIsJoint: boolean;
  date: string;
  postDate: string | null;
  // "HH:MM" in the household's home time zone, when the entry has one.
  time: string | null;
  description: string;
  amountMinor: number;
  entryType: string;
  originalAmountMinor: number | null;
  originalCurrency: string | null;
  statementCertified: boolean;
}

export interface TripLedgerMatchOptions {
  foreignCurrency: string;
  // How many hours the trip's clock is ahead of the home clock (one hour
  // for a trip one time zone east).
  tripClockAheadHours: number;
  // An entry may be dated a day before the receipt (the home clock is
  // behind) and up to a few days after (a bank posting date).
  daysBefore: number;
  daysAfter: number;
}

export const DEFAULT_TRIP_LEDGER_MATCH_OPTIONS: TripLedgerMatchOptions = {
  foreignCurrency: "JPY",
  tripClockAheadHours: 1,
  daysBefore: 1,
  daysAfter: 3
};

// The card's amount can be a few percent off the ledger's figure: the
// ledger's SGD may be an estimate at a reference rate, and the card adds
// its own rate and fees. Same room as a foreign currency estimate.
const HOME_AMOUNT_ROOM_SHARE = 0.05;
const HOME_AMOUNT_ROOM_MIN_MINOR = 10;
// Two candidates within this many points of each other are a tie.
const TIE_MARGIN = 10;

export interface TripLedgerCandidate {
  entryId: string;
  score: number;
  reasons: string[];
}

export interface TripLedgerMatch {
  lineId: string;
  confidence: TripLedgerConfidence;
  entryId: string | null;
  candidates: TripLedgerCandidate[];
  reasons: string[];
}

export interface TripLedgerMatchResult {
  matches: TripLedgerMatch[];
  // Expense entries in the trip's days that no ledger line
  // took: possibly a purchase without a photographed receipt.
  entriesWithoutLine: string[];
}

interface Scored extends TripLedgerCandidate {
  lineId: string;
  strongAmount: boolean;
  nameOrTime: boolean;
  dayDistance: number;
}

// Matches each ledger line to at most one entry and each entry to at most
// one line. `payerPersonIdFor` names the household person behind a line's
// payer (null: not one of the household, never matched).
export function matchTripLedger(input: {
  lines: TripLedgerLine[];
  entries: TripLedgerCandidateEntry[];
  payerPersonIdFor: (line: TripLedgerLine) => string | null;
  options?: Partial<TripLedgerMatchOptions>;
}): TripLedgerMatchResult {
  const options = { ...DEFAULT_TRIP_LEDGER_MATCH_OPTIONS, ...input.options };
  const lines = input.lines.filter((line) => !readLineHold(line));
  const scoredByLine = new Map<string, Scored[]>();
  for (const line of lines) {
    const payerId = input.payerPersonIdFor(line);
    const scored = input.entries
      .map((entry) => scoreCandidate(line, entry, payerId, options))
      .filter((item): item is Scored => Boolean(item))
      .sort((left, right) => right.score - left.score || left.entryId.localeCompare(right.entryId));
    scoredByLine.set(line.id, scored);
  }

  const entryById = new Map(input.entries.map((entry) => [entry.id, entry]));
  const lineById = new Map(input.lines.map((line) => [line.id, line]));
  const taken = new Set<string>();
  const decided = new Map<string, TripLedgerMatch>();

  // Lines whose candidates are the same entries with the same bank facts
  // (two identical charges at one shop on one day): which entry takes which
  // line changes nothing, so they pair in order.
  const interchangeable = (lineIds: string[], entryIds: string[]) => {
    if (lineIds.length < 2 || entryIds.length !== lineIds.length) return false;
    const facts = (entryId: string) => {
      const entry = entryById.get(entryId)!;
      return [entry.accountId, entry.date, entry.amountMinor, entry.description.toLowerCase(), entry.originalAmountMinor].join("|");
    };
    const lineFacts = (lineId: string) => {
      const line = lineById.get(lineId)!;
      return [line.date, line.homeMinor, line.foreignMinor].join("|");
    };
    return new Set(entryIds.map(facts)).size === 1 && new Set(lineIds.map(lineFacts)).size === 1;
  };

  // Surest lines first.
  const order = [...lines].sort((left, right) => (scoredByLine.get(right.id)?.[0]?.score ?? -1) - (scoredByLine.get(left.id)?.[0]?.score ?? -1));
  for (const line of order) {
    if (decided.has(line.id)) continue;
    const all = scoredByLine.get(line.id) ?? [];
    const open = all.filter((candidate) => !taken.has(candidate.entryId));
    const candidates = all.map(({ entryId, score, reasons }) => ({ entryId, score, reasons }));
    if (!open.length) {
      decided.set(line.id, { lineId: line.id, confidence: "none", entryId: null, candidates, reasons: all.length ? ["Its only matching entries went to surer lines."] : ["No entry fits its day, amount and wallet."] });
      continue;
    }
    const best = open[0];
    const tiedEntries = open.filter((candidate) => best.score - candidate.score < TIE_MARGIN).map((candidate) => candidate.entryId);
    // Other open lines that want the best entry about as much.
    const rivalLines = order
      .filter((other) => other.id !== line.id && !decided.has(other.id))
      .filter((other) => (scoredByLine.get(other.id) ?? []).some((candidate) => candidate.entryId === best.entryId && best.score - candidate.score < TIE_MARGIN))
      .map((other) => other.id);
    if (tiedEntries.length === 1 && rivalLines.length === 0) {
      taken.add(best.entryId);
      const certain = best.strongAmount && best.nameOrTime && Math.abs(best.dayDistance) <= 1 && all.length === 1;
      decided.set(line.id, { lineId: line.id, confidence: certain ? "certain" : "likely", entryId: best.entryId, candidates, reasons: best.reasons });
      continue;
    }
    const groupLines = [line.id, ...rivalLines];
    if (interchangeable(groupLines, tiedEntries)) {
      groupLines.forEach((lineId, index) => {
        const entryId = tiedEntries[index];
        taken.add(entryId);
        const lineCandidates = (scoredByLine.get(lineId) ?? []).map(({ entryId: id, score, reasons }) => ({ entryId: id, score, reasons }));
        decided.set(lineId, {
          lineId,
          confidence: "likely",
          entryId,
          candidates: lineCandidates,
          reasons: ["Same shop, day and amount as another purchase: either entry fits either line, and the bank facts are the same."]
        });
      });
      continue;
    }
    // A real tie: two entries fit this line, or another line fits its
    // entry as well. Nothing is taken; the owner picks.
    for (const lineId of groupLines) {
      if (decided.has(lineId)) continue;
      const lineCandidates = (scoredByLine.get(lineId) ?? []).filter((candidate) => !taken.has(candidate.entryId)).map(({ entryId, score, reasons }) => ({ entryId, score, reasons }));
      decided.set(lineId, {
        lineId,
        confidence: "ambiguous",
        entryId: null,
        candidates: lineCandidates,
        reasons: [tiedEntries.length > 1 ? "More than one entry fits it equally." : "Another purchase fits the same entry equally."]
      });
    }
  }

  const matches = input.lines.map((line) => {
    const hold = readLineHold(line);
    if (hold) return { lineId: line.id, confidence: "none" as const, entryId: null, candidates: [], reasons: [hold] };
    return decided.get(line.id)!;
  });

  // Entries in the trip's days that no line took.
  // From the first day in the country (day 1 on; day 0 is before leaving)
  // to the last purchase plus the posting delay.
  const inCountry = lines.filter((line) => (line.day ?? 1) >= 1);
  const lineDates = (inCountry.length ? inCountry : lines).map((line) => line.date!).sort();
  const from = lineDates.length ? lineDates[0] : null;
  const to = lineDates.length ? addDays(lineDates[lineDates.length - 1], options.daysAfter) : null;
  const matchedIds = new Set(matches.map((match) => match.entryId).filter(Boolean));
  const entriesWithoutLine = from && to
    ? input.entries
      .filter((entry) => entry.entryType === "expense" && entry.date >= from && entry.date <= to)
      .filter((entry) => !matchedIds.has(entry.id))
      .map((entry) => entry.id)
    : [];
  return { matches, entriesWithoutLine };
}

function scoreCandidate(line: TripLedgerLine, entry: TripLedgerCandidateEntry, payerId: string | null, options: TripLedgerMatchOptions): Scored | null {
  if (entry.entryType !== "expense" || !line.date || line.homeMinor === null) return null;
  // Split Payer: the wallet's one owner paid. A joint wallet, or one with no
  // owner, can be either person's.
  if (!payerId) return null;
  if (entry.accountOwnerPersonId && !entry.accountIsJoint && entry.accountOwnerPersonId !== payerId) return null;

  const dayDistance = daysBetweenIso(line.date, entry.date);
  const postDistance = entry.postDate ? daysBetweenIso(line.date, entry.postDate) : null;
  const inWindow = (distance: number | null) => distance !== null && distance >= -options.daysBefore && distance <= options.daysAfter;
  if (!inWindow(dayDistance) && !inWindow(postDistance)) return null;

  const reasons: string[] = [];
  const currency = options.foreignCurrency;
  // The trip-currency amount the entry carries: a Wallet amount kept on an
  // estimate, or the amount a card row prints ("JPY 12,500").
  const entryForeign = entry.originalCurrency?.toUpperCase() === currency && entry.originalAmountMinor !== null
    ? Number(entry.originalAmountMinor)
    : readCardForeignAmountMinor(entry.description, currency) ?? null;
  if (entryForeign !== null && line.foreignMinor !== null && entryForeign !== line.foreignMinor) {
    // A different amount in the purchase's own currency is another purchase.
    return null;
  }
  const foreignExact = entryForeign !== null && line.foreignMinor !== null && entryForeign === line.foreignMinor;
  const homeDiff = Math.abs(entry.amountMinor - line.homeMinor);
  const room = Math.max(Math.round(line.homeMinor * HOME_AMOUNT_ROOM_SHARE), HOME_AMOUNT_ROOM_MIN_MINOR);
  const homeExact = homeDiff <= 1;
  if (!foreignExact && homeDiff > room) return null;

  let score = 0;
  if (foreignExact) {
    score += 50;
    reasons.push(`Same ${currency} amount.`);
  } else if (homeExact) {
    score += 40;
    reasons.push("Same SGD amount.");
  } else {
    score += 25 - Math.round((15 * homeDiff) / room);
    reasons.push(`SGD amount ${homeDiff} cents apart (within ${room}).`);
  }
  const name = merchantSimilarity(line.merchant, entry.description);
  if (name === "strong") {
    score += 20;
    reasons.push("Same shop name.");
  } else if (name === "weak") {
    score += 8;
    reasons.push("Shop names share a word.");
  }
  const timeClose = isTimeClose(line.time, entry.time, options.tripClockAheadHours, dayDistance);
  if (timeClose) {
    score += 15;
    reasons.push("Same time of day.");
  }
  const distance = inWindow(dayDistance) ? dayDistance : postDistance!;
  score -= 3 * Math.abs(distance);
  if (distance !== 0) reasons.push(distance > 0 ? `Entry dated ${distance} day(s) later.` : `Entry dated ${-distance} day(s) earlier.`);
  return {
    lineId: line.id,
    entryId: entry.id,
    score,
    reasons,
    strongAmount: foreignExact || homeExact,
    nameOrTime: name === "strong" || timeClose,
    dayDistance: distance
  };
}

const PAYMENT_PREFIXES = /^(amaze\*|amaze |apple pay |gpay |paypal \*|sq \*)/i;
const compact = (value: string) => value.toLowerCase().replace(PAYMENT_PREFIXES, "").replace(/[^a-z0-9]+/g, "");
const words = (value: string) => value.toLowerCase().replace(PAYMENT_PREFIXES, "").split(/[^a-z0-9]+/).filter((word) => word.length >= 4);

// "strong": one name starts the other ("AMAZE*CORNERMART" and "Cornermart
// station") or the first words agree; "weak": a shared word of 4+ letters.
export function merchantSimilarity(ledgerMerchant: string, entryDescription: string): "strong" | "weak" | "none" {
  if (isCardMerchantPrefixMatch(entryDescription, ledgerMerchant)) return "strong";
  const left = compact(ledgerMerchant);
  const right = compact(entryDescription);
  if (left.length >= 4 && right.length >= 4 && (left.startsWith(right) || right.startsWith(left))) return "strong";
  const leftWords = words(ledgerMerchant);
  const rightWords = words(entryDescription);
  if (leftWords[0] && leftWords[0] === rightWords[0]) return "strong";
  return leftWords.some((word) => rightWords.includes(word)) ? "weak" : "none";
}

function isTimeClose(lineTime: string | null, entryTime: string | null, aheadHours: number, dayDistance: number) {
  if (!lineTime || !entryTime) return false;
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  // The entry's home time on its own day, on the trip's clock.
  const entryOnTripClock = minutes(entryTime) + aheadHours * 60 + dayDistance * 24 * 60;
  return Math.abs(minutes(lineTime) - entryOnTripClock) <= 30;
}

function isValidIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate: string, days: number) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

// Calendar days from `from` to `to` (positive when `to` is later).
export function daysBetweenIso(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
