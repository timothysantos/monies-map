// A real local D1 (workerd via Miniflare) for persistence contract tests.
// schema.sql is applied and the demo household seeded once per test file;
// each test then gets its own copy of that database, so tests can write
// freely and compare whole-database dumps.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

import worker from "../../src/index.ts";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const configPath = path.join(root, "wrangler.test.jsonc");

async function readTestConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

function openMiniflare(config, persistTo) {
  return new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response(null, { status: 404 }); } }",
    d1Databases: { DB: config.d1_databases[0].database_id },
    d1Persist: path.join(persistTo, "v3", "d1")
  });
}

// Migrates schema.sql and reseeds the demo household into a template
// directory. Call once per file (test.before) and pass the result to
// openSeededDatabase.
export async function createSeededTemplate() {
  const config = await readTestConfig();
  const persistTo = await mkdtemp(path.join(os.tmpdir(), "monies-map-d1-template-"));
  const migration = spawnSync(
    process.execPath,
    [path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "d1", "execute", config.d1_databases[0].database_name, "--config", configPath, "--local", "--persist-to", persistTo, "--file", path.join(root, "schema.sql")],
    { cwd: root, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } }
  );
  assert.equal(migration.status, 0, `schema.sql migration failed:\n${migration.stderr}`);

  const miniflare = openMiniflare(config, persistTo);
  const db = await miniflare.getD1Database("DB");
  const env = { DB: db, ...config.vars };
  const reseed = await worker.fetch(new Request("http://127.0.0.1/api/demo/reseed", { method: "POST" }), env);
  assert.equal(reseed.status, 200, await reseed.clone().text());
  await miniflare.dispose();
  return { config, persistTo, dispose: () => rm(persistTo, { recursive: true, force: true }) };
}

export async function openSeededDatabase(t, template) {
  const persistTo = await mkdtemp(path.join(os.tmpdir(), "monies-map-d1-"));
  await cp(template.persistTo, persistTo, { recursive: true });
  const miniflare = openMiniflare(template.config, persistTo);
  t.after(async () => {
    await miniflare.dispose();
    await rm(persistTo, { recursive: true, force: true });
  });
  const db = await miniflare.getD1Database("DB");
  const envFor = (database) => ({ DB: database, ...template.config.vars });
  return {
    db,
    // The raw Worker response for a request, as a browser fetch would see it.
    fetch(pathname, init) {
      return worker.fetch(new Request(`http://127.0.0.1${pathname}`, init), envFor(db));
    },
    // Calls the real Worker route, optionally against a fault-injecting DB.
    // A route that lets an error escape is a 500 in workerd, so it is
    // reported the same way here.
    async api(pathname, body, { database = db, method = body === undefined ? "GET" : "POST" } = {}) {
      let response;
      try {
        response = await worker.fetch(new Request(`http://127.0.0.1${pathname}`, {
          method,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body)
        }), envFor(database));
      } catch (error) {
        return { status: 500, payload: { ok: false, error: String(error?.message ?? error) } };
      }
      const payload = await response.json();
      return { status: response.status, payload };
    }
  };
}

// The SQL of a prepared or bound statement. Miniflare keeps it on the
// statement object; test-only, used to recognise a batch.
export function statementSql(statement) {
  return String(statement?.statement ?? "");
}

// Every table's rows in insertion order: the whole persisted state.
export async function dumpDatabase(db) {
  const tables = await db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name")
    .all();
  const dump = {};
  for (const table of tables.results) {
    const order = table.sql.includes("WITHOUT ROWID") ? "" : " ORDER BY rowid";
    dump[table.name] = (await db.prepare(`SELECT * FROM "${table.name}"${order}`).all()).results;
  }
  return dump;
}

// Wraps a D1 database so the first statement whose SQL matches `pattern`
// (after skipping `skip` matches) fails when it executes, whether it runs on
// its own or inside db.batch(). Reads and every other statement run for real.
export function failingStatement(db, pattern, { skip = 0 } = {}) {
  const state = { matches: 0, fired: false };
  const failing = () => db.prepare("INSERT INTO injected_failure_missing_table (id) VALUES (1)");
  const wrapper = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          if (!state.fired && pattern.test(sql)) {
            state.matches += 1;
            if (state.matches > skip) {
              state.fired = true;
              // A real statement (db.batch() rejects look-alikes). The
              // caller still binds its own values; the missing table fails
              // first when the statement executes.
              return failing();
            }
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { db: wrapper, state };
}

// Fails with a short per-table summary instead of a full dump diff.
export function assertSameDatabase(actual, expected) {
  const changes = [];
  for (const table of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const before = (expected[table] ?? []).map((row) => JSON.stringify(row));
    const after = (actual[table] ?? []).map((row) => JSON.stringify(row));
    const removed = before.filter((row) => !after.includes(row));
    const added = after.filter((row) => !before.includes(row));
    if (removed.length || added.length || before.length !== after.length) {
      changes.push(`${table}: -${removed.length} +${added.length}${added.length ? ` e.g. ${added[0].slice(0, 240)}` : removed.length ? ` e.g. ${removed[0].slice(0, 240)}` : ""}`);
    }
  }
  assert.deepEqual(changes, [], `database changed:\n${changes.join("\n")}`);
}

// Rows for a SQL query.
export async function rows(db, sql, ...params) {
  return (await db.prepare(sql).bind(...params).all()).results;
}

// Month totals per scope, as Summary reads them.
export async function snapshotTotals(db, month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return rows(db, `
    SELECT person_scope, total_income_minor, estimated_expense_minor, total_expense_minor, total_net_minor
    FROM monthly_snapshots
    WHERE year = ? AND month = ?
    ORDER BY person_scope
  `, year, monthNumber);
}

// Creates an entry through the real route (defaults: a direct Tim expense on UOB One).
export async function createEntry(api, input) {
  const { status, payload } = await api("/api/entries/create", {
    accountName: "UOB One",
    categoryName: "Groceries",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...input
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.entryId;
}
