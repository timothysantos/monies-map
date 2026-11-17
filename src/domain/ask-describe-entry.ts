// "Dinner ramen split with Joyce": a few words about a quick entry
// (DOMAIN.md "Quick Entry"; docs/flows/cash-entry-flow.md, "Words later").
// A payment typed on the quick pad has only an amount; later the person
// says what it was. The model reports what they said, as they said it
// (describe.words, a category as named, the person shared with as written,
// shares as stated, or the payment's amount as written when they name it by
// amount). The server derives everything else: the entry (the one in focus,
// or the newest quick entry still waiting for words with that amount), the
// name, the category (the household's rules and the everyday words), the
// person, and the split (the usual group and share for that kind of
// payment, else half each, shown as assumed).
//
// The answer is one change card: the entry's new name, category or note
// through POST /api/entries/update, and its place on Splits through POST
// /api/splits/expenses/add-usual, with Undo (remove-added, then the entry as
// it was). Nothing is saved until the person's Save.
//
// readDescribeRules is the offline backup: with AI off it reads the same
// words into the same action, checked the same way. Pure: no database, no
// clock, nothing written (the route's resolve step reads the split habit).

import { categoryFromDescription } from "./category-keywords";
import { assumption, type AskAssumption } from "./ask-ambiguity";
import {
  askBack,
  askerId,
  categoryQuestion,
  findCategory,
  findPerson,
  groundedAmount,
  personQuestion,
  resolveShares,
  scrubName,
  withAssumptions,
  wordsOf,
  type AskTurnAction,
  type AskTurnContext,
  type AskTurnFocusEntry,
  type AskTurnPerson,
  type AskTurnReply,
  type Ground
} from "./ask-turn";
import type { AskChangeRow, AskChangeStep } from "./ask-turn-actions";
import { readSharesByRules } from "./ask-turn-shares";
import { isPadDefaultDescription, tidyCashDescription } from "./cash-entry";
import { NON_GROUP_SPLIT_ID } from "./split-suggestion";

export interface AskDescribeRequest {
  type: "describe_entry";
  // The entry in focus, or null: then the newest quick entry still waiting
  // for words whose paid amount is `amountMinor` (in the currency paid).
  entry: AskTurnFocusEntry | null;
  amountMinor: number | null;
  // The person's words for what it was ("" when they said none).
  words: string;
  // A category they named, or null: then the rules' guess from the words.
  categoryName: string | null;
  // Who it was shared with, or null when it was not shared.
  sharedWith: AskTurnPerson | null;
  // The first person's share as stated, or null: the usual share, else half.
  firstBasisPoints: number | null;
  assumptions: AskAssumption[];
}

// What the route read for the change (ask-turn-resolve.ts).
export interface AskDescribeFacts {
  entry: AskTurnFocusEntry | null;
  // The usual split for this kind of payment (split-suggestion.ts), if any.
  usual: { groupId: string; groupName: string; payerBasisPoints: number; otherPersonId: string } | null;
}

const WORDS_MAX = 80;

export const DESCRIBE_COPY = {
  whichPayment: "Which payment is that? Say its amount, like: the 85,000 was ramen.",
  noQuickPayment: (amount: string) => `No payment of ${amount} from the last 3 days is waiting for a few words.`,
  whatWasIt: "What was it? A few words are enough, like: dinner ramen.",
  whoShared: "Who did you share it with?",
  notOnSplits: "Not on Splits",
  onlyExpenses: "Only a payment can be described this way.",
  alreadyOnSplits: "It is already on Splits, so that stays as it is.",
  halfEach: (other: string) => `Shared half each with ${other}, as you didn't say the shares.`,
  usualShare: (other: string) => `Shared the way you usually share this kind of payment with ${other}.`,
  // "Half each with Joyce", "Tim 70% and Joyce 30%", then " in Bali trip".
  splitLine: (input: { payer: string; other: string; payerBasisPoints: number; groupName: string }) => {
    const payerPercent = Math.round(input.payerBasisPoints / 100);
    const share = payerPercent === 50 ? `Half each with ${input.other}` : `${input.payer} ${payerPercent}% and ${input.other} ${100 - payerPercent}%`;
    return input.groupName ? `${share} in ${input.groupName}` : share;
  }
};

// The prompt's line for this action.
export function describeDescribeAction() {
  return "- describe_entry: what a quick payment was. describe.words (no sharing words), category, shared_with, amount: only as said.";
}

// Words the person wrote, tidied: "dinner ramen" → "Dinner ramen". "" when
// none, null when the model's words are not the person's own.
function groundedWords(value: unknown, ground: Ground): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().replace(/[.,;:!]+$/, "") : "";
  if (!text) return "";
  if (text.length > WORDS_MAX || !/\p{L}{2,}/u.test(text)) return null;
  return wordsOf(text).every((word) => ground.words.has(word)) ? tidyCashDescription(scrubName(text)) || null : null;
}

