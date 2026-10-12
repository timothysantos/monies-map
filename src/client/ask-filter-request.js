// The Ask page's side of the optional AI filter fallback
// (POST /api/ai-assist/filter, src/server/ask-filter-route.ts; DOMAIN.md
// "Ask Filter Proposal"; docs/flows/ask-flow.md "Search and filter").
//
// The page asks only after its rules found nothing (the money-question
// reader, then the filter reader) and only for a request that reads like a
// search or a question. The route has already checked the model's proposal
// against the household's data; this file checks the reading again against
// what this page knows (its people, active wallets, categories and the
// month format), so a value nobody on this device recognises is never
// shown, opened in Entries or kept in the conversation. Anything wrong or
// missing is "no reading" and the page keeps its existing note.

import { ASK_ENDPOINTS } from "./ask-api";
import { isQueryForm } from "./ask-filter-reader";

const MAX_REQUEST_LENGTH = 300;
const MAX_SEARCH_LENGTH = 80;
const MAX_AMOUNT_MINOR = 1_000_000_000;
const SCOPES = new Set(["direct", "shared", "direct_plus_shared"]);
const TYPES = new Set(["", "expense", "income", "transfer"]);
const QUESTION_FIELDS = new Set(["month", "wallet", "category", "person"]);
const FILTER_KEYS = ["month", "viewId", "scope", "search", "categories", "wallets", "type", "minAmountMinor", "maxAmountMinor"];

/**
 * @typedef {{ people?: { id: string, name: string }[], accounts?: { id: string, isActive?: boolean }[], categories?: { name: string }[] }} FilterKnown
 */

// A number that is not a year or a month key: an amount the rules did not
// read as a limit ("over", "under"), so the sentence is more likely a new
// entry than a search and stays with the entry reader.
const BARE_AMOUNT = /(^|[^\d-])\$?\d[\d,]*(?:\.\d+)?k?(?![\d-])/;
const hasBareAmount = (text) => BARE_AMOUNT.test(text.replace(/\b(19|20)\d{2}(-\d{2}){0,2}\b/g, " "));

// Whether a typed request that the rules read nothing from is worth the
// optional AI: a question or a search command with no amount in it, and no
// entry card being filled (a plain sentence is then a change to the card).
export function shouldAskFilterAi(text, { cardOpen }) {
  const trimmed = String(text ?? "").trim();
  return !cardOpen && trimmed.length > 0 && trimmed.length <= MAX_REQUEST_LENGTH && isQueryForm(trimmed) && !hasBareAmount(trimmed);
}

function isMinor(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR);
}

function knownSets(known) {
  return {
    people: new Set((known.people ?? []).map((person) => person.id)),
    wallets: new Set((known.accounts ?? []).filter((account) => account.isActive !== false).map((account) => account.id)),
    categories: new Set((known.categories ?? []).map((category) => category.name))
  };
}

function isKnownList(value, allowed) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.has(item));
}

// A view the page knows: the household (one scope) or one of its people.
function isKnownView(viewId, scope, sets) {
  if (!SCOPES.has(scope)) return false;
  return viewId === "household" ? scope === "direct_plus_shared" : sets.people.has(viewId);
}

function readFilter(value, sets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ok = typeof value.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
    && typeof value.viewId === "string" && isKnownView(value.viewId, value.scope, sets)
    && typeof value.search === "string" && value.search.length <= MAX_SEARCH_LENGTH
    && isKnownList(value.categories, sets.categories)
    && isKnownList(value.wallets, sets.wallets)
    && TYPES.has(value.type)
    && isMinor(value.minAmountMinor) && isMinor(value.maxAmountMinor)
    && !(value.minAmountMinor !== null && value.maxAmountMinor !== null && value.minAmountMinor > value.maxAmountMinor);
  if (!ok) return null;
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, value[key]]));
}

// A chip's patch: only known values, only the keys a follow-up may change.
function readPatch(patch, sets) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;
  const keys = Object.keys(patch);
  const allowed = new Set(["viewId", "scope", "categories", "wallets", "month"]);
  if (!keys.length || keys.some((key) => !allowed.has(key))) return null;
  if ("viewId" in patch && !isKnownView(patch.viewId, patch.scope, sets)) return null;
  if ("scope" in patch && !("viewId" in patch)) return null;
  if ("categories" in patch && !isKnownList(patch.categories, sets.categories)) return null;
  if ("wallets" in patch && !isKnownList(patch.wallets, sets.wallets)) return null;
  if ("month" in patch && !(typeof patch.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(patch.month))) return null;
  return Object.fromEntries(keys.map((key) => [key, Array.isArray(patch[key]) ? [...patch[key]] : patch[key]]));
}

function readQuestion(value, sets) {
  if (!value || typeof value !== "object" || !QUESTION_FIELDS.has(value.field) || !Array.isArray(value.options) || !value.options.length) return null;
  const options = [];
  for (const option of value.options) {
    const patch = readPatch(option?.patch, sets);
    if (!patch || typeof option.key !== "string" || typeof option.label !== "string" || !option.label) return null;
    options.push({ key: option.key, label: option.label, patch });
  }
  return {
    field: value.field,
    ...(value.reason === "unknown" ? { reason: "unknown" } : {}),
    ...(typeof value.word === "string" ? { word: value.word.slice(0, 40) } : {}),
    options
  };
}

/**
 * The route's body as a filter reading the page may render ({ kind:
 * "filter" | "question" | "unknown" }, the same shapes as the rules
 * reader's), or null.
 * @param {any} body
 * @param {FilterKnown} known
 */
export function readAskFilterResponse(body, known) {
  if (!body || typeof body !== "object" || body.ok !== true || body.supported !== true || !body.reading || typeof body.reading !== "object") {
    return null;
  }
  const sets = knownSets(known ?? {});
  const reading = body.reading;
  if (reading.kind === "unknown") {
    return reading.reason === "category" && typeof reading.word === "string" && reading.word
      ? { kind: "unknown", reason: "category", word: reading.word.slice(0, 40) }
      : null;
  }
  const filter = readFilter(reading.filter, sets);
  if (!filter) return null;
  if (reading.kind === "filter") {
    return { kind: "filter", filter };
  }
  if (reading.kind === "question" && Array.isArray(reading.questions) && reading.questions.length) {
    const questions = reading.questions.map((question) => readQuestion(question, sets));
    return questions.every(Boolean) ? { kind: "question", filter, questions } : null;
  }
  return null;
}

/**
 * Asks the route to read a request the rules could not. Resolves
 * { ok: true, reading } (reading is null when the route says it cannot
 * read it: AI off, over its allowance, or not a search) or
 * { ok: false, reason } when the route could not be reached. Never throws
 * except for an abort.
 */
export async function requestAskFilter({ text, viewId, scope, month, context, signal = undefined, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(ASK_ENDPOINTS.filter, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, viewId, scope, month }),
      signal
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 404 ? "unavailable" : "failed" };
    }
    const body = await response.json().catch(() => null);
    return { ok: true, reading: readAskFilterResponse(body, context) };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    return { ok: false, reason: "network" };
  }
}
