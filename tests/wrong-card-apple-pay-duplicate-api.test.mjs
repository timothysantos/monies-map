// Wrong-card Apple Pay duplicate through the real Worker routes (Miniflare
// D1): the preview offers each stray Apple Pay entry with the other card's
// bank row as evidence, the commit removes only what was confirmed, and the
// import's rollback gives every entry back exactly. Both import orders, and
// every way the offer must not appear.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, dumpDatabase, assertSameDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import {
  APPLE_PAY_ENTRIES,
  LADYS_CARD,
  LADYS_FILE,
  ONE_CARD,
  ONE_CARD_FILE,
  commitBody,
  commitFile,
  createCards,
  previewFile,
  saveApplePayEntries
} from "./support/wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const ONE_LABEL = "CC_TXN_History_14Oct2026-onecard";
const LADY_LABEL = "CC_TXN_History_13Oct2026-ladys";

const ladyEntries = (db) => rows(db, `
  SELECT t.id, t.transaction_date, t.description, t.amount_minor, t.import_id, t.external_reference
  FROM transactions t JOIN accounts a ON a.id = t.account_id
  WHERE a.account_name = ? AND t.external_reference LIKE 'shortcut:%' ORDER BY t.description`, LADYS_CARD);
const ladyTotal = async (db) => (await rows(db, `
  SELECT COALESCE(SUM(t.amount_minor), 0) AS total FROM transactions t JOIN accounts a ON a.id = t.account_id
  WHERE a.account_name = ? AND t.entry_type = 'expense'`, LADYS_CARD))[0].total;
const wholeEntries = (db, ids) => rows(db, `SELECT * FROM transactions WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`, ...ids);

// The One Card file is imported first; the Lady's file is the one previewed.
async function ladysFileSecond(t) {
  const workspace = await openSeededDatabase(t, template);
  await createCards(workspace.api);
  const entryIds = await saveApplePayEntries(workspace);
  await commitFile(workspace.api, await previewFile(workspace.api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(workspace.api, LADYS_FILE, LADY_LABEL);
  return { ...workspace, entryIds, preview };
}

test("the Lady's file previewed after the One Card file offers all three entries, with the One Card rows as evidence", async (t) => {
  const { preview, entryIds } = await ladysFileSecond(t);
  const cards = preview.wrongCardDuplicates;
  assert.deepEqual(cards.map((card) => `${card.transactionId}|${card.confidence}|${card.entry.description}|${card.entry.amountMinor}|${card.entry.date}`).sort(), [
    `${entryIds[0]}|high|Cold Storage-Star Vist|180|2026-10-11`,
    `${entryIds[1]}|high|CS Fresh|970|2026-10-11`,
    `${entryIds[2]}|high|FairPrice finest|784|2026-10-11`
  ].sort());
  for (const card of cards) {
    assert.equal(card.entry.accountName, LADYS_CARD);
    assert.equal(card.twin.accountName, ONE_CARD);
    assert.equal(card.twin.kind, "ledger");
    assert.match(card.twin.description, /^(COLD STORAGE-STAR VISTA|FAIRPRICE FINEST-STAR VISTA) SINGAPORE SG$/);
    assert.match(card.twin.importedAt, /^\d{4}-\d{2}-\d{2} /);
    assert.deepEqual(card.coverage, { kind: "this_file" });
    assert.equal(card.isLinked, undefined);
  }
  // 1.80 + 9.70 + 7.84: what the Lady's Card is overstated by.
  assert.equal(cards.reduce((sum, card) => sum + card.entry.amountMinor, 0), 1934);
});

test("confirming the removal takes exactly the three entries off the Lady's Card in the import's own batch, and the rollback gives them back exactly", async (t) => {
  const { db, api, preview, entryIds } = await ladysFileSecond(t);
  const before = await wholeEntries(db, entryIds);
  assert.equal(before.length, 3);
  const totalBefore = await ladyTotal(db);
  const oneCardTotalBefore = (await rows(db, "SELECT COALESCE(SUM(t.amount_minor), 0) AS total FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.account_name = ?", ONE_CARD))[0].total;

  const importId = await commitFile(api, preview, LADY_LABEL, { remove: preview.wrongCardDuplicates });

  assert.deepEqual(await wholeEntries(db, entryIds), []);
  assert.equal(await ladyTotal(db), totalBefore - 1934 + 0 + preview.previewRows.filter((row) => row.commitStatus === "included").reduce((sum, row) => sum + row.amountMinor, 0));
  // The purchases stay where they were paid.
  assert.equal((await rows(db, "SELECT COALESCE(SUM(t.amount_minor), 0) AS total FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.account_name = ?", ONE_CARD))[0].total, oneCardTotalBefore);
  const saved = await rows(db, "SELECT transaction_id, account_id, twin_kind FROM import_wrong_card_duplicates WHERE import_id = ? ORDER BY transaction_id", importId);
  assert.deepEqual(saved.map((row) => row.transaction_id), [...entryIds].sort());
  assert.deepEqual(new Set(saved.map((row) => row.twin_kind)), new Set(["ledger"]));
  const audits = await rows(db, "SELECT entity_id, detail FROM audit_events WHERE action = 'entry_removed_as_wrong_card_duplicate' ORDER BY entity_id");
  assert.deepEqual(audits.map((audit) => audit.entity_id), [...entryIds].sort());
  assert.match(audits[0].detail, /^Removed the Apple Pay entry .+ from UOB Lady's Card: the same purchase is on UOB One Card as .+ \(score \d+: .+\)\.$/);

  const rollback = await api("/api/imports/rollback", { importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await wholeEntries(db, entryIds), before);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM import_wrong_card_duplicates"), [{ n: 0 }]);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'entry_restored_by_import_rollback'"))[0].n, 3);
});

test("keeping the entries (no confirmation) leaves them in the ledger", async (t) => {
  const { db, api, preview, entryIds } = await ladysFileSecond(t);
  const before = await wholeEntries(db, entryIds);
  await commitFile(api, preview, LADY_LABEL);
  assert.deepEqual(await wholeEntries(db, entryIds), before);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM import_wrong_card_duplicates"), [{ n: 0 }]);
});

test("the Lady's file first and the One Card file second: the flag appears when the second import lands", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { db, api } = workspace;
  await createCards(api);
  const entryIds = await saveApplePayEntries(workspace);
  // Nothing to flag yet: no bank row of another card holds these purchases.
  const first = await previewFile(api, LADYS_FILE, LADY_LABEL);
  assert.equal(first.wrongCardDuplicates, undefined);
  await commitFile(api, first, LADY_LABEL);
  assert.equal((await ladyEntries(db)).length, 3);

  const second = await previewFile(api, ONE_CARD_FILE, ONE_LABEL);
  assert.deepEqual(second.wrongCardDuplicates.map((card) => [card.confidence, card.entry.accountName, card.twin.kind, card.twin.accountName]), [
    ["high", LADYS_CARD, "this_file", ONE_CARD], ["high", LADYS_CARD, "this_file", ONE_CARD], ["high", LADYS_CARD, "this_file", ONE_CARD]
  ]);
  assert.equal(second.wrongCardDuplicates[0].coverage.kind, "earlier_import");
  assert.match(second.wrongCardDuplicates[0].coverage.importedAt, /^\d{4}-\d{2}-\d{2} /);
  const twinRowIds = second.previewRows.filter((row) => row.accountName === ONE_CARD && [180, 970, 784].includes(row.amountMinor)).map((row) => row.rowId).sort();
  assert.equal(twinRowIds.length, 3);
  assert.deepEqual(second.wrongCardDuplicates.map((card) => card.twin.id).sort(), twinRowIds);

  const before = await wholeEntries(db, entryIds);
  const importId = await commitFile(api, second, ONE_LABEL, { remove: second.wrongCardDuplicates });
  assert.deepEqual(await ladyEntries(db), []);
  // The One Card rows came in with the same import.
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE import_id = ?", importId))[0].n, ONE_CARD_FILE.length);

  assert.equal((await api("/api/imports/rollback", { importId })).status, 200);
  assert.deepEqual(await wholeEntries(db, entryIds), before);
});

