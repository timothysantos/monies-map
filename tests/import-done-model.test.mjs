import assert from "node:assert/strict";
import test from "node:test";

import { buildImportDoneSummary } from "../src/client/import-done-model.js";
import { importMessages } from "../src/client/copy/en-SG-imports.js";

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
    "The import of PERSONAL CREDIT CARD STATEMENT_Sep 2026.pdf into UOB One Card - Tim and UOB Privi Miles - Tim for the 13 Aug 2026 – 13 Sep 2026 statement is done. No further action needed."
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
    "The import of ACCT_activity.csv into OCBC 360 and UOB One, covering 3 Sep 2026 – 9 Sep 2026, is done. No further action needed."
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
  assert.equal(importMessages.doneRowsDetail(activity.counts), "1 row added · 0 entries confirmed · 1 entry the bank no longer lists removed");

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

const stashawayAccounts = [{ id: "acct-sa", name: "Tim StashAway", ownerLabel: "Tim" }];
const investmentValue = (overrides = {}) => ({
  accountId: "acct-sa",
  accountName: "Tim StashAway",
  detectedAccountName: "Tim StashAway",
  accountKind: "investment",
  checkpointMonth: "2026-03",
  asOfDate: "2026-03-31",
  totalAssetsMinor: 1535771,
  cashMinor: 0,
  currency: "SGD",
  ...overrides
});

test("a value-only investment statement's Done card names the account, the saved value and its date, not rows", () => {
  const summary = buildImportDoneSummary({
    importId: "import-sa",
    title: "mar_tim_stashaway_2026",
    sourceLabel: "mar_tim_stashaway_2026",
    fileName: "mar_tim_stashaway_2026.pdf",
    accounts: stashawayAccounts,
    preview: { investmentValues: [investmentValue()] },
    previewRows: [],
    statementReconciliations: [],
    isStatement: false
  });

  assert.equal(
    summary.confirmation,
    "The import of mar_tim_stashaway_2026.pdf into Tim StashAway - Tim, covering 31 Mar 2026, is done. No further action needed."
  );
  assert.deepEqual(summary.investmentSaves, [{ accountName: "Tim StashAway", accountLabel: "Tim StashAway - Tim", valueMinor: 1535771, asOfDate: "2026-03-31" }]);
  assert.deepEqual(summary.counts, { added: 0, confirmed: 0, removed: 0, paired: 0 });
  assert.equal(importMessages.doneInvestmentSaved("Tim StashAway", "$15,357.71", "31 Mar 2026"), "Saved Tim StashAway's value: $15,357.71 on 31 Mar 2026");
  assert.equal(importMessages.doneInvestmentPayments({ added: 0, paired: 0 }), "");
});

test("an investment statement with payments says how many were added and paired with bank transfers", () => {
  const paired = row({ accountId: "acct-sa", accountName: "Tim StashAway", date: "2026-09-02", transferMatch: { transactionId: "txn-bank" } });
  const summary = buildImportDoneSummary({
    importId: "import-sa-2",
    title: "sep_tim_stashaway_2026",
    sourceLabel: "sep_tim_stashaway_2026",
    accounts: stashawayAccounts,
    preview: { investmentValues: [investmentValue({ checkpointMonth: "2026-09", asOfDate: "2026-09-30" })] },
    previewRows: [paired, row({ accountId: "acct-sa", accountName: "Tim StashAway", date: "2026-09-03", transferMatch: { transactionId: "txn-bank-2" } })],
    statementReconciliations: [],
    isStatement: false
  });

  assert.deepEqual(summary.counts, { added: 2, confirmed: 0, removed: 0, paired: 2 });
  assert.equal(importMessages.doneInvestmentPayments(summary.counts), "2 payments added and paired with bank transfers");
  assert.equal(importMessages.doneInvestmentPayments({ added: 1, paired: 1 }), "1 payment added and paired with a bank transfer");
  assert.equal(importMessages.doneInvestmentPayments({ added: 3, paired: 1 }), "3 payments added, 1 paired with a bank transfer");
  assert.equal(importMessages.doneInvestmentPayments({ added: 2, paired: 0 }), "2 payments added");
  // The payments' own dates name the period, as Recent imports does.
  assert.match(summary.confirmation, /into Tim StashAway - Tim, covering 2 Sep 2026 – 3 Sep 2026, is done/);
});

test("a statement with no investment value keeps the row counts and no investment lines", () => {
  const summary = buildImportDoneSummary({
    importId: "import-plain",
    title: "ACCT_349",
    sourceLabel: "ACCT_349",
    preview: {},
    previewRows: [row()],
    statementReconciliations: [],
    isStatement: false
  });
  assert.equal(summary.investmentSaves, undefined);
  assert.equal(importMessages.doneRowsDetail(summary.counts), "1 row added · 0 entries confirmed");
});
