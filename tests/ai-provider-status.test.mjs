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
    topped_up_credit_micro_usd: null
  });
  const columns = (await rows(db, "SELECT name FROM pragma_table_info('ai_provider_status') ORDER BY cid")).map((row) => row.name);
  assert.deepEqual(columns, ["provider", "last_failure_category", "last_failure_at", "last_success_at", "estimated_spend_micro_usd", "topped_up_at", "topped_up_credit_micro_usd"]);

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
    topped_up_credit_micro_usd: 30_000_000
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
