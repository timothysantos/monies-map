// The offline backup's reading of what a message asks for (docs/flows/
// ask-flow.md, "Rules reading"). With AI off, over its allowance or failing,
// these messages are read here into the same action the model would send,
// and the route checks it with the same validators, so the person gets the
// same card:
//
// - never a new entry (ask-rules-intent.ts): "Serene paid me back $50" is a
//   settle-up payment draft, "settle up with Serene" the settle-up card,
//   "I owe Serene $20" the who-owes-whom answer, "delete the Koufu lunch" or
//   "import my statement" the "Ask won't do this" note that opens the page,
//   and "open splits" the page;
// - the saved entry in focus: "make it Transport", "note: team lunch",
//   "make it 14", "it's Serene's" are change cards for that entry; a change
//   the rules cannot read says so and changes nothing;
// - the card being filled: "it's Serene's" sets its owner, "split with
//   Serene" turns its Splits switch on;
// - a new message: "dinner $80 split with Serene" is a shared expense on
//   Splits; "make all Grab rides Transport" the bulk change card.
//
// Pure: no database, no clock, nothing written.

import { readCommandIntent } from "./ask-rules-intent";
import { amountsIn, readDayWord } from "./ask-turn-names";
import { readSharesByRules } from "./ask-turn-shares";
import { askerId, findCategory, findGroup, findPerson, type AskTurnAction, type AskTurnContext, type AskTurnReply } from "./ask-turn";

export const RULES_COPY = {
  cannotReadChange: "I couldn't read that change, so nothing changed. Tap Open this entry to change it yourself.",
  whoPaidBack: "Who paid whom back?",
  settleUpWith: (group: string) => `Settle up ${group}`,
  paidBack: (from: string, to: string, amount: string) => `${from} paid ${to} back ${amount}`
};

export type AskRulesReading = { action: AskTurnAction } | { reply: AskTurnReply } | null;

const EMPTY: Omit<AskTurnAction, "action"> = {
  entry: null, split: null, settlement: null, plan: null, question: null, search: null, page: null, clarify: null, note: null
};
const act = (action: AskTurnAction["action"], parts: Partial<AskTurnAction> = {}): { action: AskTurnAction } => ({ action: { ...EMPTY, action, ...parts } as AskTurnAction });

const CHANGE_VERB = String.raw`(?:please\s+)?(?:make|move|put|change|set|switch|file|recategori[sz]e|categori[sz]e|mark)`;
const IT = String.raw`(?:it|this|that|this one|the category|its category|the amount|the owner)`;
const LINK = String.raw`(?:\s+(?:to|as|into|in|under|is|be))?`;
// Words that only say what kind of thing the shop's entries are.
const GENERIC = new Set(["rides", "ride", "trips", "entries", "entry", "payments", "payment", "charges", "purchases", "transactions", "ones", "orders", "bills"]);

// What the rules read, or null: then the page reads it as before (plan,
// money question, search, then a new entry).
export function readTurnRules(context: AskTurnContext): AskRulesReading {
  const text = context.text.replace(/\s+/g, " ").trim();
  const intent = readCommandIntent(text);
  if (intent) return readCommand(intent, text, context);
  const focus = context.focus;
  if (focus?.kind === "saved_entry") return readSavedChange(text, context);
  if (focus?.kind === "draft") return readDraftChange(text, context);
  return readBulkRecategorise(text, context) ?? readSplitExpense(text, context);
}

// Whether a message may be one readTurnRules reads, without any data: the
// route answers every other message at once, before reading anything.
export function mayBeRulesTurn(text: string, focusKind: string | null): boolean {
  if (readCommandIntent(text)) return true;
  if (focusKind === "saved_entry" && (changeTail(text) !== null || noteText(text) !== null)) return true;
  if (focusKind === "draft" && (ownerWord(text) !== null || splitWords(text))) return true;
  return BULK.test(text) || (splitWords(text) && amountsIn(text).size > 0);
}

function readCommand(intent: NonNullable<ReturnType<typeof readCommandIntent>>, text: string, context: AskTurnContext): AskRulesReading {
  switch (intent.kind) {
    case "blocked":
      return act("cannot_help", { blocked: intent.blocked });
    case "open_page":
      return act("open_page", { page: { name: intent.page } });
    case "owes":
      return act("answer_question", { question: { topic: "owed" } });
    case "settle_up": {
      const group = intent.rest ? findGroup(intent.rest.replace(/^(?:the|my)\s+/, ""), context) : null;
      return act("split_group", { group: { op: "settle", name: group && group !== "unknown" ? group.name : null } });
    }
    case "paid_back":
      return readPaidBack(text, context);
  }
}

