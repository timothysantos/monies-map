// Ask's Phase 2 actions (docs/proposals/ask-ai-first/inventory.md): changes
// to data the household already has. AI understands, the app validates:
// each action the model chooses is checked here against the household's
// own data and becomes a change card (AskChange) that lists exactly what
// would change, before and after, with the existing command it saves
// through and, where that command can take it back, its Undo. Nothing here
// writes, and nothing is saved until the person taps Save.
//
// Two stages, both pure:
// - validate*: the model's action against the turn's context (the entry,
//   list or group in focus, people, wallets, categories, groups, plan
//   lines, the words the person wrote). A change that needs nothing more
//   is built at once; one that needs the household's rows (every entry a
//   bulk recategorise would move, transfer candidates, a group's balance,
//   the matches, a month's plan rows and note) becomes a `resolve` request.
// - build*: that request with the rows the route loaded
//   (ask-turn-resolve.ts), into the card, a question back, or a note.
//
// Never from Ask: deleting entries, months or imports, importing or undoing
// a statement import, reconciling, accounts and people. validateBlocked
// opens the page that does it and says why.

import { matchCategoryRule } from "./app-repository-category-match-rules";
import { assumption, decideReadings, type AskReading } from "./ask-ambiguity";
import { BULK_RECATEGORISE_CONFIRM_ABOVE, BULK_RECATEGORISE_MAX } from "./entry-category-bulk";
import { chooseTransferOptions } from "./transfer-candidates";
import {
  COPY,
  askBack,
  categoryQuestion,
  findCategory,
  findGroup,
  findPerson,
  findWallet,
  groundedAmount,
  groundedDescription,
  groupQuestion,
  monthLabel,
  personQuestion,
  readDate,
  readMonth,
  scrubName,
  walletQuestion,
  withAssumptions,
  wordsOf,
  type AskTurnAction,
  type AskTurnBlocked,
  type AskTurnContext,
  type AskTurnFocusEntry,
  type AskTurnGroup,
  type AskTurnReply,
  type Ground
} from "./ask-turn";
import type { AskTripEventRequest } from "./ask-trip-events";
import type { AskUsuallySharedRequest } from "./ask-usually-shared";
import type { CategoryMatchRuleDto } from "../types/dto";

// ---------------------------------------------------------------------------
// The change card

export type AskChangeType =
  | "edit_entry"
  | "recategorise"
  | "recategorise_bulk"
  | "entry_note"
  | "month_note"
  | "link_transfer"
  | "group_create"
  | "group_move"
  | "simplify"
  | "payment_way"
  | "category_create"
  | "category_rename"
  | "category_colour"
  | "plan_link"
  // Trips and events (ask-trip-events.ts): entries on, moved or off one;
  // a new one made with no entries.
  | "trip_event"
  | "trip_event_create"
  // The usual shared past entries added to Splits (ask-usually-shared.ts).
  | "usually_shared";

export type AskChangeField =
  | "amount"
  | "date"
  | "description"
  | "category"
  | "wallet"
  | "owner"
  | "note"
  | "from"
  | "to"
  | "group"
  | "name"
  | "currency"
  | "paynow"
  | "cash"
  | "colour"
  | "line"
  | "trip"
  | "dates";

// One line of what changes. Money rows carry minor units (the page shows
// them as money, hidden when money is hidden); every other row carries
// names or dates as the household keeps them.
export interface AskChangeRow {
  field: AskChangeField;
  before: string;
  after: string;
  beforeMinor?: number;
  afterMinor?: number;
  currency?: string;
}

// An entry the change touches, as the card lists it.
export interface AskChangeEntry {
  entryId: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  categoryName: string;
  accountName?: string;
  // A trip change: the trip this entry is on now and the one it goes to
  // ("" is none).
  trip?: { before: string; after: string };
  // A line the card shows under the entry (the usual split it would get).
  detail?: string;
}

// The only commands a change card may post to (the page checks the path
// against its own copy of this list before posting).
export const ASK_CHANGE_PATHS = [
  "/api/entries/update",
  "/api/entries/update-category",
  "/api/entries/update-note",
  "/api/transfers/link",
  "/api/splits/groups/create",
  "/api/splits/expenses/update",
  "/api/splits/checkpoints/create",
  "/api/splits/checkpoints/reopen",
  "/api/settings/payment-ways/save",
  "/api/categories/create",
  "/api/categories/update",
  "/api/category-match-rules/save",
  "/api/month-plan/links",
  "/api/month-note/update",
  "/api/trip-events/entries/set",
  "/api/trip-events/save",
  "/api/trip-events/delete",
  "/api/trip-events/undo",
  "/api/splits/expenses/add-usual",
  "/api/splits/expenses/remove-added"
] as const;
export type AskChangePath = typeof ASK_CHANGE_PATHS[number];

// One existing command call. `fromResult` copies a value from the save's
// response into an Undo body (Simplify's Undo reopens the checkpoint the
// save created; a key may be a dotted path, "tripEvent.id").
export interface AskChangeStep {
  path: AskChangePath;
  body: Record<string, unknown>;
  fromResult?: { key: string; as: string };
}

// One way a transfer change can end (the Entries transfer dialog's choices):
// pair with a candidate other side, or keep the entry as an unmatched
// transfer. Each carries what the card shows and the steps it saves with.
export interface AskTransferOption {
  // The other side's entry id; "none" for the unmatched transfer.
  id: string;
  rows: AskChangeRow[];
  entries: AskChangeEntry[];
  count: number;
  save: AskChangeStep[];
  undo: AskChangeStep[] | null;
}

export interface AskTransferChoices {
  // Best match first (pre-selected), at most 3 more.
  options: AskTransferOption[];
  none: AskTransferOption | null;
  // The wallet the person named when it has no match ("" otherwise).
  walletMissed: string;
}

export interface AskChange {
  type: AskChangeType;
  // A name the card leads with: the entry's description, the group,
  // category, person or plan line.
  title: string;
  rows: AskChangeRow[];
  // The entries it touches (the first few; `count` says how many in all).
  entries: AskChangeEntry[];
  count: number;
  // Set when count is over BULK_RECATEGORISE_CONFIRM_ABOVE: Save stays off
  // until the person taps "Yes, change all N", and the save then carries
  // confirmedCount = N, which the command checks.
  confirmCount: number | null;
  save: AskChangeStep[];
  undo: AskChangeStep[] | null;
  // An optional category rule offered after a bulk recategorise is saved.
  rule: { pattern: string; categoryId: string; categoryName: string } | null;
  // The month whose pages refresh after the save, and which pages.
  month: string;
  refresh: Array<"entries" | "month" | "summary" | "splits" | "settings">;
  // A change that makes an entry a transfer: the other sides to choose
  // from. `rows`, `entries`, `save` and `undo` above are the pre-selected
  // choice's (the best match, or the unmatched transfer when none exist).
  transfer?: AskTransferChoices | null;
}

