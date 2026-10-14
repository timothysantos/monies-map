// Ask habits (DOMAIN.md "Ask Habit"): small structured facts about what the
// household actually does and confirms, kept so Ask can suggest, and for the
// safe set apply, the same thing next time. Pure and deterministic: no AI,
// no reads, no writes (app-repository-ask-habits.ts stores them).
//
// A habit is never learned from chat text. It comes from a command the
// person ran (a category change, an Add to Splits) or an Ask draft they
// saved, and holds ids and names from the household's own rows.
//
// Three kinds:
// - category: normalised shop -> category name
// - split:    normalised shop -> usual split (payer, payer's share, group)
// - alias:    a nickname the person confirmed -> a person
//
// Confidence is counted since the last override:
// - `timesConfirmed` is the number of consistent confirmations since the
//   habit was created or last overridden (an override resets it to 0, or to
//   1 when the new value was itself confirmed);
// - `timesOverridden` is the lifetime count of times the person did
//   something different, or undid what Ask did.
// A habit is "high" at 3 or more consistent confirmations (Ask may apply a
// safe action by itself), "suggest" at 2 (Ask only offers it), else "none".
// A habit not used for a year is "none": what a household does changes.

import { normalizeDescriptionForMatch } from "./app-repository-helpers";

// The app_settings key of "Let Ask handle safe things" (default on).
export const ASK_HANDLES_SAFE_SETTING_KEY = "ask_handles_safe_things";

export type AskHabitKind = "category" | "split" | "alias";
export type AskHabitSource = "entries" | "splits" | "ask" | "undo" | "settings";
export type AskHabitConfidence = "high" | "suggest" | "none";

export const ASK_HABIT_POLICY = Object.freeze({
  highConfirmations: 3,
  suggestConfirmations: 2,
  staleDays: 365,
  maxKeyLength: 40,
  maxAliasLength: 24
});

export interface AskCategoryHabitValue {
  categoryName: string;
}

// The payer's own share, so a habit holds for whichever of the two people
// pays; the split command wants the first person's share (see
// firstPersonBasisPoints).
export interface AskSplitHabitValue {
  groupId: string | null;
  payerPersonId: string;
  payerShareBasisPoints: number;
}

export interface AskAliasHabitValue {
  personId: string;
}

export type AskHabitValue = AskCategoryHabitValue | AskSplitHabitValue | AskAliasHabitValue;

export interface AskHabit {
  id: string;
  kind: AskHabitKind;
  key: string;
  value: AskHabitValue;
  timesConfirmed: number;
  timesOverridden: number;
  // ISO date (YYYY-MM-DD) the habit last matched a confirmation or use.
  lastUsed: string;
  source: AskHabitSource;
}

// Categories that hold anything: confirming one says nothing about a shop.
export const ASK_CATCH_ALL_CATEGORIES: ReadonlySet<string> = new Set(["Other", "Other - Income", "Income", "Transfer"]);

export const ASK_HABIT_KINDS: readonly AskHabitKind[] = ["category", "split", "alias"];

export function askHabitId(kind: AskHabitKind, key: string) {
  return `${kind}:${key}`;
}

// The shop a habit is keyed by: the entry description the way category and
// split matching read it, with long digit runs (a PayNow phone number, a
// card or reference number) dropped so a key never carries a number.
// "" when nothing usable is left.
export function habitMerchantKey(description: string | null | undefined): string {
  const tokens = normalizeDescriptionForMatch(description ?? "")
    .split(" ")
    .filter((token) => token && !/^\d{4,}$/.test(token));
  const key = tokens.join(" ").slice(0, ASK_HABIT_POLICY.maxKeyLength).trim();
  return key.length >= 3 && /[a-z]/.test(key) ? key : "";
}

// A nickname worth keeping: one short word of letters.
export function habitAliasKey(alias: string | null | undefined): string {
  const key = (alias ?? "").trim().toLowerCase();
  return key.length >= 1 && key.length <= ASK_HABIT_POLICY.maxAliasLength && /^\p{L}+$/u.test(key) ? key : "";
}

// Stable text for a value, so the stored value compares by equality.
export function canonicalHabitValue(kind: AskHabitKind, value: AskHabitValue): string {
  if (kind === "category") {
    return JSON.stringify({ categoryName: (value as AskCategoryHabitValue).categoryName });
  }
  if (kind === "split") {
    const split = value as AskSplitHabitValue;
    return JSON.stringify({ groupId: split.groupId ?? null, payerPersonId: split.payerPersonId, payerShareBasisPoints: split.payerShareBasisPoints });
  }
  return JSON.stringify({ personId: (value as AskAliasHabitValue).personId });
}

