import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { handleAiAssistRoute } from "../src/server/ai-assistance-routes.ts";
import { RECEIPT_IMAGE_MAX_BYTES } from "../src/server/receipt-read-route.ts";

// POST /api/ai-assist/receipt-read: an image the user explicitly supplied
// is read once by the optional AI provider and discarded. These pin input
// rejection (type, size, mismatched bytes), the no-AI and failure paths,
// the validated DTO, and that nothing but the allowance counter is written.

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
const JPEG_BASE64 = Buffer.from(JPEG).toString("base64");
const TODAY = new Date().toISOString().slice(0, 10);

const MODEL_READ = {
  merchant: "Lumen Grocer Pte Ltd",
  merchantConfidence: "high",
  date: TODAY,
  dateConfidence: "high",
  dateAlternatives: [],
  totalAmount: "21.95",
  currency: "SGD",
  totalConfidence: "high",
  cardDigits: "************2718",
  lineItems: [{ description: "Oat milk 1L", amount: "4.50", quantity: 1 }]
};

function createFakeDb({ quotaChanges = 1 } = {}) {
  const statements = [];
  const statement = (sql) => {
    const self = {
      args: [],
      bind(...values) { self.args = values; return self; },
      async run() { statements.push({ sql, args: self.args }); return { success: true, meta: { changes: /ai_assist_daily_usage/.test(sql) ? quotaChanges : 1 } }; },
      async all() { statements.push({ sql, args: self.args }); return { results: [] }; },
      async first() { statements.push({ sql, args: self.args }); return /ai_assist_daily_usage/.test(sql) ? { used_units: 2 } : null; },
      async raw() { statements.push({ sql, args: self.args }); return []; }
    };
    return self;
  };
  return {
    statements,
    prepare: statement,
    async batch(list) { statements.push({ sql: "batch", args: list.length }); return list.map(() => ({ results: [] })); },
    async exec(sql) { statements.push({ sql, args: [] }); return {}; }
  };
}

function stubWorkersAi(response) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return typeof response === "function" ? response(model, input) : response;
    }
  };
}

const gemmaAnswer = (read) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(read) } }] });

function jsonRequest(body, headers = {}) {
  return new Request("http://127.0.0.1/api/ai-assist/receipt-read", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function multipartRequest(bytes, type) {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), "receipt");
  return new Request("http://127.0.0.1/api/ai-assist/receipt-read", { method: "POST", body: form });
}

async function call(env, request) {
  const response = await handleAiAssistRoute(request, new URL(request.url), env);
  return { status: response.status, payload: await response.json() };
}

test("with AI off or unconfigured the route answers at once without reading the image", async () => {
  for (const env of [{ DB: createFakeDb() }, { DB: createFakeDb(), AI_ASSIST_ENABLED: "true" }]) {
    // A body that is not even JSON proves it was never read.
    const { status, payload } = await call(env, jsonRequest("not json"));
    assert.equal(status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.available, false);
    assert.match(payload.reason, /turned off|not configured/);
    assert.equal(env.DB.statements.length, 0);
  }
});

test("with no Anthropic config, Workers AI reads the receipt into a validated DTO", async (t) => {
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (...args) => { fetchCalls.push(args); throw new Error("no gateway"); });
  const ai = stubWorkersAi(gemmaAnswer(MODEL_READ));
  const env = { DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" };

  const { status, payload } = await call(env, jsonRequest({ image: { mediaType: "image/jpeg", base64: JPEG_BASE64 } }));

  assert.equal(status, 200);
  assert.deepEqual(payload, {
    ok: true,
    available: true,
    provider: "workers-ai",
    remaining: 10,
    receipt: {
      source: "ai",
      merchant: { value: "Lumen Grocer Pte Ltd", confidence: "high" },
      date: { value: TODAY, confidence: "high" },
      total: { amountMinor: 2195, currency: "SGD", confidence: "high" },
      cardLast4: "2718",
      lineItems: [{ description: "Oat milk 1L", amountMinor: 450, quantity: 1 }],
      questions: []
    }
  });
  assert.equal(fetchCalls.length, 0);
  assert.equal(ai.calls[0].input.messages[1].content[1].image_url.url, `data:image/jpeg;base64,${JPEG_BASE64}`);
});

test("a multipart upload is read through Claude and model mistakes come back as questions", async (t) => {
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ ...MODEL_READ, date: "2099-01-01", currency: "XYZ", cardDigits: "5000 0000 0000 3141" }) }]
    }), { status: 200 });
  });
  const env = { DB: createFakeDb(), AI_ASSIST_ENABLED: "true", AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/a/g", AI_GATEWAY_TOKEN: "t" };

  const { status, payload } = await call(env, multipartRequest(PNG, "image/png"));

  assert.equal(status, 200);
  assert.equal(payload.provider, "claude");
  assert.deepEqual(payload.receipt.date, { value: null, confidence: "low" });
  assert.equal(payload.receipt.total.currency, null);
  assert.equal(payload.receipt.cardLast4, "3141");
  assert.deepEqual(payload.receipt.questions, [
    { field: "date", reason: "future_date" },
    { field: "currency", reason: "unsupported_currency" }
  ]);
  const imageBlock = fetchCalls[0].body.messages[0].content[0];
  assert.deepEqual(imageBlock, { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(PNG).toString("base64") } });
});

