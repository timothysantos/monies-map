// Internal moves (DOMAIN.md "Internal Move"): the one place that decides
// which unlinked ledger entries are money moving inside the household, so
// every reader gives the same answer for the same entries:
//
// - a settlement payment: what one person pays the other for an open
//   settlement checkpoint (or an open split group balance);
// - an own-account move: money leaving one of a person's accounts and
//   arriving in another of theirs.
//
// Read by the skew candidates (Ask's "Check this first", skew-candidates.ts)
// and by the Money insights facts: a checkpoint's `paymentCandidate`
// (app-repository-splits.ts) and the own-account transfers counted as
// income on the account pills (account-routines.ts). Each caller loads its
// own entries and turns them into `MoveSide`s with `moveSideOf`; the rules,
// windows and pairing order live only here. Pure, no AI, no writes.

import { normalizeSplitCurrency } from "./split-currency";

// A settlement is usually paid within days of being worked out, and is
// sometimes worked out just after it was paid.
export const SETTLEMENT_PAYMENT_DAYS_BEFORE = 5;
export const SETTLEMENT_PAYMENT_DAYS_AFTER = 14;
// A group balance has no settlement date: the payment comes on or after the
// group's last open activity, within this many days of it.
export const GROUP_BALANCE_PAYMENT_DAYS = 14;
export const OWN_MOVE_WINDOW_DAYS = 3;

// One unlinked entry on an account owned by one person.
export interface MoveSide {
  id: string;
  accountId: string;
  ownerPersonId: string;
  currency: string;
  date: string;
  amountMinor: number;
  direction: "out" | "in";
}

export interface MoveEntryFacts {
  id: string;
  accountId?: string | null;
  date: string;
  amountMinor: number;
  entryType: string;
  transferDirection?: string | null;
  // In a transfer group, linked to a split expense or settle-up, or matched
  // to a settlement checkpoint.
  linked: boolean;
}

export interface MoveAccountFacts {
  ownerPersonId?: string | null;
  isJoint?: boolean | number | null;
  currency?: string | null;
}

// The side an entry can take, or null when it takes no part: a joint or
// unowned account, an entry already linked, or nothing that moved money.
export function moveSideOf(entry: MoveEntryFacts, account: MoveAccountFacts | undefined): MoveSide | null {
  const direction = entry.entryType === "expense"
    ? "out"
    : entry.entryType === "income"
      ? "in"
      : entry.entryType === "transfer" && (entry.transferDirection === "out" || entry.transferDirection === "in")
        ? entry.transferDirection
        : null;
  if (!account || !entry.accountId || account.isJoint || !account.ownerPersonId || !direction || entry.amountMinor <= 0 || entry.linked) {
    return null;
  }
  return {
    id: entry.id,
    accountId: entry.accountId,
    ownerPersonId: account.ownerPersonId,
    currency: normalizeSplitCurrency(account.currency ?? undefined),
    date: entry.date,
    amountMinor: entry.amountMinor,
    direction
  };
}

export function settlementPaymentWindow(settlementDate: string) {
  return (date: string) => {
    const days = signedDays(settlementDate, date);
    return days >= -SETTLEMENT_PAYMENT_DAYS_BEFORE && days <= SETTLEMENT_PAYMENT_DAYS_AFTER;
  };
}

export function groupBalancePaymentWindow(lastActivityDate: string) {
  return (date: string) => {
    const days = signedDays(lastActivityDate, date);
    return days >= 0 && days <= GROUP_BALANCE_PAYMENT_DAYS;
  };
}

export interface SettlementPaymentSource {
  amountMinor: number;
  currency: string;
  fromPersonId: string;
  toPersonId: string;
  anchorDate: string;
  inWindow: (date: string) => boolean;
}

// The payer's outflow and the payee's inflow for exactly the amount, each
// the nearest to the anchor date (then by id), skipping sides already used.
export function pickSettlementPayment<S extends MoveSide>(source: SettlementPaymentSource, sides: readonly S[], used: ReadonlySet<string> = new Set()) {
  const currency = normalizeSplitCurrency(source.currency);
  const fits = (side: S, direction: MoveSide["direction"], ownerPersonId: string) => side.direction === direction
    && side.ownerPersonId === ownerPersonId
    && side.amountMinor === source.amountMinor
    && side.currency === currency
    && !used.has(side.id)
    && source.inWindow(side.date);
  return {
    outflow: closestTo(source.anchorDate, sides.filter((side) => fits(side, "out", source.fromPersonId))),
    inflow: closestTo(source.anchorDate, sides.filter((side) => fits(side, "in", source.toPersonId)))
  };
}

