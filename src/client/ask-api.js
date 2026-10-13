// Every request the Ask page makes, in one place, so the two reader
// endpoints can be adjusted here when they land:
//
// - POST /api/ai-assist/entry-draft (src/server/ai-assistance-routes.ts): a
//   typed sentence read into an entry draft. Body { text, viewId }. Response
//   EntryDraftResponseDto: { ok, draft: { fields: { <name>: { value, source } },
//   transferAccount, foreignAmount, missing, questions, flags, createBody },
//   ai: { requested, available, reason } }. source is "sentence" | "rule" |
//   "default" | "ai".
// - POST /api/ai-assist/receipt-read (src/server/receipt-read-route.ts): one
//   receipt photo read into a ReceiptReadDto { source, merchant, date, total,
//   cardLast4, lineItems, questions }, each value with a confidence. Sent as
//   multipart form data with one "image" part: the photo downscaled and
//   re-encoded in this browser (ask-receipt-image.js), so no EXIF or location
//   data leaves it. Response { ok, available: true, receipt, provider,
//   remaining }, or { ok, available: false, reason } when AI is off or out
//   of allowance (the page then reads the photo on the device).
//
// - POST /api/ai-assist/answer (src/server/ask-answer-route.ts): a money
//   question ("why was August so expensive?"). Body { text, viewId, scope,
//   month, keepCandidateIds }. Response AskAnswerResponseDto: { supported },
//   or { needsConfirmation, candidates } (skew candidates with their
//   suggested actions), or { answer, wording: { text, source } }.
//
// - POST /api/ai-assist/plan-draft (src/server/plan-draft-route.ts): a
//   typed change to a month's plan ("move $50 from Shopping to Groceries in
//   October"). Body { text, viewId, month, answers }. Response
//   PlanDraftResponseDto: { supported: false } (not a plan request; read it
//   as before), or { supported, source, draft | question | note }.
//   Saving the draft is POST /api/month-plan/apply-changes { month,
//   changes: draft.apply } → { applied, undo }; Undo posts `undo` the
//   same way. A 409 means the plan changed since the draft.
//
// - POST /api/splits/suggestion (src/domain/pages/split-suggestion.ts): the
//   split group and share the payer usually uses for entries like this one
//   (DOMAIN.md "Split Suggestion"). Body { entryId } for a saved entry, else
//   the card's { entryType, description, categoryName, ownerName,
//   accountId, date }. Response { ok, suggestion: SplitSuggestionDto | null }.
//   Read-only.
//
// Saving an entry never uses a new route: the card goes through the Entries
// composer's create path (entry-actions.js createEntryFromDraft), and the
// follow-ups through the existing entry and split routes. A plan draft is
// saved through the plan-row save statements, all its lines in one batch
// (/api/month-plan/apply-changes).
//
// Readers fail soft: any network error, non-OK status or unreadable body
// comes back as { ok: false, reason } and the card stays manual.

import { createEntryFromDraft } from "./entry-create-request";
import { readSplitSuggestionResponse } from "./ask-split-suggestion";

export const ASK_ENDPOINTS = Object.freeze({
  entryDraft: "/api/ai-assist/entry-draft",
  receiptRead: "/api/ai-assist/receipt-read",
  answer: "/api/ai-assist/answer",
  insightExplain: "/api/ai-assist/insight-explain",
  splitSuggestion: "/api/splits/suggestion",
  planDraft: "/api/ai-assist/plan-draft",
  planApply: "/api/month-plan/apply-changes"
});

const DRAFT_FIELD_NAMES = [
  "date",
  "description",
  "accountId",
  "accountName",
  "categoryName",
  "amountMinor",
  "entryType",
  "transferDirection",
  "ownershipType",
  "ownerName",
  "splitBasisPoints"
];

function isFieldValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "value" in value;
}