// The answer to Ask's own "What was it?" after "the 12.80 was…": this
// message is the words for that payment (Ask audit B12), read with the
// amount and the person from the message that asked, so it can never
// become a second entry. Null for anything else.
export function describeAnswerAction(context: AskTurnContext): AskTurnAction | null {
  const history = context.history ?? [];
  const last = history.at(-1);
  if (!last || last.role !== "app" || last.text.trim() !== DESCRIBE_COPY.whatWasIt) return null;
  const asked = [...history].reverse().find((message) => message.role === "user")?.text ?? "";
  const before = readDescribeRules(asked, { ...context, text: asked, history: [] }, { byAmount: true });
  if (!before?.describe?.amount && context.focus?.kind !== "saved_entry") return null;
  const now = readDescribeRules(context.text, { ...context, history: [] });
  if (!now?.describe?.words && !now?.describe?.category) return null;
  return {
    ...now,
    split: now.split ?? before?.split ?? null,
    describe: {
      ...now.describe,
      amount: before?.describe?.amount ?? null,
      shared_with: now.describe.shared_with ?? before?.describe?.shared_with ?? null
    }
  };
}

export function validateDescribeEntry(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  // The model's words, else the person's own: "the 12.80 was ramen with
  // serene" is "ramen", shared with Serene, even when the model left the
  // words or the person out (Ask audit B12). Only that "the <amount> was …"
  // form is read this way; any other message keeps the model's reading.
  const ruled = context.focus?.kind === "saved_entry" ? null : readDescribeRules(context.text, context, { byAmount: true })?.describe ?? null;
  const given = action.describe ?? {};
  const modelWords = groundedWords(given.words, ground);
  const raw = {
    ...given,
    words: modelWords ? given.words : ruled?.words ?? given.words,
    shared_with: given.shared_with ?? ruled?.shared_with ?? null,
    category: given.category ?? ruled?.category ?? null,
    amount: given.amount ?? ruled?.amount ?? null
  };
  if (!action.split && ruled && raw.shared_with && !given.shared_with) {
    const shares = readSharesByRules(context.text, context.people.slice(0, 2), askerId(context))?.shares ?? [];
    if (shares.length) action = { ...action, split: { payer: null, group: null, shares } };
  }
  const focus = context.focus?.kind === "saved_entry" ? context.focus.entry : null;
  let amountMinor: number | null = null;
  if (!focus) {
    const amount = groundedAmount(raw.amount, ground);
    if (!amount.given || amount.minor === null) {
      return askBack({ code: "field_missing", field: "describe.amount" }, DESCRIBE_COPY.whichPayment);
    }
    amountMinor = amount.minor;
  }
  if (focus && focus.entryType !== "expense") return { kind: "note", text: DESCRIBE_COPY.onlyExpenses };

  const words = groundedWords(raw.words, ground);
  if (words === null) return askBack({ code: "field_missing", field: "describe.words" }, DESCRIBE_COPY.whatWasIt);
  const named = findCategory(raw.category, context);
  if (named === "unknown") return categoryQuestion(context, String(raw.category ?? ""));
  const shared = findPerson(raw.shared_with, context);
  if (shared === "unknown") return personQuestion(context, DESCRIBE_COPY.whoShared, "describe.shared_with", String(raw.shared_with ?? ""));
  if (!words && !named && !shared) return askBack({ code: "nothing_to_change", field: "describe" }, DESCRIBE_COPY.whatWasIt);

  // The category: the one they named, else what the words point at.
  const guessed = words ? categoryFromDescription(words, context.entry.categoryNames, context.entry.categoryMatchRules) : undefined;
  const categoryName = named ?? (guessed && guessed !== "Transfer" ? guessed : null);

  let firstBasisPoints: number | null = null;
  const assumptions: AskAssumption[] = [];
  if (shared) {
    const payerId = focus?.payerPersonId ?? null;
    // "Split with Tim" on Tim's own payment: ask who else it was.
    if (payerId && shared.id === payerId) {
      return personQuestion(context, DESCRIBE_COPY.whoShared, "describe.shared_with", "");
    }
    const stated = Array.isArray(action.split?.shares) && action.split.shares.length > 0;
    const fromText = readSharesByRules(context.text, context.people.slice(0, 2), askerId(context));
    if (stated || fromText?.shares.length) {
      const total = focus ? Math.abs(focus.amountMinor) : null;
      const shares = resolveShares(action.split?.shares, context, total, ground, focus?.currency ?? "SGD");
      if (shares.kind !== "ok") return shares.reply;
      firstBasisPoints = shares.firstBasisPoints;
    }
  }
  return {
    kind: "resolve",
    request: { type: "describe_entry", entry: focus, amountMinor, words, categoryName, sharedWith: shared, firstBasisPoints, assumptions }
  };
}

