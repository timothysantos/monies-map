// Claude credit status for the owner (DOMAIN.md "AI Provider Status").
//
// - GET  /api/ai-assist/provider-status
// - POST /api/ai-assist/provider-status/topped-up { creditUsd }
//
// Only a viewer whose Cloudflare Access email is in AI_ALERT_EMAILS gets the
// figures, or everyone when it is "*" (wrangler.jsonc ships "*": the owner
// chose to show the status to the whole household); everyone else gets
// { ok: true, visible: false } from the GET (no database read) and a 403
// from the POST (no write). Without Access in front (local dev, tests) there
// is no viewer email unless the request sends the
// Cf-Access-Authenticated-User-Email header itself.
//
// The app cannot buy credit: the owner tops up in the Claude Console
// (consoleBillingUrl) and then marks it here, which restarts the spend
// estimate against the new amount. Nothing here calls a model.

import { resolveClaudeGateway, type AiProviderEnv } from "../domain/ai-provider";
import {
  buildAiProviderStatus,
  isAiAlertViewer,
  loadAiProviderStatusRow,
  markClaudeToppedUp,
  parseTopUpCreditUsd
} from "../domain/ai-provider-status";
import type { AiProviderStatusResponseDto } from "../types/dto";
import { getAuthenticatedEmail } from "./access-identity";
import { json } from "./json";

type ProviderStatusEnv = AiProviderEnv & { DB: D1Database };

const STATUS_PATH = "/api/ai-assist/provider-status";
const TOPPED_UP_PATH = "/api/ai-assist/provider-status/topped-up";

export async function handleAiProviderStatusRoute(request: Request, url: URL, env: ProviderStatusEnv): Promise<Response | null> {
  if (url.pathname === STATUS_PATH && request.method === "GET") {
    if (!isAiAlertViewer(env, getAuthenticatedEmail(request))) {
      return json({ ok: true, visible: false } satisfies AiProviderStatusResponseDto);
    }
    return json(await loadStatus(env));
  }

  if (url.pathname === TOPPED_UP_PATH && request.method === "POST") {
    if (!isAiAlertViewer(env, getAuthenticatedEmail(request))) {
      return json({ ok: false, error: "Not available." }, 403);
    }
    let body: { creditUsd?: unknown } | null = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const creditUsd = parseTopUpCreditUsd(body?.creditUsd);
    if (creditUsd === null) {
      return json({ ok: false, error: "Enter the credit you bought in US dollars, more than 0 and at most 10,000." }, 400);
    }
    await markClaudeToppedUp(env.DB, creditUsd);
    return json(await loadStatus(env));
  }

  return null;
}

async function loadStatus(env: ProviderStatusEnv): Promise<AiProviderStatusResponseDto> {
  const claudeConfigured = env.AI_ASSIST_ENABLED === "true" && resolveClaudeGateway(env) !== null;
  return buildAiProviderStatus(await loadAiProviderStatusRow(env.DB), env, claudeConfigured);
}
