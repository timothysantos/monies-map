import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { parseServerTiming, summarizeSamples } from "./performance-stats.mjs";

// Admission measurements for H01b: response size and handler time per query
// family, from direct API requests against the harness Worker. It records,
// never asserts timing, so noise cannot fail it. Run it per fixture with
// PERFORMANCE_FIXTURE=demo|scale-1k|scale-10k.

const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const SAMPLES = Number(process.env.PERFORMANCE_ADMISSION_SAMPLES ?? 20);

export const ADMISSION_FAMILIES = [
  { family: "entries-page", path: "/api/entries-page?view=household&month=2026-05" },
  { family: "entries-page", path: "/api/entries-page?view=person-tim&month=2026-05" },
  { family: "month-page", path: "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared" },
  { family: "summary-page", rangeMonths: 6, path: "/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2025-12&summary_end=2026-05" },
  { family: "summary-page", rangeMonths: 12, path: "/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-05" },
  { family: "summary-account-pills", path: "/api/summary-account-pills?view=household" },
  { family: "splits-page", path: "/api/splits-page?view=household&month=2026-05" },
  { family: "imports-page", path: "/api/imports-page" }
];

test("page API admission measurements", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "API-only measurement; the device profile does not apply, so it runs once per cohort");
  const results = [];
  for (const { family, rangeMonths = null, path: apiPath } of ADMISSION_FAMILIES) {
    // One unmeasured request warms the isolate and SQLite page cache.
    expect((await request.get(apiPath)).ok()).toBeTruthy();
    const samples = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      const response = await request.get(apiPath);
      expect(response.ok(), apiPath).toBeTruthy();
      const body = await response.body();
      const timing = parseServerTiming(response.headers()["server-timing"]);
      expect(Number.isFinite(timing?.app), `${apiPath} reported no app time`).toBeTruthy();
      samples.push({ bytes: body.length, gzipBytes: gzipSync(body).length, appMs: timing.app, totalMs: timing.total ?? null });
    }
    const app = summarizeSamples(samples.map((sample) => sample.appMs));
    const total = summarizeSamples(samples.map((sample) => sample.totalMs));
    results.push({
      family,
      rangeMonths,
      path: apiPath,
      // Bodies differ only by timestamps, so the largest sample is reported.
      responseBytes: Math.max(...samples.map((sample) => sample.bytes)),
      gzipBytes: Math.max(...samples.map((sample) => sample.gzipBytes)),
      appMedianMs: app.medianMs,
      appP95Ms: app.p95Ms,
      totalMedianMs: total.medianMs,
      totalP95Ms: total.p95Ms,
      sampleCount: app.sampleCount
    });
  }

  const report = {
    task: "H01b",
    fixture: FIXTURE,
    revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    samplesPerFamily: SAMPLES,
    notes: {
      bytes: "responseBytes is the uncompressed JSON body; gzipBytes is gzip of that body, an estimate of the compressed transfer size (the local Worker does not compress)",
      timing: "app is the page handler (Server-Timing app); total adds initialization and serialization. Local wrangler dev with a local SQLite D1, not production"
    },
    results
  };
  const outputDirectory = process.env.PERFORMANCE_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "monies-map-performance-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${Date.now()}-admission-${FIXTURE}.json`);
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Admission report: ${outputFile}`);
  for (const row of results) {
    console.log(`ADMISSION ${JSON.stringify({ fixture: FIXTURE, ...row, path: undefined })}`);
  }
});
