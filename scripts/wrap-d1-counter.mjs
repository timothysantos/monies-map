// Measurement-only: wraps the Worker's D1 binding in a COPY of the repository
// so every response carries `x-d1: <statements>;<D1 ms>;<rows read>`, which
// tests/performance/api-cost.spec.js records per endpoint. The statement
// count is the number of D1 round trips a request made (a batch counts its
// statements); D1 ms and rows read come from each result's `meta`. The
// wrapped binding is kept per D1 binding, so the app's once-per-isolate
// schema check stays once per isolate (a new wrapper per request made every
// request pay it); counts are right for requests sent one at a time, as the
// api-cost spec sends them.
//
//   extract a revision into <copy> (an archive of the commit, never your checkout)
//   node scripts/wrap-d1-counter.mjs <copy>   edits <copy>/src/index.ts
//
// It refuses a directory with a `.git` entry so it cannot touch a working
// checkout, and the header is never part of the product.
//
//   D1_COUNTER_LATENCY_MS=<ms> node scripts/wrap-d1-counter.mjs <copy>
// also waits that long before every D1 round trip (a batch is one) of a GET
// request, the way a deployed Worker waits on the network for D1, so a
// browser cohort on a local Worker shows what each chain of sequential
// reads costs in production (docs/audits/speed-pass-2026-10.md). Seeding
// (POST) does not wait.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EXPORT_MARKER = "\nexport default {\n";

export const D1_COUNTER_SOURCE = (latencyMs = 0) => `
;// --- measurement-only D1 counter (scripts/wrap-d1-counter.mjs; never committed) ---
type D1Counter = { n: number; ms: number; rowsRead: number; wait: boolean };
const D1_ROUND_TRIP_WAIT_MS = ${Number(latencyMs) || 0};
// One wrapped binding per D1 binding, so the app's once-per-binding work
// (the schema check, keyed by the binding) stays once per isolate. Its
// statements count into the request started last: the harness sends the
// requests it counts one at a time. The wait applies to GET requests (the
// page reads), so seeding a fixture stays quick.
const d1CounterBox: { counter: D1Counter } = { counter: { n: 0, ms: 0, rowsRead: 0, wait: false } };
const countingDbs = new WeakMap<object, any>();
const roundTripWait = () => (d1CounterBox.counter.wait && D1_ROUND_TRIP_WAIT_MS > 0 ? new Promise((resolve) => setTimeout(resolve, D1_ROUND_TRIP_WAIT_MS)) : undefined);
function countMeta(result: any) {
  const meta = result?.meta;
  if (meta) {
    d1CounterBox.counter.ms += Number(meta.duration ?? 0);
    d1CounterBox.counter.rowsRead += Number(meta.rows_read ?? 0);
  }
  return result;
}
function wrapStatement(statement: any): any {
  return new Proxy(statement, {
    get(target, prop) {
      if (prop === "__raw") return target;
      if (prop === "bind") return (...args: unknown[]) => wrapStatement(target.bind(...args));
      if (prop === "all" || prop === "run") return async (...args: unknown[]) => { d1CounterBox.counter.n += 1; await roundTripWait(); return countMeta(await target[prop](...args)); };
      if (prop === "first" || prop === "raw") return async (...args: unknown[]) => { d1CounterBox.counter.n += 1; await roundTripWait(); return target[prop](...args); };
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function countingDb(db: any): any {
  const existing = countingDbs.get(db);
  if (existing) return existing;
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrapStatement(target.prepare(sql));
      if (prop === "batch") return async (statements: any[]) => {
        d1CounterBox.counter.n += statements.length;
        await roundTripWait();
        const results = await target.batch(statements.map((s) => s.__raw ?? s));
        results.forEach((r: any) => countMeta(r));
        return results;
      };
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  countingDbs.set(db, wrapped);
  return wrapped;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const counter: D1Counter = { n: 0, ms: 0, rowsRead: 0, wait: request.method === "GET" };
    d1CounterBox.counter = counter;
    const response = await __measuredWorker.fetch(request, { ...env, DB: countingDb(env.DB) } as Env);
    const copy = new Response(response.body, response);
    copy.headers.set("x-d1", \`\${counter.n};\${counter.ms.toFixed(2)};\${counter.rowsRead}\`);
    return copy;
  }
};
`;

// The index source with its default export renamed and the counter appended.
export function wrapWorkerSource(source, { latencyMs = 0 } = {}) {
  if (source.split(EXPORT_MARKER).length !== 2) {
    throw new Error("Expected exactly one `export default {` at the start of a line in src/index.ts.");
  }
  return source.replace(EXPORT_MARKER, "\nconst __measuredWorker = {\n") + D1_COUNTER_SOURCE(latencyMs);
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: node scripts/wrap-d1-counter.mjs <tree copy>");
  const root = path.resolve(directory);
  if (existsSync(path.join(root, ".git"))) throw new Error(`${root} is a git checkout; wrap an extracted copy instead.`);
  const indexFile = path.join(root, "src", "index.ts");
  const source = await readFile(indexFile, "utf8");
  if (source.includes("__measuredWorker")) throw new Error(`${indexFile} is already wrapped.`);
  const latencyMs = Number(process.env.D1_COUNTER_LATENCY_MS ?? 0);
  await writeFile(indexFile, wrapWorkerSource(source, { latencyMs }));
  console.log(`Wrapped ${indexFile} with the D1 counter${latencyMs > 0 ? ` and ${latencyMs} ms per D1 round trip` : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
