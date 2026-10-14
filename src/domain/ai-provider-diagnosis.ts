// Safe diagnosis of a Claude gateway rejection (401/403/404/400): which
// layer refused (Cloudflare's gateway or Anthropic) and a short sanitised
// message. It never reads or logs request headers, the gateway token or the
// API key, and it scrubs anything key-shaped from the response text.

import type { AiProviderEnv } from "./ai-provider";
import { buildClaudeRequestBody, resolveClaudeGateway } from "./ai-provider";
import { reserveDailyAiBudget } from "./ai-assistance";

export type ClaudeRejectionSource = "gateway" | "anthropic" | "unknown";

export interface ClaudeRejectionDiagnosis {
  source: ClaudeRejectionSource;
  message: string;
}

export const DIAGNOSIS_MESSAGE_MAX_CHARS = 300;
const REDACTED = "[redacted]";

// Removes secrets: configured values verbatim, sk-... keys, Bearer
// credentials and long hex/base64/token runs.
export function sanitiseDiagnosticText(text: string, secrets: Array<string | undefined> = []): string {
  let out = text;
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value && value.length >= 4) {
      out = out.split(value).join(REDACTED);
    }
  }
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, REDACTED)
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, REDACTED);
  return out.replace(/\s+/g, " ").trim().slice(0, DIAGNOSIS_MESSAGE_MAX_CHARS);
}

const ANTHROPIC_ERROR_TYPES = /(authentication|permission|invalid_request|not_found|billing|rate_limit|overloaded|api)_error/;
const ANTHROPIC_TEXT = /x-api-key|credit balance|anthropic/i;
const GATEWAY_TEXT = /unauthori[sz]ed|authentication|cf-aig-authorization|gateway|authorization/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function diagnoseClaudeRejection(
  body: string | null | undefined,
  secrets: Array<string | undefined> = []
): ClaudeRejectionDiagnosis {
  const text = (body ?? "").trim();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  let source: ClaudeRejectionSource = "unknown";
  let message = text;

  if (isRecord(parsed)) {
    const error = parsed.error;
    if (parsed.type === "error" || (isRecord(error) && typeof error.type === "string" && ANTHROPIC_ERROR_TYPES.test(error.type))) {
      source = "anthropic";
      const inner = isRecord(error) ? error : {};
      message = [inner.type, inner.message].filter((part) => typeof part === "string").join(": ") || text;
    } else if (Array.isArray(error) || parsed.success === false) {
      source = "gateway";
      const first = Array.isArray(error) && isRecord(error[0]) ? error[0] : {};
      message = [first.code, first.message].filter((part) => typeof part === "string" || typeof part === "number").join(": ") || text;
    } else if (isRecord(error) && typeof error.message === "string") {
      message = error.message;
      source = ANTHROPIC_TEXT.test(message) ? "anthropic" : GATEWAY_TEXT.test(message) ? "gateway" : "unknown";
    } else if (typeof error === "string") {
      message = error;
    }
  }
  if (source === "unknown") {
    source = ANTHROPIC_TEXT.test(message) ? "anthropic" : GATEWAY_TEXT.test(message) ? "gateway" : "unknown";
  }
  return { source, message: sanitiseDiagnosticText(message, secrets) };
}

function secretsOf(env: AiProviderEnv) {
  return [env.AI_GATEWAY_TOKEN, env.ANTHROPIC_API_KEY];
}

export function diagnoseClaudeRejectionForEnv(body: string | null | undefined, env: AiProviderEnv) {
  return diagnoseClaudeRejection(body, secretsOf(env));
}

export interface ProviderDiagnosticResult {
  ok: boolean;
  status: number | null;
  source: ClaudeRejectionSource | "none";
  message: string;
  model: string | null;
  path: string | null;
  alias: string | null;
  gatewayIdPresent: boolean;
  tokenPresent: boolean;
}

// One minimal Claude call (max_tokens 1) through the gateway, costing one
// allowance unit. Read-only: nothing is stored.
export async function runClaudeProviderDiagnostic(db: D1Database, env: AiProviderEnv): Promise<ProviderDiagnosticResult> {
  const gateway = resolveClaudeGateway(env);
  const base = {
    model: gateway?.model ?? null,
    path: gateway ? new URL(gateway.url).pathname.replace(/^\/v1\/[^/]+\/[^/]+/, "/v1/<account>/<gateway>") : null,
    alias: env.AI_GATEWAY_BYOK_ALIAS?.trim() || null,
    gatewayIdPresent: Boolean(env.AI_GATEWAY_ID?.trim() || env.AI_GATEWAY_URL?.trim()),
    tokenPresent: Boolean(env.AI_GATEWAY_TOKEN?.trim())
  };
  if (env.AI_ASSIST_ENABLED !== "true" || !gateway) {
    return { ok: false, status: null, source: "none", message: "Claude is not configured here.", ...base };
  }
  try {
    const budget = await reserveDailyAiBudget(db, env, 1);
    if (!budget.available) {
      return { ok: false, status: null, source: "none", message: "Today's AI allowance is used up.", ...base };
    }
  } catch {
    return { ok: false, status: null, source: "none", message: "AI allowance could not be read.", ...base };
  }
  try {
    const response = await fetch(gateway.url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "cf-aig-collect-log": "false",
        "cf-aig-skip-cache": "true",
        ...gateway.headers
      },
      // The real request shape (system, effort, JSON schema) with a trivial
      // prompt, so a rejected parameter or model shows up here too.
      body: JSON.stringify(buildClaudeRequestBody(gateway, {
        maxTokens: 16,
        prompt: "Return the JSON object with ok true.",
        schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } }
      }, []))
    });
    if (response.ok) {
      return { ok: true, status: response.status, source: "none", message: "Claude answered.", ...base };
    }
    let body: string | null = null;
    try {
      body = (await response.text()).slice(0, 4096);
    } catch {
      body = null;
    }
    const diagnosis = diagnoseClaudeRejectionForEnv(body, env);
    return { ok: false, status: response.status, ...diagnosis, ...base };
  } catch {
    return { ok: false, status: null, source: "none", message: "The gateway could not be reached.", ...base };
  }
}
