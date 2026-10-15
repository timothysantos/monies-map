// A StashAway statement imported through the real Worker and a real local D1:
// its closing balance is saved as an investment statement value (never a bank
// balance checkpoint), a deposit lands on the investment account as a transfer
// in and pairs with the bank's payment as one transfer, and the account is
// found again by its reference code even after a rename.
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, dumpDatabase, assertSameDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { parseSeptemberWithDeposit, parseStashaway } from "./support/stashaway-fixtures.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const ACCOUNT = "Alex Sample Holder StashAway";
const LINK_GROUPS = "SELECT id FROM transfer_groups WHERE note LIKE 'Linked by the %'";

async function createAccounts(api, { stashaway = true } = {}) {
  const bank = await api("/api/accounts/create", { name: "OCBC 360", institution: "OCBC", kind: "bank", ownerPersonId: "person-tim", isJoint: false });
  assert.equal(bank.status, 200, JSON.stringify(bank.payload));
  let investment;
  if (stashaway) {
    investment = await api("/api/accounts/create", { name: ACCOUNT, institution: "StashAway", kind: "investment", ownerPersonId: "person-tim", isJoint: false });
    assert.equal(investment.status, 200, JSON.stringify(investment.payload));
  }
  return { bankId: bank.payload.accountId, investmentId: investment?.payload.accountId };
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

async function commitMonth(api, month) {
  const parsed = parseStashaway(month);
  const preview = await previewStatement(api, parsed);
  const commit = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  return { parsed, preview, commit };
}

test("the preview names the account and the value it will save, and has no rows when no money moved", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);

  const preview = await previewStatement(api, parseStashaway("sep"));

  assert.deepEqual(preview.unknownAccounts, []);
  assert.deepEqual(preview.statementReconciliations, []);
  assert.deepEqual(preview.previewRows, []);
  assert.deepEqual(preview.investmentValues, [{
    accountId: investmentId,
    accountName: ACCOUNT,
    detectedAccountName: ACCOUNT,
    accountKind: "investment",
    checkpointMonth: "2026-09",
    asOfDate: "2026-09-30",
    totalAssetsMinor: 1_535_771,
    cashMinor: 0,
    currency: "SGD"
  }]);
});

test("committing two months saves each value, no certificate or balance checkpoint, and remembers the reference code", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);

  const aug = await commitMonth(api, "aug");
  const sep = await commitMonth(api, "sep");

  assert.equal(aug.commit.payload.created, true);
  assert.equal(sep.commit.payload.created, true);
  assert.deepEqual(await rows(db, `
    SELECT value_month, as_of_date, total_assets_minor, market_value_minor, cash_minor, income_minor, currency, account_reference, previous_value_json
    FROM investment_statement_values WHERE account_id = ? ORDER BY value_month
  `, investmentId), [
    { value_month: "2026-08", as_of_date: "2026-08-31", total_assets_minor: 1_570_659, market_value_minor: 1_570_659, cash_minor: 0, income_minor: 0, currency: "SGD", account_reference: "00 XYZ00X", previous_value_json: null },
    { value_month: "2026-09", as_of_date: "2026-09-30", total_assets_minor: 1_535_771, market_value_minor: 1_535_771, cash_minor: 0, income_minor: 0, currency: "SGD", account_reference: "00 XYZ00X", previous_value_json: null }
  ]);
  assert.deepEqual(await rows(db, "SELECT id FROM account_balance_checkpoints WHERE account_id = ?", investmentId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM statement_reconciliation_certificates WHERE account_id = ?", investmentId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE account_id = ?", investmentId), []);
  assert.deepEqual(await rows(db, "SELECT last4 FROM accounts WHERE id = ?", investmentId), [{ last4: "Z00X" }]);
});

test("the Summary's account row carries the latest statement value, the newest month winning, and hidden figures stay out of the payload shape", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { investmentId, bankId } = await createAccounts(api);
  const pillFor = async (view, accountId) => {
    const { status, payload } = await api(`/api/summary-account-pills?view=${view}`);
    assert.equal(status, 200, JSON.stringify(payload));
    return payload.accountPills.find((pill) => pill.accountId === accountId);
  };
  assert.equal("investmentValue" in (await pillFor("household", investmentId)), false);

  await commitMonth(api, "sep");
  await commitMonth(api, "aug");

  assert.deepEqual((await pillFor("household", investmentId)).investmentValue, { valueMinor: 1_535_771, asOfDate: "2026-09-30" });
  assert.deepEqual((await pillFor("person-tim", investmentId)).investmentValue, { valueMinor: 1_535_771, asOfDate: "2026-09-30" });
  assert.equal((await pillFor("household", investmentId)).balanceMinor, 0);
  assert.equal("investmentValue" in (await pillFor("household", bankId)), false);
});