test("an entry the card's file lists is not flagged: a legitimately pending purchase pairs with its row", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { api } = workspace;
  await createCards(api);
  const entryIds = await saveApplePayEntries(workspace, [
    ...APPLE_PAY_ENTRIES,
    { description: "Sabai Sabai - Valley P", amount: "20.49", date: "2026-10-08" }
  ]);
  await commitFile(api, await previewFile(api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(api, LADYS_FILE, LADY_LABEL);
  const sabai = preview.previewRows.find((row) => row.description.startsWith("SABAI SABAI"));
  assert.equal(sabai.reconciliationTargetTransactionId ?? sabai.reconciliationMatch?.existingTransactionId ?? sabai.reconciliationMatches?.[0]?.existingTransactionId, entryIds[3]);
  assert.ok(!preview.wrongCardDuplicates.some((card) => card.transactionId === entryIds[3]));
  assert.equal(preview.wrongCardDuplicates.length, 3);
});

test("a card that sits just inside the file but whose entry is dated after the file ends is not flagged", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { api } = workspace;
  await createCards(api);
  await saveApplePayEntries(workspace, [{ description: "Cold Storage-Star Vist", amount: "1.80", date: "2026-10-14" }]);
  await commitFile(api, await previewFile(api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(api, LADYS_FILE, LADY_LABEL);
  assert.equal(preview.wrongCardDuplicates, undefined);
});

test("a twin three days away is only a note: MEDIUM has no removal, and asking for one is refused", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { db, api } = workspace;
  await createCards(api);
  const [entryId] = await saveApplePayEntries(workspace, [{ description: "Cold Storage-Star Vist", amount: "1.80", date: "2026-10-08" }]);
  await commitFile(api, await previewFile(api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(api, LADYS_FILE, LADY_LABEL);
  assert.deepEqual(preview.wrongCardDuplicates.map((card) => [card.transactionId, card.confidence]), [[entryId, "medium"]]);

  const before = await dumpDatabase(db);
  const refused = await api("/api/imports/commit", commitBody(preview, LADY_LABEL, { remove: [{ transactionId: entryId, twin: preview.wrongCardDuplicates[0].twin }] }));
  assert.equal(refused.status, 400);
  assert.equal(refused.payload.error, "A purchase you chose to remove has changed since the preview. Refresh the import preview and try again.");
  assertSameDatabase(await dumpDatabase(db), before);
});

test("an entry linked to a split is a note, never removable", async (t) => {
  const { db, api, preview, entryIds } = await ladysFileSecond(t);
  const [expense] = await rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id IS NULL LIMIT 1");
  await db.prepare("UPDATE split_expenses SET linked_transaction_id = ? WHERE id = ?").bind(entryIds[0], expense.id).run();
  const linked = await previewFile(api, LADYS_FILE, LADY_LABEL);
  const byEntry = new Map(linked.wrongCardDuplicates.map((card) => [card.transactionId, card]));
  assert.deepEqual([byEntry.get(entryIds[0]).confidence, byEntry.get(entryIds[0]).isLinked], ["medium", true]);
  assert.deepEqual([byEntry.get(entryIds[1]).confidence, byEntry.get(entryIds[1]).isLinked], ["high", undefined]);
  assert.deepEqual([byEntry.get(entryIds[2]).confidence, byEntry.get(entryIds[2]).isLinked], ["high", undefined]);

  // A link made after the preview stops the commit too.
  const before = await dumpDatabase(db);
  const refused = await api("/api/imports/commit", commitBody(preview, LADY_LABEL, { remove: preview.wrongCardDuplicates }));
  assert.equal(refused.status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a statement-certified Apple Pay entry is never flagged", async (t) => {
  const { db, api, entryIds } = await ladysFileSecond(t);
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(entryIds[0]).run();
  const preview = await previewFile(api, LADYS_FILE, LADY_LABEL);
  assert.deepEqual(preview.wrongCardDuplicates.map((card) => card.transactionId).sort(), [entryIds[1], entryIds[2]].sort());
});

test("an entry that is not from the Apple Pay Shortcut is never flagged", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { api } = workspace;
  await createCards(api);
  const manual = await api("/api/entries/create", {
    accountName: LADYS_CARD, categoryName: "Groceries", entryType: "expense", ownershipType: "direct", ownerName: "Tim",
    date: "2026-10-11", description: "Cold Storage-Star Vist", amountMinor: 180
  });
  assert.equal(manual.status, 200);
  await commitFile(api, await previewFile(api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  assert.equal((await previewFile(api, LADYS_FILE, LADY_LABEL)).wrongCardDuplicates, undefined);
});

test("a confirmation that names another twin, or an entry nobody offered, stops the commit and writes nothing", async (t) => {
  const { db, api, preview, entryIds } = await ladysFileSecond(t);
  const before = await dumpDatabase(db);
  const [first, second] = preview.wrongCardDuplicates;
  const wrongTwin = await api("/api/imports/commit", commitBody(preview, LADY_LABEL, { remove: [{ ...first, twin: second.twin }] }));
  assert.equal(wrongTwin.status, 400);
  const ledgerEntry = (await rows(db, "SELECT id FROM transactions WHERE import_id IS NOT NULL LIMIT 1"))[0].id;
  const notOffered = await api("/api/imports/commit", commitBody(preview, LADY_LABEL, { remove: [{ transactionId: ledgerEntry, twin: first.twin }] }));
  assert.equal(notOffered.status, 400);
  const twice = await api("/api/imports/commit", commitBody(preview, LADY_LABEL, { remove: [first, first] }));
  assert.equal(twice.status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
  assert.equal((await ladyEntries(db)).length, entryIds.length);
});

test("an entry the same commit would pair with a row is never removed", async (t) => {
  const { db, api, preview } = await ladysFileSecond(t);
  const body = commitBody(preview, LADY_LABEL, { remove: preview.wrongCardDuplicates });
  // The user links the first card's entry to a row of this file.
  const target = preview.wrongCardDuplicates[0].transactionId;
  body.rows = [{ ...body.rows[0], reconciliationTargetTransactionId: target }, ...body.rows.slice(1)];
  const before = await dumpDatabase(db);
  const refused = await api("/api/imports/commit", body);
  assert.equal(refused.status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("the One Card import cannot be rolled back while the removal that its rows justify is in place", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { api } = workspace;
  await createCards(api);
  await saveApplePayEntries(workspace);
  const oneCardImportId = await commitFile(api, await previewFile(api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(api, LADYS_FILE, LADY_LABEL);
  const ladyImportId = await commitFile(api, preview, LADY_LABEL, { remove: preview.wrongCardDuplicates });

  const early = await api("/api/imports/rollback", { importId: oneCardImportId });
  assert.equal(early.status, 409);
  assert.equal(early.payload.error, "This import cannot be rolled back yet: a later import removed an Apple Pay entry that one of its rows covers. Roll back the later import first.");

  assert.equal((await api("/api/imports/rollback", { importId: ladyImportId })).status, 200);
  assert.equal((await api("/api/imports/rollback", { importId: oneCardImportId })).status, 200);
});
