// An iFAST Wrap statement imported through the real Worker and a real local
// D1: its contributions land on the investment account as transfers in, pair
// with the bank's GIRO rows as one transfer, and its market value is saved as
// an investment statement value (never a bank balance checkpoint).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createEntry, createSeededTemplate, dumpDatabase, assertSameDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { parseStatementText } from "../src/lib/statement-import.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const GIRO_194 = "IBG GIRO COLL P0000194 IFAST FINANCIAL PL- P0000194";
// The demo household already has transfer groups of its own.
const LINK_GROUPS = "SELECT id FROM transfer_groups WHERE note LIKE 'Linked by the %'";
const GIRO_192 = "IBG GIRO COLL P0000192 IFAST FINANCIAL PL- P0000192";

function parseFixture(name) {
  const text = readFileSync(new URL(`./fixtures/pdf-statement-text/${name}-sanitized.pdf-text.txt`, import.meta.url), "utf8");
  return parseStatementText(text, `${name}.pdf`);
}

async function createAccounts(api, { ifast = true } = {}) {
  const bank = await api("/api/accounts/create", { name: "OCBC 360", institution: "OCBC", kind: "bank", ownerPersonId: "person-joyce", isJoint: false });
  assert.equal(bank.status, 200, JSON.stringify(bank.payload));
  let investment;
  if (ifast) {
    investment = await api("/api/accounts/create", { name: "Alex iFAST", institution: "iFAST", kind: "investment", ownerPersonId: "person-joyce", isJoint: false });
    assert.equal(investment.status, 200, JSON.stringify(investment.payload));
  }
  return { bankId: bank.payload.accountId, investmentId: investment?.payload.accountId };
}

function giroEntry(api, { date = "2026-07-03", amountMinor = 68_500, description = GIRO_194 } = {}) {
  return createEntry(api, { accountName: "OCBC 360", date, description, amountMinor, categoryName: "Investments", ownerName: "Joyce" });
}

async function previewStatement(api, parsed) {
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "pdf",
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: parsed.checkpoints
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview;
}

function commitBody(parsed, preview, extra = {}) {
  return {
    sourceLabel: parsed.sourceLabel,
    sourceType: "pdf",
    parserKey: parsed.parserKey,
    rows: preview.previewRows,
    statementCheckpoints: parsed.checkpoints,
    ...extra
  };
}

test("the preview pairs the contribution with the GIRO row that names the account, and shows the value it will save", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { bankId, investmentId } = await createAccounts(api);
  const giroId = await giroEntry(api);
  // The other iFAST account's GIRO has the same amount and date: never offered.
  await giroEntry(api, { description: GIRO_192 });
  const parsed = parseFixture("ifast-wrap-jul-2026-real");

  const preview = await previewStatement(api, parsed);

  assert.deepEqual(preview.unknownAccounts, []);
  assert.deepEqual(preview.statementReconciliations, []);
  assert.equal(preview.previewRows.length, 1);
  const [row] = preview.previewRows;
  assert.deepEqual(
    [row.date, row.amountMinor, row.entryType, row.transferDirection, row.accountId, row.ownerName, row.commitStatus],
    ["2026-07-08", 68_500, "transfer", "in", investmentId, "Joyce", "included"]
  );
  assert.deepEqual(row.transferMatch, {
    transactionId: giroId,
    accountId: bankId,
    accountName: "OCBC 360",
    date: "2026-07-03",
    description: GIRO_194,
    amountMinor: 68_500,
    basis: "reference"
  });
  assert.deepEqual(preview.investmentValues, [{
    accountId: investmentId,
    accountName: "Alex iFAST",
    detectedAccountName: "Alex iFAST",
    accountKind: "investment",
    checkpointMonth: "2026-07",
    asOfDate: "2026-07-31",
    totalAssetsMinor: 137_467,
    cashMinor: 0,
    currency: "SGD"
  }]);
});

