// POST /api/ask/turn, Phase 2 (docs/proposals/ask-ai-first/inventory.md):
// changes to saved data, through the real Worker on a local D1 seeded with
// the demo household and a stubbed AI provider. Each turn reads the
// household's own rows and answers with a change card; the turn itself
// writes nothing but the allowance counter. The card's Save is then posted
// exactly as the page posts it, through the existing command, and its Undo
// puts the data back.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const THIS_MONTH = TODAY.slice(0, 7);

function stubAi(reply) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] };
    }
  };
}

async function turn(db, body, model) {
  const ai = stubAi(model);
  const env = { DB: db, ...template.config.vars, AI: ai, AI_ASSIST_ENABLED: "true" };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: THIS_MONTH, page: "ask", ...body })
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.mode, "ai", JSON.stringify(payload));
  return { reply: payload.reply, prompt: ai.calls[0]?.input.messages.at(-1).content ?? "" };
}

// Posts a card's steps as the page does, carrying a result value into the
// next body where the card says so.
async function run(api, steps, extra = {}) {
  let last = null;
  for (const step of steps) {
    const body = { ...step.body, ...extra };
    if (step.fromResult && last) body[step.fromResult.as] = last[step.fromResult.key];
    const result = await api(step.path, body);
    assert.equal(result.status, 200, `${step.path}: ${JSON.stringify(result.payload)}`);
    last = result.payload;
  }
  return last;
}

// The turn wrote only the allowance counter.
async function assertOnlyAllowanceChanged(db, before) {
  const after = await dumpDatabase(db);
  assertSameDatabase({ ...after, ai_assist_daily_usage: before.ai_assist_daily_usage }, before);
}

async function categoryOf(db, entryId) {
  const [row] = await rows(db, "SELECT categories.name AS name FROM transactions JOIN categories ON categories.id = transactions.category_id WHERE transactions.id = ?", entryId);
  return row?.name;
}

test("recategorise one: the saved entry in focus, a card, Save through the category command, Undo back", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: TODAY, description: "GRAB RIDE HOME", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 1_850 });
  const before = await dumpDatabase(db);
  const { reply } = await turn(db, { text: "make it Taxi", focus: { kind: "saved_entry", entryId } }, { action: "recategorise", recategorise: { category: "Taxi" } });
  assert.equal(reply.kind, "change");
  assert.equal(reply.change.type, "recategorise");
  assert.deepEqual(reply.change.rows, [{ field: "category", before: "Food & Drinks", after: "Taxi" }]);
  await assertOnlyAllowanceChanged(db, before);

  await run(api, reply.change.save);
  assert.equal(await categoryOf(db, entryId), "Taxi");
  await run(api, reply.change.undo);
  assert.equal(await categoryOf(db, entryId), "Food & Drinks");
});

