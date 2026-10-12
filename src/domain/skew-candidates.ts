// Skew candidates (DOMAIN.md "Skew Candidate"): ledger entries that are most
// likely money moving inside the household, yet still counted as spending or
// income, so a month's figures are wrong until someone links them.
//
// Two kinds, found deterministically (no AI, no writes):
// - settlement: an unlinked outflow from the payer's own account and/or an
//   unlinked inflow into the payee's own account for exactly the amount of an
//   open simplified settlement checkpoint (or an open split group balance),
//   dated close to it
// - own_transfer: an unlinked outflow and inflow of the same amount between
//   two accounts of the same person, a few days apart
//
// Which entries pair, the windows and the order are the internal-move rules
// (internal-moves.ts), the same ones Money insights reads for a settlement's
// payment candidate and for own-account transfers counted as income, so
// Ask's check and Money insights name the same entries. Amounts match
// exactly (as linkTransferPair requires), there is no minimum amount, and an
// entry already linked as a transfer, to a split, a settle-up or a
// checkpoint never takes part. Each candidate names the existing write
// routes that resolve it; this module only reads.

import { diffDays, getMonthBounds } from "./app-repository-helpers";
import { incomeMinor, spendingMinor } from "./category-offset";
import {
  GROUP_BALANCE_PAYMENT_DAYS,
  groupBalancePaymentWindow,
  moveSideOf,
  openCheckpointSource,
  OWN_MOVE_WINDOW_DAYS,
  pairOwnAccountMoves,
  pickSettlementPayment,
  SETTLEMENT_PAYMENT_DAYS_AFTER,
  SETTLEMENT_PAYMENT_DAYS_BEFORE,
  type MoveSide,
  type SettlementPaymentSource
} from "./internal-moves";
import { personEntryAmountMinor } from "./person-entry-amount";
import { truncateReviewDescription } from "./review-description";
import { normalizeSplitCurrency } from "./split-currency";
import type {
  AccountDto,
  EntryDto,
  PersonDto,
  PersonScope,
  SkewCandidateActionDto,
  SkewCandidateDto,
  SkewCandidateEntryDto,
  SkewCandidateReasonDto,
  SplitSettlementCheckpointDto
} from "../types/dto";

// How far outside the month the loader reads entries so a counterpart dated
// just before or after the month is still seen (the two sides of a
// checkpoint payment can be its whole window apart).
export const SKEW_ENTRY_PADDING_DAYS = Math.max(
  SETTLEMENT_PAYMENT_DAYS_BEFORE + SETTLEMENT_PAYMENT_DAYS_AFTER,
  GROUP_BALANCE_PAYMENT_DAYS,
  OWN_MOVE_WINDOW_DAYS
);
// Bounds the response; totals still cover every candidate.
export const MAX_SKEW_CANDIDATES = 50;

const DESCRIPTION_MAX_LENGTH = 240;
const MIN_NAME_LENGTH = 3;
const NON_GROUP_ID = "split-group-none";

export type SkewAccount = Pick<AccountDto, "id" | "name" | "ownerPersonId" | "isJoint" | "currency">;

// An open split group balance, as one person pays the other.
export interface SkewGroupBalance {
  groupId: string;
  groupName: string;
  currency: string;
  amountMinor: number;
  fromPersonId: string;
  toPersonId: string;
  lastActivityDate: string;
}

export interface SkewCandidateInput {
  month: string;
  viewId: string;
  scope: PersonScope;
  // The month's entries plus a few days either side, so a pair across the
  // month end is still seen. Not adjusted for a view.
  entries: EntryDto[];
  // Entries in a transfer group whose counterpart is outside `entries`, or
  // linked to a split settle-up: already linked, so never a candidate.
  alreadyLinkedEntryIds?: readonly string[];
  accounts: SkewAccount[];
  people: PersonDto[];
  settlementCheckpoints: SplitSettlementCheckpointDto[];
  groupBalances: SkewGroupBalance[];
  // One-sided settlements whose description names nobody are `medium` and
  // too weak to show by default; a review screen may ask for them. They are
  // still found first either way, so an entry is paired the same with or
  // without them.
  includeMedium?: boolean;
}

