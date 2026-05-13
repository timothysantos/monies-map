import assert from "node:assert/strict";
import test from "node:test";

import {
  getMonthPlanEditSource,
  mergeMonthPlanSections,
  mergeMonthRowsById
} from "../src/client/month-state.js";

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
