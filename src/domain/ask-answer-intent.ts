// The Ask answer intent reader (DOMAIN.md "Money Question"; docs/flows/
// ask-flow.md "Money questions"): a free-form money question such as "why
// was August so expensive?" or "what do I owe Serene?" read by rules into
// one of six intents, or null. No AI and no request: the same text and
// context always read the same way.
//
// Shared by the answer route (src/server/ask-answer-route.ts), which reads
// the question again and is the authority, and the Ask page, which uses it
// to send a money question to the route before the filter reader could
// read it as a search ("expensive") or a which-month question.
//
// It is deliberately narrow: a request with an amount, or one that names a
// category or a wallet where that changes the answer (the biggest grocery,
// the income into a card), is left to the filter reader, and anything it
// does not recognise is null, so the page keeps its "not answered" note.

export type AskAnswerIntent =
  | { kind: "spending"; focus: "why" | "where"; month: string }
  // `months`: a quarter ("did we stick to the plan in Q3?"), oldest first,
  // up to this month; `month` is then its last month.
  | { kind: "plan"; month: string; months?: string[] }
  | { kind: "compare"; month: string; otherMonth: string }
  | { kind: "biggest"; month: string }
  | { kind: "owed"; personId: string | null }
  | { kind: "income"; month: string };

export type AskAnswerIntentKind = AskAnswerIntent["kind"];

export interface AskAnswerIntentContext {
  // Today in the app's time zone (YYYY-MM-DD): "this month" and how a month
  // name resolves to a year.
  today: string;
  // The month Ask is looking at (YYYY-MM), used when the question names none.
  month: string;
  people: Array<{ id: string; name: string }>;
  // Category and wallet names. A biggest or income question that names one
  // is a filter request ("biggest groceries"), not a whole-month answer.
  vocabulary?: string[];
}

const MONTH_WORDS = new Map<string, number>([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3], ["april", 4], ["apr", 4],
  ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7], ["august", 8], ["aug", 8], ["september", 9],
  ["sept", 9], ["sep", 9], ["october", 10], ["oct", 10], ["november", 11], ["nov", 11], ["december", 12], ["dec", 12]
]);
const MONTH_LEAD_WORDS = new Set(["in", "for", "during", "of", "since", "from", "with", "to", "than", "and", "vs", "versus"]);
const COMPARE_LEAD_WORDS = new Set(["to", "with", "than", "against", "vs", "versus"]);
const QUESTION_STARTS = new Set([
  "how", "what", "whats", "when", "where", "which", "who", "whos", "why", "did", "do", "does", "is", "are", "am",
  "was", "were", "can", "could", "have", "has", "compare", "tell", "explain", "show", "give", "break",
  "top", "biggest", "largest"
]);
// Words that make a name too plain to count as naming a wallet or category.
const GENERIC_NAME_WORDS = new Set(["card", "account", "the", "and", "other", "income", "one", "cash", "back", "extra", "mo", "yr", "transfer"]);

interface Token {
  text: string;
  index: number;
}

interface MonthRef {
  month: string;
  // The word before it ("to", "than", "with"...).
  lead: string;
}

/**
 * @returns the intent, or null when the text is not a supported money question.
 */
