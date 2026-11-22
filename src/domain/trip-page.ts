// The trip page (DOMAIN.md "Trip or Event", "Trip page"): one trip or event
// on a page of its own, what it cost the household. Its figures come from
// `tripPageFigures` (money-figures.ts); the rules here are the page's other
// readings, pure so they are tested without a database:
// - an entry's readable name: the first line of its note when it has one
//   (the owner writes "what and where" there), else its description;
// - a foreign currency estimate (DOMAIN.md "Foreign Currency Estimate"): a
//   Wallet amount kept in another currency on an entry no statement has
//   confirmed yet;
// - what is still owed between people for the trip's own entries on Splits:
//   each split not yet settled (its batch still open and no active
//   settle-up covering it), each person's share of an expense someone else
//   paid, in the ledger's money, netted between each two people.

import { daysBetween, normalizeDescriptionForMatch } from "./app-repository-helpers";
import { ESTIMATE_LOOK_AFTER_DAYS, NEEDS_LOOK_MAX_ITEMS, NO_AMOUNT_KEPT_DAYS, NO_AMOUNT_LOOK_AFTER_SECONDS } from "./trip-needs-look-config";
import { matchMerchants } from "./wrong-card-apple-pay-duplicate";

export const TRIP_PAGE_TOP_COUNT = 5;
// The first line of a note is at most this long on the page.
export const TRIP_PAGE_NAME_MAX = 80;

