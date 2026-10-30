// Every page read's response, for proving a read-path change returns the
// same data (docs/audits/speed-pass-2026-10.md). Calls the real Worker
// (src/index.ts) against a local D1 for the household and every person view,
// several months and Summary ranges, and writes one JSON file of
// { "<request>": <response body> }. Run it before and after a change on the
// same database and compare the files with `--compare`.
//
//   node --import tsx scripts/page-dto-dump.mjs <out.json> [--db <dir>] [--fixture demo|scale]
//   node scripts/page-dto-dump.mjs --compare <before.json> <after.json>
//
// --compare prints only the request names that differ and the first
// differing JSON path, never values, so it is safe on a copy of real data.
// Without --db it builds the demo household (--fixture demo) or the demo
// plus the 10k-transaction scale household and settled split history
// (--fixture scale, the default).
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

if (args[0] === "--compare") {
  const [before, after] = await Promise.all(args.slice(1, 3).map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  // When a report was made or the demo seeded differs from run to run.
  const VOLATILE = new Set(["generatedAt", "lastSeededAt"]);
  const firstDifference = (left, right, at = "$") => {
    if (VOLATILE.has(at.split(".").at(-1))) return null;
    if (JSON.stringify(left) === JSON.stringify(right)) return null;
    if (left && right && typeof left === "object" && typeof right === "object" && Array.isArray(left) === Array.isArray(right)) {
      if (Array.isArray(left) && left.length !== right.length) return `${at} (length ${left.length} -> ${right.length})`;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (!(key in left) || !(key in right)) return `${at}.${key} (${key in left ? "removed" : "added"})`;
        const inner = firstDifference(left[key], right[key], `${at}.${key}`);
        if (inner) return inner;
      }
      return JSON.stringify(Object.keys(left)) === JSON.stringify(Object.keys(right)) ? null : `${at} (key order)`;
    }
    return at;
  };
  let differences = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const where = firstDifference(before[key], after[key]);
    if (where) {
      differences += 1;
      console.log(`DIFF ${key}: ${where}`);
    }
  }
  console.log(`${Object.keys(before).length} requests compared, ${differences} differ`);
  process.exit(differences ? 1 : 0);
}

const { default: worker } = await import("../src/index.ts");
const { createSeededTemplate, openLocalD1 } = await import("../tests/support/d1-workspace.mjs");
const { buildLargeHousehold } = await import("../tests/support/large-household.mjs");
const { seedSettledSplitHistory } = await import("../tests/support/settled-split-history.mjs");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const config = JSON.parse(await readFile(path.join(root, "wrangler.test.jsonc"), "utf8"));
const dbDir = option("db", null);
const fixture = option("fixture", "scale");

let dispose;
let db;
let history = null;
if (dbDir) {
  const miniflare = openLocalD1(dbDir, { databaseId: config.d1_databases[0].database_id, compatibilityDate: config.compatibility_date });
  db = await miniflare.getD1Database("DB");
  dispose = () => miniflare.dispose();
} else {
  const template = await createSeededTemplate();
  const dir = await mkdtemp(path.join(os.tmpdir(), "monies-map-dto-dump-"));
  await cp(template.persistTo, dir, { recursive: true });
  await template.dispose();
  const miniflare = openLocalD1(dir, { databaseId: config.d1_databases[0].database_id, compatibilityDate: config.compatibility_date });
  db = await miniflare.getD1Database("DB");
  if (fixture === "scale") {
    await buildLargeHousehold(db);
    history = await seedSettledSplitHistory(db);
  }
  dispose = async () => { await miniflare.dispose(); await rm(dir, { recursive: true, force: true }); };
}

const env = { DB: db, ...config.vars };
async function get(pathname) {
  const response = await worker.fetch(new Request(`http://127.0.0.1${pathname}`), env);
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} answered ${response.status}`);
  return JSON.parse(text);
}

const shell = await get("/api/app-shell?view=household");
const months = shell.trackedMonths;
const views = ["household", ...shell.household.people.map((person) => person.id)];
// The latest three months, one a year back and the first: new and old data.
const { todayInAppTimeZone } = await import("../src/lib/app-calendar.ts");
const thisMonth = todayInAppTimeZone().slice(0, 7);
const sampleMonths = [...new Set([thisMonth, months.at(-1), months.at(-2), months.at(-3), months.at(-13), months[0]].filter(Boolean))];
const requests = ["/api/app-shell?view=household", "/api/reference-data", "/api/imports-page", "/api/settings-page", "/api/ask/habits", "/api/ask/done"];
for (const view of views) {
  requests.push(`/api/summary-account-pills?view=${view}`, `/api/reminders?view=${view}`, `/api/ledger-checkup?view=${view === "household" ? "household" : view}`);
  for (const month of sampleMonths) {
    for (const scope of view === "household" ? ["direct_plus_shared"] : ["direct", "shared", "direct_plus_shared"]) {
      requests.push(`/api/month-page?view=${view}&month=${month}&scope=${scope}`);
      requests.push(`/api/summary-page?view=${view}&month=${month}&scope=${scope}`);
    }
    requests.push(`/api/entries-page?view=${view}&month=${month}`, `/api/splits-page?view=${view}&month=${month}`, `/api/entries-shell?view=${view}&month=${month}`, `/api/skew-candidates?view=${view}&month=${month}&scope=direct_plus_shared`);
  }
  const end = months.includes(thisMonth) ? thisMonth : months.at(-1);
  const start6 = months[Math.max(0, months.indexOf(end) - 5)];
  requests.push(
    `/api/summary-page?view=${view}&month=${end}&scope=direct_plus_shared&summary_start=${start6}&summary_end=${end}`,
    `/api/summary-page?view=${view}&month=${end}&scope=direct_plus_shared&summary_start=${months[0]}&summary_end=${end}`,
    `/api/entries-page?view=${view}&month=${end}&from=${start6}`
  );
}
if (history) {
  requests.push(`/api/splits/settled-rows?view=${views[1]}&checkpoint=${history.checkpointId}&group=${history.bigGroupId}`);
}

const dump = {};
for (const request of requests) {
  dump[request] = await get(request);
}
await writeFile(outFile, `${JSON.stringify(dump)}\n`);
console.log(`${requests.length} requests written to ${outFile}`);
await dispose();