// The change card, from the request and what the route read.
export function buildDescribeChange(request: AskDescribeRequest, facts: AskDescribeFacts, context: AskTurnContext): AskTurnReply {
  const entry = facts.entry;
  if (!entry) {
    const amount = request.amountMinor === null ? "" : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 }).format(request.amountMinor / 100);
    return { kind: "note", text: DESCRIBE_COPY.noQuickPayment(amount) };
  }
  if (entry.entryType !== "expense") return { kind: "note", text: DESCRIBE_COPY.onlyExpenses };
  const assumptions = [...request.assumptions];

  // The words become its name while it still has the pad's own; otherwise
  // (or when a statement has confirmed its name) they become its note.
  const words = request.words;
  const nameIt = Boolean(words) && isPadDefaultDescription(entry.description) && !entry.lockedMonth;
  const next = {
    description: nameIt ? words : entry.description,
    categoryName: request.categoryName ?? entry.categoryName,
    note: !nameIt && words ? [entry.note, words].filter(Boolean).join("\n") : entry.note ?? ""
  };
  const rows: AskChangeRow[] = [];
  if (next.description !== entry.description) rows.push({ field: "description", before: entry.description, after: next.description });
  if (next.categoryName !== entry.categoryName && entry.entryType === "expense") rows.push({ field: "category", before: entry.categoryName, after: next.categoryName });
  if (next.note !== (entry.note ?? "")) rows.push({ field: "note", before: entry.note ?? "", after: next.note });

  // On Splits: the person they named; the share they stated, else the usual
  // one for this kind of payment with that person, else half each.
  let split: { groupId: string; groupName: string; payerBasisPoints: number } | null = null;
  const payer = context.people.find((person) => person.id === entry.payerPersonId) ?? null;
  if (request.sharedWith && entry.linkedToSplits) {
    assumptions.push(assumption(DESCRIBE_COPY.alreadyOnSplits));
  } else if (request.sharedWith && payer) {
    const usual = facts.usual && facts.usual.otherPersonId === request.sharedWith.id ? facts.usual : null;
    const [first] = context.people;
    const statedPayer = request.firstBasisPoints === null ? null : payer.id === first?.id ? request.firstBasisPoints : 10_000 - request.firstBasisPoints;
    const payerBasisPoints = statedPayer ?? usual?.payerBasisPoints ?? 5000;
    if (statedPayer === null) {
      assumptions.push(assumption(usual ? DESCRIBE_COPY.usualShare(request.sharedWith.name) : DESCRIBE_COPY.halfEach(request.sharedWith.name)));
    }
    const groupId = usual && usual.groupId !== NON_GROUP_SPLIT_ID ? usual.groupId : "";
    split = { groupId, groupName: groupId ? usual?.groupName ?? "" : "", payerBasisPoints };
    rows.push({
      field: "splits",
      before: DESCRIBE_COPY.notOnSplits,
      after: DESCRIBE_COPY.splitLine({ payer: payer.name, other: request.sharedWith.name, payerBasisPoints, groupName: split.groupName })
    });
  }
  if (!rows.length) {
    return withAssumptions(askBack({ code: "nothing_to_change", field: "describe" }, DESCRIBE_COPY.whatWasIt), assumptions);
  }

  const body = (values: typeof next) => ({
    entryId: entry.entryId,
    date: entry.date,
    postDate: entry.postDate ?? null,
    description: values.description,
    accountId: entry.accountId ?? "",
    categoryName: values.categoryName,
    amountMinor: entry.amountMinor,
    entryType: entry.entryType,
    ownershipType: "direct",
    ...(entry.ownerName ? { ownerName: entry.ownerName } : {}),
    note: values.note
  });
  const previous = { description: entry.description, categoryName: entry.categoryName, note: entry.note ?? "" };
  const updates = rows.some((row) => row.field !== "splits");
  const save: AskChangeStep[] = [];
  const undo: AskChangeStep[] = [];
  if (updates) save.push({ path: "/api/entries/update", body: body(next) });
  if (split) {
    // Last, so its answer (the split ids) is what Undo reads.
    save.push({
      path: "/api/splits/expenses/add-usual",
      body: { groups: [{ splitGroupId: split.groupId || null, payerShareBasisPoints: split.payerBasisPoints, entryIds: [entry.entryId] }] }
    });
    undo.push({ path: "/api/splits/expenses/remove-added", body: {}, fromResult: { key: "undoSplitExpenseIds", as: "splitExpenseIds" } });
  }
  if (updates) undo.push({ path: "/api/entries/update", body: body(previous) });
  return withAssumptions({
    kind: "change",
    change: {
      type: "edit_entry",
      title: next.description,
      rows,
      entries: [{ entryId: entry.entryId, date: entry.date, description: next.description, amountMinor: entry.amountMinor, currency: entry.currency, categoryName: next.categoryName, accountName: entry.accountName }],
      count: 1,
      confirmCount: null,
      rule: null,
      save,
      undo,
      month: entry.date.slice(0, 7),
      refresh: ["entries", "month", "summary", ...(split || entry.linkedToSplits ? ["splits" as const] : [])]
    }
  }, assumptions);
}

