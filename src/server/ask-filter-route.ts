// POST /api/ai-assist/filter: the optional AI reading of an Ask filter
// request the rules could not read (DOMAIN.md "Ask Filter Proposal";
// docs/flows/ask-flow.md "Search and filter").
//
// The Ask page calls it only after its rules reader (the filter reader and
// the money-question reader) found nothing, so nothing here replaces a rule.
// The route reads the money-question rules again and refuses a question they
// answer. Then, only when AI is on, the provider (tier "ask", 1 allowance
// unit) is asked to propose an Entries filter from the redacted request and
// the NAMES of the household's categories, wallets and people. The proposal
// is validated against that reference data (ask-filter-ai.ts): unknown names
// are dropped or turned into chips, wallets and the view come back as ids,
// amounts as minor units. The numbers on the answer card are then read from
// the Entries page by the app. Nothing is written except the shared
// allowance counter (and, after a Claude attempt, the aggregate Claude
// status row): no request, prompt, proposal or answer is stored or logged.
// AI off, out of allowance, failing, slow or malformed is
// { supported: false } and the page keeps its existing note.

import { loadAccountReferences } from "../domain/app-repository-settings";
import { getAiProviderUnavailableReason, runTextJson, type AiProviderEnv } from "../domain/ai-provider";
import { buildAskFilterPrompt, readAskFilterProposal, ASK_FILTER_SCHEMA, type AskFilterAiContext } from "../domain/ask-filter-ai";
import { readAnswerIntent } from "../domain/ask-answer-intent";
import { effectiveScopeForView } from "../domain/person-view-scope";
import { loadRoutePageContext } from "../domain/route-context";
import { todayInAppTimeZone } from "../lib/app-calendar";
import type { AskFilterResponseDto } from "../types/dto";
import { json } from "./json";

export const ASK_FILTER_MAX_TEXT = 300;
const ASK_FILTER_AI_UNITS = 1;
const ASK_FILTER_MAX_TOKENS = 260;
const ASK_FILTER_TIMEOUT_MS = 8_000;
const UNUSABLE_REASON = "AI could not read that as a search.";

export async function handleAskFilter(request: Request, env: AiProviderEnv & { DB: D1Database }): Promise<Response> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return json({ ok: false, error: "Missing request text" }, 400);
  }
  if (text.length > ASK_FILTER_MAX_TEXT) {
    return json({ ok: false, error: "The request is too long." }, 400);
  }

  const today = todayInAppTimeZone();
  const month = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : today.slice(0, 7);
  const { household, categories, viewId } = await loadRoutePageContext(env.DB, typeof body?.viewId === "string" ? body.viewId : "household");
  const accounts = await loadAccountReferences(env.DB);
  const people = household.people.map((person) => ({ id: person.id, name: person.name }));
  const notSupported = (ai: AskFilterResponseDto["ai"]) => json({ ok: true, supported: false, ai } satisfies AskFilterResponseDto);

  // A money question the answer reader reads belongs to the answer route.
  const answerIntent = readAnswerIntent(text, {
    today,
    month,
    people,
    vocabulary: [...categories.map((category) => category.name), ...accounts.map((account) => account.name)]
  });
  if (answerIntent) {
    return notSupported({ requested: false, available: false });
  }
  const offReason = getAiProviderUnavailableReason(env);
  if (offReason) {
    return notSupported({ requested: false, available: false, reason: offReason });
  }

  const context: AskFilterAiContext = {
    today,
    month,
    viewId,
    scope: effectiveScopeForView(viewId, typeof body?.scope === "string" ? body.scope : null),
    people,
    accounts: accounts.map((account) => ({ id: account.id, name: account.name, isActive: account.isActive })),
    categories: categories.map((category) => ({ name: category.name }))
  };
  const result = await runTextJson(env.DB, env, {
    capability: "ask_filter",
    units: ASK_FILTER_AI_UNITS,
    maxTokens: ASK_FILTER_MAX_TOKENS,
    timeoutMs: ASK_FILTER_TIMEOUT_MS,
    schema: ASK_FILTER_SCHEMA,
    unusableReason: UNUSABLE_REASON,
    prompt: buildAskFilterPrompt(text, context),
    parse: (response) => readAskFilterProposal(response, context)
  });
  const ai = {
    requested: true,
    available: Boolean(result.value),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.remaining !== undefined ? { remaining: result.remaining } : {})
  };
  return json(result.value
    ? { ok: true, supported: true, reading: result.value, ai } satisfies AskFilterResponseDto
    : { ok: true, supported: false, ai } satisfies AskFilterResponseDto);
}
