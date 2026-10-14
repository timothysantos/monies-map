// First-screen bundle budget. The code and CSS a browser must download
// before the Summary page is usable are the app entry chunk plus the Summary
// route chunk and their static imports, plus styles.css as the build ships it
// (public/styles.css, minified by vite.config.js). This reads
// them from the Vite build manifest (no timing, so no noise) and fails when
// the gzip total grows past the checked-in budget.
//
//   node scripts/check-initial-bundle.mjs            check dist/ against the budget
//   node scripts/check-initial-bundle.mjs --update   record the current build as the budget
//
// Raise the budget only for a deliberate, measured reason, and say why in the
// commit.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const BUDGET_FILE = "scripts/initial-bundle-budget.json";
export const TOLERANCE = 0.05;
const INITIAL_ROUTE = "src/client/summary-panel.jsx";

// Files reachable through static imports from the given manifest keys.
// Dynamic imports (lazy routes, charts, PDF) are not part of the first screen.
export function collectStaticFiles(manifest, keys) {
  const files = new Set();
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Build manifest has no entry for ${key}.`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const next of chunk.imports ?? []) visit(next);
  };
  keys.forEach(visit);
  return [...files].sort();
}

export function measureInitialBundle(manifest, readAsset, stylesheet) {
  const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
  if (!entryKey) throw new Error("Build manifest has no entry chunk.");
  const files = collectStaticFiles(manifest, [entryKey, INITIAL_ROUTE]);
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  const gzipOf = (buffer) => gzipSync(buffer).length;
  return {
    jsFiles: jsFiles.length,
    jsGzipBytes: jsFiles.reduce((sum, file) => sum + gzipOf(readAsset(file)), 0),
    cssGzipBytes: gzipOf(stylesheet),
    files
  };
}

// Money insights' copy pools load with a dynamic import beside the first
// screen (src/client/money-insights-loader.js), never inside it: one line
// from each pool, as the bundler keeps it. The markers are pinned to the
// catalogues by tests/performance/check-initial-bundle.test.mjs.
export const DEFERRED_COPY_MARKERS = [
  { pool: "Summary phrasings and think lines", text: "Spending has been higher than income for {count} months in a row." },
  { pool: "Summary Just for fun", text: "came up in all {count} months from {span}" },
  { pool: "statement gap", text: "differs from what's recorded here by" },
  { pool: "calm lines", text: "All clear in {place}: nothing needs a look." },
  { pool: "quotes", text: "Time is but the stream I go a-fishing in." }
];

// The first-screen files that hold a deferred copy pool.
export function findDeferredCopy(files, readAsset) {
  const found = [];
  for (const file of files.filter((name) => name.endsWith(".js"))) {
    const text = readAsset(file).toString("utf8");
    for (const marker of DEFERRED_COPY_MARKERS) {
      if (text.includes(marker.text)) {
        found.push({ pool: marker.pool, file });
      }
    }
  }
  return found;
}

// Returns a list of human-readable failures; empty means within budget.
export function compareWithBudget(measured, budget, tolerance = TOLERANCE) {
  const failures = [];
  for (const key of ["jsGzipBytes", "cssGzipBytes"]) {
    const limit = Math.round(budget[key] * (1 + tolerance));
    if (measured[key] > limit) {
      failures.push(`${key} ${measured[key]} is over the budget ${budget[key]} (+${Math.round(tolerance * 100)}% = ${limit}).`);
    }
  }
  if (measured.jsFiles > budget.jsFiles) {
    failures.push(`jsFiles ${measured.jsFiles} is over the budget ${budget.jsFiles}.`);
  }
  return failures;
}

// A route (or any lazy chunk) the build refers to but did not write: the page
// would fail on its dynamic import in a browser. Reports every chunk file,
// stylesheet or asset the manifest lists that is not in dist/, every import
// that names no manifest entry, and every lazy route panel the manifest lacks.
export function findMissingChunks(manifest, fileExists, routePanelKeys = []) {
  const problems = [];
  for (const [key, chunk] of Object.entries(manifest)) {
    for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      if (!fileExists(file)) problems.push(`${key} refers to ${file}, which is not in dist/.`);
    }
    for (const next of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      if (!manifest[next]) problems.push(`${key} imports ${next}, which the build did not write.`);
    }
  }
  for (const key of routePanelKeys) {
    if (!manifest[key]?.isDynamicEntry) problems.push(`The route panel ${key} is not a lazy chunk in the build.`);
  }
  return problems;
}

const ROUTE_PANEL_KEYS = [
  "ask", "entries", "faq", "imports", "month", "settings", "splits", "summary"
].map((route) => `src/client/${route}-panel.jsx`);

async function main(argv) {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(path.join(root, "dist/.vite/manifest.json"), "utf8"));
  const assets = new Map();
  await Promise.all(Object.values(manifest).map(async (chunk) => {
    assets.set(chunk.file, await readFile(path.join(root, "dist", chunk.file)));
  }));
  const stylesheet = await readFile(path.join(root, "dist/styles.css"));
  const measured = measureInitialBundle(manifest, (file) => assets.get(file), stylesheet);
  const summary = { jsFiles: measured.jsFiles, jsGzipBytes: measured.jsGzipBytes, cssGzipBytes: measured.cssGzipBytes };

  if (argv.includes("--update")) {
    await writeFile(path.join(root, BUDGET_FILE), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Initial bundle budget recorded: ${JSON.stringify(summary)}`);
    return;
  }
  const budget = JSON.parse(await readFile(path.join(root, BUDGET_FILE), "utf8"));
  const failures = [
    ...findMissingChunks(manifest, (file) => existsSync(path.join(root, "dist", file)), ROUTE_PANEL_KEYS),
    ...compareWithBudget(summary, budget),
    ...findDeferredCopy(measured.files, (file) => assets.get(file)).map((item) => `${item.file} holds the ${item.pool} copy pool, which must load after the first screen.`)
  ];
  console.log(`Initial bundle: ${JSON.stringify(summary)} (budget ${JSON.stringify(budget)})`);
  if (failures.length) {
    console.error(`First-screen bundle over budget:\n- ${failures.join("\n- ")}\nMove new code behind a lazy route or dynamic import, or raise the budget deliberately with --update and explain why.`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
