import assert from "node:assert/strict";
import test from "node:test";

import { ROUTE_IDS } from "../src/client/route-modules.js";
import { WARMUP_COST_ROUTE_IDS, missingRouteBytes, parseWarmupCosts, readWarmupCosts } from "../src/client/route-warmup-costs.js";
import { parseWarmupCosts as scriptParseWarmupCosts } from "../scripts/route-asset-report.mjs";

// Chunk lists are incremental over the entry bundle. entry-editor is shared
// by Month and Entries.
const costs = {
  schemaVersion: 1,
  buildId: "b",
  revision: "r",
  routes: {
    summary: { entry: "s", estimatedGzipBytes: 20, chunks: [{ file: "assets/summary.js", estimatedGzipBytes: 20 }] },
    month: { entry: "m", estimatedGzipBytes: 30, chunks: [{ file: "assets/month.js", estimatedGzipBytes: 20 }, { file: "assets/entry-editor.js", estimatedGzipBytes: 10 }] },
    entries: { entry: "e", estimatedGzipBytes: 50, chunks: [{ file: "assets/entries.js", estimatedGzipBytes: 40 }, { file: "assets/entry-editor.js", estimatedGzipBytes: 10 }] },
    splits: { entry: "sp", estimatedGzipBytes: 5, chunks: [{ file: "assets/splits.js", estimatedGzipBytes: 5 }] },
    imports: { entry: "i", estimatedGzipBytes: 5, chunks: [{ file: "assets/imports.js", estimatedGzipBytes: 5 }] },
    settings: { entry: "se", estimatedGzipBytes: 5, chunks: [{ file: "assets/settings.js", estimatedGzipBytes: 5 }] },
    faq: { entry: "f", estimatedGzipBytes: 5, chunks: [{ file: "assets/faq.js", estimatedGzipBytes: 5 }] }
  }
};

test("the cost block covers exactly the route modules", () => {
  assert.deepEqual([...WARMUP_COST_ROUTE_IDS].sort(), [...ROUTE_IDS].sort());
});

test("build scripts and the browser share one parser", () => {
  assert.equal(scriptParseWarmupCosts, parseWarmupCosts);
  assert.equal(parseWarmupCosts(JSON.stringify(costs)).buildId, "b");
});

test("missing bytes subtract chunks of loaded routes only, counting shared chunks once", () => {
  assert.equal(missingRouteBytes(costs, "entries", []), 50);
  assert.equal(missingRouteBytes(costs, "entries", ["summary"]), 50);
  assert.equal(missingRouteBytes(costs, "entries", ["month"]), 40, "shared entry-editor already loaded with Month");
  assert.equal(missingRouteBytes(costs, "entries", ["month", "month"]), 40);
  assert.equal(missingRouteBytes(costs, "month", ["entries"]), 20);
});

test("zero bytes only when every chunk is already loaded", () => {
  assert.equal(missingRouteBytes(costs, "entries", ["entries"]), 0);
  const withDuplicateChunk = {
    ...costs,
    routes: { ...costs.routes, splits: { ...costs.routes.splits, chunks: [costs.routes.splits.chunks[0], costs.routes.splits.chunks[0]] } }
  };
  assert.equal(missingRouteBytes(withDuplicateChunk, "splits", []), 5);
});

test("unknown costs and unknown routes are null, never zero", () => {
  assert.equal(missingRouteBytes(null, "entries", []), null);
  assert.equal(missingRouteBytes(costs, "reports", []), null);
  assert.equal(missingRouteBytes(costs, "entries", ["reports"]), 50, "an unknown loaded route subtracts nothing");
});

function fakeDocument(textContent, counter = { reads: 0 }) {
  return {
    counter,
    getElementById(id) {
      counter.reads += 1;
      return id === "monies-warmup-costs" && textContent !== null ? { textContent } : null;
    }
  };
}

test("readWarmupCosts parses the inline block once per document", () => {
  const doc = fakeDocument(JSON.stringify(costs));
  assert.equal(readWarmupCosts(doc).buildId, "b");
  assert.equal(readWarmupCosts(doc).buildId, "b");
  assert.equal(doc.counter.reads, 1);
});

test("missing, malformed or throwing blocks read as unknown", () => {
  assert.equal(readWarmupCosts(fakeDocument(null)), null, "development builds have no block");
  assert.equal(readWarmupCosts(fakeDocument("{not json")), null);
  assert.equal(readWarmupCosts(fakeDocument(JSON.stringify({ ...costs, routes: { summary: costs.routes.summary } }))), null);
  assert.equal(readWarmupCosts({ getElementById() { throw new Error("detached"); } }), null);
  assert.equal(readWarmupCosts(undefined), null);
});
