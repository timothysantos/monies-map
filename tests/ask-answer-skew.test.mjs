// Skew first (the owner's rule "stop and ask first"): before Ask explains a
// month's figures, POST /api/ai-assist/answer checks the skew candidates
// (DOMAIN.md "Skew Candidate"). A high-confidence candidate that would
// change the facts comes back as { needsConfirmation, candidates } with its
// suggested actions and no answer; after the person resolves it through
// the existing routes, or says it is real (keepCandidateIds), the same
// question is answered. Real Worker, real local D1, the demo household
// renamed to Ethan and Serene.
import assert from "node:assert/strict";
import test from "node:test";

import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

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
const NAME = { [ETHAN]: "Ethan", [SERENE]: "Serene" };
const OWN_ACCOUNT = { [ETHAN]: "OCBC 360 Account", [SERENE]: "DBS Multiplier Account" };

async function setUpHousehold(api) {
  for (const [personId, name] of [[ETHAN, "Ethan"], [SERENE, "Serene"]]) {
    const renamed = await api("/api/people/update", { personId, name });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.payload));
  }
  for (const account of [
    { name: "OCBC 360 Account", institution: "OCBC", ownerPersonId: ETHAN },
    { name: "UOB One Account", institution: "UOB", ownerPersonId: ETHAN },
    { name: "DBS Multiplier Account", institution: "DBS", ownerPersonId: SERENE }
  ]) {
    const created = await api("/api/accounts/create", { kind: "bank", currency: "SGD", openingBalanceMinor: 0, ...account });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
  }
}

// Ethan pays a shared $300 dinner and the settlement is simplified, then
// the PayNow that settles it lands as an expense and as income.
async function seedSettlementPayNow(api, db) {
  const expense = await api("/api/splits/expenses/create", {
    groupId: null, date: "2026-05-18", description: "Anniversary dinner", categoryName: "Food & Drinks",
    payerPersonName: "Ethan", amountMinor: 30000, splitAmountMinor: 15000, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  assert.equal(expense.status, 200, JSON.stringify(expense.payload));
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: ETHAN, date: "2026-05-20", currency: "SGD" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  const [stored] = await rows(db, "SELECT from_person_id, to_person_id, amount_minor FROM split_settlement_checkpoints WHERE id = ?", checkpoint.payload.checkpointId);
  const payer = stored.from_person_id;
  const payee = stored.to_person_id;
  const outflowId = await createEntry(api, {
    date: "2026-05-22", description: `PAYNOW TRANSFER TO ${NAME[payee].toUpperCase()}`, accountName: OWN_ACCOUNT[payer],
    categoryName: "Other", amountMinor: stored.amount_minor, entryType: "expense", ownerName: NAME[payer]
  });
  const inflowId = await createEntry(api, {
    date: "2026-05-22", description: `PAYNOW FROM ${NAME[payer].toUpperCase()}`, accountName: OWN_ACCOUNT[payee],
    categoryName: "Other - Income", amountMinor: stored.amount_minor, entryType: "income", ownerName: NAME[payee]
  });
  return { checkpointId: checkpoint.payload.checkpointId, amountMinor: stored.amount_minor, outflowId, inflowId };
}

// Ethan moves $500 between his own accounts; the arrival is filed as Salary.
async function seedOwnAccountMove(api) {
  const outflowId = await createEntry(api, {
    date: "2026-05-03", description: "PAYNOW TO UOB ONE", accountName: "OCBC 360 Account", categoryName: "Transfer",
    amountMinor: 50000, entryType: "transfer", transferDirection: "out", ownerName: "Ethan"
  });
  const inflowId = await createEntry(api, {
    date: "2026-05-04", description: "PAYNOW FROM OCBC", accountName: "UOB One Account", categoryName: "Salary",
    amountMinor: 50000, entryType: "income", ownerName: "Ethan"
  });
  return { outflowId, inflowId };
}

async function ask(api, text, extra = {}) {
  const response = await api("/api/ai-assist/answer", { text, viewId: "household", month: MONTH, scope: "direct_plus_shared", ...extra });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

async function actualSpend(api, month = MONTH) {
  const { payload } = await api(`/api/month-page?view=household&month=${month}&scope=direct_plus_shared`);
  return payload.monthPage.metricCards.find((card) => card.label === "Actual spend").amountMinor;
}

test("a settle-up counted as spending stops the answer until it is resolved, then the answer has it fixed", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await setUpHousehold(api);
  const paynow = await seedSettlementPayNow(api, db);
  const spendWithPayNow = await actualSpend(api);

  const before = await dumpDatabase(db);
  const asked = await ask(api, "why was May so expensive?");
  assertSameDatabase(await dumpDatabase(db), before);
  assert.equal(asked.supported, true);
  assert.equal(asked.intent, "spending");
  assert.equal(asked.needsConfirmation, true);
  assert.equal("answer" in asked, false);
  assert.equal("wording" in asked, false);
  assert.equal(asked.candidates.length, 1);
  const [candidate] = asked.candidates;
  assert.equal(candidate.kind, "settlement");
  assert.equal(candidate.confidence, "high");
  assert.deepEqual(candidate.entryIds, [paynow.outflowId, paynow.inflowId]);
  assert.deepEqual(candidate.skew, { spendingMinor: paynow.amountMinor, incomeMinor: paynow.amountMinor });
  assert.deepEqual(candidate.suggestedActions, [
    { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: paynow.outflowId, toEntryId: paynow.inflowId } },
    { action: "match_settlement_checkpoint", method: "POST", path: "/api/splits/checkpoints/match", body: { checkpointId: paynow.checkpointId, transactionId: paynow.outflowId } }
  ]);

  // Mark as settlement: the suggested actions, in order, through the existing routes.
  for (const step of candidate.suggestedActions) {
    const response = await api(step.path, step.body);
    assert.equal(response.status, 200, `${step.action}: ${JSON.stringify(response.payload)}`);
  }
  const answered = await ask(api, "why was May so expensive?");
  assert.equal(answered.needsConfirmation, false);
  const spendAfter = await actualSpend(api);
  assert.equal(spendAfter, spendWithPayNow - paynow.amountMinor);
  assert.equal(answered.answer.lead.amountMinor, spendAfter);
  assert.equal(answered.wording.source, "template");
  assert.match(answered.wording.text, /^May came to \$/);
});

test("It's real spending: a kept candidate is not asked about again, and the figures stay as they are", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await setUpHousehold(api);
  await seedSettlementPayNow(api, db);
  const asked = await ask(api, "how am I doing against the plan?");
  assert.equal(asked.needsConfirmation, true);
  const kept = await ask(api, "how am I doing against the plan?", { keepCandidateIds: [asked.candidates[0].id] });
  assert.equal(kept.needsConfirmation, false);
  assert.equal(kept.intent, "plan");
  assert.equal(kept.answer.lead.amountMinor, await actualSpend(api));
  // Nothing was written for "It's real spending".
  const [checkpoint] = await rows(db, "SELECT status FROM split_settlement_checkpoints WHERE id = ?", asked.candidates[0].settlement.checkpointId);
  assert.equal(checkpoint.status, "open");
  // An id that is not a candidate changes nothing.
  assert.equal((await ask(api, "how am I doing against the plan?", { keepCandidateIds: ["not-a-candidate"] })).needsConfirmation, true);
});

