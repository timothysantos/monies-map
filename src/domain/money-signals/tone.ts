// The check-in's tone rules as code (docs/checkin-copy.md, "Tone"). Every
// approved line, and every optional AI wording around them, must pass:
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
