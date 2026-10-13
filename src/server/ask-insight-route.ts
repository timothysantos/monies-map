// POST /api/ai-assist/insight-explain: the optional AI explanation on an
// insight question (DOMAIN.md "Insight Question"; docs/flows/ask-flow.md
// "Insight questions"). Asked only by the person's "Ask about this" tap.
//
// The Ask card shows the insight's own facts without this route. With AI
// on, one allowance unit asks the provider to explain the line in one to
// three plain sentences from those facts only, through the same prompt and
// check as an Ask answer's wording (buildAnswerPrompt, validateAiWording):
// every amount must be one of the facts', no name the facts do not hold, no
// advice or forecast. Anything else, or AI off, is `explanation: null` and
// the card stays as it is. Nothing is written but the shared allowance
// counter: no question, fact, prompt or answer is stored or logged.

import { getAiProviderUnavailableReason, runTextJson, type AiProviderEnv } from "../domain/ai-provider";
import { buildAnswerPrompt, validateAiWording } from "../domain/ask-answer-wording";
import { buildInsightPromptFacts, insightPromptQuestion, readInsightExplainRequest } from "../domain/ask-insight";
import { loadAccountReferences } from "../domain/app-repository-settings";
import { loadRoutePageContext } from "../domain/route-context";
import type { InsightExplainResponseDto } from "../types/dto";
import { json } from "./json";
import { readJsonBody, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

const INSIGHT_EXPLAIN_AI_UNITS = 1;
const INSIGHT_EXPLAIN_MAX_TOKENS = 220;
const INSIGHT_EXPLAIN_TIMEOUT_MS = 8_000;

const WORDING_SCHEMA = {
  type: "object",
  properties: { text: { type: "string", maxLength: 360 } },
  required: ["text"],
  additionalProperties: false
};

export async function handleInsightExplain(request: Request, env: AiProviderEnv & { DB: D1Database }): Promise<Response> {
  let parsed: unknown = null;
  try {
    parsed = await readJsonBody(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    parsed = null;
  }
  const insight = readInsightExplainRequest(parsed);
  if (!insight) {
    return json({ ok: false, error: "That insight couldn't be read." }, 400);
  }

  const offReason = getAiProviderUnavailableReason(env);
  if (offReason) {
    return json({ ok: true, explanation: null, ai: { requested: false, available: false, reason: offReason } } satisfies InsightExplainResponseDto);
  }

  // Names the explanation may not bring in unless the facts already hold
  // them: the household's categories, wallets and people.
  const [{ household, categories }, accounts] = await Promise.all([loadRoutePageContext(env.DB, "household"), loadAccountReferences(env.DB)]);
  const knownNames = [
    ...categories.map((category) => category.name),
    ...accounts.map((account) => account.name),
    ...household.people.map((person) => person.name)
  ];
  const promptFacts = buildInsightPromptFacts(insight);
  const result = await runTextJson(env.DB, env, {
    capability: "ask_answer",
    units: INSIGHT_EXPLAIN_AI_UNITS,
    maxTokens: INSIGHT_EXPLAIN_MAX_TOKENS,
    timeoutMs: INSIGHT_EXPLAIN_TIMEOUT_MS,
    schema: WORDING_SCHEMA,
    prompt: buildAnswerPrompt(insightPromptQuestion(insight), promptFacts),
    parse: (response) => validateAiWording((response as { text?: unknown } | null)?.text, { promptFacts, knownNames })
  });
  return json({
    ok: true,
    explanation: result.value ? { text: result.value, source: "ai" } : null,
    ai: {
      requested: true,
      available: Boolean(result.value),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.remaining !== undefined ? { remaining: result.remaining } : {})
    }
  } satisfies InsightExplainResponseDto);
}