test("committing saves the contribution, links it to the GIRO row as one transfer and saves the market value", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { bankId, investmentId } = await createAccounts(api);
  const giroId = await giroEntry(api);
  const parsed = parseFixture("ifast-wrap-jul-2026-real");
  const preview = await previewStatement(api, parsed);

  const { status, payload } = await api("/api/imports/commit", commitBody(parsed, preview));

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.created, true);
  const [contribution] = await rows(db, `
    SELECT account_id, transaction_date, amount_minor, entry_type, transfer_direction, owner_person_id, bank_certification_status, transfer_group_id
    FROM transactions WHERE import_id = ?
  `, payload.importId);
  assert.deepEqual(
    { ...contribution, transfer_group_id: Boolean(contribution.transfer_group_id) },
    { account_id: investmentId, transaction_date: "2026-07-08", amount_minor: 68_500, entry_type: "transfer", transfer_direction: "in", owner_person_id: "person-joyce", bank_certification_status: "statement_certified", transfer_group_id: true }
  );
  const [giro] = await rows(db, "SELECT account_id, entry_type, transfer_direction, transfer_group_id, category_id FROM transactions WHERE id = ?", giroId);
  assert.deepEqual([giro.account_id, giro.entry_type, giro.transfer_direction, giro.transfer_group_id], [bankId, "transfer", "out", contribution.transfer_group_id]);
  assert.equal(giro.category_id, "cat-transfer");
  assert.equal((await rows(db, LINK_GROUPS)).length, 1);
  assert.deepEqual(await rows(db, `
    SELECT account_id, value_month, as_of_date, total_assets_minor, market_value_minor, cash_minor, income_minor, currency, account_reference, previous_value_json
    FROM investment_statement_values
  `), [{
    account_id: investmentId, value_month: "2026-07", as_of_date: "2026-07-31", total_assets_minor: 137_467, market_value_minor: 137_467,
    cash_minor: 0, income_minor: 0, currency: "SGD", account_reference: "P0000194", previous_value_json: null
  }]);
  // Invested counts the pair once: money moved into the investment account,
  // and the GIRO row (now a transfer) is no longer also spending under Investments.
  const summary = await api("/api/summary-page?view=household&month=2026-07&scope=direct_plus_shared");
  assert.equal(summary.status, 200, JSON.stringify(summary.payload));
  assert.deepEqual(summary.payload.summaryPage?.investmentMoves ?? summary.payload.investmentMoves, { intoMinor: 68_500, outOfMinor: 0 });
  const julyShare = (summary.payload.summaryPage ?? summary.payload).categoryShareByMonth.find((entry) => entry.month === "2026-07");
  assert.equal(julyShare?.data.find((slice) => slice.label === "Investments")?.valueMinor ?? 0, 0);
  // The market value is not a bank balance: no checkpoint, no certificate, and
  // the card remembers the account number's digits for the next statement.
  assert.deepEqual(await rows(db, "SELECT id FROM account_balance_checkpoints WHERE account_id = ?", investmentId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM statement_reconciliation_certificates WHERE account_id = ?", investmentId), []);
  assert.deepEqual(await rows(db, "SELECT last4 FROM accounts WHERE id = ?", investmentId), [{ last4: "0194" }]);
});

test("the Summary's account rows carry the latest statement value of an investment account, as a statement figure with its date", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { investmentId, bankId } = await createAccounts(api);
  const pillFor = async (view, accountId) => {
    const { status, payload } = await api(`/api/summary-account-pills?view=${view}`);
    assert.equal(status, 200, JSON.stringify(payload));
    return payload.accountPills.find((pill) => pill.accountId === accountId);
  };
  // Before any statement: no value, and no key at all (the payload does not grow).
  assert.equal("investmentValue" in (await pillFor("household", investmentId)), false);

  for (const name of ["ifast-wrap-aug-2026-real", "ifast-wrap-sep-2026-real"]) {
    const parsed = parseFixture(name);
    const preview = await previewStatement(api, parsed);
    const commit = await api("/api/imports/commit", commitBody(parsed, preview));
    assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  }

  // The newest month wins, the ledger balance is untouched, and a bank
  // account never carries a value.
  assert.deepEqual((await pillFor("household", investmentId)).investmentValue, { valueMinor: 202_390, asOfDate: "2026-09-30" });
  assert.deepEqual((await pillFor("person-joyce", investmentId)).investmentValue, { valueMinor: 202_390, asOfDate: "2026-09-30" });
  assert.equal((await pillFor("household", investmentId)).balanceMinor, 68_500);
  assert.equal("investmentValue" in (await pillFor("household", bankId)), false);
  // Another person's view does not list the account.
  assert.equal(await pillFor("person-tim", investmentId), undefined);
});

