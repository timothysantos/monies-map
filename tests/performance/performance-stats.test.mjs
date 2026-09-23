import assert from "node:assert/strict";
import test from "node:test";
import { classifyResource, parseServerTiming, percentile, summarizeSamples, totalsByType } from "./performance-stats.mjs";

test("nearest-rank percentiles over 20 samples use the 10th and 19th values", () => {
  const samples = Array.from({ length: 20 }, (_, index) => 20 - index);
  assert.equal(percentile(samples, 0.5), 10);
  assert.equal(percentile(samples, 0.95), 19);
  assert.deepEqual(summarizeSamples(samples), { sampleCount: 20, medianMs: 10, p95Ms: 19, minMs: 1, maxMs: 20 });
});

test("missing samples summarize as unknown, never zero", () => {
  assert.equal(percentile([], 0.5), null);
  assert.deepEqual(summarizeSamples([null, Number.NaN]), { sampleCount: 0, medianMs: null, p95Ms: null, minMs: null, maxMs: null });
  assert.equal(percentile([null, 7], 0.95), 7);
});

test("resource totals keep counts but mark bytes unknown when any size is missing", () => {
  const totals = totalsByType([
    { path: "/assets/index-abc12345.js", bytes: 100 },
    { path: "/assets/entries-panel-abc12345.js", bytes: 50 },
    { path: "/styles.css", bytes: 30 },
    { path: "/api/entries-page", bytes: null },
    { path: "/api/summary-page", bytes: 20 },
    { path: "/summary", bytes: 5 }
  ]);
  assert.deepEqual(totals, {
    js: { count: 2, bytes: 150 },
    css: { count: 1, bytes: 30 },
    api: { count: 2, bytes: null },
    document: { count: 1, bytes: 5 }
  });
  assert.equal(classifyResource("/favicon.svg"), "other");
});

test("server timing parses durations and tolerates absent values", () => {
  assert.deepEqual(parseServerTiming("app;dur=12.5, db;desc=\"d1\";dur=3"), { app: 12.5, db: 3 });
  assert.deepEqual(parseServerTiming("cache"), { cache: null });
  assert.equal(parseServerTiming(null), null);
});