export interface SettlementCheckpointFacts {
  status: string;
  amountMinor: number;
  matchedAmountMinor?: number;
  currency: string;
  settlementDate: string;
  fromPersonId?: string;
  toPersonId?: string;
}

const OPEN_CHECKPOINT_STATUSES = new Set(["open", "partially_matched"]);

// What an open checkpoint still needs paid, and when, or null when it needs
// nothing (matched, reopened, offset, or no payer and payee).
export function openCheckpointSource(checkpoint: SettlementCheckpointFacts): SettlementPaymentSource | null {
  const remainingMinor = checkpoint.amountMinor - (checkpoint.matchedAmountMinor ?? 0);
  if (!OPEN_CHECKPOINT_STATUSES.has(checkpoint.status) || remainingMinor <= 0 || !checkpoint.fromPersonId || !checkpoint.toPersonId) {
    return null;
  }
  return {
    amountMinor: remainingMinor,
    currency: normalizeSplitCurrency(checkpoint.currency),
    fromPersonId: checkpoint.fromPersonId,
    toPersonId: checkpoint.toPersonId,
    anchorDate: checkpoint.settlementDate,
    inWindow: settlementPaymentWindow(checkpoint.settlementDate)
  };
}

// The settlement payment candidate on a checkpoint (the Splits check-in's
// To do): the payment `pickSettlementPayment` finds for what it still
// needs, the payer's entry first. `countedAsSpending` says whether either
// side still counts as spending or income (not yet refiled as a transfer).
export function settlementPaymentCandidate<S extends MoveSide & { entryType: string }>(checkpoint: SettlementCheckpointFacts, sides: readonly S[]) {
  const source = openCheckpointSource(checkpoint);
  if (!source) {
    return undefined;
  }
  const { outflow, inflow } = pickSettlementPayment(source, sides);
  const first = outflow ?? inflow;
  if (!first) {
    return undefined;
  }
  return {
    date: first.date,
    amountMinor: source.amountMinor,
    entryIds: [outflow?.id, inflow?.id].filter((id): id is string => Boolean(id)),
    countedAsSpending: outflow?.entryType === "expense" || inflow?.entryType === "income"
  };
}

export interface OwnMovePair<S extends MoveSide> {
  outflow: S;
  inflow: S;
  // Two receiving entries were equally close: the pair is a guess.
  ambiguous: boolean;
}

// Own-account moves: each unlinked outflow (oldest first, then by id) with
// the nearest unlinked inflow of the same amount and currency into another
// account of the same person, at most 3 days apart. Each side is in at most
// one pair, so the same entries always pair the same way.
export function pairOwnAccountMoves<S extends MoveSide>(sides: readonly S[], used: ReadonlySet<string> = new Set()): OwnMovePair<S>[] {
  const taken = new Set(used);
  const inflowsByAmount = new Map<number, S[]>();
  for (const side of sides) {
    if (side.direction === "in") {
      inflowsByAmount.set(side.amountMinor, [...(inflowsByAmount.get(side.amountMinor) ?? []), side]);
    }
  }
  const outflows = sides
    .filter((side) => side.direction === "out")
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  const pairs: OwnMovePair<S>[] = [];
  for (const outflow of outflows) {
    if (taken.has(outflow.id)) {
      continue;
    }
    const inflows = (inflowsByAmount.get(outflow.amountMinor) ?? []).filter((side) => !taken.has(side.id)
      && side.ownerPersonId === outflow.ownerPersonId
      && side.accountId !== outflow.accountId
      && side.currency === outflow.currency
      && Math.abs(signedDays(outflow.date, side.date)) <= OWN_MOVE_WINDOW_DAYS);
    const inflow = closestTo(outflow.date, inflows);
    if (!inflow) {
      continue;
    }
    const gap = Math.abs(signedDays(outflow.date, inflow.date));
    taken.add(outflow.id);
    taken.add(inflow.id);
    pairs.push({ outflow, inflow, ambiguous: inflows.filter((side) => Math.abs(signedDays(outflow.date, side.date)) === gap).length > 1 });
  }
  return pairs;
}

// The nearest by date, then by id.
function closestTo<S extends MoveSide>(anchorDate: string, sides: S[]): S | undefined {
  return [...sides].sort((left, right) => Math.abs(signedDays(anchorDate, left.date)) - Math.abs(signedDays(anchorDate, right.date))
    || left.id.localeCompare(right.id))[0];
}

// Days from `from` to `to` (negative when `to` is earlier).
function signedDays(from: string, to: string) {
  const left = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const right = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.round((right - left) / 86_400_000) : Number.POSITIVE_INFINITY;
}
