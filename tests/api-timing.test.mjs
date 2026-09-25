import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { ensureDemoSchemaTimed } from "../src/domain/app-repository-schema.ts";
import { buildServerTimingHeader, timeInitialization } from "../src/server/server-timing.ts";

// A permissive D1 stand-in: every statement succeeds with empty results.
// `failFirst` rejects that many statements before behaving; `delayMs` makes
// each statement take real time so wall-clock timings are non-zero.
function createFakeDb({ failFirst = 0, delayMs = 0, alwaysFail = false } = {}) {
  let calls = 0;
  const settle = async (value) => {
    calls += 1;
    if (alwaysFail || calls <= failFirst) {
      throw new Error("D1 unavailable");
    }
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return value;
  };
  const statement = {
    bind() { return statement; },
    run() { return settle({ success: true, meta: {} }); },
    all() { return settle({ results: [] }); },
    first() { return settle(null); },
    raw() { return settle([]); }
  };
  return {
    get calls() { return calls; },
    prepare() { return statement; },
    batch(statements) { return settle(statements.map(() => ({ results: [] }))); },
    exec() { return settle({}); }
  };
}

function parseServerTiming(header) {
  return Object.fromEntries((header ?? "").split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...params] = part.split(";");
    const entry = {};
    for (const param of params) {
      const [key, value] = param.split("=");
      entry[key] = key === "dur" ? Number(value) : value.replaceAll("\"", "");
    }
    return [name, entry];
  }));
}

async function request(env, path, init) {
  return worker.fetch(new Request(`http://127.0.0.1${path}`, init), env);
}

async function quietly(run) {
  const original = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.error = original.error;
    console.warn = original.warn;
  }
}

test("the header lists app, init and total, and leaves out a missing app time", () => {
  assert.equal(
    buildServerTimingHeader({ appMs: 12, initMs: 3, initCold: true, totalMs: 20 }),
    "app;dur=12, init;dur=3;desc=\"cold\", total;dur=20"
  );
  assert.equal(
    buildServerTimingHeader({ appMs: 0, initMs: 0, initCold: false, totalMs: 0 }),
    "app;dur=0, init;dur=0;desc=\"warm\", total;dur=0"
  );
  assert.equal(
    buildServerTimingHeader({ initMs: 7, initCold: true, totalMs: 9 }),
    "init;dur=7;desc=\"cold\", total;dur=9"
  );
});

test("initialization timing uses the injected clock and reports cold or failure", async () => {
  let now = 1_000;
  const clock = () => now;
  const ok = await timeInitialization(async () => { now += 40; return { cold: true }; }, clock);
  assert.deepEqual(ok, { ok: true, initMs: 40, cold: true });

  const warm = await timeInitialization(async () => ({ cold: false }), clock);
  assert.deepEqual(warm, { ok: true, initMs: 0, cold: false });

  const error = new Error("D1 unavailable");
  const failed = await timeInitialization(async () => { now += 15; throw error; }, clock);
  assert.deepEqual(failed, { ok: false, initMs: 15, cold: true, error });
});

test("schema initialization is cold once per database, joined while pending, and retried after failure", async () => {
  const db = createFakeDb();
  const [first, joined] = await Promise.all([ensureDemoSchemaTimed(db), ensureDemoSchemaTimed(db)]);
  assert.deepEqual(first, { cold: true });
  assert.deepEqual(joined, { cold: false });
  const callsAfterFirst = db.calls;
  assert.deepEqual(await ensureDemoSchemaTimed(db), { cold: false });
  assert.equal(db.calls, callsAfterFirst, "a warm call runs no statements");

  const flaky = createFakeDb({ failFirst: 1 });
  await assert.rejects(ensureDemoSchemaTimed(flaky), /D1 unavailable/);
  assert.deepEqual(await ensureDemoSchemaTimed(flaky), { cold: true });
  assert.deepEqual(await ensureDemoSchemaTimed(flaky), { cold: false });
});

test("page APIs report init and total beside the unchanged app time, with identical bodies", async () => {
  const env = { DB: createFakeDb({ delayMs: 2 }) };
  const cold = await request(env, "/api/imports-page");
  assert.equal(cold.status, 200);
  const coldTiming = parseServerTiming(cold.headers.get("server-timing"));
  assert.deepEqual(Object.keys(coldTiming), ["app", "init", "total"]);
  assert.equal(coldTiming.init.desc, "cold");
  assert.ok(coldTiming.init.dur > 0, "cold initialization waited on D1");
  assert.ok(coldTiming.total.dur >= coldTiming.init.dur + coldTiming.app.dur);
  // The existing budget check reads the first dur, which must stay the app time.
  assert.equal(Number(cold.headers.get("server-timing").match(/dur=([0-9.]+)/)[1]), coldTiming.app.dur);
  const coldBody = await cold.text();
  assert.equal(coldBody, JSON.stringify(JSON.parse(coldBody), null, 2));
  assert.equal(cold.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(cold.headers.get("cache-control"), "no-store");

  const warm = await request(env, "/api/imports-page");
  const warmTiming = parseServerTiming(warm.headers.get("server-timing"));
  assert.equal(warmTiming.init.desc, "warm");
  assert.ok(warmTiming.total.dur >= warmTiming.init.dur + warmTiming.app.dur);
  const withoutClock = (text) => text.replace(/"generatedAt": "[^"]+"/g, "\"generatedAt\": \"\"");
  assert.equal(withoutClock(await warm.text()), withoutClock(coldBody));
});

test("every page API carries the three metrics", async () => {
  const env = { DB: createFakeDb() };
  const paths = [
    "/api/app-shell",
    "/api/reference-data",
    "/api/entries-shell?view=household&month=2026-05",
    "/api/entries-page?view=household&month=2026-05",
    "/api/summary-page?view=household&month=2026-05",
    "/api/summary-account-pills?view=household",
    "/api/month-page?view=household&month=2026-05",
    "/api/splits-page?view=household&month=2026-05",
    "/api/imports-page",
    "/api/settings-page?view=household"
  ];
  await quietly(async () => {
    for (const path of paths) {
      const response = await request(env, path);
      assert.equal(response.status, 200, path);
      assert.deepEqual(Object.keys(parseServerTiming(response.headers.get("server-timing"))), ["app", "init", "total"], path);
    }
  });
});

test("an initialization failure returns a 500 JSON with timing, and the next request initializes again", async () => {
  const env = { DB: createFakeDb({ failFirst: 1 }) };
  const failed = await quietly(() => request(env, "/api/imports-page"));
  assert.equal(failed.status, 500);
  const body = await failed.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "Initialization failed");
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(body.message, undefined, "no internal error text is returned");
  const timing = parseServerTiming(failed.headers.get("server-timing"));
  assert.deepEqual(Object.keys(timing), ["init", "total"]);
  assert.equal(timing.init.desc, "cold");

  const retried = await request(env, "/api/imports-page");
  assert.equal(retried.status, 200);
  assert.equal(parseServerTiming(retried.headers.get("server-timing")).init.desc, "cold");
});

test("health and the shortcut gateway answer before initialization and carry no timing", async () => {
  const env = { DB: createFakeDb({ alwaysFail: true }) };
  const health = await request(env, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("server-timing"), null);

  const gatewayEnv = { DB: createFakeDb({ alwaysFail: true }), SHORTCUT_API_ONLY: "true" };
  const hidden = await request(gatewayEnv, "/api/imports-page");
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get("server-timing"), null);
  const wrongMethod = await request(gatewayEnv, "/api/shortcuts/entries/create");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  assert.equal(env.DB.calls + gatewayEnv.DB.calls, 0, "no statement ran");
});
