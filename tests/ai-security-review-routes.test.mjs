// Security review 2026-10 (docs/audits/ai-security-review-2026-10.md):
// F1 cross-site writes, F4 request bodies that are only bounded when the
// client says how long they are, F5 the entry create route's own checks.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { handleAiAssistRoute } from "../src/server/ai-assistance-routes.ts";
import { assertSameDatabase, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";

// ------------------------------------------------------------------- F1

const write = (headers = {}) => new Request("http://127.0.0.1/api/entries/create", {
  method: "POST",
  headers: { "content-type": "text/plain", ...headers },
  body: JSON.stringify({ date: "2026-05-01" })
});

test("F1: a write another site triggered in a signed-in browser is refused before any data work", async () => {
  // No DB at all: the refusal comes before schema or data work.
  for (const headers of [
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { "Sec-Fetch-Site": "cross-site", Origin: "http://127.0.0.1" } // an Origin that matches does not outvote the label
  ]) {
    const response = await worker.fetch(write(headers), {});
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { ok: false, error: "Cross-site requests are not allowed." });
  }
  // The routes read JSON whatever the content type, so a plain form reaches them: still refused.
  const form = new Request("http://127.0.0.1/api/ai-assist/provider-status/topped-up", {
    method: "POST",
    headers: { "content-type": "text/plain", "Sec-Fetch-Site": "cross-site" },
    body: "{\"creditUsd\":25}"
  });
  assert.equal((await worker.fetch(form, { AI_ALERT_EMAILS: "*" })).status, 403);
});

test("F1: this app's own pages, a typed address, and clients that are not browsers still write", async () => {
  // /api/health answers any method before schema work, which keeps this test free of a DB.
  for (const headers of [
    { "Sec-Fetch-Site": "same-origin" },
    { "Sec-Fetch-Site": "none" },
    { Origin: "http://127.0.0.1:5173" }, // a replayed or proxied request: no label, its Origin host is not the Worker's
    {} // curl, the Apple Shortcut, test clients: neither header
  ]) {
    const response = await worker.fetch(new Request("http://127.0.0.1/api/health", { method: "POST", headers }), {});
    assert.equal(response.status, 200, JSON.stringify(headers));
  }
  // A read is never refused: another site cannot read the answer.
  const read = await worker.fetch(new Request("http://127.0.0.1/api/health", { headers: { "Sec-Fetch-Site": "cross-site" } }), {});
  assert.equal(read.status, 200);
});

// ------------------------------------------------------------------- F4

// A body sent without a Content-Length (chunked), so the route's declared-size
// check has nothing to read. `state.pulled` is how much of it the route read.
function chunkedBody(totalBytes, state, chunkBytes = 64 * 1024) {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      state.pulled = sent;
      controller.enqueue(new Uint8Array(size).fill(0x41));
    }
  });
}

function chunkedRequest(path, contentType, totalBytes, state) {
  const request = new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: chunkedBody(totalBytes, state),
    duplex: "half"
  });
  assert.equal(request.headers.get("content-length"), null);
  return request;
}

function aiEnv() {
  const aiCalls = [];
  return {
    aiCalls,
    env: {
      AI_ASSIST_ENABLED: "true",
      AI_ASSIST_DAILY_LIMIT: "100",
      AI: { async run(...args) { aiCalls.push(args); throw new Error("the model must not be called"); } },
      DB: {
        prepare() { throw new Error("no allowance may be reserved for a refused body"); },
        async batch() { throw new Error("no write"); }
      }
    }
  };
}

test("F4: a receipt image or voice clip with no declared length is cut off at its limit, not read whole", async () => {
  const cases = [
    ["/api/ai-assist/receipt-read", "multipart/form-data; boundary=x", 1_572_864],
    ["/api/ai-assist/transcribe", "multipart/form-data; boundary=x", 1_048_576],
    ["/api/ai-assist/receipt-read", "application/json", 1_572_864]
  ];
  for (const [path, type, limit] of cases) {
    const { env, aiCalls } = aiEnv();
    const state = { pulled: 0 };
    const response = await handleAiAssistRoute(chunkedRequest(path, type, 12 * 1024 * 1024, state), new URL(`http://127.0.0.1${path}`), env);
    assert.equal(response.status, 413, `${path} ${type}`);
    assert.equal((await response.json()).ok, false);
    // The route stopped reading near the limit instead of taking all 12 MB.
    assert.ok(state.pulled <= limit * 1.5, `${path} read ${state.pulled} bytes`);
    assert.equal(aiCalls.length, 0);
  }
});

