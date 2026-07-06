import assert from "node:assert/strict";
import test from "node:test";
import {
  loadLegacyLedgerOwnershipRepairStatus,
  repairLegacyOcbcValueDatePostDates,
  repairLegacySharedLedgerOwnership
} from "../src/domain/app-repository-repairs.ts";

function createRepairDb() {
  const state = {
    marker: null,
    updateRuns: 0,
    pragmaRuns: 0,
    rows: [
      {
        id: "txn-legacy",
        household_id: "hh-default",
        accountInstitution: "OCBC",
        accountKind: "bank",
        transaction_date: "2026-05-31",
        post_date: "2026-05-31",
        note: "value date: 2026-06-02"
      },
      {
        id: "txn-manual",
        household_id: "hh-default",
        accountInstitution: "OCBC",
        accountKind: "bank",
        transaction_date: "2026-05-31",
        post_date: "2026-05-31",
        note: "transaction date: 2026-05-31"
      }
    ]
  };

  const db = {
    state,
    prepare(sql) {
      return createStatement(state, sql);
    }
  };

  return db;
}

function createStatement(state, sql) {
  return {
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
    async all() {
      if (/PRAGMA table_info\(transactions\)/i.test(sql)) {
        state.pragmaRuns += 1;
        return {
          results: [
            { name: "id" },
            { name: "household_id" },
            { name: "transaction_date" },
            { name: "post_date" },
            { name: "note" }
          ]
        };
      }
      throw new Error(`Unexpected all() SQL: ${sql}`);
    },
    async first() {
      if (/SELECT key FROM app_maintenance_tasks/i.test(sql)) {
        return state.marker ? { key: state.marker.key } : null;
      }
      throw new Error(`Unexpected first() SQL: ${sql}`);
    },
    async run() {
      if (/CREATE TABLE IF NOT EXISTS app_maintenance_tasks/i.test(sql)) {
        return { meta: { changes: 0 } };
      }

      if (/UPDATE transactions/i.test(sql)) {
        state.updateRuns += 1;
        let changes = 0;
        for (const row of state.rows) {
          const note = row.note.toLowerCase();
          const valueDateIndex = note.indexOf("value date: ");
          if (
            row.household_id === "hh-default"
            && row.accountInstitution.toLowerCase().includes("ocbc")
            && row.accountKind === "bank"
            && valueDateIndex >= 0
            && (!row.post_date || row.post_date === row.transaction_date)
          ) {
            row.post_date = row.note.slice(valueDateIndex + 12, valueDateIndex + 22);
            changes += 1;
          }
        }
        return { meta: { changes } };
      }

      if (/INSERT INTO app_maintenance_tasks/i.test(sql)) {
        state.marker = {
          key: this.values[0],
          detail: this.values[1]
        };
        return { meta: { changes: 1 } };
      }

      throw new Error(`Unexpected run() SQL: ${sql}`);
    }
  };
}

function createLegacyOwnershipRepairDb() {
  const state = {
    marker: null,
    auditEvents: [],
    accounts: [
      { id: "acct-tim", owner_person_id: "person-tim" },
      { id: "acct-shared", owner_person_id: null }
    ],
    transactions: [
      { id: "txn-repairable", household_id: "household-1", account_id: "acct-tim", ownership_type: "shared", owner_person_id: null },
      { id: "txn-skipped", household_id: "household-1", account_id: "acct-shared", ownership_type: "shared", owner_person_id: null },
      { id: "txn-direct", household_id: "household-1", account_id: "acct-tim", ownership_type: "direct", owner_person_id: "person-tim" }
    ],
    transactionSplits: [
      { id: "split-repairable", transaction_id: "txn-repairable" },
      { id: "split-skipped", transaction_id: "txn-skipped" },
      { id: "split-direct", transaction_id: "txn-direct" }
    ]
  };

  return {
    state,
    prepare(sql) {
      return createLegacyOwnershipStatement(state, sql);
    }
  };
}

