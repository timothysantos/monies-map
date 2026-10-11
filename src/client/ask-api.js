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
// Saving never uses a new route: the card goes through the Entries
// composer's create path (entry-actions.js createEntryFromDraft), and the
// follow-ups through the existing entry and split routes.
//
// Readers fail soft: any network error, non-OK status or unreadable body
// comes back as { ok: false, reason } and the card stays manual.

import { createEntryFromDraft } from "./entry-create-request";

export const ASK_ENDPOINTS = Object.freeze({
  entryDraft: "/api/ai-assist/entry-draft",
  receiptRead: "/api/ai-assist/receipt-read"
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
