// Ask's turn on the page side (docs/flows/ask-flow.md "AI first"): what a
// message is sent with, and the reply read back.
//
// - POST /api/ask/turn (src/server/ask-turn-route.ts). Body { text, history,
//   viewId, scope, month, page, focus }. Response { mode: "rules", reason }
//   (AI off, over its allowance or unusable: read the message with the
//   rules), or { mode: "ai", action, reply } where reply is one of the
//   kinds below, already checked by the server against the household.
// - Saves never use a new route: an add to Splits is POST
//   /api/splits/expenses/from-entry with the proposal's share, a settle-up
//   payment POST /api/splits/settlements/create, an entry the card's create
//   path, a plan change /api/month-plan/apply-changes. A Phase 2 change card
//   (`change`) carries its own steps, each one of ASK_CHANGE_PATHS, and its
//   Undo; a match is Splits' link command.
//
// Fails soft: any network error, non-OK status or unreadable body comes
// back as { ok: false }, and the page reads the message with its rules.

import { readEntryDraftResponse, readPlanDraftResponse } from "./ask-api";

export const ASK_TURN_ENDPOINT = "/api/ask/turn";
const HISTORY_LIMIT = 8;
const HISTORY_TEXT_LIMIT = 200;
const TURN_TIMEOUT_MS = 15_000;
const VARIANTS = new Set(["expense", "income", "transfer"]);
const PAGES = new Set(["summary", "month", "entries", "splits", "imports", "settings", "help"]);

/**
 * The recent conversation the model reads: the person's messages as
 * written, and a short line for what Ask showed back. Status lines and
 * photos are left out.
 * @param {any[]} thread
 * @returns {{ role: "user" | "app", text: string }[]}
 */
export function buildTurnHistory(thread = []) {
  const lines = [];
  for (const item of thread) {
    const text = describeThreadItem(item);
    if (text) {
      lines.push({ role: /** @type {"user" | "app"} */ (item.kind === "me" ? "user" : "app"), text: text.slice(0, HISTORY_TEXT_LIMIT) });
    }
  }
  return lines.slice(-HISTORY_LIMIT);
}

function describeThreadItem(item) {
  switch (item?.kind) {
    case "me": return item.hiddenText ?? item.text ?? "";
    case "note": return item.text ?? "";
    case "answer": return "Showed the matching entries.";
    case "money-answer": return item.answer?.title ? `Answered: ${item.answer.title}` : "Answered a money question.";
    case "money-check": return "Asked to check one entry before answering.";
    case "insight-answer": return "Explained a Money insights line.";
    case "plan-draft": return "Drafted a plan change.";
    case "split-proposal": return `Drafted adding ${item.proposal?.description ?? "the entry"} to Splits${item.status === "saved" ? " (added)" : ""}.`;
    case "settlement-draft": return `Drafted a settle-up payment${item.status === "saved" ? " (recorded)" : ""}.`;
    case "change-draft": return `Drafted a change (${String(item.change?.type ?? "").replace(/_/g, " ")}) to ${item.change?.title ?? "it"}${item.status === "saved" ? " (saved)" : item.status === "undone" ? " (undone)" : ""}.`;
    case "matches": return "Showed bank rows that may match splits.";
    default: return "";
  }
}

/**
 * What is in focus for this message: the saved entry (the Apple Pay card,
 * a card saved here), the card being filled, or the split group Ask was
 * opened for. Names and ids only; the server loads the entry itself.
 */
