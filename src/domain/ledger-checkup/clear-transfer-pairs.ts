// Clear transfer pairs: the unlinked pairs of transfers that can be linked
// with no doubt at all, for "Link these N clear pairs" on Check my books
// (DOMAIN.md "Ledger Check-up", docs/audits/ledger-checkup.md "Clear pairs").
//
// A pair is clear only when every one of these holds:
// - both sides are unlinked transfers the check-up's own read weighed (so
//   neither is held by a settle-up, dismissed in the transfer review, still
//   under a week old, or past that read's limit), on known accounts that are
//   not investment accounts;
// - one is money out and the other money in, on different accounts, for the
//   same amount to the cent in the same currency, at most a week apart (the
//   window the check-up's own "two sides of one transfer" finding uses);
// - each side has exactly one possible match on another account, and it is
//   the other side. "Possible match" is stricter than the check-up's: any
//   unlinked entry of the same amount and currency within a week on another
//   account counts, whatever its type, so a lookalike never has to be argued
//   away. Two consecutive months of one monthly transfer are therefore not
//   rivals (a month apart), but a same-amount entry a few days away keeps
//   both pairs out;
// - the finding for the pair is not marked "This is fine".
//
// Pure: facts in (the loader's own), pairs out, oldest first, which is the
// order they are linked and learn a transfer purpose in. Because the rule is
// stricter than the check-up's, every clear pair is also a HIGH finding.
import { selectTransferCandidates } from "../transfer-candidates";
import { accountPeople, daysBetween, hashFacts, uniqueIds } from "./helpers";
import type { CheckupContext } from "./types";
import { PARTNER_WINDOW_DAYS, UNMATCHED_TRANSFER_MIN_AGE_DAYS, type TransferFact, type UnmatchedTransferFacts } from "./unmatched-transfers";

// What one request may link: the API refuses more, the dialog links the first
// this many and says how many remain.
export const CLEAR_PAIR_REQUEST_CAP = 100;

export interface ClearTransferPair {
  fromEntryId: string;
  toEntryId: string;
  fromAccountId: string;
  toAccountId: string;
  // The sending side's date (the order key) and the receiving side's.
  date: string;
  toDate: string;
  amountMinor: number;
  currency: string;
  // The check-up finding the pair is part of: "This is fine" on it keeps the
  // pair out, and linking it makes the finding go away.
  findingId: string;
  personIds: string[];
}

export interface ClearTransferPairOptions {
  // Finding id -> the evidence key it was marked fine for.
  dismissals?: ReadonlyMap<string, string>;
  // Transfers whose possible matches the read may have cut short.
  unreliableTransferIds?: ReadonlySet<string>;
}

export function findClearTransferPairs(
  facts: UnmatchedTransferFacts,
  context: CheckupContext,
  options: ClearTransferPairOptions = {}
): ClearTransferPair[] {
  const unreliable = new Set([...(facts.unreliableIds ?? []), ...(options.unreliableTransferIds ?? [])]);
  const eligible = new Map<string, TransferFact>();
  for (const transfer of facts.transfers) {
    const account = context.accounts.get(transfer.accountId);
    if (
      account
      && account.kind !== "investment"
      && transfer.direction
      && transfer.amountMinor > 0
      && daysBetween(transfer.date, context.today) >= UNMATCHED_TRANSFER_MIN_AGE_DAYS
      && !unreliable.has(transfer.id)
    ) {
      eligible.set(transfer.id, transfer);
    }
  }

  // The single possible match of a transfer, or null (none, or several).
  const soleMatch = (transfer: TransferFact) => {
    const pool = facts.candidates
      .filter((candidate) => candidate.currency === transfer.currency && Math.abs(daysBetween(transfer.date, candidate.date)) <= PARTNER_WINDOW_DAYS)
      .map((candidate) => ({ ...candidate, accountName: "", transferDirection: candidate.direction }));
    const matches = selectTransferCandidates(
      { id: transfer.id, date: transfer.date, accountId: transfer.accountId, amountMinor: transfer.amountMinor, transferDirection: transfer.direction },
      pool,
      pool.length || 1
    );
    const [only] = matches;
    return matches.length === 1 && only.entryType === "transfer" && only.direction && only.direction !== transfer.direction ? only.id : null;
  };

  const pairs: ClearTransferPair[] = [];
  for (const sender of eligible.values()) {
    if (sender.direction !== "out") {
      continue;
    }
    const receiverId = soleMatch(sender);
    const receiver = receiverId ? eligible.get(receiverId) : undefined;
    if (!receiver || receiver.direction !== "in" || soleMatch(receiver) !== sender.id) {
      continue;
    }
    const pairKey = [sender.id, receiver.id].sort().join("+");
    const findingId = `unmatched_transfer:${pairKey}`;
    // The finding's evidence key (the detector's tier and facts), so a dismissal
    // made for other evidence does not hide the pair.
    if (options.dismissals?.get(findingId) === hashFacts(["high", pairKey, sender.amountMinor])) {
      continue;
    }
    pairs.push({
      fromEntryId: sender.id,
      toEntryId: receiver.id,
      fromAccountId: sender.accountId,
      toAccountId: receiver.accountId,
      date: sender.date,
      toDate: receiver.date,
      amountMinor: sender.amountMinor,
      currency: sender.currency,
      findingId,
      personIds: uniqueIds([...accountPeople(context.accounts.get(sender.accountId)), ...accountPeople(context.accounts.get(receiver.accountId))])
    });
  }
  return pairs.sort((left, right) => left.date.localeCompare(right.date) || left.fromEntryId.localeCompare(right.fromEntryId));
}
