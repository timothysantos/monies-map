import assert from "node:assert/strict";
import test from "node:test";

import { collectStaticFiles, compareWithBudget, DEFERRED_COPY_MARKERS, findDeferredCopy, findMissingChunks, measureInitialBundle } from "../../scripts/check-initial-bundle.mjs";

// A small manifest in the shape Vite writes: the entry lazily imports the
// Summary route, which statically imports shared chunks; the chart is only a
// dynamic import and must not count toward the first screen.
const MANIFEST = {
  "index.html": { file: "assets/index-a.js", isEntry: true, dynamicImports: ["src/client/summary-panel.jsx", "src/client/faq-panel.jsx"] },
  "src/client/summary-panel.jsx": { file: "assets/summary-panel-b.js", isDynamicEntry: true, imports: ["index.html", "_shared-c.js"], dynamicImports: ["src/client/spending-mix-recharts.jsx"] },
  "_shared-c.js": { file: "assets/shared-c.js", imports: ["index.html"] },
  "src/client/faq-panel.jsx": { file: "assets/faq-panel-d.js", isDynamicEntry: true, imports: ["index.html"] },
  "src/client/spending-mix-recharts.jsx": { file: "assets/spending-mix-recharts-e.js", isDynamicEntry: true }
};

test("the first screen is the entry plus the Summary route and their static imports only", () => {
  assert.deepEqual(collectStaticFiles(MANIFEST, ["index.html", "src/client/summary-panel.jsx"]), [
    "assets/index-a.js",
    "assets/shared-c.js",
    "assets/summary-panel-b.js"
  ]);
  assert.throws(() => collectStaticFiles(MANIFEST, ["src/client/missing.jsx"]), /no entry/);
});

test("measurement counts gzip bytes of the first-screen JS and the stylesheet", () => {
  const contents = { "assets/index-a.js": "a".repeat(5_000), "assets/summary-panel-b.js": "b".repeat(2_000), "assets/shared-c.js": "c".repeat(1_000) };
  const measured = measureInitialBundle(MANIFEST, (file) => Buffer.from(contents[file]), Buffer.from("body{color:red}".repeat(100)));
  assert.equal(measured.jsFiles, 3);
  assert.ok(measured.jsGzipBytes > 0 && measured.jsGzipBytes < 8_000, "gzip of repetitive text is smaller than the raw bytes");
  assert.ok(measured.cssGzipBytes > 0);
  assert.equal(measured.files.includes("assets/spending-mix-recharts-e.js"), false);
  assert.equal(measured.files.includes("assets/faq-panel-d.js"), false);
});

test("a build within 5% passes; more bytes or more files fail with a clear message", () => {
  const budget = { jsFiles: 8, jsGzipBytes: 100_000, cssGzipBytes: 30_000 };
  assert.deepEqual(compareWithBudget({ jsFiles: 8, jsGzipBytes: 105_000, cssGzipBytes: 31_500 }, budget), []);
  assert.deepEqual(compareWithBudget({ jsFiles: 7, jsGzipBytes: 60_000, cssGzipBytes: 10_000 }, budget), []);
  const failures = compareWithBudget({ jsFiles: 9, jsGzipBytes: 105_001, cssGzipBytes: 31_501 }, budget);
  assert.equal(failures.length, 3);
  assert.match(failures[0], /jsGzipBytes 105001 is over the budget 100000 \(\+5% = 105000\)/);
  assert.match(failures[1], /cssGzipBytes/);
  assert.match(failures[2], /jsFiles 9 is over the budget 8/);
});

// Money insights' copy pools (every phrasing, think line, Just for fun line
// and calm line) load with a dynamic import beside the first screen, never
// inside it. The check reads the built first-screen files for a line from
// each pool; the markers are pinned to the catalogues so they cannot rot.
test("the Money insights copy pools are not in the first-screen files", () => {
  const contents = {
    "assets/index-a.js": "const app=1;",
    "assets/summary-panel-b.js": "export const x=1;",
    "assets/shared-c.js": "const y=\"Nothing here\";"
  };
  const read = (file) => Buffer.from(contents[file] ?? "");
  const files = collectStaticFiles(MANIFEST, ["index.html", "src/client/summary-panel.jsx"]);
  assert.deepEqual(findDeferredCopy(files, read), []);
  // A pool bundled into a first-screen file is named with the file.
  contents["assets/shared-c.js"] += `const pool=${JSON.stringify(DEFERRED_COPY_MARKERS.map((marker) => marker.text))};`;
  const found = findDeferredCopy(files, read);
  assert.deepEqual(found.map((item) => item.pool), DEFERRED_COPY_MARKERS.map((marker) => marker.pool));
  assert.ok(found.every((item) => item.file === "assets/shared-c.js"));
});

test("each copy-pool marker is a real line of its pool", async () => {
  const { SUMMARY_COPY } = await import("../../src/domain/money-signals/summary-signals.ts");
  const { SHARED_COPY } = await import("../../src/domain/money-signals/shared-signals.ts");
  const { CALM_LINE_TEMPLATES } = await import("../../src/domain/money-signals/calm-lines.ts");
  const { QUOTES } = await import("../../src/domain/money-signals/quotes.ts");
  const lines = {
    "Summary phrasings and think lines": Object.values(SUMMARY_COPY).filter((entry) => entry.think).flatMap((entry) => [...entry.phrasings.map((phrasing) => (typeof phrasing === "string" ? phrasing : phrasing.fact)), ...[entry.think].flat()]),
    "Summary Just for fun": Object.values(SUMMARY_COPY).filter((entry) => !entry.think).flatMap((entry) => entry.phrasings),
    "statement gap": [...SHARED_COPY.statementGap.phrasings, ...SHARED_COPY.statementGap.think],
    "calm lines": CALM_LINE_TEMPLATES,
    quotes: QUOTES.map((quote) => quote.text)
  };
  for (const marker of DEFERRED_COPY_MARKERS) {
    assert.ok((lines[marker.pool] ?? []).some((line) => line.includes(marker.text)), `${marker.pool}: ${marker.text}`);
  }
});

test("every chunk, stylesheet and import the build refers to exists, and each lazy route panel is a chunk", () => {
  const everything = new Set(Object.values(MANIFEST).map((chunk) => chunk.file));
  assert.deepEqual(findMissingChunks(MANIFEST, (file) => everything.has(file), ["src/client/faq-panel.jsx"]), []);

  // A chunk file the deploy lost: a stale page would load index.html in its place.
  const lost = new Set(everything);
  lost.delete("assets/faq-panel-d.js");
  assert.deepEqual(findMissingChunks(MANIFEST, (file) => lost.has(file)), [
    "src/client/faq-panel.jsx refers to assets/faq-panel-d.js, which is not in dist/."
  ]);

  // An import that names no manifest entry, and a route panel that is not lazy.
  const broken = { ...MANIFEST, "_shared-c.js": { file: "assets/shared-c.js", imports: ["_gone.js"] } };
  assert.deepEqual(findMissingChunks(broken, (file) => everything.has(file), ["src/client/settings-panel.jsx", "index.html"]), [
    "_shared-c.js imports _gone.js, which the build did not write.",
    "The route panel src/client/settings-panel.jsx is not a lazy chunk in the build.",
    "The route panel index.html is not a lazy chunk in the build."
  ]);
});
