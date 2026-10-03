// Statement fixes through the real Worker and a real local D1 (Miniflare,
// seeded with the demo household; no AI binding, so every check below also
// proves the workflow needs no AI). The scenario is the two-card UOB
// statement with two purchases recorded on the wrong card
// (tests/support/uob-wrong-card-scenario.mjs).
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
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

test("a later statement on the account an entry was moved off locks the earlier statement's rollback", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { entryIds, statement } = await setUpWrongCardScenario(api);
  // OpenAI was recorded on Tim's UOB One account, which is not on this
  // statement but is his account at the same bank.
  const update = await api("/api/entries/update", {
    entryId: entryIds.openai,
    date: "2026-04-20",
    description: "OpenAI",
    accountName: "UOB One",
    categoryName: "Subscriptions MO",
    amountMinor: 2949,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "Recorded by hand"
  });
  assert.equal(update.status, 200, JSON.stringify(update.payload));
  const preview = await previewStatement(api, statement);
  const openaiFix = suggestedFixes(preview).find((fix) => fix.entryId === entryIds.openai);
  assert.equal(openaiFix?.fromAccountId, "acct-uob-one");
  // UOB One is not on the statement, so moving OpenAI changes no card's
  // difference there: it only stops a copy on One Card.
  assert.equal(preview.statementDiagnosis.findings.find((item) => item.entry?.id === entryIds.openai).effectMinor, 0);
  const fixes = suggestedFixes(preview);
  const may = await api("/api/imports/commit", commitBody(statement, await previewStatement(api, statement, fixes), fixes));
  assert.equal(may.status, 200, JSON.stringify(may.payload));

  // UOB One's June statement is imported afterwards.
  const june = {
    rows: [{ date: "2026-06-03", description: "SHAW THEATRES SINGAPORE", expense: "12.00", account: "UOB One", category: "Entertainment" }],
    checkpoints: [{ accountName: "UOB One", checkpointMonth: "2026-06", statementEndDate: "2026-06-12", statementBalanceMinor: 1200 }],
    parserKey: "uob_credit_card_pdf"
  };
  const juneCommit = await api("/api/imports/commit", { ...commitBody(june, await previewStatement(api, june)), sourceLabel: "UOB One June" });
  assert.equal(juneCommit.status, 200, JSON.stringify(juneCommit.payload));

  // Moving OpenAI back onto UOB One would change its June statement.
  const rollback = await api("/api/imports/rollback", { importId: may.payload.importId });
  assert.equal(rollback.status, 409);
  assert.match(rollback.payload.error, /cannot be rolled back yet: it moved entries off an account that has a later statement/);
  assert.equal((await entryState(db, entryIds.openai)).account_name, ONE_CARD);

  const page = await api("/api/imports-page");
  const history = findHistory(page.payload);
  assert.equal(history.find((item) => item.id === may.payload.importId).rollbackProtected, true);
});

test("a statement-certified entry cannot be deleted on its own; a provisional one can", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { entryIds, statement } = await setUpWrongCardScenario(api);
  const fixes = suggestedFixes(await previewStatement(api, statement));
  const commit = await api("/api/imports/commit", commitBody(statement, await previewStatement(api, statement, fixes), fixes));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));

  const certified = await api("/api/entries/delete", { entryId: entryIds.openai });
  assert.equal(certified.status, 400);
  assert.equal(certified.payload.error, "This entry is certified by a bank statement, so it can't be deleted on its own. Roll back that statement import to remove it.");
  assert.equal((await entryState(db, entryIds.openai)).bank_certification_status, "statement_certified");

  // Sabai Sabai is still provisional (next statement), so it can go.
  const provisional = await api("/api/entries/delete", { entryId: entryIds.sabai });
  assert.equal(provisional.status, 200, JSON.stringify(provisional.payload));
  assert.equal(await entryState(db, entryIds.sabai), undefined);
});

