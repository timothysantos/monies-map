import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  WARMUP_LIMITS,
  buildVisitKey,
  evaluateWarmup,
  selectWarmupCandidates,
  selectWarmupMode
} from "../src/client/route-warmup-policy.js";

const NOW = 1_000_000;

// An input that every gate allows; each test changes exactly what it checks.
function input({ mode = "desktop", page = {}, work = {}, visit = {}, candidate = {}, ...rest } = {}) {
  return {
    mode,
    now: NOW,
    page: { visible: true, online: true, saveData: false, effectiveType: "4g", ...page },
    work: { ready: true, busy: false, requiredCount: 0, ...work },
    quietSince: NOW - 10_000,
    visit: { moduleStarts: 0, dataStarts: 0, lastDataStartAt: null, ...visit },
    recentModuleStarts: [],
    moduleInFlight: false,
    dataInFlight: false,
    recentRequiredDurationMs: 200,
    candidate: {
      kind: "module",
      routeId: "entries",
      trigger: "auto",
      alreadyLoaded: false,
      missingBytes: 40_000,
      admission: { responseBytes: 20_000, handlerMs: 100 },
      ...candidate
    },
    ...rest
  };
}

const moduleCandidate = (patch = {}) => ({ kind: "module", ...patch });
const dataCandidate = (patch = {}) => ({ kind: "data", ...patch });

test("the baseline inputs are allowed in both modes, for code and data", () => {
  for (const mode of ["desktop", "mobile"]) {
    assert.deepEqual(evaluateWarmup(input({ mode })), { allowed: true, reason: "ok" });
    assert.deepEqual(evaluateWarmup(input({ mode, candidate: dataCandidate() })), { allowed: true, reason: "ok" });
  }
});

// Every denial on its own: exactly one field differs from an allowed input.
for (const [reason, patch] of [
  ["invalid-input", { mode: "tablet" }],
  ["hidden", { page: { visible: false } }],
  ["offline", { page: { online: false } }],
  ["save-data", { page: { saveData: true } }],
  ["slow-connection", { mode: "mobile", page: { effectiveType: "3g" } }],
  ["not-ready", { work: { ready: false } }],
  ["busy", { work: { busy: true } }],
  ["required-work", { work: { requiredCount: 1 } }],
  ["already-loaded", { candidate: moduleCandidate({ alreadyLoaded: true }) }],
  ["forbidden-route", { candidate: moduleCandidate({ routeId: "imports" }) }],
  ["quiet-period", { quietSince: NOW - 100 }],
  ["module-in-flight", { moduleInFlight: true }],
  ["visit-module-budget", { visit: { moduleStarts: 1 } }],
  ["unknown-cost", { mode: "mobile", candidate: moduleCandidate({ missingBytes: null }) }],
  ["over-byte-cap", { mode: "mobile", candidate: moduleCandidate({ missingBytes: 50_001 }) }],
  ["rate-limit", { mode: "mobile", recentModuleStarts: [NOW - 30_000, NOW - 10_000] }],
  ["hover-on-mobile", { mode: "mobile", candidate: moduleCandidate({ trigger: "hover" }) }],
  ["data-needs-auto", { candidate: dataCandidate({ trigger: "pointerdown" }) }],
  ["data-in-flight", { candidate: dataCandidate(), dataInFlight: true }],
  ["module-before-data", { mode: "mobile", candidate: dataCandidate(), moduleInFlight: true }],
  ["visit-data-budget", { candidate: dataCandidate(), visit: { dataStarts: 2 } }],
  ["data-spacing", { candidate: dataCandidate(), visit: { dataStarts: 1, lastDataStartAt: NOW - 1_000 } }],
  ["connection-not-4g", { mode: "mobile", candidate: dataCandidate(), page: { effectiveType: null } }],
  ["recent-required-slow", { mode: "mobile", candidate: dataCandidate(), recentRequiredDurationMs: 501 }],
  ["not-admitted", { mode: "mobile", candidate: dataCandidate({ admission: null }) }],
  ["over-data-cap", { mode: "mobile", candidate: dataCandidate({ admission: { responseBytes: 50_001, handlerMs: 100 } }) }]
]) {
  test(`warmup is denied with ${reason}`, () => {
    assert.deepEqual(evaluateWarmup(input(patch)), { allowed: false, reason });
  });
}

