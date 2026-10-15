// Recent imports for investment statements: a statement that saves only a
// value (no ledger rows) still names its account and the day it covers, so the
// list, the account filter and the "Imported before it" lines read the same as
// for any other import. The account comes from the saved value at read time,
// so statements imported before this change are covered without a migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { parseStashaway } from "./support/stashaway-fixtures.mjs";
import { parseStatementText } from "../src/lib/statement-import.ts";
import { buildEarlierImportLines, filterRecentImportsByAccount } from "../src/client/import-history-model.js";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const STASHAWAY = "Alex Sample Holder StashAway";
const STASHAWAY_LABEL = `${STASHAWAY} - Tim`;
const IFAST_LABEL = "Alex iFAST - Joyce";

function parseIfast(name) {
  const text = readFileSync(new URL(`./fixtures/pdf-statement-text/${name}-sanitized.pdf-text.txt`, import.meta.url), "utf8");
  return parseStatementText(text, `${name}.pdf`);
}

async function createInvestmentAccounts(api) {
  const bank = await api("/api/accounts/create", { name: "OCBC 360", institution: "OCBC", kind: "bank", ownerPersonId: "person-joyce", isJoint: false });
  const stashaway = await api("/api/accounts/create", { name: STASHAWAY, institution: "StashAway", kind: "investment", ownerPersonId: "person-tim", isJoint: false });
  const ifast = await api("/api/accounts/create", { name: "Alex iFAST", institution: "iFAST", kind: "investment", ownerPersonId: "person-joyce", isJoint: false });
  for (const result of [bank, stashaway, ifast]) {
    assert.equal(result.status, 200, JSON.stringify(result.payload));
  }
  return { bankId: bank.payload.accountId, stashawayId: stashaway.payload.accountId, ifastId: ifast.payload.accountId };
}

async function commitStatement(api, parsed) {
  const preview = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "pdf",
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: parsed.checkpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "pdf",
    parserKey: parsed.parserKey,
    rows: preview.payload.preview.previewRows,
    statementCheckpoints: parsed.checkpoints
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  return commit.payload.importId;
}

async function recentImports(api) {
  const { status, payload } = await api("/api/imports-page");
  assert.equal(status, 200);
  return payload.importsPage.recentImports;
}

test("a StashAway statement that saves only a value names its account and its statement date", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createInvestmentAccounts(api);
  const importId = await commitStatement(api, parseStashaway("mar"));

  const batch = (await recentImports(api)).find((item) => item.id === importId);

  assert.equal(batch.transactionCount, 0);
  assert.deepEqual(batch.accountNames, [STASHAWAY_LABEL]);
  assert.equal(batch.startDate, "2026-03-31");
  assert.equal(batch.endDate, "2026-03-31");
  assert.equal(batch.investmentValueCount, 1);
});

test("the account filter finds value-only imports for their account and for no other", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createInvestmentAccounts(api);
  const febId = await commitStatement(api, parseStashaway("feb"));
  const marId = await commitStatement(api, parseStashaway("mar"));
  const ifastId = await commitStatement(api, parseIfast("ifast-wrap-sep-2026-real"));
  const imports = await recentImports(api);

  assert.deepEqual(
    filterRecentImportsByAccount(imports, STASHAWAY_LABEL).map((item) => item.id).sort(),
    [febId, marId].sort()
  );
  assert.deepEqual(filterRecentImportsByAccount(imports, IFAST_LABEL).map((item) => item.id), [ifastId]);
  assert.deepEqual(filterRecentImportsByAccount(imports, "OCBC 360 - Joyce"), []);
});

test("an iFAST month with no contribution is labelled like one with a contribution", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createInvestmentAccounts(api);
  await createEntry(api, {
    accountName: "OCBC 360",
    date: "2026-07-03",
    description: "IBG GIRO COLL P0000194 IFAST FINANCIAL PL- P0000194",
    amountMinor: 68_500,
    categoryName: "Investments",
    ownerName: "Joyce"
  });
  const withContribution = await commitStatement(api, parseIfast("ifast-wrap-jul-2026-real"));
  const valueOnly = await commitStatement(api, parseIfast("ifast-wrap-sep-2026-real"));
  const imports = await recentImports(api);

  const july = imports.find((item) => item.id === withContribution);
  const september = imports.find((item) => item.id === valueOnly);
  assert.ok(july.transactionCount > 0);
  assert.ok(july.accountNames.includes(IFAST_LABEL));
  assert.equal(july.investmentValueCount, 1);
  assert.deepEqual(september.accountNames, [IFAST_LABEL]);
  assert.equal(september.transactionCount, 0);
  assert.match(september.startDate, /^2026-09-\d\d$/);
  assert.equal(september.startDate, september.endDate);
  assert.equal(september.investmentValueCount, 1);
});

test("an import saved before this change, with a value and no account link of its own, still shows under the account", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { stashawayId } = await createInvestmentAccounts(api);
  // The state the old commit left behind: the batch, its value row, nothing else.
  await db.prepare(`
    INSERT INTO imports (id, household_id, source_type, source_label, parser_key, imported_at, status)
    VALUES ('import-legacy-jan', (SELECT id FROM households LIMIT 1), 'pdf', 'jan_tim_stashaway_legacy', 'stashaway_pdf', '2026-10-14T01:00:00.000Z', 'completed')
  `).run();
  await db.prepare(`
    INSERT INTO investment_statement_values (id, household_id, account_id, value_month, as_of_date, total_assets_minor, market_value_minor, import_id)
    VALUES ('value-legacy-jan', (SELECT id FROM households LIMIT 1), ?, '2026-01', '2026-01-31', 1000000, 1000000, 'import-legacy-jan')
  `).bind(stashawayId).run();

  const batch = (await recentImports(api)).find((item) => item.id === "import-legacy-jan");

  assert.deepEqual(batch.accountNames, [STASHAWAY_LABEL]);
  assert.equal(batch.startDate, "2026-01-31");
  assert.equal(batch.endDate, "2026-01-31");
  const lines = buildEarlierImportLines([batch], "some-other-import");
  assert.deepEqual(lines.map((line) => line.text), [`${STASHAWAY_LABEL} · 31 Jan 2026 · jan_tim_stashaway_legacy`]);
});

test("rolling back a value-only import removes its value and the account filter stops listing it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { stashawayId } = await createInvestmentAccounts(api);
  const febId = await commitStatement(api, parseStashaway("feb"));
  const marId = await commitStatement(api, parseStashaway("mar"));

  const rollback = await api("/api/imports/rollback", { importId: marId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));

  assert.deepEqual(await rows(db, "SELECT value_month FROM investment_statement_values WHERE account_id = ?", stashawayId), [{ value_month: "2026-02" }]);
  const imports = await recentImports(api);
  const listed = filterRecentImportsByAccount(imports, STASHAWAY_LABEL).filter((item) => item.status === "completed");
  assert.deepEqual(listed.map((item) => item.id), [febId]);
  assert.deepEqual(imports.find((item) => item.id === marId).accountNames, []);
});
