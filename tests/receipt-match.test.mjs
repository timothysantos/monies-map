// Receipt match (DOMAIN.md "Receipt Match"): before Ask drafts a new entry
// from a receipt it looks for the same purchase already in the ledger. The
// rules are pure (chooseReceiptMatch); the route reads the household's own
// rows bounded by date, and a Save goes through the existing commands in
// ASK_CHANGE_PATHS. Data here is invented: no real receipt or household.
import assert from "node:assert/strict";
import test from "node:test";

import { ASK_CHANGE_PATHS } from "../src/domain/ask-turn-actions.ts";
import { ASK_CATCH_ALL_CATEGORIES } from "../src/domain/ask-habits.ts";
import { chooseReceiptMatch, noteWithReceipt, receiptMatchWindow, shopsAgree } from "../src/domain/receipt-match.ts";
import { readReceiptMatchBody } from "../src/server/receipt-match-route.ts";
import { RECEIPT_BATCH_MAX, RECEIPT_MATCH_DAYS_AFTER, RECEIPT_MATCH_DAYS_BEFORE } from "../src/domain/receipt-batch-config.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { createEntry, createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

const RECEIPT = { merchant: "LAWSON Shibuya Dogenzaka", date: "2026-11-12", totalMinor: 324_000, currency: "JPY" };

function entry(fields) {
  return {
    id: "txn-a",
    date: "2026-11-12",
    description: "LAWSON SHIBUYA",
    amountMinor: 2_980,
    currency: "SGD",
    entryType: "expense",
    categoryName: "Other",
    accountName: "Travel card",
    note: "",
    originalAmountMinor: null,
    originalCurrency: null,
    certified: false,
    ...fields
  };
}

const facts = (entries, extra = {}) => ({ entries, taps: [], rates: {}, catchAll: ASK_CATCH_ALL_CATEGORIES, ...extra });

test("the batch limit and match window come from the config module", () => {
  assert.equal(RECEIPT_BATCH_MAX, 10);
  assert.deepEqual(receiptMatchWindow("2026-11-12"), { from: `2026-11-${String(12 - RECEIPT_MATCH_DAYS_BEFORE).padStart(2, "0")}`, to: `2026-11-${12 + RECEIPT_MATCH_DAYS_AFTER}` });
});

test("an Apple Pay estimate that kept the receipt's own yen total is that purchase, and Save notes nothing new", () => {
  const estimate = entry({ originalAmountMinor: 324_000, originalCurrency: "JPY" });
  const result = chooseReceiptMatch(RECEIPT, facts([estimate]));
  assert.equal(result.kind, "one");
  assert.equal(result.option.id, "txn-a");
  // The Wallet amount is already kept, so nothing would change.
  assert.equal(result.option.change, null);
});

test("a same-currency receipt matches only the exact figure, and Save adds its lines to the note through update-note", () => {
  const receipt = { merchant: "Kopi & Crumb Cafe", date: "2026-11-12", totalMinor: 2_338, currency: "SGD", noteLines: ["Flat White 6.50", "Kaya Toast Set 5.80"] };
  const exact = entry({ id: "txn-cafe", description: "KOPI & CRUMB CAFE", amountMinor: 2_338, note: "with Joyce" });
  const nearly = entry({ id: "txn-cafe-2", description: "KOPI & CRUMB CAFE", amountMinor: 2_340 });
  const result = chooseReceiptMatch(receipt, facts([exact, nearly]));
  assert.equal(result.kind, "one");
  const change = result.option.change;
  assert.equal(change.type, "receipt_match");
  assert.deepEqual(change.rows, [{ field: "note", before: "with Joyce", after: "with Joyce\nFlat White 6.50\nKaya Toast Set 5.80" }]);
  assert.deepEqual(change.save, [{ path: "/api/entries/update-note", body: { entryId: "txn-cafe", note: "with Joyce\nFlat White 6.50\nKaya Toast Set 5.80" } }]);
  assert.deepEqual(change.undo, [{ path: "/api/entries/update-note", body: { entryId: "txn-cafe", note: "with Joyce" } }]);
  for (const step of [...change.save, ...change.undo]) assert.ok(ASK_CHANGE_PATHS.includes(step.path), step.path);
});

