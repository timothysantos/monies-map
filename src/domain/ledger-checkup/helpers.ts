// Small formatting and identity helpers shared by the check-up's detectors.
import type { AccountFact, CheckupContext, CheckupEvidence, CheckupFix, DetectedFinding, FindingKind, FindingTier } from "./types";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// $1,234.56, or "IDR 159,000.00" for another currency. Always positive: a
// sentence says "too much", never a minus sign.
export function money(amountMinor: number, currency = "SGD") {
  const absolute = Math.abs(Math.round(amountMinor));
  const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = String(absolute % 100).padStart(2, "0");
  return currency === "SGD" ? `$${whole}.${cents}` : `${currency} ${whole}.${cents}`;
}

// "27 Aug", and the year when it is not today's year.
export function shortDate(date: string, today: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    return date;
  }
  const base = `${day} ${MONTH_NAMES[month - 1]}`;
  return String(year) === today.slice(0, 4) ? base : `${base} ${year}`;
}

export function monthName(month: string, today: string) {
  const [year, number] = month.split("-").map(Number);
  const base = LONG_MONTH_NAMES[number - 1] ?? month;
  return String(year) === today.slice(0, 4) ? base : `${base} ${year}`;
}

// The 8 characters after an id's prefix ("txn-620bffbf-..." -> "620bffbf").
export function shortId(id: string) {
  return id.replace(/^[a-z]+-/, "").replace(/-/g, "").slice(0, 8);
}

export function clip(text: string, max = 60) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(left: string, right: string) {
  return Math.round((new Date(`${right}T00:00:00Z`).getTime() - new Date(`${left}T00:00:00Z`).getTime()) / 86_400_000);
}

export function nextMonthKey(month: string) {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

// The month keys strictly between two month keys, oldest first.
export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let month = nextMonthKey(from); month < to && months.length < 120; month = nextMonthKey(month)) {
    months.push(month);
  }
  return months;
}

// A short, stable, non-cryptographic hash (cyrb53) as 14 hex characters. The
// evidence key only has to change when the evidence does.
export function hashFacts(facts: ReadonlyArray<string | number | null>) {
  const text = facts.map((fact) => (fact === null ? "~" : String(fact))).join("|");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function accountLabel(context: CheckupContext, accountId: string | null | undefined) {
  return (accountId && context.accounts.get(accountId)?.name) || "an account";
}

// The people an account touches: its owner, or nobody for a shared account.
export function accountPeople(account: AccountFact | undefined): string[] {
  return account && !account.isJoint && account.ownerPersonId ? [account.ownerPersonId] : [];
}

export function uniqueIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id)))).sort();
}

export function personLabel(context: CheckupContext, personId: string | null | undefined) {
  return (personId && context.people.get(personId)) || "Someone";
}

// Deep links into the app's existing pages (the same URL shapes the pages use).
export function entryLink(entryId: string, date: string, label = "Open the entry"): CheckupFix {
  const params = new URLSearchParams({ view: "household", month: date.slice(0, 7), editing_entry: entryId });
  return { label, path: `/entries?${params.toString()}` };
}

export function splitsLink(groupId: string | null, date: string, label = "Open Splits"): CheckupFix {
  const params = new URLSearchParams({ view: "household", month: date.slice(0, 7) });
  if (groupId) {
    params.set("split_group", groupId);
  }
  return { label, path: `/splits?${params.toString()}` };
}

export function monthLink(month: string, label = "Open the month's plan"): CheckupFix {
  const params = new URLSearchParams({ view: "household", month });
  return { label, path: `/month?${params.toString()}#month-plan` };
}

export const IMPORTS_PATH = "/imports";
export const SETTINGS_PATH = "/settings";

export interface FindingInput {
  kind: FindingKind;
  subject: string;
  tier: FindingTier;
  title: string;
  summary: string;
  evidence: CheckupEvidence[];
  amountMinor?: number | null;
  currency?: string;
  occurredOn?: string | null;
  personIds?: string[];
  fix?: CheckupFix | null;
  fixNote?: string | null;
  // The facts that make it true (ids, amounts, dates): hashed, with the tier,
  // into the evidence key.
  facts: ReadonlyArray<string | number | null>;
}

export function finding(input: FindingInput): DetectedFinding {
  return {
    id: `${input.kind}:${input.subject}`,
    kind: input.kind,
    tier: input.tier,
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    amountMinor: input.amountMinor === undefined || input.amountMinor === null ? null : Math.abs(input.amountMinor),
    currency: input.currency ?? "SGD",
    occurredOn: input.occurredOn ?? null,
    personIds: uniqueIds(input.personIds ?? []),
    fix: input.fix ?? null,
    fixNote: input.fix ? null : input.fixNote ?? "No fix yet.",
    evidenceFacts: [input.tier, ...input.facts]
  };
}

export type { FindingKind, FindingTier, CheckupEvidence };