test("only candidates that change this answer's facts stop it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await setUpHousehold(api);
  const move = await seedOwnAccountMove(api);

  // The move skews income only: a spending answer is not held up...
  const biggest = await ask(api, "what were the biggest expenses in May?");
  assert.equal(biggest.needsConfirmation, false);
  assert.equal(biggest.intent, "biggest");
  // ...an income answer is.
  const income = await ask(api, "how much income came in in May?");
  assert.equal(income.needsConfirmation, true);
  assert.deepEqual(income.candidates.map((candidate) => [candidate.kind, candidate.entryIds]), [["own_transfer", [move.outflowId, move.inflowId]]]);
  assert.deepEqual(income.candidates[0].suggestedActions.map((step) => step.action), ["link_transfer"]);
  // Splits balances are changed only by a settle-up, not an own-account move.
  assert.equal((await ask(api, "who owes who?")).needsConfirmation, false);

  // A settle-up holds up the Splits answer too.
  await seedSettlementPayNow(api, db);
  const owed = await ask(api, "what do I owe Serene?");
  assert.equal(owed.needsConfirmation, true);
  assert.deepEqual(owed.candidates.map((candidate) => candidate.kind), ["settlement"]);
});

test("a compare question checks both months", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await setUpHousehold(api);
  await seedSettlementPayNow(api, db);
  const compare = await ask(api, "compare October 2025 with May 2026");
  assert.deepEqual(compare.months, ["2025-10", "2026-05"]);
  assert.equal(compare.needsConfirmation, true);
  assert.equal(compare.candidates[0].kind, "settlement");
});
