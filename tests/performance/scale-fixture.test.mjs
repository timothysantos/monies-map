import assert from "node:assert/strict";
import test from "node:test";

import { readFixtureName } from "../../scripts/load-performance-fixture.mjs";
import {
  anchorCreateBody,
  buildScaleFixtureSql,
  createScaleFixture,
  resolveFixtureReferences,
  validateScaleFixture
} from "./fixtures/scale-fixture.mjs";

// The seeded demo's reference shape (ids and names as /api/reference-data and
// /api/app-shell return them). The loader reads the live values instead.
const REFERENCE = {
  people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
  accounts: [
    { id: "acct-citi-rewards", name: "Citi Rewards", ownerPersonId: "person-joyce", isJoint: false, isActive: true },
    { id: "acct-household", name: "Household Float", ownerPersonId: null, isJoint: true, isActive: true },
    { id: "acct-uob-one", name: "UOB One", ownerPersonId: "person-tim", isJoint: false, isActive: true }
  ],
  categories: [
    { id: "cat-transfer", name: "Transfer" },
    { id: "cat-groceries", name: "Groceries" },
    { id: "cat-public-transport", name: "Public Transport" }
  ]
};

test("deterministic scale fixtures validate counts, totals, ownership, anchors and transfer pairing", () => {
  const ordinary = createScaleFixture(1_000, REFERENCE);
  const stress = createScaleFixture(10_000, REFERENCE);
  assert.equal(validateScaleFixture(ordinary), true);
  assert.equal(validateScaleFixture(stress), true);
  assert.equal(ordinary.expected.rowCount, 1_000);
  assert.equal(ordinary.expected.monthCount, 24);
  assert.equal(ordinary.expected.largeMonthCount, 41);
  assert.equal(ordinary.expected.anchorCount, 24);
  assert.equal(stress.expected.rowCount, 10_000);
  assert.equal(stress.expected.largeMonthCount, 2_000);
  assert.equal(stress.expected.monthCounts["2026-05"], 2_000);
  assert.equal(stress.expected.transferPairCount, 100);
  assert.equal(stress.expected.transferPairsValid, true);
  assert.equal(stress.rows.filter((row) => row.bankCertificationStatus !== "provisional").length, 0);
  assert.equal(createScaleFixture(10_000, REFERENCE).expected.expenseTotalMinor, stress.expected.expenseTotalMinor);

  const invalid = { ...stress, expected: { ...stress.expected, expenseTotalMinor: stress.expected.expenseTotalMinor + 1 } };
  assert.equal(validateScaleFixture(invalid), false);
  const certified = { ...stress, rows: stress.rows.map((row, index) => (index === 5 ? { ...row, bankCertificationStatus: "statement_certified" } : row)) };
  assert.equal(validateScaleFixture(certified), false);
  const noAnchor = { ...stress, rows: stress.rows.map((row) => (row.month === "2025-01" ? { ...row, anchor: false } : row)) };
  assert.equal(validateScaleFixture(noAnchor), false);
});

test("rows use the seeded people, accounts and categories, with ownership following the account", () => {
  const { rows } = createScaleFixture(1_000, REFERENCE);
  const accountIds = new Set(REFERENCE.accounts.map((account) => account.id));
  const categoryIds = new Set(REFERENCE.categories.map((category) => category.id));
  assert.ok(rows.every((row) => accountIds.has(row.accountId) && categoryIds.has(row.categoryId)));
  for (const row of rows) {
    const account = REFERENCE.accounts.find((item) => item.id === row.accountId);
    assert.equal(row.ownerPersonId, account.ownerPersonId, row.id);
  }
  assert.ok(rows.some((row) => row.accountId === "acct-household" && row.ownerPersonId === null && row.entryType === "expense"));
  assert.ok(rows.some((row) => row.ownerPersonId === "person-tim") && rows.some((row) => row.ownerPersonId === "person-joyce"));
  const transfers = rows.filter((row) => row.entryType === "transfer");
  assert.ok(transfers.every((row) => row.categoryId === "cat-transfer"));
  assert.ok(transfers.every((row) => (row.transferDirection === "out" ? row.accountId === "acct-uob-one" : row.accountId === "acct-household")));

  const anchor = rows.find((row) => row.anchor);
  assert.deepEqual(anchorCreateBody(anchor), {
    date: anchor.date,
    description: anchor.description,
    accountId: anchor.accountId,
    categoryName: anchor.categoryName,
    amountMinor: anchor.amountMinor,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: anchor.ownerName
  });
});

test("missing seeded references stop the fixture instead of skewing it", () => {
  assert.throws(
    () => resolveFixtureReferences({ ...REFERENCE, categories: REFERENCE.categories.filter((category) => category.name !== "Groceries") }),
    /category Groceries/
  );
  assert.throws(
    () => resolveFixtureReferences({ ...REFERENCE, accounts: REFERENCE.accounts.filter((account) => !account.isJoint) }),
    /joint account/
  );
  assert.throws(() => createScaleFixture(500, REFERENCE), RangeError);
});

test("the SQL inserts every non-anchor row and each transfer group, with the demo reseed's columns", () => {
  const fixture = createScaleFixture(1_000, REFERENCE);
  const sql = buildScaleFixtureSql(fixture, "household-1");
  const valueRows = sql.match(/^\('perf-1000-transaction-\d{5}'/gm) ?? [];
  assert.equal(valueRows.length, 1_000 - 24);
  const insertedIds = new Set(valueRows.map((line) => line.slice(2, -1)));
  assert.ok(fixture.rows.filter((row) => row.anchor).every((row) => !insertedIds.has(row.id)), "anchors go through the API");
  assert.equal((sql.match(/^\('perf-1000-transfer-\d{4}'/gm) ?? []).length, fixture.expected.transferPairCount);
  assert.ok(sql.includes("id, household_id, account_id, transfer_group_id, transaction_date,\n  description, amount_minor, currency, entry_type, transfer_direction,\n  category_id, owner_person_id, offsets_category, note"));
  assert.ok(!/statement_certified|import_id/.test(sql));

  const quoted = buildScaleFixtureSql({ rows: [{ ...fixture.rows.find((row) => !row.anchor), description: "O'Brien" }] }, "household-1");
  assert.ok(quoted.includes("'O''Brien'"));
  assert.throws(() => buildScaleFixtureSql({ rows: [{ ...fixture.rows[1], anchor: false, amountMinor: 1.5 }] }, "household-1"), TypeError);
});

test("the fixture switch accepts demo and the two scale sizes only", () => {
  assert.equal(readFixtureName(undefined), "demo");
  assert.equal(readFixtureName(""), "demo");
  assert.equal(readFixtureName("scale-1k"), "scale-1k");
  assert.equal(readFixtureName("scale-10k"), "scale-10k");
  assert.throws(() => readFixtureName("scale-5k"), /PERFORMANCE_FIXTURE/);
});