export type HabitCounters = Pick<AskHabit, "timesConfirmed" | "timesOverridden">;

// What a confirmation does to a habit. The same value counts one more
// consistent confirmation; a different value replaces it and counts as an
// override of the old one (the new value starts at one confirmation).
// Mirrors the upsert in app-repository-ask-habits.ts.
export function confirmHabit(
  existing: { valueJson: string; counters: HabitCounters } | null,
  nextValueJson: string
): HabitCounters {
  if (!existing) {
    return { timesConfirmed: 1, timesOverridden: 0 };
  }
  if (existing.valueJson === nextValueJson) {
    return { timesConfirmed: existing.counters.timesConfirmed + 1, timesOverridden: existing.counters.timesOverridden };
  }
  return { timesConfirmed: 1, timesOverridden: existing.counters.timesOverridden + 1 };
}

// The person did something else, or undid what Ask did: confidence starts
// again from nothing, and the override is counted.
export function overrideHabit(counters: HabitCounters): HabitCounters {
  return { timesConfirmed: 0, timesOverridden: counters.timesOverridden + 1 };
}

function daysBetween(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / 86_400_000) : Infinity;
}

export function habitConfidence(habit: Pick<AskHabit, "timesConfirmed" | "lastUsed">, today: string): AskHabitConfidence {
  if (daysBetween(habit.lastUsed, today) > ASK_HABIT_POLICY.staleDays) {
    return "none";
  }
  if (habit.timesConfirmed >= ASK_HABIT_POLICY.highConfirmations) {
    return "high";
  }
  return habit.timesConfirmed >= ASK_HABIT_POLICY.suggestConfirmations ? "suggest" : "none";
}

// The split command's share is the household's first person's. A habit
// holds the payer's, so convert with whether the payer is the first person.
export function firstPersonBasisPoints(payerShareBasisPoints: number, payerIsFirstPerson: boolean) {
  return payerIsFirstPerson ? payerShareBasisPoints : 10_000 - payerShareBasisPoints;
}

export function payerShareBasisPoints(firstPersonShare: number, payerIsFirstPerson: boolean) {
  return payerIsFirstPerson ? firstPersonShare : 10_000 - firstPersonShare;
}

// ---- The safe set (AGENTS.md "AI in Ask") ----------------------------------

// The only things Ask may do without the person's Save, and only when every
// condition below holds. Everything else (settle-ups, bulk edits, deletes,
// transfer links, plan changes, amounts, dates, wallets, owners, anything
// on a certified entry) always needs the person.
export const ASK_SAFE_ACTIONS = ["set_category", "add_note", "add_to_splits"] as const;
export type AskSafeAction = typeof ASK_SAFE_ACTIONS[number];

export const ASK_NEW_ENTRY_WINDOW_MINUTES = 60;

export interface AutoApplyEntryFacts {
  // Set for an imported entry.
  importId: string | null;
  bankCertificationStatus: string;
  // SQLite UTC "YYYY-MM-DD HH:MM:SS" (or ISO) creation time.
  createdAt: string;
  entryType: string;
}

export type AutoApplyRefusal =
  | "setting_off"
  | "not_safe_action"
  | "bulk"
  | "imported"
  | "certified"
  | "not_new"
  | "not_expense"
  | "low_confidence";

export interface AutoApplyInput {
  settingOn: boolean;
  action: string;
  // The number of entries the action would touch.
  entryCount: number;
  entry: AutoApplyEntryFacts;
  // Needed for set_category and add_to_splits (a note comes from the
  // person's own words, never a habit).
  confidence: AskHabitConfidence;
  now: Date;
}

export function parseStoredTimestamp(value: string): number {
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

// Whether Ask may apply the action by itself: null when it may, else why not.
export function autoApplyRefusal(input: AutoApplyInput): AutoApplyRefusal | null {
  if (!input.settingOn) return "setting_off";
  if (!(ASK_SAFE_ACTIONS as readonly string[]).includes(input.action)) return "not_safe_action";
  if (input.entryCount !== 1) return "bulk";
  if (input.entry.importId) return "imported";
  if (input.entry.bankCertificationStatus !== "provisional") return "certified";
  const createdMs = parseStoredTimestamp(input.entry.createdAt);
  const ageMinutes = (input.now.getTime() - createdMs) / 60_000;
  if (!Number.isFinite(createdMs) || ageMinutes < -5 || ageMinutes > ASK_NEW_ENTRY_WINDOW_MINUTES) return "not_new";
  if (input.action === "add_note") return null;
  if (input.entry.entryType !== "expense") return "not_expense";
  return input.confidence === "high" ? null : "low_confidence";
}
