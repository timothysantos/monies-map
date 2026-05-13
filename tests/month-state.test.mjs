import assert from "node:assert/strict";
import test from "node:test";

import {
  getMonthPlanEditSource,
  mergeMonthPlanSections,
  mergeMonthRowsById
} from "../src/client/month-state.js";
import { buildMonthMutationRefreshPlan } from "../src/client/month-workflow.js";

test("M4 month workflow keeps pending draft rows alive across stale refreshes", () => {
  const currentRows = [
    { id: "draft-1", isDraft: true, isPendingDerived: false, label: "Draft" },
    { id: "actual-1", isDraft: false, isPendingDerived: true, label: "Pending" }
  ];
  const serverRows = [
    { id: "actual-1", isDraft: false, isPendingDerived: false, label: "Refreshed" }
  ];

  assert.deepEqual(mergeMonthRowsById(currentRows, serverRows), [
    { id: "draft-1", isDraft: true, isPendingDerived: false, label: "Draft" },
    { id: "actual-1", isDraft: false, isPendingDerived: false, label: "Refreshed" }
  ]);
});

test("M5 month workflow merges plan sections without clobbering active row state", () => {
  const currentSections = [
    {
      key: "planned_items",
      rows: [
        { id: "row-1", isDraft: true, isPendingDerived: false, label: "Draft row" }
      ]
    }
  ];
  const serverSections = [
    {
      key: "planned_items",
      rows: [
        { id: "row-1", isDraft: false, isPendingDerived: false, label: "Server row" }
      ]
    }
  ];

  assert.deepEqual(mergeMonthPlanSections(currentSections, serverSections), [
    {
      key: "planned_items",
      rows: [
        { id: "row-1", isDraft: false, isPendingDerived: false, label: "Server row" }
      ]
    }
  ]);
});

test("X4a month workflow opens the plan editor against the source row values", () => {
  const row = {
    id: "row-2",
    isDerived: true,
    sourcePlannedMinor: 4200,
    plannedMinor: 1000,
    sourceNote: "Source note",
    note: "Weighted note",
    sourceRowIds: ["entry-1"]
  };

  const editSource = getMonthPlanEditSource(row);

  assert.equal(editSource.plannedMinor, 4200);
  assert.equal(editSource.note, "Source note");
});

test("month invalidation matrix keeps note-save scoped to the month unless summary visibly depends on it", () => {
  assert.deepEqual(buildMonthMutationRefreshPlan({
    kind: "note-save"
  }), {
    invalidateEntries: false,
    invalidateMonth: true,
    invalidateSplits: false,
    invalidateSummary: false,
    refreshShell: false
  });

  assert.deepEqual(buildMonthMutationRefreshPlan({
    kind: "note-save",
    affectsSummary: true
  }), {
    invalidateEntries: false,
    invalidateMonth: true,
    invalidateSplits: false,
    invalidateSummary: true,
    refreshShell: false
  });
});

test("month invalidation matrix keeps plan-link, drilldown return, and cross-page freshness narrow", () => {
  assert.deepEqual(buildMonthMutationRefreshPlan({
    kind: "plan-link-save",
    affectsEntries: true,
    affectsSplits: true,
    affectsSummary: true
  }), {
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: true,
    refreshShell: false
  });

  assert.deepEqual(buildMonthMutationRefreshPlan({
    kind: "drilldown-return-entries"
  }), {
    invalidateEntries: true,
    invalidateMonth: true,
    invalidateSplits: false,
    invalidateSummary: false,
    refreshShell: false
  });

  assert.deepEqual(buildMonthMutationRefreshPlan({
    kind: "drilldown-return-splits"
  }), {
    invalidateEntries: false,
    invalidateMonth: true,
    invalidateSplits: true,
    invalidateSummary: false,
    refreshShell: false
  });
});

test("month invalidation matrix leaves filter-only and mobile-sheet changes server-local", () => {
  assert.deepEqual(buildMonthMutationRefreshPlan({
    kind: "filter-only"
  }), {
    invalidateEntries: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false,
    refreshShell: false
  });

  assert.deepEqual(buildMonthMutationRefreshPlan({
    kind: "mobile-sheet"
  }), {
    invalidateEntries: false,
    invalidateMonth: false,
    invalidateSplits: false,
    invalidateSummary: false,
    refreshShell: false
  });
});

test("month must not become a cross-page coordinator when the workflow plan is built", () => {
  const plan = buildMonthMutationRefreshPlan({
    kind: "plan-link-save",
    affectsEntries: true,
    affectsSplits: true,
    affectsSummary: true
  });

  assert.equal(plan.invalidateEntries, true);
  assert.equal(plan.invalidateMonth, true);
  assert.equal(plan.invalidateSplits, true);
  assert.equal(plan.invalidateSummary, true);
  assert.equal(plan.refreshShell, false);
});