test("malformed or incomplete input fails closed", () => {
  assert.equal(evaluateWarmup(undefined).reason, "invalid-input");
  assert.equal(evaluateWarmup({ ...input(), page: undefined }).reason, "invalid-input");
  assert.equal(evaluateWarmup({ ...input(), now: Number.NaN }).reason, "invalid-input");
  assert.equal(evaluateWarmup(input({ candidate: { trigger: "swipe" } })).reason, "invalid-input");
  assert.equal(evaluateWarmup(input({ candidate: { kind: "chart" } })).reason, "invalid-input");
});

test("safety gates apply to link intent too; actual navigation never asks this policy", () => {
  for (const trigger of ["hover", "focus", "pointerdown"]) {
    assert.equal(evaluateWarmup(input({ page: { saveData: true }, candidate: moduleCandidate({ trigger }) })).reason, "save-data");
    assert.equal(evaluateWarmup(input({ work: { busy: true }, candidate: moduleCandidate({ trigger }) })).reason, "busy");
  }
});

test("mobile treats missing connection information as code-only", () => {
  const unknownConnection = { mode: "mobile", page: { effectiveType: null } };
  assert.deepEqual(evaluateWarmup(input(unknownConnection)), { allowed: true, reason: "ok" });
  assert.equal(evaluateWarmup(input({ ...unknownConnection, candidate: dataCandidate() })).reason, "connection-not-4g");
  assert.equal(evaluateWarmup(input({ mode: "mobile", page: { effectiveType: "slow-2g" } })).reason, "slow-connection");
  assert.equal(evaluateWarmup(input({ mode: "mobile", page: { effectiveType: "2g" } })).reason, "slow-connection");
  // Desktop does not read connection type at all.
  assert.equal(evaluateWarmup(input({ page: { effectiveType: "3g" }, candidate: dataCandidate() })).allowed, true);
});

test("hybrid and unknown devices use the conservative mobile policy", () => {
  assert.equal(selectWarmupMode({ narrowViewport: false, coarsePointer: false }), "desktop");
  assert.equal(selectWarmupMode({ narrowViewport: false, coarsePointer: true }), "mobile");
  assert.equal(selectWarmupMode({ narrowViewport: true, coarsePointer: false }), "mobile");
  assert.equal(selectWarmupMode({ narrowViewport: null, coarsePointer: false }), "mobile");
  assert.equal(selectWarmupMode({ narrowViewport: false, coarsePointer: null }), "mobile");
  assert.equal(selectWarmupMode(), "mobile");
});

test("mobile module byte cap: 49,999 and 50,000 pass, 50,001 is denied", () => {
  const bytes = (missingBytes) => evaluateWarmup(input({ mode: "mobile", candidate: moduleCandidate({ missingBytes }) }));
  assert.equal(bytes(49_999).allowed, true);
  assert.equal(bytes(50_000).allowed, true);
  assert.equal(bytes(50_001).reason, "over-byte-cap");
  // Desktop has no byte cap and allows unknown cost.
  assert.equal(evaluateWarmup(input({ candidate: moduleCandidate({ missingBytes: 500_000 }) })).allowed, true);
  assert.equal(evaluateWarmup(input({ candidate: moduleCandidate({ missingBytes: null }) })).allowed, true);
});

test("mobile data handler cap: 249 and 250 ms pass, 251 is denied; bytes likewise", () => {
  const handler = (handlerMs) => evaluateWarmup(input({ mode: "mobile", candidate: dataCandidate({ admission: { responseBytes: 1, handlerMs } }) }));
  assert.equal(handler(249).allowed, true);
  assert.equal(handler(250).allowed, true);
  assert.equal(handler(251).reason, "over-data-cap");
  const bytes = (responseBytes) => evaluateWarmup(input({ mode: "mobile", candidate: dataCandidate({ admission: { responseBytes, handlerMs: 1 } }) }));
  assert.equal(bytes(50_000).allowed, true);
  assert.equal(bytes(50_001).reason, "over-data-cap");
});

