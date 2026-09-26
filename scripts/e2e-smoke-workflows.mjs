// The smoke bundle: the core desktop and mobile workflows, shared by the
// serial smoke runner (scripts/run-e2e-smoke.mjs) and the sharded runner
// (scripts/run-e2e-sharded.mjs --smoke). Each batch runs in its own
// Playwright process; the Month spec is split into batches of six tests.
import { readFileSync } from "node:fs";

export const smokeWorkflows = [
  {
    name: "import inbox navigation",
    file: "tests/e2e/import-inbox-navigation.spec.js"
  },
  {
    name: "month",
    file: "tests/e2e/month-page.spec.js",
    maxTestsPerProcess: 6
  },
  {
    name: "entry deletion",
    file: "tests/e2e/entries-delete-entry.spec.js"
  },
  {
    name: "entry category filter",
    file: "tests/e2e/entries-category-filter.spec.js"
  },
  {
    name: "entry transfer dialog",
    file: "tests/e2e/entries-transfer-dialog.spec.js"
  },
  {
    name: "add entries to splits",
    file: "tests/e2e/entries-add-to-splits.spec.js"
  },
  {
    name: "API performance",
    file: "tests/e2e/api-performance.spec.js"
  },
  {
    name: "FAQ",
    file: "tests/e2e/faq-content.spec.js"
  },
  {
    name: "summary",
    file: "tests/e2e/summary-workflow.spec.js"
  },
  {
    name: "mobile continuity",
    file: "tests/e2e/mobile-continuity.spec.js"
  },
  {
    name: "money field editability",
    file: "tests/e2e/money-field-editability.spec.js"
  },
  {
    name: "settings reference data",
    file: "tests/e2e/settings-reference-data.spec.js"
  },
  {
    name: "import ledger",
    file: "tests/e2e/import-ledger-flow.spec.js"
  }
];

/**
 * Expands the workflows into Playwright process batches:
 * `{ label, file, targets }`, where `targets` are CLI test locations and
 * `file` is the spec the batch belongs to.
 */
export function smokeBatches(workflows = smokeWorkflows, readSource = (file) => readFileSync(file, "utf8")) {
  return workflows.flatMap((workflow) => {
    if (!workflow.maxTestsPerProcess) {
      return [{ label: workflow.name, file: workflow.file, targets: [workflow.file] }];
    }
    const source = readSource(workflow.file);
    const testLines = [...source.matchAll(/^[\t ]*test\(/gm)].map(
      (match) => source.slice(0, match.index).split("\n").length
    );
    const batchCount = Math.ceil(testLines.length / workflow.maxTestsPerProcess);
    return Array.from({ length: batchCount }, (_, batchIndex) => ({
      label: batchCount > 1 ? `${workflow.name} (${batchIndex + 1}/${batchCount})` : workflow.name,
      file: workflow.file,
      targets: testLines
        .slice(batchIndex * workflow.maxTestsPerProcess, (batchIndex + 1) * workflow.maxTestsPerProcess)
        .map((line) => `${workflow.file}:${line}`)
    }));
  });
}
