import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { summarizeSamples } from "./performance-stats.mjs";

// Shared pieces of the interaction specs (entries-interaction.spec.js,
// month-interaction.spec.js). Both record and never assert timing.
//
// Per interaction:
// - settledMs: first trusted input event to the first animation frame whose
//   DOM shows the interaction's end state (includes any deferred render).
// - eventMs: the longest Event Timing entry of that input (what INP reads:
//   input delay + handlers + next paint). Entries under the browser's 16 ms
//   floor are not reported, so they count as 0.
// With count set, tests/support/react-commit-counter.js counts React commits
// and row renders for that input only; timing samples leave it off.

// CPU presets match built-client.spec.js. Interactions run on warm data, so
// network emulation is not applied.
export const INTERACTION_PROFILES = {
  desktop: { label: "desktop: CPU 1x", cpuRate: 1 },
  mobile: { label: "mobile: CPU 4x", cpuRate: 4 }
};

// Event Timing entries are delivered after the next paint; give them a beat.
const EVENT_FLUSH_MS = 150;
const SETTLE_TIMEOUT_MS = 20_000;

export function contextOptions(use) {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = use;
  return { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };
}

// Page init script (serialized by Playwright; keep it self-contained).
export function installInteractionProbe() {
  const probe = { firstInputAt: null, events: [] };
  window.__interactionProbe = probe;
  const markInput = (event) => {
    if (event.isTrusted && probe.firstInputAt == null) probe.firstInputAt = event.timeStamp;
  };
  for (const type of ["pointerdown", "mousedown", "keydown", "touchstart"]) {
    window.addEventListener(type, markInput, { capture: true, passive: true });
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.events.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration, interactionId: entry.interactionId ?? 0 });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: false });
    probe.eventTimingSupported = true;
  } catch {
    probe.eventTimingSupported = false;
  }
}

// act() dispatches real input through Playwright; the in-page predicate is
// polled once per animation frame and returns that frame's performance.now()
// when the end state is visible.
export async function measureInteraction(page, act, predicate, arg, { count = false } = {}) {
  await page.evaluate(() => {
    window.__interactionProbe.firstInputAt = null;
    window.__interactionProbe.events = [];
  });
  if (count) await page.evaluate(() => { window.__reactCommitCounter.reset(); window.__reactCommitCounter.enabled = true; });
  await act();
  const handle = await page.waitForFunction(predicate, arg, { polling: "raf", timeout: SETTLE_TIMEOUT_MS });
  const settledAt = await handle.jsonValue();
  await page.waitForTimeout(EVENT_FLUSH_MS);
  const result = await page.evaluate((settled) => {
    const { firstInputAt, events } = window.__interactionProbe;
    const related = events.filter((entry) => firstInputAt != null && entry.startTime >= firstInputAt - 1);
    return {
      settledMs: firstInputAt == null ? null : settled - firstInputAt,
      eventMs: related.reduce((max, entry) => Math.max(max, entry.duration), 0),
      events: related.map((entry) => `${entry.name}:${entry.duration}`)
    };
  }, settledAt);
  if (count) {
    result.renders = await page.evaluate(() => {
      window.__reactCommitCounter.enabled = false;
      return window.__reactCommitCounter.read();
    });
  }
  return result;
}

export function summarizeInteractions(timings) {
  return Object.fromEntries(Object.entries(timings).map(([name, samples]) => [name, {
    settled: summarizeSamples(samples.map((item) => item.settledMs)),
    event: summarizeSamples(samples.map((item) => item.eventMs)),
    rawSettledMs: samples.map((item) => item.settledMs),
    rawEventMs: samples.map((item) => item.eventMs)
  }]));
}

export function gitRevision() {
  return {
    revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0
  };
}

export async function writeInteractionReport(report, label) {
  const outputDirectory = process.env.PERFORMANCE_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "monies-map-performance-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${Date.now()}-${label}-${report.project}.json`);
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Performance report: ${outputFile}`);
  console.log(JSON.stringify({
    task: report.task,
    project: report.project,
    settledMedianMs: Object.fromEntries(Object.entries(report.actions).map(([name, value]) => [name, value.settled.medianMs])),
    eventMedianMs: Object.fromEntries(Object.entries(report.actions).map(([name, value]) => [name, value.event.medianMs])),
    renders: report.renders
  }));
}
