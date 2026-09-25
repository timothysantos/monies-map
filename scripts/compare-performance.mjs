// Compares two directories of built-client performance reports (H10) and
// prints a Markdown table per project: medians/p95, bytes, request counts
// and deltas, with the plan's regression limits flagged (initial bytes
// +5%, timing medians/p95 +10%).
//
//   node scripts/compare-performance.mjs <baselineDir> <candidateDir> [--unwarmed <dir>]
//   node scripts/compare-performance.mjs --interaction <baselineDir> <candidateDir>
//
// With --unwarmed (a warmup-off cohort of the candidate build), it also
// reports how much idle warmup the first Summary → Entries → Summary round
// trip actually used.
//
// With --interaction it compares cohorts of Entries interaction reports
// (tests/performance/entries-interaction.spec.js). Every report in a
// directory is one run; samples are pooled per interaction, and the spread
// of the per-run medians shows whether a difference outgrows run-to-run
// noise.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const LIMITS = Object.freeze({ initialBytesPercent: 5, timingPercent: 10 });

function median(values) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return null;
  return finite[Math.ceil(finite.length / 2) - 1];
}

function sumBytes(byType) {
  const entries = Object.values(byType ?? {});
  if (entries.some((entry) => entry.bytes == null)) return null;
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

function sumCounts(byType) {
  return Object.values(byType ?? {}).reduce((sum, entry) => sum + entry.count, 0);
}

// The comparable numbers from one built-client report.
export function extractMetrics(report) {
  const samples = report.cold?.samples ?? [];
  const firstNavigation = report.warm?.primingRoundTrip?.[0] ?? null;
  const metrics = {
    coldMedianMs: report.cold?.medianMs ?? null,
    coldP95Ms: report.cold?.p95Ms ?? null,
    bytesBeforeUsable: median(samples.map((sample) => sumBytes(sample.requestsBeforeUsable))),
    jsFilesBeforeUsable: median(samples.map((sample) => sample.requestsBeforeUsable?.js?.count ?? 0)),
    jsBytesBeforeUsable: median(samples.map((sample) => sample.requestsBeforeUsable?.js?.bytes ?? null)),
    apiBeforeUsable: median(samples.map((sample) => sample.requestsBeforeUsable?.api?.count ?? 0)),
    firstEntriesNavigationMs: firstNavigation?.usableMs ?? null,
    firstEntriesNavigationRequests: firstNavigation ? (firstNavigation.items ?? firstNavigation.apiRequests ?? []).length : null,
    warmToEntriesMedianMs: report.warm?.summaryToEntries?.medianMs ?? null,
    warmToEntriesP95Ms: report.warm?.summaryToEntries?.p95Ms ?? null,
    warmToSummaryMedianMs: report.warm?.entriesToSummary?.medianMs ?? null,
    warmToSummaryP95Ms: report.warm?.entriesToSummary?.p95Ms ?? null
  };
  for (const checkpoint of ["2s", "10s", "30s"]) {
    const idle = report.idleAfterFirstColdLoad?.[checkpoint];
    metrics[`idleRequests${checkpoint}`] = idle ? sumCounts(idle.byType) : null;
    metrics[`idleBytes${checkpoint}`] = idle ? sumBytes(idle.byType) : null;
  }
  return metrics;
}

const ROWS = [
  ["Cold usable median (ms)", "coldMedianMs", "timing"],
  ["Cold usable p95 (ms)", "coldP95Ms", "timing"],
  ["Bytes before usable", "bytesBeforeUsable", "bytes"],
  ["JS files before usable", "jsFilesBeforeUsable", null],
  ["JS bytes before usable", "jsBytesBeforeUsable", "bytes"],
  ["API requests before usable", "apiBeforeUsable", null],
  ["First Summary → Entries (ms)", "firstEntriesNavigationMs", null],
  ["First Summary → Entries requests", "firstEntriesNavigationRequests", null],
  ["Warm Summary → Entries median (ms)", "warmToEntriesMedianMs", "timing"],
  ["Warm Summary → Entries p95 (ms)", "warmToEntriesP95Ms", "timing"],
  ["Warm Entries → Summary median (ms)", "warmToSummaryMedianMs", "timing"],
  ["Warm Entries → Summary p95 (ms)", "warmToSummaryP95Ms", "timing"],
  ["Idle requests by 2 s", "idleRequests2s", null],
  ["Idle bytes by 2 s", "idleBytes2s", null],
  ["Idle requests by 10 s", "idleRequests10s", null],
  ["Idle bytes by 10 s", "idleBytes10s", null],
  ["Idle requests by 30 s", "idleRequests30s", null],
  ["Idle bytes by 30 s", "idleBytes30s", null]
];

// Flags a regression beyond the plan's limit. Idle traffic and the first
// navigation are expected to change with warmup, so they are not limited.
export function regressionFlag(kind, baseline, candidate) {
  if (!kind || !Number.isFinite(baseline) || !Number.isFinite(candidate) || baseline <= 0) return "";
  const percent = ((candidate - baseline) / baseline) * 100;
  const limit = kind === "bytes" ? LIMITS.initialBytesPercent : LIMITS.timingPercent;
  return percent > limit ? `over +${limit}%` : "";
}

function formatNumber(value) {
  if (value == null) return "n/a";
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
}

function formatDelta(baseline, candidate) {
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) return "n/a";
  const delta = candidate - baseline;
  const sign = delta > 0 ? "+" : "";
  const percent = baseline === 0 ? "" : ` (${sign}${((delta / baseline) * 100).toFixed(1)}%)`;
  return `${sign}${formatNumber(Number.isInteger(delta) ? delta : Number(delta.toFixed(1)))}${percent}`;
}

