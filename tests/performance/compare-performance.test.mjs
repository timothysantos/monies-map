import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareMetrics,
  extractMetrics,
  interactionVerdict,
  readInteractionReports,
  readReports,
  renderInteractionMarkdown,
  summarizeInteractionCohort,
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

function interactionReport({ project = "desktop-chromium-emulated-network", searchType = [100, 120, 140], openEditor = [300, 310], rows = 2018 } = {}) {
  return {
    task: "entries-interaction",
    project,
    actions: {
      searchType: { rawSettledMs: searchType, rawEventMs: searchType.map((value) => value - 20) },
      openEditor: { rawSettledMs: openEditor, rawEventMs: [0, 0] }
    },
    renders: { searchType: { entryRowRenders: rows, componentRenders: rows * 12 }, openEditor: { entryRowRenders: rows * 2, componentRenders: rows * 24 } }
  };
}

test("interaction cohorts pool samples and keep the spread of per-run medians", () => {
  const summary = summarizeInteractionCohort([
    interactionReport({ searchType: [100, 120, 140] }),
    interactionReport({ searchType: [200, 210, 220], rows: 2 })
  ]);
  assert.deepEqual(summary.searchType, {
    runs: 2,
    samples: 6,
    settledMedianMs: 140,
    settledP95Ms: 220,
    runMedianMinMs: 120,
    runMedianMaxMs: 210,
    eventMedianMs: 120,
    eventP95Ms: 200,
    entryRowRenders: 2,
    componentRenders: 24
  });
  assert.equal(summary.openEditor.eventMedianMs, 0);
  assert.equal(summary.openEditor.entryRowRenders, 4);
});

test("a cohort is only called faster or slower when per-run medians do not overlap", () => {
  const baseline = { runMedianMinMs: 200, runMedianMaxMs: 260 };
  assert.equal(interactionVerdict(baseline, { runMedianMinMs: 40, runMedianMaxMs: 60 }), "faster");
  assert.equal(interactionVerdict(baseline, { runMedianMinMs: 280, runMedianMaxMs: 300 }), "slower");
  assert.equal(interactionVerdict(baseline, { runMedianMinMs: 190, runMedianMaxMs: 210 }), "within noise");
  assert.equal(interactionVerdict(baseline, { runMedianMinMs: null, runMedianMaxMs: null }), "n/a");
  const markdown = renderInteractionMarkdown(
    "desktop",
    summarizeInteractionCohort([interactionReport({ searchType: [200, 220, 240] })]),
    summarizeInteractionCohort([interactionReport({ searchType: [40, 50, 60], rows: 12 })])
  );
  assert.match(markdown, /\| searchType \| 220 → 50 \| -170 \(-77\.3%\) \| 240 → 60 \| 220–220 → 50–50 \| 200 → 30 \| 2,018 → 12 \| 24,216 → 144 \| faster \|/);
});

test("only interaction reports are read, every run per task and project", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "interaction-reports-"));
  try {
    await writeFile(path.join(directory, "1-a.json"), JSON.stringify(interactionReport()));
    await writeFile(path.join(directory, "2-b.json"), JSON.stringify(interactionReport({ project: "mobile" })));
    await writeFile(path.join(directory, "3-c.json"), JSON.stringify(interactionReport()));
    await writeFile(path.join(directory, "4-built.json"), JSON.stringify(report()));
    await writeFile(path.join(directory, "5-month.json"), JSON.stringify({ ...interactionReport(), task: "month-interaction" }));
    const reports = await readInteractionReports(directory);
    assert.deepEqual([...reports.keys()].sort(), [
      "entries-interaction · desktop-chromium-emulated-network",
      "entries-interaction · mobile",
      "month-interaction · desktop-chromium-emulated-network"
    ]);
    assert.equal(reports.get("entries-interaction · desktop-chromium-emulated-network").length, 2);
    assert.equal(reports.get("entries-interaction · mobile").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
