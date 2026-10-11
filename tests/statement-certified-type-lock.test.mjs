// A statement certificate locks an entry's bank facts: account, dates,
// description, amount and which way the money moved. Income and transfer in
// both add to the balance, expense and transfer out both take from it, so
// switching within one direction is the app's reading of the row, not a bank
// fact, and stays editable. Rolling the statement back keeps a transfer type
// that a link made since needs. Real local D1 (Miniflare) seeded with the
// demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const ACCOUNT_NAME = "Type Lock Savings";

const statementCheckpoints = (accountId) => [{
  accountId,
  accountName: ACCOUNT_NAME,
  detectedAccountName: ACCOUNT_NAME,
  checkpointMonth: "2026-05",
  statementStartDate: "2026-05-01",
  statementEndDate: "2026-05-31",
  statementBalanceMinor: 53_400 - 1_250,
  note: "Type lock checkpoint"
}];

const statementRows = (accountId) => [
  { date: "2026-05-20", description: "OWN ACCOUNT TRANSFER", income: "534.00", accountId, account: ACCOUNT_NAME, category: "Other" },
  { date: "2026-05-21", description: "NTUC FAIRPRICE", expense: "12.50", accountId, account: ACCOUNT_NAME, category: "Groceries" }
];

function previewStatement(api, accountId) {
  return api("/api/imports/preview", {
    sourceLabel: "Type lock statement",
    sourceType: "pdf",
    rows: statementRows(accountId),
    defaultAccountName: ACCOUNT_NAME,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: statementCheckpoints(accountId)
  });
}

// A savings account with a manual credit and a manual purchase that a
// statement then certifies, closing May.
async function certifiedSavings(api, db) {
  const created = await api("/api/accounts/create", {
    name: ACCOUNT_NAME,
    institution: "Synthetic Test Bank",
    kind: "bank",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const accountId = created.payload.accountId;
  const creditId = await createEntry(api, { date: "2026-05-20", description: "OWN ACCOUNT TRANSFER", accountName: ACCOUNT_NAME, accountId, categoryName: "Other", amountMinor: 53_400, entryType: "income" });
  const purchaseId = await createEntry(api, { date: "2026-05-21", description: "NTUC FAIRPRICE", accountName: ACCOUNT_NAME, accountId, categoryName: "Groceries", amountMinor: 1_250, entryType: "expense" });

  const preview = await previewStatement(api, accountId);
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const previewRows = preview.payload.preview.previewRows;
  assert.deepEqual(previewRows.map((row) => row.reconciliationTargetTransactionId), [creditId, purchaseId], "the statement certifies both manual entries");
  const commit = await api("/api/imports/commit", {
    sourceLabel: "Type lock statement",
    sourceType: "pdf",
    parserKey: "uob_savings_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints: statementCheckpoints(accountId),
    statementControlRows: previewRows,
    statementReconciliations: preview.payload.preview.statementReconciliations
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, "SELECT id, bank_certification_status FROM transactions WHERE account_id = ? ORDER BY transaction_date", accountId), [
    { id: creditId, bank_certification_status: "statement_certified" },
    { id: purchaseId, bank_certification_status: "statement_certified" }
  ]);
  assert.deepEqual(await rows(db, "SELECT checkpoint_month FROM account_balance_checkpoints WHERE account_id = ?", accountId), [{ checkpoint_month: "2026-05" }]);
  return { accountId, creditId, purchaseId, statementImportId: commit.payload.importId };
}

function entryUpdate(entryId, accountId, overrides) {
  return {
    entryId,
    date: "2026-05-20",
    description: "OWN ACCOUNT TRANSFER",
    accountId,
    categoryName: "Other",
    amountMinor: 53_400,
    entryType: "income",
    ownershipType: "direct",
    ownerName: "Tim",
    ...overrides
  };
}

test("a certified credit can be refiled between income and transfer in, and a later copy of the statement still covers it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { accountId, creditId } = await certifiedSavings(api, db);
  const certifiedBefore = await rows(db, "SELECT bank_certification_status, statement_certified_import_id, statement_certified_previous_entry_type FROM transactions WHERE id = ?", creditId);

  // An own-account credit filed as income becomes a transfer in.
  const toTransfer = await api("/api/entries/update", entryUpdate(creditId, accountId, { categoryName: "Transfer", entryType: "transfer", transferDirection: "in" }));
  assert.equal(toTransfer.status, 200, JSON.stringify(toTransfer.payload));
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_direction, amount_minor, description FROM transactions WHERE id = ?", creditId), [
    { entry_type: "transfer", transfer_direction: "in", amount_minor: 53_400, description: "OWN ACCOUNT TRANSFER" }
  ]);

  // A payroll credit filed as a transfer in becomes Salary income, through
  // the statement-compare classification route.
  const toIncome = await api("/api/entries/update-classification", { entryId: creditId, entryType: "income", categoryName: "Salary" });
  assert.equal(toIncome.status, 200, JSON.stringify(toIncome.payload));
  assert.deepEqual(await rows(db, `
    SELECT transactions.entry_type, transactions.transfer_direction, categories.name AS category_name
    FROM transactions LEFT JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.id = ?
  `, creditId), [{ entry_type: "income", transfer_direction: null, category_name: "Salary" }]);

  // The certificate is untouched: still certified by the same statement,
  // with the same pre-certification state underneath for a rollback.
  assert.deepEqual(await rows(db, "SELECT bank_certification_status, statement_certified_import_id, statement_certified_previous_entry_type FROM transactions WHERE id = ?", creditId), certifiedBefore);

  // Leave it as a transfer in: a replacement copy of the same statement
  // still finds the row already on the confirmed statement.
  const again = await api("/api/entries/update", entryUpdate(creditId, accountId, { categoryName: "Transfer", entryType: "transfer", transferDirection: "in" }));
  assert.equal(again.status, 200, JSON.stringify(again.payload));
  const replacement = await previewStatement(api, accountId);
  assert.equal(replacement.status, 200, JSON.stringify(replacement.payload));
  const creditRow = replacement.payload.preview.previewRows.find((row) => row.description === "OWN ACCOUNT TRANSFER");
  assert.equal(creditRow.commitStatus, "skipped", JSON.stringify(creditRow));
  assert.equal(creditRow.reconciliationMatch?.existingTransactionId, creditId);
  assert.equal(creditRow.reconciliationMatch?.existingBankCertificationStatus, "statement_certified");
  assert.equal(creditRow.isCertifiedConflict, false);
  const [reconciliation] = replacement.payload.preview.statementReconciliations;
  assert.equal(reconciliation.status, "matched");
  assert.equal(reconciliation.deltaMinor, 0);
  assert.equal(reconciliation.projectedLedgerBalanceMinor, 53_400 - 1_250);
});