export function buildTurnFocus({ card = null, intent = null, insightTopic = "", list = null } = {}) {
  // The Entries answer Ask showed last ("make these Transport"): what it
  // searched for, never its rows; the server reads the entries again.
  if (list?.month) {
    return {
      kind: "entry_list",
      list: { month: list.month, search: typeof list.search === "string" ? list.search : "", categories: Array.isArray(list.categories) ? list.categories : [] }
    };
  }
  if (card?.status === "saved" && card.saved?.entryId) {
    return { kind: "saved_entry", entryId: card.saved.entryId };
  }
  if (card && card.status !== "saved") {
    const { fields } = card;
    return {
      kind: "draft",
      draft: {
        variant: card.variant,
        description: fields.description ?? "",
        date: fields.date ?? "",
        accountId: fields.accountId ?? "",
        categoryName: fields.categoryName ?? "",
        ownerName: fields.ownerName ?? "",
        amountMinor: fields.amountMinor ?? 0,
        shareOn: Boolean(card.share?.on),
        splitGroupId: card.share?.splitGroupId || intent?.splitGroupId || ""
      }
    };
  }
  if (intent?.splitGroupId) {
    return { kind: "split_group", groupId: intent.splitGroupId };
  }
  if (insightTopic) {
    return { kind: "insight", topic: insightTopic };
  }
  return null;
}

/**
 * @returns {Promise<{ ok: true, mode: "rules", reason: string, notice?: "demo_allowance", reply?: any } | { ok: true, mode: "ai", action: string, reply: any } | { ok: false }>}
 */
export async function requestAskTurn(body, { fetchImpl = fetch, timeoutMs = TURN_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(ASK_TURN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller?.signal
    });
    if (!response.ok) {
      return { ok: false };
    }
    return readAskTurnResponse(await response.json().catch(() => null));
  } catch {
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The turn route's answer as the page keeps it, or { ok: false }.
 * @returns {any} */
export function readAskTurnResponse(body) {
  if (!body || typeof body !== "object" || body.ok !== true) {
    return { ok: false };
  }
  if (body.mode === "rules") {
    return {
      ok: true,
      mode: "rules",
      reason: typeof body.reason === "string" ? body.reason : "",
      // The rules' own checked reading of a share on the saved entry, when there is one.
      ...(readRulesReply(body.reply) ? { reply: readRulesReply(body.reply) } : {}),
      ...(body.notice === "demo_allowance" ? { notice: "demo_allowance" } : {})
    };
  }
  const reply = body.mode === "ai" ? readReply(body.reply) : null;
  return reply ? { ok: true, mode: "ai", action: String(body.action ?? ""), reply } : { ok: false };
}

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isMinor = (value) => Number.isInteger(value) && value >= 0;
const isText = (value) => typeof value === "string";

// A rules answer may carry only the split draft (or its plain question) the
// server's share reader checked; any other kind is the page's own rules' job.
function readRulesReply(reply) {
  const read = readReply(reply);
  return read && (read.kind === "split_proposal" || read.kind === "clarify" || read.kind === "note") ? read : null;
}

const ASSUMPTION_TEXT_LIMIT = 140;
const ASSUMPTION_CHIP_LIMIT = 40;
const ASSUMPTION_MAX = 3;
const ASSUMPTION_MAX_CHIPS = 3;

// What the app assumed while drafting (docs/flows/ask-flow.md, "Three
// principles"): plain-words lines, each with up to 3 one-tap alternatives.
// Anything malformed is dropped; the reply itself is unaffected.
/** @returns {{ text: string, chips: string[] }[]} */
export function readAssumptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isObject(item) && isText(item.text) && item.text.trim() && item.text.length <= ASSUMPTION_TEXT_LIMIT)
    .slice(0, ASSUMPTION_MAX)
    .map((item) => ({
      text: item.text.trim(),
      chips: (Array.isArray(item.chips) ? item.chips : [])
        .filter((chip) => isText(chip) && chip.trim() && chip.length <= ASSUMPTION_CHIP_LIMIT)
        .slice(0, ASSUMPTION_MAX_CHIPS)
    }));
}

function readReply(reply) {
  const read = readReplyBody(reply);
  if (!read) return null;
  const assumptions = readAssumptions(reply.assumptions);
  return assumptions.length ? { ...read, assumptions } : read;
}