// A bank row that may be the payment behind a split record, as Splits'
// review lists it (loadSplitMatchCandidates). canLink is false when the
// match needs an exchange rate checked, which only Splits can do.
export interface AskMatch {
  id: string;
  kind: "expense" | "settlement";
  splitRecordId: string;
  transactionId: string;
  groupName: string;
  splitDescription: string;
  splitDate: string;
  splitAmountMinor: number;
  splitCurrency: string;
  transactionDescription: string;
  transactionDate: string;
  amountMinor: number;
  transactionCurrency: string;
  canLink: boolean;
}

// What the route loads before the reply can be built.
export type AskResolveRequest =
  | { type: "recategorise_bulk"; words: string; categoryName: string; fromCategoryName: string | null; month: string | null }
  | { type: "month_note"; month: string; personScope: string; text: string }
  | { type: "link_transfer"; entry: AskTurnFocusEntry; walletId: string | null; walletName: string; date: string | null }
  | { type: "group_move"; entry: AskTurnFocusEntry; group: AskTurnGroup | null }
  | { type: "group_settle"; group: AskTurnGroup }
  | { type: "simplify"; currency: string | null }
  | { type: "matches"; month: string }
  | { type: "plan_link"; line: string; month: string; words: string }
  | AskTripEventRequest
  | AskUsuallySharedRequest;

const PREVIEW_ROWS = 8;
const MAX_MATCHES = 6;
const NAME_MAX = 40;
const NOTE_TEXT_MAX = 200;
const WORDS_MAX = 40;

// The prompt's lines for these actions (buildAskTurnPrompt).
export function describePhase2Actions() {
  return [
    "- edit_saved_entry: change the saved entry in focus; set only the entry fields that change (amount, date, description, category, wallet, owner, note). To make it a transfer set entry.type transfer, and entry.to_wallet when they name the other account.",
    "- recategorise: change a category: of the saved entry in focus, or of every entry whose bank text has recategorise.words (\"make all Grab rides Transport\": words \"grab\", category \"Transport\"); rule true when new ones should be filed the same way.",
    "- edit_note: note_edit.target entry (the saved entry in focus) or month (note_edit.month); note_edit.text is the whole note as they want it.",
    "- link_transfer: pair the saved entry in focus with the other side of a move between their wallets (transfer.wallet and transfer.date only if said).",
    "- split_group: group.op create (group.name), move (the saved entry in focus's split into group.name), settle (everything owed in group.name, or the group in focus), simplify (every group into one payment).",
    "- review_matches: show bank rows that may be the payment behind a split (matches.month).",
    "- set_payment_way: the wallet a person's PayNow (a bank wallet) or cash means: payment_way.",
    "- edit_category: category_edit.op create (new_name, colour), rename (category, new_name) or colour (category, colour).",
    "- link_plan: link entries to a plan line: plan_link.line, month and words (shop words in the bank text)."
  ];
}

// ---------------------------------------------------------------------------
// Stage 1: the model's action against the context

// "Change it to $15", "it was yesterday", "move it to my UOB card", "add a
// note: Joyce's birthday": the saved entry in focus, field by field. A
// statement-certified entry keeps its bank facts (amount, date, description,
// wallet): asking to change one says why and changes nothing.
export function validateEditSavedEntry(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  if (context.focus?.kind !== "saved_entry") {
    return { kind: "note", text: ACTION_COPY.whichEntryToChange };
  }
  const entry = context.focus.entry;
  const raw = action.entry ?? {};
  // Making it a transfer is a search for the other side, not a field edit.
  if (entry.entryType !== "transfer" && (raw.type === "transfer" || findCategory(raw.category, context) === "Transfer")) {
    return transferRequest(entry, context, raw.to_wallet ?? raw.wallet, null);
  }
  const next = {
    amountMinor: entry.amountMinor,
    date: entry.date,
    description: entry.description,
    categoryName: entry.categoryName,
    accountId: entry.accountId ?? "",
    accountName: entry.accountName,
    ownerName: entry.ownerName ?? null,
    note: entry.note ?? ""
  };
  const amount = groundedAmount(raw.amount, ground);
  if (amount.given && amount.minor === null) return askBack({ code: "amount_not_stated", field: "entry.amount" }, COPY.amountQuestion, []);
  if (amount.given && amount.minor !== null) next.amountMinor = amount.minor;
  const date = readDate(raw.date, context);
  if (!date.ok) return askBack({ code: "date_invalid", field: "entry.date" }, COPY.dateQuestion, [COPY.chips.today, COPY.chips.yesterday]);
  if (date.date) next.date = date.date;
  const description = groundedDescription(raw.description, ground);
  if (description) next.description = description;
  const category = findCategory(raw.category, context);
  if (category === "unknown") return categoryQuestion(context, String(raw.category ?? ""));
  if (category) next.categoryName = category;
  const wallet = findWallet(raw.wallet, context);
  if (wallet === "unknown") return walletQuestion(context, String(raw.wallet));
  if (wallet) {
    next.accountId = wallet.id;
    next.accountName = wallet.name;
  }
  const owner = findPerson(raw.owner, context);
  if (owner === "unknown") return personQuestion(context, COPY.whoQuestion, "entry.owner", String(raw.owner));
  if (owner) next.ownerName = owner.name;
  if (raw.note !== null && raw.note !== undefined) {
    const note = groundedNote(raw.note, ground);
    if (note === null) return askBack({ code: "field_missing", field: "noteQuestion" }, ACTION_COPY.noteQuestion, []);
    next.note = note;
  }

  const bankFactChanged = next.amountMinor !== entry.amountMinor || next.date !== entry.date
    || next.description !== entry.description || next.accountId !== (entry.accountId ?? "");
  if (bankFactChanged && entry.lockedMonth) {
    return { kind: "note", text: ACTION_COPY.bankFactsLocked(monthLabel(entry.lockedMonth)) };
  }
  if (next.categoryName !== entry.categoryName && next.categoryName === "Transfer" && entry.entryType !== "transfer") {
    return { kind: "note", text: ACTION_COPY.transferIsALink };
  }
  if (entry.entryType === "transfer" && next.categoryName !== entry.categoryName) {
    return { kind: "note", text: ACTION_COPY.transferKeepsCategory };
  }

  const currency = entry.currency;
  const rows: AskChangeRow[] = [];
  if (next.amountMinor !== entry.amountMinor) rows.push({ field: "amount", before: "", after: "", beforeMinor: entry.amountMinor, afterMinor: next.amountMinor, currency });
  if (next.date !== entry.date) rows.push({ field: "date", before: entry.date, after: next.date });
  if (next.description !== entry.description) rows.push({ field: "description", before: entry.description, after: next.description });
  if (next.categoryName !== entry.categoryName) rows.push({ field: "category", before: entry.categoryName, after: next.categoryName });
  if (next.accountId !== (entry.accountId ?? "")) rows.push({ field: "wallet", before: entry.accountName, after: next.accountName });
  if ((next.ownerName ?? "") !== (entry.ownerName ?? "")) rows.push({ field: "owner", before: entry.ownerName ?? "", after: next.ownerName ?? "" });
  if (next.note !== (entry.note ?? "")) rows.push({ field: "note", before: entry.note ?? "", after: next.note });
  if (!rows.length) {
    return askBack({ code: "nothing_to_change", field: "entry" }, ACTION_COPY.whatToChangeSaved, []);
  }

  const body = (values: typeof next) => ({
    entryId: entry.entryId,
    date: values.date,
    postDate: entry.postDate ?? null,
    description: values.description,
    accountId: values.accountId,
    categoryName: values.categoryName,
    amountMinor: values.amountMinor,
    entryType: entry.entryType,
    ...(entry.transferDirection ? { transferDirection: entry.transferDirection } : {}),
    ownershipType: "direct",
    ...(values.ownerName ? { ownerName: values.ownerName } : {}),
    note: values.note
  });
  const previous = { ...next, amountMinor: entry.amountMinor, date: entry.date, description: entry.description, categoryName: entry.categoryName, accountId: entry.accountId ?? "", accountName: entry.accountName, ownerName: entry.ownerName ?? null, note: entry.note ?? "" };
  const months = [...new Set([entry.date.slice(0, 7), next.date.slice(0, 7)])];
  return change({
    type: "edit_entry",
    title: entry.description,
    rows,
    entries: [entryRow(entry)],
    count: 1,
    save: [{ path: "/api/entries/update", body: body(next) }],
    undo: [{ path: "/api/entries/update", body: body(previous) }],
    month: months[0],
    refresh: ["entries", "month", "summary", ...(entry.linkedToSplits ? ["splits" as const] : [])]
  });
}

