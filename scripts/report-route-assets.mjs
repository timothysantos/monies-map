import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { WARMUP_COSTS_BLOCK_PATTERN, createRouteAssetReport, getHtmlStylesheetAssets, parseWarmupCosts } from "./route-asset-report.mjs";

// Builds may run without git (for example a packaged deploy); unknown is fine.
function currentRevision() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

export async function createBuildAssetReport({ dist = "dist", revision = "unknown" } = {}) {
  const absoluteDist = path.resolve(dist);
  const manifest = JSON.parse(await readFile(path.join(absoluteDist, ".vite", "manifest.json"), "utf8"));
  const html = await readFile(path.join(absoluteDist, "index.html"));
  const readAsset = (file) => {
    try {
      return readFileSync(path.join(absoluteDist, file));
    } catch {
      return null;
    }
  };
  const report = createRouteAssetReport(manifest, readAsset, { htmlAssets: getHtmlStylesheetAssets(html.toString("utf8")) });
  const htmlText = html.toString("utf8");
  const blockMatch = [...htmlText.matchAll(WARMUP_COSTS_BLOCK_PATTERN)][0] ?? null;
  const beforeHtml = Buffer.from(htmlText.replace(WARMUP_COSTS_BLOCK_PATTERN, ""));
  const metadata = blockMatch ? parseWarmupCosts(blockMatch[1]) : null;
  report.revision = revision;
  report.buildId = metadata?.buildId ?? null;
  report.html = {
    warmupMetadataBytes: blockMatch ? Buffer.byteLength(blockMatch[0]) : null,
    gzipDeltaBytes: blockMatch ? gzipSync(html).byteLength - gzipSync(beforeHtml).byteLength : null,
    metadataValid: Boolean(metadata),
    missingReason: blockMatch ? (metadata ? null : "embedded metadata is malformed or unsupported") : "built HTML has no warmup metadata block"
  };
  return report;
}

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  const revision = currentRevision();
  const report = await createBuildAssetReport({ revision });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outPath) await writeFile(path.resolve(outPath), text);
  else process.stdout.write(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}
