// Words used (Ask's `explain_term` and the "Words used" line of an answer):
// fixed plain explanations of the bank and app words an answer uses, as the
// owner approved them on 10 Nov 2026. No AI: a term is found by its name or
// the words that mean it, and its explanation is shown as written.
import type { BankFeeKind } from "./bank-fees-year";

export interface AskTerm {
  key: string;
  name: string;
  // Lower-case words that find it, longest first is not needed: matched as
  // whole words or phrases.
  words: readonly string[];
  text: string;
  // The bank fee kind it names, for "this year" (bank-fees-year.ts).
  feeKind?: BankFeeKind;
  // Description words that find its charges ("S&CC").
  descriptionWords?: readonly string[];
}

export const ASK_TERMS: readonly AskTerm[] = Object.freeze([
  {
    key: "usual",
    name: "Usual",
    words: ["usual", "usually", "normal"],
    text: "“Usual” is the middle amount of the last 6 months: half the months were higher and half lower, so one odd month barely moves it."
  },
  {
    key: "interest",
    name: "Interest",
    words: ["interest", "finance charge", "finance charges"],
    text: "Interest is what a bank charges on money still owed on a card after its due date. Paying the full bill by the due date means none is charged.",
    feeKind: "interest"
  },
  {
    key: "annual_fee",
    name: "Annual fee",
    words: ["annual fee", "annual fees", "membership fee", "membership fees", "annual membership fee"],
    text: "An annual fee is what some cards charge once a year, just for having the card. Banks often refund it when asked, usually soon after it's charged.",
    feeKind: "annual_fee"
  },
  {
    key: "fx_fee",
    name: "Foreign currency fee",
    words: ["foreign currency fee", "foreign currency fees", "fx fee", "fx fees", "conversion fee", "conversion fees", "currency conversion fee", "dcc", "dcc fee"],
    text: "A foreign currency fee is a small extra the bank adds when you pay in another currency, or when a shop overseas charges you in dollars.",
    feeKind: "fx_fee"
  },
  {
    key: "late_fee",
    name: "Late fee",
    words: ["late fee", "late fees", "late charge", "late charges", "late payment charge"],
    text: "A late fee is charged when less than the minimum payment reaches the bank by the due date.",
    feeKind: "late_fee"
  },
  {
    key: "fall_below_fee",
    name: "Fall-below fee",
    words: ["fall-below fee", "fall below fee", "fall below", "fall-below"],
    text: "A fall-below fee is a monthly charge some bank accounts take when the balance drops under a set amount.",
    feeKind: "account_fee"
  },
  {
    key: "scc",
    name: "S&CC",
    words: ["s&cc", "scc", "s & cc", "service and conservancy charges", "conservancy charges"],
    text: "Service and conservancy charges: the monthly payment to the town council for cleaning and looking after HDB estates.",
    descriptionWords: ["TOWN COUNCIL", "S&CC", "SCC"]
  }
]);

const normalize = (text: string) => ` ${String(text ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9&-]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** The term a text names (its longest matching words), or null. */
export function findAskTerm(text: string): AskTerm | null {
  const haystack = normalize(text);
  let best: { term: AskTerm; length: number } | null = null;
  for (const term of ASK_TERMS) {
    for (const word of term.words) {
      const needle = normalize(word);
      if (haystack.includes(needle) && (!best || needle.length > best.length)) {
        best = { term, length: needle.length };
      }
    }
  }
  return best?.term ?? null;
}

export function askTermByKey(key: string): AskTerm | null {
  return ASK_TERMS.find((term) => term.key === key) ?? null;
}

/** "What is an FX fee?", "what's S&CC", "what does fall-below fee mean". */
export function readTermQuestion(text: string): AskTerm | null {
  const lowered = String(text ?? "").toLowerCase().trim();
  if (!/^(?:what(?:'|’)?s|what is|what are|whats|what does|what do|explain|meaning of)\b/.test(lowered)) {
    return null;
  }
  const term = findAskTerm(lowered);
  // "usual" is explained beside the answer that uses it, not on its own.
  return term && term.key !== "usual" ? term : null;
}