test("recategorise many: \"make all Grab rides Transport\" lists exactly the matching entries; nothing moves until Save; the optional rule saves through category rules", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  // Letters only: words with a long number in them are scrubbed like any
  // other name before they reach a card.
  const tag = "ZQXGRAB";
  const moved = [
    await createEntry(api, { date: "2026-05-03", description: `${tag} RIDE`, categoryName: "Food & Drinks", amountMinor: 1_200 }),
    await createEntry(api, { date: "2026-06-04", description: `${tag} RIDE`, categoryName: "Other", amountMinor: 900 })
  ];
  const already = await createEntry(api, { date: "2026-06-05", description: `${tag} RIDE`, categoryName: "Public Transport", amountMinor: 700 });
  const unrelated = await createEntry(api, { date: "2026-06-06", description: "KOPI BAR", categoryName: "Food & Drinks", amountMinor: 500 });
  const before = await dumpDatabase(db);

  const { reply } = await turn(db, { text: `make all ${tag} rides Public Transport` }, { action: "recategorise", recategorise: { category: "Public Transport", words: tag } });
  assert.equal(reply.kind, "change", JSON.stringify(reply));
  const { change } = reply;
  assert.equal(change.type, "recategorise_bulk");
  assert.equal(change.count, 2);
  assert.deepEqual(change.entries.map((entry) => [entry.entryId, entry.categoryName]), [[moved[1], "Other"], [moved[0], "Food & Drinks"]]);
  assert.equal(change.confirmCount, null);
  assert.equal(change.rule.pattern, tag);
  await assertOnlyAllowanceChanged(db, before);

  await run(api, change.save);
  assert.equal(await categoryOf(db, moved[0]), "Public Transport");
  assert.equal(await categoryOf(db, moved[1]), "Public Transport");
  assert.equal(await categoryOf(db, already), "Public Transport");
  assert.equal(await categoryOf(db, unrelated), "Food & Drinks");
  const rule = await api("/api/category-match-rules/save", { pattern: change.rule.pattern, categoryId: change.rule.categoryId });
  assert.equal(rule.status, 200, JSON.stringify(rule.payload));
  assert.deepEqual(await rows(db, "SELECT pattern FROM category_match_rules WHERE id = ?", rule.payload.ruleId), [{ pattern: tag }]);

  await run(api, change.undo);
  assert.equal(await categoryOf(db, moved[0]), "Food & Drinks");
  assert.equal(await categoryOf(db, moved[1]), "Other");
});

test("edit a saved entry: amount and note through the entry update; Undo restores both", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: TODAY, description: "LUNCH", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 1_200 });
  const { reply, prompt } = await turn(db, { text: "it was 15, note team lunch", focus: { kind: "saved_entry", entryId } }, { action: "edit_saved_entry", entry: { amount: "15", note: "team lunch" } });
  assert.equal(reply.change.type, "edit_entry");
  assert.doesNotMatch(prompt, /1200|12\.00/);
  await run(api, reply.change.save);
  assert.deepEqual(await rows(db, "SELECT amount_minor, note FROM transactions WHERE id = ?", entryId), [{ amount_minor: 1_500, note: "team lunch" }]);
  await run(api, reply.change.undo);
  assert.deepEqual(await rows(db, "SELECT amount_minor, note FROM transactions WHERE id = ?", entryId), [{ amount_minor: 1_200, note: "" }]);
});