// ---------------------------------------------------------------------------
// The offline backup

// "the 85,000 was ramen", "Rp85.000 = taxi", "85k is dinner".
const BY_AMOUNT = /^(?:the\s+)?((?:rp\.?\s*)?\d[\d,.]*k?)\s+(?:one\s+)?(?:was|is|=|:)\s+(.+)$/i;
// "split with Joyce", "shared w/ joyce", "share with J".
const SHARED = /\b(?:split|splitting|shared?|sharing)\s+(?:it\s+|this\s+)?(?:with|w\/|w)\s+([\p{L}][\p{L}'.-]*)/iu;
// "ramen with Joyce": "with" a household person at the end.
const WITH_PERSON = /\bwith\s+([\p{L}][\p{L}'.-]*)\s*$/iu;

/**
 * The rules' reading of a few words about a quick payment: a category the
 * household has named in them, "split with NAME" (or "with NAME" when NAME
 * is one of the household), a stated share, and the rest as what it was.
 * `byAmount`: also read "the 85,000 was ramen" (no entry in focus).
 * Null when the message is not that.
 */
export function readDescribeRules(text: string, context: AskTurnContext, options: { byAmount?: boolean } = {}): AskTurnAction | null {
  let rest = String(text ?? "").replace(/\s+/g, " ").trim();
  // The answer to "Who did you share it with?" (a person's name chip): the
  // words before it, with that person.
  const before = [...(context.history ?? [])].reverse().find((message) => message.role === "user")?.text ?? "";
  const answered = before && rest.split(" ").length <= 2 ? findPerson(rest, context) : null;
  if (!options.byAmount && answered && answered !== "unknown" && before !== rest && SHARED.test(before)) {
    const again = before.replace(SHARED, (match, name: string) => match.slice(0, match.length - name.length) + answered.name);
    return readDescribeRules(again, { ...context, text: again, history: [] });
  }
  let amount: string | null = null;
  if (options.byAmount) {
    const match = BY_AMOUNT.exec(rest);
    if (!match) return null;
    amount = match[1].replace(/^rp\.?\s*/i, "");
    rest = match[2];
  }
  rest = rest.replace(/^(?:it|that|this)\s+(?:was|is)\s+/i, "").replace(/^(?:was|is)\s+/i, "");

  let sharedWith: string | null = null;
  const shared = SHARED.exec(rest);
  if (shared) {
    sharedWith = shared[1].replace(/[.'-]+$/, "");
    rest = `${rest.slice(0, shared.index)} ${rest.slice(shared.index + shared[0].length)}`;
  } else {
    const withPerson = WITH_PERSON.exec(rest);
    const person = withPerson ? findPerson(withPerson[1], context) : null;
    if (withPerson && person && person !== "unknown") {
      sharedWith = withPerson[1];
      rest = rest.slice(0, withPerson.index);
    }
  }
  // A share stated with it ("70/30", "Joyce 40%") is read by the share
  // reader from the message itself; its figures are not part of the name.
  const shares = sharedWith ? readSharesByRules(text, context.people.slice(0, 2), askerId(context))?.shares ?? [] : [];
  if (sharedWith) {
    rest = rest.replace(/\b\d[\d.,]*\s*(?:%|\/\s*\d[\d.,]*\s*%?)/g, " ");
    if (shares.length) rest = rest.replace(/\b\d[\d.,]*\b/g, " ");
  }

  // A category named in the words ("taxi to the villa", "bintang
  // groceries"): the household's own category names, whole words only. The
  // words stay as they were said: they are its name too.
  const lower = ` ${rest.toLowerCase().replace(/[,;:.!]+/g, " ")} `;
  const category = [...context.entry.categoryNames]
    .filter((name) => name !== "Other" && name !== "Transfer")
    .sort((left, right) => right.length - left.length)
    .find((name) => lower.includes(` ${name.toLowerCase()} `)) ?? null;
  const words = rest
    .replace(/\b(?:and|&)\s*$/i, "")
    .replace(/^\s*(?:and|&)\b/i, "")
    .replace(/[,;:.!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words && !category && !sharedWith) return null;
  return {
    action: "describe_entry",
    entry: null,
    split: shares.length ? { payer: null, group: null, shares } : null,
    settlement: null,
    plan: null,
    question: null,
    search: null,
    page: null,
    clarify: null,
    note: null,
    describe: { words: words || null, category, shared_with: sharedWith, amount }
  };
}
