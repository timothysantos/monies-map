import assert from "node:assert/strict";
import test from "node:test";

import { buildImportDoneSummary } from "../src/client/import-done-model.js";

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
  assert.deepEqual(summary.cards[0].counts, { added: 1, confirmed: 1, moved: 0, later: 0 });
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
  assert.deepEqual(summary.counts, { added: 2, confirmed: 0 });
  assert.equal(summary.statusLabel, undefined);
});
