// Statement corrections for data that is already saved, through the real
// Worker and a real local D1 (Miniflare, no AI binding). The statement is
// the sanitized two-card UOB statement; Settings "Compare statement" sends
// the card's rows and the other card's section, and gets the same
// deterministic diagnosis the import preview uses, after commit.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import {
  commitBody,
  compareLadysCard,
  LADYS_CARD,
  ONE_CARD,
  previewStatement,
  setUpHandRecordedStatement,
  setUpWrongCardScenario,
  STATEMENT_MONTH
} from "./support/uob-wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = STATEMENT_MONTH;

async function mayDeltas(api) {
  const { payload } = await api("/api/settings-page?view=household");
  return Object.fromEntries([ONE_CARD, LADYS_CARD].map((name) => {
    const account = payload.settingsPage.accounts.find((item) => item.name === name);
    return [name, account.checkpointHistory.find((checkpoint) => checkpoint.month === MONTH)?.deltaMinor];
  }));
}

test("after a statement is saved, entries on the wrong card are moved to it and both cards close; undo moves them back", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { oneCardId, ladysCardId, entryIds, statement } = await setUpHandRecordedStatement(api);
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 4262, [LADYS_CARD]: -4262 });

  const comparison = await compareLadysCard(api, statement, ladysCardId);
  const diagnosis = comparison.statementDiagnosis;
  assert.deepEqual(diagnosis.findings.map((finding) => [finding.kind, finding.confidence, finding.entry?.description, finding.effectMinor, finding.relatedEffectMinor]), [
    ["wrong_account", "high", "OpenAI", 2949, -2949],
    ["wrong_account", "high", "Buyandship", 1313, -1313]
  ]);
  const corrections = diagnosis.findings.map((finding) => finding.fix);
  assert.deepEqual(corrections.map((fix) => [fix.kind, fix.entryId, fix.fromAccountId, fix.toAccountId]), [
    ["move_to_statement_account", entryIds.openai, ladysCardId, oneCardId],
    ["move_to_statement_account", entryIds.buyandship, ladysCardId, oneCardId]
  ]);
  assert.deepEqual(diagnosis.cards.map((card) => [card.accountName, card.deltaMinor, card.projectedDeltaMinor, card.outcome]).sort(), [
    [LADYS_CARD, -4262, 0, "resolved"],
    [ONE_CARD, 4262, 0, "resolved"]
  ]);

  const applied = await api("/api/accounts/checkpoints/statement-corrections/apply", { accountId: ladysCardId, checkpointMonth: MONTH, corrections });
  assert.equal(applied.status, 200, JSON.stringify(applied.payload));
  assert.equal(applied.payload.appliedCount, 2);
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 0, [LADYS_CARD]: 0 });
  const moved = await rows(db, "SELECT id, account_id, bank_certification_status, note FROM transactions WHERE id IN (?, ?) ORDER BY description DESC", entryIds.openai, entryIds.buyandship);
  assert.deepEqual(moved.map((row) => [row.account_id, row.bank_certification_status, row.note]), [
    [oneCardId, "provisional", "Recorded by hand"],
    [oneCardId, "provisional", "Recorded by hand"]
  ]);
  const recorded = await rows(db, "SELECT transaction_id, correction_kind, account_id, checkpoint_month, from_account_id, to_account_id, undone_at FROM statement_corrections ORDER BY transaction_id");
  assert.deepEqual(recorded, [entryIds.openai, entryIds.buyandship].sort().map((entryId) => ({
    transaction_id: entryId,
    correction_kind: "move_to_statement_account",
    account_id: ladysCardId,
    checkpoint_month: MONTH,
    from_account_id: ladysCardId,
    to_account_id: oneCardId,
    undone_at: null
  })));
  const audit = await rows(db, "SELECT detail FROM audit_events WHERE action = 'entry_moved_by_statement_compare' AND entity_id = ?", entryIds.openai);
  assert.deepEqual(audit.map((row) => row.detail), [`Moved OpenAI from ${LADYS_CARD} to ${ONE_CARD}: the 2026-05 statement lists it under ${ONE_CARD}.`]);

  // A second compare has nothing left to suggest.
  assert.deepEqual((await compareLadysCard(api, statement, ladysCardId)).statementDiagnosis.findings.filter((finding) => finding.fix), []);
  // Applying the same moves again is refused: the entries are no longer there.
  const again = await api("/api/accounts/checkpoints/statement-corrections/apply", { accountId: ladysCardId, checkpointMonth: MONTH, corrections });
  assert.equal(again.status, 409);
  assert.match(again.payload.error, /OpenAI can't be corrected: it is no longer on that account\./);

  const undone = await api("/api/accounts/checkpoints/statement-corrections/undo", { correctionIds: applied.payload.correctionIds });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 4262, [LADYS_CARD]: -4262 });
  assert.deepEqual((await rows(db, "SELECT account_id FROM transactions WHERE id = ?", entryIds.openai))[0].account_id, ladysCardId);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM statement_corrections WHERE undone_at IS NOT NULL"))[0].count, 2);
  const undoAgain = await api("/api/accounts/checkpoints/statement-corrections/undo", { correctionIds: applied.payload.correctionIds });
  assert.deepEqual([undoAgain.status, undoAgain.payload.error], [409, "That correction is already undone."]);
});

