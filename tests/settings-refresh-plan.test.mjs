import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSettingsRefreshPlan,
  describeSettingsRefreshPlan,
  SETTINGS_ROUTE_REQUEST
} from "../src/client/settings-refresh-plan.js";

test("account and category mutations refresh reference data and downstream page caches", () => {
  assert.deepEqual(buildSettingsRefreshPlan("account_saved"), {
    refreshShell: false,
    refreshReferenceData: true,
    invalidateEntries: true,
    invalidateImports: false,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true
  });
  assert.deepEqual(buildSettingsRefreshPlan("category_saved"), {
    refreshShell: false,
    refreshReferenceData: true,
    invalidateEntries: true,
    invalidateImports: false,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true
  });
  assert.deepEqual(buildSettingsRefreshPlan("legacy_ledger_ownership_repaired"), {
    refreshShell: false,
    refreshReferenceData: true,
    invalidateEntries: true,
    invalidateImports: false,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true
  });
});

test("person mutations refresh shell identity plus reference data", () => {
  assert.deepEqual(buildSettingsRefreshPlan("person_saved"), {
    refreshShell: true,
    refreshReferenceData: true,
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
    refreshReferenceData: false,
    invalidateEntries: false,
    invalidateImports: true,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
  assert.deepEqual(buildSettingsRefreshPlan("category_rule_issue_ignored"), {
    refreshShell: false,
    refreshReferenceData: false,
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
    refreshReferenceData: false,
    invalidateEntries: false,
    invalidateImports: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
  assert.deepEqual(buildSettingsRefreshPlan("reconciliation_exception_resolved"), {
    refreshShell: false,
    refreshReferenceData: false,
    invalidateEntries: false,
    invalidateImports: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
  assert.deepEqual(buildSettingsRefreshPlan("statement_compare_linked"), {
    refreshShell: false,
    refreshReferenceData: false,
    invalidateEntries: false,
    invalidateImports: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
  assert.deepEqual(buildSettingsRefreshPlan("settings_form_draft"), {
    refreshShell: false,
    refreshReferenceData: false,
    invalidateEntries: false,
    invalidateImports: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
  assert.deepEqual(buildSettingsRefreshPlan("shortcut_settings_saved"), {
    refreshShell: false,
    refreshReferenceData: false,
    invalidateEntries: false,
    invalidateImports: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false
  });
});

test("settings transfer fixes refresh affected ledger route families", () => {
  assert.deepEqual(buildSettingsRefreshPlan("unresolved_transfer_linked"), {
    refreshShell: false,
    refreshReferenceData: false,
    invalidateEntries: true,
    invalidateImports: false,
    invalidateMonth: true,
    invalidateSplits: false,
    invalidateSummary: true
  });
  assert.deepEqual(buildSettingsRefreshPlan("unresolved_transfer_settled"), {
    refreshShell: false,
    refreshReferenceData: false,
    invalidateEntries: true,
    invalidateImports: false,
    invalidateMonth: true,
    invalidateSplits: false,
    invalidateSummary: true
  });
});

test("demo resets refresh every downstream slice they can invalidate", () => {
  assert.deepEqual(buildSettingsRefreshPlan("demo_empty_state"), {
    refreshShell: true,
    refreshReferenceData: true,
    invalidateEntries: true,
    invalidateImports: true,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true
  });
});

test("settings refresh description keeps route invalidation ownership in the slice", () => {
  assert.deepEqual(
    describeSettingsRefreshPlan(buildSettingsRefreshPlan("category_saved")),
    {
      routeRequest: SETTINGS_ROUTE_REQUEST,
      routePagePaths: [
        "/api/entries-page",
        "/api/month-page",
        "/api/splits-page"
      ],
      clearEntriesPageCache: true,
      invalidateImportsPage: false,
      invalidateSummaryAccountPills: true,
      invalidateSummaryPage: true,
      refreshShell: false,
      refreshReferenceData: true
    }
  );

  assert.deepEqual(
    describeSettingsRefreshPlan(buildSettingsRefreshPlan("category_rule_saved")),
    {
      routeRequest: SETTINGS_ROUTE_REQUEST,
      routePagePaths: ["/api/imports-page"],
      clearEntriesPageCache: false,
      invalidateImportsPage: true,
      invalidateSummaryAccountPills: false,
      invalidateSummaryPage: false,
      refreshShell: false,
      refreshReferenceData: false
    }
  );
});

test("unknown settings refresh plans fail fast", () => {
  assert.throws(() => buildSettingsRefreshPlan("unknown_kind"), /Unknown settings refresh plan/);
});
