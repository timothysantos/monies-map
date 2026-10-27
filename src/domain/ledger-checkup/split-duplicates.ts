// Detectors 2a and 8: the same shared cost or payment recorded twice in Splits.
//
// One pair rule serves both. Two live split records with the same group (or
// both none), date, amount, currency and parties (the payer of an expense, the
// two people of a payment), and exactly two records with that key. The loader
// has already enforced that in SQL; this module judges the pair:
//
// - two records each linked to a different bank row are two real purchases
//   (each has its own proof), never a finding;
// - a record typed by hand next to one linked to a bank row, with the same
//   shares, which the Splits matcher itself (`findBestSplitExpenseMatch`: the
//   exact amount and day on the payer's own or a shared account, or shared
//   words) would match to that very bank row, is the same purchase entered
//   twice: the typed record was only waiting for the row the other one holds;
// - a pair no settle-up covers is `duplicate_split` (a delete in Splits fixes
//   it); a pair where a settle-up covers a record is `settled_period_error`:
//   the settle-up already counted the purchase twice, so the people's balances
//   moved by the share of one copy. Its fix is "Correct this settled mistake"
//   (a Split Correction in the open period, docs/proposals/settled-correction.md);
//   a finding a live correction already resolves is silent, and is reported
//   again if the correction is undone.
import { countSharedTokens, normalizeDescriptionForMatch } from "../app-repository-helpers";
import { findBestSplitExpenseMatch } from "../split-matching";
import { clip, finding, money, personLabel, settledCorrectionLink, shortDate, shortId, splitsLink } from "./helpers";
import type { CheckupContext, DetectedFinding } from "./types";

export interface SplitRecordFact {
  id: string;
  kind: "expense" | "settlement";
  description: string;
  date: string;
  amountMinor: number;
  currency: string;
  groupId: string | null;
  groupName: string | null;
  // The payer of an expense, or the person who paid in a settle-up.
  payerPersonId: string;
  // The person a settle-up paid; null for an expense.
  toPersonId: string | null;
  linkedTransactionId: string | null;
  // The ledger entry the record is linked to (what the Splits matcher compares).
  linkedEntry: {
    date: string;
    amountMinor: number;
    currency: string;
    entryType: "expense" | "income" | "transfer";
    description: string;
    // Whose account the entry is on (the entry's owner, else the account's); null = shared.
    ownerPersonId: string | null;
  } | null;
  shares: Array<{ personId: string; amountMinor: number }>;
  // The settle-up that covers the record, if any (an active settlement check
  // or a closed group batch).
  coveredBy: { kind: "checkpoint" | "batch"; id: string; date: string } | null;
  createdAt: string;
}

export interface SplitPairFact {
  a: SplitRecordFact;
  b: SplitRecordFact;
}

// A record the person deleted that an active settle-up still counts: the
// settle-up's list of records was fixed when it was made, so the amount it asked
// for still includes the deleted record's shares. The app refuses to delete a
// record a settle-up holds, so this only comes from a data fix after the fact.
export interface DeletedSettledFact {
  record: SplitRecordFact & { deletedAt: string };
  // The one live record with the same group, day, amount, currency and payer, if
  // exactly one exists, and whether the same settle-up holds it too.
  twin: { record: SplitRecordFact; inSameSettleUp: boolean } | null;
  twinCount: number;
}

export interface SplitPairFacts {
  pairs: SplitPairFact[];
  deletedInSettled: DeletedSettledFact[];
  // The split expenses a live correction already corrects (their settled
  // mistake is resolved). Absent = none.
  correctedSourceIds?: ReadonlyArray<string>;
}

// What a Split Correction would record for one settled mistake, worked out from
// the same facts the detector reads (so a correction is only ever offered for
// a finding the detector reports). The correction is a payment-shaped record
// in the open period from the person who was charged too much to the person
// who was paid too much: it moves the balance by exactly the share the settled
// period over-charged.
export interface SettledCorrectionPlan {
  sourceRecordId: string;
  sourceDescription: string;
  sourceDate: string;
  // The whole extra expense (the correction itself is one person's share of it).
  sourceAmountMinor: number;
  groupId: string | null;
  groupName: string | null;
  currency: string;
  amountMinor: number;
  // The person charged too much (the correction is in their favour) and the
  // person paid too much (who now owes it back).
  overchargedPersonId: string;
  overpaidPersonId: string;
  settledBy: { kind: "checkpoint" | "batch"; id: string; date: string };
  // The extra copy is still a live record (it can be removed with the correction).
  sourceStillLive: boolean;
  // A live twin was kept (the purchase was in twice) or the cost is simply gone.
  hasTwin: boolean;
  // The plain-words label shown in the activity list.
  label: string;
}

