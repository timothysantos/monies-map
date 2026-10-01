// Statement fixes through the real Worker and a real local D1 (Miniflare,
// seeded with the demo household; no AI binding, so every check below also
// proves the workflow needs no AI). The scenario is the two-card UOB
// statement with two purchases recorded on the wrong card
// (tests/support/uob-wrong-card-scenario.mjs).
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import {
  commitBody,
  LADYS_CARD,
  ONE_CARD,
  previewStatement,
  setUpWrongCardScenario,
  suggestedFixes
} from "./support/uob-wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

function reconciliationFor(preview, accountName) {
  return preview.statementReconciliations.find((item) => item.accountName === accountName);
}

async function entryState(db, entryId) {
  const [row] = await rows(db, `
    SELECT transactions.account_id, accounts.account_name, transactions.transaction_date,
      transactions.post_date, transactions.description, transactions.bank_certification_status,
      transactions.note, categories.name AS category_name
    FROM transactions
    JOIN accounts ON accounts.id = transactions.account_id
    JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.id = ?
  `, entryId);
  return row;
}

test("the statement check finds the wrong-card entries and approving the moves closes both cards", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { oneCardId, ladysCardId, entryIds, statement } = await setUpWrongCardScenario(api);

  const preview = await previewStatement(api, statement);

  // Without the moves One Card looks closed only because OPENAI and
  // Buyandship would be added there a second time.
  assert.equal(reconciliationFor(preview, ONE_CARD).status, "matched");
  assert.deepEqual([reconciliationFor(preview, LADYS_CARD).status, reconciliationFor(preview, LADYS_CARD).deltaMinor], ["mismatch", -4262]);
  const openaiRow = preview.previewRows.find((row) => row.description === "OPENAI OPENAI.COM");
  assert.deepEqual([openaiRow.accountName, openaiRow.commitStatus, openaiRow.reconciliationTargetTransactionId], [ONE_CARD, "included", undefined]);

  const diagnosis = preview.statementDiagnosis;
  assert.deepEqual(diagnosis.findings.map((finding) => [finding.kind, finding.confidence, finding.entry?.description, finding.effectMinor]), [
    ["wrong_account", "high", "OpenAI", 2949],
    ["wrong_account", "high", "Buyandship", 1313]
  ]);
  assert.deepEqual(diagnosis.findings[0].statementRow, {
    rowIndex: openaiRow.rowIndex,
    accountId: oneCardId,
    description: "OPENAI OPENAI.COM",
    transactionDate: "2026-04-20",
    postedDate: "2026-04-22",
    signedAmountMinor: -2949
  });
  assert.deepEqual(diagnosis.cards.map((card) => [card.accountName, card.deltaMinor, card.projectedDeltaMinor, card.outcome]), [
    [ONE_CARD, 0, 0, "resolved"],
    [LADYS_CARD, -4262, 0, "resolved"]
  ]);
  // Sabai Sabai is after the statement: provisional for the next one, and
  // not part of the difference.
  const ladys = diagnosis.cards.find((card) => card.accountName === LADYS_CARD);
  assert.deepEqual([ladys.laterStatementEntryCount, ladys.laterStatementEntries[0].description], [1, "Sabai Sabai - Valley P"]);

  const fixes = suggestedFixes(preview);
  assert.deepEqual(fixes.map((fix) => [fix.kind, fix.entryId, fix.fromAccountId, fix.toAccountId]), [
    ["move_to_statement_account", entryIds.openai, ladysCardId, oneCardId],
    ["move_to_statement_account", entryIds.buyandship, ladysCardId, oneCardId]
  ]);

  // Approving the moves refreshes the check: both cards close, and the
  // statement certifies the moved entries instead of adding copies.
  const fixed = await previewStatement(api, statement, fixes);
  assert.deepEqual(fixed.statementReconciliations.map((item) => [item.accountName, item.status, item.deltaMinor]), [
    [ONE_CARD, "matched", 0],
    [LADYS_CARD, "matched", 0]
  ]);
  const fixedOpenaiRow = fixed.previewRows.find((row) => row.description === "OPENAI OPENAI.COM");
  assert.equal(fixedOpenaiRow.reconciliationTargetTransactionId, entryIds.openai);
  assert.equal(fixed.statementDiagnosis.appliedFixes.length, 2);
  assert.deepEqual(fixed.statementDiagnosis.findings.map((finding) => [finding.id, finding.applied]), [
    [`wrong_account:${entryIds.openai}`, true],
    [`wrong_account:${entryIds.buyandship}`, true]
  ]);
  assert.equal(fixed.previewRows.filter((row) => row.commitStatus === "included" && !row.reconciliationTargetTransactionId).length, 6);
});

