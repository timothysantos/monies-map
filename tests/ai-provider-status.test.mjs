// Claude credit status (DOMAIN.md "AI Provider Status"): the app cannot buy
// Claude credits, so it keeps one aggregate row about the last Claude
// attempts and an estimated spend since the owner's last top-up, and tells
// only the owner (AI_ALERT_EMAILS) when credits run low or out, with a link
// to the Claude Console billing page. These pin error categorization, the
// spend estimate, the state thresholds, owner gating, the top-up mark and
// its validation against a real local D1, and that the row holds nothing
// but aggregate figures.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import {
  CLAUDE_CONSOLE_BILLING_URL,
  buildAiProviderStatus,
  categorizeClaudeFailure,
  deriveClaudeCreditState,
  estimateClaudeCostMicroUsd,
  isAiAlertViewer,
  markClaudeToppedUp,
  parseTopUpCreditUsd,
  claudeGoesFirst,
  computeClaudePacing,
  monthKeyInAppTimeZone,
  recordClaudeFailure,
  recordClaudeSuccess
} from "../src/domain/ai-provider-status.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

const CREDIT_TOO_LOW = JSON.stringify({
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
  },
  request_id: "req_011CTestCreditLow"
});
const ANTHROPIC_RATE_LIMIT = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit." } });
const ANTHROPIC_BILLING = JSON.stringify({ type: "error", error: { type: "billing_error", message: "There is a problem with your billing." } });
const ANTHROPIC_AUTH = JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
const ANTHROPIC_BAD_REQUEST = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: Field required" } });
// AI Gateway answers its own 429 for a spend limit; its body is not an
// Anthropic error object.
const GATEWAY_SPEND_LIMIT = JSON.stringify({ success: false, result: [], messages: [], error: [{ code: 2003, message: "Spend limit exceeded" }] });

const CLAUDE_ENV = {
  AI_ASSIST_ENABLED: "true",
  AI_GATEWAY_ACCOUNT_ID: "acct123",
  AI_GATEWAY_ID: "monies-map",
  AI_GATEWAY_TOKEN: "cf-gateway-token"
};
const OWNER = "Owner@Example.com";

// ------------------------------------------------------------ categorizing

test("Anthropic's credit-balance 400 and billing 402 are credit_exhausted", () => {
  assert.equal(categorizeClaudeFailure(400, CREDIT_TOO_LOW), "credit_exhausted");
  assert.equal(categorizeClaudeFailure(402, ANTHROPIC_BILLING), "credit_exhausted");
  assert.equal(categorizeClaudeFailure(402, ""), "credit_exhausted");
});

test("the gateway's own 429 is spend_capped, but Anthropic's rate limit is not", () => {
  assert.equal(categorizeClaudeFailure(429, GATEWAY_SPEND_LIMIT), "spend_capped");
  assert.equal(categorizeClaudeFailure(429, "Too Many Requests"), "spend_capped");
  assert.equal(categorizeClaudeFailure(429, ANTHROPIC_RATE_LIMIT), "other");
});

test("401 and 403 are auth; any other failure, including a plain bad request, is other", () => {
  assert.equal(categorizeClaudeFailure(401, ANTHROPIC_AUTH), "auth");
  assert.equal(categorizeClaudeFailure(403, "{}"), "auth");
  assert.equal(categorizeClaudeFailure(400, ANTHROPIC_BAD_REQUEST), "other");
  assert.equal(categorizeClaudeFailure(400, "not json"), "other");
  assert.equal(categorizeClaudeFailure(500, "{}"), "other");
  assert.equal(categorizeClaudeFailure(529, JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })), "other");
  assert.equal(categorizeClaudeFailure(0, null), "other");
});

// ---------------------------------------------------------- spend estimate

test("the spend estimate is usage tokens times the configured per-million prices, in micro-USD", () => {
  // Defaults: US$0.10 in, US$0.50 out per million tokens.
  assert.equal(estimateClaudeCostMicroUsd({ input_tokens: 1_000, output_tokens: 400 }, {}), 100 + 200);
  // Cache tokens count at the input price.
  assert.equal(estimateClaudeCostMicroUsd({ input_tokens: 1_000, output_tokens: 0, cache_creation_input_tokens: 500, cache_read_input_tokens: 500 }, {}), 200);
  assert.equal(estimateClaudeCostMicroUsd({ input_tokens: 2_000, output_tokens: 1_000 }, {
    AI_CLAUDE_PRICE_IN_PER_MTOK: "1",
    AI_CLAUDE_PRICE_OUT_PER_MTOK: "5"
  }), 2_000 + 5_000);
});

