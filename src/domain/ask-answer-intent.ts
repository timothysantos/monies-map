// The Ask answer intent reader (DOMAIN.md "Money Question"; docs/flows/
// ask-flow.md "Money questions"): a free-form money question such as "why
// was August so expensive?" or "what do I owe Serene?" read by rules into
// one of nine intents, or null. No AI and no request: the same text and
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
//
// The money jobs' questions (the Month and Summary lead's "Ask about this",
// money-jobs-detail.js, and the same questions typed by hand) have their
// own intents: how much was invested, how much was saved (kept), and
// spending against what came in. A period ("from Oct 2025 to Sep 2026",
// "Q3") reads as its months for every answer that can add months up.

import { readTermQuestion } from "./ask-terms";

// `months`: a period ("did we stick to the plan in Q3?", "how much did I
// invest from Oct 2025 to Sep 2026?"), oldest first, up to this month;
// `month` is then its last month.
export type AskAnswerIntent =
  | { kind: "spending"; focus: "why" | "where"; month: string; months?: string[] }
  | { kind: "plan"; month: string; months?: string[] }
  | { kind: "compare"; month: string; otherMonth: string }
  | { kind: "biggest"; month: string }
  | { kind: "owed"; personId: string | null }
  | { kind: "income"; month: string; months?: string[] }
  // The money jobs (DOMAIN.md "Money job"): money put into Investments,
  // what was kept (saved), and spending against what came in.
  | { kind: "invested"; month: string; months?: string[] }
  | { kind: "saved"; month: string; months?: string[] }
  | { kind: "spentVsEarned"; month: string; months?: string[] }
  // Against its usual level (DOMAIN.md "Usual Level"): a shop, a category, a
  // person or the month's spending, as written (null: the month's spending).
  | { kind: "usual"; subject: string | null; month: string }
  // A bank or app word explained (ask-terms.ts): "what's an FX fee?".
  | { kind: "term"; term: string; month: string }
  // What changed in a month, against the month before or its usual
  // (ask-changed.ts): "what changed this month?", "why did we spend more in
  // October?".
  | { kind: "changed"; month: string; base: "previous" | "usual" }
  // If this keeps up (ask-pace.ts; DOMAIN.md "Pace"): "how will November
  // end if this keeps up?", "where will this month end up?".
  | { kind: "pace"; month: string };

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

// The longest period an answer adds up: the Summary's default range.
export const MAX_PERIOD_MONTHS = 12;

const MONTH_WORDS = new Map<string, number>([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3], ["april", 4], ["apr", 4],
  ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7], ["august", 8], ["aug", 8], ["september", 9],
  ["sept", 9], ["sep", 9], ["october", 10], ["oct", 10], ["november", 11], ["nov", 11], ["december", 12], ["dec", 12]
]);
const MONTH_LEAD_WORDS = new Set(["in", "for", "during", "of", "since", "from", "with", "to", "than", "and", "vs", "versus", "between", "until", "till", "through"]);
const COMPARE_LEAD_WORDS = new Set(["to", "with", "than", "against", "vs", "versus"]);
// "than last month", "than in July": measured against another month.
const THAN_A_MONTH = new RegExp(`\\bthan (?:in |during |for )?(?:(?:this|last|previous) month|\\d{4}-\\d{2}|(?:${[...MONTH_WORDS.keys()].join("|")})\\b)`);
const RANGE_START_LEADS = new Set(["from", "between"]);
const RANGE_END_LEADS = new Set(["to", "until", "till", "through", "and"]);
const QUESTION_STARTS = new Set([
  "how", "what", "whats", "wat", "when", "where", "which", "who", "whos", "why", "did", "do", "does", "is", "are", "am",
  "was", "were", "can", "could", "have", "has", "compare", "tell", "explain", "show", "give", "break",
  "top", "biggest", "largest"
]);
// A search or filter command is never a money job's question ("show invest
// in a new phone case" searches).
const COMMAND_STARTS = new Set(["show", "find", "search", "list", "filter"]);
// Words that make a name too plain to count as naming a wallet or category.
const GENERIC_NAME_WORDS = new Set(["card", "account", "the", "and", "other", "income", "one", "cash", "back", "extra", "mo", "yr", "transfer"]);
// The money jobs' own words (as stems). The Investments and Savings
// categories share them, so "how much went into investments?" asks the
// invested question rather than naming a category to filter by.
const MONEY_JOB_STEMS = new Set(["invest", "investment", "save", "saving", "income", "earning", "salary", "spend", "spending", "expense"]);

