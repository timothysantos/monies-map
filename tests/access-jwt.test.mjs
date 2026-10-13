// Security review F6 (docs/audits/ai-security-review.md): the Worker checks
// the Cloudflare Access token itself (RS256 against the team's keys) and takes
// the viewer's email from it, instead of trusting the plain identity header.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { getAuthenticatedEmail } from "../src/server/access-identity.ts";
import {
  checkAccess,
  readAccessJwtMode,
  resetAccessKeyCache,
  verifyAccessToken
} from "../src/server/access-jwt.ts";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

const TEAM = "monies-map.cloudflareaccess.com";
const AUD = "ba1c793a22b98b1c6f443294bd369b69d3f32a934d42556ded11053002e36364";
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;
const NOW_S = Date.UTC(2026, 9, 13, 4, 0, 0) / 1000;
const config = { teamDomain: TEAM, aud: AUD };

const encoder = new TextEncoder();
const base64url = (bytes) => Buffer.from(bytes).toString("base64url");
const jsonPart = (value) => base64url(encoder.encode(JSON.stringify(value)));

async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid } };
}

const keyA = await makeKey("kid-a");
const keyB = await makeKey("kid-b");
const keyStranger = await makeKey("kid-a"); // same kid, different key: a forged signature

function claims(overrides = {}) {
  return {
    aud: [AUD],
    email: "Owner@Example.com",
    exp: NOW_S + 3600,
    iat: NOW_S - 60,
    nbf: NOW_S - 60,
    iss: `https://${TEAM}`,
    sub: "user-1",
    type: "app",
    ...overrides
  };
}

async function sign(key, payload = claims(), header = {}) {
  const head = jsonPart({ alg: "RS256", kid: key.kid, typ: "JWT", ...header });
  const body = jsonPart(payload);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, encoder.encode(`${head}.${body}`));
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

// A stand-in for the team's certs endpoint that counts its calls.
function certsServer(...keySets) {
  const server = {
    calls: 0,
    fetch: async (input) => {
      assert.equal(String(input), CERTS_URL);
      const keys = keySets[Math.min(server.calls, keySets.length - 1)];
      server.calls += 1;
      return new Response(JSON.stringify({ keys: keys.map((key) => key.jwk) }), { headers: { "content-type": "application/json" } });
    }
  };
  return server;
}

const deps = (server, nowS = NOW_S) => ({ fetch: server.fetch, now: () => nowS * 1000, log: () => {} });

// Captures the one-line logs instead of printing them.
function logSink() {
  const lines = [];
  return { lines, log: (level, line) => lines.push({ level, line }) };
}

const PROD_ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

function apiRequest(path, headers = {}) {
  return new Request(`https://monies-map.example.workers.dev${path}`, { headers });
}

test.beforeEach(() => resetAccessKeyCache());

// ------------------------------------------------------------------ token

test("a token Access signed for this app passes and carries the viewer's email", async () => {
  const server = certsServer([keyA]);
  const result = await verifyAccessToken(await sign(keyA), config, deps(server));
  assert.deepEqual(result, { ok: true, email: "owner@example.com" });
  // The team's keys are cached: a second token needs no new fetch.
  assert.deepEqual(await verifyAccessToken(await sign(keyA, claims({ email: "joyce@example.com" })), config, deps(server)), { ok: true, email: "joyce@example.com" });
  assert.equal(server.calls, 1);
});