test("missing, negative or nonsense usage and prices never inflate or break the estimate", () => {
  assert.equal(estimateClaudeCostMicroUsd(undefined, {}), 0);
  assert.equal(estimateClaudeCostMicroUsd(null, {}), 0);
  assert.equal(estimateClaudeCostMicroUsd({ input_tokens: -5, output_tokens: "many" }, {}), 0);
  assert.equal(estimateClaudeCostMicroUsd({ input_tokens: 1_000_000, output_tokens: 0 }, { AI_CLAUDE_PRICE_IN_PER_MTOK: "-3" }), 100_000);
  assert.equal(estimateClaudeCostMicroUsd({ input_tokens: 1_000_000, output_tokens: 0 }, { AI_CLAUDE_PRICE_IN_PER_MTOK: "lots" }), 100_000);
  // A single absurd usage report is capped (10 million tokens of each).
  assert.equal(estimateClaudeCostMicroUsd({ input_tokens: 1e15, output_tokens: 1e15 }, {}), 1_000_000 + 5_000_000);
});

// ------------------------------------------------------------- thresholds

const okRow = { last_failure_category: null, last_failure_at: null, last_success_at: "2026-10-10T01:00:00.000Z", estimated_spend_micro_usd: 1_000_000, topped_up_at: null, topped_up_credit_micro_usd: null };

test("state is ok, low at the warn threshold, exhausted or capped from the last failure, and unknown without evidence", () => {
  const configured = { claudeConfigured: true, warnAtMicroUsd: 15_000_000 };
  assert.equal(deriveClaudeCreditState(okRow, configured), "ok");
  assert.equal(deriveClaudeCreditState({ ...okRow, estimated_spend_micro_usd: 14_999_999 }, configured), "ok");
  assert.equal(deriveClaudeCreditState({ ...okRow, estimated_spend_micro_usd: 15_000_000 }, configured), "low");
  assert.equal(deriveClaudeCreditState({ ...okRow, last_failure_category: "credit_exhausted", last_failure_at: "2026-10-10T02:00:00.000Z" }, configured), "exhausted");
  assert.equal(deriveClaudeCreditState({ ...okRow, last_failure_category: "spend_capped", last_failure_at: "2026-10-10T02:00:00.000Z", estimated_spend_micro_usd: 16_000_000 }, configured), "capped");
  // A transient failure after a success does not hide a working provider.
  assert.equal(deriveClaudeCreditState({ ...okRow, last_failure_category: "other", last_failure_at: "2026-10-10T02:00:00.000Z" }, configured), "ok");
  // A rejected key says nothing about credit.
  assert.equal(deriveClaudeCreditState({ ...okRow, last_failure_category: "auth", last_failure_at: "2026-10-10T02:00:00.000Z" }, configured), "unknown");
  assert.equal(deriveClaudeCreditState(null, configured), "unknown");
  assert.equal(deriveClaudeCreditState({ ...okRow, last_success_at: null }, configured), "unknown");
  assert.equal(deriveClaudeCreditState({ ...okRow, last_failure_category: "credit_exhausted", last_failure_at: "x" }, { claudeConfigured: false, warnAtMicroUsd: 15_000_000 }), "unknown");
});

