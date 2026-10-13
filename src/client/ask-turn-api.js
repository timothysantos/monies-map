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
//   path, a plan change /api/month-plan/apply-changes.
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
    default: return "";
  }
}

/**
 * What is in focus for this message: the saved entry (the Apple Pay card,
 * a card saved here), the card being filled, or the split group Ask was
 * opened for. Names and ids only; the server loads the entry itself.
 */
export function buildTurnFocus({ card = null, intent = null, insightTopic = "" } = {}) {
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
 * @returns {Promise<{ ok: true, mode: "rules", reason: string } | { ok: true, mode: "ai", action: string, reply: any } | { ok: false }>}
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
    return { ok: true, mode: "rules", reason: typeof body.reason === "string" ? body.reason : "" };
  }
  const reply = body.mode === "ai" ? readReply(body.reply) : null;
  return reply ? { ok: true, mode: "ai", action: String(body.action ?? ""), reply } : { ok: false };
}

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isMinor = (value) => Number.isInteger(value) && value >= 0;
const isText = (value) => typeof value === "string";

function readReply(reply) {
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
      return PAGES.has(reply.page) && isObject(reply.params) ? { kind: "open_page", page: reply.page, params: reply.params } : null;
    case "clarify":
      return isText(reply.question) && reply.question
        ? { kind: "clarify", question: reply.question, options: (Array.isArray(reply.options) ? reply.options : []).filter((option) => isText(option) && option).slice(0, 4) }
        : null;
    case "note":
      return isText(reply.text) && reply.text ? { kind: "note", text: reply.text } : null;
    default:
      return null;
  }
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