export interface SkewCandidatesResult {
  candidates: SkewCandidateDto[];
  totals: { spendingMinor: number; incomeMinor: number };
  omittedCandidateCount: number;
}

// One unlinked entry on a personally owned account (internal-moves.ts),
// with the entry it came from.
interface Side extends MoveSide {
  entry: EntryDto;
}

interface SettlementSource extends SettlementPaymentSource {
  settlement: NonNullable<SkewCandidateDto["settlement"]>;
}

export function findSkewCandidates(input: SkewCandidateInput): SkewCandidatesResult {
  const [monthStart, nextMonth] = getMonthBounds(input.month);
  const isInMonth = (date: string) => date >= monthStart && date < nextMonth;
  const personById = new Map(input.people.map((person) => [person.id, person]));
  const sides = collectSides(input);
  const used = new Set<string>();
  const found: SkewCandidateDto[] = [];

  for (const source of collectSettlementSources(input)) {
    const fromPerson = personById.get(source.fromPersonId);
    const toPerson = personById.get(source.toPersonId);
    if (!fromPerson || !toPerson) {
      continue;
    }
    const { outflow, inflow } = pickSettlementPayment(source, sides, used);
    if (!outflow && !inflow) {
      continue;
    }
    for (const side of [outflow, inflow]) {
      if (side) used.add(side.id);
    }
    found.push(buildSettlementCandidate(source, fromPerson, toPerson, outflow, inflow, isInMonth));
  }

  for (const pair of pairOwnAccountMoves(sides, used)) {
    const owner = personById.get(pair.outflow.ownerPersonId);
    if (owner) {
      found.push(buildOwnTransferCandidate(owner, pair.outflow, pair.inflow, pair.ambiguous, isInMonth));
    }
  }

  // The view decides how much each candidate skews: the household counts
  // every entry in full, a person view only that person's entries in scope
  // (the same rule as Summary and Month). A candidate that skews nothing in
  // this view and month is left out.
  const entryById = new Map(input.entries.map((entry) => [entry.id, entry]));
  const visible = found
    .filter((candidate) => input.includeMedium || !isHiddenByDefault(candidate))
    .map((candidate) => ({ ...candidate, skew: skewForView(candidate, entryById, input) }))
    .filter((candidate) => candidate.skew.spendingMinor !== 0 || candidate.skew.incomeMinor !== 0)
    .sort(compareCandidates);

  return {
    candidates: visible.slice(0, MAX_SKEW_CANDIDATES),
    totals: visible.reduce(
      (totals, candidate) => ({
        spendingMinor: totals.spendingMinor + candidate.skew.spendingMinor,
        incomeMinor: totals.incomeMinor + candidate.skew.incomeMinor
      }),
      { spendingMinor: 0, incomeMinor: 0 }
    ),
    omittedCandidateCount: Math.max(0, visible.length - MAX_SKEW_CANDIDATES)
  };
}

// A settlement candidate is medium only when one side of a group balance
// was found and its description names nobody.
function isHiddenByDefault(candidate: SkewCandidateDto) {
  return candidate.kind === "settlement" && candidate.confidence === "medium";
}

