// "Remember this for cash" (DOMAIN.md "Payment Way"; docs/flows/
// cash-entry-flow.md "Remember this for cash"): after a person picks the
// wallet a cash payment came from, one tap sets it as their cash wallet
// through the existing Payment ways command, in its cash-only form
// (`only: "cash"`): the PayNow choice is kept as it was (the default when
// never chosen), and the wallet must be one the person may use: their own
// active cash account or a joint one. Real Worker routes on local D1 with
// the demo household (Tim, Joyce).
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { savePaymentWay } from "../src/domain/app-repository-payment-ways.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function createAccount(api, input) {
  const { status, payload } = await api("/api/accounts/create", { currency: "SGD", ...input });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.accountId;
}

async function paymentWays(api) {
  const { status, payload } = await api("/api/settings-page?view=household");
  assert.equal(status, 200);
  return payload.settingsPage.paymentWays;
}

async function cashDefaults(api, personId) {
  const { status, payload } = await api(`/api/cash-entries/defaults?person=${personId}`);
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.defaults;
}

test("remembering sets only the cash wallet, keeps the default PayNow account, and the pad then stops asking", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const wallet = await createAccount(api, { name: "Tim Pocket", institution: "Cash", kind: "cash", ownerPersonId: "person-tim" });
  // Before: no cash wallet, so a cash Save is asked which wallet.
  const asked = await api("/api/cash-entries/create", { requestId: "req-before", personId: "person-tim", amountMinor: 240, currency: "SGD" });
  assert.equal(asked.status, 409);
  assert.equal(asked.payload.needsWallet, true);

  const saved = await api("/api/settings/payment-ways/save", { personId: "person-tim", cashAccountId: wallet, only: "cash" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual(saved.payload, { ok: true, updated: true, cashWallet: { personId: "person-tim", cashAccountId: wallet } });

  // Stored: only the cash wallet, so PayNow still follows the default.
  const [row] = await rows(db, "SELECT value_json FROM app_settings WHERE key = 'payment_ways'");
  assert.deepEqual(JSON.parse(row.value_json), { people: { "person-tim": { cashAccountId: wallet } } });
  assert.deepEqual((await paymentWays(api))[0], { personId: "person-tim", bankTransferAccountId: "acct-uob-savings", cashAccountId: wallet });
  const [audit] = await rows(db, "SELECT detail FROM audit_events WHERE action = 'payment_way_updated'");
  assert.equal(audit.detail, "Payment ways for Tim: cash from Tim Pocket.");

  // After: the pad opens on that wallet and a cash Save no longer asks.
  assert.equal((await cashDefaults(api, "person-tim")).wallet?.id, wallet);
  const paid = await api("/api/cash-entries/create", { requestId: "req-after", personId: "person-tim", amountMinor: 240, currency: "SGD" });
  assert.equal(paid.status, 200, JSON.stringify(paid.payload));
  assert.equal(paid.payload.entry.accountId, wallet);
  // And a typed "taxi 15 cash" fills that wallet in, with no question.
  const draft = await api("/api/ai-assist/entry-draft", { text: "taxi 15 cash", viewId: "person-tim" });
  assert.deepEqual(draft.payload.draft.fields.accountId, { value: wallet, source: "rule" });
  assert.deepEqual(draft.payload.draft.questions, []);
});

test("remembering keeps a PayNow account chosen earlier, and Undo (none) puts the question back", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const wallet = await createAccount(api, { name: "Shared tin", institution: "Cash", kind: "cash" });
  await api("/api/settings/payment-ways/save", { personId: "person-joyce", bankTransferAccountId: "acct-household", cashAccountId: "" });
  // A joint cash wallet is Joyce's to use.
  const saved = await api("/api/settings/payment-ways/save", { personId: "person-joyce", cashAccountId: wallet, only: "cash" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual((await paymentWays(api))[1], { personId: "person-joyce", bankTransferAccountId: "acct-household", cashAccountId: wallet });

  const undone = await api("/api/settings/payment-ways/save", { personId: "person-joyce", cashAccountId: "", only: "cash" });
  assert.equal(undone.status, 200);
  assert.deepEqual((await paymentWays(api))[1], { personId: "person-joyce", bankTransferAccountId: "acct-household", cashAccountId: "" });
  const asked = await api("/api/cash-entries/create", { requestId: "req-undone", personId: "person-joyce", amountMinor: 500, currency: "SGD" });
  assert.equal(asked.status, 409);
});

test("negative: another person's wallet, another household's, a bank account and an archived wallet are refused, and nothing is written", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const joycePurse = await createAccount(api, { name: "Joyce Purse", institution: "Cash", kind: "cash", ownerPersonId: "person-joyce" });
  const elsewhere = await createAccount(api, { name: "Elsewhere cash", institution: "Cash", kind: "cash", ownerPersonId: "person-tim" });
  await db.prepare("INSERT INTO households (id, name) VALUES ('household-other', 'Another household')").run();
  await db.prepare("UPDATE accounts SET household_id = 'household-other' WHERE id = ?").bind(elsewhere).run();
  const oldWallet = await createAccount(api, { name: "Old tin", institution: "Cash", kind: "cash", ownerPersonId: "person-tim" });
  await api("/api/accounts/archive", { accountId: oldWallet });
  const settingsBefore = await rows(db, "SELECT key FROM app_settings WHERE key = 'payment_ways'");
  const auditsBefore = await rows(db, "SELECT id FROM audit_events");

  const refusals = [
    [{ personId: "person-tim", cashAccountId: joycePurse, only: "cash" }, "Choose a cash wallet of your own or a joint one."],
    [{ personId: "person-tim", cashAccountId: elsewhere, only: "cash" }, "Choose an active cash account for cash."],
    [{ personId: "person-tim", cashAccountId: "acct-uob-savings", only: "cash" }, "Choose an active cash account for cash."],
    [{ personId: "person-tim", cashAccountId: oldWallet, only: "cash" }, "Choose an active cash account for cash."],
    [{ personId: "person-nobody", cashAccountId: joycePurse, only: "cash" }, "Choose a person in this household."]
  ];
  for (const [body, error] of refusals) {
    const { status, payload } = await api("/api/settings/payment-ways/save", body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.deepEqual(payload, { ok: false, error }, JSON.stringify(body));
  }
  assert.deepEqual(await rows(db, "SELECT key FROM app_settings WHERE key = 'payment_ways'"), settingsBefore);
  assert.deepEqual(await rows(db, "SELECT id FROM audit_events"), auditsBefore);
  // The full Settings form keeps its own rule: any active cash account.
  const settings = await api("/api/settings/payment-ways/save", { personId: "person-tim", bankTransferAccountId: "acct-uob-savings", cashAccountId: joycePurse });
  assert.equal(settings.status, 200);
});

test("all-or-nothing: a remember that fails on its audit event or its setting leaves the database as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const wallet = await createAccount(api, { name: "Tim Pocket", institution: "Cash", kind: "cash", ownerPersonId: "person-tim" });
  await savePaymentWay(db, { personId: "person-tim", bankTransferAccountId: "acct-uob-savings", cashAccountId: "" });
  for (const pattern of [/INSERT INTO audit_events/, /INSERT INTO app_settings/]) {
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(savePaymentWay(faulty.db, { personId: "person-tim", cashAccountId: wallet, only: "cash" }), /injected_failure_missing_table/);
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  }
});