test("a renamed account is found by the reference code remembered on it, without mapping", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);
  await commitMonth(api, "aug");
  await db.prepare("UPDATE accounts SET account_name = 'Tim StashAway' WHERE id = ?").bind(investmentId).run();

  const parsed = parseStashaway("sep");
  const preview = await previewStatement(api, parsed);

  assert.deepEqual(preview.unknownAccounts, []);
  assert.equal(preview.investmentValues[0].accountId, investmentId);
  assert.equal(preview.investmentValues[0].accountName, "Tim StashAway");
  const commit = await api("/api/imports/commit", commitBody(parsed, preview, {
    statementCheckpoints: preview.investmentValues.map((value, index) => ({ ...parsed.checkpoints[index], accountId: value.accountId, accountName: value.accountName, detectedAccountName: value.detectedAccountName }))
  }));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, "SELECT value_month FROM investment_statement_values WHERE account_id = ? ORDER BY value_month", investmentId), [{ value_month: "2026-08" }, { value_month: "2026-09" }]);
});

test("a statement that starts where the earlier one ended says nothing; one that does not, says where each stands", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createAccounts(api);
  // No earlier statement saved yet: nothing to compare.
  assert.equal("startsAfter" in (await previewStatement(api, parseStashaway("aug"))).investmentValues[0], false);
  await commitMonth(api, "aug");

  assert.equal("startsAfter" in (await previewStatement(api, parseStashaway("sep"))).investmentValues[0], false);

  const parsed = parseStashaway("sep");
  const withOpening = (openingMinor) => ({ ...parsed, checkpoints: parsed.checkpoints.map((checkpoint) => ({ ...checkpoint, investmentValue: { ...checkpoint.investmentValue, openingMinor } })) });
  // A cent apart is rounding, not a gap.
  assert.equal("startsAfter" in (await previewStatement(api, withOpening(1_570_660))).investmentValues[0], false);
  assert.deepEqual((await previewStatement(api, withOpening(1_570_661))).investmentValues[0].startsAfter, {
    openingMinor: 1_570_661,
    earlierValueMinor: 1_570_659,
    earlierAsOfDate: "2026-08-31"
  });
  // Only the month just before counts: July is not saved, so a June statement has no earlier one.
  const june = parseStashaway("jun");
  assert.equal("startsAfter" in (await previewStatement(api, june)).investmentValues[0], false);
});

test("a deposit lands on the account as a transfer in, pairs with the bank payment that names the reference code, and the continuity notice does not block", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { bankId, investmentId } = await createAccounts(api);
  const paymentId = await createEntry(api, {
    accountName: "OCBC 360",
    date: "2026-09-01",
    description: "FAST PAYMENT STASHAWAY 00 XYZ00X",
    amountMinor: 50_000,
    categoryName: "Investments",
    ownerName: "Tim"
  });
  // A same-amount payment that names nothing is not preferred over the one that does.
  await createEntry(api, { accountName: "OCBC 360", date: "2026-09-02", description: "FAST PAYMENT TO A FRIEND", amountMinor: 50_000, categoryName: "Other", ownerName: "Tim" });
  const parsed = parseSeptemberWithDeposit();
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.income, row.description]), [["2026-09-02", "500.00", "StashAway deposit"]]);

  const preview = await previewStatement(api, parsed);
  const [row] = preview.previewRows;
  assert.deepEqual([row.date, row.amountMinor, row.entryType, row.transferDirection, row.accountId, row.commitStatus], ["2026-09-02", 50_000, "transfer", "in", investmentId, "included"]);
  assert.deepEqual(row.transferMatch, {
    transactionId: paymentId,
    accountId: bankId,
    accountName: "OCBC 360",
    date: "2026-09-01",
    description: "FAST PAYMENT STASHAWAY 00 XYZ00X",
    amountMinor: 50_000,
    basis: "reference"
  });

  const commit = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [deposit] = await rows(db, "SELECT account_id, transaction_date, amount_minor, entry_type, transfer_direction, bank_certification_status, transfer_group_id FROM transactions WHERE import_id = ?", commit.payload.importId);
  assert.deepEqual({ ...deposit, transfer_group_id: Boolean(deposit.transfer_group_id) }, {
    account_id: investmentId, transaction_date: "2026-09-02", amount_minor: 50_000, entry_type: "transfer", transfer_direction: "in", bank_certification_status: "statement_certified", transfer_group_id: true
  });
  const [payment] = await rows(db, "SELECT entry_type, transfer_direction, transfer_group_id FROM transactions WHERE id = ?", paymentId);
  assert.deepEqual([payment.entry_type, payment.transfer_direction, payment.transfer_group_id], ["transfer", "out", deposit.transfer_group_id]);
  assert.equal((await rows(db, LINK_GROUPS)).length, 1);
  assert.deepEqual(await rows(db, "SELECT total_assets_minor FROM investment_statement_values WHERE account_id = ?", investmentId), [{ total_assets_minor: 1_585_771 }]);

  // Rolling it back removes the deposit, the value and the link, and restores the bank entry.
  const rollback = await api("/api/imports/rollback", { importId: commit.payload.importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_direction, transfer_group_id FROM transactions WHERE id = ?", paymentId), [{ entry_type: "expense", transfer_direction: null, transfer_group_id: null }]);
  assert.deepEqual(await rows(db, "SELECT id FROM investment_statement_values"), []);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE account_id = ?", investmentId), []);
});