interface Token {
  text: string;
  index: number;
}

interface MonthRef {
  month: string;
  // The word before it ("to", "than", "with"...).
  lead: string;
  // The year was said ("Oct 2025", "2026-03", "last month").
  hasYear: boolean;
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
  // A word explained, before anything reads "fee" or "interest" as money.
  const term = readTermQuestion(text);
  if (term) {
    return { kind: "term", term: term.key, month: context.month };
  }
  const words = new Set(tokens.map((token) => token.text));
  const has = (pattern: RegExp) => pattern.test(normalized);
  const allRefs = readMonthRefs(tokens, context);

  // A period: a quarter, or a range of months. One that has not started, or
  // is longer than MAX_PERIOD_MONTHS, is not answered rather than answered
  // for part of it.
  const range = readRange(allRefs, context.today);
  const quarter = readQuarter(tokens, context.today);
  if (quarter === "unreadable" || range === "unreadable") {
    return null;
  }
  const period = range?.months ?? quarter;
  // The months named outside the range ("compared with July").
  const refs = range ? allRefs.filter((ref) => !range.refs.includes(ref)) : allRefs;
  const distinctMonths = new Set(refs.map((ref) => ref.month)).size;
  const month = period ? period[period.length - 1] : refs[0]?.month ?? context.month;
  const over = <T extends AskAnswerIntent>(intent: T): T => (period ? { ...intent, months: period } : intent);

  // Who owes whom: Splits balances, whatever month is named.
  if (has(/\b(owe|owes|owed|owing)\b/) || has(/\bsettled? up\b/) || has(/\bsplits? balance/)) {
    return { kind: "owed", personId: findPerson(tokens, context.people)?.id ?? null };
  }

  // If this keeps up: where the month ends, before "usual" reads it.
  if (PACE_WORDS.test(normalized) && !period && distinctMonths < 2) {
    return { kind: "pace", month };
  }

  // What changed in a month, before "usual" or "why" read it otherwise.
  if (CHANGED_WORDS.test(normalized) && !period && distinctMonths < 2) {
    return { kind: "changed", month, base: /\b(?:usual|usually|normal)\b/.test(normalized) ? "usual" : "previous" };
  }

  // Against the usual level: "is Grab more than usual?", "groceries
  // normal?", "do we usually spend this much on Taxi?".
  if (USUAL_WORDS.test(normalized) && !period) {
    return { kind: "usual", subject: readUsualSubject(tokens, context), month };
  }

  // The money jobs' questions, before a comparison could read "compare my
  // spending with my income" as two months. One naming a category or
  // wallet ("how much did I invest in Endowus?") stays a filter request,
  // and one against another month ("did I save more than in July?") a
  // comparison.
  if (!COMMAND_STARTS.has(tokens[0].text) && distinctMonths < 2 && !THAN_A_MONTH.test(normalized)) {
    const job = readMoneyJob(normalized);
    if (job) {
      return mentionsVocabulary(tokens, context.vocabulary ?? [], MONEY_JOB_STEMS) ? null : over({ kind: job, month });
    }
  }

  // Against the plan is the plan answer, not a second month: "how did my
  // spending compare with the plan?".
  const aboutPlan = has(/\b(plan|planned|budget|budgets)\b/);

  // Two months side by side.
  const comparing = has(/\b(compare|compared|comparison|vs|versus)\b/)
    || (has(/\b(more|less|higher|lower)\b/) && refs.some((ref) => ref.lead === "than"));
  if (comparing && !(aboutPlan && distinctMonths < 2)) {
    return period ? null : readCompare(refs, context);
  }

  const namesVocabulary = mentionsVocabulary(tokens, context.vocabulary ?? []);

  // Income before the plan: "did income match the plan?" is about income.
  if (has(/\b(income|earn|earned|earning|earnings|salary|came in)\b/)) {
    return namesVocabulary ? null : over({ kind: "income", month });
  }

