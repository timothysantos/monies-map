// POST /api/ai-assist/answer: Ask's answer to a free-form money question
// (DOMAIN.md "Money Question"; docs/flows/ask-flow.md "Money questions").
//
// 1. The question is read by rules (ask-answer-intent.ts); anything else is
//    { supported: false } and the page keeps its "not answered" note.
// 2. Skew candidates are checked first: one that would change the facts
//    comes back as { needsConfirmation, candidates } and nothing is
//    explained yet (pages/ask-answer.ts).
// 3. The facts come from the page DTOs the screens show; the answer card
//    and a computed wording are built from them (ask-answer-wording.ts).
// 4. Only then, and only when AI is on, the optional provider may phrase
//    the wording from the bounded fact list (1 allowance unit). Its text is
//    shown only if it passes validateAiWording; otherwise the computed
//    wording is. Nothing is written except the shared allowance counter
//    (and, after a Claude attempt, the aggregate Claude status row): no
//    question, fact list, prompt or answer is stored or logged.

import { redactAiText } from "../domain/ai-assistance";
import { getAiProviderUnavailableReason, runTextJson, type AiProviderEnv } from "../domain/ai-provider";
import {
  buildAnyAnswerCard,
  buildAnyPromptFacts,
  buildAnyTemplateWording,
  buildAnswerPrompt,
  validateAiWording
} from "../domain/ask-answer-wording";
import type { AskAnswerFacts } from "../domain/ask-answer-facts";
import type { UsualFacts } from "../domain/ask-usual";
import { buildAskAnswer } from "../domain/pages/ask-answer";
import { todayInAppTimeZone } from "../lib/app-calendar";
import type { AskAnswerResponseDto } from "../types/dto";
import { json } from "./json";
import { ASK_MESSAGE_MAX_LENGTH } from "../domain/request-limits";
import { readJsonBody, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export const ASK_ANSWER_MAX_TEXT = ASK_MESSAGE_MAX_LENGTH;
const ASK_ANSWER_AI_UNITS = 1;
const ASK_ANSWER_MAX_TOKENS = 220;
const ASK_ANSWER_TIMEOUT_MS = 8_000;
const MAX_KEEP_IDS = 50;
const MAX_ID_LENGTH = 200;

const WORDING_SCHEMA = {
  type: "object",
  properties: { text: { type: "string", maxLength: 360 } },
  required: ["text"],
  additionalProperties: false
};

export async function handleAskAnswer(request: Request, env: AiProviderEnv & { DB: D1Database }): Promise<Response> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await readJsonBody(request, SMALL_JSON_MAX_BYTES);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    body = null;
  }
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return json({ ok: false, error: "Missing question text" }, 400);
  }
  if (text.length > ASK_ANSWER_MAX_TEXT) {
    return json({ ok: false, error: "The question is too long." }, 400);
  }
  const today = todayInAppTimeZone();
  const keepCandidateIds = Array.isArray(body?.keepCandidateIds)
    ? body.keepCandidateIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH).slice(0, MAX_KEEP_IDS)
    : [];

  const build = await buildAskAnswer(env.DB, {
    text,
    viewId: typeof body?.viewId === "string" ? body.viewId : "household",
    scope: typeof body?.scope === "string" ? body.scope : null,
    month: typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : today.slice(0, 7),
    keepCandidateIds
  }, today);

  if (!build.supported) {
    return json({ ok: true, supported: false } satisfies AskAnswerResponseDto);
  }
  const base = { ok: true as const, supported: true, intent: build.intent, viewId: build.viewId, scope: build.scope, months: build.months };
  if (build.needsConfirmation) {
    return json({ ...base, needsConfirmation: true, candidates: build.candidates } satisfies AskAnswerResponseDto);
  }

  const answer = buildAnyAnswerCard(build.facts, { today });
  const template = buildAnyTemplateWording(build.facts, { today });
  const offReason = getAiProviderUnavailableReason(env);
  if (offReason || !hasData(build.facts)) {
    return json({
      ...base,
      needsConfirmation: false,
      answer,
      wording: { text: template, source: "template" },
      ai: { requested: false, available: false, ...(offReason ? { reason: offReason } : {}) }
    } satisfies AskAnswerResponseDto);
  }

  const promptFacts = buildAnyPromptFacts(build.facts, { today });
  const result = await runTextJson(env.DB, env, {
    capability: "ask_answer",
    units: ASK_ANSWER_AI_UNITS,
    maxTokens: ASK_ANSWER_MAX_TOKENS,
    timeoutMs: ASK_ANSWER_TIMEOUT_MS,
    schema: WORDING_SCHEMA,
    prompt: buildAnswerPrompt(redactAiText(text, 200), promptFacts),
    parse: (response) => validateAiWording((response as { text?: unknown } | null)?.text, { promptFacts, knownNames: build.knownNames })
  });
  return json({
    ...base,
    needsConfirmation: false,
    answer,
    wording: result.value ? { text: result.value, source: "ai" } : { text: template, source: "template" },
    ai: {
      requested: true,
      available: Boolean(result.value),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.remaining !== undefined ? { remaining: result.remaining } : {})
    }
  } satisfies AskAnswerResponseDto);
}

// A month with no entries (or Splits with nothing open) has nothing for AI
// to phrase: the computed wording says so.
function hasData(facts: AskAnswerFacts | UsualFacts) {
  if (facts.kind === "owed") return facts.balances.length > 0 || facts.openSettlements.length > 0;
  if (facts.kind === "usual") return facts.entryCount > 0 || facts.history.some((item) => item.amountMinor !== 0);
  return facts.current.entryCount > 0;
}
