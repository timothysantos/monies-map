import assert from "node:assert/strict";
import test from "node:test";

import { WARMUP_ADMISSIONS, admissionFor } from "../src/client/route-warmup-admissions.js";
import { WARMUP_LIMITS } from "../src/client/route-warmup-policy.js";

const summary = (summaryStart, summaryEnd) => ({ tabId: "summary", viewId: "household", month: "2026-05", scope: "direct_plus_shared", summaryStart, summaryEnd });

test("mobile admits only the measured Entries page, within the mobile data caps", () => {
  assert.deepEqual(WARMUP_ADMISSIONS, [
    { family: "entries-page", fixture: "scale-10k", revision: "compact-json", responseBytes: 37_975, handlerMs: 25 }
  ]);
  const entries = admissionFor("entries-page", { tabId: "entries", viewId: "person-tim", month: "2026-05" });
  assert.deepEqual(entries, { responseBytes: 37_975, handlerMs: 25 });
  assert.ok(entries.responseBytes <= WARMUP_LIMITS.mobile.maxDataBytes);
  assert.ok(entries.handlerMs <= WARMUP_LIMITS.mobile.maxDataHandlerMs);
  // Families that were measured over the cap, or never offered on mobile, stay unknown.
  for (const family of ["month-page", "summary-page", "imports-page", "splits-page"]) {
    assert.equal(admissionFor(family, summary("2025-06", "2026-05")), null, family);
  }
});

test("a measured family is admitted with its measured numbers; unknown families are not", () => {
  const table = [{ family: "entries-page", fixture: "scale-10k", revision: "r", responseBytes: 42_000, handlerMs: 180 }];
  assert.deepEqual(admissionFor("entries-page", { tabId: "entries" }, table), { responseBytes: 42_000, handlerMs: 180 });
  assert.equal(admissionFor("month-page", { tabId: "month" }, table), null);
});

test("summary ranges longer than the measured range, or without a resolved range, are not admitted", () => {
  const table = [{ family: "summary-page", fixture: "scale-10k", revision: "r", maxRangeMonths: 6, responseBytes: 30_000, handlerMs: 120 }];
  assert.deepEqual(admissionFor("summary-page", summary("2025-12", "2026-05"), table), { responseBytes: 30_000, handlerMs: 120 });
  assert.equal(admissionFor("summary-page", summary("2025-11", "2026-05"), table), null, "7 months > 6 measured");
  assert.equal(admissionFor("summary-page", summary("", ""), table), null);
  assert.equal(admissionFor("summary-page", summary("2025-06", "2026-05"), [{ ...table[0], maxRangeMonths: undefined }]), null);
});
