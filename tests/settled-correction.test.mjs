// Split Correction (DOMAIN.md "Split Correction", docs/proposals/settled-correction.md):
// fix a mistake found inside a settled period with a record in the open period.
// Runs against a real local D1 seeded with the demo household. The case is the
// owner's: one flight entered twice in a group, both copies in one settle-up, one
// copy archived afterwards, so the settle-up asked the second person for her
// share of the extra copy.
//
// Proves: the amount and people are worked out on the server (both share orders,
// the rounding cent, a foreign-currency group), the balance counts the correction
// while spending (chip, donut) does not, the next settle-up includes it, undo
// restores everything, the lock holds once a settle-up covers it, every write is
// all-or-nothing with its history and audit events, and each refusal changes nothing.
import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_HOUSEHOLD_ID } from "../src/domain/app-repository-constants.ts";
import { buildOpenPeriodDonut, summariseOpenPeriod } from "../src/domain/split-open-period.ts";
import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { daysAgo } from "./support/ledger-checkup-seed.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const FLIGHT = "Singapore Airlines flights";

// A group, the flight entered twice (Tim paid; `timShare` is Tim's stored share,
// Joyce's is the rest), both copies covered by one simplified settlement.
async function settledFlight(api, db, { currency = "SGD", totalMinor = 105_185, timShare = 52_592, groupName = "Okaeri" } = {}) {
  const group = await api("/api/splits/groups/create", { name: groupName, currency, expenseSource: "mixed" });
  assert.equal(group.status, 200, JSON.stringify(group.payload));
  const groupId = group.payload.groupId;
  const ids = [];
  for (let copy = 0; copy < 2; copy += 1) {
    const created = await api("/api/splits/expenses/create", {
      groupId, date: daysAgo(120), description: FLIGHT, categoryName: "Travel", payerPersonName: "Tim",
      amountMinor: totalMinor, splitAmountMinor: timShare, currency, paymentMethod: "cash", paymentStatus: "recorded"
    });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    ids.push(created.payload.splitExpenseId);
  }
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: daysAgo(60), currency });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  return { groupId, ids, checkpointId: checkpoint.payload.checkpointId };
}

// The data-fix shape of the owner's case: the extra copy was archived after the
// settle-up held it (the app itself refuses that delete).
async function archive(db, expenseId) {
  await db.prepare("UPDATE split_expenses SET deleted_at = '2026-10-22 08:11:33' WHERE id = ?").bind(expenseId).run();
}

async function settledFinding(api) {
  const report = await api("/api/ledger-checkup");
  assert.equal(report.status, 200, JSON.stringify(report.payload));
  const found = report.payload.findings.filter((item) => item.kind === "settled_period_error");
  return found;
}

function sourceOf(finding) {
  return new URL(finding.fix.path, "http://app.local").searchParams.get("correct_settled");
}

async function groupBalance(api, viewId, groupId) {
  const page = await api(`/api/splits-page?view=${viewId}`);
  assert.equal(page.status, 200, JSON.stringify(page.payload));
  return { group: page.payload.splitsPage.groups.find((group) => group.id === groupId), page: page.payload.splitsPage };
}

async function correctionRows(db) {
  return rows(db, "SELECT * FROM split_settlements WHERE correction_source_id IS NOT NULL ORDER BY created_at, id");
}

test("the finding's fix opens the correction, and the server works the amount out: Joyce's share of the archived copy (her share is the larger cent)", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids } = await settledFlight(api, db);
  await archive(db, ids[1]);

  const [found, ...rest] = await settledFinding(api);
  assert.equal(rest.length, 0);
  assert.equal(found.tier, "high");
  assert.equal(found.fix.label, "Correct this settled mistake");
  assert.equal(found.fixNote, null);
  assert.equal(sourceOf(found), ids[1]);
  assert.match(found.fix.path, /^\/splits\?view=household&month=\d{4}-\d{2}&split_group=.+&correct_settled=/);

  const preview = await api(`/api/splits/corrections/preview?sourceRecordId=${ids[1]}`);
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.eligible, true);
  assert.deepEqual({ ...preview.payload.plan, groupId: undefined, settledOn: undefined, sourceDate: undefined }, {
    sourceRecordId: ids[1],
    amountMinor: 52_593,
    currency: "SGD",
    groupId: undefined,
    groupName: "Okaeri",
    sourceDescription: FLIGHT,
    sourceDate: undefined,
    sourceAmountMinor: 105_185,
    settledOn: undefined,
    overchargedPersonId: "person-joyce",
    overchargedPersonName: "Joyce",
    overpaidPersonId: "person-tim",
    overpaidPersonName: "Tim",
    sourceStillLive: false,
    label: preview.payload.plan.label
  });
  assert.match(preview.payload.plan.label, /^Correction: Singapore Airlines flights on .+ counted twice in the .+ settle-up$/);
});

