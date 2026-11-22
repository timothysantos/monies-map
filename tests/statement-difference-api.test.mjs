// The saved-statement difference, explained from real rows: a purchase a
// later statement confirmed (billed next time) and a hand-added entry the
// bank never listed.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { loadAccounts } from "../src/domain/app-repository-settings.ts";
import { attachStatementDifferences } from "../src/domain/statement-difference-projection.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2030-09";
const START = "2030-08-12";
const END = "2030-09-11";

async function seedStatement(db, { withFishball = true, withLate = true } = {}) {
  const [card] = await rows(db, "SELECT id, household_id FROM accounts WHERE account_kind = 'credit_card' AND is_active = 1 ORDER BY id LIMIT 1");
  await db.prepare("INSERT INTO imports (id, household_id, source_type, source_label, status) VALUES ('imp-next', ?, 'pdf', 'Next statement', 'completed')")
    .bind(card.household_id).run();
  await db.prepare(`
    INSERT INTO statement_reconciliation_certificates
      (id, household_id, import_id, account_id, checkpoint_month, statement_balance_minor, projected_ledger_balance_minor, delta_minor, status)
    VALUES ('cert-next', ?, 'imp-next', ?, '2030-10', 0, 0, 0, 'certified')
  `).bind(card.household_id, card.id).run();
  await db.prepare(`
    INSERT INTO account_balance_checkpoints (id, household_id, account_id, checkpoint_month, statement_balance_minor, statement_start_date, statement_end_date)
    VALUES ('cp-test', ?, ?, ?, 0, ?, ?)
  `).bind(card.household_id, card.id, MONTH, START, END).run();

  // The statement's balance is what the ledger adds up to before the two
  // entries below exist, so they are exactly the difference.
  const before = (await loadAccounts(db)).find((account) => account.id === card.id)
    .checkpointHistory.find((statement) => statement.month === MONTH).computedBalanceMinor;
  await db.prepare("UPDATE account_balance_checkpoints SET statement_balance_minor = ? WHERE id = 'cp-test'").bind(before).run();

  const insert = (id, date, amountMinor, extra) => db.prepare(`
    INSERT INTO transactions
      (id, household_id, account_id, transaction_date, post_date, description, amount_minor, entry_type,
       bank_certification_status, statement_certified_import_id, import_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'expense', ?, ?, ?)
  `).bind(id, card.household_id, card.id, date, date, extra.description, amountMinor, extra.status, extra.certifiedBy ?? null, extra.importId ?? null).run();

  if (withLate) {
    await insert("txn-late", "2030-09-10", 2822, { description: "EXIMBAY", status: "statement_certified", certifiedBy: "imp-next", importId: "imp-next" });
  }
  if (withFishball) {
    await insert("txn-fish", "2030-08-27", 750, { description: "Lixin Fishball", status: "provisional" });
  }
  return card.id;
}

function statementFor(accounts, accountId) {
  return accounts.find((account) => account.id === accountId).checkpointHistory.find((statement) => statement.month === MONTH);
}

test("a statement that is off names the purchase billed next time and the entry the bank never listed", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const accountId = await seedStatement(db);
  const accounts = await loadAccounts(db);
  assert.equal(statementFor(accounts, accountId).deltaMinor, -3572);

  const statement = statementFor(await attachStatementDifferences(db, accounts), accountId);
  assert.deepEqual(statement.difference, {
    remainingMinor: 0,
    billedNext: {
      totalMinor: -2822,
      entryCount: 1,
      entries: [{ entryId: "txn-late", date: "2030-09-10", description: "EXIMBAY", signedAmountMinor: -2822 }]
    },
    notOnStatement: {
      totalMinor: -750,
      entryCount: 1,
      oneOf: false,
      entries: [{ entryId: "txn-fish", date: "2030-08-27", description: "Lixin Fishball", signedAmountMinor: -750 }]
    }
  });
});

test("the latest-only read explains the newest statement the same way", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const accountId = await seedStatement(db, { withLate: false });
  const statement = statementFor(await attachStatementDifferences(db, await loadAccounts(db), { latestOnly: true }), accountId);
  assert.equal(statement.difference.notOnStatement.entries[0].entryId, "txn-fish");
  assert.equal(statement.difference.remainingMinor, 0);
});

test("a statement that matches gets no explanation and costs no read", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const accountId = await seedStatement(db, { withFishball: false, withLate: false });
  const accounts = (await loadAccounts(db)).filter((account) => account.id === accountId);
  assert.equal(statementFor(accounts, accountId).deltaMinor, 0);

  let reads = 0;
  const counting = new Proxy(db, {
    get(target, key) {
      if (key === "prepare") {
        return (...args) => { reads += 1; return target.prepare(...args); };
      }
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const result = await attachStatementDifferences(counting, accounts);
  assert.equal(reads, 0);
  assert.equal(statementFor(result, accountId).difference, undefined);
});

test("an entry confirmed by this same statement is never blamed", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const accountId = await seedStatement(db, { withLate: false, withFishball: false });
  const [card] = await rows(db, "SELECT household_id FROM accounts WHERE id = ?", accountId);
  // Confirmed by an import with no later statement: it stays out, and the
  // $7.50 it adds is left unexplained.
  await db.prepare(`
    INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, entry_type, bank_certification_status)
    VALUES ('txn-own', ?, ?, '2030-08-20', 'Own statement row', 750, 'expense', 'statement_certified')
  `).bind(card.household_id, accountId).run();

  const statement = statementFor(await attachStatementDifferences(db, await loadAccounts(db)), accountId);
  assert.deepEqual(statement.difference, { remainingMinor: -750 });
});