test("the credit and warn amounts come from vars, or from the last top-up mark", () => {
  const status = buildAiProviderStatus(okRow, CLAUDE_ENV, true);
  assert.deepEqual(status, {
    ok: true,
    visible: true,
    claudeConfigured: true,
    state: "ok",
    estimatedSpendUsd: 1,
    creditUsd: 20,
    warnAtUsd: 15,
    monthSpendUsd: 0,
    monthTargetUsd: 8,
    mode: "claude_all",
    lastSuccessAt: "2026-10-10T01:00:00.000Z",
    consoleBillingUrl: "https://platform.claude.com/settings/billing"
  });
  assert.equal(CLAUDE_CONSOLE_BILLING_URL, "https://platform.claude.com/settings/billing");

  const configured = buildAiProviderStatus({ ...okRow, estimated_spend_micro_usd: 8_000_000 }, { ...CLAUDE_ENV, AI_CLAUDE_CREDIT_USD: "10", AI_CLAUDE_WARN_AT_USD: "8" }, true);
  assert.equal(configured.creditUsd, 10);
  assert.equal(configured.warnAtUsd, 8);
  assert.equal(configured.state, "low");

  // A top-up of US$5 lowers the warn amount to the credit itself.
  const toppedUp = buildAiProviderStatus({ ...okRow, topped_up_at: "2026-10-09T00:00:00.000Z", topped_up_credit_micro_usd: 5_000_000, estimated_spend_micro_usd: 4_990_000 }, CLAUDE_ENV, true);
  assert.equal(toppedUp.creditUsd, 5);
  assert.equal(toppedUp.warnAtUsd, 5);
  assert.equal(toppedUp.state, "ok");
  assert.equal(toppedUp.estimatedSpendUsd, 4.99);

  // Bad vars fall back to the defaults.
  const bad = buildAiProviderStatus(okRow, { ...CLAUDE_ENV, AI_CLAUDE_CREDIT_USD: "-1", AI_CLAUDE_WARN_AT_USD: "lots" }, true);
  assert.equal(bad.creditUsd, 20);
  assert.equal(bad.warnAtUsd, 15);

  const failure = buildAiProviderStatus({ ...okRow, last_failure_category: "credit_exhausted", last_failure_at: "2026-10-10T02:00:00.000Z" }, CLAUDE_ENV, true);
  assert.equal(failure.state, "exhausted");
  assert.equal(failure.lastFailureAt, "2026-10-10T02:00:00.000Z");
  assert.equal(failure.lastFailureReason, "credit_exhausted");

  const unconfigured = buildAiProviderStatus(null, { AI_ASSIST_ENABLED: "true" }, false);
  assert.equal(unconfigured.claudeConfigured, false);
  assert.equal(unconfigured.state, "unknown");
  assert.equal(unconfigured.estimatedSpendUsd, 0);
});

// ------------------------------------------------------------ owner gating

test("AI_ALERT_EMAILS \"*\" makes everyone an alert viewer, signed in or not", () => {
  for (const value of ["*", " * ", "owner@example.com, *"]) {
    const env = { AI_ALERT_EMAILS: value };
    assert.equal(isAiAlertViewer(env, "owner@example.com"), true, value);
    assert.equal(isAiAlertViewer(env, "someone@example.com"), true, value);
    assert.equal(isAiAlertViewer(env, undefined), true, value);
    assert.equal(isAiAlertViewer(env, ""), true, value);
  }
  // A star inside an address is not a wildcard.
  assert.equal(isAiAlertViewer({ AI_ALERT_EMAILS: "*@example.com" }, "someone@example.com"), false);
  assert.equal(isAiAlertViewer({ AI_ALERT_EMAILS: "**" }, "someone@example.com"), false);
});

test("only an Access email listed in AI_ALERT_EMAILS is an alert viewer", () => {
  const env = { AI_ALERT_EMAILS: " owner@example.com , second@example.com ,," };
  assert.equal(isAiAlertViewer(env, "owner@example.com"), true);
  assert.equal(isAiAlertViewer(env, "OWNER@EXAMPLE.COM"), true);
  assert.equal(isAiAlertViewer(env, "second@example.com"), true);
  assert.equal(isAiAlertViewer(env, "someone@example.com"), false);
  assert.equal(isAiAlertViewer(env, undefined), false);
  assert.equal(isAiAlertViewer(env, ""), false);
  assert.equal(isAiAlertViewer({ AI_ALERT_EMAILS: "" }, "owner@example.com"), false);
  assert.equal(isAiAlertViewer({}, "owner@example.com"), false);
});