test("estimate drift: a statement row 2.6% over the receipt at the saved rate is the purchase; 6% over is not", () => {
  // 1 SGD = 108.9 JPY: JPY 3,240 is about SGD 29.75.
  const rates = { "SGD:JPY": 108.9 };
  const drifted = entry({ id: "txn-statement", description: "AMAZE* LAWSON SHIBUYA", amountMinor: 3_052, certified: true });
  const one = chooseReceiptMatch(RECEIPT, facts([drifted], { rates }));
  assert.equal(one.kind, "one");
  assert.equal(one.option.id, "txn-statement");
  assert.equal(one.option.certified, true);
  // The paid yen goes into the note; bank facts are never in the steps.
  assert.deepEqual(one.option.change.rows.map((row) => row.field), ["note"]);
  assert.equal(one.option.change.rows[0].after, "Receipt: paid JPY 3,240.");
  assert.ok(one.option.change.save.every((step) => step.path !== "/api/entries/update"));

  const tooFar = entry({ id: "txn-far", description: "AMAZE* LAWSON SHIBUYA", amountMinor: 3_155 });
  assert.equal(chooseReceiptMatch(RECEIPT, facts([tooFar], { rates })).kind, "none");
  // No saved rate: a foreign receipt cannot be compared with an SGD row.
  assert.equal(chooseReceiptMatch(RECEIPT, facts([drifted])).kind, "none");
});

test("two entries for the same amount at the same shop on the same day are asked about, never guessed", () => {
  const receipt = { merchant: "Toast Box", date: "2026-11-12", totalMinor: 760, currency: "SGD" };
  const first = entry({ id: "txn-1", description: "TOAST BOX", amountMinor: 760 });
  const second = entry({ id: "txn-2", description: "TOAST BOX", amountMinor: 760, accountName: "Joyce card" });
  const result = chooseReceiptMatch(receipt, facts([first, second]));
  assert.equal(result.kind, "several");
  assert.deepEqual(result.options.map((option) => option.id), ["txn-1", "txn-2"]);
});

test("no match: another shop, another day outside the window, or another figure", () => {
  const receipt = { merchant: "Toast Box", date: "2026-11-12", totalMinor: 760, currency: "SGD" };
  assert.equal(chooseReceiptMatch(receipt, facts([entry({ description: "YA KUN KAYA", amountMinor: 760 })])).kind, "none");
  assert.equal(chooseReceiptMatch(receipt, facts([entry({ description: "TOAST BOX", amountMinor: 760, date: "2026-11-20" })])).kind, "none");
  assert.equal(chooseReceiptMatch(receipt, facts([entry({ description: "TOAST BOX", amountMinor: 761 })])).kind, "none");
  // A blank shop on either side never agrees.
  assert.equal(shopsAgree("", "TOAST BOX"), false);
  assert.equal(chooseReceiptMatch({ ...receipt, merchant: "" }, facts([entry({ description: "TOAST BOX", amountMinor: 760 })])).kind, "none");
  // Money in or a transfer is never a receipt's purchase.
  assert.equal(chooseReceiptMatch(receipt, facts([entry({ description: "TOAST BOX", amountMinor: 760, entryType: "income" })])).kind, "none");
});

test("a waiting Apple Pay tap at the shop is finished with the receipt's total when no entry fits", () => {
  const tap = { id: "tap-1", date: "2026-11-12", merchant: "LAWSON", accountName: "Travel card" };
  const result = chooseReceiptMatch(RECEIPT, facts([], { taps: [tap] }));
  assert.equal(result.kind, "one");
  assert.equal(result.option.kind, "tap");
  assert.deepEqual(result.option.change.save, [{ path: "/api/waiting-taps/complete", body: { tapId: "tap-1", amount: "3240", currency: "JPY" } }]);
  assert.equal(result.option.change.undo, null);
  assert.ok(ASK_CHANGE_PATHS.includes("/api/waiting-taps/complete"));
});

test("a catch-all entry takes the shop's sure habitual category with its own Undo", () => {
  const receipt = { merchant: "Toast Box", date: "2026-11-12", totalMinor: 760, currency: "SGD", noteLines: ["Kaya toast 2.60"] };
  const result = chooseReceiptMatch(receipt, facts([entry({ description: "TOAST BOX", amountMinor: 760 })], { habitCategory: "Food & Drinks" }));
  const change = result.option.change;
  assert.deepEqual(change.rows.map((row) => [row.field, row.before, row.after]), [["category", "Other", "Food & Drinks"], ["note", "", "Kaya toast 2.60"]]);
  assert.deepEqual(change.undo.map((step) => step.path), ["/api/entries/update-note", "/api/entries/update-category"]);
});

test("the note keeps what it had, never repeats a line and stays bounded", () => {
  assert.equal(noteWithReceipt("Kaya toast 2.60", ["Kaya toast 2.60"]), "Kaya toast 2.60");
  const long = noteWithReceipt("", Array.from({ length: 80 }, (_, index) => `Item ${index} 1.00`));
  assert.ok(long.length <= 900);
  assert.ok(long.endsWith("…"));
});

