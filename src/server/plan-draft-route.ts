// POST /api/ai-assist/plan-draft: Ask's plan draft (DOMAIN.md "Plan
// Draft"; docs/flows/ask-flow.md "Planning by chat").
//
// 1. The request is read by rules (plan-draft-reader.ts). Not a plan
//    request at all: { supported: false }, and the page reads it as before.
// 2. Only when it looks like a plan request the rules cannot read, and AI
//    is on, one allowance unit asks the provider (runTextJson) to read the
//    redacted request into the same structure. Its reading is kept only
//    when every name is words of the request, every amount a number in it
//    and every month one it names (parsePlanAiReading); otherwise, or with
//    AI off, { supported: false }.
// 3. The structure is resolved against the month's month plan rows
//    (buildPlanDraft): a draft with before and after, a question (which
//    month, which line, whose new line) or a note. Every figure is the
//    app's own.
// Nothing is written but the shared AI allowance counter: the draft is
// saved later, by the person's Save, through /api/month-plan/apply-changes.
// No request text, reading or draft is stored or logged.

import { redactAiText } from "../domain/ai-assistance";
import { runTextJson, type AiProviderEnv } from "../domain/ai-provider";
import { loadMonthPlanRowsForDraft } from "../domain/app-repository-months";
import { loadAccountReferences } from "../domain/app-repository-settings";
import { buildPlanDraft, planDraftMonths, type PlanRowInput } from "../domain/plan-draft";
import {
  buildPlanAiPrompt,
  parsePlanAiReading,
  PLAN_AI_SCHEMA,
  PLAN_REQUEST_MAX_TEXT,
  readPlanRequest,
  type PlanRequest
} from "../domain/plan-draft-reader";
import { loadRoutePageContext } from "../domain/route-context";
import { todayInAppTimeZone } from "../lib/app-calendar";
import type { PlanDraftAnswersDto, PlanDraftResponseDto } from "../types/dto";
import { json } from "./json";

const PLAN_AI_UNITS = 1;
const PLAN_AI_MAX_TOKENS = 260;
const PLAN_AI_TIMEOUT_MS = 8_000;
const MAX_ANSWER_LINES = 6;

export async function handlePlanDraft(request: Request, env: AiProviderEnv & { DB: D1Database }): Promise<Response> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return json({ ok: false, error: "Missing plan request text" }, 400);
  }
  if (text.length > PLAN_REQUEST_MAX_TEXT) {
    return json({ ok: false, error: "The request is too long." }, 400);
  }
  const today = todayInAppTimeZone();
  const { household, categories, viewId } = await loadRoutePageContext(env.DB, typeof body?.viewId === "string" ? body.viewId : "household");
  const accounts = await loadAccountReferences(env.DB);
  const monthInView = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : today.slice(0, 7);
  const answers = readAnswers(body?.answers);

  const reading = readPlanRequest(text, { today, walletNames: accounts.map((account) => account.name) });
  if (reading.kind === "none") {
    return json({ ok: true, supported: false } satisfies PlanDraftResponseDto);
  }
  let planRequest: PlanRequest;
  let source: "rules" | "ai" = "rules";
  let ai: PlanDraftResponseDto["ai"] = { requested: false, available: false };
  if (reading.kind === "request") {
    planRequest = reading.request;
  } else {
    const result = await runTextJson(env.DB, env, {
      capability: "plan_draft",
      units: PLAN_AI_UNITS,
      maxTokens: PLAN_AI_MAX_TOKENS,
      timeoutMs: PLAN_AI_TIMEOUT_MS,
      schema: PLAN_AI_SCHEMA,
      prompt: buildPlanAiPrompt(redactAiText(text, PLAN_REQUEST_MAX_TEXT), today),
      parse: (response) => parsePlanAiReading(response, text, today)
    });
    ai = {
      requested: true,
      available: Boolean(result.value),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.remaining !== undefined ? { remaining: result.remaining } : {})
    };
    if (!result.value) {
      return json({ ok: true, supported: false, ai } satisfies PlanDraftResponseDto);
    }
    planRequest = result.value;
    source = "ai";
  }

  const months = planDraftMonths(planRequest, { today, answers }) ?? [];
  const rowsByMonth: Record<string, PlanRowInput[]> = Object.fromEntries(
    await Promise.all(months.map(async (month) => [month, await loadMonthPlanRowsForDraft(env.DB, month)] as const))
  );
  const build = buildPlanDraft(planRequest, {
    today,
    viewId,
    monthInView,
    people: household.people.map((person) => ({ id: person.id, name: person.name })),
    categoryNames: categories.map((category) => category.name),
    rowsByMonth,
    answers
  });
  const base = { ok: true as const, supported: true, source, ai };
  if (build.kind === "draft") return json({ ...base, draft: build.draft } satisfies PlanDraftResponseDto);
  if (build.kind === "question") return json({ ...base, question: build.question } satisfies PlanDraftResponseDto);
  return json({ ...base, note: build.note } satisfies PlanDraftResponseDto);
}

// The answers the page sends back with the same text: only well-formed
// values; anything else is ignored (the question is asked again).
function readAnswers(value: unknown): PlanDraftAnswersDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const answers: PlanDraftAnswersDto = {};
  if (typeof raw.month === "string" && /^\d{4}-\d{2}$/.test(raw.month)) {
    answers.month = raw.month;
  }
  if (typeof raw.owner === "string" && raw.owner.length <= 200) {
    answers.owner = raw.owner;
  }
  if (raw.lines && typeof raw.lines === "object" && !Array.isArray(raw.lines)) {
    const lines = Object.entries(raw.lines as Record<string, unknown>)
      .filter(([name, rowId]) => name.length <= 60 && typeof rowId === "string" && rowId.length <= 200)
      .slice(0, MAX_ANSWER_LINES);
    if (lines.length) {
      answers.lines = Object.fromEntries(lines) as Record<string, string>;
    }
  }
  return answers;
}