test("F4: the small JSON routes refuse a body far bigger than any real request", async () => {
  for (const path of ["/api/ai-assist/answer", "/api/ai-assist/entry-draft", "/api/ai-assist/plan-draft", "/api/ai-assist/provider-status/topped-up"]) {
    const { env } = aiEnv();
    env.AI_ALERT_EMAILS = "*";
    const state = { pulled: 0 };
    const response = await handleAiAssistRoute(chunkedRequest(path, "application/json", 8 * 1024 * 1024, state), new URL(`http://127.0.0.1${path}`), env);
    assert.equal(response.status, 413, path);
    assert.ok(state.pulled <= 256 * 1024, `${path} read ${state.pulled} bytes`);
  }
  // A normal small request is untouched.
  const { env } = aiEnv();
  const ok = await handleAiAssistRoute(
    new Request("http://127.0.0.1/api/ai-assist/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "" }) }),
    new URL("http://127.0.0.1/api/ai-assist/answer"),
    env
  );
  assert.equal(ok.status, 400);
});

// ------------------------------------------------------------------- F5

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("F5: /api/entries/create refuses a date, amount or text the editors never send, and still saves a real entry", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { payload: reference } = await api("/api/reference-data");
  const account = reference.accounts.find((item) => item.isActive !== false);
  const category = reference.categories?.[0]?.name ?? "Groceries";
  const valid = {
    date: "2026-05-04",
    description: "Cold Storage",
    accountId: account.id,
    categoryName: category,
    amountMinor: 1250,
    entryType: "expense",
    ownershipType: "direct"
  };
  const before = await dumpDatabase(db);

  const refused = [
    ["date", { date: "garbage" }],
    ["date", { date: "2026-02-31" }],
    ["date", { date: 20260504 }],
    ["post date", { postDate: "tomorrow" }],
    ["amount", { amountMinor: 12.5 }],
    ["amount", { amountMinor: 1e15 }],
    ["description", { description: "x".repeat(501) }],
    ["description", { description: 42 }],
    ["note", { note: "n".repeat(2001) }],
    ["note", { note: { text: "hi" } }]
  ];
  for (const [what, patch] of refused) {
    const { status, payload } = await api("/api/entries/create", { ...valid, ...patch });
    assert.equal(status, 400, `${what}: ${JSON.stringify(patch).slice(0, 60)}`);
    assert.equal(payload.ok, false);
  }
  assertSameDatabase(await dumpDatabase(db), before);

  const saved = await api("/api/entries/create", { ...valid, postDate: "2026-05-06", note: "weekly shop", externalReference: "ask:11111111-2222-3333-4444-555555555555" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.equal(saved.payload.created, true);
});

test("F4: the plan draft Save route refuses a body far bigger than any real draft, and a normal Save still reads", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const path = "/api/month-plan/apply-changes";
  const state = { pulled: 0 };
  const response = await worker.fetch(chunkedRequest(path, "application/json", 8 * 1024 * 1024, state), { DB: db, ...template.config.vars });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, error: "The request is too large." });
  assert.ok(state.pulled <= 256 * 1024, `${path} read ${state.pulled} bytes`);
  // A normal body is read: an empty draft reaches the route's own validation, not the size guard.
  const small = await worker.fetch(
    new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month: "", changes: [] }) }),
    { DB: db, ...template.config.vars }
  );
  assert.equal(small.status, 400);
});

test("F4: the older AI routes are bounded the same way, and an oversized body is a 413 whichever route read it", async () => {
  const limits = {
    "/api/ai-assist/monthly-narrative": 64 * 1024,
    "/api/ai-assist/statement-text-fallback": 64 * 1024,
    "/api/ai-assist/transfer-match-ranking": 64 * 1024,
    "/api/ai-assist/import-match-ranking": 256 * 1024,
    "/api/ai-assist/import-explanation": 4 * 1024 * 1024
  };
  for (const [path, limit] of Object.entries(limits)) {
    const { env } = aiEnv();
    const state = { pulled: 0 };
    const response = await handleAiAssistRoute(chunkedRequest(path, "application/json", limit * 3 + 1024 * 1024, state), new URL(`http://127.0.0.1${path}`), env);
    assert.equal(response.status, 413, path);
    assert.deepEqual(await response.json(), { ok: false, error: "The request is too large." });
    assert.ok(state.pulled <= limit + 128 * 1024, `${path} read ${state.pulled} bytes`);
  }
});

test("F4: no server route reads a body without a limit (a new route must use limited-body.ts)", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../src/server/", import.meta.url);
  const offenders = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".ts") || name === "limited-body.ts") continue;
    const source = await readFile(new URL(name, dir), "utf8");
    if (/request\.(json|formData|text|arrayBuffer|blob)\s*[<(]/.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});
