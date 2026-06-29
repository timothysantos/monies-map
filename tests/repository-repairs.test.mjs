import assert from "node:assert/strict";
import test from "node:test";
import { repairLegacyOcbcValueDatePostDates } from "../src/domain/app-repository-repairs.ts";

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