// "Make it Transport" (the entry in focus) or "make all Grab rides
// Transport" (every entry whose bank text has the words, read again by the
// route from the household's rows).
export function validateRecategorise(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  const raw = action.recategorise ?? {};
  const category = findCategory(raw.category, context);
  if (category === "unknown") return categoryQuestion(context, String(raw.category ?? ""));
  if (!category) return askBack({ code: "field_missing", field: "whichCategory" }, ACTION_COPY.whichCategory, []);
  if (category === "Transfer") {
    // One saved entry in focus becomes a transfer through the same search
    // as "link this as a transfer"; many entries cannot.
    return context.focus?.kind === "saved_entry" && !raw.words && context.focus.entry.entryType !== "transfer"
      ? transferRequest(context.focus.entry, context, null, null)
      : { kind: "note", text: ACTION_COPY.transferIsALink };
  }

  let words = groundedWords(raw.words, ground);
  if (words === null) return askBack({ code: "field_missing", field: "whichEntries" }, ACTION_COPY.whichEntries, []);
  let month = readMonth(raw.month, context);
  if (!month.ok) return askBack({ code: "month_invalid", field: "month" }, COPY.whichMonth, []);
  if (!words && context.focus?.kind === "entry_list" && context.focus.list.search) {
    words = context.focus.list.search;
    month = { ok: true, month: month.month ?? context.focus.list.month };
  }
  if (words) {
    const from = findCategory(raw.from_category, context);
    if (from === "unknown") return categoryQuestion(context, String(raw.from_category ?? ""));
    return { kind: "resolve", request: { type: "recategorise_bulk", words, categoryName: category, fromCategoryName: from, month: month.month } };
  }

  if (context.focus?.kind !== "saved_entry") {
    return askBack({ code: "field_missing", field: "whichEntries" }, ACTION_COPY.whichEntries, []);
  }
  const entry = context.focus.entry;
  if (entry.entryType === "transfer") return { kind: "note", text: ACTION_COPY.transferKeepsCategory };
  if (entry.categoryName === category) return { kind: "note", text: ACTION_COPY.alreadyInCategory(category) };
  const one = [{ entryId: entry.entryId, fromCategoryName: entry.categoryName, categoryName: category }];
  return change({
    type: "recategorise",
    title: entry.description,
    rows: [{ field: "category", before: entry.categoryName, after: category }],
    entries: [entryRow(entry)],
    count: 1,
    save: [{ path: "/api/entries/update-category", body: { changes: one } }],
    undo: [{ path: "/api/entries/update-category", body: { changes: reverse(one) } }],
    month: entry.date.slice(0, 7),
    refresh: ["entries", "month", "summary"]
  });
}

// A note on the saved entry in focus, or a month's note. The words are the
// person's own.
export function validateEditNote(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  const raw = action.note_edit ?? {};
  const text = groundedNote(raw.text, ground);
  if (text === null) return askBack({ code: "field_missing", field: "noteQuestion" }, ACTION_COPY.noteQuestion, []);
  if (raw.target === "month") {
    const month = readMonth(raw.month, context);
    if (!month.ok) return askBack({ code: "month_invalid", field: "month" }, COPY.whichMonth, []);
    return { kind: "resolve", request: { type: "month_note", month: month.month ?? context.month, personScope: context.viewId, text } };
  }
  if (context.focus?.kind !== "saved_entry") {
    return { kind: "note", text: ACTION_COPY.whichEntryToChange };
  }
  const entry = context.focus.entry;
  const before = entry.note ?? "";
  if (before === text) return { kind: "note", text: ACTION_COPY.noteUnchanged };
  return change({
    type: "entry_note",
    title: entry.description,
    rows: [{ field: "note", before, after: text }],
    entries: [entryRow(entry)],
    count: 1,
    save: [{ path: "/api/entries/update-note", body: { entryId: entry.entryId, note: text } }],
    undo: [{ path: "/api/entries/update-note", body: { entryId: entry.entryId, note: before } }],
    month: entry.date.slice(0, 7),
    refresh: ["entries"]
  });
}

export function validateLinkTransfer(action: AskTurnAction, context: AskTurnContext): AskTurnReply {
  if (context.focus?.kind !== "saved_entry") {
    return { kind: "note", text: ACTION_COPY.whichEntryForTransfer };
  }
  const raw = action.transfer ?? {};
  return transferRequest(context.focus.entry, context, raw.wallet, raw.date);
}

// The saved entry in focus becomes (or is) a transfer: the route searches
// for the other side with the Entries dialog's own rules (buildTransferLink).
// A wallet the person named narrows it; `rawWallet` is the other account.
function transferRequest(entry: AskTurnFocusEntry, context: AskTurnContext, rawWallet: unknown, rawDate: unknown): AskTurnReply {
  if (entry.linkedToTransfer) return { kind: "note", text: ACTION_COPY.alreadyLinked };
  if (entry.linkedToSplits) return { kind: "note", text: ACTION_COPY.onSplitsNotTransfer };
  const wallet = findWallet(rawWallet, context);
  if (wallet === "unknown") return walletQuestion(context, String(rawWallet ?? ""));
  // The entry's own wallet is never the other side.
  const other = wallet && wallet.id !== entry.accountId ? wallet : null;
  const date = readDate(rawDate, context);
  if (!date.ok) return askBack({ code: "date_invalid", field: "entry.date" }, COPY.dateQuestion, []);
  return { kind: "resolve", request: { type: "link_transfer", entry, walletId: other?.id ?? null, walletName: other?.name ?? "", date: date.date } };
}

