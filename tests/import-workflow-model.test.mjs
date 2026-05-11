import assert from "node:assert/strict";
import test from "node:test";

import { buildImportWorkflowModel } from "../src/client/import-workflow-model.js";

test("import workflow model reports a draft when preview state exists", () => {
  const model = buildImportWorkflowModel({
    preview: { sourceLabel: "Imported CSV" },
    previewRows: [{ rowId: "row-1" }],
    statementCheckpoints: [],
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
  assert.equal(model.isWorkflowLocked, false);
  assert.equal(model.isPreviewRefreshSafe, true);
});

test("import workflow model locks refresh when the preview has diverged from hydration", () => {
  const model = buildImportWorkflowModel({
    preview: { sourceLabel: "Imported CSV" },
    previewRows: [{ rowId: "row-1", commitStatus: "included" }],
    statementCheckpoints: [],
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
});