export function readAnswerIntent(text: string, context: AskAnswerIntentContext): AskAnswerIntent | null {
  const normalized = normalize(text);
  if (!normalized) {
    return null;
  }
  const tokens = tokenize(normalized);
  if (!tokens.length || !isQuestionForm(text, tokens)) {
    return null;
  }
  // An amount makes it a filter ("more than $500") or an entry ("I owe
  // Serene $20"), never a whole-month answer.
  if (tokens.some((token) => /^\$?\d[\d,]*(?:\.\d+)?k?$/.test(token.text) && !/^20\d{2}$/.test(token.text))) {
    return null;
  }
  const words = new Set(tokens.map((token) => token.text));
  const has = (pattern: RegExp) => pattern.test(normalized);
  const refs = readMonthRefs(tokens, context);
  const month = refs[0]?.month ?? context.month;

  // Who owes whom: Splits balances, whatever month is named.
  if (has(/\b(owe|owes|owed|owing)\b/) || has(/\bsettled? up\b/) || has(/\bsplits? balance/)) {
    return { kind: "owed", personId: findPerson(tokens, context.people)?.id ?? null };
  }

  // Two months side by side.
  const comparing = has(/\b(compare|compared|comparison|vs|versus)\b/)
    || (has(/\b(more|less|higher|lower)\b/) && refs.some((ref) => ref.lead === "than"));
  if (comparing) {
    return readCompare(refs, context);
  }

  const namesVocabulary = mentionsVocabulary(tokens, context.vocabulary ?? []);
  // A quarter is answered only as intent against outcome; any other
  // question about a quarter is not answered rather than answered for one
  // month.
  const quarter = readQuarter(tokens, context.today);
  if (quarter === "unreadable") {
    return null;
  }

  // Income before the plan: "did income match the plan?" is about income.
  if (has(/\b(income|earn|earned|earning|earnings|salary|came in)\b/)) {
    return namesVocabulary || quarter ? null : { kind: "income", month };
  }

  // Intent against outcome: the plan, staying on it, or how a month went
  // ("how did September go?", "how was August?", "how did we do?").
  const howItWent = /^how (did|was|were|has|have|is|are)\b/.test(normalized)
    && !has(/\b(much|many|often|long)\b/)
    && (refs.length > 0 || quarter !== null || has(/\b(go|went|going|gone|do|did|doing|done|turn|turned|end|ended|look|looking)\b/));
  if (has(/\b(plan|planned|budget|budgets)\b/) || has(/\bon (track|target)\b/) || has(/\b(stick|stuck|stay|stayed)\b/) || howItWent) {
    if (quarter) {
      return { kind: "plan", month: quarter[quarter.length - 1], months: quarter };
    }
    return { kind: "plan", month };
  }
  if (quarter) {
    return null;
  }

  if (has(/\bwhere\b/) && (has(/\b(go|went|going|gone)\b/) || has(/\b(spend|spent|spending|money)\b/))) {
    return { kind: "spending", focus: "where", month };
  }
  if (has(/\b(spend|spent)\b.*\bmost\b/) || has(/\b(top|biggest|largest) categor/) || has(/\bbreak ?down\b/)) {
    return { kind: "spending", focus: "where", month };
  }
  if (words.has("why") && (has(/\b(expensive|much|high|higher|more|big|bigger|spend|spent|spending|cost|costly)\b/))) {
    return { kind: "spending", focus: "why", month };
  }

  if (has(/\b(biggest|largest|most expensive|top|highest|priciest|costliest)\b/) && has(/\b(expense|expenses|purchase|purchases|spend|spending|cost|costs|item|items|payment|payments|thing|things|buy|buys|bought)\b/)) {
    return namesVocabulary ? null : { kind: "biggest", month };
  }

  return null;
}

function readCompare(refs: MonthRef[], context: AskAnswerIntentContext): AskAnswerIntent | null {
  const distinct = refs.filter((ref, index) => refs.findIndex((other) => other.month === ref.month) === index);
  if (distinct.length >= 2) {
    return { kind: "compare", month: distinct[0].month, otherMonth: distinct[1].month };
  }
  if (refs.length >= 2 || !distinct.length) {
    // The same month twice, or none: nothing to compare.
    return null;
  }
  const [ref] = distinct;
  if (COMPARE_LEAD_WORDS.has(ref.lead)) {
    // "compared to last month": the month Ask shows against the named one.
    const base = context.month > ref.month ? context.month : addMonths(ref.month, 1);
    const capped = base > context.today.slice(0, 7) ? context.today.slice(0, 7) : base;
    return capped === ref.month ? null : { kind: "compare", month: capped, otherMonth: ref.month };
  }
  // "compare July": that month against the one before it.
  return { kind: "compare", month: ref.month, otherMonth: addMonths(ref.month, -1) };
}

