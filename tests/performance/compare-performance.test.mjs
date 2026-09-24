import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareMetrics,
  extractMetrics,
  readReports,
  regressionFlag,
  renderMarkdown,
  speculativeUse
} from "../../scripts/compare-performance.mjs";

function report({ cold = [500, 520, 540], js = [8, 8, 9], jsBytes = 200_000, api = 3, apiBytes = 30_000, warmEntries = 50, idle = [], priming = [] } = {}) {
  return {
    project: "desktop-chromium-emulated-network",
    cold: {
      medianMs: cold[1],
      p95Ms: cold[2],
      samples: cold.map((usableMs, index) => ({
        usableMs,
        requestsBeforeUsable: {
          js: { count: js[index], bytes: jsBytes },
          api: { count: api, bytes: apiBytes },
          document: { count: 1, bytes: 2_000 }
        }
      }))
    },
    warm: {
      primingRoundTrip: priming,
      summaryToEntries: { medianMs: warmEntries, p95Ms: warmEntries + 10 },
      entriesToSummary: { medianMs: 45, p95Ms: 60 }
    },
    idleAfterFirstColdLoad: Object.fromEntries(["2s", "10s", "30s"].map((checkpoint) => [checkpoint, {
      byType: idle.length ? { js: { count: idle.length, bytes: idle.reduce((sum, item) => sum + item.bytes, 0) } } : {},
      items: idle
    }]))
  };
}

test("metrics come from cold samples, the first navigation, warm navigation and idle checkpoints", () => {
  const metrics = extractMetrics(report({
    idle: [{ path: "/assets/entries-panel-AAAA1111.js", bytes: 10_000 }],
    priming: [{ usableMs: 180, items: [{ path: "/api/entries-page", bytes: 3_000 }] }, { usableMs: 60, items: [] }]
  }));
  assert.equal(metrics.coldMedianMs, 520);
  assert.equal(metrics.coldP95Ms, 540);
  assert.equal(metrics.bytesBeforeUsable, 232_000);
  assert.equal(metrics.jsFilesBeforeUsable, 8);
  assert.equal(metrics.apiBeforeUsable, 3);
  assert.equal(metrics.firstEntriesNavigationMs, 180);
  assert.equal(metrics.firstEntriesNavigationRequests, 1);
  assert.equal(metrics.warmToEntriesMedianMs, 50);
  assert.equal(metrics.idleRequests30s, 1);
  assert.equal(metrics.idleBytes30s, 10_000);
  // An unknown size makes the byte total unknown, never zero.
  const unknown = report();
  unknown.cold.samples.forEach((sample) => { sample.requestsBeforeUsable.api.bytes = null; });
  assert.equal(extractMetrics(unknown).bytesBeforeUsable, null);
});

test("regressions beyond +5% initial bytes or +10% timing are flagged; improvements and unlimited rows are not", () => {
  assert.equal(regressionFlag("bytes", 100_000, 105_000), "");
  assert.equal(regressionFlag("bytes", 100_000, 105_001), "over +5%");
  assert.equal(regressionFlag("timing", 500, 550), "");
  assert.equal(regressionFlag("timing", 500, 551), "over +10%");
  assert.equal(regressionFlag("timing", 500, 300), "");
  assert.equal(regressionFlag(null, 1, 100), "");
  assert.equal(regressionFlag("timing", null, 100), "");

  const rows = compareMetrics(extractMetrics(report()), extractMetrics(report({ cold: [600, 620, 640], jsBytes: 150_000 })));
  const cold = rows.find((row) => row.label === "Cold usable median (ms)");
  assert.equal(cold.delta, "+100 (+19.2%)");
  assert.equal(cold.flag, "over +10%");
  const jsBytes = rows.find((row) => row.label === "JS bytes before usable");
  assert.equal(jsBytes.delta, "-50,000 (-25.0%)");
  assert.equal(jsBytes.flag, "");
  const markdown = renderMarkdown("desktop", rows);
  assert.match(markdown, /^### desktop/);
  assert.match(markdown, /\| Cold usable median \(ms\) \| 520 \| 620 \| \+100 \(\+19\.2%\) \| over \+10% \|/);
});

test("idle warmup is split into hits the unwarmed round trip needed and completed-but-unused bytes", () => {
  const candidate = report({ idle: [
    { path: "/assets/entries-panel-AAAA1111.js", bytes: 10_000 },
    { path: "/api/entries-page", bytes: 3_000 },
    { path: "/api/imports-page", bytes: 1_500 }
  ] });
  const unwarmed = report({ priming: [
    { usableMs: 200, items: [{ path: "/assets/entries-panel-AAAA1111.js", bytes: 10_000 }, { path: "/api/entries-page", bytes: 3_000 }] },
    { usableMs: 60, items: [] }
  ] });
  assert.deepEqual(speculativeUse(candidate, unwarmed), {
    idleItems: 3,
    hits: 2,
    hitRate: 2 / 3,
    hitPaths: ["/assets/entries-panel-AAAA1111.js", "/api/entries-page"],
    unusedPaths: ["/api/imports-page"],
    unusedBytes: 1_500
  });
  assert.equal(speculativeUse(report(), unwarmed).hitRate, null);
});

test("the latest built-client report per project is read; other reports are ignored", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "compare-performance-"));
  try {
    await writeFile(path.join(directory, "1-desktop.json"), JSON.stringify(report({ cold: [1, 2, 3] })));
    await writeFile(path.join(directory, "2-desktop.json"), JSON.stringify(report({ cold: [4, 5, 6] })));
    await writeFile(path.join(directory, "3-admission-demo.json"), JSON.stringify({ task: "H01b", results: [] }));
    const reports = await readReports(directory);
    assert.equal(reports.size, 1);
    assert.equal(reports.get("desktop-chromium-emulated-network").cold.medianMs, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