// The draft as the card reads it. Accepts the branch's nested shape
// ({ draft: { fields } }) and the flat one the design brief described
// (fields at the top level), so either can land without touching the card.
export function readEntryDraftResponse(body) {
  if (!body || typeof body !== "object" || body.ok === false) {
    return null;
  }
  const draft = body.draft && typeof body.draft === "object" ? body.draft : body;
  const source = draft.fields && typeof draft.fields === "object" ? draft.fields : draft;
  const fields = {};
  for (const name of DRAFT_FIELD_NAMES) {
    if (isFieldValue(source[name])) {
      fields[name] = { value: source[name].value, source: String(source[name].source ?? "sentence") };
    }
  }
  if (!Object.keys(fields).length) {
    return null;
  }
  return {
    fields,
    transferAccount: isFieldValue(draft.transferAccount) ? draft.transferAccount : null,
    foreignAmount: draft.foreignAmount ?? null,
    missing: Array.isArray(draft.missing) ? draft.missing : [],
    questions: Array.isArray(draft.questions)
      ? draft.questions.filter((question) => question && typeof question.field === "string").map((question) => ({
          field: question.field,
          reason: String(question.reason ?? "missing"),
          options: Array.isArray(question.options) ? question.options : []
        }))
      : [],
    ai: body.ai ?? { requested: false, available: false }
  };
}

const CONFIDENCE = new Set(["high", "medium", "low"]);

function readConfidence(value) {
  return CONFIDENCE.has(value) ? value : "low";
}

// The receipt as the card reads it: the in-progress ReceiptReadDto
// ({ merchant: { value, confidence }, total: { amountMinor, currency } })
// or the brief's flat one (merchant, totalMinor, currency, confidence: {}).
export function readReceiptReadResponse(body) {
  if (!body || typeof body !== "object" || body.ok === false) {
    return null;
  }
  const receipt = body.receipt && typeof body.receipt === "object" ? body.receipt : body;
  const confidence = receipt.confidence && typeof receipt.confidence === "object" ? receipt.confidence : {};
  const merchant = isFieldValue(receipt.merchant)
    ? { value: receipt.merchant.value || null, confidence: readConfidence(receipt.merchant.confidence) }
    : { value: typeof receipt.merchant === "string" && receipt.merchant.trim() ? receipt.merchant.trim() : null, confidence: readConfidence(confidence.merchant) };
  const date = isFieldValue(receipt.date)
    ? { value: receipt.date.value || null, confidence: readConfidence(receipt.date.confidence) }
    : { value: typeof receipt.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(receipt.date) ? receipt.date : null, confidence: readConfidence(confidence.date) };
  const total = receipt.total && typeof receipt.total === "object"
    ? {
        amountMinor: Number.isFinite(receipt.total.amountMinor) ? receipt.total.amountMinor : null,
        currency: typeof receipt.total.currency === "string" ? receipt.total.currency : null,
        confidence: readConfidence(receipt.total.confidence)
      }
    : {
        amountMinor: Number.isFinite(receipt.totalMinor) ? receipt.totalMinor : null,
        currency: typeof receipt.currency === "string" ? receipt.currency : null,
        confidence: readConfidence(confidence.total)
      };
  if (!merchant.value && !date.value && total.amountMinor === null) {
    return null;
  }
  return {
    source: receipt.source === "ocr" ? "ocr" : "ai",
    merchant,
    date,
    total,
    cardLast4: typeof receipt.cardLast4 === "string" && /^\d{4}$/.test(receipt.cardLast4) ? receipt.cardLast4 : null,
    lineItems: Array.isArray(receipt.lineItems) ? receipt.lineItems : [],
    questions: Array.isArray(receipt.questions)
      ? receipt.questions.filter((question) => question && typeof question.field === "string")
      : []
  };
}

async function readJson(response) {
  return response.json().catch(() => null);
}

export async function requestEntryDraft({ text, viewId, signal = undefined, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(ASK_ENDPOINTS.entryDraft, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, viewId }),
      signal
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 404 ? "unavailable" : "failed" };
    }
    const draft = readEntryDraftResponse(await readJson(response));
    return draft ? { ok: true, draft } : { ok: false, reason: "unreadable" };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    return { ok: false, reason: "network" };
  }
}

export async function requestReceiptRead({ image, signal = undefined, fetchImpl = fetch }) {
  try {
    const form = new FormData();
    form.append("image", image, "receipt.jpg");
    const response = await fetchImpl(ASK_ENDPOINTS.receiptRead, { method: "POST", body: form, signal });
    if (!response.ok) {
      return { ok: false, reason: response.status === 404 ? "unavailable" : "failed" };
    }
    const body = await readJson(response);
    // The route answers 200 { available: false, reason } when AI is off.
    if (body && body.available === false && !body.receipt) {
      return { ok: false, reason: typeof body.reason === "string" ? body.reason : "unavailable" };
    }
    const receipt = readReceiptReadResponse(body);
    return receipt ? { ok: true, receipt } : { ok: false, reason: "unreadable" };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    return { ok: false, reason: "network" };
  }
}