export function validateSplitGroup(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  const raw = action.group ?? {};
  const op = raw.op;
  if (op === "create") {
    const name = groundedWords(raw.name, ground, NAME_MAX);
    if (!name) return askBack({ code: "field_missing", field: "groupName" }, ACTION_COPY.groupName, []);
    if (context.groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      return { kind: "note", text: ACTION_COPY.groupExists(name) };
    }
    const currency = groundedCurrency(raw.currency, ground) ?? "SGD";
    return change({
      type: "group_create",
      title: name,
      rows: [{ field: "name", before: "", after: name }, { field: "currency", before: "", after: currency }],
      entries: [],
      count: 0,
      save: [{ path: "/api/splits/groups/create", body: { name, currency } }],
      undo: null,
      month: context.month,
      refresh: ["splits"]
    });
  }
  if (op === "move") {
    if (context.focus?.kind !== "saved_entry" || !context.focus.entry.linkedToSplits) {
      return { kind: "note", text: ACTION_COPY.moveNeedsSplit };
    }
    const group = findGroup(raw.name, context);
    if (group === "unknown") return groupQuestion(context, String(raw.name));
    return { kind: "resolve", request: { type: "group_move", entry: context.focus.entry, group } };
  }
  if (op === "settle") {
    const named = findGroup(raw.name, context);
    if (named === "unknown") return groupQuestion(context, String(raw.name));
    const inFocus = context.focus?.kind === "split_group" ? context.focus.group : null;
    // "Settle up with Joyce" names no group: the group in focus is meant; with
    // none, the only group is; with several, they are two readings that settle
    // different groups, so it asks (ask-ambiguity.ts).
    if (named || inFocus) return { kind: "resolve", request: { type: "group_settle", group: (named ?? inFocus) as AskTurnGroup } };
    const decision = decideReadings(context.groups.map((candidate): AskReading<AskTurnGroup> => ({ value: candidate, label: candidate.name, effect: `group:${candidate.id}`, basis: "default" })));
    // Two groups that would settle differently: the person's to choose.
    if (decision.kind === "ask") return groupQuestion(context, "", "ambiguous_name");
    if (decision.kind === "none") return groupQuestion(context);
    const group = decision.chosen.value;
    return withAssumptions({ kind: "resolve", request: { type: "group_settle", group } }, [assumption(ACTION_COPY.settleOnlyGroup(group.name))]);
  }
  if (op === "simplify") {
    if (context.people.length < 2) return { kind: "note", text: COPY.needsTwoPeople };
    return { kind: "resolve", request: { type: "simplify", currency: groundedCurrency(raw.currency, ground) } };
  }
  return askBack({ code: "field_missing", field: "whichGroupAction" }, ACTION_COPY.whichGroupAction, []);
}

export function validateReviewMatches(action: AskTurnAction, context: AskTurnContext): AskTurnReply {
  const month = readMonth(action.matches?.month, context);
  if (!month.ok) return askBack({ code: "month_invalid", field: "month" }, COPY.whichMonth, []);
  return { kind: "resolve", request: { type: "matches", month: month.month ?? context.month } };
}

// "My PayNow is UOB One": the wallet a payment word means for a person
// (Settings -> Payment ways): an active bank wallet for PayNow, an active
// cash wallet for cash.
export function validatePaymentWay(action: AskTurnAction, context: AskTurnContext): AskTurnReply {
  const raw = action.payment_way ?? {};
  const named = findPerson(raw.person, context);
  if (named === "unknown") return personQuestion(context, COPY.whoQuestion, "payment_way.person", String(raw.person));
  const person = named ?? context.people.find((candidate) => candidate.id === context.viewId) ?? null;
  if (!person) return personQuestion(context, COPY.whoQuestion, "payment_way.person");
  const bank = findWallet(raw.paynow_wallet, context);
  if (bank === "unknown" || (bank && bank.kind !== "bank")) return walletsOfKind(context, "bank", ACTION_COPY.payNowWallet);
  const cash = findWallet(raw.cash_wallet, context);
  if (cash === "unknown" || (cash && cash.kind !== "cash")) return walletsOfKind(context, "cash", ACTION_COPY.cashWallet);
  if (!bank && !cash) return askBack({ code: "field_missing", field: "payNowWallet" }, ACTION_COPY.payNowWallet, walletNames(context, "bank"));
  const current = context.entry.paymentWays?.find((way) => way.personId === person.id) ?? { personId: person.id, bankTransferAccountId: "", cashAccountId: "" };
  const nextBank = bank?.id ?? current.bankTransferAccountId;
  const nextCash = cash?.id ?? current.cashAccountId;
  if (nextBank === current.bankTransferAccountId && nextCash === current.cashAccountId) {
    return { kind: "note", text: ACTION_COPY.paymentWayUnchanged(person.name) };
  }
  const name = (id: string) => context.entry.accounts.find((account) => account.id === id)?.name ?? "";
  const rows: AskChangeRow[] = [];
  if (nextBank !== current.bankTransferAccountId) rows.push({ field: "paynow", before: name(current.bankTransferAccountId), after: name(nextBank) });
  if (nextCash !== current.cashAccountId) rows.push({ field: "cash", before: name(current.cashAccountId), after: name(nextCash) });
  return change({
    type: "payment_way",
    title: person.name,
    rows,
    entries: [],
    count: 0,
    save: [{ path: "/api/settings/payment-ways/save", body: { personId: person.id, bankTransferAccountId: nextBank, cashAccountId: nextCash } }],
    undo: [{ path: "/api/settings/payment-ways/save", body: { personId: person.id, bankTransferAccountId: current.bankTransferAccountId, cashAccountId: current.cashAccountId } }],
    month: context.month,
    refresh: ["settings"]
  });
}

// A colour word as one of the category palette's own colours
// (category-palette.ts), so a category never gets a colour outside it.
export const CATEGORY_COLOUR_WORDS: Readonly<Record<string, string>> = Object.freeze({
  gold: "#B48639",
  yellow: "#B48639",
  mustard: "#A58F45",
  avocado: "#566432",
  green: "#566432",
  olive: "#918E54",
  rust: "#C36351",
  red: "#C36351",
  orange: "#C67D3F",
  tan: "#A98466",
  brown: "#7E584A",
  teal: "#46788E",
  blue: "#2C627C",
  mauve: "#B97680",
  pink: "#B97680",
  plum: "#7A587D",
  purple: "#7A587D",
  grey: "#7D7369",
  gray: "#7D7369"
});

