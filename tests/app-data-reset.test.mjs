// A demo reset (/api/demo/reseed) on a Worker whose cold start is still
// seeding the database. The cold start's seed (ensureAppData ->
// ensureSeedData) and the reset each clear and refill the same tables, so
// they must run one after the other: the reset waits for the seed in flight,
// and the reset's data is what stays. Run side by side, the slower one
// wins: the browser suite's first test on a fresh stack then sometimes found
// the cold start's seed (dated on today's month, not DEMO_SEED_MONTH) or a
// half-cleared household.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { ensureAppData, invalidateAppDataCache } from "../src/domain/app-shell.ts";

const REAL = Symbol("real statement");
// The clear-and-seed writes (schema repairs on first use write elsewhere).
const SEED_WRITE = /^\s*(DELETE\s+FROM|INSERT\s+INTO)\s+(app_settings|households|people|accounts|transactions)\b/i;

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// A D1 whose writes wait on `gate` once `armed` is set, and which reports
// its first write. Reads always run.
function gatedDatabase(db, { onFirstWrite }) {
  const state = { armed: false, gate: Promise.resolve(), writes: 0 };
  const waitIfWrite = async (sql) => {
    if (!SEED_WRITE.test(sql)) return;
    state.writes += 1;
    if (state.writes === 1) onFirstWrite?.();
    if (state.armed) await state.gate;
  };
  const wrapStatement = (statement, sql) => new Proxy(statement, {
    get(target, property) {
      if (property === REAL) return target;
      if (property === "bind") return (...values) => wrapStatement(target.bind(...values), sql);
      if (["run", "all", "first", "raw"].includes(property)) {
        return async (...args) => {
          await waitIfWrite(sql);
          return target[property](...args);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const wrapper = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") return (sql) => wrapStatement(target.prepare(sql), sql);
      if (property === "batch") {
        return async (statements) => {
          for (const statement of statements) await waitIfWrite(String(statement?.statement ?? ""));
          // Batches take the real statements, not the wrappers.
          return target.batch(statements.map((statement) => statement[REAL] ?? statement));
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { db: wrapper, state };
}

async function latestSeedDate(db) {
  const [{ latest }] = await rows(db, "SELECT MAX(transaction_date) AS latest FROM transactions WHERE id LIKE 'txn-%'");
  return latest;
}

test("a demo reset waits for a cold start's seed in flight, and the reset's data stays", async (t) => {
  const expected = await openSeededDatabase(t, template);
  const seededLatest = await latestSeedDate(expected.db);
  const expectedPeople = await rows(expected.db, "SELECT id FROM people ORDER BY id");

  const { db } = await openSeededDatabase(t, template);
  // Missing month totals make the cold start reseed (ensureSeedData), dated
  // on today's month instead of DEMO_SEED_MONTH.
  await db.prepare("DELETE FROM monthly_snapshots").run();

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let coldPaused;
  const coldReachedFirstWrite = new Promise((resolve) => { coldPaused = resolve; });
  const cold = gatedDatabase(db, { onFirstWrite: coldPaused });
  cold.state.armed = true;
  cold.state.gate = gate;

  invalidateAppDataCache();
  t.after(() => invalidateAppDataCache());
  let coldFinished = false;
  const coldStart = ensureAppData(cold.db).then((demo) => {
    coldFinished = true;
    return demo;
  });
  // The cold start has read the database and is about to clear it.
  await coldReachedFirstWrite;

  let resetWritesWhileColdSeeding = 0;
  const countingDb = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          if (SEED_WRITE.test(sql) && !coldFinished) resetWritesWhileColdSeeding += 1;
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const { default: worker } = await import("../src/index.ts");
  const reset = worker.fetch(new Request("http://127.0.0.1/api/demo/reseed", { method: "POST" }), { DB: countingDb, ...template.config.vars });

  // Let the reset run as far as it will on its own (all the way, if it does
  // not wait), then let the cold start finish.
  await Promise.race([reset.catch(() => null), new Promise((resolve) => setTimeout(resolve, 1500))]);
  release();
  const coldOutcome = await coldStart.then(() => "seeded", (error) => String(error?.message ?? error));
  const response = await reset;

  assert.equal(resetWritesWhileColdSeeding, 0, "the reset wrote while the cold start was still seeding");
  assert.equal(coldOutcome, "seeded");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await latestSeedDate(db), seededLatest, "the reset's seed (DEMO_SEED_MONTH) is what stays");
  assert.deepEqual(await rows(db, "SELECT id FROM people ORDER BY id"), expectedPeople);
  const [{ months }] = await rows(db, "SELECT COUNT(*) AS months FROM monthly_snapshots");
  assert.ok(months > 0, "month totals are back");
});
