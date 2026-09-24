// Deterministic scale ledgers for API admission measurements (H01b). Rows
// use the seeded demo's real people, accounts and categories, so every page
// DTO resolves them exactly as it would real entries. All rows are
// provisional and never statement-certified.
//
// Loading: `buildScaleFixtureSql` inserts rows with the same columns the demo
// reseed writes. One direct expense per month (the anchor) is created through
// the Worker's own create API instead, which recalculates that month's
// snapshots with the SQL rows included.

const START_YEAR = 2024;
const START_MONTH = 6;
const MONTH_COUNT = 24;
const LARGE_MONTH = "2026-05";
const FIXTURE_CATEGORY_NAMES = ["Groceries", "Public Transport"];
const TRANSFER_CATEGORY_NAME = "Transfer";
const SQL_ROWS_PER_STATEMENT = 200;
export const SCALE_FIXTURE_DESCRIPTION_PREFIX = "Performance fixture ";
export const SCALE_FIXTURE_SIZES = Object.freeze({ "scale-1k": 1_000, "scale-10k": 10_000 });

function monthKeys() {
  return Array.from({ length: MONTH_COUNT }, (_, index) => {
    const absoluteMonth = START_YEAR * 12 + START_MONTH - 1 + index;
    return `${Math.floor(absoluteMonth / 12)}-${String((absoluteMonth % 12) + 1).padStart(2, "0")}`;
  });
}

function monthDistribution(rowCount, months) {
  const counts = new Map(months.map((month) => [month, 0]));
  if (rowCount === 10_000) {
    counts.set(LARGE_MONTH, 2_000);
    const remainingMonths = months.filter((month) => month !== LARGE_MONTH);
    const remainingRows = rowCount - 2_000;
    remainingMonths.forEach((month, index) => {
      counts.set(month, Math.floor(remainingRows / remainingMonths.length) + (index < remainingRows % remainingMonths.length ? 1 : 0));
    });
    return counts;
  }
  months.forEach((month, index) => counts.set(month, Math.floor(rowCount / months.length) + (index < rowCount % months.length ? 1 : 0)));
  return counts;
}

