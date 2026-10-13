// Checks the Cloudflare Access token on each request (security review F6,
// docs/audits/ai-security-review.md). Access signs a JWT for every request it
// lets through and sends it as the Cf-Access-Jwt-Assertion header (and the
// CF_Authorization cookie). Verifying it here, RS256 against the team's
// published keys, means the Worker no longer depends on Access being in front
// of every route it can be reached on (a custom domain, a preview URL, a policy
// edit), and the viewer's email comes from a signed token, not a plain header
// anyone could send.
//
// ACCESS_JWT_MODE:
// - unset / "off": nothing is checked (demo, local, tests, the shortcuts
//   Worker). The plain identity header names the viewer, as before.
// - "report": every request is checked and logged in one line, and is
//   served whatever the result. A verified token names the viewer; a failed
//   check falls back to the plain header so nothing changes for the household
//   while the logs prove the setup.
// - "enforce": a request without a valid token is refused (401 JSON for
//   /api/, a plain 403 page otherwise) before any data work.
//
// Static files and page navigations are served by the assets layer and never
// reach the Worker (no run_worker_first; navigations prefer assets since the
// 2025-04-01 compatibility date), so this guards the API.

import { SHORTCUT_ENDPOINT_PATH } from "../domain/app-repository-shortcuts";
import { rememberVerifiedIdentity } from "./access-identity";
import { json } from "./json";

export type AccessJwtMode = "off" | "report" | "enforce";

export interface AccessJwtEnv {
  ACCESS_JWT_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export interface AccessJwtConfig {
  teamDomain: string;
  aud: string;
}

export type AccessFailureReason =
  | "missing"
  | "malformed"
  | "unsupported-algorithm"
  | "unknown-key"
  | "keys-unavailable"
  | "bad-signature"
  | "wrong-audience"
  | "wrong-issuer"
  | "expired"
  | "not-yet-valid"
  | "not-configured";

export type AccessVerification =
  | { ok: true; email: string | undefined }
  | { ok: false; reason: AccessFailureReason };

type LogLevel = "log" | "warn";

export interface AccessJwtDeps {
  fetch?: (input: string) => Promise<Response>;
  now?: () => number;
  log?: (level: LogLevel, line: string) => void;
}

// Seconds of clock difference allowed either side of exp / nbf.
const CLOCK_SKEW_S = 60;
// How long the team's keys are trusted before they are fetched again.
const KEYS_TTL_MS = 10 * 60 * 1000;
// A token signed with a key not in the cache triggers one refetch (Access
// rotated its keys); a second unknown key within this window does not, so a
// stream of made-up key ids cannot turn into a stream of fetches.
const UNKNOWN_KEY_REFETCH_MS = 60 * 1000;
const TOKEN_MAX_LENGTH = 16 * 1024;

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

interface KeySet {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
  refetchedForUnknownAt: number;
}

// Per isolate. CryptoKeys are plain values, safe to share across requests.
const keyCache = new Map<string, KeySet>();
const counts = { ok: 0, fail: 0 };

export function resetAccessKeyCache() {
  keyCache.clear();
  counts.ok = 0;
  counts.fail = 0;
}

export function readAccessJwtMode(env: AccessJwtEnv): AccessJwtMode {
  const mode = env.ACCESS_JWT_MODE?.trim().toLowerCase();
  return mode === "report" || mode === "enforce" ? mode : "off";
}

function readAccessConfig(env: AccessJwtEnv): AccessJwtConfig | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const aud = env.ACCESS_AUD?.trim();
  return teamDomain && aud ? { teamDomain, aud } : null;
}

