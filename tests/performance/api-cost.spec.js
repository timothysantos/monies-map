import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { parseServerTiming, percentile } from "./performance-stats.mjs";

// Per-endpoint API cost for every request a screen makes, the shell, the six
// page DTOs and the Ask requests included: response bytes (raw and gzip),
// handler time (Server-Timing `app`) and, when the Worker is wrapped by
// `scripts/wrap-d1-counter.mjs`, D1 statements, D1 time and rows read per
// request (the `x-d1` header, "count;ms;rowsRead"). Records, never asserts
// timing. An endpoint the build under test lacks (older commit) is reported
// as missing. Run it per fixture with PERFORMANCE_FIXTURE=demo|scale-1k|scale-10k.

const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const SAMPLES = Number(process.env.PERFORMANCE_API_COST_SAMPLES ?? 15);
const MONTH = "2026-05";
const MONTH_QUERY = `view=household&month=${MONTH}&scope=direct_plus_shared`;

// [name, method, path, body]
export const API_COST_ENDPOINTS = [
  ["app-shell", "GET", `/api/app-shell?${MONTH_QUERY}`],
  ["reference-data", "GET", "/api/reference-data"],
  ["summary-page 6 months", "GET", `/api/summary-page?${MONTH_QUERY}&summary_start=2025-12&summary_end=${MONTH}`],
  ["summary-page 12 months", "GET", `/api/summary-page?${MONTH_QUERY}&summary_start=2025-06&summary_end=${MONTH}`],
  ["summary-account-pills", "GET", "/api/summary-account-pills?view=household"],
  ["month-page", "GET", `/api/month-page?${MONTH_QUERY}`],
  ["entries-shell", "GET", `/api/entries-shell?view=household&month=${MONTH}`],
  ["entries-page", "GET", `/api/entries-page?view=household&month=${MONTH}`],
  ["entries-page person", "GET", `/api/entries-page?view=person-tim&month=${MONTH}`],
  ["splits-page", "GET", `/api/splits-page?view=household&month=${MONTH}`],
  ["settings-page", "GET", "/api/settings-page?view=household"],
  ["imports-page", "GET", "/api/imports-page"],
  ["skew-candidates", "GET", `/api/skew-candidates?${MONTH_QUERY}`],
  ["provider-status", "GET", "/api/ai-assist/provider-status"],
  ["entry-draft", "POST", "/api/ai-assist/entry-draft", { text: "lunch 12.50 at Toast Box", viewId: "household" }],
  ["split-suggestion", "POST", "/api/splits/suggestion", { entryType: "expense", description: "Cold Storage groceries", categoryName: "Groceries", ownerName: "Tim", date: `${MONTH}-10` }],
  ["answer spending", "POST", "/api/ai-assist/answer", { text: "why was May so expensive?", viewId: "household", month: MONTH }],
  ["answer owed", "POST", "/api/ai-assist/answer", { text: "what do I owe Joyce?", viewId: "household", month: MONTH }]
];

function d1Header(headers) {
  if (!headers["x-d1"]) return { count: null, ms: null, rowsRead: null };
  const [count, ms, rowsRead] = headers["x-d1"].split(";").map(Number);
  return { count, ms, rowsRead };
}

test("API cost per endpoint", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "API only; the device profile does not apply, so it runs once per cohort");
  test.setTimeout(15 * 60_000);
  const results = [];
  for (const [name, method, apiPath, body] of API_COST_ENDPOINTS) {
    const send = () => (method === "GET" ? request.get(apiPath) : request.post(apiPath, { data: body }));
    // One unmeasured request warms the isolate and the SQLite page cache.
    const first = await send();
    if (!first.ok()) {
      results.push({ name, missing: first.status() });
      continue;
    }
    // The first request of the run also pays the Worker's one-time schema check.
    const firstTiming = parseServerTiming(first.headers()["server-timing"]);
    const samples = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      const response = await send();
      const bodyBuffer = await response.body();
      expect(response.ok(), apiPath).toBeTruthy();
      const timing = parseServerTiming(response.headers()["server-timing"]);
      samples.push({ bytes: bodyBuffer.length, gzipBytes: gzipSync(bodyBuffer).length, appMs: timing?.app ?? null, ...d1Header(response.headers()) });
    }
    const of = (key, fraction = 0.5) => percentile(samples.map((sample) => sample[key]), fraction);
    results.push({
      name,
      method,
      firstRequestInitMs: firstTiming?.init ?? null,
      responseBytes: Math.max(...samples.map((sample) => sample.bytes)),
      gzipBytes: Math.max(...samples.map((sample) => sample.gzipBytes)),
      appMedianMs: of("appMs"),
      appP75Ms: of("appMs", 0.75),
      d1Statements: of("count"),
      d1Ms: of("ms"),
      d1RowsRead: of("rowsRead")
    });
  }
  const report = {
    task: "api-cost",
    fixture: FIXTURE,
    revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    samplesPerEndpoint: SAMPLES,
    notes: {
      gzipBytes: "gzip of the JSON body, an estimate of the compressed transfer size (the local Worker does not compress)",
      timing: "app is the handler (Server-Timing app) on local wrangler dev with a local SQLite D1, not production",
      d1: "statements, D1 time and rows read per request; null unless the Worker is wrapped by scripts/wrap-d1-counter.mjs"
    },
    results
  };
  const outputDirectory = process.env.PERFORMANCE_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "monies-map-performance-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${Date.now()}-apicost-${FIXTURE}.json`);
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`API cost report: ${outputFile}`);
  for (const row of results) {
    console.log(`APICOST ${JSON.stringify({ fixture: FIXTURE, ...row })}`);
  }
});