test("committing approved moves certifies the entries on their statement card and records the correction", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { oneCardId, ladysCardId, entryIds, statement } = await setUpWrongCardScenario(api);
  const fixes = suggestedFixes(await previewStatement(api, statement));
  const fixed = await previewStatement(api, statement, fixes);

  const { status, payload } = await api("/api/imports/commit", commitBody(statement, fixed, fixes));
  assert.equal(status, 200, JSON.stringify(payload));

  // The statement's bank facts, on One Card, with the user's category and
  // note kept.
  assert.deepEqual(await entryState(db, entryIds.openai), {
    account_id: oneCardId,
    account_name: ONE_CARD,
    transaction_date: "2026-04-20",
    post_date: "2026-04-22",
    description: "OPENAI OPENAI.COM",
    bank_certification_status: "statement_certified",
    note: "Recorded by hand",
    category_name: "Subscriptions MO"
  });
  assert.equal((await entryState(db, entryIds.buyandship)).account_id, oneCardId);
  // Sabai Sabai is untouched.
  assert.deepEqual(
    [(await entryState(db, entryIds.sabai)).account_id, (await entryState(db, entryIds.sabai)).bank_certification_status],
    [ladysCardId, "provisional"]
  );
  // One entry per purchase: no copies on One Card.
  const oneCardOpenai = await rows(db, "SELECT id FROM transactions WHERE account_id = ? AND amount_minor = 2949", oneCardId);
  assert.deepEqual(oneCardOpenai.map((row) => row.id), [entryIds.openai]);

  const certificates = await rows(db, `
    SELECT account_id, delta_minor, status FROM statement_reconciliation_certificates
    WHERE import_id = ? ORDER BY account_id
  `, payload.importId);
  assert.deepEqual(certificates.map((row) => [row.account_id, row.delta_minor, row.status]).sort(), [
    [ladysCardId, 0, "certified"],
    [oneCardId, 0, "certified"]
  ].sort());

  const recordedFixes = await rows(db, `
    SELECT transaction_id, fix_kind, from_account_id, to_account_id
    FROM import_statement_fixes WHERE import_id = ? ORDER BY transaction_id
  `, payload.importId);
  assert.deepEqual(recordedFixes, [
    { transaction_id: entryIds.buyandship, fix_kind: "move_to_statement_account", from_account_id: ladysCardId, to_account_id: oneCardId },
    { transaction_id: entryIds.openai, fix_kind: "move_to_statement_account", from_account_id: ladysCardId, to_account_id: oneCardId }
  ].sort((left, right) => left.transaction_id.localeCompare(right.transaction_id)));

  // The audit trail names both accounts, so the move can be reviewed later.
  const audit = await rows(db, "SELECT entity_id, action, detail FROM audit_events WHERE action = 'entry_moved_by_statement' ORDER BY entity_id");
  assert.deepEqual(audit.map((row) => row.entity_id).sort(), [entryIds.openai, entryIds.buyandship].sort());
  assert.match(audit.find((row) => row.entity_id === entryIds.openai).detail, /^Moved OpenAI from UOB Lady's Card to UOB One Card: the eStatement_UOB_Cards_12May2026 statement lists it under UOB One Card\.$/);
});

