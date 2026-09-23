import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WARMUP_COSTS_BLOCK_PATTERN, buildWarmupCosts, getHtmlStylesheetAssets } from "./route-asset-report.mjs";

// Builds may run without git (for example a packaged deploy); unknown is fine.
function currentRevision() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

const dist = path.resolve("dist");
const manifestPath = path.join(dist, ".vite", "manifest.json");
const indexPath = path.join(dist, "index.html");

export function renderWarmupCostsBlock(metadata) {
  const json = JSON.stringify(metadata).replace(/</g, "\\u003c");
  return `<script id="monies-warmup-costs" type="application/json">${json}</script>`;
}

export function replaceWarmupCostsBlock(html, metadata) {
  const block = renderWarmupCostsBlock(metadata);
  const withoutExistingBlocks = html.replace(WARMUP_COSTS_BLOCK_PATTERN, "");
  if (!/<\/head\s*>/i.test(withoutExistingBlocks)) throw new Error("Built HTML is missing </head>; warmup metadata was not written.");
  return withoutExistingBlocks.replace(/<\/head\s*>/i, `${block}</head>`);
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const html = await readFile(indexPath, "utf8");
  const metadata = buildWarmupCosts(
    manifest,
    (file) => {
      try {
        return readFileSync(path.join(dist, file));
      } catch {
        return null;
      }
    },
    {
      revision: currentRevision(),
      htmlAssets: getHtmlStylesheetAssets(html)
    }
  );
  await writeFile(indexPath, replaceWarmupCostsBlock(html, metadata));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}
