import assert from "node:assert/strict";
import test from "node:test";

import { buildImportDoneSummary } from "../src/client/import-done-model.js";
import { messages } from "../src/client/copy/en-SG.js";

const reconciliation = (overrides = {}) => ({
  accountId: "acct-uob-one",
  accountName: "UOB One",
  accountKind: "bank",
  checkpointMonth: "2026-08",
  statementStartDate: "2026-08-01",
  statementEndDate: "2026-08-31",
  statementBalanceMinor: 10183055,
  status: "matched",
  ...overrides
});

const row = (overrides = {}) => ({
  rowId: `row-${Math.random()}`,
  date: "2026-08-05",
  accountId: "acct-uob-one",
  accountName: "UOB One",
  commitStatus: "included",
  ...overrides
});

test("a balanced statement's Done card names the file, the account and the statement period, with nothing left to do", () => {
  const summary = buildImportDoneSummary({
    importId: "import-1",
    title: "UOB account statement · Aug 2026",
    sourceLabel: "One Account_Aug 2026",
    fileName: "One Account_Aug 2026.pdf",
    preview: {},
    previewRows: [row(), row({ reconciliationTargetTransactionId: "txn-1" }), row({ commitStatus: "skipped" })],
    statementReconciliations: [reconciliation()],
    isStatement: true
  });

  assert.equal(summary.title, "UOB account statement · Aug 2026 saved");
  assert.equal(
    summary.confirmation,
    "The import of One Account_Aug 2026.pdf into UOB One for the 1 Aug 2026 – 31 Aug 2026 statement is done. No further action needed."
  );
  assert.equal(summary.statusLabel, "Every card balanced");
  assert.equal(summary.statusTone, "success");
  assert.deepEqual(summary.cards[0].counts, { added: 1, confirmed: 1, moved: 0, later: 0, removed: 0 });
});

test("the Done card names each account with its owner, as Recent imports does", () => {
  const summary = buildImportDoneSummary({
    importId: "import-owner",
    title: "UOB card statement · Sept 2026",
    sourceLabel: "PERSONAL CREDIT CARD STATEMENT_Sep 2026",
    fileName: "PERSONAL CREDIT CARD STATEMENT_Sep 2026.pdf",
    accounts: [
      { id: "acct-one", name: "UOB One Card", ownerLabel: "Tim" },
      { id: "acct-privi", name: "UOB Privi Miles", ownerLabel: "Tim" },
      { id: "acct-other", name: "UOB One Card", ownerLabel: "Joyce" }
    ],
    preview: {},
    previewRows: [row({ accountId: "acct-one" }), row({ accountId: "acct-privi" })],
    statementReconciliations: [
      reconciliation({ accountId: "acct-one", accountName: "UOB One Card", statementStartDate: "2026-08-13", statementEndDate: "2026-09-13" }),
      reconciliation({ accountId: "acct-privi", accountName: "UOB Privi Miles", statementStartDate: "2026-08-13", statementEndDate: "2026-09-13" })
    ],
    isStatement: true
  });

  assert.equal(
    summary.confirmation,
    "The import of PERSONAL CREDIT CARD STATEMENT_Sep 2026.pdf into UOB One Card - Tim and UOB Privi Miles - Tim for the 13 Aug 2026 – 13 Sept 2026 statement is done. No further action needed."
  );
  // The card headings keep the plain account name.
  assert.deepEqual(summary.cards.map((card) => card.name), ["UOB One Card", "UOB Privi Miles"]);
});

test("a statement saved with a difference does not say no further action is needed", () => {
  const summary = buildImportDoneSummary({
    importId: "import-2",
    title: "UOB card statement · Aug 2026",
    sourceLabel: "eStatement_UOB_Cards",
    fileName: "eStatement_UOB_Cards.pdf",
    preview: {},
    previewRows: [row({ accountId: "acct-one" }), row({ accountId: "acct-lady" })],
    statementReconciliations: [
      reconciliation({ accountId: "acct-one", accountName: "UOB One Card" }),
      reconciliation({ accountId: "acct-lady", accountName: "UOB Lady's Card", status: "mismatch" })
    ],
    isStatement: true
  });

  assert.equal(
    summary.confirmation,
    "The import of eStatement_UOB_Cards.pdf into UOB One Card and UOB Lady's Card for the 1 Aug 2026 – 31 Aug 2026 statement is saved. Check the card saved with a difference."
  );
  assert.doesNotMatch(summary.confirmation, /No further action/);
  assert.equal(summary.statusLabel, "1 card saved with a difference");
  assert.equal(summary.statusTone, "warning");
});

test("a statement without dates is named by its month, and pasted rows by their source label", () => {
  const summary = buildImportDoneSummary({
    importId: "import-3",
    title: "OCBC statement",
    sourceLabel: "OCBC 360 statement 2026-08",
    preview: {},
    previewRows: [row()],
    statementReconciliations: [reconciliation({ statementStartDate: undefined, statementEndDate: undefined })],
    isStatement: true
  });

  assert.equal(
    summary.confirmation,
    "The import of OCBC 360 statement 2026-08 into UOB One for the Aug 2026 statement is done. No further action needed."
  );
});

test("an activity file's Done card covers the dates of the rows it committed, across its accounts", () => {
  const summary = buildImportDoneSummary({
    importId: "import-4",
    title: "ACCT_activity",
    sourceLabel: "ACCT_activity",
    fileName: "ACCT_activity.csv",
    preview: {},
    previewRows: [
      row({ date: "2026-09-09", accountName: "OCBC 360" }),
      row({ date: "2026-09-03", accountName: "UOB One" }),
      row({ date: "2026-10-01", accountName: "UOB One", commitStatus: "skipped" })
    ],
    statementReconciliations: [],
    isStatement: false
  });

  assert.equal(
    summary.confirmation,
    "The import of ACCT_activity.csv into OCBC 360 and UOB One, covering 3 Sept 2026 – 9 Sept 2026, is done. No further action needed."
  );
  assert.deepEqual(summary.counts, { added: 2, confirmed: 0, removed: 0 });
  assert.equal(summary.statusLabel, undefined);
});

test("the Done card counts the entries the bank no longer lists that the import removed", () => {
  const activity = buildImportDoneSummary({
    importId: "import-5",
    title: "ACCT_349_11_10_2026",
    sourceLabel: "ACCT_349_11_10_2026",
    preview: {},
    previewRows: [row({ date: "2026-10-09", accountName: "Citi Rewards" })],
    statementReconciliations: [],
    isStatement: false,
    removedEntryCount: 1
  });
  assert.equal(messages.imports.doneRowsDetail(activity.counts), "1 row added · 0 entries confirmed · 1 entry the bank no longer lists removed");

  // A statement removes a card's superseded rows only when the card balances.
  const statement = (status) => buildImportDoneSummary({
    importId: "import-6",
    title: "Citi Rewards Oct 2026",
    sourceLabel: "Citi Rewards Oct 2026",
    preview: {},
    previewRows: [],
    statementReconciliations: [reconciliation({ status, supersededLedgerRows: [{ transactionId: "txn-hold" }] })],
    isStatement: true
  }).cards[0].counts.removed;
  assert.deepEqual([statement("matched"), statement("mismatch")], [1, 0]);
});
