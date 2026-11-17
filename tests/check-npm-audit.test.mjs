import assert from "node:assert/strict";
import test from "node:test";
import { decideAudit } from "../scripts/check-npm-audit.mjs";

const ID = "GHSA-fc5q-39xc-vjpf";
const advisory = (id, name, severity = "high", extra = {}) => ({
  [name]: { name, severity, via: [{ source: 1, name, title: `${name} problem`, url: `https://github.com/advisories/${id}`, severity }], fixAvailable: extra.fixAvailable ?? false },
});
const report = (...parts) => ({ vulnerabilities: Object.assign({}, ...parts) });
const clean = report();
const allowlist = { entries: [{ id: ID, package: "picomatch", reason: "dev tooling only", added: "2026-11-18", reviewBy: "2026-12-18" }] };
const base = { productionReport: clean, allowlist, today: "2026-11-20" };

test("only the allowlisted advisory passes and is reported with its reason", () => {
  const result = decideAudit({ ...base, fullReport: report(advisory(ID, "picomatch")) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.allowed.length, 1);
  assert.equal(result.allowed[0].id, ID);
  assert.equal(result.allowed[0].reason, "dev tooling only");
});

test("a derived package that only points at the allowlisted advisory adds nothing", () => {
  const derived = { vite: { name: "vite", severity: "high", via: ["picomatch"], fixAvailable: false } };
  assert.equal(decideAudit({ ...base, fullReport: report(advisory(ID, "picomatch"), derived) }).ok, true);
});

test("another high advisory fails, and a critical one too", () => {
  for (const severity of ["high", "critical"]) {
    const result = decideAudit({ ...base, fullReport: report(advisory(ID, "picomatch"), advisory("GHSA-aaaa-bbbb-cccc", "lodash", severity)) });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /GHSA-aaaa-bbbb-cccc.*not on the allowlist/);
  }
});

test("moderate advisories are not blocking", () => {
  assert.equal(decideAudit({ ...base, fullReport: report(advisory("GHSA-aaaa-bbbb-cccc", "x", "moderate")) }).ok, true);
});

test("an allowlisted advisory with a non-breaking fix fails; a major-version-only fix does not", () => {
  const fixed = decideAudit({ ...base, fullReport: report(advisory(ID, "picomatch", "high", { fixAvailable: true })) });
  assert.equal(fixed.ok, false);
  assert.match(fixed.failures[0], /now has a fix available/);
  const minor = decideAudit({ ...base, fullReport: report(advisory(ID, "picomatch", "high", { fixAvailable: { name: "picomatch", version: "4.0.8", isSemVerMajor: false } })) });
  assert.equal(minor.ok, false);
  const major = decideAudit({ ...base, fullReport: report(advisory(ID, "picomatch", "high", { fixAvailable: { name: "vite", version: "6.2.7", isSemVerMajor: true } })) });
  assert.equal(major.ok, true);
});

test("an entry past its review-by date fails; the review-by day itself still passes", () => {
  const full = report(advisory(ID, "picomatch"));
  const expired = decideAudit({ ...base, fullReport: full, today: "2026-12-19" });
  assert.equal(expired.ok, false);
  assert.match(expired.failures[0], /passed its review-by date 2026-12-18/);
  assert.equal(decideAudit({ ...base, fullReport: full, today: "2026-12-18" }).ok, true);
});

test("an allowlisted advisory that reaches production fails even though it is listed", () => {
  const full = report(advisory(ID, "picomatch"));
  const result = decideAudit({ ...base, fullReport: full, productionReport: full });
  assert.equal(result.ok, false);
  assert.equal(result.allowed.length, 0);
  assert.match(result.failures[0], /reaches a production dependency/);
});