// A savings purchase a May statement certifies (as in
// statement-certified-type-lock.test.mjs).
async function certifiedPurchase(api) {
  const accountName = "Ask Lock Savings";
  const created = await api("/api/accounts/create", { name: accountName, institution: "Synthetic Test Bank", kind: "bank", openingBalanceMinor: 0, currency: "SGD", ownerPersonId: "", isJoint: false });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const accountId = created.payload.accountId;
  const purchaseId = await createEntry(api, { date: "2026-05-21", description: "NTUC FAIRPRICE", accountName, accountId, categoryName: "Groceries", amountMinor: 1_250 });
  const checkpoints = [{ accountId, accountName, detectedAccountName: accountName, checkpointMonth: "2026-05", statementStartDate: "2026-05-01", statementEndDate: "2026-05-31", statementBalanceMinor: -1_250, note: "Ask lock" }];
  const preview = await api("/api/imports/preview", {
    sourceLabel: "Ask lock statement", sourceType: "pdf", defaultAccountName: accountName, ownershipType: "direct", ownerName: "Tim", statementCheckpoints: checkpoints,
    rows: [{ date: "2026-05-21", description: "NTUC FAIRPRICE", expense: "12.50", accountId, account: accountName, category: "Groceries" }]
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const previewRows = preview.payload.preview.previewRows;
  const commit = await api("/api/imports/commit", {
    sourceLabel: "Ask lock statement", sourceType: "pdf", parserKey: "uob_savings_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints: checkpoints, statementControlRows: previewRows, statementReconciliations: preview.payload.preview.statementReconciliations
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  return purchaseId;
}

test("negative: a statement-certified entry's amount is not changed from Ask and the turn says why; its category still changes", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const purchaseId = await certifiedPurchase(api);
  assert.deepEqual(await rows(db, "SELECT bank_certification_status FROM transactions WHERE id = ?", purchaseId), [{ bank_certification_status: "statement_certified" }]);
  const before = await dumpDatabase(db);
  const { reply, prompt } = await turn(db, { text: "make it 1", focus: { kind: "saved_entry", entryId: purchaseId } }, { action: "edit_saved_entry", entry: { amount: "1" } });
  assert.deepEqual(reply, {
    kind: "note",
    text: "The bank's May 2026 statement confirms this entry's amount, date, description and wallet, so they stay as the bank has them. You can still change its category, owner or note."
  });
  assert.match(prompt, /locked by a bank statement/);
  await assertOnlyAllowanceChanged(db, before);

  const category = await turn(db, { text: "make it food", focus: { kind: "saved_entry", entryId: purchaseId } }, { action: "edit_saved_entry", entry: { category: "Food & Drinks" } });
  assert.equal(category.reply.kind, "change");
  await run(api, category.reply.change.save);
  assert.equal(await categoryOf(db, purchaseId), "Food & Drinks");
});

test("negative: an entry id from outside the household is no focus, so nothing is drafted", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  for (const model of [
    { action: "edit_saved_entry", entry: { category: "Taxi" } },
    { action: "edit_note", note_edit: { target: "entry", text: "hello" } },
    { action: "link_transfer" }
  ]) {
    const { reply } = await turn(db, { text: "taxi hello", focus: { kind: "saved_entry", entryId: "txn-not-ours" } }, model);
    assert.equal(reply.kind, "note", model.action);
  }
});

test("link a transfer: the one other side with the same amount is found from the household's rows; Save links the pair", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [bank] = await rows(db, "SELECT account_name FROM accounts WHERE account_kind = 'bank' AND is_active = 1 AND account_name <> 'UOB One' ORDER BY account_name LIMIT 1");
  const out = await createEntry(api, { date: "2026-05-20", description: "FAST TRANSFER OUT", accountName: "UOB One", categoryName: "Other", amountMinor: 123_457 });
  const into = await createEntry(api, { date: "2026-05-20", description: "FAST TRANSFER IN", accountName: bank.account_name, categoryName: "Other - Income", entryType: "income", amountMinor: 123_457 });
  const { reply } = await turn(db, { text: "this was a transfer", focus: { kind: "saved_entry", entryId: out } }, { action: "link_transfer" });
  assert.equal(reply.kind, "change", JSON.stringify(reply));
  assert.deepEqual(reply.change.save, [{ path: "/api/transfers/link", body: { fromEntryId: out, toEntryId: into } }]);
  await run(api, reply.change.save);
  const linked = await rows(db, "SELECT id, entry_type, transfer_direction FROM transactions WHERE id IN (?, ?) ORDER BY transfer_direction", out, into);
  assert.deepEqual(linked.map((row) => [row.id, row.entry_type, row.transfer_direction]), [[into, "transfer", "in"], [out, "transfer", "out"]]);
});

test("settle a whole group: the balance Splits shows becomes the settle-up draft; recording it leaves nothing owed", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [group] = await rows(db, "SELECT id, group_name, currency FROM split_groups WHERE currency = 'SGD' ORDER BY sort_order LIMIT 1");
  const created = await api("/api/splits/expenses/create", { groupId: group.id, date: TODAY, description: "Dinner", categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 8_000, splitBasisPoints: 5000, currency: "SGD" });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const page = await api(`/api/splits-page?view=person-tim&month=${THIS_MONTH}`);
  const balance = page.payload.splitsPage.groups.find((item) => item.id === group.id).balanceMinor;
  assert.notEqual(balance, 0);

  const { reply } = await turn(db, { text: "settle up everything", focus: { kind: "split_group", groupId: group.id } }, { action: "split_group", group: { op: "settle" } });
  assert.equal(reply.kind, "settlement_draft", JSON.stringify(reply));
  assert.equal(reply.settlement.amountMinor, Math.abs(balance));
  assert.equal(reply.settlement.groupId, group.id);
  assert.deepEqual([reply.settlement.fromPersonName, reply.settlement.toPersonName], balance > 0 ? ["Joyce", "Tim"] : ["Tim", "Joyce"]);

  const saved = await api("/api/splits/settlements/create", { groupId: reply.settlement.groupId, date: reply.settlement.date, fromPersonName: reply.settlement.fromPersonName, toPersonName: reply.settlement.toPersonName, amountMinor: reply.settlement.amountMinor, currency: reply.settlement.currency });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const after = await api(`/api/splits-page?view=person-tim&month=${THIS_MONTH}`);
  assert.equal(after.payload.splitsPage.groups.find((item) => item.id === group.id)?.balanceMinor ?? 0, 0);
});