test("the other share order: Tim's share is the larger cent, so Joyce was charged one cent less", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids } = await settledFlight(api, db, { timShare: 52_593 });
  await archive(db, ids[1]);
  const preview = await api(`/api/splits/corrections/preview?sourceRecordId=${ids[1]}`);
  assert.equal(preview.payload.eligible, true, JSON.stringify(preview.payload));
  assert.equal(preview.payload.plan.amountMinor, 52_592);
});

test("adding the correction: the balance moves by exactly that share, spending does not, and the finding is resolved", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { groupId, ids } = await settledFlight(api, db);
  await archive(db, ids[1]);
  const before = await groupBalance(api, "person-joyce", groupId);
  assert.equal(before.group.balanceMinor, 0);

  const created = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  assert.equal(created.payload.amountMinor, 52_593);
  assert.equal(created.payload.duplicateRemoved, false);

  // One record: from the person charged too much to the person paid too much,
  // in the group's open batch, with the source and the label, no bank link.
  const [correction] = await correctionRows(db);
  assert.equal(correction.id, created.payload.correctionId);
  assert.equal(correction.from_person_id, "person-joyce");
  assert.equal(correction.to_person_id, "person-tim");
  assert.equal(correction.amount_minor, 52_593);
  assert.equal(correction.currency, "SGD");
  assert.equal(correction.split_group_id, groupId);
  assert.equal(correction.correction_source_id, ids[1]);
  assert.equal(correction.correction_reason, created.payload.label);
  assert.equal(correction.linked_transaction_id, null);
  assert.equal(correction.deleted_at, null);
  assert.deepEqual(await rows(db, "SELECT closed_on FROM split_batches WHERE id = ?", correction.split_batch_id), [{ closed_on: null }]);

  // Joyce's view: Tim owes her; Tim's view: he owes Joyce; the household's net moves by the same.
  const joyce = await groupBalance(api, "person-joyce", groupId);
  assert.equal(joyce.group.balanceMinor, 52_593);
  assert.match(joyce.group.summaryText, /owes you/);
  const tim = await groupBalance(api, "person-tim", groupId);
  assert.equal(tim.group.balanceMinor, -52_593);
  assert.match(tim.group.summaryText, /^You owe Joyce/);

  // The row sits in the open period with its reason; it is not spending.
  const row = joyce.page.activity.find((item) => item.id === correction.id);
  assert.equal(row.kind, "settlement");
  assert.equal(row.settlementStatus, "open");
  assert.equal(row.description, created.payload.label);
  assert.deepEqual(row.correction, { sourceRecordId: ids[1], reason: created.payload.label });
  const groupActivity = joyce.page.activity.filter((item) => item.groupId === groupId);
  const open = summariseOpenPeriod(groupActivity);
  assert.equal(open.spendMinor, 0);
  assert.equal(open.expenseCount, 0);
  assert.deepEqual(buildOpenPeriodDonut(groupActivity, [], "household"), []);
  assert.equal(joyce.group.entryCount, before.group.entryCount + 1, "the correction is one open record");

  // The settled mistake is resolved by the correction.
  assert.deepEqual(await settledFinding(api), []);

  // History and the audit trail both say what happened.
  assert.deepEqual(await rows(db, "SELECT action, description, amount_minor, detail FROM split_activity_history WHERE record_id = ?", correction.id), [
    { action: "created", description: created.payload.label, amount_minor: 52_593, detail: "correction" }
  ]);
  assert.deepEqual(await rows(db, "SELECT action FROM audit_events WHERE entity_type = 'split_correction' AND entity_id = ?", correction.id), [{ action: "split_correction_created" }]);
});

