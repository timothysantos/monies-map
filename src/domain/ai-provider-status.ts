// AI provider status (DOMAIN.md "AI Provider Status"). The app cannot buy
// Claude credits, so it keeps one aggregate row about the optional Claude
// provider and tells the owner when credits are running low or used up, with
// a link to the Claude Console billing page:
//
// - the last Claude failure's category and time (credit_exhausted for
//   Anthropic's "credit balance is too low" 400 or a 402 billing error,
//   spend_capped for AI Gateway's own 429 spend-limit answer, auth for 401
//   or 403, other for anything else), cleared by a later success
// - the last Claude success time
// - an estimated spend since the owner last marked a top-up, from each
//   success's `usage` tokens times configurable per-million-token prices
// - the top-up mark's time and credit amount
// - this calendar month (Asia/Singapore) and the estimated Claude spend
//   within it, which restarts at zero in a new month and drives auto-balance
//   (see "Auto-balance" below)
//
// Nothing else is stored: no prompt, image, response, error text or
// request id. Like the allowance counter it is a cost-control aggregate, not
// household data, so every write is a single upsert statement and a failed
// write is swallowed by the provider (it can never break an AI answer).

import { isoDateInAppTimeZone } from "../lib/app-calendar";
import type { AiAssistCapability } from "./ai-assistance";
import type { AiProviderStatusResponseDto, ClaudeFailureCategory, ClaudeCreditState, ClaudeSpendMode } from "../types/dto";

export const CLAUDE_CONSOLE_BILLING_URL = "https://platform.claude.com/settings/billing";

export interface AiProviderStatusEnv {
  // Comma-separated Cloudflare Access login emails that may see the status
  // and mark a top-up (case-insensitive). Empty: nobody.
  AI_ALERT_EMAILS?: string;
  // US$ per million tokens; check against Anthropic's pricing page for the
  // configured model (defaults are Claude Haiku 5.5's short-prompt prices).
  AI_CLAUDE_PRICE_IN_PER_MTOK?: string;
  AI_CLAUDE_PRICE_OUT_PER_MTOK?: string;
  // Credit bought before the first top-up mark (US$, default 20), and the
  // estimated spend at which the owner is warned (US$, default 15).
  AI_CLAUDE_CREDIT_USD?: string;
  AI_CLAUDE_WARN_AT_USD?: string;
  // Monthly Claude budget target for auto-balance (US$, default 8).
  AI_CLAUDE_MONTHLY_TARGET_USD?: string;
}

export interface AiProviderStatusRow {
  last_failure_category: string | null;
  last_failure_at: string | null;
  last_success_at: string | null;
  estimated_spend_micro_usd: number;
  topped_up_at: string | null;
  topped_up_credit_micro_usd: number | null;
  // YYYY-MM of the month `month_spend_micro_usd` counts, or null before the
  // first Claude success that recorded one.
  spend_month?: string | null;
  month_spend_micro_usd?: number | null;
}

const PROVIDER_KEY = "claude";
const DEFAULT_PRICE_IN_PER_MTOK = 0.1;
const DEFAULT_PRICE_OUT_PER_MTOK = 0.5;
const DEFAULT_CREDIT_USD = 20;
const DEFAULT_WARN_AT_USD = 15;
const DEFAULT_MONTHLY_TARGET_USD = 8;
// At this share of the monthly target, every feature goes basic-model-first.
const BASIC_FIRST_SHARE = 0.9;
const MAX_PRICE_PER_MTOK = 1_000;
// One request never reports more than this many tokens of a kind; anything
// larger is a malformed usage block, not real spend.
const MAX_TOKENS_PER_KIND = 10_000_000;
export const MAX_TOP_UP_USD = 10_000;
// Keeps the running estimate far from SQLite's integer limit.
const MAX_SPEND_MICRO_USD = 1_000_000_000_000;
const STICKY_FAILURES = ["credit_exhausted", "spend_capped", "auth"] as const;

export function categorizeClaudeFailure(status: number, body: string | null | undefined): ClaudeFailureCategory {
  const error = readAnthropicError(body);
  if (status === 402 || error?.type === "billing_error") {
    return "credit_exhausted";
  }
  if (status === 400 && error && /credit balance/i.test(error.message)) {
    return "credit_exhausted";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 429) {
    // Anthropic's own rate limit is transient; any other 429 on the gateway
    // route is the gateway's spend limit (no gateway rate limit is set up).
    return error?.type === "rate_limit_error" ? "other" : "spend_capped";
  }
  return "other";
}

