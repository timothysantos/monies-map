// "Joyce's share 1.6", "all Joyce", "70% Joyce", "split half": the model
// reports only the shares the person stated (a person and the value as
// written: "all", "70%", "$1.60", "1.6"); this reads them into the first
// person's basis points. Splits is between the household's two, so one
// stated share leaves the rest to the other person, whatever numbers the
// model filled in for them. The model is never asked for a computed share.
//
// Pure, no database. Used by the three actions that carry shares: a new
// shared expense, a change to the card being filled, and an add to Splits.

import { assumption, type AskAssumption } from "./ask-ambiguity";
import {
  COPY,
  groundedAmount,
  findPerson,
  isRecord,
  personQuestion,
  type AskTurnContext,
  type AskTurnPerson,
  type AskTurnReply,
  type Ground
} from "./ask-turn";
import { readAmountMinor, readShareValue, type ShareValue } from "./ask-turn-names";

export type ShareResult =
  | { kind: "ok"; firstBasisPoints: number; firstAmountMinor?: number; assumptions: AskAssumption[] }
  | { kind: "reply"; reply: AskTurnReply };

interface ReadShare {
  person: AskTurnPerson;
  basisPoints: number;
  amountMinor?: number;
  // The person wrote this number (or it is a flag such as "all"); the model
  // did not make it up. A computed share is dropped when another is stated.
  stated: boolean;
  assumed: AskAssumption | null;
}

function sharesQuestion(people: AskTurnPerson[], code: "shares_unreadable" | "shares_mismatch" = "shares_unreadable"): AskTurnReply {
  const [first, second] = people;
  return {
    kind: "clarify",
    question: COPY.sharesQuestion,
    options: [COPY.chips.even, COPY.chips.allOf(first.name), COPY.chips.allOf(second.name)],
    error: { code, field: "split.shares", valid: people.map((person) => person.name) }
  };
}

// The model's share item as a value: the new `value` as written, or the older
// percent / amount / all fields.
function readItem(item: Record<string, unknown>): ShareValue | null {
  if (item.all === true) return { kind: "all" };
  if (item.value !== undefined && item.value !== null && item.value !== "") return readShareValue(item.value);
  if (typeof item.percent === "number") return { kind: "percent", percent: item.percent };
  if (item.amount !== undefined && item.amount !== null && item.amount !== "") {
    // The older `amount` field says it is an amount, with or without a symbol.
    const minor = readAmountMinor(item.amount);
    return minor === null ? null : { kind: "amount", minor };
  }
  return null;
}

// Whether the person's own words carry this number: "70%", "70 percent",
// "$30", or a bare "30".
function saidNumber(text: string, number: number) {
  const digits = String(number).replace(".", "\\.");
  return new RegExp(`(?<![\\d.])${digits}(?![\\d]|\\.\\d)`).test(text);
}

function unitSaid(text: string, number: number): "percent" | "amount" | null {
  const digits = String(number).replace(".", "\\.");
  if (new RegExp(`(?<![\\d.])${digits}\\s?(?:%|percent|per cent|pct)`).test(text)) return "percent";
  if (new RegExp(`(?:s?\\$\\s?${digits}(?![\\d])|(?<![\\d.])${digits}\\s?(?:dollars?|bucks?|sgd))`).test(text)) return "amount";
  return null;
}

function money(minor: number, currency: string) {
  return `${currency === "SGD" ? "S$" : `${currency} `}${(minor / 100).toFixed(2)}`;
}

// Each person's share as stated, read into the first person's basis points.
// Two people only. None stated: an even split, said as an assumption. One
// stated: the other person has the rest. Two stated: they must add up to
// the whole, unless only one of them is a number the person wrote, in which
// case that one stands and the other is the rest.
export function resolveShares(value: unknown, context: AskTurnContext, totalMinor: number | null, ground: Ground, currency = "SGD"): ShareResult {
  const people = context.people.slice(0, 2);
  if (people.length < 2) return { kind: "reply", reply: { kind: "note", text: COPY.needsTwoPeople } };
  const [first, second] = people;
  const items = Array.isArray(value) ? value.filter(isRecord) : [];
  if (!items.length) {
    return {
      kind: "ok",
      firstBasisPoints: 5000,
      assumptions: [assumption(COPY.assumed.evenSplit, [COPY.chips.allOf(first.name), COPY.chips.allOf(second.name)])]
    };
  }
  if (items.length > 2) return { kind: "reply", reply: sharesQuestion(people) };

  const text = ground.userText.toLowerCase();
  const read: ReadShare[] = [];
  for (const item of items) {
    const person = findPerson(item.person, context);
    if (!person || person === "unknown" || !people.some((candidate) => candidate.id === person.id)) {
      return { kind: "reply", reply: personQuestion(context, COPY.whoseShare, "split.shares.person", String(item.person ?? "")) };
    }
    if (read.some((entry) => entry.person.id === person.id)) return { kind: "reply", reply: sharesQuestion(people) };
    const share = readItem(item);
    if (!share) return { kind: "reply", reply: sharesQuestion(people) };
    const placed = placeShare(share, person, people, totalMinor, ground, text, currency);
    if (placed.kind === "reply") return { kind: "reply", reply: placed.reply };
    read.push(placed.share);
  }

  if (read.length === 2) {
    const [left, right] = read;
    const consistent = left.amountMinor !== undefined && right.amountMinor !== undefined && totalMinor
      ? left.amountMinor + right.amountMinor === totalMinor
      : left.basisPoints + right.basisPoints === 10_000;
    if (!consistent) {
      // A share the person never wrote is a number the model worked out.
      const stated = read.filter((entry) => entry.stated);
      if (stated.length !== 1) return { kind: "reply", reply: sharesQuestion(people, "shares_mismatch") };
      return finish([stated[0]], first, second, totalMinor);
    }
  }
  return finish(read, first, second, totalMinor);
}