// Open group balances from the Splits projection seen by one person
// (buildSplitsPage with that person's view): a positive balance means the
// other person owes the viewer. The last open activity date anchors the
// payment window.
export function deriveSkewGroupBalances(input: {
  groups: Array<{ id: string; name: string; balanceMinor: number; currency: string }>;
  activity: Array<{ groupId: string; date: string; settlementStatus?: string }>;
  viewerPersonId: string;
  otherPersonId: string;
}): SkewGroupBalance[] {
  const lastOpenDateByGroup = new Map<string, string>();
  for (const item of input.activity) {
    if (item.settlementStatus !== "open") continue;
    const current = lastOpenDateByGroup.get(item.groupId);
    if (!current || item.date > current) lastOpenDateByGroup.set(item.groupId, item.date);
  }

  return input.groups.flatMap((group) => {
    const lastActivityDate = lastOpenDateByGroup.get(group.id);
    if (group.balanceMinor === 0 || !lastActivityDate) {
      return [];
    }
    const otherOwesViewer = group.balanceMinor > 0;
    return [{
      groupId: group.id,
      groupName: group.name,
      currency: normalizeSplitCurrency(group.currency),
      amountMinor: Math.abs(group.balanceMinor),
      fromPersonId: otherOwesViewer ? input.otherPersonId : input.viewerPersonId,
      toPersonId: otherOwesViewer ? input.viewerPersonId : input.otherPersonId,
      lastActivityDate
    }];
  });
}

function collectSides(input: SkewCandidateInput): Side[] {
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const linked = new Set(input.alreadyLinkedEntryIds ?? []);
  for (const checkpoint of input.settlementCheckpoints) {
    if (checkpoint.matchedTransactionId) linked.add(checkpoint.matchedTransactionId);
    for (const transfer of checkpoint.matchedTransfers ?? []) linked.add(transfer.transactionId);
  }

  return input.entries.flatMap((entry) => {
    const side = moveSideOf({
      id: entry.id,
      accountId: entry.accountId,
      date: entry.date,
      amountMinor: entry.amountMinor,
      entryType: entry.entryType,
      transferDirection: entry.transferDirection,
      linked: Boolean(entry.linkedTransfer || entry.linkedSplitExpenseId || linked.has(entry.id))
    }, entry.accountId ? accountById.get(entry.accountId) : undefined);
    return side ? [{ ...side, entry }] : [];
  });
}

// Checkpoints first (a simplified settlement is the more specific evidence),
// then group balances, each in a stable order.
function collectSettlementSources(input: SkewCandidateInput): SettlementSource[] {
  const checkpoints = [...input.settlementCheckpoints]
    .sort((left, right) => left.settlementDate.localeCompare(right.settlementDate) || left.id.localeCompare(right.id))
    .flatMap((checkpoint): SettlementSource[] => {
      const source = openCheckpointSource(checkpoint);
      return source
        ? [{ ...source, settlement: { source: "settlement_checkpoint", checkpointId: checkpoint.id, anchorDate: checkpoint.settlementDate } }]
        : [];
    });

  const groups = [...input.groupBalances]
    .filter((balance) => balance.amountMinor > 0)
    .sort((left, right) => left.groupId.localeCompare(right.groupId))
    .map((balance): SettlementSource => ({
      amountMinor: balance.amountMinor,
      currency: normalizeSplitCurrency(balance.currency),
      fromPersonId: balance.fromPersonId,
      toPersonId: balance.toPersonId,
      anchorDate: balance.lastActivityDate,
      inWindow: groupBalancePaymentWindow(balance.lastActivityDate),
      settlement: { source: "group_balance", groupId: balance.groupId, groupName: balance.groupName, anchorDate: balance.lastActivityDate }
    }));

  return [...checkpoints, ...groups];
}

