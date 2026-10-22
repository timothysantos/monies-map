// Activity exports against a confirmed statement, in both orders, through
// the real Worker and a real local D1. The statement is the sanitized
// two-card UOB PDF; the activity rows word some purchases the way the bank's
// export does, not the way the statement prints them.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { commitBody, ONE_CARD, parseUobTwoCardStatement, previewStatement } from "./support/uob-wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const activityRow = (date, description, amount, extra = {}) => ({ date, description, expense: amount, account: ONE_CARD, category: "Other", type: "expense", ...extra });

async function createCards(api) {
  for (const [name, openingBalanceMinor] of [[ONE_CARD, 15000], ["UOB Lady's Card", -1250]]) {
    const { status, payload } = await api("/api/accounts/create", { name, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor, ownerPersonId: "person-tim", isJoint: false });
    assert.equal(status, 200, JSON.stringify(payload));
  }
}

async function commitStatement(api) {
  const statement = parseUobTwoCardStatement();
  const commit = await api("/api/imports/commit", commitBody(statement, await previewStatement(api, statement)));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
}

async function previewActivity(api, activityRows) {
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "One Card activity",
    sourceType: "csv",
    rows: activityRows,
    ownershipType: "direct",
    ownerName: "Tim"
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview;
}

const summarise = (preview) => preview.previewRows.map((row) => [row.description, row.commitStatus, row.certifiedStatement?.covered ?? null]);

test("an activity export after a confirmed statement skips every row the statement has, however it is worded", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createCards(api);
  await commitStatement(api);

  const preview = await previewActivity(api, [
    activityRow("2026-04-22", "OPENAI OPENAI.COM", "29.49"),
    activityRow("2026-04-21", "OPENAI *CHATGPT SUBSCR", "29.49"),
    activityRow("2026-05-06", "Buyandship Limited", "13.13"),
    activityRow("2026-05-09", "BUS/MRT 123456 SINGAPORE", "3.94"),
    activityRow("2026-05-15", "GRAB RIDES SINGAPORE", "12.30")
  ]);

  // OPENAI appears twice in the export: the statement has one, so the
  // second was billed on the next statement. It is included and posts after
  // this statement closes, never treated as covered.
  assert.deepEqual(summarise(preview), [
    ["OPENAI OPENAI.COM", "skipped", true],
    ["OPENAI *CHATGPT SUBSCR", "included", false],
    ["Buyandship Limited", "skipped", true],
    ["BUS/MRT 123456 SINGAPORE", "skipped", true],
    ["GRAB RIDES SINGAPORE", "included", null]
  ]);
  const bus = preview.previewRows.find((row) => row.description.startsWith("BUS/MRT"));
  assert.equal(bus.commitStatusReason, "Already on the confirmed May 2026 statement as BUS/MRT 000000000 SINGAPORE.");
  const extraOpenai = preview.previewRows.find((row) => row.description === "OPENAI *CHATGPT SUBSCR");
  assert.equal(extraOpenai.commitStatusReason, "Not on the confirmed May 2026 statement, so it counts toward the next statement.");
});

test("committing the export after the statement adds only the rows after it and keeps the statement balanced", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await createCards(api);
  await commitStatement(api);
  const preview = await previewActivity(api, [
    activityRow("2026-04-21", "OPENAI *CHATGPT SUBSCR", "29.49"),
    activityRow("2026-05-09", "BUS/MRT 123456 SINGAPORE", "3.94"),
    activityRow("2026-05-15", "GRAB RIDES SINGAPORE", "12.30")
  ]);
  // With only one same-amount OPENAI row, the statement's row covers it. An
  // unmatched same-amount duplicate is the one carried to the next statement above.
  assert.deepEqual(summarise(preview).map((row) => row[1]), ["skipped", "skipped", "included"]);

  const commit = await api("/api/imports/commit", {
    sourceLabel: "One Card activity",
    sourceType: "csv",
    rows: preview.previewRows.filter((row) => row.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const added = await rows(db, "SELECT description FROM transactions WHERE import_id = ?", commit.payload.importId);
  assert.deepEqual(added.map((row) => row.description), ["GRAB RIDES SINGAPORE"]);

  const settings = await api("/api/settings-page");
  const oneCard = settings.payload.settingsPage.accounts.find((account) => account.name === ONE_CARD);
  assert.deepEqual([oneCard.latestCheckpointMonth, oneCard.latestCheckpointDeltaMinor], ["2026-05", 0]);
});

test("repeated fares far apart are not covered, and carry to the next statement", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createCards(api);
  await commitStatement(api);

  const preview = await previewActivity(api, [
    // A commute at the statement's 3.94 fare, five and seven days from it:
    // different trips.
    activityRow("2026-05-04", "BUS/MRT 999999 SINGAPORE", "3.94"),
    activityRow("2026-05-02", "BUS/MRT 999998 SINGAPORE", "3.94"),
    activityRow("2026-05-01", "KOPITIAM", "5.20", { commitStatus: "included" })
  ]);

  assert.deepEqual(summarise(preview), [
    ["BUS/MRT 999999 SINGAPORE", "included", false],
    ["BUS/MRT 999998 SINGAPORE", "included", false],
    ["KOPITIAM", "included", false]
  ]);
});

test("a row the statement does not list imports without asking and posts after the statement closes", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await createCards(api);
  await commitStatement(api);

  const preview = await previewActivity(api, [activityRow("2026-05-04", "BUS/MRT 999999 SINGAPORE", "99.99")]);
  assert.equal(preview.previewRows[0].commitStatus, "included");

  const commit = await api("/api/imports/commit", {
    sourceLabel: "One Card activity",
    sourceType: "csv",
    rows: preview.previewRows
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const added = await rows(db, "SELECT description, transaction_date, post_date > transaction_date AS posts_later, bank_certification_status FROM transactions WHERE import_id = ?", commit.payload.importId);
  assert.deepEqual(added, [{ description: "BUS/MRT 999999 SINGAPORE", transaction_date: "2026-05-04", posts_later: 1, bank_certification_status: "provisional" }]);
});

test("a one-off fare five days from the statement's is covered by it", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createCards(api);
  await commitStatement(api);

  // The only 3.94 fare in the export: the statement's 3.94 fare, posted on
  // 9 May, is most likely the same trip.
  const preview = await previewActivity(api, [activityRow("2026-05-04", "BUS/MRT 999999 SINGAPORE", "3.94")]);

  assert.deepEqual(summarise(preview), [["BUS/MRT 999999 SINGAPORE", "skipped", true]]);
});

test("an activity export before the statement still lets the statement confirm its rows", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createCards(api);
  const preview = await previewActivity(api, [
    activityRow("2026-04-22", "OPENAI OPENAI.COM", "29.49"),
    activityRow("2026-05-06", "Buyandship Limited", "13.13")
  ]);
  // No confirmed statement yet: the rule does not apply.
  assert.deepEqual(summarise(preview), [["OPENAI OPENAI.COM", "included", null], ["Buyandship Limited", "included", null]]);
  const commit = await api("/api/imports/commit", { sourceLabel: "One Card activity", sourceType: "csv", rows: preview.previewRows });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));

  const statementPreview = await previewStatement(api, parseUobTwoCardStatement());
  const certifying = statementPreview.previewRows.filter((row) => row.accountName === ONE_CARD && row.reconciliationTargetTransactionId);
  assert.deepEqual(certifying.map((row) => row.description).sort(), ["Buyandship Limited Hong Kong", "OPENAI OPENAI.COM"]);
  assert.equal(statementPreview.statementReconciliations.find((item) => item.accountName === ONE_CARD).status, "matched");
});