export function estimateClaudeCostMicroUsd(usage: unknown, env: AiProviderStatusEnv) {
  if (!usage || typeof usage !== "object") {
    return 0;
  }
  const tokens = usage as Record<string, unknown>;
  const input = readTokens(tokens.input_tokens) + readTokens(tokens.cache_creation_input_tokens) + readTokens(tokens.cache_read_input_tokens);
  const output = readTokens(tokens.output_tokens);
  // US$ per million tokens times tokens is micro-USD.
  return Math.round(
    Math.min(input, MAX_TOKENS_PER_KIND) * readPrice(env.AI_CLAUDE_PRICE_IN_PER_MTOK, DEFAULT_PRICE_IN_PER_MTOK)
    + output * readPrice(env.AI_CLAUDE_PRICE_OUT_PER_MTOK, DEFAULT_PRICE_OUT_PER_MTOK)
  );
}

// A success adds its cost and clears a failure that finished before it;
// a failure that finished later (a concurrent request) is kept.
export async function recordClaudeSuccess(db: D1Database, costMicroUsd: number, at = new Date().toISOString()) {
  const cost = Math.max(0, Math.min(MAX_SPEND_MICRO_USD, Math.round(Number(costMicroUsd) || 0)));
  const month = monthKeyInAppTimeZone(new Date(at));
  await db.prepare(`
    INSERT INTO ai_provider_status (provider, last_success_at, estimated_spend_micro_usd, spend_month, month_spend_micro_usd)
    VALUES ('${PROVIDER_KEY}', ?1, ?2, ?3, ?2)
    ON CONFLICT(provider) DO UPDATE SET
      last_success_at = MAX(COALESCE(ai_provider_status.last_success_at, ''), excluded.last_success_at),
      last_failure_category = CASE
        WHEN ai_provider_status.last_failure_at IS NULL OR ai_provider_status.last_failure_at <= excluded.last_success_at THEN NULL
        ELSE ai_provider_status.last_failure_category END,
      last_failure_at = CASE
        WHEN ai_provider_status.last_failure_at IS NULL OR ai_provider_status.last_failure_at <= excluded.last_success_at THEN NULL
        ELSE ai_provider_status.last_failure_at END,
      estimated_spend_micro_usd = MIN(ai_provider_status.estimated_spend_micro_usd + excluded.estimated_spend_micro_usd, ${MAX_SPEND_MICRO_USD}),
      month_spend_micro_usd = CASE
        WHEN ai_provider_status.spend_month = excluded.spend_month
          THEN MIN(COALESCE(ai_provider_status.month_spend_micro_usd, 0) + excluded.month_spend_micro_usd, ${MAX_SPEND_MICRO_USD})
        ELSE excluded.month_spend_micro_usd END,
      spend_month = excluded.spend_month
  `).bind(at, cost, month).run();
}

// A failure older than the last success changes nothing, and a transient
// ("other") failure never replaces a credit, spend-cap or key failure that
// no success has cleared yet.
export async function recordClaudeFailure(db: D1Database, category: ClaudeFailureCategory, at = new Date().toISOString()) {
  await db.prepare(`
    INSERT INTO ai_provider_status (provider, last_failure_category, last_failure_at)
    VALUES ('${PROVIDER_KEY}', ?1, ?2)
    ON CONFLICT(provider) DO UPDATE SET
      last_failure_category = excluded.last_failure_category,
      last_failure_at = excluded.last_failure_at
    WHERE (ai_provider_status.last_success_at IS NULL OR excluded.last_failure_at >= ai_provider_status.last_success_at)
      AND NOT (excluded.last_failure_category = 'other'
        AND COALESCE(ai_provider_status.last_failure_category, '') IN (${STICKY_FAILURES.map((value) => `'${value}'`).join(", ")}))
  `).bind(category, at).run();
}

