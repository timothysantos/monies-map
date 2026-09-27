import assert from "node:assert/strict";
import test from "node:test";

import { collectStaticFiles, compareWithBudget, measureInitialBundle } from "../../scripts/check-initial-bundle.mjs";

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