test("a correction is not a payment: it is never offered a bank row, edited, matched, deleted or restored", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids } = await settledFlight(api, db);
  await archive(db, ids[1]);
  const created = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
  const id = created.payload.correctionId;
  const before = await dumpDatabase(db);

  const edit = await api("/api/splits/settlements/update", { settlementId: id, date: daysAgo(1), fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 1 });
  assert.equal(edit.status, 400);
  assert.match(edit.payload.error, /cannot be edited/);
  const note = await api("/api/splits/settlements/update-note", { settlementId: id, note: "x" });
  assert.equal(note.status, 400);
  const remove = await api("/api/splits/settlements/delete", { settlementId: id });
  assert.equal(remove.status, 400);
  assert.match(remove.payload.error, /Undo correction/);
  const link = await api("/api/splits/matches/link-settlement", { settlementId: id, transactionId: "txn-none" });
  assert.equal(link.status, 400);
  assertSameDatabase(await dumpDatabase(db), before);

  const page = await api("/api/splits-page?view=household");
  assert.equal(page.payload.splitsPage.matches.filter((match) => match.splitRecordId === id).length, 0);
});

test("also removing the duplicate: one all-or-nothing request that archives the live extra copy with the correction", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids } = await settledFlight(api, db);
  const [found] = await settledFinding(api);
  const source = sourceOf(found);
  assert.ok(ids.includes(source));
  const preview = await api(`/api/splits/corrections/preview?sourceRecordId=${source}`);
  assert.equal(preview.payload.plan.sourceStillLive, true);

  const created = await api("/api/splits/corrections", { sourceRecordId: source, alsoRemoveDuplicate: true, reason: "flight entered twice" });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  assert.equal(created.payload.duplicateRemoved, true);
  assert.equal(created.payload.label, "Correction: flight entered twice");
  assert.deepEqual(await rows(db, "SELECT id FROM split_expenses WHERE id IN (?, ?) AND deleted_at IS NULL", ids[0], ids[1]), [{ id: ids.find((id) => id !== source) }]);
  assert.deepEqual(await rows(db, "SELECT action, record_kind, detail FROM split_activity_history WHERE record_id = ? AND action = 'deleted'", source), [
    { action: "deleted", record_kind: "expense", detail: "removed with a correction" }
  ]);
  assert.deepEqual(await settledFinding(api), []);
});

test("without the option the live extra copy stays; the option is ignored when the copy is already archived", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids } = await settledFlight(api, db);
  const [found] = await settledFinding(api);
  const source = sourceOf(found);
  const created = await api("/api/splits/corrections", { sourceRecordId: source });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE id IN (?, ?) AND deleted_at IS NULL", ids[0], ids[1]), [{ n: 2 }]);

  const second = await openSeededDatabase(t, template);
  const flight = await settledFlight(second.api, second.db);
  await archive(second.db, flight.ids[1]);
  const archived = await second.api("/api/splits/corrections", { sourceRecordId: flight.ids[1], alsoRemoveDuplicate: true });
  assert.equal(archived.status, 200, JSON.stringify(archived.payload));
  assert.equal(archived.payload.duplicateRemoved, false);
});

