import { expect, test } from "@playwright/test";

import {
  getStatementPreviewAutoRefreshKey,
  shouldAutoRefreshStatementPreview
} from "../../src/client/import-preview-auto-refresh.js";

test("statement preview auto-refresh key is empty for non-statement drafts", () => {
  expect(getStatementPreviewAutoRefreshKey({
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
  })).toBe("");
});

test("statement preview auto-refresh waits for the preview to settle", () => {
  expect(shouldAutoRefreshStatementPreview({
    hasPreview: true,
    autoRefreshKey: "statement-draft",
    isSubmitting: false,
    isParsingStatement: false,
    isDocumentVisible: true,
    now: 10_000,
    lastPreviewHydratedAt: 9_000,
    lastAutoRefreshAt: 0,
    lastAutoRefreshKey: ""
  })).toBe(false);
});

test("statement preview auto-refresh is throttled per draft key", () => {
  expect(shouldAutoRefreshStatementPreview({
    hasPreview: true,
    autoRefreshKey: "statement-draft",
    isSubmitting: false,
    isParsingStatement: false,
    isDocumentVisible: true,
    now: 30_000,
    lastPreviewHydratedAt: 10_000,
    lastAutoRefreshAt: 20_000,
    lastAutoRefreshKey: "statement-draft"
  })).toBe(false);
});

test("statement preview auto-refresh re-runs when a visible statement draft is stale", () => {
  expect(shouldAutoRefreshStatementPreview({
    hasPreview: true,
    autoRefreshKey: "statement-draft",
    isSubmitting: false,
    isParsingStatement: false,
    isDocumentVisible: true,
    now: 30_000,
    lastPreviewHydratedAt: 10_000,
    lastAutoRefreshAt: 1_000,
    lastAutoRefreshKey: "older-draft"
  })).toBe(true);
});
