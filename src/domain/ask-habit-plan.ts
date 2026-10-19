// What Ask's habits say about one entry (DOMAIN.md "Ask Habit",
// "Suggestion row"). Pure and deterministic: no AI, no reads. The server
// (src/server/ask-habits-routes.ts) loads the entry, the habits, the two
// share people and the split groups, then shows the plan as one quiet row
// or, for a high-confidence habit on a new entry, applies it.
//
// A habit speaks only when it still fits the entry:
// - category: the shop's habit names a category that exists and is not the
//   one the entry already has;
// - split: the entry is an expense that is not on Splits, its payer is the
//   habit's payer and one of the two share people, and the habit's group
//   still exists in the entry's currency.

import {
  ASK_CATCH_ALL_CATEGORIES,
  firstPersonBasisPoints,
  habitConfidence,
  habitMerchantKey,
  type AskCategoryHabitValue,
  type AskHabit,
  type AskHabitConfidence,
  type AskSplitHabitValue
} from "./ask-habits";

export interface HabitEntryFacts {
  id: string;
  description: string;
  entryType: string;
  currency: string;
  categoryName: string | null;
  payerPersonId: string | null;
  onSplits: boolean;
}

export interface HabitPlanGroup {
  id: string;
  name: string;
  currency: string;
}

export interface HabitPlanPerson {
  id: string;
  name: string;
}

export interface HabitCategoryPart {
  habitId: string;
  confidence: Exclude<AskHabitConfidence, "none">;
  from: string | null;
  to: string;
}

export interface HabitSplitPart {
  habitId: string;
  confidence: Exclude<AskHabitConfidence, "none">;
  groupId: string | null;
  groupName: string | null;
  // The payer's share and the share the split command takes (the first
  // share person's).
  payerShareBasisPoints: number;
  firstPersonBasisPoints: number;
  otherPersonName: string;
}

export interface HabitPlan {
  category: HabitCategoryPart | null;
  split: HabitSplitPart | null;
}

export function planEntryHabits(input: {
  entry: HabitEntryFacts;
  habits: AskHabit[];
  categoryNames: string[];
  sharePeople: HabitPlanPerson[];
  groups: HabitPlanGroup[];
  today: string;
}): HabitPlan {
  const { entry, habits, today } = input;
  const key = habitMerchantKey(entry.description);
  const plan: HabitPlan = { category: null, split: null };
  if (!key || entry.entryType !== "expense") {
    return plan;
  }

  const categoryHabit = habits.find((habit) => habit.kind === "category" && habit.key === key);
  if (categoryHabit) {
    const confidence = habitConfidence(categoryHabit, today);
    const to = (categoryHabit.value as AskCategoryHabitValue).categoryName;
    if (confidence !== "none" && to !== entry.categoryName && !ASK_CATCH_ALL_CATEGORIES.has(to) && input.categoryNames.includes(to)) {
      plan.category = { habitId: categoryHabit.id, confidence, from: entry.categoryName, to };
    }
  }

  const splitHabit = habits.find((habit) => habit.kind === "split" && habit.key === key);
  if (splitHabit && !entry.onSplits && entry.payerPersonId) {
    const confidence = habitConfidence(splitHabit, today);
    const value = splitHabit.value as AskSplitHabitValue;
    const [first] = input.sharePeople;
    const other = input.sharePeople.find((person) => person.id !== entry.payerPersonId);
    const payerIsSharePerson = input.sharePeople.some((person) => person.id === entry.payerPersonId);
    const group = value.groupId ? input.groups.find((candidate) => candidate.id === value.groupId) : null;
    const groupUsable = !value.groupId || (group !== undefined && group !== null && group.currency === entry.currency);
    if (confidence !== "none" && first && other && payerIsSharePerson && value.payerPersonId === entry.payerPersonId && groupUsable) {
      plan.split = {
        habitId: splitHabit.id,
        confidence,
        groupId: value.groupId,
        groupName: group?.name ?? null,
        payerShareBasisPoints: value.payerShareBasisPoints,
        firstPersonBasisPoints: firstPersonBasisPoints(value.payerShareBasisPoints, entry.payerPersonId === first.id),
        otherPersonName: other.name
      };
    }
  }
  return plan;
}

// "half each" for an even split (the app never says 50/50), else the payer's
// share first ("70/30").
export function shareLabel(payerShareBasisPoints: number) {
  const payer = Math.round(payerShareBasisPoints / 100);
  return payer === 50 ? "half each" : `${payer}/${100 - payer}`;
}

// The one quiet line: "Food & Drinks · Add to splits half each with Joyce, as
// you usually do". Parts are joined with a middle dot; a plan with nothing
// to say has no line.
export function suggestionLine(plan: HabitPlan): string {
  const parts: string[] = [];
  if (plan.category) {
    parts.push(plan.category.to);
  }
  if (plan.split) {
    const group = plan.split.groupName ? ` in ${plan.split.groupName}` : "";
    parts.push(`Add to splits ${shareLabel(plan.split.payerShareBasisPoints)} with ${plan.split.otherPersonName}${group}`);
  }
  return parts.length ? `${parts.join(" · ")}, as you usually do` : "";
}
