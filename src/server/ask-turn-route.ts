// POST /api/ask/turn: one Ask message (DOMAIN.md "Ask Turn"; docs/flows/
// ask-flow.md "AI first"). AI understands, the app validates, rules are the
// offline backup.
//
// 1. AI off or not configured: { mode: "rules" } at once, before any data
//    work or allowance use; the page reads the message with its rules.
//    One exception: a share on the saved entry in focus ("Joyce's share
//    1.6") is read here by the rules' share reader (ask-turn-shares.ts) and
//    checked like the model's, so the offline backup still drafts the split.
// 2. The context is loaded (ask-turn-context.ts): people, wallets,
//    categories, groups, plan line names and the entry or card in focus,
//    the entry from the household's own rows by its id.
// 3. One allowance unit asks the provider (Claude Haiku through AI Gateway,
//    logging and caching off; Workers AI as its fallback) for exactly one
//    action in ASK_TURN_SCHEMA. No answer, or an unusable one: { mode:
//    "rules", reason }, and the page reads the message with its rules.
// 4. The action is checked against the household's data
//    (validateAskTurnAction). One the checks refuse for a reason the model
//    can fix (a name, day, month, share or plan line they could not use) is
//    sent back ONCE with the errors and the valid options (the repair turn,
//    ask-turn-repair.ts; a second allowance unit); only if that is refused
//    too does it become a question back. A plan change is drafted against
//    the real plan rows.
//
// Nothing is written but the shared allowance counter (and, after a Claude
// attempt, the aggregate Claude status row). Every draft is saved later by
// the person's Save tap, through the existing command. No message, prompt,
// context or answer is stored. The only thing logged is the repair measure:
// { action, validatorError, field, repaired }, never the message, a name or
// an amount.
//
// Tests (APP_ENVIRONMENT "test", set only in wrangler.test.jsonc) may send
// the model's answer in the X-Ask-Turn-Test-Reply header: it stands in for
// the provider and goes through the same checks, so a browser test proves
// the whole path without a model. X-Ask-Turn-Test-Repair-Reply stands in for
// the repair turn's answer; without it a test-reply turn is not repaired.

import { ASK_REPAIRABLE_CODES } from "../domain/ask-ambiguity";
import { AI_UNUSABLE_SUGGESTION_REASON } from "../domain/ai-assistance";
import { getAiProviderUnavailableReason, runTextJson, type AiProviderEnv } from "../domain/ai-provider";
import {
  ASK_TURN_MAX_HISTORY,
  ASK_TURN_MAX_TEXT,
  ASK_TURN_SCHEMA,
  buildAskTurnPrompt,
  parseAskTurnAction,
  validateAskTurnAction,
  withAssumptions,
  type AskTurnAction,
  type AskTurnContext,
  type AskTurnMessage,
  type AskTurnReply
} from "../domain/ask-turn";
import { readSharesByRules } from "../domain/ask-turn-shares";
import { loadAskTurnContext } from "../domain/ask-turn-context";
import { buildAskRepairPrompt } from "../domain/ask-turn-repair";
import { resolveAskTurnRequest } from "../domain/ask-turn-resolve";
import { todayInAppTimeZone } from "../lib/app-calendar";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";
import { draftPlanRequest } from "./plan-draft-route";

export const ASK_TURN_AI_UNITS = 1;
// The action JSON is small; Claude's thinking headroom is added by the provider.
const ASK_TURN_MAX_TOKENS = 500;
const ASK_TURN_TIMEOUT_MS = 10_000;
const TEST_REPLY_HEADER = "x-ask-turn-test-reply";
const TEST_REPAIR_HEADER = "x-ask-turn-test-repair-reply";
const PAGES = new Set(["ask", "summary", "month", "entries", "splits", "imports", "settings", "faq"]);

export type AskTurnEnv = AiProviderEnv & { DB: D1Database; APP_ENVIRONMENT?: string };

