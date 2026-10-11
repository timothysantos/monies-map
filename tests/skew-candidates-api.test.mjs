// GET /api/skew-candidates through the real Worker and a real local D1
// seeded with the demo household: a simplified settlement paid by PayNow and
// filed as Other / Other - Income, and an own-account move filed as Salary,
// come back as skew candidates with the existing routes that resolve them.
// The route only reads: the whole database is identical before and after,
// and following the suggested actions removes the candidates.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2026-05";
const ETHAN = "person-tim";
const SERENE = "person-joyce";

// Demo names and accounts: the seeded people are renamed, and each person
// gets their own bank account (plus one joint account).
async function setUpHousehold(api) {
  for (const [personId, name] of [[ETHAN, "Ethan"], [SERENE, "Serene"]]) {
    const renamed = await api("/api/people/update", { personId, name });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.payload));
  }
  const accounts = [
    { name: "OCBC 360 Account", institution: "OCBC", ownerPersonId: ETHAN },
    { name: "UOB One Account", institution: "UOB", ownerPersonId: ETHAN },
    { name: "DBS Multiplier Account", institution: "DBS", ownerPersonId: SERENE },
    { name: "POSB Joint Account", institution: "POSB", ownerPersonId: null, isJoint: true }
  ];
  const accountIdByName = {};
  for (const account of accounts) {
    const created = await api("/api/accounts/create", { kind: "bank", currency: "SGD", openingBalanceMinor: 0, ...account });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    accountIdByName[account.name] = created.payload.accountId;
  }
  return accountIdByName;
}