// "Serene paid me back $50", "I paid Serene back 20", "paid back Ethan 15",
// "Serene repaid me $50": who paid, who was paid, and the one amount.
function readPaidBack(text: string, context: AskTurnContext): AskRulesReading {
  const lower = text.toLowerCase();
  const verb = /\b(?:paid|payed|pay|pays|paying|transferred|sent|gave|give|gives|returned|repaid|repay|repays|reimbursed|reimburse|reimburses)\b/.exec(lower);
  const at = verb?.index ?? 0;
  const before = personWords(lower.slice(0, at), context);
  const after = personWords(lower.slice(at + (verb?.[0].length ?? 0)), context);
  const from = before.at(-1) ?? (at === 0 || /^\s*(?:i|we)\b/.test(lower) ? "me" : null);
  const to = after[0] ?? null;
  const amounts = [...amountsIn(text)];
  const amount = amounts.length === 1 ? (amounts[0] / 100).toFixed(2) : null;
  // "me" while the app can't tell who is asking (the household view with no
  // login) is left unsaid: Splits is between the two, so naming the other
  // person puts "me" on the other side.
  const known = (word: string | null) => {
    const person = findPerson(word, context);
    return person && person !== "unknown" ? word : null;
  };
  const fromWord = known(from);
  const toWord = known(to);
  // Neither side known: ask with the two whole sentences, so a tap reads as
  // the answer without AI.
  const [first, second] = context.people;
  if (!fromWord && !toWord && first && second && amount) {
    const money = `$${amount.replace(/\.00$/, "")}`;
    return { reply: { kind: "clarify", question: RULES_COPY.whoPaidBack, options: [RULES_COPY.paidBack(second.name, first.name, money), RULES_COPY.paidBack(first.name, second.name, money)] } };
  }
  return act("draft_settlement", { settlement: { from: fromWord, to: toWord, amount } });
}

