// The first screen (main.jsx plus the Summary route, by static imports) keeps
// route-only code out: route copy lives in copy/en-SG-<route>.js beside its
// route, route warmup loads after the page is usable. The bundle budget
// (npm run check:bundle) measures the result; this test names the cause, so a
// stray import fails here with the file that dragged the code in.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLIENT = path.join(ROOT, "src/client");
const FIRST_SCREEN_ENTRIES = ["src/client/main.jsx", "src/client/summary-panel.jsx"];

const ROUTE_COPY = {
  importMessages: "en-SG-imports.js",
  settingsMessages: "en-SG-settings.js",
  monthMessages: "en-SG-month.js",
  entriesMessages: "en-SG-entries.js",
  splitsMessages: "en-SG-splits.js",
  faqMessages: "en-SG-faq.js"
};
// Loaded once the page is usable, never as part of the first screen.
const AFTER_FIRST_SCREEN = [
  ...Object.values(ROUTE_COPY).map((file) => `src/client/copy/${file}`),
  "src/client/route-warmup-engine.js",
  "src/client/route-warmup-policy.js",
  "src/client/route-warmup-scheduler.js",
  "src/client/route-warmup-costs.js",
  // The barrel and what only it pulls in (selects, the category list host).
  "src/client/ui-components.jsx",
  "src/client/responsive-select.jsx",
  "src/client/category-picker-host.jsx"
];

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`, path.join(base, "index.js")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${path.relative(ROOT, fromFile)} imports ${specifier}, which does not resolve.`);
}

// Static imports only: `import(...)` is lazy and not part of the first screen.
function staticImports(file) {
  const source = readFileSync(file, "utf8");
  const found = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(?:[^"'()]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const resolved = resolveImport(file, match[1]);
    if (resolved) found.push(resolved);
  }
  return found;
}

// Map of file -> the first-screen file that imported it first.
function firstScreenClosure() {
  const parents = new Map();
  const queue = FIRST_SCREEN_ENTRIES.map((entry) => path.join(ROOT, entry));
  queue.forEach((file) => parents.set(file, null));
  while (queue.length) {
    const file = queue.shift();
    for (const next of staticImports(file)) {
      if (!parents.has(next)) {
        parents.set(next, file);
        queue.push(next);
      }
    }
  }
  return parents;
}

test("the first screen's static imports hold no route copy and no route warmup engine", () => {
  const closure = firstScreenClosure();
  assert.ok(closure.has(path.join(CLIENT, "App.jsx")), "the closure walk reaches App.jsx");
  for (const relative of AFTER_FIRST_SCREEN) {
    const file = path.join(ROOT, relative);
    assert.equal(closure.has(file), false, `${relative} is a first-screen static import (via ${closure.get(file) ? path.relative(ROOT, closure.get(file)) : "?"}); load it with the route or after the page is usable.`);
  }
});

test("the first-screen copy module imports no route copy", () => {
  const imports = staticImports(path.join(CLIENT, "copy/en-SG.js")).map((file) => path.basename(file));
  assert.deepEqual(imports.filter((name) => name.startsWith("en-SG-")), []);
});

function* clientSources(dir = CLIENT) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* clientSources(full);
    else if (/\.(js|jsx)$/.test(name)) yield full;
  }
}

async function loadMessages() {
  const first = (await import(pathToFileURL(path.join(CLIENT, "copy/en-SG.js")))).messages;
  const modules = {};
  for (const [exportName, file] of Object.entries(ROUTE_COPY)) {
    modules[exportName] = (await import(pathToFileURL(path.join(CLIENT, "copy", file))))[exportName];
  }
  return { first, modules };
}

// A key read by a dialog nothing mounts (splits-linked-entry-dialog.jsx has no
// importer); it never rendered and is left as found.
const KNOWN_UNMOUNTED_READS = new Set(["src/client/splits-linked-entry-dialog.jsx: splitsMessages.editLinkedEntry does not exist."]);

test("every copy key a source file reads exists in the first-screen copy or its route's copy", async () => {
  const { first, modules } = await loadMessages();
  const problems = [];
  const sources = [...clientSources()];
  assert.ok(sources.length > 100);
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bmessages\.(\w+)(?:\.(\w+))?/g)) {
      const [, section, key] = match;
      if (!(section in first)) problems.push(`${path.relative(ROOT, file)}: messages.${section} is not first-screen copy.`);
      else if (key && first[section] && typeof first[section] === "object" && !(key in first[section])) {
        problems.push(`${path.relative(ROOT, file)}: messages.${section}.${key} does not exist.`);
      }
    }
    for (const [exportName, copy] of Object.entries(modules)) {
      for (const match of text.matchAll(new RegExp(`\\b${exportName}\\.(\\w+)`, "g"))) {
        if (!(match[1] in copy)) problems.push(`${path.relative(ROOT, file)}: ${exportName}.${match[1]} does not exist.`);
      }
    }
  }
  assert.deepEqual(problems.filter((problem) => !KNOWN_UNMOUNTED_READS.has(problem)), []);
});

test("the first-screen copy keeps what every page needs, and the route sections moved out", async () => {
  const { first, modules } = await loadMessages();
  for (const section of ["common", "views", "tabs", "shell", "accountHealth", "askDock", "period", "summary"]) {
    assert.equal(typeof first[section], "object", `messages.${section} stays first-screen`);
  }
  // The two Add buttons in the floating bar are first-screen words.
  assert.equal(typeof first.shell.addEntry, "string");
  assert.equal(typeof first.shell.addSplitsExpense, "string");
  for (const section of ["month", "entries", "splits", "faq"]) {
    assert.equal(section in first, false, `messages.${section} moved to its route's copy`);
  }
  assert.equal(modules.splitsMessages.entryCount(1), "1 entry");
  assert.equal(modules.faqMessages.tabs.user, "User guide");
  assert.equal(typeof modules.monthMessages.planLinkNoCandidates, "string");
  assert.equal(typeof modules.splitsMessages.categoryBreakdown, "string");
  assert.equal(typeof modules.entriesMessages.addEntry, "string");
});