function buildSettlementCandidate(
  source: SettlementSource,
  fromPerson: PersonDto,
  toPerson: PersonDto,
  outflow: Side | undefined,
  inflow: Side | undefined,
  isInMonth: (date: string) => boolean
): SkewCandidateDto {
  const present = [outflow, inflow].filter((side): side is Side => Boolean(side));
  const reasons: SkewCandidateReasonDto[] = [{ code: "same_amount", amountMinor: source.amountMinor }];
  for (const side of present) {
    reasons.push({ code: "days_from_settlement", entryId: side.entry.id, days: diffDays(side.entry.date, source.anchorDate) });
  }
  if (outflow) {
    reasons.push({ code: "payer_account", entryId: outflow.entry.id, personId: fromPerson.id, personName: fromPerson.name, accountName: outflow.entry.accountName });
  }
  if (inflow) {
    reasons.push({ code: "payee_account", entryId: inflow.entry.id, personId: toPerson.id, personName: toPerson.name, accountName: inflow.entry.accountName });
  }
  const named: SkewCandidateReasonDto[] = [];
  if (outflow && descriptionNames(outflow.entry.description, toPerson.name)) {
    named.push({ code: "counterparty_named", entryId: outflow.entry.id, personName: toPerson.name });
  }
  if (inflow && descriptionNames(inflow.entry.description, fromPerson.name)) {
    named.push({ code: "counterparty_named", entryId: inflow.entry.id, personName: fromPerson.name });
  }
  reasons.push(...named, ...present.flatMap(countedReasons));

  const actions: SkewCandidateActionDto[] = [];
  if (outflow && inflow) {
    actions.push(linkTransferAction(outflow, inflow));
  } else if (present[0].entry.entryType !== "transfer") {
    actions.push({
      action: "reclassify_as_transfer",
      method: "POST",
      path: "/api/entries/update-classification",
      body: { entryId: present[0].entry.id, entryType: "transfer", transferDirection: present[0].direction, categoryName: "Transfer" }
    });
  }
  // The checkpoint match and the settle-up link both need the payer's side
  // when there is one (it is the transfer out of the payer's account).
  const evidence = outflow ?? inflow as Side;
  if (source.settlement.source === "settlement_checkpoint") {
    actions.push({
      action: "match_settlement_checkpoint",
      method: "POST",
      path: "/api/splits/checkpoints/match",
      body: { checkpointId: source.settlement.checkpointId, transactionId: evidence.entry.id }
    });
  } else {
    actions.push({
      action: "record_group_settle_up",
      method: "POST",
      path: "/api/splits/settlements/create",
      body: {
        groupId: source.settlement.groupId === NON_GROUP_ID ? null : source.settlement.groupId,
        date: evidence.entry.date,
        fromPersonName: fromPerson.name,
        toPersonName: toPerson.name,
        amountMinor: source.amountMinor,
        currency: source.currency,
        paymentMethod: "bank",
        paymentStatus: "recorded"
      },
      linkTransactionId: evidence.entry.id
    });
  }

  const sourceKey = source.settlement.source === "settlement_checkpoint" ? source.settlement.checkpointId : source.settlement.groupId;
  return {
    id: `settlement:${sourceKey}:${outflow?.entry.id ?? "-"}:${inflow?.entry.id ?? "-"}`,
    kind: "settlement",
    // A checkpoint's exact remaining amount in its window is what Money
    // insights offers as the settlement's payment (internal-moves.ts), so it
    // is always high; a group balance needs both sides or a name.
    confidence: source.settlement.source === "settlement_checkpoint" || present.length === 2 || named.length > 0 ? "high" : "medium",
    amountMinor: source.amountMinor,
    currency: source.currency,
    fromPerson: { id: fromPerson.id, name: fromPerson.name },
    toPerson: { id: toPerson.id, name: toPerson.name },
    settlement: source.settlement,
    bothSidesFound: present.length === 2,
    entryIds: present.map((side) => side.entry.id),
    ...(outflow ? { outflowEntry: snapshot(outflow, isInMonth) } : {}),
    ...(inflow ? { inflowEntry: snapshot(inflow, isInMonth) } : {}),
    reasons,
    skew: { spendingMinor: 0, incomeMinor: 0 },
    suggestedActions: actions
  };
}