// The household's people a part of the message names ("me" and "I" too).
function personWords(part: string, context: AskTurnContext): string[] {
  const found: string[] = [];
  for (const word of part.match(/[\p{L}']+/gu) ?? []) {
    const bare = word.replace(/'s$/, "");
    if (["me", "i", "us", "we"].includes(bare)) found.push("me");
    else if (context.people.some((person) => person.name.toLowerCase() === bare)) found.push(bare);
  }
  return found;
}

// ---- The saved entry in focus --------------------------------------------

function changeTail(text: string): string | null {
  const lower = text.toLowerCase().replace(/[.!]+$/, "").trim();
  const match = new RegExp(String.raw`^${CHANGE_VERB}\s+${IT}${LINK}\s+(.+)$`).exec(lower)
    ?? /^(?:it'?s|it is|it was|that'?s|that was|this is|category(?:\s+is)?\s*:?|owner(?:\s+is)?\s*:?)\s+(?:an?\s+|in\s+)?(.+)$/.exec(lower);
  return match ? match[1].trim() : null;
}

function noteText(text: string): string | null {
  const match = /^(?:please\s+)?(?:add\s+(?:a\s+)?note|note(?:\s+it)?|notes?)\s*(?::|-|–|,|\bsaying\b|\bthat\b|\bas\b)\s*(.+)$/i.exec(text.trim())
    ?? /^note:\s*(.+)$/i.exec(text.trim());
  if (!match) return null;
  const words = match[1].trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  return words || null;
}

function readSavedChange(text: string, context: AskTurnContext): AskRulesReading {
  const note = noteText(text);
  if (note !== null) return act("edit_note", { note_edit: { target: "entry", text: note } });
  const bulk = readBulkRecategorise(text, context);
  if (bulk) return bulk;
  const tail = changeTail(text);
  if (tail === null) return null;
  const cleaned = tail.replace(/^(?:the\s+)?category\s+/, "").trim();
  if (/^\$?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:dollars|bucks|sgd))?$/.test(cleaned)) {
    return act("edit_saved_entry", { entry: { amount: cleaned.replace(/[^\d.,]/g, "") } });
  }
  const owner = ownerWord(cleaned);
  if (owner) return act("edit_saved_entry", { entry: { owner } });
  if (readDayWord(cleaned, context.today)) return act("edit_saved_entry", { entry: { date: cleaned } });
  const category = findCategory(cleaned, context);
  if (typeof category === "string" && category !== "unknown") return act("recategorise", { recategorise: { category } });
  return { reply: { kind: "note", text: RULES_COPY.cannotReadChange } };
}

// ---- The card being filled -----------------------------------------------

// "Serene's", "it's Serene's", "it's mine", "for Serene": a person's name.
function ownerWord(text: string): string | null {
  const lower = text.toLowerCase().replace(/[.!]+$/, "").trim();
  if (/^(?:it'?s\s+|it is\s+|that'?s\s+)?(?:mine|my one|me)$/.test(lower)) return "me";
  const match = /^(?:(?:it'?s|it is|it was|that'?s|this is|make it|for|owner(?:\s+is)?|paid by|belongs to)\s+)?(\p{L}+)(?:'s|’s|s')(?:\s+one)?$/u.exec(lower)
    ?? /^(?:it'?s|it is|that'?s|for|owner(?:\s+is)?|paid by|belongs to)\s+(\p{L}+)$/u.exec(lower)
    ?? /^(\p{L}+)\s+paid(?:\s+for\s+it)?$/u.exec(lower);
  return match ? match[1] : null;
}

function splitWords(text: string): boolean {
  return /\b(?:split(?:ting)?|halves|half|go(?:ing)? dutch)\b|\b50\s*\/\s*50\b|\bshare(?:d)?\s+(?:it\s+)?with\b/i.test(text) && !/\bsplit group\b/i.test(text);
}

function readDraftChange(text: string, context: AskTurnContext): AskRulesReading {
  if (splitWords(text)) {
    const shares = readSharesByRules(text, context.people.slice(0, 2), askerId(context))?.shares ?? [];
    return act("edit_draft", { entry: {}, split: { payer: null, group: null, shares } });
  }
  const owner = ownerWord(text);
  const person = owner ? findPerson(owner, context) : null;
  if (owner && person && person !== "unknown") return act("edit_draft", { entry: { owner } });
  return null;
}

// ---- A new message ---------------------------------------------------------

// "dinner $80 split with Serene", "taxi 30 half with serene": a new shared
// expense with Splits on (the model's draft_split_expense).
function readSplitExpense(text: string, context: AskTurnContext): AskRulesReading {
  if (!splitWords(text) || amountsIn(text).size === 0 || /\?\s*$/.test(text)) return null;
  const shares = readSharesByRules(text, context.people.slice(0, 2), askerId(context))?.shares ?? [];
  return act("draft_split_expense", { entry: {}, split: { payer: null, group: null, shares } });
}

// "make all Grab rides Transport", "move every Grab to Public Transport":
// the bulk change card (needs "Yes, change all N" over ten).
const BULK = /^(?:please\s+)?(?:make|move|put|change|set|switch|file|recategori[sz]e)\s+(?:all|every)\s+/i;
function readBulkRecategorise(text: string, context: AskTurnContext): AskRulesReading {
  if (!BULK.test(text)) return null;
  const words = text.replace(/[.!]+$/, "").replace(BULK, "").replace(/^(?:of\s+)?(?:the|my)\s+/i, "").trim().split(" ");
  const tryAt = (cut: number) => {
    const shop = words.slice(0, cut).filter((word, index, all) => !(index === all.length - 1 && GENERIC.has(word.toLowerCase())));
    while (shop.length && /^(?:to|as|into|in|under)$/i.test(shop.at(-1) ?? "")) shop.pop();
    const shopWords = shop.filter((word) => !GENERIC.has(word.toLowerCase()));
    const category = findCategory(words.slice(cut).join(" "), context);
    return shopWords.length && typeof category === "string" && category !== "unknown" ? { words: shopWords.join(" "), category } : null;
  };
  const link = words.map((word) => word.toLowerCase()).lastIndexOf("to");
  const found = (link > 0 ? tryAt(link + 1) : null) ?? [1, 2, 3].map((k) => (words.length > k ? tryAt(words.length - k) : null)).find(Boolean) ?? null;
  return found ? act("recategorise", { recategorise: { category: found.category, words: found.words } }) : null;
}

// A rules question back about which group to settle offers whole messages
// ("Settle up Japan trip"), so a tap reads as the answer without AI.
export function settleChips(reply: AskTurnReply, context: AskTurnContext): AskTurnReply {
  if (reply.kind !== "clarify") return reply;
  const groups = new Set(context.groups.map((group) => group.name));
  const options = reply.options.filter((option) => groups.has(option)).map(RULES_COPY.settleUpWith);
  return { ...reply, options };
}