// The owner bought credit: the estimate restarts at zero against the new
// amount, and a "credit used up" failure is cleared. A gateway spend cap is
// a separate setting, so it stays until a Claude call succeeds.
export async function markClaudeToppedUp(db: D1Database, creditUsd: number, at = new Date().toISOString()) {
  await db.prepare(`
    INSERT INTO ai_provider_status (provider, estimated_spend_micro_usd, topped_up_at, topped_up_credit_micro_usd)
    VALUES ('${PROVIDER_KEY}', 0, ?1, ?2)
    ON CONFLICT(provider) DO UPDATE SET
      estimated_spend_micro_usd = 0,
      topped_up_at = excluded.topped_up_at,
      topped_up_credit_micro_usd = excluded.topped_up_credit_micro_usd,
      last_failure_category = CASE WHEN ai_provider_status.last_failure_category = 'credit_exhausted' THEN NULL ELSE ai_provider_status.last_failure_category END,
      last_failure_at = CASE WHEN ai_provider_status.last_failure_category = 'credit_exhausted' THEN NULL ELSE ai_provider_status.last_failure_at END
  `).bind(at, Math.round(creditUsd * 1_000_000)).run();
}

export async function loadAiProviderStatusRow(db: D1Database) {
  return db.prepare(`
    SELECT last_failure_category, last_failure_at, last_success_at, estimated_spend_micro_usd, topped_up_at, topped_up_credit_micro_usd,
      spend_month, month_spend_micro_usd
    FROM ai_provider_status WHERE provider = ?
  `).bind(PROVIDER_KEY).first<AiProviderStatusRow>();
}

// Who sees the Claude credit status and may mark a top-up. AI_ALERT_EMAILS
// is a comma-separated list of Cloudflare Access emails (case does not
// matter), or "*" for everyone (the owner's choice in wrangler.jsonc): with
// "*" every viewer qualifies, signed in or not, since Access already guards
// the whole app in production. An empty value shows it to nobody.
export function isAiAlertViewer(env: Pick<AiProviderStatusEnv, "AI_ALERT_EMAILS">, email: string | null | undefined) {
  const entries = (env.AI_ALERT_EMAILS ?? "").split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.includes("*")) {
    return true;
  }
  const viewer = email?.trim().toLowerCase();
  if (!viewer) {
    return false;
  }
  return entries.some((entry) => entry !== "" && entry === viewer);
}

// The amount the owner says they bought: a real positive number of US$ up
// to MAX_TOP_UP_USD. Strings are refused rather than coerced.
export function parseTopUpCreditUsd(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_TOP_UP_USD ? value : null;
}

export function deriveClaudeCreditState(
  row: AiProviderStatusRow | null,
  { claudeConfigured, warnAtMicroUsd }: { claudeConfigured: boolean; warnAtMicroUsd: number }
): ClaudeCreditState {
  if (!claudeConfigured || !row) {
    return "unknown";
  }
  if (row.last_failure_category === "credit_exhausted") {
    return "exhausted";
  }
  if (row.last_failure_category === "spend_capped") {
    return "capped";
  }
  if (Number(row.estimated_spend_micro_usd) >= warnAtMicroUsd) {
    return "low";
  }
  if (!row.last_success_at || row.last_failure_category === "auth") {
    return "unknown";
  }
  return "ok";
}