// Ethan pays a shared $300 dinner so the simplified settlement is not zero.
async function simplifySettlement(api, db) {
  const expense = await api("/api/splits/expenses/create", {
    groupId: null,
    date: "2026-05-18",
    description: "Anniversary dinner",
    categoryName: "Food & Drinks",
    payerPersonName: "Ethan",
    amountMinor: 30000,
    splitAmountMinor: 15000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  assert.equal(expense.status, 200, JSON.stringify(expense.payload));
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: ETHAN, date: "2026-05-20", currency: "SGD" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  const [stored] = await rows(db, "SELECT from_person_id, to_person_id, amount_minor, status FROM split_settlement_checkpoints WHERE id = ?", checkpoint.payload.checkpointId);
  assert.equal(stored.status, "open");
  assert.ok(stored.amount_minor > 0);
  return { checkpointId: checkpoint.payload.checkpointId, fromPersonId: stored.from_person_id, toPersonId: stored.to_person_id, amountMinor: stored.amount_minor };
}

const NAME = { [ETHAN]: "Ethan", [SERENE]: "Serene" };
const OWN_ACCOUNT = { [ETHAN]: "OCBC 360 Account", [SERENE]: "DBS Multiplier Account" };

async function recordSettlementPayNow(api, settlement) {
  const payer = settlement.fromPersonId;
  const payee = settlement.toPersonId;
  const outflowId = await createEntry(api, {
    date: "2026-05-22",
    description: `PAYNOW TRANSFER TO ${NAME[payee].toUpperCase()}`,
    accountName: OWN_ACCOUNT[payer],
    categoryName: "Other",
    amountMinor: settlement.amountMinor,
    entryType: "expense",
    ownerName: NAME[payer]
  });
  const inflowId = await createEntry(api, {
    date: "2026-05-22",
    description: `PAYNOW FROM ${NAME[payer].toUpperCase()}`,
    accountName: OWN_ACCOUNT[payee],
    categoryName: "Other - Income",
    amountMinor: settlement.amountMinor,
    entryType: "income",
    ownerName: NAME[payee]
  });
  return { outflowId, inflowId };
}

async function recordOwnAccountMove(api) {
  const outflowId = await createEntry(api, {
    date: "2026-05-03",
    description: "PAYNOW TO UOB ONE",
    accountName: "OCBC 360 Account",
    categoryName: "Transfer",
    amountMinor: 50000,
    entryType: "transfer",
    transferDirection: "out",
    ownerName: "Ethan"
  });
  const inflowId = await createEntry(api, {
    date: "2026-05-04",
    description: "PAYNOW FROM OCBC",
    accountName: "UOB One Account",
    categoryName: "Salary",
    amountMinor: 50000,
    entryType: "income",
    ownerName: "Ethan"
  });
  return { outflowId, inflowId };
}

async function getCandidates(fetch, query) {
  const response = await fetch(`/api/skew-candidates?${new URLSearchParams(query)}`);
  assert.equal(response.status, 200, await response.clone().text());
  return { payload: await response.json(), serverTiming: response.headers.get("server-timing") ?? "" };
}

test("a PayNow settlement and an own-account move come back as skew candidates, read-only", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  const accountIdByName = await setUpHousehold(api);
  const settlement = await simplifySettlement(api, db);
  const paynow = await recordSettlementPayNow(api, settlement);
  const move = await recordOwnAccountMove(api);

  // Warm the request path, then prove the read changes nothing.
  await getCandidates(fetch, { view: "household", month: MONTH });
  const before = await dumpDatabase(db);
  const { payload, serverTiming } = await getCandidates(fetch, { view: "household", month: MONTH });
  assertSameDatabase(await dumpDatabase(db), before);

  assert.match(serverTiming, /^app;dur=/);
  assert.equal(payload.viewId, "household");
  assert.equal(payload.label, "Household");
  assert.equal(payload.month, MONTH);
  assert.equal(payload.scope, "direct_plus_shared");
  assert.equal(payload.omittedCandidateCount, 0);

  const settlementCandidate = payload.candidates.find((candidate) => candidate.kind === "settlement");
  assert.deepEqual(settlementCandidate.settlement, { source: "settlement_checkpoint", checkpointId: settlement.checkpointId, anchorDate: "2026-05-20" });
  assert.equal(settlementCandidate.confidence, "high");
  assert.equal(settlementCandidate.bothSidesFound, true);
  assert.equal(settlementCandidate.amountMinor, settlement.amountMinor);
  assert.deepEqual(settlementCandidate.fromPerson, { id: settlement.fromPersonId, name: NAME[settlement.fromPersonId] });
  assert.deepEqual(settlementCandidate.toPerson, { id: settlement.toPersonId, name: NAME[settlement.toPersonId] });
  assert.deepEqual(settlementCandidate.entryIds, [paynow.outflowId, paynow.inflowId]);
  assert.equal(settlementCandidate.outflowEntry.accountId, accountIdByName[OWN_ACCOUNT[settlement.fromPersonId]]);
  assert.equal(settlementCandidate.inflowEntry.accountId, accountIdByName[OWN_ACCOUNT[settlement.toPersonId]]);
  assert.deepEqual(settlementCandidate.skew, { spendingMinor: settlement.amountMinor, incomeMinor: settlement.amountMinor });
  assert.deepEqual(settlementCandidate.reasons.filter((reason) => reason.code === "days_from_settlement"), [
    { code: "days_from_settlement", entryId: paynow.outflowId, days: 2 },
    { code: "days_from_settlement", entryId: paynow.inflowId, days: 2 }
  ]);
  assert.deepEqual(settlementCandidate.suggestedActions, [
    { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: paynow.outflowId, toEntryId: paynow.inflowId } },
    { action: "match_settlement_checkpoint", method: "POST", path: "/api/splits/checkpoints/match", body: { checkpointId: settlement.checkpointId, transactionId: paynow.outflowId } }
  ]);

  const ownTransfer = payload.candidates.find((candidate) => candidate.kind === "own_transfer" && candidate.entryIds.includes(move.inflowId));
  assert.deepEqual(ownTransfer.entryIds, [move.outflowId, move.inflowId]);
  assert.deepEqual(ownTransfer.fromPerson, { id: ETHAN, name: "Ethan" });
  assert.deepEqual(ownTransfer.skew, { spendingMinor: 0, incomeMinor: 50000 });
  assert.deepEqual(ownTransfer.reasons, [
    { code: "same_amount", amountMinor: 50000 },
    { code: "days_apart", days: 1 },
    { code: "same_owner", personId: ETHAN, personName: "Ethan", fromAccountName: "OCBC 360 Account", toAccountName: "UOB One Account" },
    { code: "counted_as_income", entryId: move.inflowId, categoryName: "Salary" }
  ]);
  assert.deepEqual(ownTransfer.suggestedActions, [
    { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: move.outflowId, toEntryId: move.inflowId } }
  ]);

  // Totals add up every candidate's skew.
  assert.deepEqual(payload.totals, payload.candidates.reduce((totals, candidate) => ({
    spendingMinor: totals.spendingMinor + candidate.skew.spendingMinor,
    incomeMinor: totals.incomeMinor + candidate.skew.incomeMinor
  }), { spendingMinor: 0, incomeMinor: 0 }));

  // The payee's view sees only their side: the settlement counted as income.
  const payeeView = await getCandidates(fetch, { view: settlement.toPersonId, month: MONTH, scope: "direct" });
  assert.equal(payeeView.payload.viewId, settlement.toPersonId);
  assert.equal(payeeView.payload.scope, "direct");
  const payeeSettlement = payeeView.payload.candidates.find((candidate) => candidate.kind === "settlement");
  assert.deepEqual(payeeSettlement.skew, { spendingMinor: 0, incomeMinor: settlement.amountMinor });
  assert.equal(payeeView.payload.candidates.some((candidate) => candidate.entryIds.includes(move.inflowId)), settlement.toPersonId === ETHAN);
});