test("a certified purchase can be refiled as a transfer out", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { accountId, purchaseId } = await certifiedSavings(api, db);

  const toTransfer = await api("/api/entries/update-classification", { entryId: purchaseId, entryType: "transfer", transferDirection: "out", categoryName: "Transfer" });

  assert.equal(toTransfer.status, 200, JSON.stringify(toTransfer.payload));
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_direction, amount_minor, account_id FROM transactions WHERE id = ?", purchaseId), [
    { entry_type: "transfer", transfer_direction: "out", amount_minor: 1_250, account_id: accountId }
  ]);
});

test("a certified entry still refuses a change of money direction or of any other bank fact", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { accountId, creditId, purchaseId } = await certifiedSavings(api, db);
  const before = await dumpDatabase(db);
  const lockMessage = /bank facts are locked by the 2026-05 statement certificate/;

  const refused = [
    // Money out becomes money in.
    await api("/api/entries/update-classification", { entryId: purchaseId, entryType: "income", categoryName: "Salary" }),
    await api("/api/entries/update-classification", { entryId: purchaseId, entryType: "transfer", transferDirection: "in", categoryName: "Transfer" }),
    // Money in becomes money out.
    await api("/api/entries/update", entryUpdate(creditId, accountId, { categoryName: "Groceries", entryType: "expense" })),
    await api("/api/entries/update", entryUpdate(creditId, accountId, { categoryName: "Transfer", entryType: "transfer", transferDirection: "out" })),
    // A same-direction type change does not unlock the other bank facts.
    await api("/api/entries/update", entryUpdate(creditId, accountId, { categoryName: "Transfer", entryType: "transfer", transferDirection: "in", description: "OWN ACCOUNT TRANSFER EDITED" })),
    await api("/api/entries/update", entryUpdate(creditId, accountId, { amountMinor: 53_401 })),
    await api("/api/entries/update", entryUpdate(creditId, accountId, { date: "2026-05-19" }))
  ];

  for (const response of refused) {
    assert.notEqual(response.status, 200, JSON.stringify(response.payload));
    assert.match(response.payload.error, lockMessage);
  }
  assertSameDatabase(await dumpDatabase(db), before);
});

test("rolling back the statement keeps a refiled credit's transfer link whole", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { accountId, creditId, statementImportId } = await certifiedSavings(api, db);
  const outId = await createEntry(api, { date: "2026-05-20", description: "TO SAVINGS", accountName: "UOB One", categoryName: "Transfer", amountMinor: 53_400, entryType: "transfer", transferDirection: "out" });
  const refile = await api("/api/entries/update", entryUpdate(creditId, accountId, { categoryName: "Transfer", entryType: "transfer", transferDirection: "in" }));
  assert.equal(refile.status, 200, JSON.stringify(refile.payload));
  const link = await api("/api/transfers/link", { fromEntryId: outId, toEntryId: creditId });
  assert.equal(link.status, 200, JSON.stringify(link.payload));

  const rollback = await api("/api/imports/rollback", { importId: statementImportId });

  // The certificate goes and the other bank facts return to the manual
  // entry's, but the entry stays the transfer in its kept link needs.
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT id, entry_type, transfer_direction, transfer_group_id, bank_certification_status, amount_minor FROM transactions WHERE id IN (?, ?) ORDER BY description", creditId, outId), [
    { id: creditId, entry_type: "transfer", transfer_direction: "in", transfer_group_id: link.payload.groupId, bank_certification_status: "provisional", amount_minor: 53_400 },
    { id: outId, entry_type: "transfer", transfer_direction: "out", transfer_group_id: link.payload.groupId, bank_certification_status: "provisional", amount_minor: 53_400 }
  ]);
});

test("rolling back the statement puts an unlinked refiled credit back as the manual entry it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { accountId, creditId, statementImportId } = await certifiedSavings(api, db);
  const refile = await api("/api/entries/update", entryUpdate(creditId, accountId, { categoryName: "Transfer", entryType: "transfer", transferDirection: "in" }));
  assert.equal(refile.status, 200, JSON.stringify(refile.payload));

  const rollback = await api("/api/imports/rollback", { importId: statementImportId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_direction, transfer_group_id, bank_certification_status FROM transactions WHERE id = ?", creditId), [
    { entry_type: "income", transfer_direction: null, transfer_group_id: null, bank_certification_status: "provisional" }
  ]);
});
