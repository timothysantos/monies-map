import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { buildWarmupCosts, createRouteAssetReport, parseWarmupCosts } from "../../scripts/route-asset-report.mjs";
import { replaceWarmupCostsBlock, renderWarmupCostsBlock } from "../../scripts/write-warmup-costs.mjs";

function manifestFixture() {
  return {
    "src/client/main.jsx": { file: "assets/main.js", isEntry: true, imports: ["shared-a.js", "shared-b.js"], dynamicImports: ["src/client/summary-panel.jsx"] },
    "shared-a.js": { file: "assets/shared-a.js", imports: ["shared.js"] },
    "shared-b.js": { file: "assets/shared-b.js", imports: ["shared.js"] },
    "shared.js": { file: "assets/shared.js", css: ["assets/shared.css"] },
    "src/client/summary-panel.jsx": { file: "assets/summary.js", imports: ["shared.js"], dynamicImports: ["pdf.js"] },
    "pdf.js": { file: "assets/pdf.js", imports: ["pdf-worker.mjs"] },
    "pdf-worker.mjs": { file: "assets/pdf-worker.mjs" },
    "src/client/month-panel.jsx": { file: "assets/month.js" },
    "src/client/entries-panel.jsx": { file: "assets/entries.js" },
    "src/client/splits-panel.jsx": { file: "assets/splits.js" },
    "src/client/imports-panel.jsx": { file: "assets/imports.js" },
    "src/client/settings-panel.jsx": { file: "assets/settings.js" },
    "src/client/faq-panel.jsx": { file: "assets/faq.js" }
  };
}

const bytesFor = (file) => Buffer.from(`asset:${file}`);

test("route closure follows static imports once and leaves dynamic PDF outside Summary initial cost", () => {
  const report = createRouteAssetReport(manifestFixture(), bytesFor);
  const initialFiles = report.entry.files.map(({ file }) => file);
  const summaryFiles = report.routes.summary.files.map(({ file }) => file);
  assert.equal(initialFiles.filter((file) => file === "assets/shared.js").length, 1);
  assert.equal(summaryFiles.filter((file) => file === "assets/shared.js").length, 1, "route closure includes shared static dependency once");
  assert.equal(summaryFiles.includes("assets/pdf.js"), false);
  assert.equal(summaryFiles.includes("assets/pdf-worker.mjs"), false);
  assert.deepEqual(report.routes.summary.dynamicAssets.map(({ file }) => file), ["assets/pdf-worker.mjs", "assets/pdf.js"]);
  assert.equal(report.sharedAcrossRoutes.some(({ file }) => file === "assets/shared.js"), true);
  assert.equal(report.routeFilesCountedOnce.filter(({ file }) => file === "assets/shared.js").length, 1);
});

test("HTML-linked stylesheet is counted in initial and route CSS, once across routes", () => {
  const report = createRouteAssetReport(manifestFixture(), bytesFor, { htmlAssets: ["styles.css"] });
  assert.equal(report.entry.files.filter(({ file }) => file === "styles.css").length, 1);
  assert.equal(report.entry.files.find(({ file }) => file === "styles.css").estimatedGzipBytes, gzipSync(bytesFor("styles.css")).length);
  assert.equal(report.routes.summary.files.filter(({ file }) => file === "styles.css").length, 1);
  assert.equal(report.sharedAcrossRoutes.filter(({ file }) => file === "styles.css").length, 1);
  assert.equal(report.routes.summary.incrementalFiles.some(({ file }) => file === "styles.css"), false);
});

test("a missing manifest asset makes route cost unknown rather than zero", () => {
  const readAsset = (file) => file === "assets/summary.js" ? null : bytesFor(file);
  const report = createRouteAssetReport(manifestFixture(), readAsset);
  assert.equal(report.routes.summary.incrementalEstimatedGzipBytes, null);
  assert.equal(report.routes.summary.costKnown, false);
  assert.equal(buildWarmupCosts(manifestFixture(), readAsset).routes.summary, undefined);
});