function readReplyBody(reply) {
  if (!isObject(reply)) return null;
  switch (reply.kind) {
    case "entry_draft": {
      const draft = readEntryDraftResponse({ ok: true, draft: reply.draft });
      return draft ? { kind: "entry_draft", draft, share: readShare(reply.share) } : null;
    }
    case "draft_patch":
      return isObject(reply.patch) ? { kind: "draft_patch", patch: readPatch(reply.patch), share: readShare(reply.share) } : null;
    case "split_proposal": {
      const proposal = reply.proposal;
      const valid = isObject(proposal) && isText(proposal.entryId) && isMinor(proposal.amountMinor) && Number.isInteger(proposal.splitBasisPoints)
        && Array.isArray(proposal.shares) && proposal.shares.length === 2 && proposal.shares.every((share) => isText(share?.personName) && isMinor(share.amountMinor));
      return valid ? { kind: "split_proposal", proposal } : null;
    }
    case "settlement_draft": {
      const settlement = reply.settlement;
      const valid = isObject(settlement) && isText(settlement.fromPersonName) && isText(settlement.toPersonName) && isMinor(settlement.amountMinor) && settlement.amountMinor > 0 && isText(settlement.date);
      return valid ? { kind: "settlement_draft", settlement } : null;
    }
    case "plan": {
      const reading = readPlanDraftResponse(reply.reading);
      return reading && isText(reply.text) && isObject(reply.request) ? { kind: "plan", text: reply.text, request: reply.request, reading } : null;
    }
    case "question":
      return isText(reply.text) && reply.text ? { kind: "question", text: reply.text, request: { viewId: String(reply.viewId ?? ""), scope: String(reply.scope ?? ""), month: String(reply.month ?? "") } } : null;
    case "search":
      return isObject(reply.filter) && isText(reply.filter.month) && Array.isArray(reply.filter.categories) && Array.isArray(reply.filter.wallets) ? { kind: "search", filter: reply.filter } : null;
    case "open_page":
      return PAGES.has(reply.page) && isObject(reply.params)
        ? { kind: "open_page", page: reply.page, params: reply.params, why: isText(reply.why) ? reply.why : "" }
        : null;
    case "change":
      return readChange(reply.change);
    case "matches":
      return isText(reply.month) && Array.isArray(reply.matches) && reply.matches.length && reply.matches.every(isMatch)
        ? { kind: "matches", month: reply.month, matches: reply.matches }
        : null;
    case "clarify":
      return isText(reply.question) && reply.question
        ? { kind: "clarify", question: reply.question, options: (Array.isArray(reply.options) ? reply.options : []).filter((option) => isText(option) && option).slice(0, 4) }
        : null;
    case "note":
      return isText(reply.text) && reply.text ? { kind: "note", text: reply.text, ...(reply.autoDone === true ? { autoDone: true } : {}) } : null;
    default:
      return null;
  }
}

// The only commands a change card may post to: the page's own copy of
// ASK_CHANGE_PATHS (src/domain/ask-turn-actions.ts). A card naming any other
// path is not shown.
export const ASK_CHANGE_PATHS = Object.freeze([
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
  "/api/month-note/update"
]);
const CHANGE_TYPES = new Set([
  "edit_entry", "recategorise", "recategorise_bulk", "entry_note", "month_note", "link_transfer", "group_create",
  "group_move", "simplify", "payment_way", "category_create", "category_rename", "category_colour", "plan_link"
]);
const MATCH_PATHS = Object.freeze({ expense: "/api/splits/matches/link-expense", settlement: "/api/splits/matches/link-settlement" });

const isStep = (step) => isObject(step) && ASK_CHANGE_PATHS.includes(step.path) && isObject(step.body);

const isRow = (row) => isObject(row) && isText(row.field) && isText(row.before) && isText(row.after);
const isChangeEntry = (entry) => isObject(entry) && isText(entry.entryId) && isText(entry.description) && Number.isInteger(entry.amountMinor);