export function validateEditCategory(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  const raw = action.category_edit ?? {};
  const records = context.categories ?? [];
  const colourWord = typeof raw.colour === "string" ? raw.colour.trim().toLowerCase() : "";
  const colour = colourWord ? CATEGORY_COLOUR_WORDS[colourWord] ?? null : null;
  if (raw.op === "create") {
    const name = groundedWords(raw.new_name, ground, NAME_MAX);
    if (!name) return askBack({ code: "field_missing", field: "categoryName" }, ACTION_COPY.categoryName, []);
    if (context.entry.categoryNames.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      return { kind: "note", text: ACTION_COPY.categoryExists(name) };
    }
    if (colourWord && !colour) return pickColourInSettings();
    return change({
      type: "category_create",
      title: name,
      rows: [{ field: "name", before: "", after: name }, ...(colour ? [{ field: "colour" as const, before: "", after: colour }] : [])],
      entries: [],
      count: 0,
      save: [{ path: "/api/categories/create", body: { name, ...(colour ? { colorHex: colour } : {}) } }],
      undo: null,
      month: context.month,
      refresh: ["settings", "entries"]
    });
  }
  const categoryName = findCategory(raw.category, context);
  if (categoryName === "unknown") return categoryQuestion(context, String(raw.category ?? ""));
  if (!categoryName) return askBack({ code: "field_missing", field: "whichCategoryToChange" }, ACTION_COPY.whichCategoryToChange, []);
  const record = records.find((category) => category.name === categoryName);
  if (!record) return { kind: "open_page", page: "settings", params: {}, why: ACTION_COPY.categoryInSettings };
  if (raw.op === "rename") {
    if (record.isSystem) return { kind: "note", text: ACTION_COPY.categoryKeepsName(record.name) };
    const name = groundedWords(raw.new_name, ground, NAME_MAX);
    if (!name) return askBack({ code: "field_missing", field: "categoryName" }, ACTION_COPY.categoryName, []);
    if (name === record.name) return { kind: "note", text: ACTION_COPY.categoryExists(name) };
    if (context.entry.categoryNames.some((existing) => existing !== record.name && existing.toLowerCase() === name.toLowerCase())) {
      return { kind: "note", text: ACTION_COPY.categoryExists(name) };
    }
    return change({
      type: "category_rename",
      title: record.name,
      rows: [{ field: "name", before: record.name, after: name }],
      entries: [],
      count: 0,
      save: [{ path: "/api/categories/update", body: { categoryId: record.id, name } }],
      undo: [{ path: "/api/categories/update", body: { categoryId: record.id, name: record.name } }],
      month: context.month,
      refresh: ["settings", "entries", "month", "summary"]
    });
  }
  if (raw.op === "colour") {
    if (!colour) return pickColourInSettings();
    if (colour === record.colorHex) return { kind: "note", text: ACTION_COPY.colourUnchanged(record.name) };
    return change({
      type: "category_colour",
      title: record.name,
      rows: [{ field: "colour", before: record.colorHex, after: colour }],
      entries: [],
      count: 0,
      save: [{ path: "/api/categories/update", body: { categoryId: record.id, colorHex: colour } }],
      undo: [{ path: "/api/categories/update", body: { categoryId: record.id, colorHex: record.colorHex } }],
      month: context.month,
      refresh: ["settings", "entries", "month", "summary"]
    });
  }
  return askBack({ code: "field_missing", field: "whichCategoryChange" }, ACTION_COPY.whichCategoryChange, []);
}

function pickColourInSettings(): AskTurnReply {
  return { kind: "open_page", page: "settings", params: {}, why: ACTION_COPY.pickColour };
}

export function validateLinkPlan(action: AskTurnAction, context: AskTurnContext, ground: Ground): AskTurnReply {
  const raw = action.plan_link ?? {};
  const lineName = typeof raw.line === "string" ? raw.line.trim().toLowerCase() : "";
  const line = context.planLines.find((candidate) => candidate.toLowerCase() === lineName) ?? null;
  if (!line) return askBack({ code: "field_missing", field: "plan_link.line" }, ACTION_COPY.whichPlanLine, context.planLines.slice(0, 4));
  const month = readMonth(raw.month, context);
  if (!month.ok) return askBack({ code: "month_invalid", field: "month" }, COPY.whichMonth, []);
  const words = groundedWords(raw.words, ground);
  if (!words) return askBack({ code: "field_missing", field: "whichEntriesForPlan" }, ACTION_COPY.whichEntriesForPlan(line), []);
  return { kind: "resolve", request: { type: "plan_link", line, month: month.month ?? context.month, words } };
}

const BLOCKED: Record<AskTurnBlocked, { page: "entries" | "month" | "imports" | "settings"; why: string }> = {
  delete_entry: { page: "entries", why: "Ask doesn't delete entries. Open the entry in Entries and delete it there, where you can check it first." },
  delete_month: { page: "month", why: "Ask doesn't delete or reset months. Month has those, with a check before anything goes." },
  delete_import: { page: "imports", why: "Ask doesn't remove imports. Imports shows what each import added before you undo it." },
  import_statement: { page: "imports", why: "Statements are imported on Imports, where you can check the rows before they're added." },
  undo_import: { page: "imports", why: "Ask doesn't undo imports. Imports shows what each import added before you undo it." },
  reconcile: { page: "settings", why: "Checking an account against its statement happens in Settings, beside the account's balances." },
  accounts: { page: "settings", why: "Accounts are added and changed in Settings, not from Ask." },
  people: { page: "settings", why: "The people in the household are changed in Settings, not from Ask." }
};

export function validateBlocked(blocked: AskTurnBlocked, context: AskTurnContext): AskTurnReply {
  const target = BLOCKED[blocked];
  const params: Record<string, string> = target.page === "entries" || target.page === "month" ? { view: context.viewId, month: context.month } : {};
  return { kind: "open_page", page: target.page, params, why: target.why };
}

// ---------------------------------------------------------------------------
// Stage 2: with the household's rows

export interface AskEntryCandidate {
  entryId: string;
  date: string;
  description: string;
  originalDescription: string | null;
  amountMinor: number;
  currency: string;
  categoryName: string;
  entryType: "expense" | "income" | "transfer";
  accountName?: string;
}

// The rule the words would be, so the preview lists exactly the entries a
// category rule with those words would file (the same matcher imports use).
function wordsRule(words: string, categoryName = ""): CategoryMatchRuleDto {
  return { id: "ask-words", pattern: words, categoryId: "", categoryName, priority: 0, isActive: true };
}

function matchesWords(entry: Pick<AskEntryCandidate, "description" | "originalDescription">, words: string) {
  const rule = wordsRule(words, "match");
  return [entry.originalDescription, entry.description].some((text) => Boolean(text) && matchCategoryRule(String(text), [rule]) === "match");
}