// Picks the real records the fixture writes against. Throws when the seeded
// demo no longer has them, so a changed seed cannot silently skew a cohort.
export function resolveFixtureReferences({ people, accounts, categories }) {
  const [personA, personB] = people ?? [];
  const activeAccounts = (accounts ?? []).filter((account) => account.isActive !== false);
  const joint = activeAccounts.find((account) => account.isJoint && !account.ownerPersonId);
  const individualFor = (person) => activeAccounts.find((account) => !account.isJoint && account.ownerPersonId === person?.id);
  const categoryNamed = (name) => (categories ?? []).find((category) => category.name === name);
  const resolved = {
    people: [personA, personB],
    jointAccount: joint,
    individualAccounts: [individualFor(personA), individualFor(personB)],
    categories: FIXTURE_CATEGORY_NAMES.map(categoryNamed),
    transferCategory: categoryNamed(TRANSFER_CATEGORY_NAME)
  };
  const missing = [
    ...resolved.people.map((person, index) => (person ? null : `person ${index + 1}`)),
    resolved.jointAccount ? null : "joint account",
    ...resolved.individualAccounts.map((account, index) => (account ? null : `account for person ${index + 1}`)),
    ...resolved.categories.map((category, index) => (category ? null : `category ${FIXTURE_CATEGORY_NAMES[index]}`)),
    resolved.transferCategory ? null : `category ${TRANSFER_CATEGORY_NAME}`
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Scale fixture cannot resolve seeded references: ${missing.join(", ")}.`);
  }
  return resolved;
}

function ownerOf(account, references) {
  return account.ownerPersonId ? references.people.find((person) => person.id === account.ownerPersonId) : null;
}

export function createScaleFixture(rowCount, reference) {
  if (![1_000, 10_000].includes(rowCount)) throw new RangeError("Scale fixture size must be 1000 or 10000 rows.");
  const references = resolveFixtureReferences(reference);
  const months = monthKeys();
  const countsByMonth = monthDistribution(rowCount, months);
  const rows = [];
  let sequence = 0;
  for (const month of months) {
    let anchorChosen = false;
    for (let offset = 0; offset < countsByMonth.get(month); offset += 1) {
      const index = sequence++;
      const transfer = index % 100 < 2;
      const transferPairIndex = transfer ? Math.floor(index / 100) : null;
      const transferDirection = transfer ? (index % 2 === 0 ? "out" : "in") : null;
      // A pair moves money from person A's account into the joint account.
      const account = transfer
        ? (transferDirection === "out" ? references.individualAccounts[0] : references.jointAccount)
        : index % 3 === 0
          ? references.jointAccount
          : references.individualAccounts[index % 2 === 0 ? 0 : 1];
      const owner = ownerOf(account, references);
      const category = transfer ? references.transferCategory : references.categories[index % 2];
      const anchor = !anchorChosen && !transfer && Boolean(owner);
      anchorChosen ||= anchor;
      rows.push({
        id: `perf-${rowCount}-transaction-${String(index + 1).padStart(5, "0")}`,
        month,
        date: `${month}-${String((transfer ? Math.floor(offset / 2) : offset) % 28 + 1).padStart(2, "0")}`,
        amountMinor: transfer ? 125 + ((Math.floor(index / 100) * 100 * 379) % 49_876) : 125 + ((index * 379) % 49_876),
        entryType: transfer ? "transfer" : "expense",
        transferDirection,
        transferGroupId: transfer ? `perf-${rowCount}-transfer-${String(transferPairIndex).padStart(4, "0")}` : null,
        accountId: account.id,
        accountName: account.name,
        ownerPersonId: owner?.id ?? null,
        ownerName: owner?.name ?? null,
        categoryId: category.id,
        categoryName: category.name,
        description: `${SCALE_FIXTURE_DESCRIPTION_PREFIX}${index + 1}`,
        anchor,
        bankCertificationStatus: "provisional"
      });
    }
  }
  const expenseRows = rows.filter((row) => row.entryType === "expense");
  const transferPairs = new Map();
  for (const row of rows.filter((item) => item.transferGroupId)) {
    const pair = transferPairs.get(row.transferGroupId) ?? [];
    pair.push(row);
    transferPairs.set(row.transferGroupId, pair);
  }
  const expected = {
    rowCount: rows.length,
    uniqueIdCount: new Set(rows.map((row) => row.id)).size,
    monthCount: new Set(rows.map((row) => row.month)).size,
    largeMonthCount: rows.filter((row) => row.month === LARGE_MONTH).length,
    anchorCount: rows.filter((row) => row.anchor).length,
    expenseCount: expenseRows.length,
    expenseTotalMinor: expenseRows.reduce((sum, row) => sum + row.amountMinor, 0),
    monthCounts: Object.fromEntries(months.map((month) => [month, rows.filter((row) => row.month === month).length])),
    monthTotals: Object.fromEntries(months.map((month) => [month, expenseRows.filter((row) => row.month === month).reduce((sum, row) => sum + row.amountMinor, 0)])),
    transferRowCount: rows.length - expenseRows.length,
    transferPairCount: transferPairs.size,
    transferPairsValid: [...transferPairs.values()].every((pair) => (
      pair.length === 2
      && pair[0].amountMinor === pair[1].amountMinor
      && new Set(pair.map((row) => row.transferDirection)).size === 2
    ))
  };
  return {
    rowCount,
    months,
    rows,
    expected,
    sourceNote: "Synthetic provisional rows on the seeded demo's real people, accounts and categories, added on top of the demo's near-real import, checkpoint and reconciliation scenarios."
  };
}

export function validateScaleFixture(fixture) {
  const { rows, expected, months } = fixture ?? {};
  if (!Array.isArray(rows) || !expected || rows.length !== expected.rowCount) return false;
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return false;
  if (new Set(rows.map((row) => row.month)).size !== MONTH_COUNT) return false;
  if (rows.some((row) => row.bankCertificationStatus !== "provisional")) return false;
  if (rows.some((row) => !row.accountId || !row.categoryId || !row.date.startsWith(`${row.month}-`))) return false;
  if (rows.some((row) => !Number.isInteger(row.amountMinor) || row.amountMinor <= 0)) return false;
  // One anchor per month, always a direct expense so creating it through the
  // API adds no split side effects.
  const anchors = rows.filter((row) => row.anchor);
  if (anchors.length !== MONTH_COUNT || new Set(anchors.map((row) => row.month)).size !== MONTH_COUNT) return false;
  if (anchors.some((row) => row.entryType !== "expense" || !row.ownerPersonId)) return false;
  const expenseTotalMinor = rows.filter((row) => row.entryType === "expense").reduce((sum, row) => sum + row.amountMinor, 0);
  if (expenseTotalMinor !== expected.expenseTotalMinor) return false;
  const actualMonthTotals = Object.fromEntries(months.map((month) => [month, rows.filter((row) => row.month === month && row.entryType === "expense").reduce((sum, row) => sum + row.amountMinor, 0)]));
  if (JSON.stringify(actualMonthTotals) !== JSON.stringify(expected.monthTotals)) return false;
  if (rows.length === 10_000 && rows.filter((row) => row.month === LARGE_MONTH).length !== 2_000) return false;
  return expected.transferPairsValid;
}

function sqlText(value) {
  return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInteger(value) {
  if (!Number.isInteger(value)) throw new TypeError(`Expected an integer, got ${value}.`);
  return String(value);
}

// SQL for every non-anchor row, plus one transfer_groups row per pair, with
// the same transaction columns as the demo reseed insert.
export function buildScaleFixtureSql(fixture, householdId) {
  const sqlRows = fixture.rows.filter((row) => !row.anchor);
  const groupIds = [...new Set(sqlRows.map((row) => row.transferGroupId).filter(Boolean))];
  const statements = [];
  for (let start = 0; start < groupIds.length; start += SQL_ROWS_PER_STATEMENT) {
    const values = groupIds.slice(start, start + SQL_ROWS_PER_STATEMENT)
      .map((id) => `(${sqlText(id)}, ${sqlText(householdId)}, ${sqlText("Performance fixture transfer pair")}, 1)`);
    statements.push(`INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES\n${values.join(",\n")};`);
  }
  for (let start = 0; start < sqlRows.length; start += SQL_ROWS_PER_STATEMENT) {
    const values = sqlRows.slice(start, start + SQL_ROWS_PER_STATEMENT).map((row) => `(${[
      sqlText(row.id),
      sqlText(householdId),
      sqlText(row.accountId),
      sqlText(row.transferGroupId),
      sqlText(row.date),
      sqlText(row.description),
      sqlInteger(row.amountMinor),
      sqlText("SGD"),
      sqlText(row.entryType),
      sqlText(row.transferDirection),
      sqlText(row.categoryId),
      sqlText(row.ownerPersonId),
      "0",
      "NULL"
    ].join(", ")})`);
    statements.push(`INSERT INTO transactions (
  id, household_id, account_id, transfer_group_id, transaction_date,
  description, amount_minor, currency, entry_type, transfer_direction,
  category_id, owner_person_id, offsets_category, note
) VALUES\n${values.join(",\n")};`);
  }
  return `${statements.join("\n\n")}\n`;
}

// Body for the Worker's /api/entries/create for an anchor row.
export function anchorCreateBody(row) {
  return {
    date: row.date,
    description: row.description,
    accountId: row.accountId,
    categoryName: row.categoryName,
    amountMinor: row.amountMinor,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: row.ownerName
  };
}