test("after a statement import added the purchases to the right card, the hand-recorded copies on the wrong card are removed; undo restores them exactly", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { oneCardId, ladysCardId, entryIds, statement } = await setUpWrongCardScenario(api);
  // Committed without the suggested moves: One Card gets its own OPENAI and
  // Buyandship rows, and Lady's Card keeps the hand-recorded copies.
  const preview = await previewStatement(api, statement);
  const committed = await api("/api/imports/commit", commitBody(statement, preview));
  assert.equal(committed.status, 200, JSON.stringify(committed.payload));
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 0, [LADYS_CARD]: -4262 });
  const [before] = await rows(db, "SELECT * FROM transactions WHERE id = ?", entryIds.openai);

  const diagnosis = (await compareLadysCard(api, statement, ladysCardId)).statementDiagnosis;
  const [oneCardOpenai] = await rows(db, "SELECT id FROM transactions WHERE account_id = ? AND amount_minor = 2949", oneCardId);
  const [oneCardBuyandship] = await rows(db, "SELECT id FROM transactions WHERE account_id = ? AND amount_minor = 1313", oneCardId);
  assert.deepEqual(diagnosis.findings.map((finding) => [finding.kind, finding.confidence, finding.entry?.description, finding.effectMinor]), [
    ["duplicate_entry", "high", "OpenAI", 2949],
    ["duplicate_entry", "high", "Buyandship", 1313]
  ]);
  const corrections = diagnosis.findings.map((finding) => finding.fix);
  assert.deepEqual(corrections, [
    { kind: "remove_duplicate_entry", entryId: entryIds.openai, accountId: ladysCardId, coveredByEntryId: oneCardOpenai.id },
    { kind: "remove_duplicate_entry", entryId: entryIds.buyandship, accountId: ladysCardId, coveredByEntryId: oneCardBuyandship.id }
  ]);

  const applied = await api("/api/accounts/checkpoints/statement-corrections/apply", { accountId: ladysCardId, checkpointMonth: MONTH, corrections });
  assert.equal(applied.status, 200, JSON.stringify(applied.payload));
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 0, [LADYS_CARD]: 0 });
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE id IN (?, ?)", entryIds.openai, entryIds.buyandship), []);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'entry_removed_as_statement_duplicate'"))[0].count, 2);

  // Rolling back the statement now would remove both copies of each.
  const rollback = await api("/api/imports/rollback", { importId: committed.payload.importId });
  assert.equal(rollback.status, 409);
  assert.match(rollback.payload.error, /removed a second copy of one of its entries\. Undo that correction in Settings first\./);

  const undone = await api("/api/accounts/checkpoints/statement-corrections/undo", { correctionIds: applied.payload.correctionIds });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  const [after] = await rows(db, "SELECT * FROM transactions WHERE id = ?", entryIds.openai);
  assert.deepEqual(after, before);
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 0, [LADYS_CARD]: -4262 });

  const rollbackAfterUndo = await api("/api/imports/rollback", { importId: committed.payload.importId });
  assert.equal(rollbackAfterUndo.status, 200, JSON.stringify(rollbackAfterUndo.payload));
});

test("a correction that would unbalance a saved statement that matches is not offered and is refused", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  // One Card's statement was saved at the ledger's own balance, so it
  // matches without OpenAI and Buyandship; moving them would break it.
  const { oneCardId, ladysCardId, entryIds, statement } = await setUpHandRecordedStatement(api, { oneCardBalanceMinor: 5796 - 4262 });
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 0, [LADYS_CARD]: -4262 });

  const diagnosis = (await compareLadysCard(api, statement, ladysCardId)).statementDiagnosis;
  const openai = diagnosis.findings.find((finding) => finding.entry?.id === entryIds.openai);
  assert.equal(openai.kind, "wrong_account");
  assert.equal(openai.fix, undefined);
  assert.equal(openai.confidence, "low");
  assert.deepEqual(openai.facts.at(-1), { code: "unbalances_saved_statement", accountName: ONE_CARD, month: MONTH });

  const forced = await api("/api/accounts/checkpoints/statement-corrections/apply", {
    accountId: ladysCardId,
    checkpointMonth: MONTH,
    corrections: [{ kind: "move_to_statement_account", entryId: entryIds.openai, fromAccountId: ladysCardId, toAccountId: oneCardId, statementRowIndex: 1 }]
  });
  assert.equal(forced.status, 409);
  assert.equal(forced.payload.error, `These corrections would unbalance the saved ${ONE_CARD} statement for ${MONTH}. Compare the statement again and retry.`);
  assert.deepEqual(await mayDeltas(api), { [ONE_CARD]: 0, [LADYS_CARD]: -4262 });
});

test("a removal is refused for a certified entry, and the request must name only corrections", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { oneCardId, ladysCardId, entryIds, statement } = await setUpWrongCardScenario(api);
  const committed = await api("/api/imports/commit", commitBody(statement, await previewStatement(api, statement)));
  assert.equal(committed.status, 200, JSON.stringify(committed.payload));
  const [oneCardOpenai] = await rows(db, "SELECT id FROM transactions WHERE account_id = ? AND amount_minor = 2949", oneCardId);

  // The certified One Card entry cannot be removed as a copy of the
  // hand-recorded one.
  const certified = await api("/api/accounts/checkpoints/statement-corrections/apply", {
    accountId: oneCardId,
    checkpointMonth: MONTH,
    corrections: [{ kind: "remove_duplicate_entry", entryId: oneCardOpenai.id, accountId: oneCardId, coveredByEntryId: entryIds.openai }]
  });
  assert.equal(certified.status, 409);
  assert.match(certified.payload.error, /can't be corrected: a statement already certifies it\./);

  const deferred = await api("/api/accounts/checkpoints/statement-corrections/apply", {
    accountId: ladysCardId,
    checkpointMonth: MONTH,
    corrections: [{ kind: "defer_to_next_statement", entryId: entryIds.sabai, accountId: ladysCardId, postDate: "2026-05-14" }]
  });
  assert.equal(deferred.status, 400);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM statement_corrections"))[0].count, 0);
});
