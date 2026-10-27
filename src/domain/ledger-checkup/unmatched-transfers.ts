// Detector 3: transfers nobody has paired with their other side.
//
// A transfer moves money between two of the household's accounts, so each one
// should have a partner entry on the other account. The loader reads transfers
// older than a week that no transfer pair, settle-up or review dismissal
// holds, and the entries that could be their other side. Candidates come from
// the same ranking the Entries transfer dialog uses (`selectTransferCandidates`:
// same amount, another account, opposite direction first, closest date), kept
// to a week either side: banks post a transfer within days, and a monthly
// $450 has a lookalike every month, so a partner a month away is no partner.
//
// Only a plausible partner counts: an opposite-direction transfer, or the same
// money filed as an ordinary entry the right way round within a week (a
// transfer out with money in of the same amount, a transfer in with a purchase
// of the same amount). A purchase of a round amount next to a transfer out is a
// coincidence, so it is never a candidate.
//
// - `high`: exactly one plausible partner, and it is an opposite-direction
//   transfer (the pair is one finding, whichever side it is found from);
// - `check`: exactly one that is an ordinary entry, or several plausible
//   partners (up to three are named);
// - `note`: no plausible partner, one line per series (same account, direction
//   and amount) so fourteen monthly transfers are one line.
import { selectTransferCandidates } from "../transfer-candidates";
import { accountLabel, accountPeople, clip, daysBetween, entryLink, finding, money, shortDate, shortId } from "./helpers";
import type { CheckupContext, CheckupEvidence, DetectedFinding } from "./types";

export const UNMATCHED_TRANSFER_MIN_AGE_DAYS = 7;
export const PARTNER_WINDOW_DAYS = 7;
const SERIES_EVIDENCE_LINES = 5;

export interface TransferFact {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  direction: "in" | "out" | null;
  ownerPersonId: string | null;
}

export interface TransferCandidateFact extends TransferFact {
  entryType: "expense" | "income" | "transfer";
}

export interface UnmatchedTransferFacts {
  transfers: TransferFact[];
  candidates: TransferCandidateFact[];
}

function transferEvidence(entry: TransferFact | TransferCandidateFact, context: CheckupContext, note?: string): CheckupEvidence {
  return {
    role: "entry",
    label: clip(entry.description),
    shortId: shortId(entry.id),
    date: entry.date,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    accountName: accountLabel(context, entry.accountId),
    note
  };
}

function isPlausiblePartner(transfer: TransferFact, candidate: TransferCandidateFact) {
  if (!transfer.direction) {
    return false;
  }
  if (candidate.entryType === "transfer") {
    return Boolean(candidate.direction) && candidate.direction !== transfer.direction;
  }
  return transfer.direction === "out" ? candidate.entryType === "income" : candidate.entryType === "expense";
}

