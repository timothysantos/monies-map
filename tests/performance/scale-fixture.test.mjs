import assert from "node:assert/strict";
import test from "node:test";
import { createScaleFixture, validateScaleFixture } from "./fixtures/scale-fixture.mjs";

// Shape-only contract. The fixture is not yet loaded into test D1 or used by
// the browser harness; see docs/audits/macro-loading-baseline.md (H01).
test("deterministic scale fixtures validate counts, totals, ownership, and transfer pairing", () => {
  const ordinary = createScaleFixture(1_000);
  const stress = createScaleFixture(10_000);
  assert.equal(validateScaleFixture(ordinary), true);
  assert.equal(validateScaleFixture(stress), true);
  assert.equal(ordinary.expected.rowCount, 1_000);
  assert.equal(ordinary.expected.monthCount, 24);
  assert.equal(ordinary.expected.largeMonthCount, 41);
  assert.equal(stress.expected.rowCount, 10_000);
  assert.equal(stress.expected.monthCount, 24);
  assert.equal(stress.expected.largeMonthCount, 2_000);
  assert.equal(stress.expected.transferPairsValid, true);
  assert.equal(stress.rows.filter((row) => row.bankCertificationStatus !== "provisional").length, 0);
  assert.equal(createScaleFixture(10_000).expected.expenseTotalMinor, stress.expected.expenseTotalMinor);
  const invalid = { ...stress, expected: { ...stress.expected, expenseTotalMinor: stress.expected.expenseTotalMinor + 1 } };
  assert.equal(validateScaleFixture(invalid), false);
});