test("a statement card is found by its remembered last four digits after the account is renamed", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { oneCardId, ladysCardId, statement } = await setUpWrongCardScenario(api);
  const fixes = suggestedFixes(await previewStatement(api, statement));
  const commit = await api("/api/imports/commit", commitBody(statement, await previewStatement(api, statement, fixes), fixes));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, "SELECT id, last4 FROM accounts WHERE id IN (?, ?) ORDER BY last4", oneCardId, ladysCardId), [
    { id: oneCardId, last4: "1111" },
    { id: ladysCardId, last4: "2222" }
  ]);

  const rename = await api("/api/accounts/update", {
    accountId: ladysCardId,
    name: "Tim Lady's Solitaire",
    institution: "UOB",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor: -1250,
    ownerPersonId: "person-tim",
    isJoint: false
  });
  assert.equal(rename.status, 200, JSON.stringify(rename.payload));

  const preview = await previewStatement(api, statement);
  assert.deepEqual(preview.statementAccountMatches, [{
    detectedAccountName: LADYS_CARD,
    accountId: ladysCardId,
    accountName: "Tim Lady's Solitaire",
    matchedBy: "card_last4"
  }]);
  assert.deepEqual(preview.unknownAccounts, []);
  assert.equal(preview.statementReconciliations.find((item) => item.accountId === ladysCardId)?.accountName, "Tim Lady's Solitaire");
  assert.ok(preview.previewRows.filter((row) => row.statementAccountName === LADYS_CARD).every((row) => row.accountId === ladysCardId));
});

function findHistory(payload) {
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.some((item) => item?.rollbackProtected !== undefined)) {
      return value;
    }
    if (value && typeof value === "object") {
      const nested = findHistory(value);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

// One Card's statement closes on 12 May. A $1.99 commute: rides bought on
// 9 and 11 May are on the statement; a ride recorded by hand on 12 May has
// not posted yet.
function withCommuteRides(statement) {
  const ride = (date, purchaseDate, id) => ({
    date,
    description: `BUS/MRT 00000000${id} SINGAPORE`,
    expense: "1.99",
    income: "",
    account: ONE_CARD,
    category: "Public Transport",
    note: `txn date: ${purchaseDate}`,
    type: "expense",
    reference: `0000000000000000000001${id}`
  });
  return { ...statement, rows: [...statement.rows, ride("2026-05-11", "2026-05-09", 5), ride("2026-05-12", "2026-05-11", 6)] };
}

test("a closing-day ride that posts next statement is not taken for the statement's ride the day before", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { statement } = await setUpWrongCardScenario(api);
  const lateRideId = await createEntry(api, { accountName: ONE_CARD, date: "2026-05-12", description: "BUS/MRT", amountMinor: 199, categoryName: "Other" });

  const preview = await previewStatement(api, withCommuteRides(statement));
  const rideRow = preview.previewRows.find((row) => row.description === "BUS/MRT 000000006 SINGAPORE");
  // The 11 May ride is new to the ledger; the 12 May entry waits for June.
  assert.deepEqual([rideRow.commitStatus, rideRow.reconciliationTargetTransactionId], ["included", undefined]);
  const lateRide = preview.statementDiagnosis.findings.find((finding) => finding.entry?.id === lateRideId);
  assert.deepEqual([lateRide.kind, lateRide.fix?.kind, lateRide.fix?.postDate], ["next_statement", "defer_to_next_statement", "2026-05-13"]);
});

test("a ride recorded on its own purchase day before the closing days still meets its statement row", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { statement } = await setUpWrongCardScenario(api);
  const rideId = await createEntry(api, { accountName: ONE_CARD, date: "2026-05-11", description: "BUS/MRT", amountMinor: 199, categoryName: "Other" });

  const preview = await previewStatement(api, withCommuteRides(statement));
  const rideRow = preview.previewRows.find((row) => row.description === "BUS/MRT 000000006 SINGAPORE");
  assert.equal(rideRow.reconciliationTargetTransactionId, rideId);
});
