import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { handleAiAssistRoute } from "../src/server/ai-assistance-routes.ts";
import { TRANSCRIBE_AUDIO_MAX_BYTES, TRANSCRIBE_MAX_DURATION_MS, TRANSCRIBE_MODEL } from "../src/server/transcribe-route.ts";

// POST /api/ai-assist/transcribe: the Ask page's voice fallback, used only
// when the browser has no speech recognition of its own. Through the real
// Worker fetch with a fake D1 and a stub AI binding, these pin: disabled and
// unconfigured answers, the shared daily allowance, type, size and duration
// caps checked before any AI call or allowance use, a valid transcript, and
// that nothing is written but the allowance counter and nothing is logged.

function createFakeDb({ quotaChanges = 1, usedUnits = 1 } = {}) {
  const sql = [];
  const statement = (text) => {
    const self = {
      bind() { return self; },
      async run() {
        sql.push(text);
        return { success: true, meta: { changes: /ai_assist_daily_usage/.test(text) ? quotaChanges : 1 } };
      },
      async all() { sql.push(text); return { results: [] }; },
      async first() { sql.push(text); return /ai_assist_daily_usage/.test(text) ? { used_units: usedUnits } : null; },
      async raw() { sql.push(text); return []; }
    };
    return self;
  };
  return {
    sql,
    prepare: (text) => statement(text),
    async batch(statements) { sql.push("batch"); return statements.map(() => ({ results: [] })); },
    async exec(text) { sql.push(text); return {}; }
  };
}

function stubAi(response) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      if (response instanceof Error) {
        throw response;
      }
      return response;
    }
  };
}

// A few bytes that start the way each container starts.
const WEBM_HEAD = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01];
const OGG_HEAD = [...Buffer.from("OggS"), 0x00, 0x02];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function clip(head, size = 2048) {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
}

function box(type, payload) {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(Buffer.from(type), 4);
  bytes.set(payload, 8);
  return bytes;
}

// An MP4 (what iPhone Safari records) with an mvhd box saying how long it is.
function mp4Clip(seconds) {
  const ftyp = box("ftyp", Buffer.from("M4A \0\0\0\0isomM4A "));
  const mvhd = new Uint8Array(100);
  const view = new DataView(mvhd.buffer);
  view.setUint32(12, 1000); // timescale
  view.setUint32(16, Math.round(seconds * 1000)); // duration
  const moov = box("moov", box("mvhd", mvhd));
  const bytes = new Uint8Array(ftyp.length + moov.length + 512);
  bytes.set(ftyp);
  bytes.set(moov, ftyp.length);
  return bytes;
}

async function postAudio(env, { bytes = clip(WEBM_HEAD), type = "audio/webm;codecs=opus", durationMs = "4200", field = "audio" } = {}) {
  const form = new FormData();
  if (bytes) {
    form.append(field, new Blob([bytes], { type }), "voice");
  }
  if (durationMs !== null) {
    form.append("durationMs", durationMs);
  }
  return route(new Request("http://127.0.0.1/api/ai-assist/transcribe", { method: "POST", body: form }), env);
}

// The AI route handler itself, as the Worker calls it after its gateway and
// schema checks, so the fake D1 records only what the route runs.
function route(request, env) {
  return handleAiAssistRoute(request, new URL(request.url), env);
}

const ON = { AI_ASSIST_ENABLED: "true", AI_ASSIST_DAILY_LIMIT: "12" };

// Any console output during a request fails the test: audio and words must
// never reach a log.
async function withoutLogs(run) {
  const names = ["log", "info", "warn", "error", "debug"];
  const original = Object.fromEntries(names.map((name) => [name, console[name]]));
  const written = [];
  for (const name of names) {
    console[name] = (...args) => written.push([name, ...args]);
  }
  try {
    return { result: await run(), written };
  } finally {
    Object.assign(console, original);
  }
}

test("GET says whether the voice fallback is available, without using the allowance", async () => {
  // Through the Worker: the route is reachable where the other AI routes are.
  const off = await (await worker.fetch(new Request("http://127.0.0.1/api/ai-assist/transcribe"), { DB: createFakeDb() })).json();
  assert.deepEqual(off, { ok: true, available: false });

  const db = createFakeDb();
  const ai = stubAi({ text: "unused" });
  const on = await (await route(new Request("http://127.0.0.1/api/ai-assist/transcribe"), { DB: db, AI: ai, ...ON })).json();
  assert.deepEqual(on, { ok: true, available: true, maxSeconds: 30, maxBytes: TRANSCRIBE_AUDIO_MAX_BYTES });
  assert.equal(ai.calls.length, 0);
  assert.deepEqual(db.sql, []);
});

