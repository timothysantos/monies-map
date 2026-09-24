// Loads a scale fixture into the performance harness's isolated test Worker
// after the demo reseed (H01b). Bulk rows go in as one generated SQL file
// with the demo reseed's transaction columns; one direct expense per month
// goes through the Worker's create API so the app recalculates that month's
// snapshots. The load is then proven through /api/entries-page.
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  SCALE_FIXTURE_DESCRIPTION_PREFIX,
  SCALE_FIXTURE_SIZES,
  anchorCreateBody,
  buildScaleFixtureSql,
  createScaleFixture,
  validateScaleFixture
} from "../tests/performance/fixtures/scale-fixture.mjs";

// Months whose entries-page counts and totals prove the load: the first,
// one shared with the demo seed, and the large month.
export const VALIDATION_MONTHS = Object.freeze(["2024-06", "2025-10", "2026-05"]);

export function readFixtureName(value) {
  const name = value || "demo";
  if (name !== "demo" && !(name in SCALE_FIXTURE_SIZES)) {
    throw new Error(`PERFORMANCE_FIXTURE must be demo, ${Object.keys(SCALE_FIXTURE_SIZES).join(" or ")}; got ${value}.`);
  }
  return name;
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) throw new Error(`${pathname} failed (${response.status}): ${await response.text()}`);
  return response.json();
}

// What the fixture rows contribute to one month, read back from the app.
async function readFixtureMonth(baseUrl, month) {
  const payload = await getJson(baseUrl, `/api/entries-page?view=household&month=${month}`);
  const rows = payload.monthPage.entries.filter((entry) => entry.description.startsWith(SCALE_FIXTURE_DESCRIPTION_PREFIX));
  return {
    count: rows.length,
    expenseTotalMinor: rows.filter((entry) => entry.entryType === "expense").reduce((sum, entry) => sum + entry.amountMinor, 0)
  };
}

export async function loadScaleFixture({ baseUrl, fixtureName, seedMonth, workDir, runSqlFile, log = console.log }) {
  const rowCount = SCALE_FIXTURE_SIZES[fixtureName];
  const [reference, shell] = await Promise.all([
    getJson(baseUrl, "/api/reference-data"),
    getJson(baseUrl, `/api/app-shell?view=household&month=${seedMonth}&scope=direct_plus_shared`)
  ]);
  const fixture = createScaleFixture(rowCount, {
    people: shell.household.people,
    accounts: reference.accounts,
    categories: reference.categories
  });
  if (!validateScaleFixture(fixture)) throw new Error(`Generated ${fixtureName} fixture failed validation.`);

  for (const month of VALIDATION_MONTHS) {
    const before = await readFixtureMonth(baseUrl, month);
    if (before.count !== 0) throw new Error(`Fixture rows already exist in ${month}; refusing to load twice.`);
  }

  const startedAt = Date.now();
  const sqlPath = path.join(workDir, `${fixtureName}.sql`);
  await writeFile(sqlPath, buildScaleFixtureSql(fixture, shell.household.id));
  const sqlError = runSqlFile(sqlPath, `${fixtureName} rows`);
  if (sqlError) throw new Error(sqlError);

  for (const row of fixture.rows.filter((item) => item.anchor)) {
    const response = await fetch(`${baseUrl}/api/entries/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(anchorCreateBody(row))
    });
    const body = response.ok ? await response.json() : null;
    if (!body?.ok || !body.created) {
      throw new Error(`Anchor entry for ${row.month} was not created (${response.status}).`);
    }
  }

  const validation = {};
  for (const month of VALIDATION_MONTHS) {
    const actual = await readFixtureMonth(baseUrl, month);
    const expected = { count: fixture.expected.monthCounts[month], expenseTotalMinor: fixture.expected.monthTotals[month] };
    if (actual.count !== expected.count || actual.expenseTotalMinor !== expected.expenseTotalMinor) {
      throw new Error(`${fixtureName} ${month}: expected ${JSON.stringify(expected)}, the app shows ${JSON.stringify(actual)}.`);
    }
    validation[month] = actual;
  }
  const summary = { fixture: fixtureName, rowCount: fixture.expected.rowCount, loadMs: Date.now() - startedAt, validation };
  log(`PERFORMANCE_FIXTURE_LOADED ${JSON.stringify(summary)}`);
  return summary;
}
