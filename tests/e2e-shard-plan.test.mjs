import assert from "node:assert/strict";
import test from "node:test";

import { planShards, unitSeconds, unitsFromPlaywrightList, weightsFromJsonReport } from "../scripts/e2e-shard-plan.mjs";
import { smokeBatches, smokeWorkflows } from "../scripts/e2e-smoke-workflows.mjs";

const weights = {
  files: {
    "import.spec.js": { seconds: 300, tests: 10 },
    "month.spec.js": { seconds: 120, tests: 12 },
    "entries.spec.js": { seconds: 90, tests: 9 },
    "splits.spec.js": { seconds: 60, tests: 6 },
    "faq.spec.js": { seconds: 4, tests: 1 }
  }
};

const units = [
  { id: "entries.spec.js", tests: 9 },
  { id: "faq.spec.js", tests: 1 },
  { id: "import.spec.js", tests: 10 },
  { id: "month.spec.js", tests: 12 },
  { id: "splits.spec.js", tests: 6 }
];

test("every file lands on exactly one shard, longest first on the lightest shard", () => {
  const plan = planShards(units, 2, weights);
  assert.deepEqual(
    plan.map((shard) => ({ index: shard.index, ids: shard.units.map((unit) => unit.id), tests: shard.tests, seconds: shard.seconds })),
    [
      // Import (300 s) alone outweighs the rest, so it gets a shard to itself.
      { index: 1, ids: ["import.spec.js"], tests: 10, seconds: 300 },
      // Kept in input (serial) order inside the shard.
      { index: 2, ids: ["entries.spec.js", "faq.spec.js", "month.spec.js", "splits.spec.js"], tests: 28, seconds: 274 }
    ]
  );
  const placed = plan.flatMap((shard) => shard.units.map((unit) => unit.id)).sort();
  assert.deepEqual(placed, units.map((unit) => unit.id).sort());
});

test("the plan is deterministic and a single shard runs everything in serial order", () => {
  assert.deepEqual(planShards(units, 3, weights), planShards(units, 3, weights));
  const [only] = planShards(units, 1, weights);
  assert.deepEqual(only.units.map((unit) => unit.id), units.map((unit) => unit.id));
  assert.equal(only.tests, 38);
});

test("an unmeasured file is weighed by its test count at the median seconds per test", () => {
  // Per-test medians: 30, 10, 10, 10, 4 -> median 10 s per test.
  assert.equal(unitSeconds({ id: "new.spec.js", tests: 3 }, weights), 30);
  // A smoke batch that runs part of a measured file takes its share.
  assert.equal(unitSeconds({ id: "month (1/2)", file: "month.spec.js", tests: 6 }, weights), 60);
  // With no weights at all, every test counts one second.
  assert.equal(unitSeconds({ id: "new.spec.js", tests: 3 }, { files: {} }), 3);
  const plan = planShards([...units, { id: "new.spec.js", tests: 3 }], 4, weights);
  assert.equal(plan.flatMap((shard) => shard.units).filter((unit) => unit.id === "new.spec.js").length, 1);
});

test("more shards than files leaves the extra shards empty rather than failing", () => {
  const plan = planShards(units.slice(0, 2), 4, weights);
  assert.deepEqual(plan.map((shard) => shard.units.length), [1, 1, 0, 0]);
});

test("invalid shard counts and duplicate units are rejected", () => {
  assert.throws(() => planShards(units, 0, weights), /positive integer/);
  assert.throws(() => planShards(units, 1.5, weights), /positive integer/);
  assert.throws(() => planShards([...units, { id: "faq.spec.js", tests: 1 }], 2, weights), /Duplicate shard unit faq\.spec\.js/);
});

test("spec files and test counts come from the Playwright --list JSON, including nested describes", () => {
  const listReport = {
    suites: [
      {
        file: "a.spec.js",
        specs: [{ file: "a.spec.js", line: 3, tests: [{}] }],
        suites: [{ title: "group", specs: [{ file: "a.spec.js", line: 9, tests: [{}, {}] }], suites: [] }]
      },
      { file: "b.spec.js", specs: [{ file: "b.spec.js", line: 2, tests: [{}] }] }
    ]
  };
  assert.deepEqual(unitsFromPlaywrightList(listReport), [
    { id: "a.spec.js", file: "a.spec.js", tests: 3 },
    { id: "b.spec.js", file: "b.spec.js", tests: 1 }
  ]);
});

test("weights are rebuilt from a finished JSON report using each test's final result", () => {
  const report = {
    suites: [
      {
        file: "a.spec.js",
        specs: [
          { file: "a.spec.js", tests: [{ results: [{ duration: 1_000 }, { duration: 2_500 }] }] },
          { file: "a.spec.js", tests: [{ results: [{ duration: 1_540 }] }] }
        ],
        suites: []
      }
    ]
  };
  assert.deepEqual(weightsFromJsonReport(report), { files: { "a.spec.js": { seconds: 4, tests: 2 } } });
});

test("smoke batches keep the serial smoke order and split Month into six-test processes", () => {
  const monthSource = Array.from({ length: 13 }, (_, i) => `test("month ${i}", async () => {});`).join("\n");
  const batches = smokeBatches(smokeWorkflows, () => monthSource);
  assert.equal(batches[0].label, "import inbox navigation");
  const month = batches.filter((batch) => batch.file === "tests/e2e/month-page.spec.js");
  assert.deepEqual(month.map((batch) => batch.label), ["month (1/3)", "month (2/3)", "month (3/3)"]);
  assert.deepEqual(month.map((batch) => batch.targets.length), [6, 6, 1]);
  assert.equal(month[2].targets[0], "tests/e2e/month-page.spec.js:13");
  assert.equal(batches.length, smokeWorkflows.length - 1 + 3);
});