export async function handleAskTurn(request: Request, env: AskTurnEnv): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject<Record<string, unknown>>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    throw error;
  }
  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return json({ ok: false, error: "Missing message text" }, 400);
  }
  if (text.length > ASK_TURN_MAX_TEXT) {
    return json({ ok: false, error: "The message is too long." }, 400);
  }
  const testing = env.APP_ENVIRONMENT === "test";
  const testReply = testing ? request.headers.get(TEST_REPLY_HEADER) : null;
  const testRepairReply = testing ? request.headers.get(TEST_REPAIR_HEADER) : null;
  const offReason = getAiProviderUnavailableReason(env);
  const focusIsSavedEntry = typeof body.focus === "object" && body.focus !== null && (body.focus as { kind?: unknown }).kind === "saved_entry";
  // A saved entry in focus and a message with a figure, "all" or "split" in
  // it may be a share the rules can read; anything else answers at once.
  if (offReason && !testReply && !(focusIsSavedEntry && /\d|\ball\b|\bsplits?\b/i.test(text))) {
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

  const ask = (prompt: string) => runTextJson(env.DB, env, {
    capability: "ask_turn",
    units: ASK_TURN_AI_UNITS,
    maxTokens: ASK_TURN_MAX_TOKENS,
    timeoutMs: ASK_TURN_TIMEOUT_MS,
    schema: ASK_TURN_SCHEMA,
    prompt,
    parse: parseAskTurnAction,
    unusableReason: AI_UNUSABLE_SUGGESTION_REASON
  });

  let action: AskTurnAction | null;
  let remaining: number | undefined;
  if (offReason && !testReply) {
    return rulesAnswer(context, text, offReason);
  }
  if (testReply) {
    action = parseTestReply(testReply);
  } else {
    const result = await ask(buildAskTurnPrompt(context));
    action = result.value ?? null;
    remaining = result.remaining;
    if (!action) {
      return rulesAnswer(context, text, result.reason ?? "AI is temporarily unavailable.", {
        // The demo's Claude allowance is used up: the page says so plainly.
        ...(result.demoAllowanceUsed ? { notice: "demo_allowance" } : {}),
        ...(remaining !== undefined ? { remaining } : {})
      });
    }
  }
  if (!action) {
    return rulesAnswer(context, text, AI_UNUSABLE_SUGGESTION_REASON);
  }

  let reply = validateAskTurnAction(action, context);

  // Repair before asking: a refusal the model can fix gets one more turn with
  // the errors and the valid options. The corrected action is used only when
  // it checks out (not another question); otherwise the person gets the
  // original question, with its chips. At most one repair per message.
  let repaired: boolean | null = null;
  if (reply.kind === "clarify" && reply.error && ASK_REPAIRABLE_CODES.has(reply.error.code) && action.action !== "ask_clarification" && (!testReply || testRepairReply)) {
    const { error } = reply;
    const refused = action.action;
    let second: AskTurnAction | null;
    if (testReply) {
      second = parseTestReply(testRepairReply ?? "");
    } else {
      const result = await ask(buildAskRepairPrompt(context, action, error));
      second = result.value ?? null;
      remaining = result.remaining ?? remaining;
    }
    const fixed = second ? validateAskTurnAction(second, context) : null;
    repaired = Boolean(second && fixed && fixed.kind !== "clarify");
    if (second && fixed && repaired) {
      action = second;
      reply = fixed;
    }
    console.info(JSON.stringify({ event: "ask_turn_repair", action: refused, validatorError: error.code, field: error.field, repaired }));
  }

  // A Phase 2 change that needs the household's rows (every entry a bulk
  // recategorise would move, a group's balance, the matches) is built from
  // them here, read only.
  if (reply.kind === "resolve") {
    const assumptions = reply.assumptions ?? [];
    reply = withAssumptions(await resolveAskTurnRequest(env.DB, reply.request, context), assumptions);
  }
  reply = forPage(reply);
  const base = {
    ok: true as const,
    mode: "ai" as const,
    action: action.action,
    ...(remaining !== undefined ? { remaining } : {}),
    ...(repaired !== null ? { repaired } : {})
  };
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

// Why a question is asked is for the repair turn only; the page never sees it.
function forPage(reply: AskTurnReply): AskTurnReply {
  if (reply.kind === "clarify" && reply.error) {
    const { error: _error, ...question } = reply;
    return question;
  }
  return reply;
}

// The offline backup's answer: the page reads the message with its rules,
// except a share on the saved entry in focus, which the rules' share reader
// turns into the same action the model would send, checked the same way.
function rulesAnswer(context: AskTurnContext, text: string, reason: string, extra: Record<string, unknown> = {}) {
  const reading = context.focus?.kind === "saved_entry" ? readSharesByRules(text, context.people, context.viewId) : null;
  // A bare "split 50/50" needs the word "split"; a named share stands alone.
  if (reading && (reading.shares.length || /\bsplits?\b/i.test(text))) {
    const action = parseAskTurnAction({ action: "add_entry_to_splits", split: { payer: null, group: null, shares: reading.shares } });
    if (action) {
      return json({ ok: true, mode: "rules", reason, action: action.action, reply: forPage(validateAskTurnAction(action, context)), ...extra });
    }
  }
  return json({ ok: true, mode: "rules", reason, ...extra });
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