  // Intent against outcome: the plan, staying on it, or how a month went
  // ("how did September go?", "how was August?", "how did we do?").
  const howItWent = /^how (did|was|were|has|have|is|are)\b/.test(normalized)
    && !has(/\b(much|many|often|long)\b/)
    && (allRefs.length > 0 || period !== null || has(/\b(go|went|going|gone|do|did|doing|done|turn|turned|end|ended|look|looking)\b/));
  if (aboutPlan || has(/\bon (track|target)\b/) || has(/\b(stick|stuck|stay|stayed)\b/) || has(/\b(keep|kept) (to|within)\b/) || howItWent) {
    return over({ kind: "plan", month });
  }

  if (has(/\bwhere\b/) && (has(/\b(go|went|going|gone)\b/) || has(/\b(spend|spent|spending|money)\b/))) {
    return over({ kind: "spending", focus: "where", month });
  }
  if (has(/\b(spend|spent)\b.*\bmost\b/) || has(/\b(top|biggest|largest) categor/) || has(/\bbreak ?down\b/)) {
    return over({ kind: "spending", focus: "where", month });
  }
  if (words.has("why") && (has(/\b(expensive|much|high|higher|more|big|bigger|spend|spent|spending|cost|costly)\b/))) {
    return over({ kind: "spending", focus: "why", month });
  }

  // The biggest expenses are one month's: a period is not answered.
  if (period) {
    return null;
  }
  if (has(/\b(biggest|largest|most expensive|top|highest|priciest|costliest)\b/) && has(/\b(expense|expenses|purchase|purchases|spend|spending|cost|costs|item|items|payment|payments|thing|things|buy|buys|bought)\b/)) {
    return namesVocabulary ? null : { kind: "biggest", month };
  }

  return null;
}

// The words of an "if this keeps up" question ("keep" and "kept up" are
// common slips; "how did ... end" is about a month that has ended, and is
// left to the other readers).
const PACE_WORDS = /\bif (?:this|it|that|things|spending) (?:keeps?|kept|carries|carry|goes|go) (?:up|on|going)\b|\b(?:how|where) (?:will|would|is|does) (?:\w+ ){0,3}(?:end|ending|land|finish)(?: up)?\b/;

// The words of a "what changed?" question ("wat" is a common slip).
const CHANGED_WORDS = /\b(?:what|wat|wht)\s+(?:has\s+)?changed\b|\bwhy\s+did\s+(?:we|i|you)\s+spend\s+(?:more|less)\b(?!\s+than)|\bwhat\s+(?:is|was|s)\s+different\b/;

// The words of a "more than usual" question ("mor" is a common slip).
const USUAL_WORDS = /\b(?:than (?:usual|normal|average)|(?:more|mor|higher|lower|less|bigger) than (?:usual|normal)|usually|normal(?: for)?|is (?:that|this|it) a lot|a lot for)\b|\bnormal$/;
// Words that never name what is asked about.
const USUAL_FILLER = new Set([
  "is", "are", "was", "were", "am", "do", "does", "did", "we", "i", "you", "our", "my", "me", "us", "the", "a", "an", "that", "this", "it",
  "more", "mor", "less", "higher", "lower", "bigger", "than", "usual", "usually", "normal", "average", "lot", "for", "on", "at", "in",
  "spending", "spend", "spent", "much", "so", "how", "what", "month", "last", "this", "of", "s", "still", "be", "been", "being", "go", "going"
]);

// What a "more than usual" question is about, as written: a category,
// wallet or person name it holds, else the words after "on" or "at", else
// its other words. Null when only filler is left: the month's spending.
function readUsualSubject(tokens: Token[], context: AskAnswerIntentContext): string | null {
  const text = tokens.map((token) => token.text).join(" ");
  const names = [...(context.vocabulary ?? []), ...context.people.map((person) => person.name)]
    .filter((name) => name.trim().length > 1)
    .sort((left, right) => right.length - left.length);
  for (const name of names) {
    const lowered = name.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
    if (lowered && new RegExp(`(?:^| )${lowered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s)?(?: |$)`).test(text)) {
      return name;
    }
  }
  const monthWords = new Set([...MONTH_WORDS.keys()]);
  const isFiller = (word: string) => USUAL_FILLER.has(word) || monthWords.has(word) || /^\d{4}(?:-\d{2})?$/.test(word);
  const after = tokens.findIndex((token) => token.text === "on" || token.text === "at");
  const pick = (list: Token[]) => list.map((token) => token.text).filter((word) => !isFiller(word));
  const fromAfter = after >= 0 ? pick(tokens.slice(after + 1)) : [];
  const words = fromAfter.length ? fromAfter : pick(tokens);
  return words.length ? words.slice(0, 4).join(" ") : null;
}