function finish(read: ReadShare[], first: AskTurnPerson, second: AskTurnPerson, totalMinor: number | null): ShareResult {
  const assumptions = read.flatMap((entry) => (entry.assumed ? [entry.assumed] : []));
  const own = read.find((entry) => entry.person.id === first.id);
  if (own) {
    return { kind: "ok", firstBasisPoints: own.basisPoints, ...(own.amountMinor !== undefined ? { firstAmountMinor: own.amountMinor } : {}), assumptions };
  }
  const other = read.find((entry) => entry.person.id === second.id) as ReadShare;
  return other.amountMinor !== undefined && totalMinor
    ? { kind: "ok", firstBasisPoints: 10_000 - other.basisPoints, firstAmountMinor: totalMinor - other.amountMinor, assumptions }
    : { kind: "ok", firstBasisPoints: 10_000 - other.basisPoints, assumptions };
}

// One stated share as basis points (and the amount when it was one).
// A bare number is told apart by what the person wrote around it, then by
// whether it fits as an amount of this entry; when both fit it is read as an
// amount and the percent reading is offered as the alternative.
function placeShare(
  share: ShareValue,
  person: AskTurnPerson,
  people: AskTurnPerson[],
  totalMinor: number | null,
  ground: Ground,
  text: string,
  currency: string
): { kind: "ok"; share: ReadShare } | { kind: "reply"; reply: AskTurnReply } {
  const ask = (reply: AskTurnReply) => ({ kind: "reply" as const, reply });
  const percentOf = (percent: number, stated: boolean, assumed: AskAssumption | null = null) => {
    if (!(percent >= 0 && percent <= 100)) return ask(sharesQuestion(people));
    return { kind: "ok" as const, share: { person, basisPoints: Math.round(percent * 100), stated, assumed } };
  };
  const amountOf = (minor: number, stated: boolean, assumed: AskAssumption | null = null) => {
    if (!totalMinor) return ask({ kind: "clarify", question: COPY.totalFirst, options: [], error: { code: "amount_needed", field: "split.shares" } });
    if (minor > totalMinor) return ask(sharesQuestion(people));
    return { kind: "ok" as const, share: { person, basisPoints: Math.round((minor / totalMinor) * 10_000), amountMinor: minor, stated, assumed } };
  };

  if (share.kind === "all") return { kind: "ok", share: { person, basisPoints: 10_000, stated: true, assumed: null } };
  if (share.kind === "percent") return percentOf(share.percent, saidNumber(text, share.percent) || /\b(half|third|quarter|equal|even|50\/50)\b/.test(text));
  if (share.kind === "amount") {
    const amount = groundedAmount(share.minor / 100, ground);
    if (!amount.given || amount.minor === null) return ask({ kind: "clarify", question: COPY.amountQuestion, options: [], error: { code: "amount_not_stated", field: "split.shares" } });
    return amountOf(amount.minor, true);
  }

  // A bare number: "1.6", "70".
  const number = share.number;
  const minor = Math.round(number * 100);
  const stated = saidNumber(text, number);
  // A bare number the person never wrote is one the model worked out.
  if (!stated) return ask({ kind: "clarify", question: COPY.amountQuestion, options: [], error: { code: "amount_not_stated", field: "split.shares" } });
  const unit = stated ? unitSaid(text, number) : null;
  if (unit === "percent") return percentOf(number, true);
  if (unit === "amount") return amountOf(minor, true);
  const fitsAsAmount = Boolean(totalMinor) && minor > 0 && minor <= (totalMinor as number) && ground.amounts.has(minor);
  const fitsAsPercent = number > 0 && number <= 100;
  if (fitsAsAmount) {
    // Both readings can fit; an amount of this entry is the likelier thing to
    // say about "the share", and the percent is one tap away.
    const alternative = fitsAsPercent ? [`${person.name}'s share is ${number}%`] : [];
    return amountOf(minor, stated, assumption(COPY.assumed.readAsAmount(number, money(minor, currency), person.name), alternative));
  }
  if (fitsAsPercent) return percentOf(number, true, assumption(COPY.assumed.readAsPercent(number, person.name)));
  return ask(sharesQuestion(people));
}