function createLegacyOwnershipStatement(state, sql) {
  const normalizedSql = sql.toLowerCase();
  return {
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
    async first() {
      if (/SELECT completed_at, detail FROM app_maintenance_tasks/i.test(sql)) {
        return state.marker
          ? { completed_at: state.marker.completed_at, detail: state.marker.detail }
          : null;
      }

      if (normalizedSql.includes("from transactions")
        && normalizedSql.includes("ownership_type = 'shared'")
        && !normalizedSql.includes("join accounts")) {
        return {
          count: state.transactions.filter((row) => row.household_id === this.values[0] && row.ownership_type === "shared").length
        };
      }

      if (normalizedSql.includes("from transactions")
        && normalizedSql.includes("inner join accounts")
        && normalizedSql.includes("accounts.owner_person_id is not null")) {
        return {
          count: state.transactions.filter((row) => {
            const account = state.accounts.find((item) => item.id === row.account_id);
            return row.household_id === this.values[0] && row.ownership_type === "shared" && account?.owner_person_id;
          }).length
        };
      }

      if (normalizedSql.includes("from transactions")
        && normalizedSql.includes("left join accounts")
        && normalizedSql.includes("accounts.owner_person_id is null")) {
        return {
          count: state.transactions.filter((row) => {
            const account = state.accounts.find((item) => item.id === row.account_id);
            return row.household_id === this.values[0] && row.ownership_type === "shared" && !account?.owner_person_id;
          }).length
        };
      }

      if (normalizedSql.includes("from transaction_splits")
        && normalizedSql.includes("transactions.ownership_type = 'direct'")) {
        return {
          count: state.transactionSplits.filter((split) => {
            const transaction = state.transactions.find((row) => row.id === split.transaction_id);
            return transaction?.household_id === this.values[0] && transaction.ownership_type === "direct";
          }).length
        };
      }

      if (normalizedSql.includes("from transaction_splits")) {
        return {
          count: state.transactionSplits.filter((split) => {
            const transaction = state.transactions.find((row) => row.id === split.transaction_id);
            return transaction?.household_id === this.values[0];
          }).length
        };
      }

      throw new Error(`Unexpected first() SQL: ${sql}`);
    },
    async run() {
      if (/CREATE TABLE IF NOT EXISTS app_maintenance_tasks/i.test(sql)) {
        return { meta: { changes: 0 } };
      }

      if (/UPDATE transactions\s+SET\s+ownership_type = 'direct'/i.test(sql)) {
        let changes = 0;
        for (const row of state.transactions) {
          const account = state.accounts.find((item) => item.id === row.account_id);
          if (row.household_id === this.values[0] && row.ownership_type === "shared" && account?.owner_person_id) {
            row.ownership_type = "direct";
            row.owner_person_id = account.owner_person_id;
            changes += 1;
          }
        }
        return { meta: { changes } };
      }

      if (/DELETE FROM transaction_splits/i.test(sql)) {
        const before = state.transactionSplits.length;
        state.transactionSplits = state.transactionSplits.filter((split) => {
          const transaction = state.transactions.find((row) => row.id === split.transaction_id);
          return !(transaction?.household_id === this.values[0] && transaction.ownership_type === "direct");
        });
        return { meta: { changes: before - state.transactionSplits.length } };
      }

      if (/INSERT INTO app_maintenance_tasks/i.test(sql)) {
        state.marker = {
          key: this.values[0],
          completed_at: "2026-07-06 12:00:00",
          detail: this.values[1]
        };
        return { meta: { changes: 1 } };
      }

      if (/INSERT INTO audit_events/i.test(sql)) {
        state.auditEvents.push({
          entityType: this.values[2],
          action: this.values[4],
          detail: this.values[5]
        });
        return { meta: { changes: 1 } };
      }

      throw new Error(`Unexpected run() SQL: ${sql}`);
    }
  };
}

test("legacy OCBC value-date repair runs once and records a maintenance marker", async () => {
  const db = createRepairDb();

  await repairLegacyOcbcValueDatePostDates(db);
  assert.equal(db.state.rows[0].post_date, "2026-06-02");
  assert.equal(db.state.rows[1].post_date, "2026-05-31");
  assert.equal(db.state.updateRuns, 1);
  assert.equal(db.state.pragmaRuns, 1);
  assert.match(db.state.marker.detail, /Updated 1 legacy OCBC rows/);

  await repairLegacyOcbcValueDatePostDates(db);
  assert.equal(db.state.updateRuns, 1);
  assert.equal(db.state.pragmaRuns, 1);
});

test("legacy shared ledger ownership repair restores account owners and preserves ambiguous rows", async () => {
  const db = createLegacyOwnershipRepairDb();

  const before = await loadLegacyLedgerOwnershipRepairStatus(db);
  assert.deepEqual(before, {
    legacySharedCount: 2,
    repairableCount: 1,
    skippedCount: 1,
    legacySplitCount: 3,
    obsoleteDirectSplitCount: 1,
    completedAt: undefined,
    detail: undefined
  });

  const after = await repairLegacySharedLedgerOwnership(db);

  assert.equal(db.state.transactions.find((row) => row.id === "txn-repairable").ownership_type, "direct");
  assert.equal(db.state.transactions.find((row) => row.id === "txn-repairable").owner_person_id, "person-tim");
  assert.equal(db.state.transactions.find((row) => row.id === "txn-skipped").ownership_type, "shared");
  assert.deepEqual(db.state.transactionSplits.map((row) => row.id), ["split-skipped"]);
  assert.equal(after.legacySharedCount, 1);
  assert.equal(after.repairableCount, 0);
  assert.equal(after.skippedCount, 1);
  assert.equal(after.legacySplitCount, 1);
  assert.equal(after.obsoleteDirectSplitCount, 0);
  assert.match(after.detail, /Repaired 1 legacy shared ledger row/);
  assert.equal(db.state.auditEvents[0].action, "legacy_shared_ledger_ownership_repaired");
});