test("a month with no contribution saves only the value, and an account found by its number's digits needs no mapping", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);
  await db.prepare("UPDATE accounts SET account_name = 'Joyce long-term', last4 = '0194' WHERE id = ?").bind(investmentId).run();
  const parsed = parseFixture("ifast-wrap-sep-2026-real");

  const preview = await previewStatement(api, parsed);
  assert.deepEqual(preview.unknownAccounts, []);
  assert.deepEqual(preview.previewRows, []);
  assert.equal(preview.investmentValues[0].accountId, investmentId);
  assert.equal(preview.investmentValues[0].accountName, "Joyce long-term");

  const { status, payload } = await api("/api/imports/commit", commitBody(parsed, preview, {
    statementCheckpoints: preview.investmentValues.map((value, index) => ({ ...parsed.checkpoints[index], accountId: value.accountId, accountName: value.accountName, detectedAccountName: value.detectedAccountName }))
  }));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.deepEqual(await rows(db, "SELECT value_month, total_assets_minor FROM investment_statement_values WHERE account_id = ?", investmentId), [{ value_month: "2026-09", total_assets_minor: 202_390 }]);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE import_id = ?", payload.importId), []);
});

test("saving the same statement twice adds nothing; a revised statement updates the value and does not duplicate the transfer", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);
  await giroEntry(api);
  const parsed = parseFixture("ifast-wrap-jul-2026-real");
  const preview = await previewStatement(api, parsed);
  const first = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(first.payload.created, true);

  const again = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(again.payload.created, false);
  assert.equal((await rows(db, "SELECT id FROM transactions WHERE account_id = ?", investmentId)).length, 1);

  // A revised statement for the same month: the contribution is on the ledger
  // already (skipped), the value is replaced.
  const revised = { ...parsed, sourceLabel: "ifast-wrap-jul-2026-revised", checkpoints: parsed.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    statementBalanceMinor: 137_999,
    investmentValue: { ...checkpoint.investmentValue, totalAssetsMinor: 137_999, marketValueMinor: 137_999 }
  })) };
  const secondPreview = await previewStatement(api, revised);
  assert.equal(secondPreview.previewRows[0].commitStatus, "skipped");
  assert.equal(secondPreview.previewRows[0].transferMatch, undefined);
  assert.deepEqual(secondPreview.investmentValues[0].replaces, { asOfDate: "2026-07-31", totalAssetsMinor: 137_467 });

  const second = await api("/api/imports/commit", commitBody(revised, { previewRows: secondPreview.previewRows.filter((row) => row.commitStatus !== "skipped") }));
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  assert.equal((await rows(db, "SELECT id FROM transactions WHERE account_id = ?", investmentId)).length, 1);
  assert.equal((await rows(db, LINK_GROUPS)).length, 1);
  const [value] = await rows(db, "SELECT total_assets_minor, import_id, previous_value_json FROM investment_statement_values WHERE account_id = ?", investmentId);
  assert.equal(value.total_assets_minor, 137_999);
  assert.equal(value.import_id, second.payload.importId);
  assert.equal(JSON.parse(value.previous_value_json).total_assets_minor, 137_467);

  // Rolling the revision back puts the first statement's value back.
  const rollback = await api("/api/imports/rollback", { importId: second.payload.importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT total_assets_minor, import_id FROM investment_statement_values WHERE account_id = ?", investmentId), [{ total_assets_minor: 137_467, import_id: first.payload.importId }]);
});