test("rolling the statement back moves the entries back to their original card", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { ladysCardId, entryIds, statement } = await setUpWrongCardScenario(api);
  const before = await entryState(db, entryIds.openai);
  const fixes = suggestedFixes(await previewStatement(api, statement));
  const fixed = await previewStatement(api, statement, fixes);
  const commit = await api("/api/imports/commit", commitBody(statement, fixed, fixes));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));

  const rollback = await api("/api/imports/rollback", { importId: commit.payload.importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));

  assert.deepEqual(await entryState(db, entryIds.openai), before);
  assert.equal((await entryState(db, entryIds.buyandship)).account_id, ladysCardId);
  assert.deepEqual(await rows(db, "SELECT id FROM import_statement_fixes WHERE import_id = ?", commit.payload.importId), []);
  const audit = await rows(db, "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at, rowid", entryIds.openai);
  assert.deepEqual(audit.map((row) => row.action), ["entry_created", "entry_moved_by_statement", "entry_moved_back_by_rollback"]);

  // The statement can be previewed again and finds the same moves.
  assert.equal(suggestedFixes(await previewStatement(api, statement)).length, 2);
});

test("a fix that no longer holds is refused by the preview and by the commit", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { oneCardId, ladysCardId, entryIds, statement } = await setUpWrongCardScenario(api);
  const fixes = suggestedFixes(await previewStatement(api, statement));
  const fixed = await previewStatement(api, statement, fixes);

  // Someone moved OpenAI to UOB Savings after the preview.
  const update = await api("/api/entries/update", {
    entryId: entryIds.openai,
    date: "2026-04-20",
    description: "OpenAI",
    accountName: "UOB Savings",
    categoryName: "Subscriptions MO",
    amountMinor: 2949,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  assert.equal(update.status, 200, JSON.stringify(update.payload));

  const stale = await previewStatement(api, statement, fixes);
  assert.deepEqual(stale.statementDiagnosis.rejectedFixes.map((item) => [item.fix.entryId, item.reason]), [
    [entryIds.openai, "The entry is no longer on the account it was found on."]
  ]);
  assert.equal(stale.statementDiagnosis.appliedFixes.length, 1);

  const commit = await api("/api/imports/commit", commitBody(statement, fixed, fixes));
  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /The entry is no longer on the account it was found on\. Refresh the statement check and try again\./);
  // Nothing was written: Buyandship is still on Lady's Card.
  assert.equal((await entryState(db, entryIds.buyandship)).account_id, ladysCardId);
  assert.deepEqual(await rows(db, "SELECT id FROM imports WHERE source_label = 'eStatement_UOB_Cards_12May2026'"), []);

  // A move to an account that is not on the statement is refused outright.
  const foreign = await previewStatement(api, statement, [{ ...fixes[1], toAccountId: "acct-uob-savings" }]);
  assert.deepEqual(foreign.statementDiagnosis.rejectedFixes.map((item) => item.reason), ["The destination account is not on this statement."]);
  assert.notEqual(oneCardId, "acct-uob-savings");
});

test("a move the commit cannot certify on its statement card is refused", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { statement } = await setUpWrongCardScenario(api);
  const fixes = suggestedFixes(await previewStatement(api, statement));
  // A preview without the moves: the OPENAI row would be a new entry, so the
  // moved entry would sit on One Card uncertified, beside a copy.
  const unfixed = await previewStatement(api, statement);

  const commit = await api("/api/imports/commit", commitBody(statement, unfixed, fixes));
  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /A moved entry must be certified by its statement row\. Refresh the statement check and try again\./);
});

test("the server works out each certificate itself instead of trusting the preview's numbers", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { ladysCardId, statement } = await setUpWrongCardScenario(api);
  const preview = await previewStatement(api, statement);
  // A client that claims Lady's Card closed.
  const body = commitBody(statement, preview);
  body.statementReconciliations = body.statementReconciliations.map((item) => ({ ...item, status: "matched", deltaMinor: 0 }));

  const commit = await api("/api/imports/commit", body);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [certificate] = await rows(db, `
    SELECT delta_minor, status FROM statement_reconciliation_certificates
    WHERE import_id = ? AND account_id = ?
  `, commit.payload.importId, ladysCardId);
  assert.deepEqual(certificate, { delta_minor: -4262, status: "exception" });
});