// One way a transfer change can end: pairing with an other side, or "none"
// (an unmatched transfer). Anything malformed drops the whole card.
function readTransferOption(option) {
  if (!isObject(option) || !isText(option.id) || !option.id) return null;
  if (!Array.isArray(option.rows) || !option.rows.every(isRow)) return null;
  if (!Array.isArray(option.entries) || !option.entries.every(isChangeEntry)) return null;
  if (!Array.isArray(option.save) || !option.save.length || !option.save.every(isStep)) return null;
  if (option.undo !== null && !(Array.isArray(option.undo) && option.undo.every(isStep))) return null;
  return { ...option, count: Number.isInteger(option.count) ? option.count : option.entries.length };
}

function readTransferChoices(transfer) {
  if (transfer === undefined || transfer === null) return { ok: true, value: null };
  if (!isObject(transfer) || !Array.isArray(transfer.options) || transfer.options.length > 4) return { ok: false, value: null };
  const options = transfer.options.map(readTransferOption);
  const none = transfer.none === null || transfer.none === undefined ? null : readTransferOption(transfer.none);
  if (options.some((option) => !option) || (transfer.none && !none) || (!options.length && !none)) return { ok: false, value: null };
  return { ok: true, value: { options, none, walletMissed: isText(transfer.walletMissed) ? transfer.walletMissed : "" } };
}

/**
 * A change card as it will be saved: for a transfer change, the rows,
 * entries, steps and Undo of the choice the person made (the best match
 * when they made none). Every other change is returned as it is.
 */
export function effectiveChange(change, choiceId = "") {
  const choices = change.transfer;
  if (!choices) return change;
  const chosen = effectiveChangeChoice(choices, choiceId);
  return { ...change, rows: chosen.rows, entries: chosen.entries, count: chosen.count, save: chosen.save, undo: chosen.undo };
}

/** The id of the choice a change card has selected (the best match by default). */
export function selectedChoiceId(change, choiceId = "") {
  const choices = change.transfer;
  if (!choices) return "";
  return effectiveChangeChoice(choices, choiceId).id;
}

function effectiveChangeChoice(choices, choiceId) {
  return [...choices.options, ...(choices.none ? [choices.none] : [])].find((option) => option.id === choiceId) ?? choices.options[0] ?? choices.none;
}

function readChange(change) {
  if (!isObject(change) || !CHANGE_TYPES.has(change.type) || !isText(change.title) || !isText(change.month)) return null;
  if (!Array.isArray(change.rows) || !change.rows.every((row) => isObject(row) && isText(row.field) && isText(row.before) && isText(row.after))) return null;
  if (!Array.isArray(change.entries) || !change.entries.every((entry) => isObject(entry) && isText(entry.entryId) && isText(entry.description) && Number.isInteger(entry.amountMinor))) return null;
  if (!Array.isArray(change.save) || !change.save.length || !change.save.every(isStep)) return null;
  if (change.undo !== null && !(Array.isArray(change.undo) && change.undo.every(isStep))) return null;
  const transfer = readTransferChoices(change.transfer);
  if (!transfer.ok) return null;
  const rule = isObject(change.rule) && isText(change.rule.pattern) && isText(change.rule.categoryId) && isText(change.rule.categoryName) ? change.rule : null;
  return {
    kind: "change",
    change: {
      ...change,
      count: Number.isInteger(change.count) ? change.count : 0,
      confirmCount: Number.isInteger(change.confirmCount) && change.confirmCount > 0 ? change.confirmCount : null,
      refresh: Array.isArray(change.refresh) ? change.refresh.filter(isText) : [],
      rule,
      transfer: transfer.value
    }
  };
}

function isMatch(match) {
  return isObject(match) && (match.kind === "expense" || match.kind === "settlement") && isText(match.id) && isText(match.splitRecordId)
    && isText(match.transactionId) && isMinor(Math.abs(match.amountMinor)) && isMinor(Math.abs(match.splitAmountMinor));
}

/**
 * A change card's Save or Undo: each step through its existing command, in
 * order, stopping at the first failure. `confirmedCount` is added only when
 * the person tapped "Yes, change all N"; `result` is the save's response,
 * for an Undo that names what the save created.
 * @returns {Promise<{ ok: boolean, error: string, result: any }>}
 */