test("a top-up amount must be a positive number up to US$10,000", () => {
  assert.equal(parseTopUpCreditUsd(25), 25);
  assert.equal(parseTopUpCreditUsd(0.5), 0.5);
  assert.equal(parseTopUpCreditUsd(10_000), 10_000);
  for (const bad of [0, -5, 10_000.01, 1e12, Number.NaN, Number.POSITIVE_INFINITY, "25", null, undefined, {}, [25], true]) {
    assert.equal(parseTopUpCreditUsd(bad), null, `rejects ${String(bad)}`);
  }
});

// ------------------------------------------------------- real D1 statements

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function statusRow(db) {
  return (await rows(db, "SELECT * FROM ai_provider_status"))[0] ?? null;
}

test("each record is one upsert on one row that keeps only aggregate figures", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  assert.equal(await statusRow(db), null);

  await recordClaudeSuccess(db, 1_250, "2026-10-10T01:00:00.000Z");
  await recordClaudeSuccess(db, 750, "2026-10-10T01:05:00.000Z");
  assert.deepEqual(await statusRow(db), {
    provider: "claude",
    last_failure_category: null,
    last_failure_at: null,
    last_success_at: "2026-10-10T01:05:00.000Z",
    estimated_spend_micro_usd: 2_000,
    topped_up_at: null,
    topped_up_credit_micro_usd: null,
    spend_month: "2026-10",
    month_spend_micro_usd: 2_000
  });
  const columns = (await rows(db, "SELECT name FROM pragma_table_info('ai_provider_status') ORDER BY cid")).map((row) => row.name);
  assert.deepEqual(columns, ["provider", "last_failure_category", "last_failure_at", "last_success_at", "estimated_spend_micro_usd", "topped_up_at", "topped_up_credit_micro_usd", "spend_month", "month_spend_micro_usd"]);

  await recordClaudeFailure(db, "credit_exhausted", "2026-10-10T02:00:00.000Z");
  const failed = await statusRow(db);
  assert.equal(failed.last_failure_category, "credit_exhausted");
  assert.equal(failed.last_failure_at, "2026-10-10T02:00:00.000Z");
  assert.equal(failed.estimated_spend_micro_usd, 2_000);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM ai_provider_status"))[0].n, 1);
});

test("a later success clears a credit or spend-cap failure, and a transient failure never hides one", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recordClaudeSuccess(db, 100, "2026-10-10T01:00:00.000Z");
  await recordClaudeFailure(db, "spend_capped", "2026-10-10T02:00:00.000Z");
  await recordClaudeFailure(db, "other", "2026-10-10T02:01:00.000Z");
  assert.equal((await statusRow(db)).last_failure_category, "spend_capped");
  assert.equal((await statusRow(db)).last_failure_at, "2026-10-10T02:00:00.000Z");
  // A more specific failure does replace it.
  await recordClaudeFailure(db, "credit_exhausted", "2026-10-10T02:02:00.000Z");
  assert.equal((await statusRow(db)).last_failure_category, "credit_exhausted");

  await recordClaudeSuccess(db, 100, "2026-10-10T03:00:00.000Z");
  const recovered = await statusRow(db);
  assert.equal(recovered.last_failure_category, null);
  assert.equal(recovered.last_failure_at, null);
  assert.equal(recovered.last_success_at, "2026-10-10T03:00:00.000Z");
  assert.equal(deriveClaudeCreditState(recovered, { claudeConfigured: true, warnAtMicroUsd: 15_000_000 }), "ok");
});

test("a failure that finished before a recorded success does not overwrite it, and the reverse", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recordClaudeSuccess(db, 100, "2026-10-10T05:00:00.000Z");
  await recordClaudeFailure(db, "credit_exhausted", "2026-10-10T04:59:00.000Z");
  assert.equal((await statusRow(db)).last_failure_category, null);

  await recordClaudeFailure(db, "credit_exhausted", "2026-10-10T06:00:00.000Z");
  await recordClaudeSuccess(db, 100, "2026-10-10T05:59:00.000Z");
  const row = await statusRow(db);
  assert.equal(row.last_failure_category, "credit_exhausted");
  assert.equal(row.last_success_at, "2026-10-10T05:59:00.000Z");
  assert.equal(row.estimated_spend_micro_usd, 200);
});

