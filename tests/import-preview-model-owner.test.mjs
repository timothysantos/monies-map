import assert from "node:assert/strict";
import test from "node:test";

import { getImportRowsOwnerName } from "../src/client/import-preview-model.js";

const row = (patch) => ({ ownershipType: "direct", ownerName: "Joyce", commitStatus: "included", ...patch });

test("the file card names the one owner every added row has, whoever the form defaults to", () => {
  assert.equal(getImportRowsOwnerName([row({}), row({}), row({})]), "Joyce");
});

test("a person's own owner pick on one row stops the card naming one person", () => {
  assert.equal(getImportRowsOwnerName([row({}), row({ ownerName: "Tim" })]), undefined);
});

test("rows that are skipped or already in the ledger do not decide the owner", () => {
  assert.equal(getImportRowsOwnerName([
    row({}),
    row({ ownerName: "Tim", commitStatus: "skipped" }),
    row({ ownerName: "Tim", reconciliationTargetTransactionId: "txn-1" })
  ]), "Joyce");
});

test("shared rows and an empty preview name no owner", () => {
  assert.equal(getImportRowsOwnerName([row({ ownershipType: "shared", ownerName: undefined })]), undefined);
  assert.equal(getImportRowsOwnerName([]), undefined);
});

// A file whose rows are all already in the ledger still belongs to its
// account's owner: rows that only update or confirm existing entries carry
// the direct account's owner too (the server sets it), and must not hide it.
test("a file on a direct account with nothing to import still names the account's owner", () => {
  assert.equal(getImportRowsOwnerName([
    row({ ownerName: "Tim", commitStatus: "skipped" }),
    row({ ownerName: "Tim", reconciliationTargetTransactionId: "txn-1" }),
    row({ ownerName: "Tim", isStatementMatchResolved: true })
  ]), "Tim");
});

test("rows that only update existing entries name the account's owner", () => {
  assert.equal(getImportRowsOwnerName([
    row({ ownerName: "Tim", reconciliationTargetTransactionId: "txn-1" }),
    row({ ownerName: "Tim", reconciliationTargetTransactionId: "txn-2" })
  ]), "Tim");
});

test("covered rows on two people's accounts name no owner", () => {
  assert.equal(getImportRowsOwnerName([
    row({ ownerName: "Tim", commitStatus: "skipped" }),
    row({ ownerName: "Joyce", commitStatus: "skipped" })
  ]), undefined);
});

test("rows to import on two people's accounts name no owner", () => {
  assert.equal(getImportRowsOwnerName([row({ ownerName: "Tim" }), row({ ownerName: "Joyce" })]), undefined);
});

test("a joint account's rows keep the import's own owner, as the card showed before", () => {
  // The server gives a joint account's direct rows the import form's owner.
  assert.equal(getImportRowsOwnerName([row({ ownerName: "Tim" }), row({ ownerName: "Tim" })]), "Tim");
  assert.equal(getImportRowsOwnerName([row({ ownerName: "Tim", commitStatus: "skipped" })]), "Tim");
  assert.equal(getImportRowsOwnerName([row({ ownershipType: "shared", ownerName: undefined, commitStatus: "skipped" })]), undefined);
});

test("an owner picked on a covered row that differs stops the card naming one person", () => {
  assert.equal(getImportRowsOwnerName([
    row({ ownerName: "Tim", commitStatus: "skipped" }),
    row({ ownerName: "Joyce", reconciliationTargetTransactionId: "txn-1" })
  ]), undefined);
});