export function readAccessToken(request: Request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion")?.trim();
  if (header) {
    return header;
  }
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === "CF_Authorization") {
      return part.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

// The Apple Shortcut's endpoint carries its own signed-token check
// (authenticateShortcutRequest) and is called by a phone, not a browser
// signed in to Access.
function isExempt(request: Request, pathname: string) {
  return pathname === SHORTCUT_ENDPOINT_PATH && request.method === "POST";
}

/**
 * Checks the request's Access token when the mode asks for it. Returns a
 * refusal to send (enforce mode only) or null to carry on. A verified token's
 * email becomes the viewer's identity for getAuthenticatedEmail.
 */
export async function checkAccess(request: Request, env: AccessJwtEnv, deps: AccessJwtDeps = {}): Promise<Response | null> {
  const mode = readAccessJwtMode(env);
  if (mode === "off") {
    return null;
  }
  const pathname = new URL(request.url).pathname;
  if (isExempt(request, pathname)) {
    return null;
  }

  const log = deps.log ?? defaultLog;
  const config = readAccessConfig(env);
  const result: AccessVerification = config
    ? await verifyAccessToken(readAccessToken(request), config, deps)
    : { ok: false, reason: "not-configured" };

  if (result.ok) {
    counts.ok += 1;
    rememberVerifiedIdentity(request, result.email);
    if (mode === "report") {
      log("log", `access-jwt mode=${mode} result=ok path=${pathname} email=${result.email ? "yes" : "no"} header=${headerAgreement(request, result.email)} oks=${counts.ok} fails=${counts.fail}`);
    }
    return null;
  }

  counts.fail += 1;
  log("warn", `access-jwt mode=${mode} result=fail reason=${result.reason} path=${pathname} oks=${counts.ok} fails=${counts.fail}`);
  if (mode === "report") {
    // Served as before: the plain header still names the viewer.
    return null;
  }
  if (pathname.startsWith("/api/")) {
    return json({ ok: false, error: "Not signed in." }, 401);
  }
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>Not signed in</title><p>Not signed in. Open Monies Map again to sign in.</p>",
    { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

// Whether the plain header agrees with the token, for the report log only.
function headerAgreement(request: Request, email: string | undefined) {
  const header = request.headers.get("Cf-Access-Authenticated-User-Email")?.trim().toLowerCase();
  if (!header) {
    return "absent";
  }
  return header === email ? "match" : "differs";
}

function defaultLog(level: LogLevel, line: string) {
  if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export async function verifyAccessToken(
  token: string | undefined,
  config: AccessJwtConfig,
  deps: AccessJwtDeps = {}
): Promise<AccessVerification> {
  if (!token) {
    return { ok: false, reason: "missing" };
  }
  const parts = token.length <= TOKEN_MAX_LENGTH ? token.split(".") : [];
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed" };
  }
  const header = decodeJsonPart(parts[0]);
  const payload = decodeJsonPart(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  if (!header || !payload || !signature) {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "RS256") {
    return { ok: false, reason: "unsupported-algorithm" };
  }
  if (typeof header.kid !== "string" || !header.kid) {
    return { ok: false, reason: "malformed" };
  }

  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetch ?? ((input: string) => fetch(input));
  const key = await findSigningKey(config.teamDomain, header.kid, now(), fetchFn);
  if (key === "unavailable") {
    return { ok: false, reason: "keys-unavailable" };
  }
  if (!key) {
    return { ok: false, reason: "unknown-key" };
  }

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify(RS256, key, signature, signed))) {
    return { ok: false, reason: "bad-signature" };
  }

  // Claims are only read once the signature holds.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.aud)) {
    return { ok: false, reason: "wrong-audience" };
  }
  if (payload.iss !== `https://${config.teamDomain}`) {
    return { ok: false, reason: "wrong-issuer" };
  }
  const nowS = now() / 1000;
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_S < nowS) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_S > nowS) {
    return { ok: false, reason: "not-yet-valid" };
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() || undefined : undefined;
  return { ok: true, email };
}

async function findSigningKey(
  teamDomain: string,
  kid: string,
  nowMs: number,
  fetchFn: (input: string) => Promise<Response>
): Promise<CryptoKey | null | "unavailable"> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  let cached = keyCache.get(url);
  let fresh = false;

  if (!cached || nowMs - cached.fetchedAt > KEYS_TTL_MS) {
    const keys = await fetchKeys(url, fetchFn);
    if (keys) {
      cached = { keys, fetchedAt: nowMs, refetchedForUnknownAt: cached?.refetchedForUnknownAt ?? 0 };
      keyCache.set(url, cached);
      fresh = true;
    } else if (!cached) {
      return "unavailable";
    }
    // A failed refresh keeps the last keys rather than locking everyone out.
  }

  const known = cached.keys.get(kid);
  if (known) {
    return known;
  }
  if (fresh || nowMs - cached.refetchedForUnknownAt < UNKNOWN_KEY_REFETCH_MS) {
    return null;
  }
  cached.refetchedForUnknownAt = nowMs;
  const keys = await fetchKeys(url, fetchFn);
  if (!keys) {
    return null;
  }
  keyCache.set(url, { keys, fetchedAt: nowMs, refetchedForUnknownAt: nowMs });
  return keys.get(kid) ?? null;
}

async function fetchKeys(url: string, fetchFn: (input: string) => Promise<Response>) {
  try {
    const response = await fetchFn(url);
    if (!response.ok) {
      return null;
    }
    const body = await response.json() as { keys?: unknown };
    if (!Array.isArray(body.keys)) {
      return null;
    }
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys as Array<JsonWebKey & { kid?: unknown }>) {
      if (jwk?.kty !== "RSA" || typeof jwk.kid !== "string") {
        continue;
      }
      try {
        const { kid, ...material } = jwk;
        keys.set(kid, await crypto.subtle.importKey("jwk", { ...material, alg: "RS256", ext: true }, RS256, false, ["verify"]));
      } catch {
        // One unusable key does not spoil the rest.
      }
    }
    return keys.size ? keys : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(part: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) {
    return null;
  }
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeJsonPart(part: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(part);
  if (!bytes) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
