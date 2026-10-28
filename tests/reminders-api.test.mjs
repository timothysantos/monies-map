// GET /api/reminders through the real Worker and a real local D1 seeded with
// the demo household. The route only reads (the whole database is identical
// before and after) and gives each view the reminders its fixed rules raise
// from the household's statements, card payments, Splits, charges and month.
// Dates are relative to the household's today.
import assert from "node:assert/strict";
import test from "node:test";

import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { addDays, addMonths } from "../src/domain/money-signals/format.ts";
import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let onTemplate;
test.before(async () => {
  onTemplate = await createSeededTemplate();
});
test.after(async () => {
  await onTemplate?.dispose();
});

const TIM = "person-tim";
const JOYCE = "person-joyce";
const today = todayInAppTimeZone();
const thisMonth = today.slice(0, 7);
const lastMonth = addMonths(thisMonth, -1);

async function getReminders(fetch, view) {
  const response = await fetch(`/api/reminders?view=${view}`);
  assert.equal(response.status, 200, await response.clone().text());
  return { payload: await response.json(), serverTiming: response.headers.get("server-timing") ?? "" };
}

// A statement checkpoint straight into the table: the reminders only read it.
async function addStatement(db, accountId, month, { endDate, balanceMinor = 0, dueDate = null, minimumMinor = null }) {
  const [household] = await rows(db, "SELECT id FROM households LIMIT 1");
  await db.prepare(`
    INSERT INTO account_balance_checkpoints (
      id, household_id, account_id, checkpoint_month, statement_end_date, statement_balance_minor, payment_due_date, minimum_payment_minor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(`cp-${accountId}-${month}`, household.id, accountId, month, endDate, balanceMinor, dueDate, minimumMinor).run();
}

// A household with no statements, settle-ups or subscription charges of the
// demo's own, so each test builds exactly the facts it asserts on.
async function setUpHousehold({ db, api }) {
  await db.prepare("DELETE FROM account_balance_checkpoints").run();
  // The demo's own open Splits records would raise group reminders of their own.
  await db.prepare("UPDATE split_expenses SET deleted_at = CURRENT_TIMESTAMP").run();
  await db.prepare("UPDATE split_settlements SET deleted_at = CURRENT_TIMESTAMP").run();
  for (const [personId, name] of [[TIM, "Ethan"], [JOYCE, "Serene"]]) {
    const renamed = await api("/api/people/update", { personId, name });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.payload));
  }
  const ids = {};
  for (const account of [
    { name: "Serene Visa", institution: "UOB", kind: "credit_card", ownerPersonId: JOYCE },
    { name: "Ethan Visa", institution: "OCBC", kind: "credit_card", ownerPersonId: TIM },
    { name: "Serene DBS Account", institution: "DBS", kind: "bank", ownerPersonId: JOYCE }
  ]) {
    const created = await api("/api/accounts/create", { currency: "SGD", openingBalanceMinor: 0, ...account });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    ids[account.name] = created.payload.accountId;
  }
  return ids;
}

test("the route answers only GET and says nothing for a household with nothing coming up", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, onTemplate);
  await setUpHousehold({ db, api });
  const post = await fetch("/api/reminders", { method: "POST", body: "{}" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
  const { payload } = await getReminders(fetch, "household");
  assert.deepEqual(payload, { viewId: "household", today, reminders: [] });
});

test("each view gets the reminders its rules raise, in order, and reading changes nothing", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, onTemplate);
  const ids = await setUpHousehold({ db, api });

  // Serene's Visa: a bill due in 3 days, nothing paid to it. Ethan's: due in 5.
  await addStatement(db, ids["Serene Visa"], lastMonth, { endDate: addDays(today, -12), balanceMinor: -52773, dueDate: addDays(today, 3) });
  await addStatement(db, ids["Ethan Visa"], lastMonth, { endDate: addDays(today, -12), balanceMinor: -21000, dueDate: addDays(today, 5) });
  // Her DBS statements closed on the 28th; two months ago's is the latest, so last month's is late.
  await addStatement(db, ids["Serene DBS Account"], addMonths(thisMonth, -3), { endDate: `${addMonths(thisMonth, -3)}-28` });
  await addStatement(db, ids["Serene DBS Account"], addMonths(thisMonth, -2), { endDate: `${addMonths(thisMonth, -2)}-28` });

  // An open settle-up from Serene to Ethan, dated 36 days ago.
  const expense = await api("/api/splits/expenses/create", {
    groupId: null, date: addDays(today, -40), description: "Anniversary dinner", categoryName: "Food & Drinks",
    payerPersonName: "Ethan", amountMinor: 200000, splitAmountMinor: 100000, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  assert.equal(expense.status, 200, JSON.stringify(expense.payload));
  const settleUp = await api("/api/splits/checkpoints/create", { viewerPersonId: JOYCE, date: addDays(today, -36), currency: "SGD" });
  assert.equal(settleUp.status, 200, JSON.stringify(settleUp.payload));
  const [checkpoint] = await rows(db, "SELECT id, from_person_id, amount_minor FROM split_settlement_checkpoints WHERE id = ?", settleUp.payload.checkpointId);

  // Spotify: 1598 for three months, then 1798 this month, on Serene's account.
  for (const [offset, amountMinor] of [[-3, 1598], [-2, 1598], [-1, 1598], [0, 1798]]) {
    await createEntry(api, {
      date: `${addMonths(thisMonth, offset)}-01`, description: "SPOTIFY P3A1B2C3D4", accountName: "Serene Visa",
      categoryName: "Subscriptions MO", amountMinor, ownerName: "Serene"
    });
  }

  await getReminders(fetch, JOYCE);
  const before = await dumpDatabase(db);
  const serene = await getReminders(fetch, JOYCE);
  const household = await getReminders(fetch, "household");
  const ethan = await getReminders(fetch, TIM);
  assertSameDatabase(await dumpDatabase(db), before);

  assert.match(serene.serverTiming, /^app;dur=/);
  assert.equal(serene.payload.viewId, JOYCE);
  assert.equal(serene.payload.today, today);
  const summary = (reminder) => `${reminder.kind}:${reminder.accountName ?? reminder.payeeName ?? reminder.variant}`;
  assert.deepEqual(serene.payload.reminders.map(summary), [
    "card_bill:Serene Visa",
    "statement_missing:Serene DBS Account",
    "splits_waiting:settle_up",
    "price_change:Spotify"
  ]);

  const [bill, missing, splits, price] = serene.payload.reminders;
  assert.deepEqual(bill, {
    key: `card_bill:${ids["Serene Visa"]}:${lastMonth}`,
    kind: "card_bill",
    accountId: ids["Serene Visa"],
    accountName: "Serene Visa",
    statementMonth: lastMonth,
    dueDate: addDays(today, 3),
    daysUntilDue: 3,
    leftMinor: 52773,
    paidMinor: 0,
    currency: "SGD"
  });
  assert.equal(missing.statementMonth, addMonths(thisMonth, -1));
  assert.equal(missing.expectedOn, `${addMonths(thisMonth, -1)}-28`);
  assert.equal(splits.direction, checkpoint.from_person_id === JOYCE ? "you_owe" : "owed_to_you");
  assert.equal(splits.amountMinor, checkpoint.amount_minor);
  assert.equal(splits.weeks, 5);
  assert.deepEqual([price.fromMinor, price.toMinor, price.priorChargeCount, price.firstNewChargeDate], [1598, 1798, 3, `${thisMonth}-01`]);

  // The household sees Ethan's card too (the soonest bill first is Serene's, then his), and Splits between them.
  assert.deepEqual(household.payload.reminders.map(summary), [
    "card_bill:Serene Visa",
    "card_bill:Ethan Visa",
    "statement_missing:Serene DBS Account",
    "splits_waiting:settle_up",
    "price_change:Spotify"
  ]);
  assert.equal(household.payload.reminders.find((reminder) => reminder.kind === "splits_waiting").direction, "between");
  // Ethan's own view: his card, but not Serene's account, statement or Spotify. His only
  // statement account has last month's statement, so the month-close card is up, and its
  // Splits row replaces the standalone settle-up reminder.
  assert.deepEqual(ethan.payload.reminders.map(summary), ["card_bill:Ethan Visa", "month_close:undefined"]);
  const ethanClose = ethan.payload.reminders[1];
  assert.deepEqual(ethanClose.checks.find((check) => check.id === "splits"), {
    id: "splits", done: false, count: 1, amountMinor: checkpoint.amount_minor, currency: "SGD", withName: "Serene"
  });
});

test("a payment into the card since the statement clears its bill, and an imported statement clears the missing one", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, onTemplate);
  const ids = await setUpHousehold({ db, api });
  await addStatement(db, ids["Serene Visa"], lastMonth, { endDate: addDays(today, -12), balanceMinor: -52773, dueDate: addDays(today, 3) });
  await addStatement(db, ids["Serene DBS Account"], addMonths(thisMonth, -3), { endDate: `${addMonths(thisMonth, -3)}-28` });
  await addStatement(db, ids["Serene DBS Account"], addMonths(thisMonth, -2), { endDate: `${addMonths(thisMonth, -2)}-28` });
  const before = (await getReminders(fetch, JOYCE)).payload.reminders.map((reminder) => reminder.kind);
  assert.deepEqual(before, ["card_bill", "statement_missing"]);

  await createEntry(api, {
    date: addDays(today, -2), description: "PAYMENT - THANK YOU", accountName: "Serene Visa", categoryName: "Transfer",
    amountMinor: 52773, entryType: "transfer", transferDirection: "in", ownerName: "Serene"
  });
  await addStatement(db, ids["Serene DBS Account"], addMonths(thisMonth, -1), { endDate: `${addMonths(thisMonth, -1)}-28` });
  const after = (await getReminders(fetch, JOYCE)).payload.reminders;
  // Nothing left to pay or import: only last month's checklist (both accounts now have its statement).
  assert.deepEqual(after.map((reminder) => reminder.kind), ["month_close"]);
});

test("last month is ready to close once every statement is in, and counts what is left in Other and the note", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, onTemplate);
  const ids = await setUpHousehold({ db, api });
  for (const name of ["Serene Visa", "Serene DBS Account"]) {
    await addStatement(db, ids[name], addMonths(thisMonth, -2), { endDate: `${addMonths(thisMonth, -2)}-20` });
    await addStatement(db, ids[name], lastMonth, { endDate: `${lastMonth}-20` });
  }
  // Two September-style entries left in Other, one categorised.
  for (const [description, categoryName] of [["MYSTERY SHOP", "Other"], ["MYSTERY GIFT", "Other - Income"], ["FAIRPRICE", "Groceries"]]) {
    await createEntry(api, {
      date: `${lastMonth}-10`, description, accountName: "Serene DBS Account", categoryName, amountMinor: 1250,
      entryType: categoryName === "Other - Income" ? "income" : "expense", ownerName: "Serene"
    });
  }

  const [card] = (await getReminders(fetch, JOYCE)).payload.reminders;
  assert.equal(card.kind, "month_close");
  assert.equal(card.month, lastMonth);
  assert.equal(card.allDone, false);
  assert.deepEqual(card.checks.map((check) => [check.id, check.done, check.count]), [
    ["statements", true, 2], ["other", false, 2], ["splits", true, 0], ["note", false, 0]
  ]);

  // Ethan's view counts only his own entries and accounts: none of Serene's.
  const ethanCard = (await getReminders(fetch, TIM)).payload.reminders;
  assert.deepEqual(ethanCard, []);

  // Categorise the two entries and write the month's note.
  await db.prepare("UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name = 'Groceries') WHERE description IN ('MYSTERY SHOP', 'MYSTERY GIFT')").run();
  const noted = await api("/api/month-note/update", { month: lastMonth, personScope: JOYCE, note: "Quiet month." });
  assert.equal(noted.status, 200, JSON.stringify(noted.payload));
  const [done] = (await getReminders(fetch, JOYCE)).payload.reminders;
  assert.equal(done.allDone, true);
  assert.deepEqual(done.checks.map((check) => check.done), [true, true, true, true]);
});