test("mobile data needs a recent successful required request of at most 500 ms", () => {
  const recent = (recentRequiredDurationMs) => evaluateWarmup(input({ mode: "mobile", candidate: dataCandidate(), recentRequiredDurationMs }));
  assert.equal(recent(500).allowed, true);
  assert.equal(recent(501).reason, "recent-required-slow");
  assert.equal(recent(null).reason, "recent-required-slow");
});

test("mobile rolling window: two starts block until the oldest is exactly 60,000 ms old", () => {
  const atOffset = (offset) => evaluateWarmup(input({ mode: "mobile", recentModuleStarts: [NOW - offset, NOW - 10_000] }));
  assert.equal(atOffset(59_999).reason, "rate-limit");
  assert.equal(atOffset(60_000).allowed, true);
  assert.equal(evaluateWarmup(input({ mode: "mobile", recentModuleStarts: [NOW - 10_000] })).allowed, true);
  // Desktop has no rolling window, only the per-visit budget.
  assert.equal(evaluateWarmup(input({ recentModuleStarts: [NOW - 1, NOW - 2, NOW - 3] })).allowed, true);
});

test("quiet period: mobile 1,999 denied / 2,000 allowed; desktop 1,199 / 1,200", () => {
  const quiet = (mode, elapsed) => evaluateWarmup(input({ mode, quietSince: NOW - elapsed }));
  assert.equal(quiet("mobile", 1_999).reason, "quiet-period");
  assert.equal(quiet("mobile", 2_000).allowed, true);
  assert.equal(quiet("desktop", 1_199).reason, "quiet-period");
  assert.equal(quiet("desktop", 1_200).allowed, true);
  assert.equal(WARMUP_LIMITS.mobile.quietMs, 2_000);
  assert.equal(WARMUP_LIMITS.desktop.quietMs, 1_200);
});

test("desktop data spacing: 1,499 ms denied, 1,500 allowed; two per visit", () => {
  const spacing = (elapsed) => evaluateWarmup(input({ candidate: dataCandidate(), visit: { dataStarts: 1, lastDataStartAt: NOW - elapsed } }));
  assert.equal(spacing(1_499).reason, "data-spacing");
  assert.equal(spacing(1_500).allowed, true);
  assert.equal(evaluateWarmup(input({ candidate: dataCandidate(), visit: { dataStarts: 2, lastDataStartAt: NOW - 10_000 } })).reason, "visit-data-budget");
  assert.equal(evaluateWarmup(input({ mode: "mobile", candidate: dataCandidate(), visit: { dataStarts: 1 } })).reason, "visit-data-budget");
});

test("link intent bypasses quiet, bytes, visit and rate limits but not hover on mobile", () => {
  const blocked = {
    mode: "mobile",
    quietSince: NOW,
    moduleInFlight: true,
    visit: { moduleStarts: 5 },
    recentModuleStarts: [NOW - 1, NOW - 2],
    candidate: moduleCandidate({ trigger: "pointerdown", missingBytes: 900_000, routeId: "imports" })
  };
  assert.deepEqual(evaluateWarmup(input(blocked)), { allowed: true, reason: "ok" });
  assert.equal(evaluateWarmup(input({ ...blocked, candidate: moduleCandidate({ trigger: "focus", missingBytes: null }) })).allowed, true);
  assert.equal(evaluateWarmup(input({ ...blocked, candidate: moduleCandidate({ trigger: "hover" }) })).reason, "hover-on-mobile");
  assert.equal(evaluateWarmup(input({ quietSince: NOW, candidate: moduleCandidate({ trigger: "hover" }) })).allowed, true);
});

test("already-loaded is reported before any budget check, so it is never charged", () => {
  const spent = { mode: "mobile", visit: { moduleStarts: 1 }, recentModuleStarts: [NOW - 1, NOW - 2] };
  assert.equal(evaluateWarmup(input({ ...spent, candidate: moduleCandidate({ alreadyLoaded: true }) })).reason, "already-loaded");
  assert.equal(evaluateWarmup(input({ ...spent })).reason, "visit-module-budget");
  assert.equal(evaluateWarmup(input({ candidate: dataCandidate({ alreadyLoaded: true }), visit: { dataStarts: 2 } })).reason, "already-loaded");
});

