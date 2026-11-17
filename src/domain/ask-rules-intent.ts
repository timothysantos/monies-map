// Messages that are never a new entry (docs/flows/ask-flow.md, "Not an
// entry"). "Serene paid me back $50" is money moving between the two people
// on Splits, "delete the Koufu lunch" and "import my statement" are things
// Ask does not do, and "open splits" asks for a page. Reading any of them as
// a new expense is the most damaging guess Ask could make, because one Save
// records spending that never happened.
//
// Pure and small: the page reads it before its rules draft an entry (the
// offline backup, ask-panel.jsx), the turn route's rules reader turns it into
// the action the model would send (ask-turn-rules.ts), and the turn's checks
// refuse a model draft of such a message (ask-turn.ts).

// The same names as ASK_TURN_BLOCKED and ASK_TURN_PAGES in ask-turn.ts, kept
// here so the page's chunk does not pull in the whole turn module.
type AskTurnBlocked = "delete_entry" | "delete_month" | "delete_import" | "import_statement" | "undo_import" | "reconcile" | "accounts" | "people";
type AskTurnPage = "summary" | "month" | "entries" | "splits" | "imports" | "settings" | "help" | "trip";

export type AskCommandIntent =
  // Something Ask never does (the existing "Ask won't do this" note and page).
  | { kind: "blocked"; blocked: AskTurnBlocked }
  // A payment back between the two people ("Serene paid me back $50").
  | { kind: "paid_back"; text: string }
  // Settle up: everything owed on Splits.
  | { kind: "settle_up"; rest: string }
  // "I owe Serene $20": a balance, not spending.
  | { kind: "owes" }
  // "open splits", "go to the plan".
  | { kind: "open_page"; page: Exclude<AskTurnPage, "trip"> };

const POLITE = String.raw`^(?:(?:please|pls|can you|could you|hey ask|ask)[\s,]+)*`;
// What follows a command verb when it is about something already there:
// "delete the Koufu lunch", "remove my last entry", "delete it".
const DETERMINER = String.raw`(?:the|my|this|that|these|those|it|them|last|all|every|entry|entries|yesterday'?s|today'?s|an?)\b`;
const AMOUNT = /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)\b/i;
const QUESTION_START = /^(?:who|what|whats|what's|how|why|when|where|which|is|are|do|does|did|can|could|should|will|would|have|has)\b/i;

const PAGE_WORDS: Record<string, Exclude<AskTurnPage, "trip">> = {
  summary: "summary",
  home: "summary",
  month: "month",
  plan: "month",
  budget: "month",
  entries: "entries",
  transactions: "entries",
  splits: "splits",
  split: "splits",
  imports: "imports",
  import: "imports",
  settings: "settings",
  faq: "help",
  help: "help",
  guide: "help"
};

// What a message asks for when it is a command or a payment between the two
// people, or null when it may be an entry, a question or a search.
export function readCommandIntent(text: string): AskCommandIntent | null {
  const message = String(text ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  if (!message) return null;
  const lower = message.toLowerCase().replace(new RegExp(POLITE), "");
  if (!lower || message.endsWith("?") || QUESTION_START.test(lower)) return null;

  const page = new RegExp(String.raw`^(?:open|show(?: me)?|go to|take me to|bring up)\s+(?:the\s+|my\s+)?(\p{L}+)(?:\s+(?:page|tab|screen))?$`, "u").exec(lower);
  if (page && PAGE_WORDS[page[1]]) return { kind: "open_page", page: PAGE_WORDS[page[1]] };

  const blocked = readBlocked(lower);
  if (blocked) return { kind: "blocked", blocked };

  if (/\b(?:paid|payed|pay|pays|paying|transferred|sent|gave|give|gives|returned)\s+(?:\S+\s+){0,2}back\b|\b(?:repaid|repay|repays|reimbursed|reimburse|reimburses)\b/u.test(lower)) {
    return { kind: "paid_back", text: message };
  }
  const settle = /^(?:let'?s\s+|i want to\s+|i'?d like to\s+)?settle(?:d)?(?:\s+up)?\b\s*(.*)$/.exec(lower) ?? /\bsettle\s+up\b\s*(.*)$/.exec(lower);
  if (settle) return { kind: "settle_up", rest: settle[1].replace(/^(?:with|in|for|on)\s+/, "").trim() };
  // The whole message is a balance ("I owe Serene $20", "Serene owes me
  // 15"); a share inside an entry ("dinner 120, Joyce owes 70%") is not.
  if (/^(?:i|we|\p{L}+)\s+(?:still\s+)?owes?\s+(?:\p{L}+)(?:\s+(?:about\s+)?(?:s?\$\s*)?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:dollars|bucks|sgd))?)?$/u.test(lower)) return { kind: "owes" };
  return null;
}

// "delete the Koufu lunch", "import my statement", "undo the last import",
// "reconcile Citi", "add an account". A verb that starts a shop's name
// ("Delete Cafe $12") is still an entry: with an amount it must be followed
// by a word that points at something already there.
function readBlocked(lower: string): AskTurnBlocked | null {
  const startsWith = (verbs: string) => new RegExp(String.raw`^(?:${verbs})\b\s*(.*)$`).exec(lower);
  const pointsAtSomething = (rest: string) => !AMOUNT.test(lower) || new RegExp(`^${DETERMINER}`).test(rest);

  const undo = startsWith("undo|reverse|roll ?back");
  if (undo && /\bimports?\b/.test(undo[1])) return "undo_import";
  if (/^reconcile\b/.test(lower)) return "reconcile";

  const people = startsWith("add|remove|delete|rename|change");
  if (people && /^(?:an?\s+|the\s+|a new\s+)?(?:person|people|member|partner|spouse)\b/.test(people[1])) return "people";
  // "remove Serene from the household", "add my mum to the household".
  if (/^(?:add|remove|delete|take|kick)\s+.+\s+(?:from|to|into|out of|off)\s+(?:the|our|my|this)\s+(?:household|family)$/.test(lower)) return "people";
  const accounts = startsWith("add|open|close|remove|delete|rename|create|new");
  if (accounts && /^(?:an?\s+|my\s+|the\s+|a new\s+|new\s+)?(?:account|bank account|wallet|credit card)s?\b/.test(accounts[1])) return "accounts";

  const remove = startsWith("delete|remove|erase|get rid of|trash|bin");
  if (remove && pointsAtSomething(remove[1])) {
    if (/\b(?:imports?|statement)\b/.test(remove[1])) return "delete_import";
    if (/\bmonth\b/.test(remove[1])) return "delete_month";
    return "delete_entry";
  }
  const load = startsWith("import|upload");
  if (load && pointsAtSomething(load[1])) return "import_statement";
  return null;
}