test("a month note, a payment way and a new category each save through their command, with Undo where it has one", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const month = await turn(db, { text: "May 2026 note: Bali trip month" }, { action: "edit_note", note_edit: { target: "month", text: "Bali trip month", month: "2026-05" } });
  assert.equal(month.reply.change.type, "month_note");
  await run(api, month.reply.change.save);
  assert.deepEqual(await rows(db, "SELECT note FROM monthly_snapshots WHERE year = 2026 AND month = 5 AND person_scope = 'person-tim'"), [{ note: "Bali trip month" }]);

  const [cash] = await rows(db, "SELECT id, account_name FROM accounts WHERE account_kind = 'cash' AND is_active = 1 LIMIT 1");
  if (cash) {
    const way = await turn(db, { text: `my cash is ${cash.account_name}` }, { action: "set_payment_way", payment_way: { cash_wallet: cash.account_name } });
    assert.ok(["change", "note"].includes(way.reply.kind), JSON.stringify(way.reply));
    if (way.reply.kind === "change") {
      await run(api, way.reply.change.save);
      await run(api, way.reply.change.undo);
    }
  }

  const category = await turn(db, { text: "add a category Pets" }, { action: "edit_category", category_edit: { op: "create", new_name: "Pets" } });
  assert.equal(category.reply.change.type, "category_create");
  await run(api, category.reply.change.save);
  assert.equal((await rows(db, "SELECT name FROM categories WHERE name = 'Pets'")).length, 1);
});

test("Simplify shows the payment the command records, and Undo reopens it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const created = await api("/api/splits/expenses/create", { groupId: null, date: TODAY, description: "Groceries", categoryName: "Groceries", payerPersonName: "Joyce", amountMinor: 6_000, splitBasisPoints: 5000, currency: "SGD" });
  assert.equal(created.status, 200);
  const { reply } = await turn(db, { text: "simplify everything in SGD" }, { action: "split_group", group: { op: "simplify", currency: "SGD" } });
  if (reply.kind !== "change") {
    // The demo may hold open records in another currency or an open checkpoint.
    assert.ok(["clarify", "open_page", "note"].includes(reply.kind), JSON.stringify(reply));
    return;
  }
  const shown = reply.change.rows.find((row) => row.field === "amount").afterMinor;
  const result = await run(api, reply.change.save);
  assert.equal(result.amountMinor, shown);
  const reopened = await run(api, reply.change.undo.map((step) => ({ ...step, body: { ...step.body, checkpointId: result.checkpointId } })));
  assert.equal(reopened.status, "reopened");
});

test("never from Ask: a delete is not drafted; the turn opens Entries and says why", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const { reply } = await turn(db, { text: "delete this entry" }, { action: "cannot_help", blocked: "delete_entry" });
  assert.equal(reply.kind, "open_page");
  assert.equal(reply.page, "entries");
  assert.match(reply.why, /Ask doesn't delete entries/);
  await assertOnlyAllowanceChanged(db, before);
});
