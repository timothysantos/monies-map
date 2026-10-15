// The check-in's tone rules as code (docs/money-insights-copy.md, "Tone"). Every
// approved line must pass:
// no shame or alarm words, no exclamation marks, no emoji, and no
// percentage without the money amount beside it.

// Words from the owner-approved "Avoid" list, matched as whole words.
export const AVOID_WORDS = [
  "overspent",
  "overspend",
  "overspending",
  "blew",
  "blown",
  "bad month",
  "cut back",
  "cutting back",
  "should",
  "shouldn't",
  "non-essential",
  "nonessential",
  "guilty",
  "guilt",
  "sacrifice",
  "deny yourself",
  "warning",
  "alert",
  "problem",
  "problems"
];

const AVOID_PATTERN = new RegExp(`\\b(?:${AVOID_WORDS.map((word) => word.replace(/[-']/g, "[-']?")).join("|")})\\b`, "i");
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

// Returns what breaks the tone rules in one line of copy; empty when fine.
export function findToneProblems(text: string): string[] {
  const problems: string[] = [];
  const avoid = text.match(AVOID_PATTERN);
  if (avoid) {
    problems.push(`uses "${avoid[0]}"`);
  }
  if (text.includes("!")) {
    problems.push("has an exclamation mark");
  }
  if (EMOJI_PATTERN.test(text)) {
    problems.push("has an emoji");
  }
  return problems;
}

// A money amount in rendered copy ($1,080.59, JP¥26,730, S$5) or a money
// placeholder in a template ({amount}).
const MONEY_TEXT = /(?:[A-Z]{0,3}[$¥€£]\s?\d)/;
export const MONEY_TOKENS = [
  "amount", "kept", "total", "top", "planned", "paid", "income", "spent", "plan", "left", "over",
  "extra", "saved", "gap", "above", "then", "now", "balance", "usual", "yearly", "daily", "diff", "actual", "stayed", "ten"
];
const MONEY_TOKEN = new RegExp(`\\{(?:${MONEY_TOKENS.join("|")})\\}`);

// Sentences that show a percentage with no money amount beside it.
export function findPercentWithoutMoney(text: string): string[] {
  return text
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => sentence.includes("%") && !MONEY_TEXT.test(sentence) && !MONEY_TOKEN.test(sentence));
}

// App-centred phrases the plain-words rule retires (docs/money-insights-copy.md,
// "Tone"): a line says what happened to the reader's money, never what the
// app holds or what its charts show.
export const APP_JARGON = [
  "the app",
  "chart",
  "charts",
  "unlinked",
  "ledger",
  "trustworthy",
  "whole story",
  "same story",
  "checkpoint"
];

const APP_JARGON_PATTERN = new RegExp(`\\b(?:${APP_JARGON.join("|")})\\b`, "i");

// Filler the plain-words rule retires (owner, 2026-10-15): a sentence that
// states no fact and gives no next step, only a platitude ("Knowing the
// number is the useful part."). A line either says what happened to the
// reader's money or what to do about it; it never fills space.
export const FILLER_PHRASES = [
  "depends on your life",
  "the useful part",
  "is your call",
  "is yours to decide",
  "feels right",
  "is the right one",
  "worth noticing",
  "worth a moment of credit",
  "future you",
  "room to live",
  "earn its place",
  "good rhythm",
  "only the memories",
  "fits your life",
  "money well spent",
  "quiet win",
  "good homes"
];

const FILLER_PATTERN = new RegExp(`(?:${FILLER_PHRASES.join("|")})`, "i");

// Returns the filler phrase a line uses, if any.
export function findFiller(text: string): string[] {
  const match = text.match(FILLER_PATTERN);
  return match ? [`uses filler "${match[0]}"`] : [];
}

// Returns the app-centred phrase a line uses, if any.
export function findAppJargon(text: string): string[] {
  const match = text.match(APP_JARGON_PATTERN);
  return match ? [`uses "${match[0]}"`] : [];
}