// The split suggestion for a card (ask-split-suggestion.js builds the body).
// Fails soft: any error, refusal or unreadable answer is no suggestion.
export async function requestSplitSuggestion(body, { signal = undefined, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(ASK_ENDPOINTS.splitSuggestion, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    return response.ok ? readSplitSuggestionResponse(await readJson(response)) : null;
  } catch {
    return null;
  }
}

// Saves the card's draft through the composer's create path.
export function saveCardEntry(createDraft, { fetchImpl = fetch } = {}) {
  return createEntryFromDraft(createDraft, { fetchImpl }).catch(() => ({
    ok: false,
    error: "The entry could not be saved. Check your connection and try again.",
    entryId: null,
    splitExpenseId: null,
    splitExpenseMonth: null,
    splitAddError: ""
  }));
}

async function postJson(path, body, fallbackError, fetchImpl) {
  try {
    const response = await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await readJson(response);
    return response.ok ? { ok: true, ...(data ?? {}) } : { ok: false, error: data?.error ?? fallbackError };
  } catch {
    return { ok: false, error: fallbackError };
  }
}

// Undo after a save: the existing delete routes. A split the save created
// goes first, so no split is left pointing at nothing.
export async function undoSavedEntry({ entryId, splitExpenseId }, { fetchImpl = fetch } = {}) {
  if (splitExpenseId) {
    const split = await postJson("/api/splits/expenses/delete", { splitExpenseId }, "The split could not be removed.", fetchImpl);
    if (!split.ok) {
      return split;
    }
  }
  return postJson("/api/entries/delete", { entryId }, "The entry could not be removed.", fetchImpl);
}

export function updateSavedEntryCategory({ entryId, categoryName }, { fetchImpl = fetch } = {}) {
  return postJson("/api/entries/update-category", { entryId, categoryName }, "The category could not be changed.", fetchImpl);
}

export function addSavedEntryToSplits({ entryId, splitGroupId }, { fetchImpl = fetch } = {}) {
  return postJson(
    "/api/splits/expenses/from-entry",
    { entryId, splitGroupId: splitGroupId === "split-group-none" ? null : (splitGroupId || null) },
    "The entry could not be added to Splits.",
    fetchImpl
  );
}

const ANSWER_INTENTS = new Set(["spending", "plan", "compare", "biggest", "owed", "income", "invested", "saved", "spentVsEarned"]);

/**
 * @typedef {{ supported: boolean, needsConfirmation?: boolean, intent?: string, viewId?: string, scope?: string, months?: string[], candidates?: any[], answer?: { title: string, lead: any, support: any[], lines: any[], links: any[] }, wording?: { text: string, source: "ai" | "template" } }} MoneyAnswer
 */

// The answer as the page keeps it: only the parts it renders, checked.
/** @returns {MoneyAnswer | null} */
export function readMoneyAnswerResponse(body) {
  if (!body || typeof body !== "object" || body.ok !== true || typeof body.supported !== "boolean") {
    return null;
  }
  if (!body.supported) {
    return { supported: false };
  }
  if (!ANSWER_INTENTS.has(body.intent)) {
    return null;
  }
  const base = { supported: true, intent: body.intent, viewId: String(body.viewId ?? ""), scope: String(body.scope ?? ""), months: Array.isArray(body.months) ? body.months.map(String) : [] };
  if (body.needsConfirmation) {
    const candidates = Array.isArray(body.candidates)
      ? body.candidates.filter((candidate) => candidate && typeof candidate.id === "string" && Array.isArray(candidate.suggestedActions))
      : [];
    return candidates.length ? { ...base, needsConfirmation: true, candidates } : null;
  }
  const answer = body.answer;
  const wording = body.wording;
  if (!answer || typeof answer !== "object" || !answer.lead || !Number.isFinite(answer.lead.amountMinor) || !wording || typeof wording.text !== "string") {
    return null;
  }
  return {
    ...base,
    needsConfirmation: false,
    answer: {
      title: String(answer.title ?? ""),
      lead: answer.lead,
      support: Array.isArray(answer.support) ? answer.support : [],
      lines: Array.isArray(answer.lines) ? answer.lines : [],
      links: Array.isArray(answer.links) ? answer.links.filter((link) => ["entries", "month", "splits"].includes(link?.kind)) : [],
      ...(readOutcome(answer.outcome) ? { outcome: readOutcome(answer.outcome) } : {})
    },
    wording: { text: wording.text, source: wording.source === "ai" ? "ai" : "template" }
  };
}

// The savings-bar figures (the plan and money-job answers), only when the
// four Month cards' figures are numbers. The money jobs' others (invested,
// moved to Savings, the Investments plan, and the transfers into and out of
// investment accounts) are kept too, or zero, so the bar splits the money
// exactly as the lead does.
function readOutcome(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const keys = ["incomeMinor", "spentMinor", "plannedSpendMinor", "savingsTargetMinor"];
  if (!keys.every((key) => Number.isFinite(value[key]))) {
    return null;
  }
  const optional = ["investedMinor", "savedMovedMinor", "plannedInvestMinor", "movedIntoInvestmentsMinor", "takenFromInvestmentsMinor"];
  return Object.fromEntries([
    ...keys.map((key) => [key, value[key]]),
    ...optional.map((key) => [key, Number.isFinite(value[key]) ? value[key] : 0])
  ]);
}

const PLAN_QUESTION_FIELDS = new Set(["month", "line", "owner"]);
const PLAN_NOTE_REASONS = new Set(["no_plan_to_copy", "same_month", "unknown_line", "nothing_changes", "not_enough", "move_mixed"]);

/**
 * @typedef {{ supported: boolean, source?: "rules" | "ai", draft?: any, question?: any, note?: any }} PlanDraftReading
 */

// The plan-draft route's answer as the page keeps it: a draft whose every
// figure is a number and whose Save list is there, a question with its
// options, or a known note. Anything else is unreadable.
/** @returns {PlanDraftReading | null} */
export function readPlanDraftResponse(body) {
  if (!body || typeof body !== "object" || body.ok !== true || typeof body.supported !== "boolean") {
    return null;
  }
  if (!body.supported) {
    return { supported: false };
  }
  const source = body.source === "ai" ? "ai" : "rules";
  const draft = body.draft;
  if (draft && typeof draft === "object") {
    const totalsOk = ["before", "after"].every((side) => ["plannedIncomeMinor", "plannedSpendMinor", "remainingMinor"].every((key) => Number.isFinite(draft.totals?.[side]?.[key])));
    const changesOk = Array.isArray(draft.changes) && draft.changes.length > 0
      && draft.changes.every((change) => typeof change?.rowId === "string" && typeof change.label === "string" && Number.isFinite(change.beforeMinor) && Number.isFinite(change.afterMinor));
    if (!/^\d{4}-\d{2}$/.test(String(draft.month)) || !totalsOk || !changesOk || !Array.isArray(draft.apply) || !draft.apply.length || !draft.lead || !Number.isFinite(draft.lead.amountMinor)) {
      return null;
    }
    return { supported: true, source, draft };
  }
  const question = body.question;
  if (question && typeof question === "object") {
    return PLAN_QUESTION_FIELDS.has(question.field) && Array.isArray(question.options) && question.options.length ? { supported: true, source, question } : null;
  }
  const note = body.note;
  if (note && typeof note === "object" && PLAN_NOTE_REASONS.has(note.reason)) {
    return { supported: true, source, note };
  }
  return null;
}

export async function requestPlanDraft({ text, viewId, month, answers = {}, signal = undefined, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(ASK_ENDPOINTS.planDraft, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, viewId, month, answers }),
      signal
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 404 ? "unavailable" : "failed" };
    }
    const reading = readPlanDraftResponse(await readJson(response));
    return reading ? { ok: true, reading } : { ok: false, reason: "unreadable" };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    return { ok: false, reason: "network" };
  }
}

