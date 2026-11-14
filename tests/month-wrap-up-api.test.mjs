// GET /api/month-wrap-up through the real Worker and a real local D1 seeded
// with the demo household (DOMAIN.md "Month Wrap-up"). The route only reads,
// answers each view and scope from the projections it reuses (so its rows
// agree with the Entries page, the Import inbox, the Splits tile and the
// What changed card), never counts another household's rows, and says
// nothing for a future month or a month with no entries.
import assert from "node:assert/strict";
import test from "node:test";

import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { addMonths } from "../src/domain/money-signals/format.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TIM = "person-tim";
const today = todayInAppTimeZone();
const lastMonth = addMonths(today.slice(0, 7), -1);
const on = (day) => `${lastMonth}-${String(day).padStart(2, "0")}`;

async function wrapUp(api, view, month, scope = "direct_plus_shared") {
  const { status, payload } = await api(`/api/month-wrap-up?view=${view}&scope=${scope}&month=${month}`);
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.wrapUp;
}

// Last month: two expenses left in Other (one Tim's, one Joyce's), a
// foreign currency estimate still waiting for its statement, one the
// statement already confirmed, and another household's estimate.
async function seedLastMonth({ api, db }) {
  const ids = {
    timOther: await createEntry(api, { date: on(3), description: "Wrap mystery shop", categoryName: "Other", amountMinor: 4_500 }),
    joyceOther: await createEntry(api, { date: on(4), description: "Wrap unknown", categoryName: "Other", amountMinor: 1_500, accountName: "UOB Lady's", ownerName: "Joyce" }),
    estimate: await createEntry(api, { date: on(5), description: "E-MART Yongsan", categoryName: "Groceries", amountMinor: 3_210 }),
    confirmed: await createEntry(api, { date: on(6), description: "GS25 Seoul", categoryName: "Groceries", amountMinor: 880 })
  };
  await db.prepare("UPDATE transactions SET original_currency = 'KRW', original_amount_minor = 3200000 WHERE id IN (?, ?)").bind(ids.estimate, ids.confirmed).run();
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(ids.confirmed).run();
  await db.prepare("INSERT INTO households (id, name, base_currency) VALUES ('household-other', 'Other', 'SGD')").run();
  await db.prepare(`
    INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, currency, entry_type, category_id, original_currency, original_amount_minor)
    SELECT 'txn-other-household', 'household-other', account_id, transaction_date, description, amount_minor, currency, entry_type, category_id, 'KRW', 100
    FROM transactions WHERE id = ?
  `).bind(ids.estimate).run();
  return ids;
}