test("a token for another app, another team, out of date, forged or missing fails with its reason", async () => {
  const server = certsServer([keyA]);
  const cases = [
    ["wrong-audience", await sign(keyA, claims({ aud: ["another-app"] }))],
    ["wrong-issuer", await sign(keyA, claims({ iss: "https://someone-else.cloudflareaccess.com" }))],
    ["expired", await sign(keyA, claims({ exp: NOW_S - 120 }))],
    ["not-yet-valid", await sign(keyA, claims({ nbf: NOW_S + 600 }))],
    ["bad-signature", await sign(keyStranger)],
    ["bad-signature", (await sign(keyA)).replace(/\.[^.]+\./, `.${jsonPart(claims({ email: "intruder@example.com" }))}.`)],
    ["unsupported-algorithm", await sign(keyA, claims(), { alg: "HS256" })],
    ["malformed", "not-a-token"],
    ["missing", undefined]
  ];
  for (const [reason, token] of cases) {
    assert.deepEqual(await verifyAccessToken(token, config, deps(server)), { ok: false, reason }, reason);
  }
});

test("a small clock difference is allowed either side of the token's window", async () => {
  const server = certsServer([keyA]);
  assert.equal((await verifyAccessToken(await sign(keyA, claims({ exp: NOW_S - 30 })), config, deps(server))).ok, true);
  assert.equal((await verifyAccessToken(await sign(keyA, claims({ nbf: NOW_S + 30 })), config, deps(server))).ok, true);
  // A single string aud is accepted as well as a list.
  assert.equal((await verifyAccessToken(await sign(keyA, claims({ aud: AUD })), config, deps(server))).ok, true);
});

test("a rotated signing key is fetched once; an unknown key does not refetch on every request", async () => {
  const server = certsServer([keyA], [keyA, keyB]);
  assert.equal((await verifyAccessToken(await sign(keyA), config, deps(server))).ok, true);
  assert.equal(server.calls, 1);

  // Access started signing with kid-b: one refetch picks it up.
  assert.equal((await verifyAccessToken(await sign(keyB), config, deps(server))).ok, true);
  assert.equal(server.calls, 2);
  assert.equal((await verifyAccessToken(await sign(keyB), config, deps(server))).ok, true);
  assert.equal(server.calls, 2);

  // A made-up kid straight after: refused without another fetch.
  const unknown = await makeKey("kid-unknown");
  assert.deepEqual(await verifyAccessToken(await sign(unknown), config, deps(server)), { ok: false, reason: "unknown-key" });
  assert.equal(server.calls, 2);
});

test("the cached keys expire and are fetched again; an unreachable certs endpoint keeps the last keys", async () => {
  let up = true;
  const server = certsServer([keyA]);
  const flaky = { fetch: async (input) => (up ? server.fetch(input) : new Response("down", { status: 503 })) };
  assert.equal((await verifyAccessToken(await sign(keyA), config, deps(flaky))).ok, true);
  assert.equal(server.calls, 1);

  const later = NOW_S + 60 * 60;
  assert.equal((await verifyAccessToken(await sign(keyA, claims({ exp: later + 600 })), config, deps(flaky, later))).ok, true);
  assert.equal(server.calls, 2);

  up = false;
  const muchLater = later + 60 * 60;
  assert.equal((await verifyAccessToken(await sign(keyA, claims({ exp: muchLater + 600 })), config, deps(flaky, muchLater))).ok, true);

  resetAccessKeyCache();
  assert.deepEqual(await verifyAccessToken(await sign(keyA), config, deps(flaky)), { ok: false, reason: "keys-unavailable" });
});

// ------------------------------------------------------------------ mode

test("the mode is off unless set to report or enforce", () => {
  assert.equal(readAccessJwtMode({}), "off");
  assert.equal(readAccessJwtMode({ ACCESS_JWT_MODE: "off" }), "off");
  assert.equal(readAccessJwtMode({ ACCESS_JWT_MODE: "Report" }), "report");
  assert.equal(readAccessJwtMode({ ACCESS_JWT_MODE: " enforce " }), "enforce");
  assert.equal(readAccessJwtMode({ ACCESS_JWT_MODE: "yes" }), "off");
});