export function compareMetrics(baseline, candidate) {
  return ROWS.map(([label, key, kind]) => ({
    label,
    baseline: baseline[key],
    candidate: candidate[key],
    delta: formatDelta(baseline[key], candidate[key]),
    flag: regressionFlag(kind, baseline[key], candidate[key])
  }));
}

// Idle warmup against what an unwarmed first round trip requests. A hit is
// an idle-fetched path the unwarmed round trip needed; the rest is
// completed-but-unused.
export function speculativeUse(candidateReport, unwarmedReport) {
  const idleItems = candidateReport.idleAfterFirstColdLoad?.["30s"]?.items ?? [];
  const needed = new Set((unwarmedReport.warm?.primingRoundTrip ?? []).flatMap((step) => (step.items ?? []).map((item) => item.path)));
  const hits = idleItems.filter((item) => needed.has(item.path));
  const unused = idleItems.filter((item) => !needed.has(item.path));
  const bytes = (items) => (items.some((item) => !Number.isFinite(item.bytes)) ? null : items.reduce((sum, item) => sum + item.bytes, 0));
  return {
    idleItems: idleItems.length,
    hits: hits.length,
    hitRate: idleItems.length ? hits.length / idleItems.length : null,
    hitPaths: hits.map((item) => item.path),
    unusedPaths: unused.map((item) => item.path),
    unusedBytes: bytes(unused)
  };
}

export function renderMarkdown(project, rows) {
  const lines = [
    `### ${project}`,
    "",
    "| Metric | Baseline | Candidate | Delta | Limit |",
    "| --- | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.label} | ${formatNumber(row.baseline)} | ${formatNumber(row.candidate)} | ${row.delta} | ${row.flag} |`)
  ];
  return lines.join("\n");
}

// Latest built-client report per project in a directory.
export async function readReports(directory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const byProject = new Map();
  for (const file of files) {
    const report = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    if (report.cold && report.project) byProject.set(report.project, report);
  }
  return byProject;
}

const INTERACTION_TASK = "entries-interaction";

// Every interaction report per project in a directory (one per run).
export async function readInteractionReports(directory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const byProject = new Map();
  for (const file of files) {
    const report = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    if (report.task !== INTERACTION_TASK || !report.project || !report.actions) continue;
    byProject.set(report.project, [...(byProject.get(report.project) ?? []), report]);
  }
  return byProject;
}

// Pooled median and p95 per interaction, the min–max of per-run medians,
// and the median row renders of the counted pass.
export function summarizeInteractionCohort(reports) {
  const names = [...new Set(reports.flatMap((report) => Object.keys(report.actions)))];
  return Object.fromEntries(names.map((name) => {
    const runs = reports.map((report) => report.actions[name]).filter(Boolean);
    const settled = runs.flatMap((run) => run.rawSettledMs ?? []);
    const event = runs.flatMap((run) => run.rawEventMs ?? []);
    const runMedians = runs.map((run) => median(run.rawSettledMs ?? [])).filter(Number.isFinite);
    const rowRenders = reports.map((report) => report.renders?.[name]?.entryRowRenders);
    return [name, {
      runs: runs.length,
      samples: settled.length,
      settledMedianMs: median(settled),
      settledP95Ms: percentileOf(settled, 0.95),
      runMedianMinMs: runMedians.length ? Math.min(...runMedians) : null,
      runMedianMaxMs: runMedians.length ? Math.max(...runMedians) : null,
      eventMedianMs: median(event),
      eventP95Ms: percentileOf(event, 0.95),
      entryRowRenders: median(rowRenders)
    }];
  }));
}

