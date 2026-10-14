// When Ask asks and when it drafts (docs/flows/ask-flow.md, "Three
// principles", second): draft with the assumption showing, and ask only when
// two readings of the message would lead to materially different saves or
// answers.
//
// A "reading" is one thing the message could mean, with the `effect` it
// would have: a short signature of what would be written or answered
// (`entry:txn-1`, `group:split-group-home`, `person:person-joyce`). Two
// readings with the same effect are the same reading, however they were
// reached. Readings with different effects are materially different.
//
// `basis` says how the reading was reached, strongest first:
//   stated   the person named it (an exact or clearly matching name)
//   focus    the entry, card or group in focus is what "this" means
//   default  the app's own default (the viewer, the wallet's owner, this month)
//   guess    nothing in the message or context points to it
//
// The rule, in `decideReadings`:
//   - one effect left: proceed;
//   - the strongest basis is stated or focus, and one reading holds it: proceed;
//   - the strongest basis is default or guess, and one reading holds it:
//     draft with that reading and show it as an assumption, with the others
//     as one-tap alternatives;
//   - two or more different effects share the strongest basis: ask, with the
//     tied readings as the chips.
// Nothing here writes or reads anything; it is the rule, in one place.

export type ReadingBasis = "stated" | "focus" | "default" | "guess";

export interface AskReading<T = string> {
  value: T;
  // What the person reads on a chip or in the assumption line.
  label: string;
  effect: string;
  basis: ReadingBasis;
}

export type AmbiguityDecision<T = string> =
  | { kind: "none" }
  | { kind: "proceed"; chosen: AskReading<T> }
  | { kind: "assume"; chosen: AskReading<T>; alternatives: AskReading<T>[] }
  | { kind: "ask"; options: AskReading<T>[] };

const RANK: Record<ReadingBasis, number> = { stated: 3, focus: 2, default: 1, guess: 0 };
const MAX_OPTIONS = 4;

export function decideReadings<T>(readings: readonly AskReading<T>[]): AmbiguityDecision<T> {
  // One reading per effect: the strongest way of reaching it.
  const byEffect = new Map<string, AskReading<T>>();
  for (const reading of readings) {
    const held = byEffect.get(reading.effect);
    if (!held || RANK[reading.basis] > RANK[held.basis]) byEffect.set(reading.effect, reading);
  }
  const distinct = [...byEffect.values()];
  if (!distinct.length) return { kind: "none" };
  if (distinct.length === 1) return { kind: "proceed", chosen: distinct[0] };
  const top = Math.max(...distinct.map((reading) => RANK[reading.basis]));
  const leaders = distinct.filter((reading) => RANK[reading.basis] === top);
  if (leaders.length > 1) return { kind: "ask", options: leaders.slice(0, MAX_OPTIONS) };
  const [chosen] = leaders;
  if (chosen.basis === "stated" || chosen.basis === "focus") return { kind: "proceed", chosen };
  return { kind: "assume", chosen, alternatives: distinct.filter((reading) => reading !== chosen).slice(0, MAX_OPTIONS - 1) };
}

// An assumption the reply carries, in plain words: what was assumed, and the
// short messages a tap sends instead (each is a whole instruction, because a
// tap sends it as the next message).
export interface AskAssumption {
  text: string;
  chips: string[];
}

export const ASSUMPTION_TEXT_MAX = 140;
export const ASSUMPTION_CHIP_MAX = 40;
export const ASSUMPTION_MAX_CHIPS = 3;

export function assumption(text: string, chips: readonly string[] = []): AskAssumption {
  return {
    text: text.replace(/\s+/g, " ").trim().slice(0, ASSUMPTION_TEXT_MAX),
    chips: chips
      .map((chip) => chip.replace(/\s+/g, " ").trim().slice(0, ASSUMPTION_CHIP_MAX))
      .filter((chip, index, all) => chip && all.indexOf(chip) === index)
      .slice(0, ASSUMPTION_MAX_CHIPS)
  };
}

// Why Ask is asking, for the repair turn and the measure of how often it
// needs one (docs/flows/ask-flow.md, "Repair before asking"). Codes only:
// never the message, a name or an amount.
export const ASK_ERROR_CODES = [
  "unknown_person",
  "unknown_wallet",
  "unknown_category",
  "unknown_group",
  "ambiguous_name",
  "amount_not_stated",
  "amount_needed",
  "shares_unreadable",
  "shares_mismatch",
  "date_invalid",
  "month_invalid",
  "no_entry_in_focus",
  "plan_unreadable",
  "question_unclear",
  "search_empty",
  "field_missing",
  "nothing_to_change",
  "other"
] as const;
export type AskErrorCode = typeof ASK_ERROR_CODES[number];

// What the validator found wrong, machine-readable: the field, the code, and
// the options that would have been valid. Never sent to the page.
export interface AskValidatorError {
  code: AskErrorCode;
  field: string;
  // The valid options for that field (people, wallets, groups, ...), short.
  valid?: string[];
  // What the person's message said for it, as the model reported it.
  got?: string;
}
