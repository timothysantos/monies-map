// Splits browser test work across N isolated stacks.
//
// A unit is a whole spec file (or, for the smoke bundle, one Playwright
// process batch). Units never split: every test in a file runs on the same
// shard, in file order, against the same database, exactly as in a serial
// run. Units are placed longest first on the least-loaded shard, using the
// measured seconds in tests/e2e/shard-weights.json. A unit without a
// measurement is weighed by its test count times the median seconds per test,
// so a new spec is still planned; it just balances less precisely until the
// weights are refreshed (`npm run test:e2e:sharded -- --update-weights`).

/**
 * @typedef {{ id: string, tests: number, file?: string }} ShardUnit
 * @typedef {{ files: Record<string, { seconds: number, tests: number }> }} ShardWeights
 */

// Measured on a 10-core M1 Pro (docs/audits/e2e-sharding.md): three shards
// run the full suite in about the time four do, at lower peak CPU load, so
// timing-sensitive tests keep more headroom. The smoke bundle is bounded by
// the import ledger spec alone, so two shards are as fast as four.
export const DEFAULT_SHARD_COUNT = 3;
export const DEFAULT_SMOKE_SHARD_COUNT = 2;

function medianSecondsPerTest(weights) {
  const perTest = Object.values(weights?.files ?? {})
    .filter((entry) => entry.tests > 0 && entry.seconds > 0)
    .map((entry) => entry.seconds / entry.tests)
    .sort((a, b) => a - b);
  if (!perTest.length) return 1;
  const middle = Math.floor(perTest.length / 2);
  return perTest.length % 2 ? perTest[middle] : (perTest[middle - 1] + perTest[middle]) / 2;
}

/**
 * Estimated seconds for one unit. A unit that is part of a file (a smoke
 * batch) takes its share of the file's measured time.
 */
export function unitSeconds(unit, weights) {
  const measured = weights?.files?.[unit.file ?? unit.id];
  if (measured && measured.seconds > 0 && measured.tests > 0) {
    return (measured.seconds * unit.tests) / measured.tests;
  }
  return unit.tests * medianSecondsPerTest(weights);
}

/**
 * Places units on `shardCount` shards, longest first onto the lightest shard.
 * Deterministic for the same input. Units keep their input order inside a
 * shard, so a shard runs its files in the same relative order as a serial run.
 *
 * @param {ShardUnit[]} units
 * @param {number} shardCount
 * @param {ShardWeights} [weights]
 * @returns {{ index: number, units: ShardUnit[], tests: number, seconds: number }[]}
 */
export function planShards(units, shardCount, weights) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`Shard count must be a positive integer, got ${shardCount}.`);
  }
  const ids = new Set();
  for (const unit of units) {
    if (ids.has(unit.id)) throw new Error(`Duplicate shard unit ${unit.id}.`);
    ids.add(unit.id);
  }
  const shards = Array.from({ length: shardCount }, (_, i) => ({ index: i + 1, units: [], tests: 0, seconds: 0 }));
  const order = new Map(units.map((unit, position) => [unit.id, position]));
  const bySize = units
    .filter((unit) => unit.tests > 0)
    .map((unit) => ({ unit, seconds: unitSeconds(unit, weights) }))
    .sort((a, b) => b.seconds - a.seconds || order.get(a.unit.id) - order.get(b.unit.id));
  for (const { unit, seconds } of bySize) {
    const lightest = shards.reduce((best, shard) => (shard.seconds < best.seconds ? shard : best));
    lightest.units.push(unit);
    lightest.tests += unit.tests;
    lightest.seconds += seconds;
  }
  for (const shard of shards) {
    shard.units.sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  return shards;
}

/**
 * Reads spec files and their test counts from `playwright test --list
 * --reporter=json` output. File paths are relative to the Playwright
 * testDir, as Playwright reports them.
 */
export function unitsFromPlaywrightList(listReport) {
  const countTests = (suite) =>
    (suite.specs ?? []).reduce((total, spec) => total + spec.tests.length, 0) +
    (suite.suites ?? []).reduce((total, child) => total + countTests(child), 0);
  return (listReport.suites ?? []).map((suite) => ({ id: suite.file, file: suite.file, tests: countTests(suite) }));
}

/**
 * Builds a weights file from a JSON report of a finished run: per spec file,
 * the summed duration of its tests' final results, in seconds.
 */
export function weightsFromJsonReport(report) {
  const files = {};
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const entry = (files[spec.file] ??= { seconds: 0, tests: 0 });
      for (const test of spec.tests) {
        entry.tests += 1;
        const last = test.results?.at(-1);
        entry.seconds += (last?.duration ?? 0) / 1000;
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  const rounded = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((file) => [file, { seconds: Math.round(files[file].seconds * 10) / 10, tests: files[file].tests }])
  );
  return { files: rounded };
}