test("automatic warmup never picks imports, settings or FAQ code, but explicit intent may", () => {
  for (const routeId of ["imports", "settings", "faq"]) {
    assert.equal(evaluateWarmup(input({ candidate: moduleCandidate({ routeId }) })).reason, "forbidden-route");
    assert.equal(evaluateWarmup(input({ candidate: moduleCandidate({ routeId, trigger: "focus" }) })).allowed, true);
  }
});

// Candidate selection.

const summaryTim = { tabId: "summary", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "2025-06", summaryEnd: "2026-05" };
const monthHousehold = { tabId: "month", viewId: "household", month: "2026-05", scope: "direct", summaryStart: "", summaryEnd: "" };
const months = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2026-05"];

const describeCandidates = (candidates) => candidates.map((candidate) => (
  `${candidate.kind}:${candidate.purpose}:${candidate.routeId}:${candidate.trigger}:${candidate.identity.viewId}:${candidate.identity.month}:${candidate.identity.scope}:${candidate.identity.summaryStart}-${candidate.identity.summaryEnd}`
));

test("Summary proposes Entries for the same person and URL month, never a range month or another view", () => {
  const candidates = selectWarmupCandidates({ mode: "mobile", identity: summaryTim, availableMonths: months, summaryRange: { startMonth: "2025-06", endMonth: "2026-05" } });
  assert.deepEqual(describeCandidates(candidates), [
    "module:route-module:entries:auto:person-tim:2026-05:direct_plus_shared:-",
    "data:entries-page:entries:auto:person-tim:2026-05:direct_plus_shared:-"
  ]);
  assert.equal(candidates.every((candidate) => candidate.identity.viewId === "person-tim"), true);
});

test("Month proposes Entries for the same month, view and scope; desktop adds adjacent months and the banner", () => {
  assert.deepEqual(describeCandidates(selectWarmupCandidates({ mode: "mobile", identity: monthHousehold, availableMonths: months })), [
    "module:route-module:entries:auto:household:2026-05:direct:-",
    "data:entries-page:entries:auto:household:2026-05:direct:-"
  ]);
  assert.deepEqual(describeCandidates(selectWarmupCandidates({ mode: "desktop", identity: { ...monthHousehold, month: "2025-08" }, availableMonths: months })), [
    "module:route-module:entries:auto:household:2025-08:direct:-",
    "data:entries-page:entries:auto:household:2025-08:direct:-",
    "data:imports-page:imports:auto::::-",
    "data:month-page:month:auto:household:2025-07:direct:-",
    "data:month-page:month:auto:household:2025-09:direct:-"
  ]);
});

test("desktop Summary adds the two shifted ranges as separate candidates only when both ends exist", () => {
  const inner = selectWarmupCandidates({ mode: "desktop", identity: { ...summaryTim, summaryStart: "2025-07", summaryEnd: "2025-09" }, availableMonths: months, summaryRange: { startMonth: "2025-07", endMonth: "2025-09" } });
  assert.deepEqual(describeCandidates(inner).filter((line) => line.includes("summary-page")), [
    "data:summary-page:summary:auto:person-tim:2026-05:direct_plus_shared:2025-06-2025-08",
    "data:summary-page:summary:auto:person-tim:2026-05:direct_plus_shared:2025-08-2025-10"
  ]);
  const full = selectWarmupCandidates({ mode: "desktop", identity: summaryTim, availableMonths: months, summaryRange: { startMonth: "2025-06", endMonth: "2026-05" } });
  assert.equal(full.some((candidate) => candidate.purpose === "summary-page"), false, "range already spans every month");
  const implicit = selectWarmupCandidates({ mode: "desktop", identity: summaryTim, availableMonths: months });
  assert.equal(implicit.some((candidate) => candidate.purpose === "summary-page"), false, "no resolved range, no guessed months");
});

