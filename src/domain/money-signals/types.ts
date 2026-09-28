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
  // Every think line this phrasing may pair with (`think` is the first).
  // The fact and think pairs are the signal's wordings (rotation.ts).
  thinks?: string[];
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
  // Just for fun only: the trivia type, the name the page's year rotation
  // schedules (rotation.ts), e.g. "smallest".
  triviaType?: string;
  action?: CheckInAction;
  // What a quick fix says once when it clears.
  sorted?: { fact: string; think: string };
  topic?: QuoteTopic;
  // A time-of-month moment or season (payday, a bonus, bills coming up,
  // Chinese New Year): ranked ahead of its kind. A Just for fun moment (a
  // year recap, an anniversary) goes ahead of the scheduled trivia, and may
  // fire in at most one period of any twelve.
  moment?: boolean;
  // A quick fix about something outside the view's own period (a wallet's
  // statement on Month) that goes right after a bigger question instead of
  // ahead of it.
  yieldsToBiggerQuestion?: boolean;
  // Notability. A signal that is true almost every month (the five largest
  // entries' share, the subscriptions total, months under plan, plan left)
  // is `steady` when this period's numbers are not unusual: it never leads
  // the check-in and shows at most under Also. With a `turn` it may still
  // lead in one month of each quarter (rotation.ts, isQuarterTurn), so
  // something true every month is said now and then, never every month.
  steady?: boolean;
  turn?: QuarterTurn;
}

// Which month of each quarter a steady signal may lead in: the period's
// running month number mod 3 (0: Jan, Apr, Jul, Oct; 1: Feb, May, Aug, Nov;
// 2: Mar, Jun, Sep, Dec).
export type QuarterTurn = 0 | 1 | 2;

export type Audience = "household" | "person";
