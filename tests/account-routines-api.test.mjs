// The account routine facts and the settlement payment, through the real
// Worker routes and local D1: the account pills carry what changed in a bank
// account's routine, and the Splits page carries an open settlement's likely
// payment. Dates are relative to the current month (the routes read today),
// following the same household pattern as tests/account-routines.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { addMonths } from "../src/domain/money-signals/format.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const thisMonth = todayInAppTimeZone().slice(0, 7);
const monthAgo = (count) => addMonths(thisMonth, -count);
const lastDay = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function addBankAccount(db, id, name) {
  const [institution] = await rows(db, "SELECT institution_id FROM accounts LIMIT 1");
  await db.prepare("INSERT INTO accounts (id, household_id, institution_id, owner_person_id, account_name, account_kind, currency) VALUES (?, 'household-1', ?, 'person-joyce', ?, 'bank', 'SGD')")
    .bind(id, institution.institution_id, name).run();
}

let seq = 0;
async function addEntry(db, { account, date, description, amountMinor, type = "expense", direction = null, owner = "person-joyce", category = "cat-other" }) {
  seq += 1;
  const id = `txn-routine-${seq}`;
  await db.prepare(`INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, entry_type, transfer_direction, category_id, owner_person_id)
    VALUES (?, 'household-1', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, account, date, description, amountMinor, type, direction, category, owner).run();
  return id;
}

test("the account pills carry the moved salary, the charges, the scheduled check and own money counted as income", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await addBankAccount(db, "acct-old", "Old Savings");
  await addBankAccount(db, "acct-new", "New Savings");
  for (const count of [5, 4, 3]) {
    await addEntry(db, { account: "acct-old", date: `${monthAgo(count)}-24`, description: "IBG GIRO SALA NORTHWIND PTE LTD SALARY", amountMinor: 833185, type: "income", category: "cat-salary" });
  }
  for (const count of [2, 1]) {
    await addEntry(db, { account: "acct-new", date: `${monthAgo(count)}-23`, description: "GIRO - SALARY SALA NORTHWIND PTE LTD", amountMinor: 833185, type: "income", category: "cat-salary" });
  }
  for (const count of [3, 2, 1]) {
    await addEntry(db, { account: "acct-old", date: `${monthAgo(count)}-03`, description: "IBG GIRO COLL P0000192 IFAST FINANCIAL PL- P0000192", amountMinor: 100000 });
    await addEntry(db, { account: "acct-old", date: `${monthAgo(count)}-03`, description: "IBG GIRO COLL P0000194 IFAST FINANCIAL PL- P0000194", amountMinor: 50000 });
    await addEntry(db, { account: "acct-old", date: lastDay(monthAgo(count)), description: "SERVICE CHARGE", amountMinor: 200 });
  }
  const outId = await addEntry(db, { account: "acct-old", date: `${monthAgo(1)}-26`, description: "FAST PAYMENT via PayNow-Mobile to J DOE", amountMinor: 500000, type: "transfer", direction: "out", category: "cat-transfer" });
  const inId = await addEntry(db, { account: "acct-new", date: `${monthAgo(1)}-26`, description: "PAYNOW-FAST PAYNOW OTHR J DOE", amountMinor: 500000, type: "income" });
  await db.prepare("INSERT INTO account_balance_checkpoints (id, household_id, account_id, checkpoint_month, statement_start_date, statement_end_date, statement_balance_minor) VALUES ('cp-old', 'household-1', 'acct-old', ?, ?, ?, 10352)")
    .bind(monthAgo(1), `${monthAgo(1)}-01`, lastDay(monthAgo(1))).run();

  const pills = await api("/api/summary-account-pills?view=person-joyce");
  assert.equal(pills.status, 200, JSON.stringify(pills.payload));
  const old = pills.payload.accountPills.find((pill) => pill.accountId === "acct-old");
  assert.deepEqual(old.incomeMoved, {
    payer: "Northwind",
    isSalary: true,
    toAccountId: "acct-new",
    toAccountName: "New Savings",
    movedSince: `${monthAgo(2)}-23`,
    payments: [{ payee: "Ifast Financial", amountMinor: 100000 }, { payee: "Ifast Financial", amountMinor: 50000 }],
    statementEndDate: lastDay(monthAgo(1)),
    statementBalanceMinor: 10352
  });
  assert.equal(old.upcomingShortfall.firstShortDate, `${thisMonth}-03`);
  assert.equal(old.upcomingShortfall.shortMinor, 150000 - 10352);
  assert.deepEqual(old.accountCharges.map((charge) => charge.kind), ["account_fee", "account_fee", "account_fee"]);
  const fresh = pills.payload.accountPills.find((pill) => pill.accountId === "acct-new");
  assert.deepEqual(fresh.ownTransfersAsIncome.map((item) => [item.entryId, item.fromEntryId, item.fromAccountName]), [[inId, outId, "Old Savings"]]);

  // Another person's view never sees these accounts.
  const tim = await api("/api/summary-account-pills?view=person-tim");
  assert.equal(tim.payload.accountPills.some((pill) => pill.accountId === "acct-old"), false);
});

test("an open settlement carries the payment that matches it, until that payment is matched", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const settled = `${monthAgo(1)}-05`;
  await db.prepare("UPDATE split_settlement_checkpoints SET status = 'reopened'").run();
  await db.prepare("INSERT INTO split_settlement_checkpoints (id, household_id, from_person_id, to_person_id, amount_minor, settlement_date, status) VALUES ('cp-open', 'household-1', 'person-joyce', 'person-tim', 708217, ?, 'open')")
    .bind(settled).run();
  const [bank] = await rows(db, "SELECT id FROM accounts WHERE account_kind = 'bank' LIMIT 1");
  const payer = await addEntry(db, { account: bank.id, date: `${monthAgo(1)}-08`, description: "PAYNOW-FAST TO TIM", amountMinor: 708217 });
  const payee = await addEntry(db, { account: bank.id, date: `${monthAgo(1)}-08`, description: "PAYNOW-FAST FROM JOYCE", amountMinor: 708217, type: "income", owner: "person-tim" });
  // A payment after two weeks is not the settlement's.
  await addEntry(db, { account: bank.id, date: `${monthAgo(1)}-25`, description: "PAYNOW-FAST TO TIM", amountMinor: 708217 });

  const page = async () => (await api(`/api/splits-page?view=household&month=${monthAgo(1)}`)).payload.splitsPage.settlementCheckpoints.find((item) => item.id === "cp-open");
  assert.deepEqual((await page()).paymentCandidate, { date: `${monthAgo(1)}-08`, amountMinor: 708217, entryIds: [payer, payee], countedAsSpending: true });

  // Linked as a transfer, it no longer counts as spending.
  await db.prepare("UPDATE transactions SET entry_type = 'transfer', transfer_direction = CASE WHEN id = ? THEN 'out' ELSE 'in' END WHERE id IN (?, ?)").bind(payer, payer, payee).run();
  assert.equal((await page()).paymentCandidate.countedAsSpending, false);

  // Matched to the settlement, there is nothing left to suggest.
  const match = await api("/api/splits/checkpoints/match", { checkpointId: "cp-open", transactionId: payer });
  assert.equal(match.status, 200, JSON.stringify(match.payload));
  assert.equal((await page()).paymentCandidate, undefined);
});
