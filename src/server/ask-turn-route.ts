// POST /api/ask/turn: one Ask message (DOMAIN.md "Ask Turn"; docs/flows/
// ask-flow.md "AI first"). AI understands, the app validates, rules are the
// offline backup.
//
// 1. AI off or not configured: { mode: "rules" } at once, before any data
//    work or allowance use; the page reads the message with its rules.
// 2. The context is loaded (ask-turn-context.ts): people, wallets,
//    categories, groups, plan line names and the entry or card in focus,
//    the entry from the household's own rows by its id.
// 3. One allowance unit asks the provider (Claude Haiku through AI Gateway,
//    logging and caching off; Workers AI as its fallback) for exactly one
//    action in ASK_TURN_SCHEMA. No answer, or an unusable one: { mode:
//    "rules", reason }, and the page reads the message with its rules.
// 4. The action is checked against the household's data
//    (validateAskTurnAction); one that does not check out becomes a
//    question back. A plan change is drafted against the real plan rows.
//
// Nothing is written but the shared allowance counter (and, after a Claude
// attempt, the aggregate Claude status row). Every draft is saved later by
// the person's Save tap, through the existing command. No message, prompt,
// context or answer is stored or logged.
//
// Tests (APP_ENVIRONMENT "test", set only in wrangler.test.jsonc) may send
// the model's answer in the X-Ask-Turn-Test-Reply header: it stands in for
// the provider and goes through the same checks, so a browser test proves
// the whole path without a model.

import { AI_UNUSABLE_SUGGESTION_REASON } from "../domain/ai-assistance";
import { getAiProviderUnavailableReason, runTextJson, type AiProviderEnv } from "../domain/ai-provider";
import {
  ASK_TURN_MAX_HISTORY,
  ASK_TURN_MAX_TEXT,
  ASK_TURN_SCHEMA,
  buildAskTurnPrompt,
  parseAskTurnAction,
  validateAskTurnAction,
  type AskTurnAction,
  type AskTurnMessage
} from "../domain/ask-turn";
import { loadAskTurnContext } from "../domain/ask-turn-context";
import { todayInAppTimeZone } from "../lib/app-calendar";
import { json } from "./json";
import { readJsonObject, SMALL_JSON_MAX_BYTES } from "./limited-body";
import { draftPlanRequest } from "./plan-draft-route";

export const ASK_TURN_AI_UNITS = 1;
// The action JSON is small; Claude's thinking headroom is added by the provider.
const ASK_TURN_MAX_TOKENS = 500;
const ASK_TURN_TIMEOUT_MS = 10_000;
const TEST_REPLY_HEADER = "x-ask-turn-test-reply";
const PAGES = new Set(["ask", "summary", "month", "entries", "splits", "imports", "settings", "faq"]);

export type AskTurnEnv = AiProviderEnv & { DB: D1Database; APP_ENVIRONMENT?: string };

export async function handleAskTurn(request: Request, env: AskTurnEnv): Promise<Response> {
  const body = await readJsonObject<Record<string, unknown>>(request, SMALL_JSON_MAX_BYTES);
  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return json({ ok: false, error: "Missing message text" }, 400);
  }
  if (text.length > ASK_TURN_MAX_TEXT) {
    return json({ ok: false, error: "The message is too long." }, 400);
  }
  const testReply = env.APP_ENVIRONMENT === "test" ? request.headers.get(TEST_REPLY_HEADER) : null;
  const offReason = getAiProviderUnavailableReason(env);
  if (offReason && !testReply) {
    return json({ ok: true, mode: "rules", reason: offReason });
  }

  const today = todayInAppTimeZone();
  const month = typeof body.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) ? body.month : today.slice(0, 7);
  const context = await loadAskTurnContext(env.DB, {
    text,
    history: readHistory(body.history),
    viewId: typeof body.viewId === "string" ? body.viewId : "household",
    scope: typeof body.scope === "string" && ["direct", "shared", "direct_plus_shared"].includes(body.scope) ? body.scope : "direct_plus_shared",
    month,
    page: typeof body.page === "string" && PAGES.has(body.page) ? body.page : "ask",
    focus: body.focus
  }, today);

  let action: AskTurnAction | null;
  let remaining: number | undefined;
  if (testReply) {
    action = parseTestReply(testReply);
  } else {
    const result = await runTextJson(env.DB, env, {
      capability: "ask_turn",
      units: ASK_TURN_AI_UNITS,
      maxTokens: ASK_TURN_MAX_TOKENS,
      timeoutMs: ASK_TURN_TIMEOUT_MS,
      schema: ASK_TURN_SCHEMA,
      prompt: buildAskTurnPrompt(context),
      parse: parseAskTurnAction,
      unusableReason: AI_UNUSABLE_SUGGESTION_REASON
    });
    action = result.value ?? null;
    remaining = result.remaining;
    if (!action) {
      return json({ ok: true, mode: "rules", reason: result.reason ?? "AI is temporarily unavailable.", ...(remaining !== undefined ? { remaining } : {}) });
    }
  }
  if (!action) {
    return json({ ok: true, mode: "rules", reason: AI_UNUSABLE_SUGGESTION_REASON });
  }

  const reply = validateAskTurnAction(action, context);
  const base = { ok: true as const, mode: "ai" as const, action: action.action, ...(remaining !== undefined ? { remaining } : {}) };
  if (reply.kind === "plan") {
    const reading = await draftPlanRequest(env.DB, reply.request, {
      today,
      viewId: context.viewId,
      monthInView: month,
      answers: {},
      people: context.people,
      categoryNames: context.entry.categoryNames
    });
    return json({
      ...base,
      reply: { kind: "plan", text, request: { viewId: context.viewId, month }, reading: { ok: true, supported: true, source: "ai", ...reading } }
    });
  }
  return json({ ...base, reply });
}

// The recent conversation as the page sent it: at most the last few
// messages, each cut short; anything else is dropped.
function readHistory(value: unknown): AskTurnMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is { role: string; text: string } => Boolean(item) && typeof item === "object" && typeof item.text === "string" && (item.role === "user" || item.role === "app"))
    .slice(-ASK_TURN_MAX_HISTORY)
    .map((item) => ({ role: item.role as "user" | "app", text: item.text.replace(/\s+/g, " ").trim().slice(0, ASK_TURN_MAX_TEXT) }))
    .filter((item) => item.text);
}

function parseTestReply(value: string) {
  try {
    return parseAskTurnAction(JSON.parse(value));
  } catch {
    return null;
  }
}