test("marking a top-up resets the estimate, records the credit and clears a credit failure only", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recordClaudeSuccess(db, 19_000_000, "2026-10-10T01:00:00.000Z");
  await recordClaudeFailure(db, "credit_exhausted", "2026-10-10T02:00:00.000Z");
  await markClaudeToppedUp(db, 30, "2026-10-10T03:00:00.000Z");
  assert.deepEqual(await statusRow(db), {
    provider: "claude",
    last_failure_category: null,
    last_failure_at: null,
    last_success_at: "2026-10-10T01:00:00.000Z",
    estimated_spend_micro_usd: 0,
    topped_up_at: "2026-10-10T03:00:00.000Z",
    topped_up_credit_micro_usd: 30_000_000,
    // A top-up restarts the credit estimate, not the month's pacing.
    spend_month: "2026-10",
    month_spend_micro_usd: 19_000_000
  });

  await recordClaudeFailure(db, "spend_capped", "2026-10-10T04:00:00.000Z");
  await markClaudeToppedUp(db, 10, "2026-10-10T05:00:00.000Z");
  assert.equal((await statusRow(db)).last_failure_category, "spend_capped");

  // A top-up on an empty table creates the row.
  const fresh = await openSeededDatabase(t, template);
  await markClaudeToppedUp(fresh.db, 20, "2026-10-10T05:00:00.000Z");
  assert.equal((await statusRow(fresh.db)).topped_up_credit_micro_usd, 20_000_000);
});

// ------------------------------------------------------------------ routes

function statusRequest(email) {
  return new Request("http://127.0.0.1/api/ai-assist/provider-status", {
    headers: email ? { "Cf-Access-Authenticated-User-Email": email } : {}
  });
}