// Which money job a question asks about (DOMAIN.md "Money job"): how much
// went into Investments, how much was saved (kept), or spending against
// what came in. Null for anything else. "Invest in a new phone case" names
// a purchase, not investing; "keep to the plan" is the plan.
function readMoneyJob(normalized: string): "invested" | "saved" | "spentVsEarned" | null {
  const has = (pattern: RegExp) => pattern.test(normalized);
  // A bare verb ("save", "invest") is the job's question only when asked
  // about what happened ("how much did I save?"), never a request ("can you
  // save this?").
  const askedAbout = has(/\b(how much|how many|what did|whats|did (?:i|we|you)|do (?:i|we)|have (?:i|we)|has)\b/);
  if (
    (has(/\b(invested|investing|investment|investments)\b/) || (has(/\binvest\b/) && askedAbout))
    && !has(/\binvest(?:ed|ing|s)? (?:in|into|on) (?:a|an|new|that|this|those|these)\b/)
  ) {
    return "invested";
  }
  const spending = has(/\b(spend|spent|spending|expenses|outgoings)\b/);
  const earning = has(/\b(earn|earned|earning|earnings|income|salary|paycheck|pay cheque)\b/)
    || has(/\bthan (?:i|we|you) (?:made|make|brought in|bring in|took home|take home)\b/);
  if (spending && earning) {
    return "spentVsEarned";
  }
  if (
    has(/\b(saved|saving|savings)\b/)
    || (has(/\bsave\b/) && askedAbout)
    || (has(/\b(put|set) aside\b/) && askedAbout)
    || (has(/\bhow much\b.*\b(keep|kept)\b/) && !has(/\b(keep|kept) (to|within)\b/))
  ) {
    return "saved";
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
      refs.push({ month: token.text === "this" ? thisMonth : addMonths(thisMonth, -1), lead, hasYear: true });
      index += 1;
      continue;
    }
    if (/^\d{4}-\d{2}$/.test(token.text)) {
      refs.push({ month: token.text, lead, hasYear: true });
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
    refs.push({ month: `${year}-${String(monthNumber).padStart(2, "0")}`, lead, hasYear });
  }
  return refs;
}

// "from Oct 2025 to Sep 2026", "between July and September": every month
// from the first to the second, up to this month. A start said without a
// year that falls after the end is the year before ("from November to
// February"). Null when no range is named; "unreadable" when it has not
// started, runs backwards, or is longer than MAX_PERIOD_MONTHS.
function readRange(refs: MonthRef[], today: string): { months: string[]; refs: MonthRef[] } | null | "unreadable" {
  const startIndex = refs.findIndex((ref) => RANGE_START_LEADS.has(ref.lead));
  const start = startIndex >= 0 ? refs[startIndex] : undefined;
  const end = startIndex >= 0 ? refs[startIndex + 1] : undefined;
  if (!start || !end || !RANGE_END_LEADS.has(end.lead)) {
    return null;
  }
  const first = start.month > end.month && !start.hasYear ? addMonths(start.month, -12) : start.month;
  const thisMonth = today.slice(0, 7);
  const last = end.month > thisMonth ? thisMonth : end.month;
  if (first > last) {
    return "unreadable";
  }
  const months: string[] = [];
  for (let item = first; item <= last && months.length <= MAX_PERIOD_MONTHS; item = addMonths(item, 1)) {
    months.push(item);
  }
  return months.length > MAX_PERIOD_MONTHS ? "unreadable" : { months, refs: [start, end] };
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
// ("groceries", "citi"). Words whose stem is in `ignore` never count.
function mentionsVocabulary(tokens: Token[], vocabulary: string[], ignore: Set<string> = new Set()) {
  const stems = new Set(tokens.map((token) => stem(token.text)));
  return vocabulary.some((name) => {
    const nameWords = normalize(name).split(/[^a-z0-9]+/).filter(Boolean);
    return nameWords.some((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word) && !ignore.has(stem(word)) && stems.has(stem(word)));
  });
}

export function addMonths(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
