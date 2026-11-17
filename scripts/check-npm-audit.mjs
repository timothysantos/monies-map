// The merge gate's dependency audit (`npm run audit`, first step of `npm run verify`).
// Fails on any high or critical advisory, except the few listed in
// scripts/npm-audit-allowlist.json. The allowlist is narrow on purpose:
//   - production dependencies (`npm audit --omit=dev`) get no allowlist at all;
//   - an entry whose advisory now has a non-breaking fix fails, so it gets removed;
//   - an entry past its review-by date fails, so it gets looked at again.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BLOCKING = new Set(["high", "critical"]);

function advisoryId(via) {
  return typeof via.url === "string" ? via.url.split("/").pop() : String(via.source);
}

// Every high/critical advisory in an `npm audit --json` report, with the package
// that owns it and whether a non-breaking fix exists for that package.
export function collectAdvisories(report) {
  const found = new Map();
  for (const [name, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === "string" || !BLOCKING.has(via.severity)) continue;
      const fix = vulnerability.fixAvailable;
      found.set(advisoryId(via), {
        id: advisoryId(via),
        package: via.name ?? name,
        title: via.title ?? "",
        severity: via.severity,
        // `true`, or a fix that is not a major-version change, counts as available.
        fixAvailable: Boolean(fix) && !(typeof fix === "object" && fix.isSemVerMajor),
      });
    }
  }
  return [...found.values()];
}

// Pure decision: { ok, failures, allowed }. `today` is an ISO date (YYYY-MM-DD).
export function decideAudit({ fullReport, productionReport, allowlist, today }) {
  const failures = [];
  const allowed = [];
  const entries = new Map((allowlist?.entries ?? []).map((entry) => [entry.id, entry]));

  for (const advisory of collectAdvisories(productionReport)) {
    failures.push(`${advisory.id} (${advisory.package}, ${advisory.severity}) reaches a production dependency; production has no allowlist: ${advisory.title}`);
  }
  const productionIds = new Set(collectAdvisories(productionReport).map((advisory) => advisory.id));

  for (const advisory of collectAdvisories(fullReport)) {
    if (productionIds.has(advisory.id)) continue;
    const entry = entries.get(advisory.id);
    const label = `${advisory.id} (${advisory.package}, ${advisory.severity}): ${advisory.title}`;
    if (!entry) {
      failures.push(`${label} is not on the allowlist`);
    } else if (advisory.fixAvailable) {
      failures.push(`${label} now has a fix available: apply it and remove the allowlist entry`);
    } else if (!(today <= entry.reviewBy)) {
      failures.push(`${label} passed its review-by date ${entry.reviewBy}: fix it or re-review and extend the entry`);
    } else {
      allowed.push({ ...advisory, reason: entry.reason, added: entry.added, reviewBy: entry.reviewBy });
    }
  }
  return { ok: failures.length === 0, failures, allowed };
}

// npm can print notices after the JSON (and exits non-zero when it finds anything).
function runAudit(args) {
  let output;
  try {
    output = execFileSync("npm", ["audit", "--json", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    output = error.stdout?.toString() ?? "";
  }
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`npm audit ${args.join(" ")} returned no JSON`);
  const report = JSON.parse(output.slice(start, end + 1));
  if (report.error) throw new Error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const allowlist = JSON.parse(readFileSync(new URL("./npm-audit-allowlist.json", import.meta.url), "utf8"));
  const decision = decideAudit({
    fullReport: runAudit([]),
    productionReport: runAudit(["--omit=dev"]),
    allowlist,
    today: new Date().toISOString().slice(0, 10),
  });
  for (const item of decision.allowed) {
    console.log(`npm audit: ALLOWED ${item.id} (${item.package}, ${item.severity}): ${item.reason} [added ${item.added}, review by ${item.reviewBy}]`);
  }
  for (const failure of decision.failures) console.error(`npm audit: FAIL ${failure}`);
  console.log(decision.ok ? "npm audit: ok (production clean; only the allowlisted advisories above, if any, were tolerated)" : "npm audit: failed");
  process.exit(decision.ok ? 0 : 1);
}
