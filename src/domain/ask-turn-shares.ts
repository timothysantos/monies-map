// Reading a share out of the person's own words ("Joyce's share 1.6",
// "Joyce 30%", "Joyce owes me 1.60", "all Joyce"). Two jobs, both pure:
//
// 1. Say what a number in the message means. "$1.6" or "1.6 dollars" is
//    money, "30%" or "30 percent" a percentage, and a bare "1.6" is a guess:
//    a number above the entry's total can only be a percentage, anything
//    else is dollars. The model is not trusted with that call.
// 2. The rules' own reading of a split request (the offline backup when AI
//    is off or fails), as the same `split.shares` shape the model returns,
//    so one validator checks both.

export type ShareUnit = "amount" | "percent" | "bare";

export interface ShareMention {
  value: number;
  unit: ShareUnit;
  // Where the number starts in the text, for finding the person next to it.
  index: number;
}

export interface RawShare {
  person: string;
  percent?: number | null;
  amount?: string | null;
  all?: boolean | null;
}

interface PersonRef {
  id: string;
  name: string;
}

const NUMBER = /(s?\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(%|percent\b|pct\b|dollars?\b|bucks\b|sgd\b)?/gi;

// Every figure in the text with the unit the person wrote beside it. A
// fraction like 50/50 is a ratio, not an amount, and is left out.
export function readShareMentions(text: string): ShareMention[] {
  const mentions: ShareMention[] = [];
  const source = String(text ?? "");
  for (const match of source.matchAll(NUMBER)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = source.slice(0, start);
    const after = source.slice(end);
    if (/\d\s*\/\s*$/.test(before) || /^\s*\/\s*\d/.test(after)) continue;
    const value = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const marker = (match[3] ?? "").toLowerCase();
    const unit: ShareUnit = marker === "%" || marker === "percent" || marker === "pct" ? "percent" : match[1] || marker ? "amount" : "bare";
    mentions.push({ value, unit, index: start + (match[0].length - match[0].trimStart().length) });
  }
  return mentions;
}

// The unit of a number the model gave: what the person wrote beside it, and
// for a bare number the entry-total rule. `guessed` is true for a bare
// number, so the card can offer the other reading. null when the number is
// nowhere in the text (the model derived it, or it is a word like "half").
export function interpretShareNumber(
  value: number,
  texts: string[],
  totalMinor: number | null
): { unit: "amount" | "percent"; guessed: boolean } | null {
  for (const text of texts) {
    const mention = readShareMentions(text).find((candidate) => Math.abs(candidate.value - value) < 1e-9);
    if (!mention) continue;
    if (mention.unit === "amount") return { unit: "amount", guessed: false };
    if (mention.unit === "percent") return { unit: "percent", guessed: false };
    if (totalMinor === null) return null;
    return { unit: mention.value * 100 > totalMinor ? "percent" : "amount", guessed: true };
  }
  return null;
}

// A message that asks to put something on Splits or to set a share, so the
// rules know to try reading it.
export function looksLikeSplitRequest(text: string): boolean {
  return /\bsplits?\b|\bshare\b|\bowes?\b|\bpays?\b|\bhalf\b|\bfifty\b|\d\s*\/\s*\d/i.test(text);
}

const EVEN = /\b50\s*\/\s*50\b|\bhalf\b|\bevenly\b|\bequally\b|\beven\b|\bequal\b/i;
const SELF_WORDS = new Set(["i", "me", "my", "mine", "myself"]);
const WINDOW = 40;
// What may sit between a person and their figure ("Joyce's share is 1.6",
// "Joyce pays 2", "1.6 for Joyce"). Anything else ("I paid, split with
// Joyce") means the figure is about something other than a share.
const LINK = /^[\s:=\-\u2013]*(?:(?:share|shares|is|are|pays?|owes?|covers?|takes?|gets?|will|should|only|part|portion|of|it|to|for|from|at|as|s)\b[\s:=\-\u2013]*)*$/i;

interface NamedToken {
  index: number;
  end: number;
  person: PersonRef;
}

// The rules' reading of a split request, as the model's `split.shares`:
// { shares: [] } for an even split, one or two shares when a person is
// named beside a figure or "all", null when the message says nothing about
// shares. Names are the household's own; "I", "me" and "my" are the viewer.
export function readSharesByRules(text: string, people: PersonRef[], viewerId: string): { shares: RawShare[] } | null {
  const viewer = people.find((person) => person.id === viewerId) ?? null;
  // "Joyce owes me 1.6" is Joyce's figure: "me" there is who is owed.
  const cleaned = String(text ?? "").replace(/\b(owes?|pays?|paying|gave|gives)\s+me\b/gi, "$1");
  const personAt = (word: string): PersonRef | null => {
    if (SELF_WORDS.has(word)) return viewer;
    return people.find((person) => person.name.toLowerCase() === word) ?? null;
  };
  const named: NamedToken[] = [];
  for (const match of cleaned.matchAll(/[\p{L}']+/gu)) {
    const person = personAt(match[0].toLowerCase().replace(/'s$/, ""));
    if (person) named.push({ index: match.index ?? 0, end: (match.index ?? 0) + match[0].length, person });
  }

  const all = /\ball\b/i.test(cleaned) ? readAll(cleaned, named) : null;
  if (all) return { shares: [all] };
  const mentions = readShareMentions(cleaned);
  if (EVEN.test(cleaned) && !mentions.some((mention) => mention.unit === "percent")) return { shares: [] };

  const found = new Map<string, RawShare>();
  for (const mention of mentions) {
    const near = nearestPerson(cleaned, mention.index, named);
    if (!near || found.has(near.id)) continue;
    const share: RawShare = { person: near.name };
    if (mention.unit === "percent") share.percent = mention.value;
    else share.amount = numberText(cleaned, mention);
    found.set(near.id, share);
  }
  return found.size ? { shares: [...found.values()].slice(0, 2) } : null;
}

// The figure as the person wrote it ("1.60" keeps its zero).
function numberText(text: string, mention: ShareMention) {
  const written = /^\d[\d,]*(?:\.\d+)?/.exec(text.slice(mention.index).replace(/^s?\$\s*/i, ""));
  return written ? written[0].replace(/,/g, "") : String(mention.value);
}

// "all Joyce", "all of it is Joyce's", "Joyce pays all", "all mine".
function readAll(text: string, named: NamedToken[]): RawShare | null {
  const allAt = /\ball\b/i.exec(text)?.index ?? -1;
  if (allAt < 0 || !named.length) return null;
  const closest = [...named].sort((a, b) => Math.abs(a.index - allAt) - Math.abs(b.index - allAt))[0];
  return Math.abs(closest.index - allAt) > WINDOW ? null : { person: closest.person.name, all: true };
}

// The person written beside a figure: just before it (the usual order),
// else just after ("1.6 for Joyce"), with only share words between them.
function nearestPerson(text: string, index: number, named: NamedToken[]): PersonRef | null {
  const before = [...named].reverse().find((token) => token.end <= index);
  if (before && index - before.end <= WINDOW && LINK.test(text.slice(before.end, index))) return before.person;
  const numberEnd = index + (/^s?\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|percent|pct|dollars?|bucks|sgd)?/i.exec(text.slice(index))?.[0].length ?? 0);
  const after = named.find((token) => token.index >= numberEnd);
  if (after && after.index - numberEnd <= WINDOW && LINK.test(text.slice(numberEnd, after.index))) return after.person;
  return null;
}
