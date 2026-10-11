// Settings -> Payment ways (DOMAIN.md "Payment Way"): per person, the account
// their PayNow and bank transfers come from and an optional cash wallet.
// Pure resolution first, then the real Worker routes against a local D1
// seeded with the demo household (Tim, Joyce; Tim owns the UOB Savings bank
// account, Household Float is a joint bank account, the rest are cards).
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import {
  defaultBankTransferAccountId,
  parseStoredPaymentWays,
  resolvePaymentWays
} from "../src/domain/payment-ways.ts";

// ------------------------------------------------------------------ pure

const account = (id, kind, ownerPersonId, extra = {}) => ({
  id,
  institutionId: "inst",
  ownerPersonId,
  name: id,
  institution: "Bank",
  kind,
  ownerLabel: ownerPersonId ?? "Shared",
  currency: "SGD",
  isJoint: !ownerPersonId,
  isActive: true,
  ...extra
});
const ACCOUNTS = [
  account("card-a", "credit_card", "person-a"),
  account("joint", "bank", undefined),
  account("bank-a2", "bank", "person-a"),
  account("bank-a1", "bank", "person-a"),
  account("old-bank-a", "bank", "person-a", { isActive: false }),
  account("wallet-a", "cash", "person-a"),
  account("bank-b", "bank", "person-b")
];
const PEOPLE = [{ id: "person-a", name: "A" }, { id: "person-b", name: "B" }, { id: "person-c", name: "C" }];
const PRIORITY = ["old-bank-a", "card-a", "joint", "bank-a1", "bank-a2", "bank-b"];

test("the default PayNow account is the person's own first active bank account in Default account priority, never a joint one", () => {
  assert.equal(defaultBankTransferAccountId("person-a", ACCOUNTS, PRIORITY), "bank-a1");
  assert.equal(defaultBankTransferAccountId("person-b", ACCOUNTS, PRIORITY), "bank-b");
  assert.equal(defaultBankTransferAccountId("person-c", ACCOUNTS, PRIORITY), "", "no own bank account: none, not the joint one");
  assert.deepEqual(resolvePaymentWays({ people: {} }, { accounts: ACCOUNTS, people: PEOPLE, priorityIds: PRIORITY }), [
    { personId: "person-a", bankTransferAccountId: "bank-a1", cashAccountId: "" },
    { personId: "person-b", bankTransferAccountId: "bank-b", cashAccountId: "" },
    { personId: "person-c", bankTransferAccountId: "", cashAccountId: "" }
  ]);
});

test("a choice is kept as made, none included; an account that no longer counts goes back to the default or none", () => {
  const stored = parseStoredPaymentWays(JSON.stringify({
    people: {
      "person-a": { bankTransferAccountId: "joint", cashAccountId: "wallet-a" },
      "person-b": { bankTransferAccountId: "", cashAccountId: "" },
      "person-c": { bankTransferAccountId: "old-bank-a", cashAccountId: "bank-b" }
    }
  }));
  assert.deepEqual(resolvePaymentWays(stored, { accounts: ACCOUNTS, people: PEOPLE, priorityIds: PRIORITY }), [
    { personId: "person-a", bankTransferAccountId: "joint", cashAccountId: "wallet-a" },
    { personId: "person-b", bankTransferAccountId: "", cashAccountId: "" },
    // An archived bank account goes back to the default (none for C); a
    // bank account is never a cash wallet.
    { personId: "person-c", bankTransferAccountId: "", cashAccountId: "" }
  ]);
});

test("negative: unreadable stored JSON is treated as nothing chosen", () => {
  for (const value of [undefined, "", "not json", "[1,2]", JSON.stringify({ people: [1] }), JSON.stringify({ people: { "person-a": 4 } })]) {
    assert.deepEqual(parseStoredPaymentWays(value), { people: {} }, String(value));
  }
});

// ------------------------------------------------------------- Worker + D1

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function paymentWays(api) {
  const { status, payload } = await api("/api/settings-page?view=household");
  assert.equal(status, 200);
  return payload.settingsPage.paymentWays;
}

async function createAccount(api, input) {
  const { status, payload } = await api("/api/accounts/create", { currency: "SGD", ...input });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.accountId;
}

test("the Settings page lists every person's payment ways with the defaults", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  assert.deepEqual(await paymentWays(api), [
    { personId: "person-tim", bankTransferAccountId: "acct-uob-savings", cashAccountId: "" },
    // Joyce owns no bank account: the joint one is not assumed.
    { personId: "person-joyce", bankTransferAccountId: "", cashAccountId: "" }
  ]);
  assert.deepEqual(await rows(db, "SELECT key FROM app_settings WHERE key = 'payment_ways'"), [], "reading writes nothing");
});