test("GET only; a future month, a bad month and a month with no entries have no wrap-up", async (t) => {
  const { api, fetch } = await openSeededDatabase(t, template);
  const post = await fetch(`/api/month-wrap-up?month=${lastMonth}`, { method: "POST", body: "{}" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
  assert.match((await fetch(`/api/month-wrap-up?month=${lastMonth}`)).headers.get("server-timing") ?? "", /^app;dur=/);
  assert.equal(await wrapUp(api, "household", addMonths(today.slice(0, 7), 1)), null, "next month");
  assert.equal(await wrapUp(api, "household", "2026-13"), null);
  assert.equal(await wrapUp(api, "household", ""), null);
  assert.equal(await wrapUp(api, "household", "2019-01"), null, "a month with no entries");
});

test("each row agrees with the page it opens, in the household and a person's view, and reads nothing else", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const ids = await seedLastMonth({ api, db });
  const before = await dumpDatabase(db);
  const household = await wrapUp(api, "household", lastMonth);
  const tim = await wrapUp(api, TIM, lastMonth);
  assertSameDatabase(await dumpDatabase(db), before);

  // Other: the month's expenses in Other, as the Entries page lists them.
  const entriesPage = (await api(`/api/entries-page?view=household&month=${lastMonth}`)).payload;
  const otherOnEntries = entriesPage.monthPage.entries
    .filter((entry) => entry.entryType === "expense" && entry.categoryName === "Other" && entry.date.startsWith(lastMonth))
    .map((entry) => entry.id).sort();
  assert.deepEqual(household.other.ids, otherOnEntries);
  assert.ok(household.other.ids.includes(ids.timOther) && household.other.ids.includes(ids.joyceOther));
  assert.ok(tim.other.ids.includes(ids.timOther));
  assert.ok(!tim.other.ids.includes(ids.joyceOther), "Joyce's own entry is not in Tim's view");

  // Estimates: only the one still waiting, never another household's.
  assert.deepEqual(household.estimates, { ids: [ids.estimate], amountMinor: 3_210 });
  assert.deepEqual(tim.estimates, { ids: [ids.estimate], amountMinor: 3_210 });

  // Statements: the Import inbox's expected statements for the month.
  const inbox = (await api("/api/imports-page")).payload.importsPage.importInbox;
  const expected = inbox.reviewQueue
    .filter((file) => file.sourceType === "pdf_statement" && file.periodMonth === lastMonth)
    .map((file) => ({ id: file.id, name: file.accountName }));
  assert.deepEqual(household.statements.missing, expected);
  const activeStatementAccounts = await rows(db, "SELECT COUNT(*) AS n FROM accounts WHERE household_id = 'household-1' AND is_active = 1 AND account_kind IN ('bank', 'credit_card')");
  assert.equal(household.statements.accountCount, activeStatementAccounts[0].n);
  assert.ok(tim.statements.accountCount < household.statements.accountCount, "Tim's view has his and joint accounts only");

  // Splits: the Splits tile's balances, without the settled ones.
  const summary = (await api(`/api/summary-page?view=${TIM}&month=${lastMonth}&scope=direct_plus_shared`)).payload.summaryPage;
  assert.deepEqual(
    tim.splits.balances.map((balance) => [balance.id, balance.balanceMinor, balance.owes]),
    (summary.splitBalances ?? []).filter((balance) => balance.balanceMinor !== 0).slice(0, 3).map((balance) => [balance.id, balance.balanceMinor, balance.owes])
  );
  for (const balance of household.splits.balances) {
    assert.equal(balance.direction, "between");
    assert.match(balance.owes, /^(Tim owes Joyce|Joyce owes Tim)$/);
  }

  // What changed: the card's own rows for the month.
  const card = (await api(`/api/summary-changed?view=household&scope=direct_plus_shared&month=${lastMonth}`)).payload.changed;
  if (household.changed) {
    assert.equal(household.changed.rowCount, card.rows.length);
    for (const row of household.changed.rows) {
      const same = card.rows.find((candidate) => candidate.category === row.category);
      assert.deepEqual([row.amountMinor, row.diffMinor, row.ids], [same.amountMinor, same.diffMinor, same.ids], row.category);
    }
  } else {
    assert.ok(!card || card.rows.length === 0);
  }
});

test("What changed for a month that has ended compares the whole month with the month before", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createEntry(api, { date: `${addMonths(lastMonth, -1)}-28`, description: "Late Sep dinner", categoryName: "Food & Drinks", amountMinor: 10_000 });
  await createEntry(api, { date: `${lastMonth}-28`, description: "Late dinner", categoryName: "Food & Drinks", amountMinor: 90_000 });
  const { changed } = (await api(`/api/summary-changed?view=household&scope=direct_plus_shared&month=${lastMonth}`)).payload;
  assert.equal(changed.month, lastMonth);
  assert.equal(changed.baseMonth, addMonths(lastMonth, -1));
  assert.equal(changed.day, Number((await wrapUpEnd(lastMonth)).slice(8, 10)), "read up to the month's last day");
  const future = (await api(`/api/summary-changed?view=household&month=${addMonths(today.slice(0, 7), 2)}`)).payload;
  assert.equal(future.changed, null, "a future month has nothing to compare");
});

async function wrapUpEnd(month) {
  const { lastDayOfMonth } = await import("../src/domain/month-wrap-up.ts");
  return lastDayOfMonth(month);
}