test("rolling the import back removes the contribution, the value and the link, and restores the bank entry as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);
  const giroId = await giroEntry(api);
  const [before] = await rows(db, "SELECT entry_type, transfer_direction, category_id, offsets_category, transfer_group_id FROM transactions WHERE id = ?", giroId);
  const parsed = parseFixture("ifast-wrap-jul-2026-real");
  const commit = await api("/api/imports/commit", commitBody(parsed, await previewStatement(api, parsed)));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));

  const rollback = await api("/api/imports/rollback", { importId: commit.payload.importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_direction, category_id, offsets_category, transfer_group_id FROM transactions WHERE id = ?", giroId), [before]);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE account_id = ?", investmentId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM investment_statement_values"), []);
  assert.deepEqual(await rows(db, "SELECT id FROM import_transfer_links"), []);
  assert.deepEqual(await rows(db, LINK_GROUPS), []);
  assert.deepEqual(await rows(db, "SELECT status FROM imports WHERE id = ?", commit.payload.importId), [{ status: "rolled_back" }]);
});

test("a contribution with no matching bank row is imported on its own and is not guessed into a pair", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createAccounts(api);
  // Right amount, but it names the other iFAST account.
  await giroEntry(api, { description: GIRO_192 });
  const parsed = parseFixture("ifast-wrap-jul-2026-real");
  const preview = await previewStatement(api, parsed);
  assert.equal(preview.previewRows[0].transferMatch, undefined);

  const commit = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, LINK_GROUPS), []);
  assert.deepEqual(await rows(db, "SELECT transfer_group_id FROM transactions WHERE import_id = ?", commit.payload.importId), [{ transfer_group_id: null }]);
});

test("an account the statement names that the app does not know is reported, and the commit refuses it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createAccounts(api, { ifast: false });
  const parsed = parseFixture("ifast-wrap-jul-2026-real");

  const preview = await previewStatement(api, parsed);

  assert.deepEqual(preview.unknownAccounts, ["Alex iFAST"]);
  assert.equal(preview.investmentValues[0].accountId, undefined);
  const before = await dumpDatabase(db);
  const commit = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /Unknown (checkpoint )?account: Alex iFAST/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a statement mapped to a bank account is refused: market value is not a bank balance", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { bankId } = await createAccounts(api, { ifast: false });
  const parsed = parseFixture("ifast-wrap-sep-2026-real");
  const before = await dumpDatabase(db);

  const commit = await api("/api/imports/commit", commitBody(parsed, { previewRows: [] }, {
    statementCheckpoints: parsed.checkpoints.map((checkpoint) => ({ ...checkpoint, accountId: bankId, accountName: "OCBC 360", detectedAccountName: "Alex iFAST" }))
  }));

  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /not an investment account/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a pairing the client tampers with is refused before anything is written", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createAccounts(api);
  const giroId = await giroEntry(api, { amountMinor: 68_501 });
  const parsed = parseFixture("ifast-wrap-jul-2026-real");
  const preview = await previewStatement(api, parsed);
  preview.previewRows[0].transferMatch = { transactionId: giroId, accountId: "x", accountName: "OCBC 360", date: "2026-07-03", description: GIRO_194, amountMinor: 68_500, basis: "reference" };
  const before = await dumpDatabase(db);

  const commit = await api("/api/imports/commit", commitBody(parsed, preview));

  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /no longer available/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a bank entry already paired as a transfer is not taken a second time", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createAccounts(api);
  const giroId = await giroEntry(api);
  const parsed = parseFixture("ifast-wrap-jul-2026-real");
  const preview = await previewStatement(api, parsed);
  const [{ id: existingGroupId }] = await rows(db, "SELECT id FROM transfer_groups LIMIT 1");
  await db.prepare("UPDATE transactions SET transfer_group_id = ? WHERE id = ?").bind(existingGroupId, giroId).run();

  const secondPreview = await previewStatement(api, parsed);
  assert.equal(secondPreview.previewRows[0].transferMatch, undefined);
  // The stale preview that still carries the pairing is refused.
  const commit = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /no longer available/);
});
