import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingsRefreshPlan } from "../src/client/settings-refresh-plan.js";

test("reference-data mutations refresh shell and downstream page caches", () => {
  assert.deepEqual(buildSettingsRefreshPlan("account_saved"), {
    refreshShell: true,
    invalidateEntries: true,
    invalidateImports: false,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true
  });
  assert.deepEqual(buildSettingsRefreshPlan("person_saved"), {
    refreshShell: true,
    invalidateEntries: true,
    invalidateImports: false,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true
  });
});

test("category-rule mutations stay narrow to settings and later imports", () => {
  assert.deepEqual(buildSettingsRefreshPlan("category_rule_saved"), {
    refreshShell: false,
    invalidateEntries: false,
    invalidateImports: true,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
});

test("trust and reconciliation mutations avoid unrelated cache bursts", () => {
  assert.deepEqual(buildSettingsRefreshPlan("checkpoint_saved"), {
    refreshShell: false,
    invalidateEntries: false,
    invalidateImports: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
  assert.deepEqual(buildSettingsRefreshPlan("reconciliation_exception_resolved"), {
    refreshShell: false,
    invalidateEntries: false,
    invalidateImports: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
});

test("demo resets refresh every downstream slice they can invalidate", () => {
  assert.deepEqual(buildSettingsRefreshPlan("demo_empty_state"), {
    refreshShell: true,
    invalidateEntries: true,
    invalidateImports: true,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true
  });
});

test("unknown settings refresh plans fail fast", () => {
  assert.throws(() => buildSettingsRefreshPlan("unknown_kind"), /Unknown settings refresh plan/);
});