export function detectUnmatchedTransfers(facts: UnmatchedTransferFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const series = new Map<string, TransferFact[]>();
  for (const transfer of facts.transfers) {
    const account = context.accounts.get(transfer.accountId);
    if (!account || account.kind === "investment" || daysBetween(transfer.date, context.today) < UNMATCHED_TRANSFER_MIN_AGE_DAYS) {
      continue;
    }
    const pool = facts.candidates
      .filter((candidate) => candidate.currency === transfer.currency && Math.abs(daysBetween(transfer.date, candidate.date)) <= PARTNER_WINDOW_DAYS)
      .map((candidate) => ({ ...candidate, accountName: accountLabel(context, candidate.accountId), transferDirection: candidate.direction }));
    const candidates = selectTransferCandidates(
      { id: transfer.id, date: transfer.date, accountId: transfer.accountId, amountMinor: transfer.amountMinor, transferDirection: transfer.direction },
      pool,
      pool.length || 1
    ).filter((candidate) => isPlausiblePartner(transfer, candidate));
    const label = accountLabel(context, transfer.accountId);
    const amount = money(transfer.amountMinor, transfer.currency);
    const directionWord = transfer.direction === "in" ? "in to" : "out of";
    if (!candidates.length) {
      const key = `${transfer.accountId}:${transfer.direction ?? "none"}:${transfer.amountMinor}:${transfer.currency}`;
      series.set(key, [...(series.get(key) ?? []), transfer]);
      continue;
    }
    const [best] = candidates;
    const isSure = candidates.length === 1 && best.entryType === "transfer";
    const other = accountLabel(context, best.accountId);
    // A pair is one finding whichever side it is found from (both sides are
    // unmatched transfers): the runner keeps the first of two with one id.
    const [sender, receiver] = transfer.direction === "in" && best.entryType === "transfer" ? [best, transfer] : [transfer, best];
    findings.push(finding({
      kind: "unmatched_transfer",
      subject: candidates.length === 1 ? [transfer.id, best.id].sort().join("+") : transfer.id,
      tier: isSure ? "high" : "check",
      title: isSure ? "Two sides of one transfer are not linked" : candidates.length === 1 ? "A transfer may match another entry" : "A transfer may match one of several entries",
      summary: isSure
        ? `${amount} left ${accountLabel(context, sender.accountId)} on ${shortDate(sender.date, context.today)} and ${amount} arrived in ${accountLabel(context, receiver.accountId)} on ${shortDate(receiver.date, context.today)}. It is the same money moving, but the two are not linked, so each is counted on its own.`
        : candidates.length === 1
          ? `The ${amount} transfer ${directionWord} ${label} on ${shortDate(transfer.date, context.today)} may be the same money as ${best.entryType === "transfer" ? "a transfer" : best.entryType === "income" ? "money in" : "a purchase"} of ${amount} on ${other}, ${shortDate(best.date, context.today)}. They are not linked.`
          : `The ${amount} transfer ${directionWord} ${label} on ${shortDate(transfer.date, context.today)} could be the other side of ${candidates.length} entries of the same amount on other accounts. Pick the right one.`,
      evidence: isSure
        ? [transferEvidence(sender, context, "money out"), transferEvidence(receiver, context, "money in")]
        : [
          transferEvidence(transfer, context, "the transfer with no partner"),
          ...candidates.slice(0, 3).map((candidate) => transferEvidence(candidate, context, `could be the other side (${candidate.entryType === "transfer" ? "a transfer" : candidate.entryType === "income" ? "money in" : "a purchase"}, ${Math.abs(daysBetween(transfer.date, candidate.date))} days apart)`))
        ],
      // Money moving between two of the household's own accounts misstates no
      // total, so these findings carry no money at stake and sort behind ones that do.
      amountMinor: null,
      currency: transfer.currency,
      occurredOn: transfer.date,
      personIds: [...accountPeople(account), ...accountPeople(context.accounts.get(best.accountId))],
      fix: entryLink(transfer.id, transfer.date, "Open the transfer and link them"),
      facts: candidates.length === 1 ? [[transfer.id, best.id].sort().join("+"), transfer.amountMinor] : [transfer.id, transfer.amountMinor, transfer.date, ...candidates.slice(0, 3).map((candidate) => candidate.id)]
    }));
  }

  for (const [key, transfers] of series) {
    const sorted = [...transfers].sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
    const first = sorted[0];
    const label = accountLabel(context, first.accountId);
    const amount = money(first.amountMinor, first.currency);
    const directionWord = first.direction === "in" ? "in to" : "out of";
    const many = sorted.length > 1;
    findings.push(finding({
      kind: "unmatched_transfer",
      subject: `series:${key}`,
      tier: "note",
      title: many ? "Transfers with no matching entry" : "A transfer with no matching entry",
      summary: many
        ? `${sorted.length} transfers of ${amount} ${directionWord} ${label}, the latest on ${shortDate(first.date, context.today)}, have no matching entry on another account, so the other side has not been recorded.`
        : `The ${amount} transfer ${directionWord} ${label} on ${shortDate(first.date, context.today)} has no matching entry on another account, so the other side has not been recorded.`,
      evidence: [
        ...sorted.slice(0, SERIES_EVIDENCE_LINES).map((transfer) => transferEvidence(transfer, context)),
        ...(sorted.length > SERIES_EVIDENCE_LINES ? [{ role: "fact" as const, label: `and ${sorted.length - SERIES_EVIDENCE_LINES} more like it` }] : [])
      ],
      amountMinor: sorted.reduce((sum, transfer) => sum + transfer.amountMinor, 0),
      currency: first.currency,
      occurredOn: first.date,
      personIds: accountPeople(context.accounts.get(first.accountId)),
      fix: entryLink(first.id, first.date, "Open the latest one"),
      facts: sorted.map((transfer) => transfer.id)
    }));
  }
  return findings;
}