test("other file types, mismatched bytes and missing images are refused before any AI call", async () => {
  const ai = stubWorkersAi(gemmaAnswer(MODEL_READ));
  const env = { DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" };
  const cases = [
    [multipartRequest(GIF, "image/gif"), 415],
    [jsonRequest({ image: { mediaType: "application/pdf", base64: JPEG_BASE64 } }), 415],
    // Declared PNG, but the bytes are a JPEG.
    [jsonRequest({ image: { mediaType: "image/png", base64: JPEG_BASE64 } }), 415],
    [multipartRequest(GIF, "image/jpeg"), 415],
    [jsonRequest({ image: { mediaType: "image/jpeg", base64: "" } }), 400],
    [jsonRequest({ image: { mediaType: "image/jpeg", base64: "@@not base64@@" } }), 400],
    [jsonRequest({}), 400],
    [jsonRequest("{broken"), 400]
  ];
  for (const [request, expected] of cases) {
    const { status, payload } = await call(env, request);
    assert.equal(status, expected);
    assert.equal(payload.ok, false);
    assert.equal(typeof payload.error, "string");
  }
  assert.equal(ai.calls.length, 0);
  assert.equal(env.DB.statements.length, 0);
});

test("an image over the size cap is refused, by its declared length or by its bytes", async () => {
  const ai = stubWorkersAi(gemmaAnswer(MODEL_READ));
  const env = { DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" };
  const big = new Uint8Array(RECEIPT_IMAGE_MAX_BYTES + 1);
  big.set(JPEG);

  const byLength = await call(env, jsonRequest("{}", { "content-length": String(4 * 1024 * 1024) }));
  assert.equal(byLength.status, 413);

  const byBytes = await call(env, multipartRequest(big, "image/jpeg"));
  assert.equal(byBytes.status, 413);

  const byBase64 = await call(env, jsonRequest({ image: { mediaType: "image/jpeg", base64: Buffer.from(big).toString("base64") } }));
  assert.equal(byBase64.status, 413);

  // Exactly at the cap is accepted.
  const atCap = big.subarray(0, RECEIPT_IMAGE_MAX_BYTES);
  const ok = await call(env, multipartRequest(atCap, "image/jpeg"));
  assert.equal(ok.status, 200);
  assert.equal(ai.calls.length, 1);
});

test("reading a receipt writes nothing but the allowance counter and never logs the image", async (t) => {
  const logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    t.mock.method(console, level, (...args) => logged.push(args));
  }
  const ai = stubWorkersAi(gemmaAnswer(MODEL_READ));
  const env = { DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" };

  const { payload } = await call(env, jsonRequest({ image: { mediaType: "image/jpeg", base64: JPEG_BASE64 } }));

  assert.equal(payload.available, true);
  assert.ok(env.DB.statements.length > 0);
  for (const statement of env.DB.statements) {
    assert.match(statement.sql, /ai_assist_daily_usage/);
    assert.equal(JSON.stringify(statement.args).includes(JPEG_BASE64), false);
  }
  assert.deepEqual(logged, []);
});

test("an exhausted allowance or failing providers return an ordinary unavailable answer", async (t) => {
  const ai = stubWorkersAi(gemmaAnswer(MODEL_READ));
  const spent = await call({ DB: createFakeDb({ quotaChanges: 0 }), AI: ai, AI_ASSIST_ENABLED: "true" }, jsonRequest({ image: { mediaType: "image/jpeg", base64: JPEG_BASE64 } }));
  assert.equal(spent.status, 200);
  assert.equal(spent.payload.available, false);
  assert.match(spent.payload.reason, /allowance has been used/);
  assert.equal(ai.calls.length, 0);

  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 429 }));
  const down = stubWorkersAi(() => { throw new Error("capacity"); });
  const failing = await call({
    DB: createFakeDb(),
    AI: down,
    AI_ASSIST_ENABLED: "true",
    AI_GATEWAY_ACCOUNT_ID: "a",
    AI_GATEWAY_ID: "g",
    ANTHROPIC_API_KEY: "k"
  }, jsonRequest({ image: { mediaType: "image/jpeg", base64: JPEG_BASE64 } }));
  assert.equal(failing.status, 200);
  assert.deepEqual(failing.payload, { ok: true, available: false, reason: "AI is temporarily unavailable.", remaining: 10 });
});

test("a model answer that reads nothing usable is unavailable rather than an empty draft", async () => {
  const ai = stubWorkersAi(gemmaAnswer({ ...MODEL_READ, merchant: null, date: null, totalAmount: null }));
  const { payload } = await call({ DB: createFakeDb(), AI: ai, AI_ASSIST_ENABLED: "true" }, jsonRequest({ image: { mediaType: "image/jpeg", base64: JPEG_BASE64 } }));
  assert.equal(payload.available, false);
  assert.equal("receipt" in payload, false);
});

test("the Worker routes receipt reads and refuses other methods", async () => {
  const post = await worker.fetch(jsonRequest("not json"), { DB: createFakeDb() });
  assert.equal(post.status, 200);
  assert.equal((await post.json()).available, false);

  const get = await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/receipt-read"), { DB: createFakeDb() });
  assert.equal(get.status, 404);
});