function topUpRequest(email, body) {
  return new Request("http://127.0.0.1/api/ai-assist/provider-status/topped-up", {
    method: "POST",
    headers: { "content-type": "application/json", ...(email ? { "CF-Access-Authenticated-User-Email": email } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("the owner sees the figures; anyone else, or nobody signed in, sees nothing", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T04:00:00.000Z") });
  const { db } = await openSeededDatabase(t, template);
  const env = { ...template.config.vars, ...CLAUDE_ENV, DB: db, AI_ALERT_EMAILS: "owner@example.com" };
  await recordClaudeSuccess(db, 16_000_000, "2026-10-10T01:00:00.000Z");

  const owner = await worker.fetch(statusRequest(OWNER), env);
  assert.equal(owner.status, 200);
  assert.deepEqual(await owner.json(), {
    ok: true,
    visible: true,
    claudeConfigured: true,
    state: "low",
    estimatedSpendUsd: 16,
    creditUsd: 20,
    warnAtUsd: 15,
    // US$16 of this month's US$8 target: past 90%, so everything is basic-first.
    monthSpendUsd: 16,
    monthTargetUsd: 8,
    mode: "basic_first",
    lastSuccessAt: "2026-10-10T01:00:00.000Z",
    consoleBillingUrl: "https://platform.claude.com/settings/billing"
  });

  for (const email of ["someone@example.com", undefined]) {
    const other = await worker.fetch(statusRequest(email), env);
    assert.equal(other.status, 200);
    assert.deepEqual(await other.json(), { ok: true, visible: false });
  }
  // With no alert emails configured, not even a signed-in owner sees it.
  const unlisted = await worker.fetch(statusRequest(OWNER), { ...env, AI_ALERT_EMAILS: "" });
  assert.deepEqual(await unlisted.json(), { ok: true, visible: false });
});

test("with AI_ALERT_EMAILS \"*\" everyone sees the figures and may mark a top-up", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const env = { ...template.config.vars, ...CLAUDE_ENV, DB: db, AI_ALERT_EMAILS: "*" };
  await recordClaudeSuccess(db, 16_000_000, "2026-10-10T01:00:00.000Z");

  for (const email of [OWNER, "someone@example.com", undefined]) {
    const response = await worker.fetch(statusRequest(email), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.visible, true, String(email));
    assert.equal(body.state, "low");
    assert.equal(body.estimatedSpendUsd, 16);
  }

  // Anyone may mark the top-up; the amount is still checked.
  const refused = await worker.fetch(topUpRequest("someone@example.com", { creditUsd: -1 }), env);
  assert.equal(refused.status, 400);
  const marked = await worker.fetch(topUpRequest("someone@example.com", { creditUsd: 25 }), env);
  assert.equal(marked.status, 200);
  const after = await marked.json();
  assert.equal(after.visible, true);
  assert.equal(after.creditUsd, 25);
  assert.equal(after.estimatedSpendUsd, 0);
  assert.equal(after.state, "ok");
});

test("wrangler.jsonc shows the Claude credit status to everyone", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"AI_ALERT_EMAILS": "\*"/);
});

test("the owner marks a top-up; validation and non-owners are refused without a write", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const env = { ...template.config.vars, ...CLAUDE_ENV, DB: db, AI_ALERT_EMAILS: "owner@example.com" };
  await recordClaudeSuccess(db, 19_500_000, "2026-10-10T01:00:00.000Z");
  await recordClaudeFailure(db, "credit_exhausted", "2026-10-10T02:00:00.000Z");
  const before = await statusRow(db);

  for (const body of [{ creditUsd: -5 }, { creditUsd: 0 }, { creditUsd: 1e9 }, { creditUsd: "25" }, {}, "not json"]) {
    const refused = await worker.fetch(topUpRequest(OWNER, body), env);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal((await refused.json()).ok, false);
  }
  const stranger = await worker.fetch(topUpRequest("someone@example.com", { creditUsd: 25 }), env);
  assert.equal(stranger.status, 403);
  assert.deepEqual(await stranger.json(), { ok: false, error: "Not available." });
  const anonymous = await worker.fetch(topUpRequest(undefined, { creditUsd: 25 }), env);
  assert.equal(anonymous.status, 403);
  assert.deepEqual(await statusRow(db), before);

  const accepted = await worker.fetch(topUpRequest(OWNER, { creditUsd: 25 }), env);
  assert.equal(accepted.status, 200);
  const payload = await accepted.json();
  assert.equal(payload.visible, true);
  assert.equal(payload.state, "ok");
  assert.equal(payload.estimatedSpendUsd, 0);
  assert.equal(payload.creditUsd, 25);
  assert.equal(payload.warnAtUsd, 15);
  const row = await statusRow(db);
  assert.equal(row.estimated_spend_micro_usd, 0);
  assert.equal(row.topped_up_credit_micro_usd, 25_000_000);
  assert.match(row.topped_up_at, /^\d{4}-\d{2}-\d{2}T/);

  const get = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/provider-status/topped-up", { headers: { "Cf-Access-Authenticated-User-Email": OWNER } }), env);
  assert.equal(get.status, 404);
});


// -------------------------------------------------------------- auto-balance

// Owner-approved 2026-10-12: a monthly Claude target (default US$8) and a
// pace line (target x day / days in the month, Asia/Singapore) decide whether
// background features ask Claude or the basic model first.
const rowFor = (month, spendUsd) => ({ spend_month: month, month_spend_micro_usd: Math.round(spendUsd * 1_000_000) });
// Noon in Singapore on the given day of October 2026 (31 days; target 8 -> pace 8/31 a day).
const october = (day) => new Date(`2026-10-${String(day).padStart(2, "0")}T04:00:00.000Z`);

test("the pace line is the target times the day over the days in the month, and the target defaults to US$8", () => {
  const day1 = computeClaudePacing(null, {}, october(1));
  assert.equal(day1.monthTargetMicroUsd, 8_000_000);
  assert.equal(day1.paceMicroUsd, Math.round(8_000_000 / 31));
  assert.equal(computeClaudePacing(null, {}, october(15)).paceMicroUsd, Math.round(8_000_000 * 15 / 31));
  assert.equal(computeClaudePacing(null, {}, october(31)).paceMicroUsd, 8_000_000);
  // February 2027 has 28 days; the 14th is exactly half way.
  assert.equal(computeClaudePacing(null, {}, new Date("2027-02-14T04:00:00.000Z")).paceMicroUsd, 4_000_000);
  // A configured target is used; a bad one falls back to 8.
  assert.equal(computeClaudePacing(null, { AI_CLAUDE_MONTHLY_TARGET_USD: "12" }, october(31)).paceMicroUsd, 12_000_000);
  assert.equal(computeClaudePacing(null, { AI_CLAUDE_MONTHLY_TARGET_USD: "lots" }, october(31)).monthTargetMicroUsd, 8_000_000);
  assert.equal(computeClaudePacing(null, { AI_CLAUDE_MONTHLY_TARGET_USD: "-3" }, october(31)).monthTargetMicroUsd, 8_000_000);
});

