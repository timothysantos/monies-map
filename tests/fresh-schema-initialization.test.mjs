// Runtime schema initialization against a real local D1 (workerd via
// Miniflare), starting from the same schema.sql migration a new deployment
// or test Worker gets. Guards the first-request 500 where a legacy repair
// audited before audit_events or the default household existed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import worker from "../src/index.ts";
import { ensureDemoSchema } from "../src/domain/app-repository-schema.ts";
import { openLocalD1 } from "./support/d1-workspace.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = path.join(root, "wrangler.test.jsonc");
const OCBC_REPAIR_KEY = "repair-legacy-ocbc-value-date-post-dates-v1";

async function openFreshSchemaDatabase(t) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const d1Config = config.d1_databases[0];
  const persistTo = await mkdtemp(path.join(os.tmpdir(), "monies-map-fresh-schema-"));
  // Apply schema.sql exactly as the documented setup does, so the database
  // shape under test is the real migration output rather than a hand copy.
  const migration = spawnSync(
    process.execPath,
    [path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "d1", "execute", d1Config.database_name, "--config", configPath, "--local", "--persist-to", persistTo, "--file", path.join(root, "schema.sql")],
    { cwd: root, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } }
  );
  assert.equal(migration.status, 0, `schema.sql migration failed:\n${migration.stderr}`);

  const miniflare = openLocalD1(persistTo, { databaseId: d1Config.database_id, compatibilityDate: config.compatibility_date });
  t.after(async () => {
    await miniflare.dispose();
    await rm(persistTo, { recursive: true, force: true });
  });
  const db = await miniflare.getD1Database("DB");
  return { db, env: { DB: db, ...config.vars } };
}

function appShellRequest() {
  return new Request("http://127.0.0.1/api/app-shell?view=household&month=2026-05");
}

test("a freshly migrated schema.sql database serves its first app-shell request", async (t) => {
  const { db, env } = await openFreshSchemaDatabase(t);
  const tablesBefore = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'").all();
  assert.deepEqual(tablesBefore.results, [], "schema.sql is expected not to create audit_events");

  const first = await worker.fetch(appShellRequest(), env);
  assert.equal(first.status, 200, await first.clone().text());
  const body = await first.json();
  assert.equal(body.selectedViewId, "household");
  assert.deepEqual(body.availableViewIds.slice(0, 1), ["household"]);

  const repair = await db.prepare("SELECT detail FROM app_maintenance_tasks WHERE key = ?").bind(OCBC_REPAIR_KEY).first();
  assert.equal(repair.detail, "Updated 0 legacy OCBC rows.");
  // No household existed when the repair ran, so there is no audit row to
  // attribute; the table itself must now exist for later audited writes.
  const audits = await db.prepare("SELECT COUNT(*) AS count FROM audit_events").first();
  assert.equal(audits.count, 0);

  const second = await worker.fetch(appShellRequest(), env);
  assert.equal(second.status, 200);
});

test("an existing database with a household still audits the legacy OCBC repair", async (t) => {
  const { db } = await openFreshSchemaDatabase(t);
  await db.batch([
    db.prepare("INSERT INTO households (id, name) VALUES ('household-1', 'Existing household')"),
    db.prepare("INSERT INTO institutions (id, household_id, name) VALUES ('inst-ocbc', 'household-1', 'OCBC')"),
    db.prepare("INSERT INTO institutions (id, household_id, name) VALUES ('inst-dbs', 'household-1', 'DBS')"),
    db.prepare("INSERT INTO accounts (id, household_id, institution_id, account_name, account_kind) VALUES ('acct-ocbc', 'household-1', 'inst-ocbc', 'OCBC 360', 'bank')"),
    db.prepare("INSERT INTO accounts (id, household_id, institution_id, account_name, account_kind) VALUES ('acct-dbs', 'household-1', 'inst-dbs', 'DBS Multiplier', 'bank')")
  ]);
  // Add post_date the way a pre-repair legacy database already had it, then
  // store the bank value date only in the note.
  await db.prepare("ALTER TABLE transactions ADD COLUMN post_date TEXT").run();
  await db.batch([
    db.prepare("INSERT INTO transactions (id, household_id, account_id, transaction_date, post_date, description, amount_minor, entry_type, note) VALUES ('txn-ocbc', 'household-1', 'acct-ocbc', '2026-05-01', '2026-05-01', 'Coffee', 450, 'expense', 'Value date: 2026-05-03')"),
    db.prepare("INSERT INTO transactions (id, household_id, account_id, transaction_date, post_date, description, amount_minor, entry_type, note) VALUES ('txn-dbs', 'household-1', 'acct-dbs', '2026-05-01', '2026-05-01', 'Lunch', 900, 'expense', 'Value date: 2026-05-04')")
  ]);

  await ensureDemoSchema(db);

  const rows = await db.prepare("SELECT id, post_date FROM transactions ORDER BY id").all();
  assert.deepEqual(rows.results, [
    { id: "txn-dbs", post_date: "2026-05-01" },
    { id: "txn-ocbc", post_date: "2026-05-03" }
  ]);
  const audits = await db.prepare("SELECT household_id, entity_id, action, detail FROM audit_events").all();
  assert.deepEqual(audits.results, [
    { household_id: "household-1", entity_id: OCBC_REPAIR_KEY, action: "post_date_repair", detail: "Updated 1 legacy OCBC rows." }
  ]);
});

test("a failed schema initialization is retried on the next request", async (t) => {
  const { db } = await openFreshSchemaDatabase(t);
  let failNextPrepare = true;
  const flakyDb = new Proxy(db, {
    get(target, property) {
      if (property === "prepare" && failNextPrepare) {
        return () => {
          failNextPrepare = false;
          throw new Error("D1 transient failure");
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  await assert.rejects(ensureDemoSchema(flakyDb), /D1 transient failure/);
  await ensureDemoSchema(flakyDb);

  const repair = await db.prepare("SELECT key FROM app_maintenance_tasks WHERE key = ?").bind(OCBC_REPAIR_KEY).first();
  assert.equal(repair.key, OCBC_REPAIR_KEY);
});