test("following the suggested actions resolves the candidates", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await setUpHousehold(api);
  const settlement = await simplifySettlement(api, db);
  const paynow = await recordSettlementPayNow(api, settlement);
  const move = await recordOwnAccountMove(api);

  const { payload } = await getCandidates(fetch, { view: "household", month: MONTH });
  const ours = payload.candidates.filter((candidate) => candidate.entryIds.some((id) => [paynow.outflowId, move.inflowId].includes(id)));
  assert.equal(ours.length, 2);
  for (const candidate of ours) {
    for (const step of candidate.suggestedActions) {
      const response = await api(step.path, step.body);
      assert.equal(response.status, 200, `${step.action}: ${JSON.stringify(response.payload)}`);
    }
  }

  const after = await getCandidates(fetch, { view: "household", month: MONTH });
  const ourIds = [paynow.outflowId, paynow.inflowId, move.outflowId, move.inflowId];
  assert.deepEqual(after.payload.candidates.filter((candidate) => candidate.entryIds.some((id) => ourIds.includes(id))), []);
  const [checkpoint] = await rows(db, "SELECT status FROM split_settlement_checkpoints WHERE id = ?", settlement.checkpointId);
  assert.equal(checkpoint.status, "matched");
});

test("a cent off, outside the window, or between different people's accounts is no candidate", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await setUpHousehold(api);
  const settlement = await simplifySettlement(api, db);
  const payer = settlement.fromPersonId;
  const payee = settlement.toPersonId;
  const centOff = await createEntry(api, {
    date: "2026-05-21", description: "PAYNOW", accountName: OWN_ACCOUNT[payer], categoryName: "Other",
    amountMinor: settlement.amountMinor - 1, entryType: "expense", ownerName: NAME[payer]
  });
  const tooLate = await createEntry(api, {
    date: "2026-05-26", description: "PAYNOW", accountName: OWN_ACCOUNT[payee], categoryName: "Other - Income",
    amountMinor: settlement.amountMinor, entryType: "income", ownerName: NAME[payee]
  });
  // Ethan to Serene, same amount, no settlement of that size: not an own transfer.
  const crossOut = await createEntry(api, {
    date: "2026-05-05", description: "PAYNOW", accountName: "OCBC 360 Account", categoryName: "Other",
    amountMinor: 77777, entryType: "expense", ownerName: "Ethan"
  });
  const crossIn = await createEntry(api, {
    date: "2026-05-05", description: "PAYNOW", accountName: "DBS Multiplier Account", categoryName: "Other - Income",
    amountMinor: 77777, entryType: "income", ownerName: "Serene"
  });

  const { payload } = await getCandidates(fetch, { view: "household", month: MONTH });
  const ids = [centOff, tooLate, crossOut, crossIn];
  assert.deepEqual(payload.candidates.filter((candidate) => candidate.entryIds.some((id) => ids.includes(id))), []);
});

test("an open group balance paid by PayNow is a settlement candidate with the balance's direction", async (t) => {
  const { api, fetch } = await openSeededDatabase(t, template);
  await setUpHousehold(api);
  // Serene pays an $84 Bali villa deposit, shared 50/50: Ethan owes her $42.
  const group = await api("/api/splits/groups/create", { name: "Bali trip", currency: "SGD" });
  assert.equal(group.status, 200, JSON.stringify(group.payload));
  const expense = await api("/api/splits/expenses/create", {
    groupId: group.payload.groupId,
    date: "2026-05-08",
    description: "Villa deposit",
    categoryName: "Travel",
    payerPersonName: "Serene",
    amountMinor: 8400,
    splitAmountMinor: 4200,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  assert.equal(expense.status, 200, JSON.stringify(expense.payload));
  const outflowId = await createEntry(api, {
    date: "2026-05-12", description: "PAYNOW SERENE BALI", accountName: "OCBC 360 Account", categoryName: "Other",
    amountMinor: 4200, entryType: "expense", ownerName: "Ethan"
  });

  const { payload } = await getCandidates(fetch, { view: "household", month: MONTH });
  const candidate = payload.candidates.find((item) => item.entryIds.includes(outflowId));
  assert.deepEqual(candidate.settlement, { source: "group_balance", groupId: group.payload.groupId, groupName: "Bali trip", anchorDate: "2026-05-08" });
  assert.deepEqual([candidate.fromPerson.name, candidate.toPerson.name], ["Ethan", "Serene"]);
  assert.equal(candidate.bothSidesFound, false);
  assert.equal(candidate.confidence, "high");
  assert.deepEqual(candidate.skew, { spendingMinor: 4200, incomeMinor: 0 });
  assert.deepEqual(candidate.suggestedActions.map((step) => step.action), ["reclassify_as_transfer", "record_group_settle_up"]);
  assert.deepEqual(candidate.suggestedActions[1].body, {
    groupId: group.payload.groupId, date: "2026-05-12", fromPersonName: "Ethan", toPersonName: "Serene",
    amountMinor: 4200, currency: "SGD", paymentMethod: "bank", paymentStatus: "recorded"
  });
});

test("the route only answers GET", async (t) => {
  const { fetch } = await openSeededDatabase(t, template);
  const response = await fetch("/api/skew-candidates?view=household&month=2026-05", { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});