/**
 * Save plan and Undo: the draft's changes (or a save's `undo`) through
 * POST /api/month-plan/apply-changes, one batch on the server.
 * @returns {Promise<{ ok: boolean, error?: string, undo?: any[], conflict?: boolean }>}
 */
export async function applyPlanChanges({ month, changes }, { fetchImpl = fetch, fallbackError = "The plan couldn't be saved. Check your connection and try again." } = {}) {
  try {
    const response = await fetchImpl(ASK_ENDPOINTS.planApply, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, changes })
    });
    const data = await readJson(response);
    if (!response.ok || data?.ok !== true) {
      return { ok: false, conflict: response.status === 409, error: typeof data?.error === "string" && response.status === 409 ? data.error : fallbackError };
    }
    return { ok: true, undo: Array.isArray(data.undo) ? data.undo : [] };
  } catch {
    return { ok: false, error: fallbackError };
  }
}

export async function requestMoneyAnswer({ text, viewId, scope, month, keepCandidateIds = [], signal = undefined, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(ASK_ENDPOINTS.answer, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, viewId, scope, month, keepCandidateIds }),
      signal
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 404 ? "unavailable" : "failed" };
    }
    const answer = readMoneyAnswerResponse(await readJson(response));
    return answer ? { ok: true, answer } : { ok: false, reason: "unreadable" };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    return { ok: false, reason: "network" };
  }
}