export function buildBulkRecategorise(
  request: Extract<AskResolveRequest, { type: "recategorise_bulk" }>,
  candidates: AskEntryCandidate[],
  context: AskTurnContext
): AskTurnReply {
  const moving = candidates
    .filter((entry) => entry.entryType !== "transfer")
    .filter((entry) => entry.categoryName !== request.categoryName)
    .filter((entry) => !request.fromCategoryName || entry.categoryName === request.fromCategoryName)
    .filter((entry) => !request.month || entry.date.startsWith(request.month))
    .filter((entry) => matchesWords(entry, request.words))
    .sort((left, right) => right.date.localeCompare(left.date) || left.entryId.localeCompare(right.entryId));
  if (!moving.length) {
    return { kind: "note", text: ACTION_COPY.noneToMove(request.words, request.categoryName) };
  }
  if (moving.length > BULK_RECATEGORISE_MAX) {
    return { kind: "note", text: ACTION_COPY.tooManyToMove(moving.length, BULK_RECATEGORISE_MAX) };
  }
  const changes = moving.map((entry) => ({ entryId: entry.entryId, fromCategoryName: entry.categoryName, categoryName: request.categoryName }));
  const categoryId = context.categories?.find((category) => category.name === request.categoryName)?.id ?? "";
  // A rule is offered only when no active rule already files these words
  // into that category.
  const covered = context.entry.categoryMatchRules.some((rule) => rule.isActive && rule.categoryName === request.categoryName && moving.some((entry) => matchCategoryRule(entry.description, [rule]) === request.categoryName));
  const from = [...new Set(moving.map((entry) => entry.categoryName))];
  return change({
    type: "recategorise_bulk",
    title: request.words,
    rows: [{ field: "category", before: from.length === 1 ? from[0] : "", after: request.categoryName }],
    entries: moving.slice(0, PREVIEW_ROWS).map((entry) => ({ entryId: entry.entryId, date: entry.date, description: entry.description, amountMinor: entry.amountMinor, currency: entry.currency, categoryName: entry.categoryName })),
    count: moving.length,
    confirmCount: moving.length > BULK_RECATEGORISE_CONFIRM_ABOVE ? moving.length : null,
    save: [{ path: "/api/entries/update-category", body: { changes } }],
    // Undo is the person's own tap, so it carries its count as confirmed.
    undo: [{ path: "/api/entries/update-category", body: { changes: reverse(changes), ...(changes.length > BULK_RECATEGORISE_CONFIRM_ABOVE ? { confirmedCount: changes.length } : {}) } }],
    rule: categoryId && !covered ? { pattern: request.words.toUpperCase(), categoryId, categoryName: request.categoryName } : null,
    month: moving[0].date.slice(0, 7),
    refresh: ["entries", "month", "summary"]
  });
}

export function buildMonthNote(request: Extract<AskResolveRequest, { type: "month_note" }>, currentNote: string | null): AskTurnReply {
  const before = currentNote ?? "";
  if (before === request.text) return { kind: "note", text: ACTION_COPY.noteUnchanged };
  return change({
    type: "month_note",
    title: monthLabel(request.month),
    rows: [{ field: "note", before, after: request.text }],
    entries: [],
    count: 0,
    save: [{ path: "/api/month-note/update", body: { month: request.month, personScope: request.personScope, note: request.text } }],
    undo: [{ path: "/api/month-note/update", body: { month: request.month, personScope: request.personScope, note: before } }],
    month: request.month,
    refresh: ["month", "summary"]
  });
}

export interface AskTransferCandidate {
  entryId: string;
  date: string;
  description: string;
  accountId: string;
  accountName: string;
  amountMinor: number;
  currency: string;
  categoryName: string;
  linked: boolean;
}

// The other side of a transfer. `candidates` are the Entries transfer
// dialog's own (loadTransferMatchCandidates: the same amount in another
// wallet within a month, best first); the card pre-selects the best, offers
// up to 3 more, and, for an entry that is not a transfer yet, "no other
// side yet". A wallet the person named narrows them; with none there, the
// card says so and offers the others. Pairing is the existing command,
// which makes both sides transfers in one batch.
export function buildTransferLink(request: Extract<AskResolveRequest, { type: "link_transfer" }>, candidates: AskTransferCandidate[]): AskTurnReply {
  const entry = request.entry;
  const open = candidates.filter((candidate) => !candidate.linked);
  const { options: shown, walletMissed } = chooseTransferOptions(open, { walletId: request.walletId, date: request.date });
  const becomes = entry.entryType !== "transfer";
  // The command stores a transfer from the side money left to the side it
  // reached; the entry in focus is the receiving side when it is money in.
  const focusIsIn = entry.entryType === "income" || entry.transferDirection === "in";
  const direction = focusIsIn ? "in" : "out";
  const categoryRow: AskChangeRow[] = entry.categoryName === "Transfer" ? [] : [{ field: "category", before: entry.categoryName, after: "Transfer" }];

  const options: AskTransferOption[] = shown.map((other) => {
    const fromEntryId = focusIsIn ? other.entryId : entry.entryId;
    const toEntryId = focusIsIn ? entry.entryId : other.entryId;
    return {
      id: other.entryId,
      rows: [
        { field: "from", before: "", after: focusIsIn ? other.accountName : entry.accountName },
        { field: "to", before: "", after: focusIsIn ? entry.accountName : other.accountName },
        ...categoryRow
      ],
      entries: [entryRow(entry), { entryId: other.entryId, date: other.date, description: other.description, amountMinor: other.amountMinor, currency: other.currency, categoryName: other.categoryName, accountName: other.accountName }],
      count: 2,
      save: [{ path: "/api/transfers/link", body: { fromEntryId, toEntryId } }],
      undo: null
    };
  });

  const classify = (entryType: string, categoryName: string, withDirection: boolean) => ({
    entryId: entry.entryId,
    date: entry.date,
    postDate: entry.postDate ?? null,
    description: entry.description,
    accountId: entry.accountId ?? "",
    categoryName,
    amountMinor: entry.amountMinor,
    entryType,
    ...(withDirection ? { transferDirection: direction } : entry.transferDirection ? { transferDirection: entry.transferDirection } : {}),
    ownershipType: "direct",
    ...(entry.ownerName ? { ownerName: entry.ownerName } : {}),
    note: entry.note ?? ""
  });
  const none: AskTransferOption | null = becomes
    ? {
      id: "none",
      rows: [
        { field: focusIsIn ? "to" : "from", before: "", after: entry.accountName },
        { field: focusIsIn ? "from" : "to", before: "", after: ACTION_COPY.notMatchedYet },
        ...categoryRow
      ],
      entries: [entryRow(entry)],
      count: 1,
      save: [{ path: "/api/entries/update", body: classify("transfer", "Transfer", true) }],
      undo: [{ path: "/api/entries/update", body: classify(entry.entryType, entry.categoryName, false) }]
    }
    : null;

  const first = options[0] ?? none;
  if (!first) return { kind: "note", text: ACTION_COPY.noTransferMatch };
  return change({
    type: "link_transfer",
    title: entry.description,
    rows: first.rows,
    entries: first.entries,
    count: first.count,
    save: first.save,
    undo: first.undo,
    month: entry.date.slice(0, 7),
    refresh: ["entries", "month", "summary"],
    transfer: { options, none, walletMissed: walletMissed ? request.walletName : "" }
  });
}