// Who was charged too much for an expense counted once too often: each person
// who owes the payer is charged their share.
function overchargeOf(record: SplitRecordFact) {
  return record.shares
    .filter((share) => share.personId !== record.payerPersonId && share.amountMinor > 0)
    .map((share) => ({ personId: share.personId, amountMinor: share.amountMinor }));
}

type Agreement = "same" | "overlap" | "none";

function readAgreement(left: string, right: string): Agreement {
  const a = normalizeDescriptionForMatch(left);
  const b = normalizeDescriptionForMatch(right);
  if (a && a === b) return "same";
  return countSharedTokens(left, right) > 0 ? "overlap" : "none";
}

function sharesKey(record: SplitRecordFact) {
  return record.shares.map((share) => `${share.personId}:${share.amountMinor}`).sort().join("|");
}

// The same people with the same shares, give or take the cent a rounding of an
// odd total moves between them (105,185 splits 52,592 and 52,593 either way round).
function sharesAgree(left: SplitRecordFact, right: SplitRecordFact) {
  if (left.shares.length !== right.shares.length) {
    return false;
  }
  const rightByPerson = new Map(right.shares.map((share) => [share.personId, share.amountMinor]));
  return left.shares.every((share) => rightByPerson.has(share.personId) && Math.abs((rightByPerson.get(share.personId) ?? 0) - share.amountMinor) <= 1);
}

// Whether the Splits matcher would offer the hand-typed record the bank row
// the other record is linked to.
function matchesLinkedRow(typed: SplitRecordFact, linked: SplitRecordFact) {
  if (!linked.linkedEntry || !linked.linkedTransactionId) {
    return false;
  }
  return Boolean(findBestSplitExpenseMatch(
    { id: typed.id, date: typed.date, description: typed.description, totalAmountMinor: typed.amountMinor, currency: typed.currency, payerPersonId: typed.payerPersonId },
    [{
      id: linked.linkedTransactionId,
      transaction_date: linked.linkedEntry.date,
      description: linked.linkedEntry.description,
      amount_minor: linked.linkedEntry.amountMinor,
      entry_type: linked.linkedEntry.entryType,
      owner_person_id: linked.linkedEntry.ownerPersonId,
      currency: linked.linkedEntry.currency
    }]
  ));
}

interface PairReading {
  // The record the finding calls the extra copy (the hand-typed one).
  extra: SplitRecordFact;
  kept: SplitRecordFact;
  high: boolean;
  sharesEqual: boolean;
  agreement: Agreement;
}

// null = silent.
function readPair(pair: SplitPairFact): PairReading | null {
  const { a, b } = pair;
  const linked = [a, b].filter((record) => record.linkedTransactionId);
  // Two bank-linked records are two bank rows: two real purchases.
  if (linked.length === 2) {
    return null;
  }
  const sharesEqual = sharesAgree(a, b);
  const agreement = readAgreement(a.description, b.description);
  if (a.kind === "settlement") {
    // Two payments the same day for the same amount can be real; only a
    // "check", never sure.
    const [extra, kept] = a.createdAt >= b.createdAt ? [a, b] : [b, a];
    return { extra, kept, high: false, sharesEqual: true, agreement };
  }
  if (linked.length === 1) {
    const kept = linked[0];
    const extra = kept === a ? b : a;
    // Different shares are only a lookalike when the words agree too.
    if (!sharesEqual && agreement === "none") {
      return null;
    }
    return { extra, kept, high: sharesEqual && matchesLinkedRow(extra, kept), sharesEqual, agreement };
  }
  // Both typed by hand: a double entry only when the words are the same too.
  if (!sharesEqual || agreement !== "same") {
    return null;
  }
  const [extra, kept] = a.createdAt >= b.createdAt ? [a, b] : [b, a];
  return { extra, kept, high: false, sharesEqual, agreement };
}

