import assert from "node:assert/strict";
import test from "node:test";

import {
  getStatementPreviewAutoRefreshKey,
  shouldAutoRefreshStatementPreview,
  shouldPreserveStatementPreviewOnRefreshError
} from "../src/client/import-preview-auto-refresh.js";

test("statement preview auto-refresh key is empty for non-statement drafts", () => {
  assert.equal(getStatementPreviewAutoRefreshKey({
    sourceType: "csv",
    statementCheckpoints: [{
      accountId: "acct-1",
      accountName: "Card",
      checkpointMonth: "2026-04",
      statementStartDate: "2026-03-13",
      statementEndDate: "2026-04-12",
      statementBalanceMinor: 28907
    }],
    previewRows: [{
      rowId: "preview-1",
      date: "2026-03-13",
      description: "ChatGPT",
      amountMinor: 2896,
      entryType: "expense",
      transferDirection: null,
      accountId: "acct-1",
      accountName: "Card",
      commitStatus: "included",
      reconciliationTargetTransactionId: "txn-1"
    }]
  }), "");
});

test("statement preview auto-refresh waits for the preview to settle", () => {
  assert.equal(shouldAutoRefreshStatementPreview({
    hasPreview: true,
    autoRefreshKey: "statement-draft",
    isSubmitting: false,
    isParsingStatement: false,
    isDocumentVisible: true,
    now: 10_000,
    lastPreviewHydratedAt: 9_000,
    lastAutoRefreshAt: 0,
    lastAutoRefreshKey: ""
  }), false);
});

test("statement preview auto-refresh is throttled per draft key", () => {
  assert.equal(shouldAutoRefreshStatementPreview({
    hasPreview: true,
    autoRefreshKey: "statement-draft",
    isSubmitting: false,
    isParsingStatement: false,
    isDocumentVisible: true,
    now: 30_000,
    lastPreviewHydratedAt: 10_000,
    lastAutoRefreshAt: 20_000,
    lastAutoRefreshKey: "statement-draft"
  }), false);
});

test("statement preview auto-refresh re-runs when a visible statement draft is stale", () => {
  assert.equal(shouldAutoRefreshStatementPreview({
    hasPreview: true,
    autoRefreshKey: "statement-draft",
    isSubmitting: false,
    isParsingStatement: false,
    isDocumentVisible: true,
    now: 30_000,
    lastPreviewHydratedAt: 10_000,
    lastAutoRefreshAt: 1_000,
    lastAutoRefreshKey: "older-draft"
  }), true);
});

test("statement preview auto-refresh is blocked while the draft has active workflow edits", () => {
  assert.equal(shouldAutoRefreshStatementPreview({
    hasPreview: true,
    autoRefreshKey: "statement-draft",
    isWorkflowLocked: true,
    isSubmitting: false,
    isParsingStatement: false,
    isDocumentVisible: true,
    now: 30_000,
    lastPreviewHydratedAt: 10_000,
    lastAutoRefreshAt: 1_000,
    lastAutoRefreshKey: "older-draft"
  }), false);
});

test("statement preview auto-refresh failures preserve the current preview", () => {
  assert.equal(shouldPreserveStatementPreviewOnRefreshError({
    isAutoRefresh: true,
    hasPreview: true
  }), true);

  assert.equal(shouldPreserveStatementPreviewOnRefreshError({
    isAutoRefresh: false,
    hasPreview: true
  }), false);
});
