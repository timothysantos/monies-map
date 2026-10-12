// Measurement-only: wraps the Worker's D1 binding in a COPY of the repository
// so every response carries `x-d1: <statements>;<D1 ms>;<rows read>`, which
// tests/performance/api-cost.spec.js records per endpoint. The statement
// count is the number of D1 round trips a request made (a batch counts its
// statements); D1 ms and rows read come from each result's `meta`.
//
//   extract a revision into <copy> (an archive of the commit, never your checkout)
//   node scripts/wrap-d1-counter.mjs <copy>   edits <copy>/src/index.ts
//
// It refuses a directory with a `.git` entry so it cannot touch a working
// checkout, and the header is never part of the product.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EXPORT_MARKER = "\nexport default {\n";

export const D1_COUNTER_SOURCE = `
;// --- measurement-only D1 counter (scripts/wrap-d1-counter.mjs; never committed) ---
type D1Counter = { n: number; ms: number; rowsRead: number };
function countMeta(counter: D1Counter, result: any) {
  const meta = result?.meta;
  if (meta) {
    counter.ms += Number(meta.duration ?? 0);
    counter.rowsRead += Number(meta.rows_read ?? 0);
  }
  return result;
}
function wrapStatement(statement: any, counter: D1Counter): any {
  return new Proxy(statement, {
    get(target, prop) {
      if (prop === "__raw") return target;
      if (prop === "bind") return (...args: unknown[]) => wrapStatement(target.bind(...args), counter);
      if (prop === "all" || prop === "run") return async (...args: unknown[]) => { counter.n += 1; return countMeta(counter, await target[prop](...args)); };
      if (prop === "first" || prop === "raw") return async (...args: unknown[]) => { counter.n += 1; return target[prop](...args); };
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function countingDb(db: any, counter: D1Counter): any {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), counter);
      if (prop === "batch") return async (statements: any[]) => {
        counter.n += statements.length;
        const results = await target.batch(statements.map((s) => s.__raw ?? s));
        results.forEach((r: any) => countMeta(counter, r));
        return results;
      };
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const counter: D1Counter = { n: 0, ms: 0, rowsRead: 0 };
    const response = await __measuredWorker.fetch(request, { ...env, DB: countingDb(env.DB, counter) } as Env);
    const copy = new Response(response.body, response);
    copy.headers.set("x-d1", \`\${counter.n};\${counter.ms.toFixed(2)};\${counter.rowsRead}\`);
    return copy;
  }
};
`;

// The index source with its default export renamed and the counter appended.
export function wrapWorkerSource(source) {
  if (source.split(EXPORT_MARKER).length !== 2) {
    throw new Error("Expected exactly one `export default {` at the start of a line in src/index.ts.");
  }
  return source.replace(EXPORT_MARKER, "\nconst __measuredWorker = {\n") + D1_COUNTER_SOURCE;
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: node scripts/wrap-d1-counter.mjs <tree copy>");
  const root = path.resolve(directory);
  if (existsSync(path.join(root, ".git"))) throw new Error(`${root} is a git checkout; wrap an extracted copy instead.`);
  const indexFile = path.join(root, "src", "index.ts");
  const source = await readFile(indexFile, "utf8");
  if (source.includes("__measuredWorker")) throw new Error(`${indexFile} is already wrapped.`);
  await writeFile(indexFile, wrapWorkerSource(source));
  console.log(`Wrapped ${indexFile} with the D1 counter.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
