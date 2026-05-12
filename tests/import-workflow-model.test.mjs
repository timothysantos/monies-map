import assert from "node:assert/strict";
import test from "node:test";

import { buildImportWorkflowModel } from "../src/client/import-workflow-model.js";

test("import workflow model reports a draft when preview state exists", () => {
  const model = buildImportWorkflowModel({
    preview: { sourceLabel: "Imported CSV" },
    previewRows: [{ rowId: "row-1" }],
    statementCheckpoints: [],
    csvRows: [{ date: "2026-01-01", description: "Coffee", amount: "4.50" }],
    columnMappings: { date: "date", description: "description", amount: "amount" },
    sourceLabel: "Imported CSV",
    csvText: "",
    importNote: "",
    statementImportMeta: { sourceType: "csv", parserKey: "generic_csv" },
    uploadStatus: null,
    previewError: "",
    isSubmitting: false,
    isParsingStatement: false,
    currentPreviewSignature: "{}",
    hydratedPreviewSignature: "{}"
  });

  assert.equal(model.hasDraft, true);
  assert.equal(model.hasReviewablePreview, true);
  assert.equal(model.currentStage, 3);
  assert.equal(model.readyForMapping, true);
  assert.equal(model.readyForPreview, true);
  assert.equal(model.mappedRows.length, 1);
  assert.deepEqual(model.mappedRows[0], {
    date: "2026-01-01",
    description: "Coffee",
    amount: "4.50"
  });
  assert.equal(model.isWorkflowLocked, false);
  assert.equal(model.isPreviewRefreshSafe, true);
});

test("import workflow model locks refresh when the preview has diverged from hydration", () => {
  const model = buildImportWorkflowModel({
    preview: { sourceLabel: "Imported CSV" },
    previewRows: [{ rowId: "row-1", commitStatus: "included" }],
    statementCheckpoints: [],
    csvRows: [],
    columnMappings: { date: "date", description: "description", amount: "amount" },
    sourceLabel: "Imported CSV",
    csvText: "",
    importNote: "",
    statementImportMeta: { sourceType: "pdf", parserKey: "uob_credit_card_pdf" },
    uploadStatus: null,
    previewError: "",
    isSubmitting: false,
    isParsingStatement: false,
    currentPreviewSignature: "{\"rows\":[1]}",
    hydratedPreviewSignature: "{\"rows\":[0]}"
  });

  assert.equal(model.isPreviewDirty, true);
  assert.equal(model.isWorkflowLocked, true);
  assert.equal(model.isPreviewRefreshSafe, false);
  assert.equal(model.currentStage, 3);
});

test("import workflow model does not build mapped rows when mappings are incomplete or ignored", () => {
  const model = buildImportWorkflowModel({
    preview: null,
    previewRows: [],
    statementCheckpoints: [],
    csvRows: [{ date: "2026-01-01", description: "Coffee", amount: "4.50" }],
    columnMappings: { date: "date", description: "ignore", amount: "ignore" },
    sourceLabel: "Imported CSV",
    csvText: "",
    importNote: "",
    statementImportMeta: { sourceType: "csv", parserKey: "generic_csv" },
    uploadStatus: null,
    previewError: "",
    isSubmitting: false,
    isParsingStatement: false,
    currentPreviewSignature: "",
    hydratedPreviewSignature: ""
  });

  assert.equal(model.mappedRows.length, 0);
  assert.equal(model.readyForPreview, false);
});