test("refusals change nothing: unknown, not flagged, not settled, and a second correction", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids, groupId } = await settledFlight(api, db);
  await archive(db, ids[1]);
  // A different, open, single shared cost.
  const open = await api("/api/splits/expenses/create", {
    groupId, date: daysAgo(2), description: "Open taxi", categoryName: "Travel", payerPersonName: "Tim",
    amountMinor: 3_000, splitAmountMinor: 1_500, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  // Settled, but a single copy: no mistake.
  const kept = ids[0];
  const before = await dumpDatabase(db);

  const unknown = await api("/api/splits/corrections", { sourceRecordId: "split-expense-nope" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.payload.code, "correction_not_found");
  const notSettled = await api("/api/splits/corrections", { sourceRecordId: open.payload.splitExpenseId });
  assert.equal(notSettled.status, 400);
  assert.equal(notSettled.payload.code, "correction_not_settled");
  const notFlagged = await api("/api/splits/corrections", { sourceRecordId: kept });
  assert.equal(notFlagged.status, 400);
  assert.equal(notFlagged.payload.code, "correction_not_flagged");
  const typed = await api("/api/splits/corrections", { sourceRecordId: ids[1], alsoRemoveDuplicate: "yes" });
  assert.equal(typed.status, 400);
  const missing = await api("/api/splits/corrections", {});
  assert.equal(missing.status, 400);
  assertSameDatabase(await dumpDatabase(db), before);

  const ok = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
  assert.equal(ok.status, 200, JSON.stringify(ok.payload));
  const afterOne = await dumpDatabase(db);
  const again = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
  assert.equal(again.status, 400);
  assert.equal(again.payload.code, "correction_exists");
  assertSameDatabase(await dumpDatabase(db), afterOne);
  const preview = await api(`/api/splits/corrections/preview?sourceRecordId=${ids[1]}`);
  assert.deepEqual({ eligible: preview.payload.eligible, code: preview.payload.code }, { eligible: false, code: "correction_exists" });
});

test("a write that fails part way changes nothing: the correction, its history, its audit event and the archive commit together", async (t) => {
  for (const [pattern, alsoRemove] of [
    [/INSERT INTO split_settlements/, false],
    [/INSERT INTO split_activity_history/, false],
    [/INSERT INTO audit_events/, false],
    [/UPDATE split_expenses SET deleted_at/, true]
  ]) {
    const { db, api } = await openSeededDatabase(t, template);
    const { ids } = await settledFlight(api, db);
    const [found] = await settledFinding(api);
    const source = sourceOf(found);
    assert.ok(ids.includes(source));
    const before = await dumpDatabase(db);
    const failing = failingStatement(db, pattern);
    const failed = await api("/api/splits/corrections", { sourceRecordId: source, alsoRemoveDuplicate: alsoRemove }, { database: failing.db });
    assert.equal(failing.state.fired, true, `${pattern} never ran`);
    assert.equal(failed.status, 400, JSON.stringify(failed.payload));
    assertSameDatabase(await dumpDatabase(db), before);
    // The same request then succeeds.
    const retry = await api("/api/splits/corrections", { sourceRecordId: source, alsoRemoveDuplicate: alsoRemove });
    assert.equal(retry.status, 200, JSON.stringify(retry.payload));
  }
});

test("a second request that passed the check before the first committed writes nothing and says a correction exists", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids } = await settledFlight(api, db);
  await archive(db, ids[1]);
  // The planning read sees no correction; then another request commits one.
  let raced = false;
  const racing = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements) => {
          const results = await target.batch(statements);
          if (!raced) {
            raced = true;
            await target.prepare(`INSERT INTO split_settlements
              (id, household_id, split_group_id, from_person_id, to_person_id, settlement_date, amount_minor, currency, correction_source_id, correction_reason)
              VALUES ('split-correction-raced', ?, NULL, 'person-joyce', 'person-tim', '2026-10-01', 52593, 'SGD', ?, 'Correction: raced')`).bind(DEFAULT_HOUSEHOLD_ID, ids[1]).run();
          }
          return results;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const second = await api("/api/splits/corrections", { sourceRecordId: ids[1] }, { database: racing });
  assert.equal(raced, true);
  assert.equal(second.status, 400, JSON.stringify(second.payload));
  assert.equal(second.payload.code, "correction_exists");
  assert.deepEqual((await correctionRows(db)).map((row) => row.id), ["split-correction-raced"]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM split_activity_history WHERE description LIKE 'Correction:%'"), [{ n: 0 }]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE entity_type = 'split_correction'"), [{ n: 0 }]);
});

test("the next settle-up includes the correction, and then it is locked", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { groupId, ids, checkpointId } = await settledFlight(api, db);
  // The first settle-up was paid (the owner's was matched to the bank), so another can be made.
  assert.equal((await api("/api/splits/checkpoints/mark-paid", { checkpointId })).status, 200);
  await archive(db, ids[1]);
  const created = await api("/api/splits/corrections", { sourceRecordId: ids[1] });

  // Tim owes Joyce her overpaid share: that is what the next simplification asks for.
  const plan = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: daysAgo(0), currency: "SGD" });
  assert.equal(plan.status, 200, JSON.stringify(plan.payload));
  assert.equal(plan.payload.amountMinor, 52_593);
  const [checkpoint] = await rows(db, "SELECT from_person_id, to_person_id, amount_minor FROM split_settlement_checkpoints WHERE id = ?", plan.payload.checkpointId);
  assert.deepEqual(checkpoint, { from_person_id: "person-tim", to_person_id: "person-joyce", amount_minor: 52_593 });
  assert.deepEqual(await rows(db, "SELECT record_kind FROM split_settlement_checkpoint_items WHERE checkpoint_id = ? AND record_id = ?", plan.payload.checkpointId, created.payload.correctionId), [{ record_kind: "settlement" }]);
  assert.equal((await groupBalance(api, "person-joyce", groupId)).group.balanceMinor, 0);

  const before = await dumpDatabase(db);
  const undo = await api("/api/splits/corrections/undo", { correctionId: created.payload.correctionId });
  assert.equal(undo.status, 409, JSON.stringify(undo.payload));
  assert.equal(undo.payload.code, "split_settlement_locked");
  assert.equal(undo.payload.checkpointId, plan.payload.checkpointId);
  assertSameDatabase(await dumpDatabase(db), before);

  // Undoing the simplification releases it again.
  const reopened = await api("/api/splits/checkpoints/reopen", { checkpointId: plan.payload.checkpointId });
  assert.equal(reopened.status, 200);
  const undone = await api("/api/splits/corrections/undo", { correctionId: created.payload.correctionId });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
});