test("embedded metadata escapes script terminators and replaces prior copies on repeat generation", () => {
  const metadata = { schemaVersion: 1, buildId: "test", routes: { summary: { entry: "</script>", estimatedGzipBytes: 1, chunks: [] } } };
  const once = replaceWarmupCostsBlock("<!doctype html><head></head><body></body>", metadata);
  const twice = replaceWarmupCostsBlock(once, metadata);
  assert.equal((twice.match(/id="monies-warmup-costs"/g) ?? []).length, 1);
  assert.match(twice, /\\u003c\/script>/);
  assert.throws(() => replaceWarmupCostsBlock("<body></body>", metadata), /missing <\/head>/);
  const routes = Object.fromEntries(["summary", "month", "entries", "splits", "imports", "settings", "faq"].map((name) => [name, {
    estimatedGzipBytes: 1,
    chunks: [{ file: `assets/${name}.js`, estimatedGzipBytes: 1 }]
  }]));
  assert.deepEqual(parseWarmupCosts(JSON.stringify({ ...metadata, routes }))?.buildId, "test");
});

test("malformed, absent, and incomplete embedded cost metadata stays unknown", () => {
  const routes = Object.fromEntries(["summary", "month", "entries", "splits", "imports", "settings", "faq"].map((name) => [name, {
    estimatedGzipBytes: 10,
    chunks: [{ file: `assets/${name}.js`, estimatedGzipBytes: 10 }]
  }]));
  const valid = { schemaVersion: 1, buildId: "valid", routes };
  assert.equal(parseWarmupCosts("not json"), null);
  assert.equal(parseWarmupCosts("{}"), null);
  assert.equal(parseWarmupCosts(valid)?.buildId, "valid");
  assert.equal(parseWarmupCosts({ ...valid, routes: { ...routes, faq: undefined } }), null);
  assert.equal(parseWarmupCosts({ ...valid, routes: { ...routes, summary: { estimatedGzipBytes: 0, chunks: [] } } }), null);
  assert.equal(parseWarmupCosts({ ...valid, routes: { ...routes, summary: { estimatedGzipBytes: null, chunks: [] } } }), null);
  assert.equal(parseWarmupCosts(null), null);
  assert.equal(renderWarmupCostsBlock({ schemaVersion: 1, buildId: "b", routes: {} }).includes("application/json"), true);
});

test("a dangling manifest import makes that route unknown and invalidates embedded metadata", () => {
  const manifest = manifestFixture();
  manifest["src/client/summary-panel.jsx"].imports = ["shared.js", "gone.js"];
  const report = createRouteAssetReport(manifest, bytesFor);
  assert.equal(report.routes.summary.costKnown, false);
  assert.equal(report.routes.summary.incrementalEstimatedGzipBytes, null);
  assert.equal(report.routes.month.costKnown, true, "other routes keep their known cost");
  const metadata = buildWarmupCosts(manifest, bytesFor);
  assert.equal(metadata.routes.summary, undefined);
  assert.equal(parseWarmupCosts(metadata), null, "incomplete route table must read as unknown, not partial zero");
});

test("generated metadata round-trips through HTML with incremental chunks and exact gzip sizes", () => {
  const metadata = buildWarmupCosts(manifestFixture(), bytesFor, { revision: "abc1234" });
  const html = replaceWarmupCostsBlock("<!doctype html><html><head><link rel=\"stylesheet\" href=\"/styles.css\"></head><body></body></html>", metadata);
  const body = html.match(/<script id="monies-warmup-costs" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const parsed = parseWarmupCosts(body);
  assert.equal(parsed.revision, "abc1234");
  assert.match(parsed.buildId, /^[0-9a-f]{16}$/);
  assert.deepEqual(parsed.routes.summary.chunks, [{ file: "assets/summary.js", estimatedGzipBytes: gzipSync(bytesFor("assets/summary.js")).length }]);
  assert.equal(parsed.routes.summary.estimatedGzipBytes, gzipSync(bytesFor("assets/summary.js")).length, "shared.js is already in the entry closure and is not charged again");
  assert.equal(buildWarmupCosts(manifestFixture(), bytesFor).buildId, parsed.buildId, "same manifest yields the same build identity");
});