/**
 * The optional AI explanation on an insight question (POST
 * /api/ai-assist/insight-explain): `{ ok: true, explanation }`, where the
 * explanation is `{ text, source: "ai" }` or null (AI off, out of allowance
 * or its words failed the check). Any failure is `{ ok: false }`: the card
 * already shows the insight's facts.
 * @param {{ kind: string, fact: string, think: string, lines: object[], signal?: AbortSignal, fetchImpl?: typeof fetch }} input
 */
export async function requestInsightExplanation({ kind, fact, think, lines, signal = undefined, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(ASK_ENDPOINTS.insightExplain, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, fact, think, lines }),
      signal
    });
    if (!response.ok) {
      return { ok: false, explanation: null };
    }
    const payload = await readJson(response);
    const explanation = payload?.explanation;
    return {
      ok: true,
      explanation: explanation && typeof explanation.text === "string" && explanation.text && explanation.source === "ai"
        ? { text: explanation.text, source: "ai" }
        : null
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    return { ok: false, explanation: null };
  }
}

// The only routes a skew candidate's suggested actions may call, by action
// (DOMAIN.md "Skew Candidate"). The page never posts to a path it was sent
// that is not one of these.
const SKEW_ACTION_PATHS = Object.freeze({
  link_transfer: "/api/transfers/link",
  reclassify_as_transfer: "/api/entries/update-classification",
  match_settlement_checkpoint: "/api/splits/checkpoints/match",
  record_group_settle_up: "/api/splits/settlements/create"
});
const LINK_SETTLEMENT_PATH = "/api/splits/matches/link-settlement";

/**
 * Mark as settlement / Link as transfer: the candidate's suggested actions,
 * in order, through the existing routes. A group settle-up is linked to its
 * transfer entry once recorded. Stops at the first failure.
 * @returns {Promise<{ ok: boolean, error: string }>}
 */
export async function resolveSkewCandidate(candidate, { fetchImpl = fetch } = {}) {
  const steps = Array.isArray(candidate?.suggestedActions) ? candidate.suggestedActions : [];
  if (!steps.length || steps.some((step) => SKEW_ACTION_PATHS[step?.action] !== step?.path || !step.body || typeof step.body !== "object")) {
    return { ok: false, error: "This can't be sorted from here. Open Splits or Entries to fix it." };
  }
  for (const step of steps) {
    const result = await postJson(step.path, step.body, "That couldn't be done. Try again in a moment.", fetchImpl);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    if (step.action === "record_group_settle_up" && step.linkTransactionId) {
      if (typeof result.settlementId !== "string") {
        return { ok: false, error: "The settle-up was recorded but could not be linked. Open Splits to link it." };
      }
      const linked = await postJson(LINK_SETTLEMENT_PATH, { settlementId: result.settlementId, transactionId: step.linkTransactionId }, "The settle-up was recorded but could not be linked. Open Splits to link it.", fetchImpl);
      if (!linked.ok) {
        return { ok: false, error: linked.error };
      }
    }
  }
  return { ok: true, error: "" };
}