test("saving one person's payment ways stores just that person, audits it, and keeps the other person's", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const wallet = await createAccount(api, { name: "Joyce Purse", institution: "Cash", kind: "cash", ownerPersonId: "person-joyce" });

  const saved = await api("/api/settings/payment-ways/save", {
    personId: "person-joyce",
    bankTransferAccountId: "acct-household",
    cashAccountId: wallet
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.payload, {
    ok: true,
    updated: true,
    paymentWay: { personId: "person-joyce", bankTransferAccountId: "acct-household", cashAccountId: wallet }
  });

  // Tim chooses none for PayNow: kept as none, not put back to the default.
  const tim = await api("/api/settings/payment-ways/save", { personId: "person-tim", bankTransferAccountId: "", cashAccountId: "" });
  assert.equal(tim.status, 200);

  const [row] = await rows(db, "SELECT value_json FROM app_settings WHERE key = 'payment_ways'");
  assert.deepEqual(JSON.parse(row.value_json), {
    people: {
      "person-joyce": { bankTransferAccountId: "acct-household", cashAccountId: wallet },
      "person-tim": { bankTransferAccountId: "", cashAccountId: "" }
    }
  });
  assert.deepEqual(await paymentWays(api), [
    { personId: "person-tim", bankTransferAccountId: "", cashAccountId: "" },
    { personId: "person-joyce", bankTransferAccountId: "acct-household", cashAccountId: wallet }
  ]);
  const audits = await rows(db, "SELECT entity_type, entity_id, action, detail FROM audit_events WHERE action = 'payment_way_updated' ORDER BY rowid");
  assert.deepEqual(audits, [
    {
      entity_type: "settings",
      entity_id: "payment_ways",
      action: "payment_way_updated",
      detail: "Payment ways for Joyce: PayNow and bank transfers from Household Float; cash from Joyce Purse."
    },
    {
      entity_type: "settings",
      entity_id: "payment_ways",
      action: "payment_way_updated",
      detail: "Payment ways for Tim: PayNow and bank transfers from none; cash from none."
    }
  ]);
});

test("any active bank account may be chosen, another person's included; an archived choice goes back to the default", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const joyceBank = await createAccount(api, { name: "Joyce DBS", institution: "DBS", kind: "bank", ownerPersonId: "person-joyce" });
  const timOnJoyce = await api("/api/settings/payment-ways/save", { personId: "person-tim", bankTransferAccountId: joyceBank });
  assert.equal(timOnJoyce.status, 200);
  assert.equal((await paymentWays(api))[0].bankTransferAccountId, joyceBank);

  const archived = await api("/api/accounts/archive", { accountId: joyceBank });
  assert.equal(archived.status, 200);
  assert.deepEqual((await paymentWays(api))[0], { personId: "person-tim", bankTransferAccountId: "acct-uob-savings", cashAccountId: "" });
});

test("negative: a card, a non-cash wallet, an archived or unknown account and an unknown person are refused and nothing is written", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const oldBank = await createAccount(api, { name: "Old Bank", institution: "OCBC", kind: "bank", ownerPersonId: "person-tim" });
  await api("/api/accounts/archive", { accountId: oldBank });
  const auditsBefore = await rows(db, "SELECT id FROM audit_events");

  const refusals = [
    [{ personId: "person-tim", bankTransferAccountId: "acct-uob-one" }, "Choose an active bank account for PayNow and bank transfers."],
    [{ personId: "person-tim", bankTransferAccountId: oldBank }, "Choose an active bank account for PayNow and bank transfers."],
    [{ personId: "person-tim", bankTransferAccountId: "acct-missing" }, "Choose an active bank account for PayNow and bank transfers."],
    [{ personId: "person-tim", cashAccountId: "acct-uob-savings" }, "Choose an active cash account for cash."],
    [{ personId: "person-nobody", bankTransferAccountId: "acct-uob-savings" }, "Choose a person in this household."],
    [{ bankTransferAccountId: "acct-uob-savings" }, "Choose a person in this household."],
    [{ personId: 42 }, "Choose a person in this household."]
  ];
  for (const [body, error] of refusals) {
    const { status, payload } = await api("/api/settings/payment-ways/save", body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.deepEqual(payload, { ok: false, error }, JSON.stringify(body));
  }
  assert.deepEqual(await rows(db, "SELECT key FROM app_settings WHERE key = 'payment_ways'"), []);
  assert.deepEqual(await rows(db, "SELECT id FROM audit_events"), auditsBefore);
});

test("a typed sentence uses the saved payment way through the entry draft route", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const wallet = await createAccount(api, { name: "Joyce Purse", institution: "Pocket", kind: "cash", ownerPersonId: "person-joyce" });
  await api("/api/settings/payment-ways/save", { personId: "person-joyce", bankTransferAccountId: "acct-household", cashAccountId: wallet });

  const paynow = await api("/api/ai-assist/entry-draft", { text: "lunch at nasi lemak bmv 7.20, paynow, mine", viewId: "person-joyce" });
  assert.equal(paynow.status, 200);
  assert.deepEqual(paynow.payload.draft.fields.accountId, { value: "acct-household", source: "rule" });
  assert.deepEqual(paynow.payload.draft.fields.description, { value: "lunch at nasi lemak bmv", source: "sentence" });
  assert.deepEqual(paynow.payload.draft.fields.ownerName, { value: "Joyce", source: "sentence" });
  assert.equal(paynow.payload.draft.createBody.amountMinor, 720);

  const cash = await api("/api/ai-assist/entry-draft", { text: "taxi 15 cash", viewId: "person-joyce" });
  assert.deepEqual(cash.payload.draft.fields.accountId, { value: wallet, source: "rule" });

  // Tim has chosen nothing: his default PayNow account is UOB Savings.
  const tim = await api("/api/ai-assist/entry-draft", { text: "kopi 2.40 paynow", viewId: "person-tim" });
  assert.deepEqual(tim.payload.draft.fields.accountId, { value: "acct-uob-savings", source: "rule" });
  // Tim has no cash wallet: cash keeps Default account priority.
  const timCash = await api("/api/ai-assist/entry-draft", { text: "taxi 15 cash", viewId: "person-tim" });
  assert.equal(timCash.payload.draft.fields.accountId.source, "default");
});