test("under the pace line everything is Claude-first; over it background goes basic-first; at 90% of the target everything does", () => {
  // Day 1: pace is about US$0.26.
  assert.equal(computeClaudePacing(rowFor("2026-10", 0), {}, october(1)).mode, "claude_all");
  assert.equal(computeClaudePacing(rowFor("2026-10", 0.25), {}, october(1)).mode, "claude_all");
  assert.equal(computeClaudePacing(rowFor("2026-10", 0.3), {}, october(1)).mode, "ask_only");
  // Day 15: pace is about US$3.87.
  assert.equal(computeClaudePacing(rowFor("2026-10", 3.8), {}, october(15)).mode, "claude_all");
  assert.equal(computeClaudePacing(rowFor("2026-10", 3.9), {}, october(15)).mode, "ask_only");
  assert.equal(computeClaudePacing(rowFor("2026-10", 7.1), {}, october(15)).mode, "ask_only");
  // 90% of US$8 is US$7.20, from any day.
  assert.equal(computeClaudePacing(rowFor("2026-10", 7.2), {}, october(15)).mode, "basic_first");
  assert.equal(computeClaudePacing(rowFor("2026-10", 7.2), {}, october(1)).mode, "basic_first");
  // Day 30 (pace about US$7.74): over pace but under 90% is impossible, so 7.19 is claude_all-or-ask_only by pace.
  assert.equal(computeClaudePacing(rowFor("2026-10", 7.19), {}, october(30)).mode, "claude_all");
  assert.equal(computeClaudePacing(rowFor("2026-10", 7.3), {}, october(30)).mode, "basic_first");
  assert.equal(computeClaudePacing(rowFor("2026-10", 100), {}, october(31)).mode, "basic_first");
  // The figures the status reports.
  const pacing = computeClaudePacing(rowFor("2026-10", 5), {}, october(15));
  assert.equal(pacing.monthSpendMicroUsd, 5_000_000);
  assert.equal(pacing.mode, "ask_only");
});

test("a new calendar month in Singapore starts at zero, including at the month boundary", () => {
  assert.equal(computeClaudePacing(rowFor("2026-09", 7.9), {}, october(1)).mode, "claude_all");
  assert.equal(computeClaudePacing(rowFor("2026-09", 7.9), {}, october(1)).monthSpendMicroUsd, 0);
  // Singapore midnight (UTC+8) is 16:00Z: 15:59Z is still 30 September.
  assert.equal(computeClaudePacing(rowFor("2026-09", 7.9), {}, new Date("2026-09-30T16:00:00.000Z")).mode, "claude_all");
  assert.equal(computeClaudePacing(rowFor("2026-09", 7.9), {}, new Date("2026-09-30T15:59:00.000Z")).mode, "basic_first");
  assert.equal(monthKeyInAppTimeZone(new Date("2026-09-30T16:00:00.000Z")), "2026-10");
  // Rows from before auto-balance, and no row at all, read as no spend.
  assert.equal(computeClaudePacing({}, {}, october(15)).monthSpendMicroUsd, 0);
  assert.equal(computeClaudePacing(undefined, {}, october(15)).mode, "claude_all");
});

test("routing per tier: ask features keep Claude first until 90% of the target", () => {
  const ask = ["receipt_read", "entry_draft", "ask_answer", "plan_draft"];
  const background = ["monthly_narrative", "import_explanation", "category_rules", "statement_text_fallback"];
  for (const capability of ask) {
    assert.deepEqual(["claude_all", "ask_only", "basic_first"].map((mode) => claudeGoesFirst(mode, capability)), [true, true, false], capability);
  }
  for (const capability of background) {
    assert.deepEqual(["claude_all", "ask_only", "basic_first"].map((mode) => claudeGoesFirst(mode, capability)), [true, false, false], capability);
  }
});