test("Settle group takes the correction with the group's open records", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { groupId, ids } = await settledFlight(api, db);
  await archive(db, ids[1]);
  const created = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
  const [{ split_batch_id: batchId }] = await correctionRows(db);
  // Tim pays Joyce what the group balance says; the settle-up closes the batch.
  const settle = await api("/api/splits/settlements/create", {
    groupId, date: daysAgo(0), fromPersonName: "Tim", toPersonName: "Joyce", amountMinor: 52_593, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  assert.equal(settle.status, 200, JSON.stringify(settle.payload));
  assert.deepEqual(await rows(db, "SELECT closed_on IS NOT NULL AS closed FROM split_batches WHERE id = ?", batchId), [{ closed: 1 }]);
  assert.equal((await groupBalance(api, "person-joyce", groupId)).group.balanceMinor, 0);
  const undo = await api("/api/splits/corrections/undo", { correctionId: created.payload.correctionId });
  assert.equal(undo.status, 409, JSON.stringify(undo.payload));
  assert.equal(undo.payload.code, "split_settlement_locked");
  assert.equal(undo.payload.batchId, batchId);
});

test("undo correction restores the balance and the finding, writes its history and audit event, and cannot be restored from history", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { groupId, ids } = await settledFlight(api, db);
  await archive(db, ids[1]);
  const [finding] = await settledFinding(api);
  const created = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
  const id = created.payload.correctionId;
  assert.deepEqual(await settledFinding(api), []);

  const undo = await api("/api/splits/corrections/undo", { correctionId: id });
  assert.equal(undo.status, 200, JSON.stringify(undo.payload));
  assert.equal((await groupBalance(api, "person-joyce", groupId)).group.balanceMinor, 0);
  const [again] = await settledFinding(api);
  assert.equal(again.id, finding.id, "reported again once the correction is undone");
  assert.equal(sourceOf(again), ids[1]);
  assert.deepEqual(await rows(db, "SELECT action, detail FROM split_activity_history WHERE record_id = ? ORDER BY occurred_at, rowid", id), [
    { action: "created", detail: "correction" },
    { action: "deleted", detail: "correction undone" }
  ]);
  assert.deepEqual(await rows(db, "SELECT action FROM audit_events WHERE entity_type = 'split_correction' AND entity_id = ? ORDER BY rowid", id), [
    { action: "split_correction_created" },
    { action: "split_correction_undone" }
  ]);
  const history = await api("/api/splits/activity-history");
  assert.equal(history.payload.activityHistory.filter((item) => item.recordId === id).every((item) => item.canRestore === false), true);
  const restore = await api("/api/splits/activity-history/restore", { recordKind: "settlement", recordId: id });
  assert.equal(restore.status, 400);

  // Undone twice, unknown, and a plain payment are all refused without a write.
  const before = await dumpDatabase(db);
  assert.equal((await api("/api/splits/corrections/undo", { correctionId: id })).status, 400);
  assert.equal((await api("/api/splits/corrections/undo", { correctionId: "split-correction-nope" })).status, 404);
  assert.equal((await api("/api/splits/corrections/undo", {})).status, 400);
  assertSameDatabase(await dumpDatabase(db), before);

  // And a new correction can be added again.
  assert.equal((await api("/api/splits/corrections", { sourceRecordId: ids[1] })).status, 200);
});