export async function runChangeSteps(steps, { confirmedCount = undefined, result = null, fetchImpl = fetch } = {}) {
  let last = result;
  for (const step of steps ?? []) {
    if (!isStep(step)) {
      return { ok: false, error: "This change can't be saved from here. Open the page it lives on.", result: last };
    }
    const body = { ...step.body };
    if (Number.isInteger(confirmedCount) && step.path === "/api/entries/update-category" && Array.isArray(body.changes)) {
      body.confirmedCount = confirmedCount;
    }
    if (step.fromResult && last && isText(step.fromResult.as)) {
      body[step.fromResult.as] = last[step.fromResult.key];
    }
    const response = await postJson(step.path, body, "That couldn't be saved. Check your connection and try again.", fetchImpl);
    if (!response.ok) {
      return { ok: false, error: response.error, result: last };
    }
    last = response;
  }
  return { ok: true, error: "", result: last };
}

// "Also file new ones": the existing category rule command.
export function saveChangeRule(rule, { fetchImpl = fetch } = {}) {
  return postJson("/api/category-match-rules/save", { pattern: rule.pattern, categoryId: rule.categoryId }, "The rule couldn't be saved.", fetchImpl);
}

// Accept one match: Splits' own link command for that kind.
export function linkTurnMatch(match, { fetchImpl = fetch } = {}) {
  const body = match.kind === "expense"
    ? { splitExpenseId: match.splitRecordId, transactionId: match.transactionId }
    : { settlementId: match.splitRecordId, transactionId: match.transactionId };
  return postJson(MATCH_PATHS[match.kind], body, "That match couldn't be saved.", fetchImpl);
}

function readShare(share) {
  return isObject(share) ? { on: share.on === true, groupId: isText(share.groupId) ? share.groupId : "" } : null;
}

function readPatch(patch) {
  const next = {};
  if (VARIANTS.has(patch.variant)) next.variant = patch.variant;
  for (const key of ["description", "date", "accountId", "transferAccountId", "categoryName", "ownerName"]) {
    if (isText(patch[key]) && patch[key]) next[key] = patch[key];
  }
  if (isMinor(patch.amountMinor) && patch.amountMinor > 0) next.amountMinor = patch.amountMinor;
  if (Number.isInteger(patch.splitBasisPoints) && patch.splitBasisPoints >= 0 && patch.splitBasisPoints <= 10_000) next.splitBasisPoints = patch.splitBasisPoints;
  return next;
}

// Save of an add-to-Splits proposal: the existing command, with the share.
export function saveSplitProposal(proposal, { fetchImpl = fetch } = {}) {
  return postJson("/api/splits/expenses/from-entry", {
    entryId: proposal.entryId,
    splitGroupId: proposal.groupId || null,
    splitBasisPoints: proposal.splitBasisPoints,
    ...(Number.isInteger(proposal.splitAmountMinor) ? { splitAmountMinor: proposal.splitAmountMinor } : {})
  }, "The entry could not be added to Splits.", fetchImpl);
}

// Save of a settle-up payment draft: the existing command.
export function saveSettlementDraft(settlement, { fetchImpl = fetch } = {}) {
  return postJson("/api/splits/settlements/create", {
    groupId: settlement.groupId || null,
    date: settlement.date,
    fromPersonName: settlement.fromPersonName,
    toPersonName: settlement.toPersonName,
    amountMinor: settlement.amountMinor,
    currency: settlement.currency
  }, "The payment could not be recorded.", fetchImpl);
}

// Undo of an add to Splits: the existing delete; the entry stays.
export function removeSplitExpense(splitExpenseId, { fetchImpl = fetch } = {}) {
  return postJson("/api/splits/expenses/delete", { splitExpenseId }, "The split could not be removed.", fetchImpl);
}

async function postJson(path, body, fallbackError, fetchImpl) {
  try {
    const response = await fetchImpl(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    return response.ok ? { ok: true, ...(data ?? {}) } : { ok: false, error: data?.error ?? fallbackError };
  } catch {
    return { ok: false, error: fallbackError };
  }
}