/** The first line of a note, trimmed and bounded; "" when there is none. */
export function noteFirstLine(note: string | null | undefined): string {
  const line = String(note ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > TRIP_PAGE_NAME_MAX ? `${line.slice(0, TRIP_PAGE_NAME_MAX - 1).trimEnd()}…` : line;
}

/** What the page calls an entry: its note's first line, else its description. */
export function tripEntryName(entry: { description: string; note?: string | null }): string {
  return noteFirstLine(entry.note) || entry.description.trim();
}

/** Whether an entry is still a foreign currency estimate. */
export function isOpenForeignEstimate(row: {
  original_amount_minor: number | null;
  original_currency: string | null;
  currency: string | null;
  bank_certification_status: string | null;
}): boolean {
  return row.original_amount_minor !== null
    && Boolean(row.original_currency)
    && row.original_currency !== (row.currency ?? "SGD")
    && row.bank_certification_status !== "statement_certified";
}

export interface TripOwedShare {
  transactionId: string;
  payerId: string;
  payerName: string;
  personId: string;
  personName: string;
  // The share in the ledger's money (buildLinkedSplitShareMap).
  amountMinor: number;
  settled: boolean;
}

export interface TripDebt {
  fromPersonId: string;
  fromName: string;
  toPersonId: string;
  toName: string;
  amountMinor: number;
}

/**
 * What is still owed between people for these shares: every share of an
 * open split that someone other than its payer carries is owed to the
 * payer; two people's debts to each other cancel. Largest first; nothing
 * owed is an empty list.
 */
export function tripStillOwed(shares: TripOwedShare[]): TripDebt[] {
  const names = new Map<string, string>();
  // pairKey "a|b" (a < b): what b owes a, less what a owes b.
  const net = new Map<string, number>();
  for (const share of shares) {
    names.set(share.payerId, share.payerName);
    names.set(share.personId, share.personName);
    if (share.settled || share.personId === share.payerId || share.amountMinor === 0) continue;
    const [low, high] = share.payerId < share.personId ? [share.payerId, share.personId] : [share.personId, share.payerId];
    const key = `${low}|${high}`;
    // The share's person owes its payer.
    const owedToLow = share.payerId === low ? share.amountMinor : -share.amountMinor;
    net.set(key, (net.get(key) ?? 0) + owedToLow);
  }
  const debts: TripDebt[] = [];
  for (const [key, amount] of net) {
    if (amount === 0) continue;
    const [low, high] = key.split("|");
    const [from, to] = amount > 0 ? [high, low] : [low, high];
    debts.push({ fromPersonId: from, fromName: names.get(from) ?? "", toPersonId: to, toName: names.get(to) ?? "", amountMinor: Math.abs(amount) });
  }
  return debts.sort((left, right) => right.amountMinor - left.amountMinor || left.fromName.localeCompare(right.fromName));
}

// ---- Needs a look (DOMAIN.md "Trip page", "needs a look") ------------------
//
// Only real doubts, each derived by a fixed rule (no AI), one line an entry:
// 1. `no_amount`: a waiting tap in the trip's dates the second-tap window
//    could not finish (and not yet put away);
// 2. `old_estimate`: a foreign currency estimate older than
//    ESTIMATE_LOOK_AFTER_DAYS that no statement has confirmed;
// 3. `shared_not_on_splits`: an expense nobody owns ("Shared" on the page)
//    from an account that is not a joint one, and not on Splits; and
//    `splits_no_group`: on Splits with no group when the trip follows one;
// 4. `other_category`: an expense left in Other (or with no category);
// 5. `maybe_copy`: two expenses on the same day for the same amount at a
//    similar shop, at least one of them not on a statement (two the bank
//    confirmed are two real purchases).
// The thresholds are in trip-needs-look-config.ts.

export type TripLookReason = "no_amount" | "maybe_copy" | "shared_not_on_splits" | "splits_no_group" | "old_estimate" | "other_category";

// One of the trip's expenses, as the projection reads it.
export interface TripLookEntry {
  id: string;
  date: string;
  description: string;
  // The readable name (tripEntryName).
  name: string;
  amountMinor: number;
  categoryName: string;
  certified: boolean;
  estimate: boolean;
  ownerId: string | null;
  jointAccount: boolean;
  onSplits: boolean;
  splitGroupId: string | null;
}

// A waiting tap in the trip's dates.
export interface TripLookTap {
  id: string;
  date: string;
  merchant: string;
  personName: string;
  receivedAt: string;
}

export interface TripLookItem {
  reason: TripLookReason;
  // The entry's id, or the waiting tap's for `no_amount`.
  id: string;
  date: string;
  name: string;
  // maybe_copy: the other entry.
  otherId?: string;
  otherName?: string;
  // old_estimate: how many days since it was paid.
  days?: number;
  // no_amount: whose tap it is.
  personName?: string;
}

// The order lines show in: a missing amount first, then the entries' own
// reasons, most likely wrong first.
const REASON_ORDER: TripLookReason[] = ["no_amount", "maybe_copy", "shared_not_on_splits", "splits_no_group", "old_estimate", "other_category"];

/** Two shop texts that name the same shop (wrong-card duplicate's own test, or the same words). */
export function isSimilarShop(left: string, right: string): boolean {
  const a = normalizeDescriptionForMatch(left);
  const b = normalizeDescriptionForMatch(right);
  return (Boolean(a) && a === b) || matchMerchants(left, right).strong;
}

function entryReason(entry: TripLookEntry, tripSplitGroupId: string | null, today: string): { reason: TripLookReason; days?: number } | null {
  if (entry.ownerId === null && !entry.jointAccount && !entry.onSplits) return { reason: "shared_not_on_splits" };
  if (entry.onSplits && !entry.splitGroupId && tripSplitGroupId) return { reason: "splits_no_group" };
  if (entry.estimate && !entry.certified) {
    const days = daysBetween(entry.date, today);
    if (days > ESTIMATE_LOOK_AFTER_DAYS) return { reason: "old_estimate", days };
  }
  if (entry.categoryName.trim().toLowerCase() === "other") return { reason: "other_category" };
  return null;
}

/** What on a trip needs the person: at most NEEDS_LOOK_MAX_ITEMS lines, one an entry or tap. */
export function tripNeedsLook(input: {
  entries: TripLookEntry[];
  taps: TripLookTap[];
  tripSplitGroupId: string | null;
  today: string;
  now: Date;
}): TripLookItem[] {
  const items: TripLookItem[] = [];
  const lookAfter = input.now.getTime() - NO_AMOUNT_LOOK_AFTER_SECONDS * 1000;
  const keptFrom = input.now.getTime() - NO_AMOUNT_KEPT_DAYS * 86_400_000;
  for (const tap of input.taps) {
    const received = Date.parse(tap.receivedAt);
    if (Number.isFinite(received) && received <= lookAfter && received >= keptFrom) {
      items.push({ reason: "no_amount", id: tap.id, date: tap.date, name: tap.merchant, personName: tap.personName });
    }
  }
  // Same day and amount at a similar shop: each entry joins one pair at most.
  const paired = new Set<string>();
  const sorted = [...input.entries].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index];
    if (paired.has(entry.id)) continue;
    const twin = sorted.slice(index + 1).find((other) => !paired.has(other.id)
      && other.date === entry.date
      && other.amountMinor === entry.amountMinor
      && !(other.certified && entry.certified)
      && isSimilarShop(entry.description, other.description));
    if (twin) {
      paired.add(entry.id);
      paired.add(twin.id);
      items.push({ reason: "maybe_copy", id: entry.id, date: entry.date, name: entry.name, otherId: twin.id, otherName: twin.name });
    }
  }
  for (const entry of sorted) {
    if (paired.has(entry.id)) continue;
    const found = entryReason(entry, input.tripSplitGroupId, input.today);
    if (found) items.push({ reason: found.reason, id: entry.id, date: entry.date, name: entry.name, ...(found.days !== undefined ? { days: found.days } : {}) });
  }
  return items
    .sort((left, right) => REASON_ORDER.indexOf(left.reason) - REASON_ORDER.indexOf(right.reason) || left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
    .slice(0, NEEDS_LOOK_MAX_ITEMS);
}
