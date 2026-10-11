// The Claude credit notice on Ask and the Ask and AI section in Settings
// (src/client/claude-credit-model.js, src/client/claude-credit-status.js):
// which status shows a notice, with what words, tone and actions; hidden
// money drops the figures; a dismissal lasts for the browser session and
// gives way when the state gets worse; the "I've topped up" amount is
// checked before it is sent; and the status and top-up requests fail soft.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClaudeCreditLine,
  buildClaudeCreditNotice,
  CREDIT_NOTICE_DISMISSAL_KEY,
  formatUsd,
  isCreditNoticeHidden,
  nextCreditNoticeDismissal,
  readClaudeCreditStatus,
  readCreditNoticeDismissal,
  shouldFetchClaudeCreditStatus,
  validateTopUpAmount,
  writeCreditNoticeDismissal
} from "../src/client/claude-credit-model.js";
import { postClaudeToppedUp, requestClaudeCreditStatus } from "../src/client/claude-credit-status.js";

const BILLING = "https://platform.claude.com/settings/billing";

function status(overrides = {}) {
  return readClaudeCreditStatus({
    ok: true,
    visible: true,
    claudeConfigured: true,
    state: "ok",
    estimatedSpendUsd: 3.2,
    creditUsd: 20,
    warnAtUsd: 15,
    lastSuccessAt: "2026-10-11T02:00:00.000Z",
    consoleBillingUrl: BILLING,
    ...overrides
  });
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

function response(body, { status: code = 200 } = {}) {
  return { ok: code >= 200 && code < 300, status: code, json: async () => body };
}

test("low shows a butter notice with the estimate, both actions and a dismiss", () => {
  const notice = buildClaudeCreditNotice(status({ state: "low", estimatedSpendUsd: 15.2345 }), { areTotalsVisible: true });
  assert.deepEqual(notice, {
    state: "low",
    rank: 1,
    tone: "butter",
    text: "Claude credits are running low: about $15.23 of $20 used. Ask still works.",
    actions: [
      { id: "top-up", label: "Top up in the Claude Console", href: BILLING },
      { id: "topped-up", label: "I've topped up" }
    ],
    dismissLabel: "Hide this notice"
  });
});

test("used up and capped say Ask is on the basic model, in the rose attention tone", () => {
  const exhausted = buildClaudeCreditNotice(status({ state: "exhausted", lastFailureReason: "credit_exhausted", lastFailureAt: "2026-10-11T03:00:00.000Z" }), { areTotalsVisible: true });
  assert.equal(exhausted.text, "Claude credits are used up, so Ask is using the basic model for now.");
  assert.equal(exhausted.tone, "rose");
  assert.equal(exhausted.rank, 3);
  assert.deepEqual(exhausted.actions.map((action) => action.id), ["top-up", "topped-up"]);

  const capped = buildClaudeCreditNotice(status({ state: "capped", lastFailureReason: "spend_capped" }), { areTotalsVisible: true });
  assert.equal(capped.text, "This month's Claude spending limit is reached, so Ask is using the basic model until it resets.");
  assert.equal(capped.tone, "rose");
  assert.equal(capped.rank, 2);
});

test("ok, unknown, a hidden status and no status show no notice", () => {
  assert.equal(buildClaudeCreditNotice(status({ state: "ok" }), { areTotalsVisible: true }), null);
  assert.equal(buildClaudeCreditNotice(status({ state: "unknown" }), { areTotalsVisible: true }), null);
  assert.equal(buildClaudeCreditNotice(readClaudeCreditStatus({ ok: true, visible: false }), { areTotalsVisible: true }), null);
  assert.equal(buildClaudeCreditNotice(null, { areTotalsVisible: true }), null);
});

test("hidden money keeps the notice and its actions but drops every dollar figure", () => {
  const notice = buildClaudeCreditNotice(status({ state: "low", estimatedSpendUsd: 16 }), { areTotalsVisible: false });
  assert.equal(notice.text, "Claude credits are running low. Ask still works.");
  assert.doesNotMatch(notice.text, /\$|\d/);
  assert.deepEqual(notice.actions.map((action) => action.id), ["top-up", "topped-up"]);

  const line = buildClaudeCreditLine(status({ state: "ok" }), { areTotalsVisible: false });
  assert.equal(line.text, "Claude credits are fine.");
  assert.doesNotMatch(buildClaudeCreditLine(status({ state: "low" }), { areTotalsVisible: false }).text, /\$|\d/);
});

test("the Settings line covers every state, with the calm not-set-up line and no actions when Claude is off", () => {
  assert.deepEqual(buildClaudeCreditLine(status({ state: "ok", estimatedSpendUsd: 3.2 }), { areTotalsVisible: true }), {
    state: "ok",
    tone: "neutral",
    text: "Claude credits are fine: about $3.20 of $20 used.",
    actions: [
      { id: "top-up", label: "Top up in the Claude Console", href: BILLING },
      { id: "topped-up", label: "I've topped up" }
    ]
  });
  assert.equal(buildClaudeCreditLine(status({ state: "low", estimatedSpendUsd: 18 }), { areTotalsVisible: true }).text, "Claude credits are running low: about $18 of $20 used. Ask still works.");
  assert.equal(buildClaudeCreditLine(status({ state: "exhausted" }), { areTotalsVisible: true }).tone, "rose");

  const off = buildClaudeCreditLine(status({ state: "unknown", claudeConfigured: false }), { areTotalsVisible: true });
  assert.deepEqual(off, { state: "unknown", tone: "neutral", text: "Claude isn't set up, so Ask uses the basic model.", actions: [] });
  assert.equal(buildClaudeCreditLine(status({ state: "unknown" }), { areTotalsVisible: true }).text, "Claude isn't set up, so Ask uses the basic model.");
  assert.equal(buildClaudeCreditLine(readClaudeCreditStatus({ ok: true, visible: false }), { areTotalsVisible: true }), null);
});

test("the billing link is only offered when the server gives an https Claude Console address", () => {
  const notice = buildClaudeCreditNotice(status({ state: "low", consoleBillingUrl: "javascript:alert(1)" }), { areTotalsVisible: true });
  assert.deepEqual(notice.actions.map((action) => action.id), ["topped-up"]);
});

test("the status reader keeps only known fields and states, and refuses a malformed body", () => {
  assert.deepEqual(readClaudeCreditStatus({ ok: true, visible: false }), { visible: false });
  assert.equal(readClaudeCreditStatus(null), null);
  assert.equal(readClaudeCreditStatus({ ok: false, error: "nope" }), null);
  assert.equal(readClaudeCreditStatus({ ok: true, visible: true, state: "low" }).state, "low");
  assert.equal(readClaudeCreditStatus({ ok: true, visible: true, state: "on-fire" }).state, "unknown");
  const read = readClaudeCreditStatus({ ok: true, visible: true, claudeConfigured: true, state: "low", estimatedSpendUsd: "15", creditUsd: 20, prompt: "secret" });
  assert.equal(read.estimatedSpendUsd, 0);
  assert.equal("prompt" in read, false);
});

test("a dismissal lasts for the session and the notice comes back only when the state gets worse", () => {
  const storage = memoryStorage();
  const low = buildClaudeCreditNotice(status({ state: "low" }), { areTotalsVisible: true });
  const capped = buildClaudeCreditNotice(status({ state: "capped" }), { areTotalsVisible: true });
  const exhausted = buildClaudeCreditNotice(status({ state: "exhausted" }), { areTotalsVisible: true });

  assert.equal(readCreditNoticeDismissal(storage), null);
  assert.equal(isCreditNoticeHidden(low, null), false);

  writeCreditNoticeDismissal(storage, "low");
  assert.equal(storage.values.get(CREDIT_NOTICE_DISMISSAL_KEY), "low");
  // A reload in the same tab reads it back.
  assert.equal(readCreditNoticeDismissal(storage), "low");
  assert.equal(isCreditNoticeHidden(low, "low"), true);
  // Worse states show again.
  assert.equal(isCreditNoticeHidden(capped, "low"), false);
  assert.equal(isCreditNoticeHidden(exhausted, "capped"), false);
  // A milder state stays hidden under a stronger dismissal.
  assert.equal(isCreditNoticeHidden(low, "exhausted"), true);
  assert.equal(isCreditNoticeHidden(capped, "exhausted"), true);
});

test("the stored dismissal follows the status: kept while not worse, cleared on worse or once fine again", () => {
  assert.equal(nextCreditNoticeDismissal("low", status({ state: "low" })), "low");
  assert.equal(nextCreditNoticeDismissal("exhausted", status({ state: "low" })), "exhausted");
  assert.equal(nextCreditNoticeDismissal("low", status({ state: "exhausted" })), null);
  assert.equal(nextCreditNoticeDismissal("low", status({ state: "ok" })), null);
  assert.equal(nextCreditNoticeDismissal("low", status({ state: "unknown" })), null);
  // No status yet (still loading, or the read failed): nothing changes.
  assert.equal(nextCreditNoticeDismissal("low", null), "low");
});

test("an unreadable or blocked session store never breaks the notice", () => {
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(readCreditNoticeDismissal(throwing), null);
  assert.doesNotThrow(() => writeCreditNoticeDismissal(throwing, "low"));
  assert.doesNotThrow(() => writeCreditNoticeDismissal(throwing, null));
  assert.equal(readCreditNoticeDismissal(memoryStorage({ [CREDIT_NOTICE_DISMISSAL_KEY]: "nonsense" })), null);
  assert.equal(readCreditNoticeDismissal(null), null);
  const storage = memoryStorage({ [CREDIT_NOTICE_DISMISSAL_KEY]: "capped" });
  writeCreditNoticeDismissal(storage, null);
  assert.equal(storage.values.has(CREDIT_NOTICE_DISMISSAL_KEY), false);
});

test("the top-up amount must be a positive number of US dollars up to 10,000", () => {
  assert.deepEqual(validateTopUpAmount("20"), { ok: true, creditUsd: 20 });
  assert.deepEqual(validateTopUpAmount(" 25.50 "), { ok: true, creditUsd: 25.5 });
  assert.deepEqual(validateTopUpAmount("$1,000"), { ok: true, creditUsd: 1000 });
  assert.deepEqual(validateTopUpAmount(".5"), { ok: true, creditUsd: 0.5 });
  assert.deepEqual(validateTopUpAmount("10000"), { ok: true, creditUsd: 10000 });

  const refused = "Enter the credit you bought in US dollars, more than 0 and at most 10,000.";
  for (const value of ["", "   ", "0", "0.00", "0.001", "-5", "10000.01", "20000", "abc", "1e3", "12.3.4", null, undefined]) {
    assert.deepEqual(validateTopUpAmount(value), { ok: false, error: refused }, `"${value}" should be refused`);
  }
});

test("dollar figures read as whole dollars or cents", () => {
  assert.equal(formatUsd(20), "$20");
  assert.equal(formatUsd(15.2345), "$15.23");
  assert.equal(formatUsd(3.2), "$3.20");
  assert.equal(formatUsd(1234.5), "$1,234.50");
});

test("the status is read once the screen is usable, then again only when it is over five minutes old", () => {
  const now = 1_000_000_000;
  assert.equal(shouldFetchClaudeCreditStatus({ enabled: false, hasData: false, updatedAt: 0, now }), false);
  assert.equal(shouldFetchClaudeCreditStatus({ enabled: true, hasData: false, updatedAt: 0, now }), true);
  assert.equal(shouldFetchClaudeCreditStatus({ enabled: true, hasData: true, updatedAt: now - 60_000, now }), false);
  assert.equal(shouldFetchClaudeCreditStatus({ enabled: true, hasData: true, updatedAt: now - 5 * 60_000 - 1, now }), true);
});

test("the status request reads the route without caching and throws on a failure so nothing is cached", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response({ ok: true, visible: true, claudeConfigured: true, state: "low", estimatedSpendUsd: 16, creditUsd: 20, warnAtUsd: 15, consoleBillingUrl: BILLING });
  };
  const result = await requestClaudeCreditStatus({ fetchImpl });
  assert.equal(calls[0].url, "/api/ai-assist/provider-status");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(result.state, "low");
  assert.equal(result.estimatedSpendUsd, 16);

  await assert.rejects(requestClaudeCreditStatus({ fetchImpl: async () => response({}, { status: 500 }) }));
  await assert.rejects(requestClaudeCreditStatus({ fetchImpl: async () => response({ nonsense: true }) }));
});

test("I've topped up posts the amount and returns the fresh status, or a calm error", async () => {
  let sent = null;
  const ok = await postClaudeToppedUp({
    creditUsd: 25,
    fetchImpl: async (url, init) => {
      sent = { url, method: init.method, body: JSON.parse(init.body) };
      return response({ ok: true, visible: true, claudeConfigured: true, state: "ok", estimatedSpendUsd: 0, creditUsd: 25, warnAtUsd: 15, consoleBillingUrl: BILLING });
    }
  });
  assert.deepEqual(sent, { url: "/api/ai-assist/provider-status/topped-up", method: "POST", body: { creditUsd: 25 } });
  assert.equal(ok.ok, true);
  assert.equal(ok.status.state, "ok");
  assert.equal(ok.status.creditUsd, 25);

  const refused = await postClaudeToppedUp({ creditUsd: 25, fetchImpl: async () => response({ ok: false, error: "Not available." }, { status: 403 }) });
  assert.deepEqual(refused, { ok: false, error: "Not available." });
  const offline = await postClaudeToppedUp({ creditUsd: 25, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(offline, { ok: false, error: "The top-up could not be saved. Check your connection and try again." });
});
