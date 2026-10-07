// Foreign currency estimates against the card's own rows (DOMAIN.md,
// "Foreign Currency Estimate"). Apple Pay saved IDR purchases on Citi
// Rewards at the day's rate; the Citi statement later charges the Amaze
// conversion in SGD, a little different and worded "AMAZE* MERCHANT". The
// statement row must find its estimate, replace the estimate with the
// card's amount, and never pair two different purchases because their
// amounts are close. Real Worker and a real local D1 (Miniflare). The Amaze
// row wording follows Citi's card statement layout ("AMAZE* MERCHANT
// SINGAPORE SG"); no sanitized Citi statement with Amaze rows exists yet.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CITI = "Citi Rewards";

async function setUp(t) {
  const workspace = await openSeededDatabase(t, template);
  const [citi] = await rows(workspace.db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  await enableShortcut(workspace.db, { foreignCurrencyAccountId: citi.id });
  await saveRate(workspace.db);
  const estimate = async (description, amount, date = "2026-10-03") => {
    const { status, payload } = await postWalletPurchase(workspace.fetch, { amount, description, date });
    assert.equal(status, 200, JSON.stringify(payload));
    assert.equal(payload.accountName, CITI);
    return payload.entryId;
  };
  return { ...workspace, citiId: citi.id, estimate };
}

const statementRow = (date, description, amount, purchaseDate = date) => ({
  date,
  description,
  expense: amount,
  income: "",
  account: CITI,
  category: "Other",
  type: "expense",
  note: `txn date: ${purchaseDate}`
});

async function previewStatement(api, statementRows) {
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "Citi Rewards Oct 2026",
    sourceType: "pdf",
    rows: statementRows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview;
}

const targetOf = (preview, description) => preview.previewRows.find((row) => row.description === description)?.reconciliationTargetTransactionId;

test("the card's SGD row finds its estimate, and the commit replaces the estimate with the card's amount", async (t) => {
  const { api, db, estimate } = await setUp(t);
  const digimap = await estimate("Digimap Icon Sanur M23", "IDR 159,000");

  const statementRows = [statementRow("2026-10-05", "AMAZE* DIGIMAP ICON SANUR M23 SINGAPORE SG", "11.61", "2026-10-03")];
  const preview = await previewStatement(api, statementRows);
  const row = preview.previewRows[0];
  assert.deepEqual([row.reconciliationTargetTransactionId, row.commitStatus], [digimap, "included"]);
  assert.equal(row.commitStatusReason, "Official statement will replace the estimate for IDR 159,000 (about SGD 11.34) with the card's SGD 11.61.");

  const commit = await api("/api/imports/commit", {
    sourceLabel: "Citi Rewards Oct 2026",
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    statementCheckpoints: [],
    statementControlRows: preview.previewRows,
    statementReconciliations: preview.statementReconciliations,
    rows: preview.previewRows.filter((item) => item.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [entry] = await rows(db, "SELECT amount_minor, bank_certification_status, statement_certified_previous_amount_minor, original_amount_minor, original_currency FROM transactions WHERE id = ?", digimap);
  assert.deepEqual(entry, {
    amount_minor: 1161,
    bank_certification_status: "statement_certified",
    statement_certified_previous_amount_minor: 1134,
    original_amount_minor: 15900000,
    original_currency: "IDR"
  });
  // One entry for the purchase, not a second copy.
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM transactions WHERE amount_minor IN (1134, 1161)"))[0].count, 1);
});

test("a Grab order worded only as AMAZE* GRAB on the card meets its estimate when it is the only one that fits", async (t) => {
  const { api, estimate } = await setUp(t);
  const warungSaro = await estimate("GrabFood Warung Saro - Sanur", "IDR 458,500");
  await estimate("GrabFood Batter Club Cookies - Canggu", "IDR 510,300");

  // 32.69 estimated; Amaze charged 33.40 (2.2% more). Batter Club's 36.39
  // is 9% away: not a candidate.
  const preview = await previewStatement(api, [statementRow("2026-10-05", "AMAZE* GRAB* A-8ABCDEFGHIJK SINGAPORE SG", "33.40", "2026-10-03")]);
  assert.equal(targetOf(preview, "AMAZE* GRAB* A-8ABCDEFGHIJK SINGAPORE SG"), warungSaro);
});

test("similarly priced purchases pair one to one, each with the closest estimate", async (t) => {
  const { api, estimate } = await setUp(t);
  const first = await estimate("Market City Icon Bali", "IDR 43,300");
  const second = await estimate("Market city ICON Bali Sanur", "IDR 42,800");

  // 3.09 and 3.05 estimated, six minutes apart at the same place; the card
  // charged 3.16 and 3.12.
  const preview = await previewStatement(api, [
    statementRow("2026-10-05", "AMAZE* MARKET CITY ICON BALI SINGAPORE SG", "3.16", "2026-10-03"),
    statementRow("2026-10-05", "AMAZE* MARKET CITY ICON BALI SANUR SINGAPORE SG", "3.12", "2026-10-03")
  ]);
  assert.deepEqual(preview.previewRows.map((row) => row.reconciliationTargetTransactionId), [first, second]);
});

test("an estimate is never paired when the amount is too far off, the purchase could be either of two, or the entry is not an estimate", async (t) => {
  const { api, estimate, citiId } = await setUp(t);
  await estimate("Digimap Icon Sanur M23", "IDR 159,000");
  await estimate("GrabFood Warung Saro - Sanur", "IDR 458,500");
  await estimate("GoFood Slow Slice Pizza, Sanur", "IDR 462,500");
  // An SGD entry recorded by hand is exact, never estimated.
  const { payload: hand } = await api("/api/entries/create", { accountId: citiId, date: "2026-10-03", description: "Kopi Kenangan", amountMinor: 500, categoryName: "Food & Drinks", entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  assert.ok(hand.entryId);

  const preview = await previewStatement(api, [
    // 10% above Digimap's 11.34.
    statementRow("2026-10-05", "AMAZE* DIGIMAP ICON SANUR M23 SINGAPORE SG", "12.50", "2026-10-03"),
    // 33.40 fits both Warung Saro (32.69) and Slow Slice (32.98), and its
    // wording names neither.
    statementRow("2026-10-05", "AMAZE* GRAB* A-9J3SSLPWX2PFAV SINGAPORE SG", "33.40", "2026-10-03"),
    // 2% off a hand-recorded SGD entry.
    statementRow("2026-10-05", "KOPI KENANGAN SINGAPORE SG", "5.10", "2026-10-03")
  ]);
  assert.deepEqual(preview.previewRows.map((row) => row.reconciliationTargetTransactionId ?? null), [null, null, null]);
});

test("a Citi activity export before the statement also replaces the estimate with the card's amount", async (t) => {
  const { api, db, estimate } = await setUp(t);
  const digimap = await estimate("Digimap Icon Sanur M23", "IDR 159,000");

  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "Citi Rewards activity",
    sourceType: "csv",
    rows: [{ date: "2026-10-04", description: "AMAZE* DIGIMAP ICON SANUR M23 SINGAPORE SG", expense: "11.61", account: CITI, category: "Other", type: "expense", "transaction date": "2026-10-03" }],
    ownershipType: "direct",
    ownerName: "Tim"
  });
  assert.equal(status, 200, JSON.stringify(payload));
  const row = payload.preview.previewRows[0];
  assert.deepEqual([row.reconciliationTargetTransactionId, row.commitStatus], [digimap, "included"]);

  const commit = await api("/api/imports/commit", {
    sourceLabel: "Citi Rewards activity",
    sourceType: "csv",
    parserKey: "citibank_credit_card_activity_csv",
    rows: payload.preview.previewRows.filter((item) => item.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [entry] = await rows(db, "SELECT amount_minor, post_date, bank_certification_status, original_currency FROM transactions WHERE id = ?", digimap);
  assert.deepEqual(entry, { amount_minor: 1161, post_date: "2026-10-04", bank_certification_status: "provisional", original_currency: "IDR" });
});

// Probe: an activity export's SGD amount before the statement's final one.
// An activity export with one row, previewed and committed as the Imports
// page does. Returns the row as previewed and the import's id.
async function importActivity(api, sourceLabel, amount, { date = "2026-10-04", description = "AMAZE*DIGIMAP ICON SANUR M23" } = {}) {
  const { payload } = await api("/api/imports/preview", {
    sourceLabel,
    sourceType: "csv",
    rows: [{ date, description, expense: amount, account: CITI, category: "Other", type: "expense" }],
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const included = payload.preview.previewRows.filter((item) => item.commitStatus === "included");
  // An export with nothing new is not committed, as on the Imports page.
  if (!included.length) {
    return { row: payload.preview.previewRows[0], importId: undefined };
  }
  const commit = await api("/api/imports/commit", {
    sourceLabel,
    sourceType: "csv",
    parserKey: "citibank_credit_card_activity_csv",
    rows: included
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  return { row: payload.preview.previewRows[0], importId: commit.payload.importId };
}

test("an activity export's interim amount replaces the estimate, and the statement's final amount replaces that", async (t) => {
  const { api, db, estimate } = await setUp(t);
  const digimap = await estimate("Digimap Icon Sanur M23", "IDR 159,000");

  const { row: exported } = await importActivity(api, "Citi activity 4 Oct", "11.50");
  assert.equal(exported.reconciliationTargetTransactionId, digimap);
  const [afterExport] = await rows(db, "SELECT amount_minor, bank_certification_status, original_currency FROM transactions WHERE id = ?", digimap);
  assert.deepEqual(afterExport, { amount_minor: 1150, bank_certification_status: "provisional", original_currency: "IDR" });

  // Still an estimate until the statement: the final amount may differ.
  const statementRows = [statementRow("2026-10-05", "AMAZE*DIGIMAP ICON SANUR M23", "11.61")];
  const preview = await previewStatement(api, statementRows);
  assert.equal(preview.previewRows[0].reconciliationTargetTransactionId, digimap);
  assert.equal(preview.previewRows[0].commitStatusReason, "Official statement will replace the estimate for IDR 159,000 (about SGD 11.50) with the card's SGD 11.61.");
  const commit = await api("/api/imports/commit", {
    sourceLabel: "Citi Rewards Oct 2026",
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    statementCheckpoints: [],
    statementControlRows: preview.previewRows,
    statementReconciliations: preview.statementReconciliations,
    rows: preview.previewRows.filter((item) => item.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [final] = await rows(db, "SELECT amount_minor, bank_certification_status, statement_certified_previous_amount_minor FROM transactions WHERE id = ?", digimap);
  assert.deepEqual(final, { amount_minor: 1161, bank_certification_status: "statement_certified", statement_certified_previous_amount_minor: 1150 });
});

const digimapEntries = (db) => rows(db, "SELECT id, amount_minor, import_id, bank_certification_status FROM transactions WHERE description LIKE '%DIGIMAP%' OR description LIKE 'Digimap%' ORDER BY created_at");

test("a second activity export with a newer interim amount updates the same estimate instead of adding a copy", async (t) => {
  const { api, db, estimate } = await setUp(t);
  const digimap = await estimate("Digimap Icon Sanur M23", "IDR 159,000");

  const first = await importActivity(api, "Citi activity 4 Oct", "11.50");
  const second = await importActivity(api, "Citi activity 6 Oct", "11.58", { date: "2026-10-05" });
  assert.deepEqual([second.row.reconciliationTargetTransactionId, second.row.commitStatus], [digimap, "included"]);
  assert.equal(second.row.commitStatusReason, "Current-activity import will update the estimate for IDR 159,000 from SGD 11.50 to the card's SGD 11.58.");
  assert.deepEqual(await digimapEntries(db), [{ id: digimap, amount_minor: 1158, import_id: second.importId, bank_certification_status: "provisional" }]);

  // The statement's final amount still settles it.
  const preview = await previewStatement(api, [statementRow("2026-10-05", "AMAZE*DIGIMAP ICON SANUR M23", "11.61")]);
  assert.equal(preview.previewRows[0].reconciliationTargetTransactionId, digimap);
  assert.ok(first.importId);
});

test("a second export showing the same interim amount is recognised and skipped", async (t) => {
  const { api, db, estimate } = await setUp(t);
  const digimap = await estimate("Digimap Icon Sanur M23", "IDR 159,000");

  const first = await importActivity(api, "Citi activity 4 Oct", "11.50");
  const again = await importActivity(api, "Citi activity 6 Oct", "11.50");
  assert.equal(again.row.commitStatus, "skipped");
  assert.deepEqual(await digimapEntries(db), [{ id: digimap, amount_minor: 1150, import_id: first.importId, bank_certification_status: "provisional" }]);
});

test("rolling the exports back steps the estimate back one export at a time, latest first", async (t) => {
  const { api, db, estimate } = await setUp(t);
  const digimap = await estimate("Digimap Icon Sanur M23", "IDR 159,000");
  const first = await importActivity(api, "Citi activity 4 Oct", "11.50");
  const second = await importActivity(api, "Citi activity 6 Oct", "11.58", { date: "2026-10-05" });

  // The earlier export no longer holds the entry: it waits for the later one.
  const early = await api("/api/imports/rollback", { importId: first.importId });
  assert.equal(early.status, 409);
  assert.equal(early.payload.error, "This import cannot be rolled back yet: a later import updated one of its entries. Roll back the later import first.");
  assert.deepEqual((await digimapEntries(db)).map((entry) => entry.amount_minor), [1158]);

  const later = await api("/api/imports/rollback", { importId: second.importId });
  assert.equal(later.status, 200, JSON.stringify(later.payload));
  assert.deepEqual(await digimapEntries(db), [{ id: digimap, amount_minor: 1150, import_id: first.importId, bank_certification_status: "provisional" }]);

  const earlier = await api("/api/imports/rollback", { importId: first.importId });
  assert.equal(earlier.status, 200, JSON.stringify(earlier.payload));
  const [entry] = await rows(db, "SELECT amount_minor, import_id, original_currency FROM transactions WHERE id = ?", digimap);
  assert.deepEqual(entry, { amount_minor: 1134, import_id: null, original_currency: "IDR" });
});

test("an ordinary row from an earlier export is never updated by a later export", async (t) => {
  const { api, db } = await setUp(t);
  // An SGD Grab ride on the card, not an estimate: imported as its own entry.
  await importActivity(api, "Citi activity 4 Oct", "12.00", { description: "Grab*A-9MTISPQWW7GDAV" });
  const later = await importActivity(api, "Citi activity 6 Oct", "12.30", { description: "Grab*A-9MTISPQWW7GDAV" });
  assert.equal(later.row.reconciliationTargetTransactionId, undefined);
  assert.deepEqual((await rows(db, "SELECT amount_minor FROM transactions WHERE description = 'Grab*A-9MTISPQWW7GDAV' ORDER BY amount_minor")).map((row) => row.amount_minor), [1200, 1230]);
});

test("an ordinary card row near an estimate's amount is not taken for it when the shop does not match", async (t) => {
  const { api, estimate } = await setUp(t);
  // Naughty Nuris, 87.95 estimated; Amaze refunded it, so its row never
  // comes. A Shopee purchase of 89.00 in Singapore is on the same card.
  await estimate("Naughty Nuris Sanur", "IDR 1,233,430", "2026-10-02");

  const preview = await previewStatement(api, [statementRow("2026-10-05", "SHOPEESGMP", "89.00", "2026-10-04")]);
  assert.equal(preview.previewRows[0].reconciliationTargetTransactionId, undefined);
  assert.equal(preview.previewRows[0].commitStatus, "included");
});