function recordEvidence(record: SplitRecordFact, role: string, context: CheckupContext) {
  const paid = record.kind === "expense"
    ? `paid by ${personLabel(context, record.payerPersonId)}`
    : `${personLabel(context, record.payerPersonId)} paid ${personLabel(context, record.toPersonId)}`;
  return {
    role: "record" as const,
    label: clip(record.description || (record.kind === "settlement" ? "Payment" : "Shared cost")),
    shortId: shortId(record.id),
    date: record.date,
    amountMinor: record.amountMinor,
    currency: record.currency,
    note: `${role}; ${paid}${record.linkedTransactionId ? "; matched to a bank record" : "; typed in by hand"}${record.coveredBy ? `; inside the ${shortDate(record.coveredBy.date, context.today)} settle-up` : ""}`
  };
}

function peopleOf(pair: SplitPairFact) {
  return [pair.a, pair.b].flatMap((record) => [record.payerPersonId, ...(record.toPersonId ? [record.toPersonId] : []), ...record.shares.map((share) => share.personId)]);
}

function correctionLabel(source: SplitRecordFact, settleDate: string, hasTwin: boolean, context: CheckupContext) {
  const what = `${clip(source.description || "Shared cost", 40)} on ${shortDate(source.date, context.today)}`;
  return hasTwin
    ? `Correction: ${what} counted twice in the ${shortDate(settleDate, context.today)} settle-up`
    : `Correction: ${what} removed after the ${shortDate(settleDate, context.today)} settle-up`;
}

function planFor(source: SplitRecordFact, effects: Array<{ personId: string; amountMinor: number }>, input: { sourceStillLive: boolean; hasTwin: boolean }, context: CheckupContext): SettledCorrectionPlan | null {
  // The settled period must hold the source, and exactly one other person was
  // charged (the balance is between two people).
  if (!source.coveredBy || source.kind !== "expense" || effects.length !== 1) {
    return null;
  }
  return {
    sourceRecordId: source.id,
    sourceDescription: source.description,
    sourceDate: source.date,
    sourceAmountMinor: source.amountMinor,
    groupId: source.groupId,
    groupName: source.groupName,
    currency: source.currency,
    amountMinor: effects[0].amountMinor,
    overchargedPersonId: effects[0].personId,
    overpaidPersonId: source.payerPersonId,
    settledBy: source.coveredBy,
    sourceStillLive: input.sourceStillLive,
    hasTwin: input.hasTwin,
    label: correctionLabel(source, source.coveredBy.date, input.hasTwin, context)
  };
}

// The corrections the settled-period detector can offer, by the id of the
// expense whose settled effect they correct. A mistake a live correction
// already corrects is not offered again.
export function planSettledCorrections(facts: SplitPairFacts, context: CheckupContext): Map<string, SettledCorrectionPlan> {
  const plans = new Map<string, SettledCorrectionPlan>();
  const corrected = new Set(facts.correctedSourceIds ?? []);
  for (const fact of facts.deletedInSettled) {
    const { record } = fact;
    if (corrected.has(record.id) || !record.coveredBy || overchargeOf(record).length === 0) {
      continue;
    }
    const plan = planFor(record, overchargeOf(record), { sourceStillLive: false, hasTwin: Boolean(fact.twin) }, context);
    if (plan) plans.set(plan.sourceRecordId, plan);
  }
  for (const pair of facts.pairs) {
    if (!pair.a.coveredBy && !pair.b.coveredBy) {
      continue;
    }
    const reading = readPair(pair);
    if (!reading || reading.extra.kind !== "expense" || corrected.has(reading.extra.id)) {
      continue;
    }
    const plan = planFor(reading.extra, overchargeOf(reading.extra), { sourceStillLive: true, hasTwin: true }, context);
    if (plan) plans.set(plan.sourceRecordId, plan);
  }
  return plans;
}

