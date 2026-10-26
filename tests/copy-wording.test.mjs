// Owner-approved copy fixes in the shared copy file: counts agree with their
// nouns and verbs, the Delete month warning mentions demo data only on the
// demo site, a failed page names the page, and the Apple Pay section uses
// plain words.
import assert from "node:assert/strict";
import test from "node:test";

import { messages } from "../src/client/copy/en-SG.js";
import { importMessages } from "../src/client/copy/en-SG-imports.js";
import { monthMessages } from "../src/client/copy/en-SG-month.js";
import { settingsMessages } from "../src/client/copy/en-SG-settings.js";
import { splitsMessages } from "../src/client/copy/en-SG-splits.js";

test("count strings use the singular for one and the plural otherwise", () => {
  const cases = [
    [settingsMessages.unresolvedTransfersDetailWithCount, "1 transfer row is not fully paired yet", "2 transfer rows are not fully paired yet"],
    [importMessages.transactionCount, "1 transaction", "2 transactions"],
    [importMessages.inboxMetricCleanupValue, "1 split link", "2 split links"],
    [importMessages.intakeParsing, "Reading 1 file in this browser.", "Reading 2 files in this browser."],
    [importMessages.reconciliationCandidates, "1 entry reconciliation match needs a decision", "2 entry reconciliation matches need a decision"],
    [importMessages.needsReviewRows, "1 row needs review", "2 rows need review"],
    [importMessages.deleteDiagnosticEntriesLabel, "Delete 1 ledger row", "Delete 2 ledger rows"],
    [importMessages.deleteDiagnosticEntriesProgress, "Deleting 1 ledger row and refreshing", "Deleting 2 ledger rows and refreshing"],
    [importMessages.deleteDiagnosticEntriesSuccess, "1 ledger row deleted.", "2 ledger rows deleted."]
  ];
  for (const [format, one, two] of cases) {
    assert.ok(format(1).startsWith(one), `${format(1)} should start with ${one}`);
    assert.ok(format(2).startsWith(two), `${format(2)} should start with ${two}`);
  }

  assert.equal(
    importMessages.intakeRowDetail({ sourceKind: "UOB card statement", month: "May 2026", cardCount: 2, rowCount: 10 }),
    "UOB card statement · May 2026 · 2 cards · 10 rows"
  );
  assert.equal(
    importMessages.intakeRowDetail({ sourceKind: "CSV file", month: "", cardCount: 0, rowCount: 1 }),
    "CSV file · 1 row"
  );
  assert.equal(
    importMessages.intakeSummary({ total: 2, ready: 1, ambiguous: 0, unexpected: 1, duplicate: 0 }),
    "2 files · 1 matches a file you need · 1 not on your checklist"
  );
  assert.equal(importMessages.recentPageSummary(1, 1, 1), "Showing 1-1 of 1 import");
  assert.equal(importMessages.recentPageSummary(1, 10, 12), "Showing 1-10 of 12 imports");
  assert.equal(settingsMessages.transferPage(1, 1, 1), "Page 1 of 1 (1 transfer)");
  assert.equal(settingsMessages.transferPage(1, 2, 12), "Page 1 of 2 (12 transfers)");
  assert.equal(
    settingsMessages.statementCompareSummary({ accountName: "UOB One", checkpointMonth: "2026-05", matchedRowCount: 0, statementRowCount: 1 }),
    "UOB One 2026-05: 0 of 1 statement row matched"
  );
  assert.equal(
    settingsMessages.statementCompareSummary({ accountName: "UOB One", checkpointMonth: "2026-05", matchedRowCount: 3, statementRowCount: 4 }),
    "UOB One 2026-05: 3 of 4 statement rows matched"
  );
  assert.equal(splitsMessages.includedSplitRecords(1), "1 included split record");
  assert.equal(splitsMessages.includedSplitRecords(3), "3 included split records");
  assert.equal(splitsMessages.entryCount(1), "1 entry");
  assert.equal(splitsMessages.entryCount(4), "4 entries");

  const oneRowConfirm = importMessages.deleteDiagnosticEntriesConfirm({ count: 1, amount: "$5.00" });
  assert.match(oneRowConfirm, /^Delete the 1 unresolved ledger row shown here now\? It nets to \$5\.00\./);
  assert.match(importMessages.deleteDiagnosticEntriesConfirm({ count: 2, amount: "$5.00" }), /^Delete all 2 unresolved ledger rows shown here now\? Together these rows net to \$5\.00\./);
});

test("the Delete month warning mentions the demo only on the demo site", () => {
  assert.equal(
    monthMessages.deleteMonthDetail({ isDemo: true }),
    "This removes the current month entirely from the demo, including its summary snapshot."
  );
  for (const isDemo of [false, undefined]) {
    const detail = monthMessages.deleteMonthDetail({ isDemo });
    assert.equal(detail, "This removes the current month entirely, including its summary snapshot.");
    assert.doesNotMatch(detail, /demo/i);
  }
});

test("a page that could not load is named in plain words", () => {
  assert.equal(messages.common.pageLoadErrorTitleFor("Imports"), "The Imports page could not load.");
  assert.equal(messages.common.pageLoadErrorTitleFor("Settings"), "The Settings page could not load.");
  assert.equal(messages.common.pageLoadErrorTitleFor(""), "This page could not load.");
});

test("the Apple Pay section uses plain words", () => {
  assert.equal(settingsMessages.shortcutAdvancedTitle, "More shortcut settings");
  assert.equal(
    settingsMessages.shortcutDefaultAccountsDetail,
    "If the shortcut doesn't name an account, entries go to the first account in this list."
  );
  for (const text of [settingsMessages.shortcutAdvancedTitle, settingsMessages.shortcutDefaultAccountsDetail]) {
    assert.doesNotMatch(text, /API|accountId|accountName|account_id/);
  }
});

test("a statement card counts the rows the ledger already has in plain words", () => {
  assert.equal(importMessages.statementCardCounts(34, 0), "34 new rows · none already in your ledger");
  assert.equal(importMessages.statementCardCounts(1, 26), "1 new row · 26 already in your ledger");
  assert.doesNotMatch(importMessages.statementCardCounts(34, 0), /confirm entries you have/);
});

test("the commit notice names the file it imported", () => {
  assert.equal(
    importMessages.recentCommitSuccess("One Account_Sep 2026.pdf"),
    "File imported: One Account_Sep 2026.pdf. Recent imports have been updated."
  );
  assert.equal(
    importMessages.recentCommitSuccess("PERSONAL CREDIT CARD STATEMENT_Sep 2026.pdf", ["UOB One Card - Tim", "UOB Privi Miles - Tim"]),
    "File imported: PERSONAL CREDIT CARD STATEMENT_Sep 2026.pdf into UOB One Card - Tim and UOB Privi Miles - Tim. Recent imports have been updated."
  );
});