export interface AskSplitExpenseFacts {
  id: string;
  groupId: string | null;
  groupName: string;
  date: string;
  description: string;
  categoryName: string;
  payerPersonName: string;
  totalAmountMinor: number;
  currency: string;
  homeAmountMinor?: number;
  fxRateBasisPoints?: number;
  paymentMethod: string;
  paymentStatus: string;
  note?: string;
  // The household's first person's share (as splitBasisPoints means it).
  firstBasisPoints: number;
  firstAmountMinor: number;
  closed: boolean;
}

// The split of the saved entry in focus, moved to another group through the
// split editor's own update, every other fact as it is.
export function buildGroupMove(request: Extract<AskResolveRequest, { type: "group_move" }>, split: AskSplitExpenseFacts | null): AskTurnReply {
  if (!split) return { kind: "note", text: ACTION_COPY.moveNeedsSplit };
  if (split.closed) return { kind: "note", text: ACTION_COPY.splitSettled };
  const groupId = request.group?.id ?? null;
  if ((split.groupId ?? null) === groupId) return { kind: "note", text: ACTION_COPY.alreadyInGroup(request.group?.name ?? "") };
  if (request.group && request.group.currency.toUpperCase() !== split.currency.toUpperCase()) {
    return askBack({ code: "field_missing", field: "COPY.groupCurrency" }, COPY.groupCurrency(request.group.name, request.group.currency), [COPY.chips.noGroup]);
  }
  const body = (targetGroupId: string | null) => ({
    splitExpenseId: split.id,
    groupId: targetGroupId,
    date: split.date,
    description: split.description,
    categoryName: split.categoryName,
    payerPersonName: split.payerPersonName,
    amountMinor: split.totalAmountMinor,
    note: split.note ?? "",
    splitBasisPoints: split.firstBasisPoints,
    splitAmountMinor: split.firstAmountMinor,
    currency: split.currency,
    ...(split.homeAmountMinor !== undefined ? { homeAmountMinor: split.homeAmountMinor } : {}),
    ...(split.fxRateBasisPoints !== undefined ? { fxRateBasisPoints: split.fxRateBasisPoints } : {}),
    paymentMethod: split.paymentMethod,
    paymentStatus: split.paymentStatus
  });
  return change({
    type: "group_move",
    title: split.description,
    rows: [{ field: "group", before: split.groupName, after: request.group?.name ?? "" }],
    entries: [entryRow(request.entry)],
    count: 1,
    save: [{ path: "/api/splits/expenses/update", body: body(groupId) }],
    undo: [{ path: "/api/splits/expenses/update", body: body(split.groupId ?? null) }],
    month: split.date.slice(0, 7),
    refresh: ["splits", "entries", "month", "summary"]
  });
}

// "Settle up everything in Bali": the group's balance as Splits shows it
// (positive: the second person owes the first), as a settle-up payment
// draft for the whole amount, recorded today.
export function buildGroupSettle(request: Extract<AskResolveRequest, { type: "group_settle" }>, balanceMinor: number | null, context: AskTurnContext): AskTurnReply {
  const [first, second] = context.people;
  if (!first || !second) return { kind: "note", text: COPY.needsTwoPeople };
  if (!balanceMinor) return { kind: "note", text: ACTION_COPY.nothingOwed(request.group.name) };
  const secondOwes = balanceMinor > 0;
  return {
    kind: "settlement_draft",
    settlement: {
      fromPersonName: secondOwes ? second.name : first.name,
      toPersonName: secondOwes ? first.name : second.name,
      amountMinor: Math.abs(balanceMinor),
      currency: request.group.currency,
      date: context.today,
      groupId: request.group.id,
      groupName: request.group.name
    }
  };
}

export type AskSimplifyPlan =
  | { ok: true; currency: string; recordCount: number; fromPersonName: string | null; toPersonName: string | null; amountMinor: number }
  | { ok: false; reason: "already" | "currencies" | "none" | "other" };

// Simplify: every open split record in one currency, netted into one
// payment, exactly as the command would record it (it reads the same plan).
export function buildSimplify(plan: AskSimplifyPlan, context: AskTurnContext): AskTurnReply {
  if (!plan.ok) {
    if (plan.reason === "already") return { kind: "open_page", page: "splits", params: { view: context.viewId, month: context.month }, why: ACTION_COPY.alreadySimplified };
    if (plan.reason === "currencies") return askBack({ code: "field_missing", field: "simplifyWhichCurrency" }, ACTION_COPY.simplifyWhichCurrency, []);
    return { kind: "note", text: ACTION_COPY.nothingToSimplify };
  }
  if (!plan.recordCount) return { kind: "note", text: ACTION_COPY.nothingToSimplify };
  const viewer = context.people[0];
  return change({
    type: "simplify",
    title: plan.currency,
    rows: [
      { field: "from", before: "", after: plan.fromPersonName ?? "" },
      { field: "to", before: "", after: plan.toPersonName ?? "" },
      { field: "amount", before: "", after: "", afterMinor: plan.amountMinor, currency: plan.currency }
    ],
    entries: [],
    count: plan.recordCount,
    save: [{ path: "/api/splits/checkpoints/create", body: { viewerPersonId: viewer.id, date: context.today, currency: plan.currency } }],
    undo: [{ path: "/api/splits/checkpoints/reopen", body: {}, fromResult: { key: "checkpointId", as: "checkpointId" } }],
    month: context.today.slice(0, 7),
    refresh: ["splits", "entries", "month", "summary"]
  });
}

export function buildMatches(request: Extract<AskResolveRequest, { type: "matches" }>, matches: AskMatch[]): AskTurnReply {
  if (!matches.length) return { kind: "note", text: ACTION_COPY.noMatches(monthLabel(request.month)) };
  return { kind: "matches", month: request.month, matches: matches.slice(0, MAX_MATCHES) };
}

export interface AskPlanRowFacts {
  id: string;
  label: string;
  section: string;
  linkedEntryIds: string[];
}

// Entries of the month whose bank text has the words, linked to the plan
// line; the line's existing links stay.
export function buildPlanLink(request: Extract<AskResolveRequest, { type: "plan_link" }>, rows: AskPlanRowFacts[], candidates: AskEntryCandidate[]): AskTurnReply {
  const named = rows.filter((row) => row.label.trim().toLowerCase() === request.line.toLowerCase());
  const row = named.find((candidate) => candidate.section === "planned_items");
  if (!row) return { kind: "note", text: named.length ? ACTION_COPY.onlyPlannedItems(request.line) : ACTION_COPY.noPlanLine(request.line, monthLabel(request.month)) };
  const linked = new Set(row.linkedEntryIds);
  const adding = candidates
    .filter((entry) => entry.entryType === "expense" && entry.date.startsWith(request.month) && !linked.has(entry.entryId))
    .filter((entry) => matchesWords(entry, request.words))
    .sort((left, right) => left.date.localeCompare(right.date) || left.entryId.localeCompare(right.entryId));
  if (!adding.length) return { kind: "note", text: ACTION_COPY.noneToLink(request.words, monthLabel(request.month)) };
  if (adding.length > BULK_RECATEGORISE_MAX) return { kind: "note", text: ACTION_COPY.tooManyToMove(adding.length, BULK_RECATEGORISE_MAX) };
  return change({
    type: "plan_link",
    title: row.label,
    rows: [{ field: "line", before: "", after: row.label }],
    entries: adding.slice(0, PREVIEW_ROWS).map((entry) => ({ entryId: entry.entryId, date: entry.date, description: entry.description, amountMinor: entry.amountMinor, currency: entry.currency, categoryName: entry.categoryName })),
    count: adding.length,
    save: [{ path: "/api/month-plan/links", body: { rowId: row.id, month: request.month, transactionIds: [...row.linkedEntryIds, ...adding.map((entry) => entry.entryId)] } }],
    undo: [{ path: "/api/month-plan/links", body: { rowId: row.id, month: request.month, transactionIds: row.linkedEntryIds } }],
    month: request.month,
    refresh: ["month", "summary"]
  });
}

