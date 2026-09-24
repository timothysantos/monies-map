import assert from "node:assert/strict";
import test from "node:test";

import { WARMUP_ADMISSIONS, admissionFor } from "../src/client/route-warmup-admissions.js";

const summary = (summaryStart, summaryEnd) => ({ tabId: "summary", viewId: "household", month: "2026-05", scope: "direct_plus_shared", summaryStart, summaryEnd });

test("until H01b measures the families, nothing is admitted for mobile", () => {
  assert.deepEqual(WARMUP_ADMISSIONS, []);
  for (const family of ["entries-page", "month-page", "summary-page", "imports-page"]) {
    assert.equal(admissionFor(family, summary("2025-06", "2026-05")), null);
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
