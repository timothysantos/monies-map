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
