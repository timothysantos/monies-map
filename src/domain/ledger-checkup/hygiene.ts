// Detector 9: small tidy-ups in the data.
//
// - other_category (`note`): an expense left in the catch-all Other for more
//   than 60 days for which the household's own category rules, or an Ask habit
//   it has confirmed three times, name another category. Never a guess from
//   history or everyday words.
// - odd_entry (`check`): an entry of $0, or dated more than 14 days ahead of
//   today.
// - quiet_account (`note`): an active bank or card account that has had
//   entries but none for 90 days or more.
import { matchCategoryRule } from "../app-repository-category-match-rules";
import { habitConfidence, habitMerchantKey, type AskHabit } from "../ask-habits";
import type { CategoryMatchRuleDto } from "../../types/dto";
import { SETTINGS_PATH, accountLabel, accountPeople, addDays, clip, daysBetween, entryLink, finding, money, shortDate, shortId } from "./helpers";
import type { CheckupContext, DetectedFinding } from "./types";

export const OTHER_CATEGORY_MIN_AGE_DAYS = 60;
export const FUTURE_ENTRY_TOLERANCE_DAYS = 14;
export const QUIET_ACCOUNT_DAYS = 90;

// Words a rule or habit may never answer with: a catch-all says nothing.
const NEVER_A_GUESS: ReadonlySet<string> = new Set(["Other", "Other - Income", "Income", "Transfer"]);

export interface HygieneEntryFact {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  entryType: "expense" | "income" | "transfer";
  ownerPersonId: string | null;
}

export interface HygieneFacts {
  otherEntries: HygieneEntryFact[];
  oddEntries: HygieneEntryFact[];
  categoryNames: string[];
  rules: CategoryMatchRuleDto[];
  habits: AskHabit[];
}

function betterCategory(entry: HygieneEntryFact, facts: HygieneFacts, today: string): { name: string; source: "rule" | "habit" } | null {
  const usable = (name: string | undefined): name is string => Boolean(name) && !NEVER_A_GUESS.has(name as string) && facts.categoryNames.includes(name as string);
  const ruled = matchCategoryRule(entry.description, facts.rules);
  if (usable(ruled)) {
    return { name: ruled, source: "rule" };
  }
  const key = habitMerchantKey(entry.description);
  const habit = key ? facts.habits.find((candidate) => candidate.kind === "category" && candidate.key === key) : undefined;
  const habitName = habit ? (habit.value as { categoryName?: string }).categoryName : undefined;
  if (habit && usable(habitName) && habitConfidence(habit, today) === "high") {
    return { name: habitName, source: "habit" };
  }
  return null;
}

export function detectHygiene(facts: HygieneFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];

  for (const entry of facts.otherEntries) {
    if (entry.entryType !== "expense" || daysBetween(entry.date, context.today) < OTHER_CATEGORY_MIN_AGE_DAYS) {
      continue;
    }
    const better = betterCategory(entry, facts, context.today);
    if (!better) {
      continue;
    }
    findings.push(finding({
      kind: "other_category",
      subject: entry.id,
      tier: "note",
      title: "Could be filed under a better category",
      summary: `${clip(entry.description, 40)} (${money(entry.amountMinor, entry.currency)}, ${shortDate(entry.date, context.today)}) is still in Other. ${better.source === "rule" ? "Your own category rules" : "What you have confirmed before"} would put it under ${better.name}.`,
      evidence: [{ role: "entry", label: clip(entry.description), shortId: shortId(entry.id), date: entry.date, amountMinor: entry.amountMinor, currency: entry.currency, accountName: accountLabel(context, entry.accountId), note: `in Other; would be ${better.name}` }],
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      occurredOn: entry.date,
      personIds: [...accountPeople(context.accounts.get(entry.accountId)), ...(entry.ownerPersonId ? [entry.ownerPersonId] : [])],
      fix: entryLink(entry.id, entry.date, "Open the entry and choose the category"),
      facts: [entry.id, better.name]
    }));
  }

  const futureLimit = addDays(context.today, FUTURE_ENTRY_TOLERANCE_DAYS);
  for (const entry of facts.oddEntries) {
    const isZero = entry.amountMinor === 0;
    const isFuture = entry.date > futureLimit;
    if (!isZero && !isFuture) {
      continue;
    }
    findings.push(finding({
      kind: "odd_entry",
      subject: entry.id,
      tier: "check",
      title: isZero ? "An entry has no amount" : "An entry is dated far ahead",
      summary: isZero
        ? `${clip(entry.description, 40)} on ${shortDate(entry.date, context.today)} has an amount of ${money(0, entry.currency)}, so it changes nothing. It may be unfinished.`
        : `${clip(entry.description, 40)} (${money(entry.amountMinor, entry.currency)}) is dated ${shortDate(entry.date, context.today)}, more than ${FUTURE_ENTRY_TOLERANCE_DAYS} days from today. The date may be a typo.`,
      evidence: [{ role: "entry", label: clip(entry.description), shortId: shortId(entry.id), date: entry.date, amountMinor: entry.amountMinor, currency: entry.currency, accountName: accountLabel(context, entry.accountId) }],
      amountMinor: isZero ? null : entry.amountMinor,
      currency: entry.currency,
      occurredOn: entry.date,
      personIds: [...accountPeople(context.accounts.get(entry.accountId)), ...(entry.ownerPersonId ? [entry.ownerPersonId] : [])],
      fix: entryLink(entry.id, entry.date),
      facts: [entry.id, entry.amountMinor, entry.date]
    }));
  }

  for (const account of context.accounts.values()) {
    if (!account.isActive || (account.kind !== "bank" && account.kind !== "credit_card") || !account.lastEntryDate) {
      continue;
    }
    const quietDays = daysBetween(account.lastEntryDate, context.today);
    if (quietDays < QUIET_ACCOUNT_DAYS) {
      continue;
    }
    findings.push(finding({
      kind: "quiet_account",
      subject: account.id,
      tier: "note",
      title: "An account has gone quiet",
      summary: `${account.name} has had no entries since ${shortDate(account.lastEntryDate, context.today)}, ${quietDays} days ago. If it is no longer used, it can be archived; if it is, its bank file may be missing.`,
      evidence: [{ role: "account", label: account.name, date: account.lastEntryDate, note: `last entry ${quietDays} days ago` }],
      amountMinor: null,
      occurredOn: account.lastEntryDate,
      personIds: accountPeople(account),
      fix: { label: "Open Settings", path: SETTINGS_PATH },
      facts: [account.id, account.lastEntryDate]
    }));
  }
  return findings;
}