// Detector 2a: no settle-up covers either record.
export function detectDuplicateSplits(facts: SplitPairFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  for (const pair of facts.pairs) {
    if (pair.a.coveredBy || pair.b.coveredBy) {
      continue;
    }
    const reading = readPair(pair);
    if (!reading) {
      continue;
    }
    const { extra, kept } = reading;
    const amount = money(extra.amountMinor, extra.currency);
    const group = extra.groupName ? ` in ${extra.groupName}` : "";
    const isPayment = extra.kind === "settlement";
    const tier = reading.high ? "high" : "check";
    findings.push(finding({
      kind: "duplicate_split",
      subject: [pair.a.id, pair.b.id].sort().join("+"),
      tier,
      title: isPayment ? "A payment may be entered twice" : tier === "high" ? "Entered twice in Splits" : "May be entered twice in Splits",
      summary: isPayment
        ? `Two payments of ${amount} on ${shortDate(extra.date, context.today)}${group} are recorded between the same two people, so the balance may be ${amount} off.`
        : tier === "high"
          ? `${clip(extra.description, 40)} (${amount}, ${shortDate(extra.date, context.today)})${group} is in Splits twice, once typed in by hand and once from the bank record, so the group shows ${amount} too much spent.`
          : `Two shared costs of ${amount} on ${shortDate(extra.date, context.today)}${group} were paid by the same person and look alike, so one of them may be a repeat.`,
      evidence: [recordEvidence(kept, "kept", context), recordEvidence(extra, "looks like the extra copy", context)],
      amountMinor: extra.amountMinor,
      currency: extra.currency,
      occurredOn: extra.date,
      personIds: peopleOf(pair),
      fix: splitsLink(extra.groupId, extra.date, "Open Splits and delete the extra one"),
      facts: [pair.a.id, pair.b.id, extra.amountMinor, extra.date, sharesKey(pair.a), sharesKey(pair.b), pair.a.linkedTransactionId, pair.b.linkedTransactionId]
    }));
  }
  return findings;
}