function percentileOf(values, fraction) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return null;
  return finite[Math.max(1, Math.ceil(fraction * finite.length)) - 1];
}

// The candidate is only called faster or slower when its per-run medians do
// not overlap the baseline's; otherwise the difference is within noise.
export function interactionVerdict(baseline, candidate) {
  if (![baseline.runMedianMinMs, baseline.runMedianMaxMs, candidate.runMedianMinMs, candidate.runMedianMaxMs].every(Number.isFinite)) return "n/a";
  if (candidate.runMedianMaxMs < baseline.runMedianMinMs) return "faster";
  if (candidate.runMedianMinMs > baseline.runMedianMaxMs) return "slower";
  return "within noise";
}

export function renderInteractionMarkdown(project, baseline, candidate) {
  const spread = (item) => (Number.isFinite(item?.runMedianMinMs) ? `${formatNumber(item.runMedianMinMs)}–${formatNumber(item.runMedianMaxMs)}` : "n/a");
  const names = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])];
  return [
    `### ${project}`,
    "",
    `Runs: baseline ${Math.max(0, ...Object.values(baseline).map((item) => item.runs))}, candidate ${Math.max(0, ...Object.values(candidate).map((item) => item.runs))}. Times in ms from the first input to the settled frame; event is the longest Event Timing entry (0 = under 16 ms).`,
    "",
    "| Interaction | Settled median | Δ | Settled p95 | Run medians (spread) | Event median | Row renders | Verdict |",
    "| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |",
    ...names.map((name) => {
      const before = baseline[name] ?? {};
      const after = candidate[name] ?? {};
      return `| ${name} | ${formatNumber(before.settledMedianMs)} → ${formatNumber(after.settledMedianMs)} | ${formatDelta(before.settledMedianMs, after.settledMedianMs)} | ${formatNumber(before.settledP95Ms)} → ${formatNumber(after.settledP95Ms)} | ${spread(before)} → ${spread(after)} | ${formatNumber(before.eventMedianMs)} → ${formatNumber(after.eventMedianMs)} | ${formatNumber(before.entryRowRenders)} → ${formatNumber(after.entryRowRenders)} | ${interactionVerdict(before, after)} |`;
    })
  ].join("\n");
}

async function mainInteraction(baselineDir, candidateDir) {
  const [baseline, candidate] = await Promise.all([readInteractionReports(baselineDir), readInteractionReports(candidateDir)]);
  const output = [];
  for (const [project, candidateReports] of candidate) {
    const baselineReports = baseline.get(project);
    if (!baselineReports) {
      output.push(`### ${project}\n\nNo baseline interaction reports for this project.`);
      continue;
    }
    output.push(renderInteractionMarkdown(project, summarizeInteractionCohort(baselineReports), summarizeInteractionCohort(candidateReports)));
  }
  console.log(output.join("\n\n"));
}

async function main(argv) {
  if (argv[0] === "--interaction") {
    if (!argv[1] || !argv[2]) throw new Error("Usage: node scripts/compare-performance.mjs --interaction <baselineDir> <candidateDir>");
    return mainInteraction(argv[1], argv[2]);
  }
  const [baselineDir, candidateDir, flag, unwarmedDir] = argv;
  if (!baselineDir || !candidateDir || (flag && flag !== "--unwarmed")) {
    throw new Error("Usage: node scripts/compare-performance.mjs <baselineDir> <candidateDir> [--unwarmed <dir>]");
  }
  const [baseline, candidate, unwarmed] = await Promise.all([
    readReports(baselineDir),
    readReports(candidateDir),
    unwarmedDir ? readReports(unwarmedDir) : Promise.resolve(new Map())
  ]);
  const output = [];
  for (const [project, candidateReport] of candidate) {
    const baselineReport = baseline.get(project);
    if (!baselineReport) {
      output.push(`### ${project}\n\nNo baseline report for this project.`);
      continue;
    }
    output.push(renderMarkdown(project, compareMetrics(extractMetrics(baselineReport), extractMetrics(candidateReport))));
    const unwarmedReport = unwarmed.get(project);
    if (unwarmedReport) {
      const use = speculativeUse(candidateReport, unwarmedReport);
      output.push(`\nIdle warmup use: ${use.hits}/${use.idleItems} idle requests needed by the first round trip (hit rate ${use.hitRate == null ? "n/a" : `${Math.round(use.hitRate * 100)}%`}); completed-but-unused ${formatNumber(use.unusedBytes)} bytes (${use.unusedPaths.join(", ") || "none"}).`);
    }
  }
  console.log(output.join("\n\n"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
