// Split suggestion (DOMAIN.md "Split Suggestion"): when a new expense looks
// like the ones its payer usually puts on Splits, the split group, share and
// other person to suggest. Pure and deterministic (no AI, no reads, no
// writes); split-suggestion-projection.ts loads its inputs.
//
// The rule:
// - only an expense with one owner who is one of the two people Splits
//   shares between, and never one already on Splits;
// - the owner's own expense entries in the 12 months up to the entry's day
//   are the history (never the entry itself, never income or transfers);
// - entries at the same shop (normalizeDescriptionForMatch) decide. Only
//   when the shop has too little history to judge (fewer entries than its
//   minimum evidence) does the same category decide, with a stricter bar,
//   and never a catch-all category such as Other;
// - a matching entry counts for a habit when its active split was paid by
//   the owner and shared between the owner and the other share person
//   only, in a group that still exists and that the split routes accept for
//   the entry's currency. The habit is one group with one share basis;
// - the most common habit is suggested when it has at least `minEvidence`
//   entries and at least `minShare` of all matching entries (split or not).
//   Two habits tied for first suggest nothing.

import { normalizeDescriptionForMatch } from "./app-repository-helpers";
import type { SplitSuggestionDto } from "../types/dto";

export const SPLIT_SUGGESTION_POLICY = Object.freeze({
  lookbackDays: 365,
  description: Object.freeze({ minEvidence: 2, minShare: 0.6 }),
  category: Object.freeze({ minEvidence: 4, minShare: 0.75 })
});

export const NON_GROUP_SPLIT_ID = "split-group-none";

// Categories that hold anything: sharing one says nothing about a habit.
const CATCH_ALL_CATEGORIES = new Set(["Other", "Other - Income", "Income", "Transfer"]);

export interface SplitSuggestionTarget {
  // A saved entry (the Apple Pay card) is left out of its own history.
  entryId?: string | null;
  entryType: string;
  description: string;
  categoryName?: string | null;
  ownerPersonId?: string | null;
  currency: string;
  // ISO YYYY-MM-DD, the entry's event date.
  date: string;
  onSplits?: boolean;
}

export interface SplitSuggestionHistoryEntry {
  entryId: string;
  date: string;
  entryType: string;
  description: string;
  categoryName: string | null;
  // The entry owner, else the account owner (the split payer rule).
  ownerPersonId: string | null;
  // The entry's active split expense, if any.
  split: {
    groupId: string | null;
    payerPersonId: string;
    shares: Array<{ personId: string; basisPoints: number }>;
  } | null;
}

export interface SplitSuggestionGroup {
  id: string;
  name: string;
  currency: string;
}

export interface SplitSuggestionPerson {
  id: string;
  name: string;
}

type Tier = "description" | "category";

export function suggestSplitForEntry(input: {
  target: SplitSuggestionTarget;
  history: SplitSuggestionHistoryEntry[];
  groups: SplitSuggestionGroup[];
  // The two people a split is shared between (the split routes' pair).
  sharePeople: SplitSuggestionPerson[];
  policy?: typeof SPLIT_SUGGESTION_POLICY;
}): SplitSuggestionDto | null {
  const { target, groups, sharePeople } = input;
  const policy = input.policy ?? SPLIT_SUGGESTION_POLICY;
  if (target.entryType !== "expense" || target.onSplits || sharePeople.length !== 2) {
    return null;
  }
  const owner = sharePeople.find((person) => person.id === target.ownerPersonId);
  const other = sharePeople.find((person) => person.id !== target.ownerPersonId);
  if (!owner || !other || !isIsoDate(target.date)) {
    return null;
  }

  const windowStart = shiftIsoDate(target.date, -policy.lookbackDays);
  const ownHistory = input.history.filter((entry) => (
    entry.entryType === "expense"
    && entry.ownerPersonId === owner.id
    && entry.entryId !== target.entryId
    && entry.date >= windowStart
    && entry.date <= target.date
  ));

  const shopKey = normalizeDescriptionForMatch(target.description ?? "");
  const atShop = shopKey ? ownHistory.filter((entry) => normalizeDescriptionForMatch(entry.description) === shopKey) : [];
  const evaluate = (matches: SplitSuggestionHistoryEntry[], tier: Tier) => findHabit({ matches, tier, owner, other, groups, currency: target.currency, policy });

  if (atShop.length >= policy.description.minEvidence) {
    return evaluate(atShop, "description");
  }
  const categoryName = target.categoryName?.trim() ?? "";
  if (!categoryName || CATCH_ALL_CATEGORIES.has(categoryName)) {
    return null;
  }
  return evaluate(ownHistory.filter((entry) => entry.categoryName === categoryName), "category");
}

function findHabit({ matches, tier, owner, other, groups, currency, policy }: {
  matches: SplitSuggestionHistoryEntry[];
  tier: Tier;
  owner: SplitSuggestionPerson;
  other: SplitSuggestionPerson;
  groups: SplitSuggestionGroup[];
  currency: string;
  policy: typeof SPLIT_SUGGESTION_POLICY;
}): SplitSuggestionDto | null {
  const { minEvidence, minShare } = policy[tier];
  if (!matches.length) {
    return null;
  }
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const habits = new Map<string, { group: SplitSuggestionGroup; basisPoints: number; count: number }>();
  for (const entry of matches) {
    const habit = readHabit(entry, { owner, other, groupById, currency });
    if (!habit) continue;
    const key = `${habit.group.id}|${habit.basisPoints}`;
    const current = habits.get(key);
    habits.set(key, current ? { ...current, count: current.count + 1 } : { ...habit, count: 1 });
  }
  const ranked = [...habits.values()].sort((left, right) => right.count - left.count);
  const [top, runnerUp] = ranked;
  if (!top || (runnerUp && runnerUp.count === top.count)) {
    return null;
  }
  if (top.count < minEvidence || top.count / matches.length < minShare) {
    return null;
  }
  return {
    groupId: top.group.id,
    groupName: top.group.name,
    basisPoints: top.basisPoints,
    otherPersonId: other.id,
    otherPersonName: other.name,
    evidenceCount: top.count,
    matchedCount: matches.length,
    matchedBy: tier
  };
}

// The group and owner share of one past entry's split, when it is a split
// this entry could repeat: paid by the owner, shared with the other person
// only, in a group that exists and takes the entry's currency.
function readHabit(
  entry: SplitSuggestionHistoryEntry,
  { owner, other, groupById, currency }: {
    owner: SplitSuggestionPerson;
    other: SplitSuggestionPerson;
    groupById: Map<string, SplitSuggestionGroup>;
    currency: string;
  }
) {
  const split = entry.split;
  if (!split || split.payerPersonId !== owner.id) {
    return null;
  }
  const people = new Set(split.shares.map((share) => share.personId));
  if (split.shares.length !== 2 || people.size !== 2 || !people.has(owner.id) || !people.has(other.id)) {
    return null;
  }
  // Stored shares carry the cent rounding ($24.01 split evenly is 49.98%),
  // so the share is read to the whole percent.
  const storedBasisPoints = split.shares.find((share) => share.personId === owner.id)?.basisPoints ?? 0;
  const basisPoints = Math.round(storedBasisPoints / 100) * 100;
  if (!(basisPoints > 0 && basisPoints < 10000)) {
    return null;
  }
  const group = groupById.get(split.groupId ?? NON_GROUP_SPLIT_ID);
  // Non-group expenses take any currency; a group only its own.
  if (!group || (group.id !== NON_GROUP_SPLIT_ID && group.currency.toUpperCase() !== currency.toUpperCase())) {
    return null;
  }
  return { group, basisPoints };
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