// Detector 8: a settle-up covers at least one of the two records.
export function detectSettledPeriodErrors(facts: SplitPairFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const corrected = new Set(facts.correctedSourceIds ?? []);
  const plans = planSettledCorrections(facts, context);
  // "Correct this settled mistake" only where a correction can be recorded.
  const fixFor = (sourceRecordId: string) => (plans.has(sourceRecordId)
    ? settledCorrectionLink(plans.get(sourceRecordId)!.groupId, context.today, sourceRecordId)
    : null);
  for (const fact of facts.deletedInSettled) {
    const { record, twin } = fact;
    // A live correction already settles this: silent until it is undone.
    if (corrected.has(record.id)) {
      continue;
    }
    const effects = record.shares.filter((share) => share.personId !== record.payerPersonId && share.amountMinor > 0);
    const effectTotal = effects.reduce((sum, effect) => sum + effect.amountMinor, 0);
    if (!record.coveredBy || effectTotal === 0) {
      continue;
    }
    // Sure only when exactly one live record is its twin, the same settle-up
    // counted that one too, and the shares agree: the purchase was in twice and
    // one copy has since been removed, so the settled balance still holds both.
    const isSure = Boolean(twin) && fact.twinCount === 1 && twin!.inSameSettleUp && sharesAgree(record, twin!.record);
    const amount = money(record.amountMinor, record.currency);
    const group = record.groupName ? ` in ${record.groupName}` : "";
    const settleDate = shortDate(record.coveredBy.date, context.today);
    const removedOn = shortDate(record.deletedAt.slice(0, 10), context.today);
    const effectLines = effects.map((effect) => `${personLabel(context, effect.personId)} was charged ${money(effect.amountMinor, record.currency)} too much`);
    findings.push(finding({
      kind: "settled_period_error",
      subject: `deleted:${record.id}`,
      tier: isSure ? "high" : "check",
      title: isSure ? "A settled cost was counted twice" : "A settled cost no longer exists",
      summary: isSure
        ? `${clip(record.description, 40)} (${amount}, ${shortDate(record.date, context.today)})${group} was in Splits twice. The extra copy was removed on ${removedOn}, but the ${settleDate} settle-up had already counted both. ${effectLines.join(" and ")}.`
        : `${clip(record.description, 40)} (${amount}, ${shortDate(record.date, context.today)})${group} was removed on ${removedOn}, but the ${settleDate} settle-up still counts it. ${effectLines.join(" and ")}, if it should not have counted.`,
      evidence: [
        { ...recordEvidence(record, `removed on ${removedOn}`, context), note: `removed on ${removedOn}; still inside the ${settleDate} settle-up; paid by ${personLabel(context, record.payerPersonId)}` },
        ...(twin ? [recordEvidence(twin.record, "the copy that was kept", context)] : []),
        ...effectLines.map((line) => ({ role: "fact" as const, label: line })),
        { role: "fact" as const, label: `${personLabel(context, record.payerPersonId)} was paid ${money(effectTotal, record.currency)} too much` }
      ],
      amountMinor: effectTotal,
      currency: record.currency,
      occurredOn: record.date,
      personIds: [record.payerPersonId, ...record.shares.map((share) => share.personId)],
      fix: fixFor(record.id),
      fixNote: "No fix yet. A settle-up that is already closed cannot be corrected from here.",
      facts: [record.id, record.deletedAt, effectTotal, record.coveredBy.id, twin?.record.id ?? null, fact.twinCount]
    }));
  }
  for (const pair of facts.pairs) {
    if (!pair.a.coveredBy && !pair.b.coveredBy) {
      continue;
    }
    const reading = readPair(pair);
    if (!reading) {
      continue;
    }
    const { extra, kept } = reading;
    if (corrected.has(extra.id)) {
      continue;
    }
    const bothCovered = Boolean(pair.a.coveredBy && pair.b.coveredBy);
    const tier = reading.high && bothCovered ? "high" : "check";
    const amount = money(extra.amountMinor, extra.currency);
    const group = extra.groupName ? ` in ${extra.groupName}` : "";
    const settleDate = shortDate((extra.coveredBy ?? kept.coveredBy)!.date, context.today);
    // Who was charged too much: for a shared cost, each person who owes the
    // payer is charged their share of the extra copy, and the payer is paid
    // that much too much. A payment counted twice moves the whole amount.
    const effects = extra.kind === "expense"
      ? extra.shares.filter((share) => share.personId !== extra.payerPersonId && share.amountMinor > 0).map((share) => ({ personId: share.personId, amountMinor: share.amountMinor }))
      : [{ personId: extra.payerPersonId, amountMinor: extra.amountMinor }];
    const effectTotal = effects.reduce((sum, effect) => sum + effect.amountMinor, 0);
    // A shared cost nobody else owes a share of moved no one's balance.
    if (extra.kind === "expense" && effectTotal === 0) {
      continue;
    }
    const effectLines = extra.kind === "expense"
      ? effects.map((effect) => `${personLabel(context, effect.personId)} was charged ${money(effect.amountMinor, extra.currency)} too much`)
      : [`${personLabel(context, extra.payerPersonId)} has paid ${amount} more than was owed`];
    const payerLine = extra.kind === "expense" && effectTotal > 0 ? [`${personLabel(context, extra.payerPersonId)} was paid ${money(effectTotal, extra.currency)} too much`] : [];
    findings.push(finding({
      kind: "settled_period_error",
      subject: [pair.a.id, pair.b.id].sort().join("+"),
      tier,
      title: tier === "high" ? "A settled cost was counted twice" : "A settled cost may be counted twice",
      summary: extra.kind === "expense"
        ? `${clip(extra.description, 40)} (${amount}, ${shortDate(extra.date, context.today)})${group} is in Splits twice and the ${settleDate} settle-up counted both. ${effectLines.join(" and ")}${tier === "high" ? "" : ", if the two really are one purchase"}.`
        : `Two payments of ${amount} on ${shortDate(extra.date, context.today)}${group} sit inside the ${settleDate} settle-up, so the balance may be ${amount} off.`,
      evidence: [
        recordEvidence(kept, "kept", context),
        recordEvidence(extra, "looks like the extra copy", context),
        ...effectLines.concat(payerLine).map((line) => ({ role: "fact" as const, label: line }))
      ],
      amountMinor: effectTotal,
      currency: extra.currency,
      occurredOn: extra.date,
      personIds: peopleOf(pair),
      fix: fixFor(extra.id),
      fixNote: "No fix yet. A settle-up that is already closed cannot be corrected from here.",
      facts: [pair.a.id, pair.b.id, extra.amountMinor, extra.date, sharesKey(pair.a), sharesKey(pair.b), pair.a.coveredBy?.id ?? null, pair.b.coveredBy?.id ?? null, pair.a.linkedTransactionId, pair.b.linkedTransactionId]
    }));
  }
  return findings;
}