test("enforce: a request without a valid token is refused, 401 JSON for the API and a plain 403 page otherwise", async () => {
  const server = certsServer([keyA]);
  const env = { ...PROD_ENV, ACCESS_JWT_MODE: "enforce" };
  const failures = [
    {},
    { "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ aud: ["another-app"] })) },
    { "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ iss: "https://evil.cloudflareaccess.com" })) },
    { "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ exp: NOW_S - 600 })) },
    { "Cf-Access-Jwt-Assertion": await sign(keyStranger) },
    // The plain identity header alone is not a sign-in.
    { "Cf-Access-Authenticated-User-Email": "owner@example.com" }
  ];
  for (const headers of failures) {
    const sink = logSink();
    const response = await checkAccess(apiRequest("/api/app-shell", headers), env, { ...deps(server), log: sink.log });
    assert.equal(response?.status, 401, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { ok: false, error: "Not signed in." });
    assert.equal(sink.lines.length, 1);
    assert.equal(sink.lines[0].level, "warn");
    assert.match(sink.lines[0].line, /^access-jwt mode=enforce result=fail reason=[a-z-]+ path=\/api\/app-shell /);
  }

  const page = await checkAccess(apiRequest("/some/page"), env, deps(server));
  assert.equal(page?.status, 403);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await page.text(), /Not signed in/);
});

test("report: a failed check is logged with a running count but the request is still served", async () => {
  const server = certsServer([keyA]);
  const env = { ...PROD_ENV, ACCESS_JWT_MODE: "report" };
  const sink = logSink();
  const run = (headers) => checkAccess(apiRequest("/api/app-shell", headers), env, { ...deps(server), log: sink.log });

  assert.equal(await run({}), null);
  assert.equal(await run({ "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ aud: ["x"] })) }), null);
  assert.equal(await run({ "Cf-Access-Jwt-Assertion": await sign(keyA) }), null);

  assert.equal(sink.lines.length, 3);
  assert.equal(sink.lines[0].level, "warn");
  assert.match(sink.lines[0].line, /^access-jwt mode=report result=fail reason=missing path=\/api\/app-shell .*fails=1/);
  assert.match(sink.lines[1].line, /reason=wrong-audience .*fails=2/);
  assert.equal(sink.lines[2].level, "log");
  assert.match(sink.lines[2].line, /^access-jwt mode=report result=ok path=\/api\/app-shell email=yes/);
  // The email itself is never logged.
  assert.ok(sink.lines.every(({ line }) => !line.includes("@")));
});

test("the CF_Authorization cookie is read when the header is absent", async () => {
  const server = certsServer([keyA]);
  const env = { ...PROD_ENV, ACCESS_JWT_MODE: "enforce" };
  const token = await sign(keyA, claims({ email: "joyce@example.com" }));
  const request = apiRequest("/api/app-shell", { cookie: `theme=dark; CF_Authorization=${token}; other=1` });
  assert.equal(await checkAccess(request, env, deps(server)), null);
  assert.equal(getAuthenticatedEmail(request), "joyce@example.com");
});

test("with verification on, the email comes from the token and the plain header is ignored", async () => {
  const server = certsServer([keyA]);
  for (const mode of ["report", "enforce"]) {
    const env = { ...PROD_ENV, ACCESS_JWT_MODE: mode };
    const request = apiRequest("/api/app-shell", {
      "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ email: "joyce@example.com" })),
      "Cf-Access-Authenticated-User-Email": "owner@example.com"
    });
    assert.equal(await checkAccess(request, env, deps(server)), null, mode);
    assert.equal(getAuthenticatedEmail(request), "joyce@example.com", mode);
  }
  // A verified token without an email (an Access service token) is no viewer, whatever the header says.
  const env = { ...PROD_ENV, ACCESS_JWT_MODE: "enforce" };
  const service = apiRequest("/api/app-shell", {
    "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ email: undefined, common_name: "svc" })),
    "Cf-Access-Authenticated-User-Email": "owner@example.com"
  });
  assert.equal(await checkAccess(service, env, deps(server)), null);
  assert.equal(getAuthenticatedEmail(service), undefined);
});

test("enforce with the team or app tag missing refuses rather than letting everyone in", async () => {
  const sink = logSink();
  const response = await checkAccess(apiRequest("/api/app-shell"), { ACCESS_JWT_MODE: "enforce" }, { ...deps(certsServer([keyA])), log: sink.log });
  assert.equal(response?.status, 401);
  assert.match(sink.lines[0].line, /reason=not-configured/);
});

test("off (demo, local, tests, the shortcuts Worker): nothing is checked and the header still names the viewer", async () => {
  const server = certsServer([keyA]);
  const sink = logSink();
  for (const env of [{}, { ACCESS_JWT_MODE: "off", ...PROD_ENV }, { APP_ENVIRONMENT: "demo" }]) {
    const request = apiRequest("/api/app-shell", { "Cf-Access-Authenticated-User-Email": "Owner@Example.com" });
    assert.equal(await checkAccess(request, env, { ...deps(server), log: sink.log }), null);
    assert.equal(getAuthenticatedEmail(request), "owner@example.com");
  }
  assert.equal(server.calls, 0);
  assert.equal(sink.lines.length, 0);
});

test("the token-authenticated Shortcut endpoint keeps its own check and is not asked for an Access token", async () => {
  const server = certsServer([keyA]);
  const env = { ...PROD_ENV, ACCESS_JWT_MODE: "enforce" };
  const sink = logSink();
  const shortcut = new Request("https://monies-map.example.workers.dev/api/shortcuts/entries/create", { method: "POST", body: "{}" });
  assert.equal(await checkAccess(shortcut, env, { ...deps(server), log: sink.log }), null);
  assert.equal(sink.lines.length, 0);
  // Only the POST it serves: any other method on that path is still checked.
  const get = await checkAccess(apiRequest("/api/shortcuts/entries/create"), env, deps(server));
  assert.equal(get?.status, 401);
});

// ------------------------------------------------------------ through fetch

test("through the Worker: enforce refuses before any data work; off and report still serve", async (t) => {
  const realFetch = globalThis.fetch;
  const server = certsServer([keyA]);
  globalThis.fetch = server.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});

  // No DB binding: /api/health answers before schema work, so a refusal must come first.
  const refused = await worker.fetch(apiRequest("/api/health"), { ...PROD_ENV, ACCESS_JWT_MODE: "enforce" });
  assert.equal(refused.status, 401);
  assert.deepEqual(await refused.json(), { ok: false, error: "Not signed in." });

  const reported = await worker.fetch(apiRequest("/api/health"), { ...PROD_ENV, ACCESS_JWT_MODE: "report" });
  assert.equal(reported.status, 200);
  assert.equal((await worker.fetch(apiRequest("/api/health"), {})).status, 200);

  const signedIn = await worker.fetch(apiRequest("/api/health", { "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ exp: Math.floor(Date.now() / 1000) + 600, nbf: undefined, iat: undefined })) }), { ...PROD_ENV, ACCESS_JWT_MODE: "enforce" });
  assert.equal(signedIn.status, 200);
});

test("through the Worker: a spoofed identity header does not unlock the owner's credit status", async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = certsServer([keyA]).fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  t.mock.method(console, "log", () => {});

  const template = await createSeededTemplate();
  t.after(() => template.dispose());
  const { db } = await openSeededDatabase(t, template);
  const env = { ...template.config.vars, DB: db, AI_ALERT_EMAILS: "owner@example.com", ...PROD_ENV, ACCESS_JWT_MODE: "enforce" };
  const nowS = Math.floor(Date.now() / 1000);
  const response = await worker.fetch(apiRequest("/api/ai-assist/provider-status", {
    "Cf-Access-Jwt-Assertion": await sign(keyA, claims({ email: "joyce@example.com", exp: nowS + 600, nbf: nowS - 60 })),
    "Cf-Access-Authenticated-User-Email": "owner@example.com"
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, visible: false });
});