test("a success in a new month replaces the month's spend, and one in the same month adds to it, in one statement", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recordClaudeSuccess(db, 3_000_000, "2026-09-30T10:00:00.000Z");
  await recordClaudeSuccess(db, 500_000, "2026-09-30T11:00:00.000Z");
  assert.deepEqual(pickMonth(await statusRow(db)), { spend_month: "2026-09", month_spend_micro_usd: 3_500_000, estimated_spend_micro_usd: 3_500_000 });
  // 16:00Z on the 30th is midnight, 1 October, in Singapore: the month's figure restarts, the credit estimate keeps adding.
  await recordClaudeSuccess(db, 200_000, "2026-09-30T16:00:00.000Z");
  assert.deepEqual(pickMonth(await statusRow(db)), { spend_month: "2026-10", month_spend_micro_usd: 200_000, estimated_spend_micro_usd: 3_700_000 });
  await recordClaudeSuccess(db, 100_000, "2026-10-02T01:00:00.000Z");
  assert.equal((await statusRow(db)).month_spend_micro_usd, 300_000);
});

test("a status table from before auto-balance gains the two columns when the schema is initialised", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await db.prepare("DROP TABLE ai_provider_status").run();
  await db.prepare(`CREATE TABLE ai_provider_status (
    provider TEXT PRIMARY KEY CHECK (provider = 'claude'),
    last_failure_category TEXT, last_failure_at TEXT, last_success_at TEXT,
    estimated_spend_micro_usd INTEGER NOT NULL DEFAULT 0, topped_up_at TEXT, topped_up_credit_micro_usd INTEGER)`).run();
  await db.prepare("INSERT INTO ai_provider_status (provider, estimated_spend_micro_usd) VALUES ('claude', 4000000)").run();
  const { ensureDemoSchema } = await import("../src/domain/app-repository-schema.ts");
  await ensureDemoSchema(db);
  assert.deepEqual(pickMonth(await statusRow(db)), { spend_month: null, month_spend_micro_usd: 0, estimated_spend_micro_usd: 4_000_000 });
  await recordClaudeSuccess(db, 1_000, "2026-10-10T01:00:00.000Z");
  assert.equal((await statusRow(db)).month_spend_micro_usd, 1_000);
});

function pickMonth(row) {
  return { spend_month: row.spend_month, month_spend_micro_usd: row.month_spend_micro_usd, estimated_spend_micro_usd: row.estimated_spend_micro_usd };
}

test("GET provider-status carries this month's spend, the target and the mode", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T04:00:00.000Z") });
  const { db } = await openSeededDatabase(t, template);
  const env = { ...template.config.vars, ...CLAUDE_ENV, DB: db, AI_ALERT_EMAILS: "*", AI_CLAUDE_MONTHLY_TARGET_USD: "8" };
  const read = async (override = {}) => (await (await worker.fetch(statusRequest(OWNER), { ...env, ...override })).json());

  const none = await read();
  assert.equal(none.monthSpendUsd, 0);
  assert.equal(none.monthTargetUsd, 8);
  assert.equal(none.mode, "claude_all");

  await recordClaudeSuccess(db, 5_250_000, "2026-10-14T01:00:00.000Z");
  const over = await read();
  assert.equal(over.monthSpendUsd, 5.25);
  assert.equal(over.mode, "ask_only");
  assert.equal((await read({ AI_CLAUDE_MONTHLY_TARGET_USD: "5" })).mode, "basic_first");
  assert.equal((await read({ AI_CLAUDE_MONTHLY_TARGET_USD: "20" })).mode, "claude_all");
  // A row from last month counts for nothing this month.
  await db.prepare("UPDATE ai_provider_status SET spend_month = '2026-09'").run();
  const rolled = await read();
  assert.equal(rolled.monthSpendUsd, 0);
  assert.equal(rolled.mode, "claude_all");
  // The not-visible answer is unchanged and carries none of it.
  const hidden = await (await worker.fetch(statusRequest("x@example.com"), { ...env, AI_ALERT_EMAILS: "owner@example.com" })).json();
  assert.deepEqual(hidden, { ok: true, visible: false });
});