export function buildAiProviderStatus(
  row: AiProviderStatusRow | null,
  env: AiProviderStatusEnv,
  // From resolveClaudeGateway (and AI_ASSIST_ENABLED), passed in so this
  // module does not import the provider that records into it.
  claudeConfigured: boolean,
  now = new Date()
): Extract<AiProviderStatusResponseDto, { visible: true }> {
  const creditMicroUsd = row?.topped_up_credit_micro_usd && row.topped_up_credit_micro_usd > 0
    ? row.topped_up_credit_micro_usd
    : Math.round(readAmount(env.AI_CLAUDE_CREDIT_USD, DEFAULT_CREDIT_USD, 0.01) * 1_000_000);
  const warnAtMicroUsd = Math.min(creditMicroUsd, Math.round(readAmount(env.AI_CLAUDE_WARN_AT_USD, DEFAULT_WARN_AT_USD, 0) * 1_000_000));
  const lastFailureReason = isFailureCategory(row?.last_failure_category) ? row.last_failure_category : undefined;
  const pacing = computeClaudePacing(row, env, now);
  return {
    ok: true,
    visible: true,
    claudeConfigured,
    state: deriveClaudeCreditState(row, { claudeConfigured, warnAtMicroUsd }),
    estimatedSpendUsd: toUsd(row?.estimated_spend_micro_usd ?? 0),
    creditUsd: toUsd(creditMicroUsd),
    warnAtUsd: toUsd(warnAtMicroUsd),
    monthSpendUsd: toUsd(pacing.monthSpendMicroUsd),
    monthTargetUsd: toUsd(pacing.monthTargetMicroUsd),
    mode: pacing.mode,
    ...(row?.last_failure_at && lastFailureReason ? { lastFailureAt: row.last_failure_at, lastFailureReason } : {}),
    ...(row?.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
    consoleBillingUrl: CLAUDE_CONSOLE_BILLING_URL
  };
}

// ---------------------------------------------------------------- auto-balance
//
// A deterministic spending pace, no AI. The month's estimated Claude spend is
// compared with a pace line (target x day / days in the month, Asia/Singapore)
// and with the target itself:
//
// - claude_all:  at or under the pace line; every feature asks Claude first
// - ask_only:    over the pace line; "background" features ask the basic
//                model (Workers AI) first, "ask" features still ask Claude first
// - basic_first: at 90% of the target or more; every feature asks the basic
//                model first
//
// Claude stays the fallback in every mode (and the basic model stays the
// fallback when Claude goes first), so a mode only changes the order.

export type ClaudeMode = ClaudeSpendMode;

// "ask" features answer a person who is waiting: a receipt, a typed entry
// sentence, the wording of an Ask answer, a plan request read into a draft.
// Everything else is background help.
const ASK_TIER_CAPABILITIES: ReadonlySet<AiAssistCapability> = new Set(["receipt_read", "entry_draft", "ask_answer", "plan_draft"]);

export function isAskTierCapability(capability: AiAssistCapability) {
  return ASK_TIER_CAPABILITIES.has(capability);
}

export function monthKeyInAppTimeZone(instant: Date) {
  return isoDateInAppTimeZone(instant).slice(0, 7);
}

export interface ClaudePacing {
  monthSpendMicroUsd: number;
  monthTargetMicroUsd: number;
  paceMicroUsd: number;
  mode: ClaudeMode;
}

export function computeClaudePacing(
  row: Pick<AiProviderStatusRow, "spend_month" | "month_spend_micro_usd"> | null | undefined,
  env: Pick<AiProviderStatusEnv, "AI_CLAUDE_MONTHLY_TARGET_USD">,
  now = new Date()
): ClaudePacing {
  const today = isoDateInAppTimeZone(now);
  const [year, month, day] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthTargetMicroUsd = Math.round(readAmount(env.AI_CLAUDE_MONTHLY_TARGET_USD, DEFAULT_MONTHLY_TARGET_USD, 0.01) * 1_000_000);
  // Spend recorded in an earlier month does not count: a new month starts at 0.
  const monthSpendMicroUsd = row?.spend_month === today.slice(0, 7) ? Math.max(0, Number(row.month_spend_micro_usd) || 0) : 0;
  const paceMicroUsd = Math.round(monthTargetMicroUsd * day / daysInMonth);
  const mode: ClaudeMode = monthSpendMicroUsd >= monthTargetMicroUsd * BASIC_FIRST_SHARE
    ? "basic_first"
    : monthSpendMicroUsd > paceMicroUsd ? "ask_only" : "claude_all";
  return { monthSpendMicroUsd, monthTargetMicroUsd, paceMicroUsd, mode };
}

export function claudeGoesFirst(mode: ClaudeMode, capability: AiAssistCapability) {
  return mode === "claude_all" || (mode === "ask_only" && isAskTierCapability(capability));
}

function isFailureCategory(value: unknown): value is ClaudeFailureCategory {
  return value === "credit_exhausted" || value === "spend_capped" || value === "auth" || value === "other";
}

function readAnthropicError(body: string | null | undefined) {
  if (!body) {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as { type?: unknown; error?: { type?: unknown; message?: unknown } };
    if (parsed?.type === "error" && parsed.error && typeof parsed.error.type === "string") {
      return { type: parsed.error.type, message: typeof parsed.error.message === "string" ? parsed.error.message : "" };
    }
  } catch {
    // Not JSON: a gateway or proxy answer.
  }
  return null;
}

function readTokens(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), MAX_TOKENS_PER_KIND) : 0;
}

function readPrice(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_PRICE_PER_MTOK ? parsed : fallback;
}

function readAmount(value: string | undefined, fallback: number, minimum: number) {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) && parsed >= minimum && parsed <= MAX_TOP_UP_USD ? parsed : fallback;
}

// Four decimals: a single receipt read costs well under a cent.
function toUsd(microUsd: number) {
  return Math.round(Number(microUsd) / 100) / 10_000;
}