test("undo fails part way: nothing changes", async (t) => {
  for (const pattern of [/UPDATE split_settlements SET deleted_at/, /INSERT INTO split_activity_history/, /INSERT INTO audit_events/]) {
    const { db, api } = await openSeededDatabase(t, template);
    const { ids } = await settledFlight(api, db);
    await archive(db, ids[1]);
    const created = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
    const before = await dumpDatabase(db);
    const failing = failingStatement(db, pattern);
    const failed = await api("/api/splits/corrections/undo", { correctionId: created.payload.correctionId }, { database: failing.db });
    assert.equal(failing.state.fired, true, `${pattern} never ran`);
    assert.equal(failed.status, 400, JSON.stringify(failed.payload));
    assertSameDatabase(await dumpDatabase(db), before);
  }
});

test("a foreign-currency group: the correction is in the group's own currency, never converted", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { ids, groupId } = await settledFlight(api, db, { currency: "JPY", totalMinor: 80_001, timShare: 40_000, groupName: "Kyoto" });
  await archive(db, ids[1]);
  const preview = await api(`/api/splits/corrections/preview?sourceRecordId=${ids[1]}`);
  assert.equal(preview.payload.eligible, true, JSON.stringify(preview.payload));
  assert.equal(preview.payload.plan.amountMinor, 40_001);
  assert.equal(preview.payload.plan.currency, "JPY");
  const created = await api("/api/splits/corrections", { sourceRecordId: ids[1] });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const [correction] = await correctionRows(db);
  assert.deepEqual({ amount: correction.amount_minor, currency: correction.currency, fx: correction.fx_rate_basis_points }, { amount: 40_001, currency: "JPY", fx: null });
  const page = await groupBalance(api, "person-joyce", groupId);
  assert.equal(page.group.balanceMinor, 40_001);
  assert.equal(page.group.currency, "JPY");
});

test("a shared cost nobody else owes, and a real second purchase, are not offered a correction", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const group = await api("/api/splits/groups/create", { name: "Solo", currency: "SGD", expenseSource: "mixed" });
  const groupId = group.payload.groupId;
  const ids = [];
  for (let copy = 0; copy < 2; copy += 1) {
    const created = await api("/api/splits/expenses/create", {
      groupId, date: daysAgo(100), description: "Tim only", categoryName: "Travel", payerPersonName: "Tim",
      amountMinor: 5_000, splitAmountMinor: 5_000, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
    });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    ids.push(created.payload.splitExpenseId);
  }
  await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: daysAgo(50), currency: "SGD" });
  for (const id of ids) {
    const preview = await api(`/api/splits/corrections/preview?sourceRecordId=${id}`);
    assert.equal(preview.payload.eligible, false);
    assert.equal(preview.payload.code, "correction_not_flagged");
  }
  assert.deepEqual(await settledFinding(api), []);
});

test("a payment that is open again (its settle-up was undone) nets against what it paid, not on top of it", async (t) => {
  // The next simplification reads open payments with the sign the Splits
  // balance gives them; the correction record relies on it.
  const { db, api } = await openSeededDatabase(t, template);
  // Close out the demo household's own open shared costs first.
  const earlier = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: daysAgo(30), currency: "SGD" });
  assert.equal(earlier.status, 200, JSON.stringify(earlier.payload));
  assert.equal((await api("/api/splits/checkpoints/mark-paid", { checkpointId: earlier.payload.checkpointId })).status, 200);

  const group = await api("/api/splits/groups/create", { name: "Netting", currency: "SGD", expenseSource: "mixed" });
  const groupId = group.payload.groupId;
  const expense = await api("/api/splits/expenses/create", {
    groupId, date: daysAgo(10), description: "Dinner", categoryName: "Food & Drinks", payerPersonName: "Tim",
    amountMinor: 1_000, splitAmountMinor: 500, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  assert.equal(expense.status, 200, JSON.stringify(expense.payload));
  const settle = await api("/api/splits/settlements/create", { groupId, date: daysAgo(5), fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 500, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded" });
  assert.equal(settle.status, 200, JSON.stringify(settle.payload));
  const [{ split_batch_id: batchId }] = await rows(db, "SELECT split_batch_id FROM split_settlements WHERE id = ?", settle.payload.settlementId);
  assert.equal((await api("/api/splits/batches/reopen", { batchId })).status, 200);
  assert.equal((await groupBalance(api, "person-tim", groupId)).group.balanceMinor, 0);
  const plan = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: daysAgo(0), currency: "SGD" });
  assert.equal(plan.status, 200, JSON.stringify(plan.payload));
  assert.equal(plan.payload.amountMinor, 0, "Joyce already paid Tim her half: nothing is left to pay");
  assert.equal(plan.payload.status, "internally_offset");
});
