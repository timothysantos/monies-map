// Owner-approved copy fixes in the shared copy file: counts agree with their
// nouns and verbs, the Delete month warning mentions demo data only on the
// demo site, a failed page names the page, and the Apple Pay section uses
// plain words.
import assert from "node:assert/strict";
import test from "node:test";

import { messages } from "../src/client/copy/en-SG.js";

test("count strings use the singular for one and the plural otherwise", () => {
  const cases = [
    [messages.settings.unresolvedTransfersDetailWithCount, "1 transfer row is not fully paired yet", "2 transfer rows are not fully paired yet"],
    [messages.imports.transactionCount, "1 transaction", "2 transactions"],
    [messages.imports.inboxMetricCleanupValue, "1 split link", "2 split links"],
    [messages.imports.intakeParsing, "Reading 1 file in this browser.", "Reading 2 files in this browser."],
    [messages.imports.reconciliationCandidates, "1 entry reconciliation match needs a decision", "2 entry reconciliation matches need a decision"],
    [messages.imports.needsReviewRows, "1 row needs review", "2 rows need review"],
    [messages.imports.deleteDiagnosticEntriesLabel, "Delete 1 ledger row", "Delete 2 ledger rows"],
    [messages.imports.deleteDiagnosticEntriesProgress, "Deleting 1 ledger row and refreshing", "Deleting 2 ledger rows and refreshing"],
    [messages.imports.deleteDiagnosticEntriesSuccess, "1 ledger row deleted.", "2 ledger rows deleted."]
  ];
  for (const [format, one, two] of cases) {
    assert.ok(format(1).startsWith(one), `${format(1)} should start with ${one}`);
    assert.ok(format(2).startsWith(two), `${format(2)} should start with ${two}`);
  }

  assert.equal(
    messages.imports.intakeRowDetail({ fileName: "a.csv", rowCount: 1, checkpointCount: 1, parserKey: "uob" }),
    "a.csv • 1 row • 1 checkpoint • uob"
  );
  assert.equal(
    messages.imports.intakeRowDetail({ fileName: "a.csv", rowCount: 3, checkpointCount: 0, parserKey: "uob" }),
    "a.csv • 3 rows • 0 checkpoints • uob"
  );
  assert.equal(messages.imports.recentPageSummary(1, 1, 1), "Showing 1-1 of 1 import");
  assert.equal(messages.imports.recentPageSummary(1, 10, 12), "Showing 1-10 of 12 imports");
  assert.equal(messages.settings.transferPage(1, 1, 1), "Page 1 of 1 (1 transfer)");
  assert.equal(messages.settings.transferPage(1, 2, 12), "Page 1 of 2 (12 transfers)");
  assert.equal(
    messages.settings.statementCompareSummary({ accountName: "UOB One", checkpointMonth: "2026-05", matchedRowCount: 0, statementRowCount: 1 }),
    "UOB One 2026-05: 0 of 1 statement row matched"
  );
  assert.equal(
    messages.settings.statementCompareSummary({ accountName: "UOB One", checkpointMonth: "2026-05", matchedRowCount: 3, statementRowCount: 4 }),
    "UOB One 2026-05: 3 of 4 statement rows matched"
  );
  assert.equal(messages.splits.includedSplitRecords(1), "1 included split record");
  assert.equal(messages.splits.includedSplitRecords(3), "3 included split records");

  const oneRowConfirm = messages.imports.deleteDiagnosticEntriesConfirm({ count: 1, amount: "$5.00" });
  assert.match(oneRowConfirm, /^Delete the 1 unresolved ledger row shown here now\? It nets to \$5\.00\./);
  assert.match(messages.imports.deleteDiagnosticEntriesConfirm({ count: 2, amount: "$5.00" }), /^Delete all 2 unresolved ledger rows shown here now\? Together these rows net to \$5\.00\./);
});

test("a page that could not load is named in plain words", () => {
  assert.equal(messages.common.pageLoadErrorTitleFor("Imports"), "The Imports page could not load.");
  assert.equal(messages.common.pageLoadErrorTitleFor("Settings"), "The Settings page could not load.");
  assert.equal(messages.common.pageLoadErrorTitleFor(""), "This page could not load.");
});

test("the Apple Pay section uses plain words", () => {
  assert.equal(messages.settings.shortcutAdvancedTitle, "More shortcut settings");
  assert.equal(
    messages.settings.shortcutDefaultAccountsDetail,
    "If the shortcut doesn't name an account, entries go to the first account in this list."
  );
  for (const text of [messages.settings.shortcutAdvancedTitle, messages.settings.shortcutDefaultAccountsDetail]) {
    assert.doesNotMatch(text, /API|accountId|accountName|account_id/);
  }
});