function normalize(text: string) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bwhat's\b/g, "whats")
    .replace(/\bwho's\b/g, "whos")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Token[] {
  const matches = text.match(/\d{4}-\d{2}(?:-\d{2})?|\$?\d[\d,]*(?:\.\d+)?k?|[a-z][a-z0-9]*(?:'s)?/g) ?? [];
  return matches.map((match, index) => ({ text: match.replace(/'s$/, ""), index }));
}

function isQuestionForm(raw: string, tokens: Token[]) {
  return /\?\s*$/.test(raw.trim()) || QUESTION_STARTS.has(tokens[0].text);
}

function readMonthRefs(tokens: Token[], context: AskAnswerIntentContext): MonthRef[] {
  const refs: MonthRef[] = [];
  const thisMonth = context.today.slice(0, 7);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const lead = tokens[index - 1]?.text ?? "";
    if ((token.text === "this" || token.text === "last" || token.text === "previous") && next?.text === "month") {
      refs.push({ month: token.text === "this" ? thisMonth : addMonths(thisMonth, -1), lead });
      index += 1;
      continue;
    }
    if (/^\d{4}-\d{2}$/.test(token.text)) {
      refs.push({ month: token.text, lead });
      continue;
    }
    const monthNumber = MONTH_WORDS.get(token.text);
    if (!monthNumber) {
      continue;
    }
    const hasYear = Boolean(next && /^20\d{2}$/.test(next.text));
    // "may" is a month only when it reads as one ("in may", "may 2026").
    if (token.text === "may" && !hasYear && !MONTH_LEAD_WORDS.has(lead)) {
      continue;
    }
    let year = Number(thisMonth.slice(0, 4));
    if (hasYear) {
      year = Number(next.text);
      index += 1;
    } else if (`${year}-${String(monthNumber).padStart(2, "0")}` > thisMonth) {
      year -= 1;
    }
    refs.push({ month: `${year}-${String(monthNumber).padStart(2, "0")}`, lead });
  }
  return refs;
}

const QUARTER_WORDS = new Map<string, number>([["first", 1], ["1st", 1], ["second", 2], ["2nd", 2], ["third", 3], ["3rd", 3], ["fourth", 4], ["4th", 4]]);

// A quarter named in the question, as its months up to this month: "Q3",
// "q3 2025", "the third quarter", "this quarter", "last quarter". A quarter
// without a year is the latest one that has started. Null when none is
// named; "unreadable" when the quarter has not started yet.
function readQuarter(tokens: Token[], today: string): string[] | null | "unreadable" {
  const thisMonth = today.slice(0, 7);
  const thisYear = Number(thisMonth.slice(0, 4));
  const thisQuarter = Math.floor((Number(thisMonth.slice(5, 7)) - 1) / 3) + 1;
  let quarter = 0;
  let year: number | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].text;
    const next = tokens[index + 1]?.text ?? "";
    const named = /^q[1-4]$/.test(token) ? Number(token.slice(1)) : next === "quarter" ? QUARTER_WORDS.get(token) ?? 0 : 0;
    if (named) {
      quarter = named;
      const yearToken = tokens[index + (next === "quarter" ? 2 : 1)]?.text ?? "";
      year = /^20\d{2}$/.test(yearToken) ? Number(yearToken) : null;
      break;
    }
    if ((token === "this" || token === "last" || token === "previous") && next === "quarter") {
      const index0 = thisYear * 4 + thisQuarter - 1 - (token === "this" ? 0 : 1);
      quarter = (index0 % 4) + 1;
      year = Math.floor(index0 / 4);
      break;
    }
  }
  if (!quarter) {
    return null;
  }
  const resolvedYear = year ?? (quarter <= thisQuarter ? thisYear : thisYear - 1);
  const first = `${resolvedYear}-${String(quarter * 3 - 2).padStart(2, "0")}`;
  if (first > thisMonth) {
    return "unreadable";
  }
  return [0, 1, 2].map((offset) => addMonths(first, offset)).filter((month) => month <= thisMonth);
}

function findPerson(tokens: Token[], people: AskAnswerIntentContext["people"]) {
  return people.find((person) => {
    const first = normalize(person.name).split(/[^a-z0-9]+/).filter(Boolean)[0];
    return Boolean(first) && tokens.some((token) => token.text === first);
  });
}

function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// A category or wallet name: the whole name, or one distinctive word of it
// ("groceries", "citi").
function mentionsVocabulary(tokens: Token[], vocabulary: string[]) {
  const stems = new Set(tokens.map((token) => stem(token.text)));
  return vocabulary.some((name) => {
    const nameWords = normalize(name).split(/[^a-z0-9]+/).filter(Boolean);
    return nameWords.some((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word) && stems.has(stem(word)));
  });
}

export function addMonths(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
