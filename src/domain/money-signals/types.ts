// The money check-in's vocabulary (DOMAIN.md, "Money check-in"). A signal
// is one computed, true statement about the numbers a page already shows,
// with the approved ways to say it and one way to think about it. Every
// signal is built by a small pure function that either fires with its
// numbers or returns null.

export type SignalKind =
  | "quick_fix"
  | "bigger_question"
  | "worth_a_look"
  | "going_well"
  | "just_for_fun"
  | "long_view";

export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  quick_fix: "Quick fix",
  bigger_question: "Bigger question",
  worth_a_look: "Worth a look",
  going_well: "Going well",
  just_for_fun: "Just for fun",
  long_view: "Long view"
};

// Headline order: a quick fix first, because every other number depends on
// the data being right; a bigger question next; then the rest.
export const HEADLINE_KIND_ORDER: SignalKind[] = ["quick_fix", "bigger_question", "worth_a_look", "going_well"];

// Actions only reuse navigations the page already has.
export type CheckInActionId = "review-statement" | "show-entries" | "open-category" | "settle-group" | "review-matches";

export interface CheckInAction {
  id: CheckInActionId;
  label: string;
  entryIds?: string[];
  categoryName?: string;
}

// What a quote fits: matched to the headline (or the long view on a calm
// visit).
export type QuoteTopic =
  | "enjoy"
  | "small-costs"
  | "keep"
  | "enough"
  | "plan"
  | "steady"
  | "later"
  | "settle"
  | "time"
  | "calm"
  | "change";

export interface SignalPhrasing {
  fact: string;
  // A phrasing that already carries part of the thought gets a shorter
  // think line, so the two never repeat each other.
  think: string;
}

export interface MoneySignal {
  // Stable identity across visits, e.g. "statement-gap:acct-ocbc".
  key: string;
  kind: SignalKind;
  // The money involved, in minor units: ranks signals of the same kind.
  weight: number;
  // The number that decides whether the signal "moved" since the last
  // visit (10% or $50), plus any other figures the phrasings use.
  numbers: { primaryMinor: number } & Record<string, number>;
  // The primary number as shown, for "Down from $42.80 since your last
  // visit." Absent when the primary is a count.
  primaryText?: string;
  // 3 to 5 approved phrasings with the same numbers (1 for trivia).
  phrasings: SignalPhrasing[];
  action?: CheckInAction;
  // What a quick fix says once when it clears.
  sorted?: { fact: string; think: string };
  topic?: QuoteTopic;
  // A time-of-month moment or season (payday, a bonus, bills coming up, a
  // trip's end, Chinese New Year): ranked ahead of its kind.
  moment?: boolean;
}

export type Audience = "household" | "person";