test("the route refuses anything that is not a validated receipt", () => {
  assert.equal(readReceiptMatchBody({ receipt: { ...RECEIPT, currency: "XYZ" } }), null);
  assert.equal(readReceiptMatchBody({ receipt: { ...RECEIPT, totalMinor: -5 } }), null);
  assert.equal(readReceiptMatchBody({ receipt: { ...RECEIPT, date: "2026-13-40" } }), null);
  assert.equal(readReceiptMatchBody({ receipt: { ...RECEIPT, merchant: "  " } }), null);
  assert.equal(readReceiptMatchBody({ receipt: { ...RECEIPT, noteLines: ["x".repeat(200)] } }), null);
  assert.equal(readReceiptMatchBody({ receipt: { ...RECEIPT, image: "data:image/png;base64,AAAA" } }).image, undefined);
  assert.deepEqual(readReceiptMatchBody({ receipt: RECEIPT }), { ...RECEIPT, noteLines: [] });
});

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("through the Worker: the household's entry is matched and saved through update-note; another household's never is", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const today = todayInAppTimeZone();
  const entryId = await createEntry(api, { date: today, description: "ZQX BAKERY NOVENA", amountMinor: 1_845, categoryName: "Groceries" });

  // An identical row in another household: same shop, day and figure.
  await db.prepare("INSERT INTO households (id, name) VALUES ('household-other', 'Other household')").run();
  await db.prepare("INSERT INTO accounts (id, household_id, institution_id, account_name, account_kind, currency) SELECT 'acct-other', 'household-other', institution_id, 'Other card', 'credit_card', 'SGD' FROM accounts LIMIT 1").run();
  await db.prepare("INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, currency, entry_type) VALUES ('txn-other-household', 'household-other', 'acct-other', ?, 'ZQX BAKERY NOVENA', 1845, 'SGD', 'expense')").bind(today).run();

  const receipt = { merchant: "ZQX Bakery Novena", date: today, totalMinor: 1_845, currency: "SGD", noteLines: ["Sourdough 9.00", "Croissant x3 9.45"] };
  const { status, payload } = await api("/api/ask/receipt-match", { receipt });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.match.kind, "one", JSON.stringify(payload.match));
  assert.equal(payload.match.option.id, entryId);
  assert.notEqual(payload.match.option.id, "txn-other-household");

  for (const step of payload.match.option.change.save) {
    const saved = await api(step.path, step.body);
    assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  }
  const [stored] = await rows(db, "SELECT note, amount_minor, description FROM transactions WHERE id = ?", entryId);
  assert.deepEqual(stored, { note: "Sourdough 9.00\nCroissant x3 9.45", amount_minor: 1_845, description: "ZQX BAKERY NOVENA" });
  // The other household's row is untouched.
  const [other] = await rows(db, "SELECT note FROM transactions WHERE id = 'txn-other-household'");
  assert.equal(other.note, null);

  // The same receipt again: its lines are already in the note.
  const again = await api("/api/ask/receipt-match", { receipt });
  assert.equal(again.payload.match.option.change, null);

  // Undo puts the note back.
  for (const step of payload.match.option.change.undo) await api(step.path, step.body);
  const [undone] = await rows(db, "SELECT note FROM transactions WHERE id = ?", entryId);
  assert.equal(undone.note, "");
});

test("through the Worker: a statement-certified entry is matched and keeps its bank facts", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const today = todayInAppTimeZone();
  const entryId = await createEntry(api, { date: today, description: "ZQX STATIONERS", amountMinor: 4_210 });
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(entryId).run();
  const { payload } = await api("/api/ask/receipt-match", { receipt: { merchant: "ZQX Stationers", date: today, totalMinor: 4_210, currency: "SGD", noteLines: ["A5 notebook 12.90"] } });
  assert.equal(payload.match.kind, "one");
  assert.equal(payload.match.option.certified, true);
  for (const step of payload.match.option.change.save) {
    const saved = await api(step.path, step.body);
    assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  }
  const [stored] = await rows(db, "SELECT note, amount_minor, description, transaction_date, bank_certification_status FROM transactions WHERE id = ?", entryId);
  assert.deepEqual(stored, { note: "A5 notebook 12.90", amount_minor: 4_210, description: "ZQX STATIONERS", transaction_date: today, bank_certification_status: "statement_certified" });
});

test("through the Worker: no match is none, and a bad body is refused before any read", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const none = await api("/api/ask/receipt-match", { receipt: { merchant: "Nowhere Shop ZQX", date: todayInAppTimeZone(), totalMinor: 99_999, currency: "SGD" } });
  assert.deepEqual(none.payload, { ok: true, match: { kind: "none" } });
  const bad = await api("/api/ask/receipt-match", { receipt: { merchant: "x", date: "soon", totalMinor: 1, currency: "SGD" } });
  assert.equal(bad.status, 400);
});