function buildOwnTransferCandidate(
  owner: PersonDto,
  outflow: Side,
  inflow: Side,
  ambiguous: boolean,
  isInMonth: (date: string) => boolean
): SkewCandidateDto {
  return {
    id: `own_transfer:${outflow.entry.id}:${inflow.entry.id}`,
    kind: "own_transfer",
    confidence: ambiguous ? "medium" : "high",
    amountMinor: outflow.entry.amountMinor,
    currency: outflow.currency,
    fromPerson: { id: owner.id, name: owner.name },
    toPerson: { id: owner.id, name: owner.name },
    bothSidesFound: true,
    entryIds: [outflow.entry.id, inflow.entry.id],
    outflowEntry: snapshot(outflow, isInMonth),
    inflowEntry: snapshot(inflow, isInMonth),
    reasons: [
      { code: "same_amount", amountMinor: outflow.entry.amountMinor },
      { code: "days_apart", days: diffDays(outflow.entry.date, inflow.entry.date) },
      { code: "same_owner", personId: owner.id, personName: owner.name, fromAccountName: outflow.entry.accountName, toAccountName: inflow.entry.accountName },
      ...countedReasons(outflow),
      ...countedReasons(inflow)
    ],
    skew: { spendingMinor: 0, incomeMinor: 0 },
    suggestedActions: [linkTransferAction(outflow, inflow)]
  };
}

function linkTransferAction(outflow: Side, inflow: Side): SkewCandidateActionDto {
  return { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: outflow.entry.id, toEntryId: inflow.entry.id } };
}

// How the household totals count the entry now (category-offset.ts).
function countedReasons(side: Side): SkewCandidateReasonDto[] {
  const spending = spendingMinor(side.entry);
  const income = incomeMinor(side.entry);
  const base = { entryId: side.entry.id, categoryName: side.entry.categoryName };
  if (spending > 0) return [{ code: "counted_as_spending", ...base }];
  if (spending < 0) return [{ code: "counted_as_payback", ...base }];
  if (income > 0) return [{ code: "counted_as_income", ...base }];
  return [];
}

function skewForView(candidate: SkewCandidateDto, entryById: Map<string, EntryDto>, input: SkewCandidateInput) {
  let spending = 0;
  let income = 0;
  for (const side of [candidate.outflowEntry, candidate.inflowEntry]) {
    const entry = side?.inMonth ? entryById.get(side.id) : undefined;
    if (!entry) continue;
    const amountMinor = input.viewId === "household" ? entry.amountMinor : personEntryAmountMinor(entry, input.viewId, input.scope);
    if (amountMinor === null) continue;
    spending += spendingMinor(entry, amountMinor);
    income += incomeMinor(entry, amountMinor);
  }
  return { spendingMinor: spending, incomeMinor: income };
}

function snapshot(side: Side, isInMonth: (date: string) => boolean): SkewCandidateEntryDto {
  const { entry } = side;
  return {
    id: entry.id,
    date: entry.date,
    description: truncateReviewDescription(entry.description, DESCRIPTION_MAX_LENGTH),
    accountId: entry.accountId as string,
    accountName: entry.accountName,
    ownerPersonId: side.ownerPersonId,
    entryType: entry.entryType,
    ...(entry.transferDirection ? { transferDirection: entry.transferDirection } : {}),
    categoryName: entry.categoryName,
    amountMinor: entry.amountMinor,
    inMonth: isInMonth(entry.date)
  };
}



// The other person's name as a whole word ("PAYNOW TO SERENE" names Serene).
function descriptionNames(description: string, personName: string) {
  const name = personName.trim();
  if (name.length < MIN_NAME_LENGTH) {
    return false;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(description);
}

function compareCandidates(left: SkewCandidateDto, right: SkewCandidateDto) {
  const weight = (candidate: SkewCandidateDto) => Math.abs(candidate.skew.spendingMinor) + Math.abs(candidate.skew.incomeMinor);
  const firstDate = (candidate: SkewCandidateDto) => [candidate.outflowEntry?.date, candidate.inflowEntry?.date]
    .filter((date): date is string => Boolean(date)).sort()[0] ?? "";
  return weight(right) - weight(left)
    || firstDate(left).localeCompare(firstDate(right))
    || left.id.localeCompare(right.id);
}