test("Entries and Splits have no automatic mobile candidate without a matching recent destination", () => {
  for (const tabId of ["entries", "splits"]) {
    const identity = { tabId, viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" };
    assert.deepEqual(selectWarmupCandidates({ mode: "mobile", identity, availableMonths: months }), []);
    // Another person's recent destination is not a candidate.
    assert.deepEqual(selectWarmupCandidates({
      mode: "mobile",
      identity,
      availableMonths: months,
      recentDestination: { tabId: "month", viewId: "person-joyce", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" }
    }), []);
  }
  const back = selectWarmupCandidates({
    mode: "mobile",
    identity: { tabId: "entries", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" },
    availableMonths: months,
    recentDestination: { tabId: "month", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" }
  });
  assert.deepEqual(describeCandidates(back), ["module:route-module:month:auto:person-tim:2026-05:direct_plus_shared:-"]);
});

test("desktop Entries warms adjacent months for the same view only", () => {
  const identity = { tabId: "entries", viewId: "person-tim", month: "2025-10", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" };
  assert.deepEqual(describeCandidates(selectWarmupCandidates({ mode: "desktop", identity, availableMonths: months })), [
    "data:entries-page:entries:auto:person-tim:2025-09:direct_plus_shared:-",
    "data:entries-page:entries:auto:person-tim:2026-05:direct_plus_shared:-"
  ]);
});

test("exact link intent comes first and deduplicates route code; forbidden routes appear only through intent", () => {
  const intent = { trigger: "pointerdown", identity: { tabId: "entries", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" } };
  const candidates = selectWarmupCandidates({ mode: "mobile", identity: summaryTim, availableMonths: months, intent });
  assert.deepEqual(describeCandidates(candidates), [
    "module:route-module:entries:pointerdown:person-tim:2026-05:direct_plus_shared:-",
    "data:entries-page:entries:auto:person-tim:2026-05:direct_plus_shared:-"
  ]);
  const settingsIntent = { trigger: "focus", identity: { tabId: "settings", viewId: "", month: "", scope: "", summaryStart: "", summaryEnd: "" } };
  assert.equal(selectWarmupCandidates({ mode: "desktop", identity: summaryTim, availableMonths: months, intent: settingsIntent })[0].routeId, "settings");
  for (const mode of ["desktop", "mobile"]) {
    for (const identity of [summaryTim, monthHousehold]) {
      const automatic = selectWarmupCandidates({ mode, identity, availableMonths: months, summaryRange: { startMonth: "2025-07", endMonth: "2025-09" } });
      assert.equal(automatic.some((candidate) => candidate.kind === "module" && ["imports", "settings", "faq"].includes(candidate.routeId)), false);
    }
  }
  const recentImports = selectWarmupCandidates({
    mode: "desktop",
    identity: { tabId: "splits", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" },
    recentDestination: { tabId: "imports", viewId: "person-tim", month: "", scope: "", summaryStart: "", summaryEnd: "" }
  });
  assert.deepEqual(recentImports, [], "a recent Imports visit is not a reason to warm Imports code");
});

test("visit keys ignore cosmetic fields and differ across view, month and workflow context", () => {
  const base = { tabId: "summary", viewId: "household", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" };
  const key = buildVisitKey(base);
  assert.equal(key, "summary|household|2026-05|direct_plus_shared|||");
  assert.equal(buildVisitKey({ ...base, summaryFocus: "overall", moneyVisible: true }), key);
  assert.notEqual(buildVisitKey({ ...base, viewId: "person-tim" }), key);
  assert.notEqual(buildVisitKey({ ...base, month: "2026-04" }), key);
  const splits = { tabId: "splits", viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared", summaryStart: "", summaryEnd: "" };
  assert.notEqual(buildVisitKey(splits, { splitGroup: "baby-river" }), buildVisitKey(splits, { splitGroup: "none" }));
  assert.equal(buildVisitKey(splits, { splitGroup: "none", editor: "" }), buildVisitKey(splits, { splitGroup: "none" }));
  assert.equal(buildVisitKey(splits, { b: "2", a: "1" }), buildVisitKey(splits, { a: "1", b: "2" }));
});

test("the policy module imports nothing", () => {
  const source = readFileSync(new URL("../src/client/route-warmup-policy.js", import.meta.url), "utf8");
  assert.equal(/^\s*import\s/m.test(source), false);
  assert.equal(/\b(window|document|navigator|fetch|setTimeout|requestIdleCallback)\b/.test(source.replace(/\/\/.*$/gm, "")), false);
});