// ---------------------------------------------------------------------------
// Helpers

function change(input: Omit<AskChange, "confirmCount" | "rule"> & Partial<Pick<AskChange, "confirmCount" | "rule">>): AskTurnReply {
  return { kind: "change", change: { confirmCount: null, rule: null, ...input } };
}

function entryRow(entry: AskTurnFocusEntry): AskChangeEntry {
  return { entryId: entry.entryId, date: entry.date, description: entry.description, amountMinor: entry.amountMinor, currency: entry.currency, categoryName: entry.categoryName, accountName: entry.accountName };
}

function reverse(changes: Array<{ entryId: string; fromCategoryName: string; categoryName: string }>) {
  return changes.map((item) => ({ entryId: item.entryId, fromCategoryName: item.categoryName, categoryName: item.fromCategoryName }));
}

// Words the model passed on (a shop name, a group or category name), kept
// only when every one is a word the person wrote. "" when none were given,
// null when they were given but are not the person's own.
function groundedWords(value: unknown, ground: Ground, max = WORDS_MAX): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  if (text.length > max || !/\p{L}{2,}/u.test(text)) return null;
  return wordsOf(text).every((word) => ground.words.has(word)) ? scrubName(text) || null : null;
}

// A note as the person wrote it: their own words, at most 200 characters;
// "" clears it (only when they said to clear or remove it).
function groundedNote(value: unknown, ground: Ground): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return /\b(clear|remove|delete)\b/i.test(ground.userText) ? "" : null;
  }
  if (text.length > NOTE_TEXT_MAX) return null;
  return wordsOf(text).every((word) => ground.words.has(word)) ? text : null;
}

// A three-letter currency the person wrote ("in IDR"), or null.
function groundedCurrency(value: unknown, ground: Ground): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) && ground.words.has(code.toLowerCase()) ? code : null;
}

function walletNames(context: AskTurnContext, kind: string) {
  return context.entry.accounts.filter((account) => account.isActive && account.kind === kind).slice(0, 4).map((account) => account.name);
}

function walletsOfKind(context: AskTurnContext, kind: string, question: string): AskTurnReply {
  const names = walletNames(context, kind);
  return askBack({ code: "unknown_wallet", field: "payment_way.wallet", valid: names.map(scrubName) }, question, names);
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTH_SHORT[month - 1]}`;
}

// Every line these actions say back, in plain words.
export const ACTION_COPY = {
  settleOnlyGroup: (name: string) => `You didn't name a group, so I used ${name}, the only split group.`,
  whichEntryToChange: "Which entry should change? Open it from Entries, then ask again.",
  whatToChangeSaved: "What should change on this entry?",
  noteQuestion: "What should the note say? Type it in your own words.",
  noteUnchanged: "The note already says that.",
  bankFactsLocked: (month: string) => `The bank's ${month} statement confirms this entry's amount, date, description and wallet, so they stay as the bank has them. You can still change its category, owner or note.`,
  transferIsALink: "A transfer is money moved between your own wallets. Say \"link this as a transfer\" to pair it with the other side.",
  transferKeepsCategory: "A transfer keeps its Transfer category.",
  whichCategory: "Which category should it go in?",
  whichEntries: "Which entries? Name the shop as the bank shows it, for example: make all Grab rides Transport.",
  alreadyInCategory: (name: string) => `It's already in ${name}.`,
  noneToMove: (words: string, category: string) => `No entries with "${scrubName(words)}" are outside ${category}.`,
  tooManyToMove: (count: number, max: number) => `That's ${count} entries, more than Ask changes at once (${max}). Filter them in Entries instead.`,
  whichEntryForTransfer: "Which entry is one side of the transfer? Open it from Entries, then ask again.",
  alreadyLinked: "This entry is already linked as a transfer.",
  onSplitsNotTransfer: "This entry is on Splits, so it can't also be a transfer.",
  noTransferMatch: "No entry in another wallet has the same amount within a month of this one.",
  notMatchedYet: "Not matched yet",
  groupName: "What should the group be called?",
  groupExists: (name: string) => `There's already a group called ${scrubName(name)}.`,
  moveNeedsSplit: "Only an entry that's on Splits can move to a group. Add it to Splits first.",
  splitSettled: "This split is already settled, so it stays in its group.",
  alreadyInGroup: (name: string) => (name ? `It's already in ${scrubName(name)}.` : "It's already outside any group."),
  whichGroupAction: "What should happen on Splits: a new group, moving this split, settling up, or simplifying?",
  nothingOwed: (name: string) => `Nothing is owed in ${scrubName(name)} right now.`,
  alreadySimplified: "Everything is already simplified into one payment. Splits shows it.",
  simplifyWhichCurrency: "Your splits are in more than one currency. Which currency should be simplified?",
  nothingToSimplify: "There's nothing open on Splits to simplify.",
  noMatches: (month: string) => `No bank rows are waiting to be matched to splits in ${month}.`,
  payNowWallet: "Which bank wallet should PayNow mean?",
  cashWallet: "Which cash wallet should cash mean?",
  paymentWayUnchanged: (name: string) => `${name}'s payment ways already say that.`,
  categoryName: "What should the category be called?",
  categoryExists: (name: string) => `There's already a category called ${scrubName(name)}.`,
  whichCategoryToChange: "Which category should change?",
  whichCategoryChange: "Should the category be added, renamed or recoloured?",
  categoryKeepsName: (name: string) => `${name} is one of the app's own categories, so it keeps its name.`,
  categoryInSettings: "Categories are changed in Settings.",
  colourUnchanged: (name: string) => `${name} already has that colour.`,
  pickColour: "Pick the colour in Settings: it shows every colour a category can have.",
  whichPlanLine: "Which plan line should the entries link to?",
  whichEntriesForPlan: (line: string) => `Which entries count towards ${scrubName(line)}? Name the shop as the bank shows it.`,
  onlyPlannedItems: (line: string) => `Only a bill or dated payment can link to entries, and ${scrubName(line)} isn't one.`,
  noPlanLine: (line: string, month: string) => `${month} has no plan line called ${scrubName(line)}.`,
  noneToLink: (words: string, month: string) => `No unlinked expenses with "${scrubName(words)}" in ${month}.`
};