test("with AI turned off or the binding missing, a clip is answered unavailable and nothing is called or written", async () => {
  for (const env of [{ AI_ASSIST_ENABLED: "false", AI: stubAi({ text: "x" }) }, { AI_ASSIST_ENABLED: "true" }]) {
    const db = createFakeDb();
    const response = await postAudio({ DB: db, ...env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.available, false);
    assert.equal(payload.code, "off");
    assert.equal(typeof payload.reason, "string");
    assert.equal(payload.text, undefined);
    assert.equal(env.AI?.calls.length ?? 0, 0);
    assert.deepEqual(db.sql, []);
  }
});

test("a used-up daily allowance answers unavailable without calling AI", async () => {
  const db = createFakeDb({ quotaChanges: 0 });
  const ai = stubAi({ text: "never" });
  const payload = await (await postAudio({ DB: db, AI: ai, ...ON })).json();
  assert.deepEqual(payload, {
    ok: true,
    available: false,
    code: "allowance",
    reason: "Today's optional AI allowance has been used. The normal workflow is still available.",
    remaining: 0
  });
  assert.equal(ai.calls.length, 0);
});

test("a clip that is not audio, or whose bytes disagree with its type, is refused before any AI call or allowance use", async () => {
  const cases = [
    { type: "text/plain", bytes: clip(WEBM_HEAD) },
    { type: "image/png", bytes: clip(PNG_HEAD) },
    { type: "audio/webm", bytes: clip(PNG_HEAD) },
    { type: "audio/mp4", bytes: clip(OGG_HEAD) }
  ];
  for (const item of cases) {
    const db = createFakeDb();
    const ai = stubAi({ text: "never" });
    const response = await postAudio({ DB: db, AI: ai, ...ON }, item);
    assert.equal(response.status, 415, item.type);
    assert.deepEqual(await response.json(), { ok: false, error: "Only a short voice clip can be written down." });
    assert.equal(ai.calls.length, 0);
    assert.equal(db.sql.length, 0);
  }

  const json = await route(new Request("http://127.0.0.1/api/ai-assist/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audio: "AAAA" })
  }), { DB: createFakeDb(), AI: stubAi({ text: "x" }), ...ON });
  assert.equal(json.status, 415);
});

test("a missing or empty clip, or a missing duration, is a 400", async () => {
  for (const options of [{ bytes: null }, { field: "image" }, { bytes: new Uint8Array(0) }, { durationMs: null }, { durationMs: "soon" }]) {
    const ai = stubAi({ text: "never" });
    const response = await postAudio({ DB: createFakeDb(), AI: ai, ...ON }, options);
    assert.equal(response.status, 400, JSON.stringify(options));
    assert.equal((await response.json()).ok, false);
    assert.equal(ai.calls.length, 0);
  }
});

test("a clip over the size or duration cap is a 413, before any AI call or allowance use", async () => {
  const cases = [
    { bytes: clip(WEBM_HEAD, TRANSCRIBE_AUDIO_MAX_BYTES + 1) },
    { durationMs: String(TRANSCRIBE_MAX_DURATION_MS + 1) },
    // The MP4's own header says 45 s, whatever the browser declared.
    { type: "audio/mp4", bytes: mp4Clip(45), durationMs: "9000" }
  ];
  for (const item of cases) {
    const db = createFakeDb();
    const ai = stubAi({ text: "never" });
    const response = await postAudio({ DB: db, AI: ai, ...ON }, item);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { ok: false, error: "The voice clip is too long. Keep it under 30 seconds." });
    assert.equal(ai.calls.length, 0);
    assert.equal(db.sql.length, 0);
  }
});

test("a valid clip is written down once: 1 allowance unit, the speech model, the words back, nothing else stored or logged", async () => {
  const db = createFakeDb({ usedUnits: 5 });
  const ai = stubAi({ text: "  Koufu lunch\n twelve fifty  ", word_count: 4, transcription_info: { duration: 4.1 } });
  const bytes = clip(WEBM_HEAD);
  const { result: response, written } = await withoutLogs(() => postAudio({ DB: db, AI: ai, ...ON }, { bytes }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, available: true, text: "Koufu lunch twelve fifty", remaining: 7 });

  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, TRANSCRIBE_MODEL);
  assert.equal(TRANSCRIBE_MODEL, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(ai.calls[0].input.audio, Buffer.from(bytes).toString("base64"));
  assert.equal(ai.calls[0].input.task, "transcribe");
  assert.equal(ai.calls[0].input.language, "en");

  // The only statements are the allowance upsert and its read-back.
  assert.equal(db.sql.length, 2);
  assert.ok(db.sql.every((text) => /ai_assist_daily_usage/.test(text)));
  assert.match(db.sql[0], /INSERT INTO ai_assist_daily_usage/);
  assert.deepEqual(written, []);
});

test("an MP4 clip from iPhone Safari within the cap is accepted", async () => {
  const ai = stubAi({ text: "Grab to work eighteen dollars" });
  const payload = await (await postAudio({ DB: createFakeDb(), AI: ai, ...ON }, { type: "audio/mp4", bytes: mp4Clip(6), durationMs: "6000" })).json();
  assert.equal(payload.available, true);
  assert.equal(payload.text, "Grab to work eighteen dollars");
});

test("a long transcript is capped, and an empty or failing answer is unavailable with the allowance spent", async () => {
  const long = await (await postAudio({ DB: createFakeDb(), AI: stubAi({ text: "word ".repeat(400) }), ...ON })).json();
  assert.equal(long.available, true);
  assert.ok(long.text.length <= 500);

  for (const response of [{ text: "   " }, { nothing: true }, null, new Error("capacity")]) {
    const db = createFakeDb();
    const { result, written } = await withoutLogs(async () => (await postAudio({ DB: db, AI: stubAi(response), ...ON })).json());
    assert.equal(result.ok, true);
    assert.equal(result.available, false);
    assert.equal(result.code, "failed");
    assert.equal(result.text, undefined);
    assert.ok(db.sql.some((text) => /INSERT INTO ai_assist_daily_usage/.test(text)));
    assert.deepEqual(written, []);
  }
});