test("saving the same statement twice adds nothing; a revised statement replaces the value and rolls back to the first", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);
  const parsed = parseStashaway("sep");
  const preview = await previewStatement(api, parsed);
  const first = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(first.payload.created, true);
  const again = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(again.payload.created, false);
  assert.equal((await rows(db, "SELECT id FROM investment_statement_values WHERE account_id = ?", investmentId)).length, 1);

  const revised = { ...parsed, sourceLabel: "stashaway-sep-2026-revised", checkpoints: parsed.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    statementBalanceMinor: 1_536_000,
    investmentValue: { ...checkpoint.investmentValue, totalAssetsMinor: 1_536_000, marketValueMinor: 1_536_000 }
  })) };
  const secondPreview = await previewStatement(api, revised);
  assert.deepEqual(secondPreview.investmentValues[0].replaces, { asOfDate: "2026-09-30", totalAssetsMinor: 1_535_771 });
  const second = await api("/api/imports/commit", commitBody(revised, secondPreview));
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  const [value] = await rows(db, "SELECT total_assets_minor, import_id, previous_value_json FROM investment_statement_values WHERE account_id = ?", investmentId);
  assert.equal(value.total_assets_minor, 1_536_000);
  assert.equal(JSON.parse(value.previous_value_json).total_assets_minor, 1_535_771);

  const rollback = await api("/api/imports/rollback", { importId: second.payload.importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT total_assets_minor, import_id FROM investment_statement_values WHERE account_id = ?", investmentId), [{ total_assets_minor: 1_535_771, import_id: first.payload.importId }]);
});

test("an account the statement names that the app does not know is reported, and the commit refuses it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createAccounts(api, { stashaway: false });
  const parsed = parseStashaway("sep");

  const preview = await previewStatement(api, parsed);

  assert.deepEqual(preview.unknownAccounts, [ACCOUNT]);
  assert.equal(preview.investmentValues[0].accountId, undefined);
  const before = await dumpDatabase(db);
  const commit = await api("/api/imports/commit", commitBody(parsed, preview));
  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, new RegExp(`Unknown (checkpoint )?account: ${ACCOUNT}`));
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a statement mapped to a bank account is refused: a portfolio value is not a bank balance", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { bankId } = await createAccounts(api, { stashaway: false });
  const parsed = parseStashaway("sep");
  const before = await dumpDatabase(db);

  const commit = await api("/api/imports/commit", commitBody(parsed, { previewRows: [] }, {
    statementCheckpoints: parsed.checkpoints.map((checkpoint) => ({ ...checkpoint, accountId: bankId, accountName: "OCBC 360", detectedAccountName: ACCOUNT }))
  }));

  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /not an investment account/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a statement not in Singapore dollars cannot be saved even when the client sends it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createAccounts(api);
  const parsed = parseStashaway("sep");
  const before = await dumpDatabase(db);

  const commit = await api("/api/imports/commit", commitBody(parsed, { previewRows: [] }, {
    statementCheckpoints: parsed.checkpoints.map((checkpoint) => ({ ...checkpoint, investmentValue: { ...checkpoint.investmentValue, currency: "USD" } }))
  }));

  assert.equal(commit.status, 400);
  assert.match(commit.payload.error, /USD/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a reference code that is not four letters or digits is not remembered on the account", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { investmentId } = await createAccounts(api);
  const parsed = parseStashaway("sep");

  const commit = await api("/api/imports/commit", commitBody(parsed, { previewRows: [] }, {
    statementCheckpoints: parsed.checkpoints.map((checkpoint) => ({ ...checkpoint, accountLast4: "z0-0x" }))
  }));

  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, "SELECT last4 FROM accounts WHERE id = ?", investmentId), [{ last4: null }]);
});
