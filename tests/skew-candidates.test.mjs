// Skew candidates (DOMAIN.md "Skew Candidate"): ledger entries that are most
// likely a split settlement between household members or a move between one
// person's own accounts, but are still counted as spending or income. The
// finder is pure and deterministic: exact amount, a short date window, the
// account owners, and never an entry that is already linked.
import assert from "node:assert/strict";
import test from "node:test";

import { deriveSkewGroupBalances, findSkewCandidates } from "../src/domain/skew-candidates.ts";

const ETHAN = { id: "person-ethan", name: "Ethan" };
const SERENE = { id: "person-serene", name: "Serene" };
const PEOPLE = [ETHAN, SERENE];

const ACCOUNTS = [
  { id: "acct-ocbc-360", name: "OCBC 360 Account", ownerPersonId: ETHAN.id, isJoint: false, currency: "SGD" },
  { id: "acct-uob-one", name: "UOB One Account", ownerPersonId: ETHAN.id, isJoint: false, currency: "SGD" },
  { id: "acct-dbs-serene", name: "DBS Multiplier Account", ownerPersonId: SERENE.id, isJoint: false, currency: "SGD" },
  { id: "acct-posb-joint", name: "POSB Joint Account", isJoint: true, currency: "SGD" }
];

const OWNER_BY_ACCOUNT = Object.fromEntries(ACCOUNTS.map((account) => [account.id, account.ownerPersonId]));
const NAME_BY_PERSON = { [ETHAN.id]: ETHAN.name, [SERENE.id]: SERENE.name };

function entry({ id, date, accountId, entryType, categoryName, amountMinor, description = id, transferDirection, ...extra }) {
  const account = ACCOUNTS.find((item) => item.id === accountId);
  const ownerId = OWNER_BY_ACCOUNT[accountId];
  return {
    id,
    date,
    description,
    accountId,
    accountName: account.name,
    accountOwnerLabel: ownerId ? NAME_BY_PERSON[ownerId] : "Shared",
    categoryName,
    entryType,
    ...(transferDirection ? { transferDirection } : {}),
    ownershipType: "direct",
    ownerName: ownerId ? NAME_BY_PERSON[ownerId] : undefined,
    amountMinor,
    offsetsCategory: false,
    splits: ownerId ? [{ personId: ownerId, personName: NAME_BY_PERSON[ownerId], ratioBasisPoints: 10000, amountMinor }] : [],
    ...extra
  };
}

// Simplified settlement: Ethan pays Serene $182.45, settled on 10 May.
const CHECKPOINT = {
  id: "split-checkpoint-may",
  fromPersonId: ETHAN.id,
  fromPersonName: ETHAN.name,
  toPersonId: SERENE.id,
  toPersonName: SERENE.name,
  amountMinor: 18245,
  currency: "SGD",
  settlementDate: "2026-05-10",
  status: "open",
  matchedAmountMinor: 0,
  matchedTransfers: [],
  includedRecordCount: 4,
  includedRecordIds: []
};

const payerOutflow = (overrides = {}) => entry({
  id: "entry-paynow-out",
  date: "2026-05-13",
  accountId: "acct-ocbc-360",
  entryType: "expense",
  categoryName: "Other",
  amountMinor: 18245,
  description: "PAYNOW TRANSFER TO SERENE",
  ...overrides
});

const payeeInflow = (overrides = {}) => entry({
  id: "entry-paynow-in",
  date: "2026-05-13",
  accountId: "acct-dbs-serene",
  entryType: "income",
  categoryName: "Other - Income",
  amountMinor: 18245,
  description: "PAYNOW FROM ETHAN",
  ...overrides
});

function find(overrides = {}) {
  return findSkewCandidates({
    month: "2026-05",
    viewId: "household",
    scope: "direct_plus_shared",
    entries: [],
    alreadyLinkedEntryIds: [],
    accounts: ACCOUNTS,
    people: PEOPLE,
    settlementCheckpoints: [CHECKPOINT],
    groupBalances: [],
    ...overrides
  });
}

const outflowSnapshot = {
  id: "entry-paynow-out",
  date: "2026-05-13",
  description: "PAYNOW TRANSFER TO SERENE",
  accountId: "acct-ocbc-360",
  accountName: "OCBC 360 Account",
  ownerPersonId: ETHAN.id,
  entryType: "expense",
  categoryName: "Other",
  amountMinor: 18245,
  inMonth: true
};

const inflowSnapshot = {
  id: "entry-paynow-in",
  date: "2026-05-13",
  description: "PAYNOW FROM ETHAN",
  accountId: "acct-dbs-serene",
  accountName: "DBS Multiplier Account",
  ownerPersonId: SERENE.id,
  entryType: "income",
  categoryName: "Other - Income",
  amountMinor: 18245,
  inMonth: true
};

// ------------------------------------------------------------- settlements

test("a settlement paid between two members, both sides unlinked, is one high-confidence candidate", () => {
  const result = find({ entries: [payerOutflow(), payeeInflow()] });

  assert.deepEqual(result, {
    candidates: [{
      id: "settlement:split-checkpoint-may:entry-paynow-out:entry-paynow-in",
      kind: "settlement",
      confidence: "high",
      amountMinor: 18245,
      currency: "SGD",
      fromPerson: ETHAN,
      toPerson: SERENE,
      settlement: { source: "settlement_checkpoint", checkpointId: "split-checkpoint-may", anchorDate: "2026-05-10" },
      bothSidesFound: true,
      entryIds: ["entry-paynow-out", "entry-paynow-in"],
      outflowEntry: outflowSnapshot,
      inflowEntry: inflowSnapshot,
      reasons: [
        { code: "same_amount", amountMinor: 18245 },
        { code: "days_from_settlement", entryId: "entry-paynow-out", days: 3 },
        { code: "days_from_settlement", entryId: "entry-paynow-in", days: 3 },
        { code: "payer_account", entryId: "entry-paynow-out", personId: ETHAN.id, personName: "Ethan", accountName: "OCBC 360 Account" },
        { code: "payee_account", entryId: "entry-paynow-in", personId: SERENE.id, personName: "Serene", accountName: "DBS Multiplier Account" },
        { code: "counterparty_named", entryId: "entry-paynow-out", personName: "Serene" },
        { code: "counterparty_named", entryId: "entry-paynow-in", personName: "Ethan" },
        { code: "counted_as_spending", entryId: "entry-paynow-out", categoryName: "Other" },
        { code: "counted_as_income", entryId: "entry-paynow-in", categoryName: "Other - Income" }
      ],
      skew: { spendingMinor: 18245, incomeMinor: 18245 },
      suggestedActions: [
        { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: "entry-paynow-out", toEntryId: "entry-paynow-in" } },
        { action: "match_settlement_checkpoint", method: "POST", path: "/api/splits/checkpoints/match", body: { checkpointId: "split-checkpoint-may", transactionId: "entry-paynow-out" } }
      ]
    }],
    totals: { spendingMinor: 18245, incomeMinor: 18245 },
    omittedCandidateCount: 0
  });
});

test("only the payer's side imported: one-sided candidate that refiles the entry as a transfer, then matches", () => {
  const result = find({ entries: [payerOutflow()] });

  assert.equal(result.candidates.length, 1);
  const [candidate] = result.candidates;
  assert.equal(candidate.id, "settlement:split-checkpoint-may:entry-paynow-out:-");
  assert.equal(candidate.bothSidesFound, false);
  assert.equal(candidate.confidence, "high");
  assert.deepEqual(candidate.entryIds, ["entry-paynow-out"]);
  assert.deepEqual(candidate.outflowEntry, outflowSnapshot);
  assert.equal(candidate.inflowEntry, undefined);
  assert.deepEqual(candidate.skew, { spendingMinor: 18245, incomeMinor: 0 });
  assert.deepEqual(candidate.suggestedActions, [
    {
      action: "reclassify_as_transfer",
      method: "POST",
      path: "/api/entries/update-classification",
      body: { entryId: "entry-paynow-out", entryType: "transfer", transferDirection: "out", categoryName: "Transfer" }
    },
    { action: "match_settlement_checkpoint", method: "POST", path: "/api/splits/checkpoints/match", body: { checkpointId: "split-checkpoint-may", transactionId: "entry-paynow-out" } }
  ]);
  assert.deepEqual(result.totals, { spendingMinor: 18245, incomeMinor: 0 });
});

// A group balance of $42 Ethan owes Serene, last open activity on 2 May.
const BALI_BALANCE = {
  groupId: "split-group-bali",
  groupName: "Bali trip",
  currency: "SGD",
  amountMinor: 4200,
  fromPersonId: ETHAN.id,
  toPersonId: SERENE.id,
  lastActivityDate: "2026-05-02"
};
const unnamedBaliOutflow = () => entry({ id: "entry-bali-out", date: "2026-05-06", accountId: "acct-ocbc-360", entryType: "expense", categoryName: "Other", amountMinor: 4200, description: "FAST PAYMENT 0412" });

test("a one-sided group-balance payment whose description names nobody is only medium confidence, shown only when asked for", () => {
  const entries = [unnamedBaliOutflow()];

  // Hidden by default: one side and no name is too weak to show.
  assert.deepEqual(find({ entries, settlementCheckpoints: [], groupBalances: [BALI_BALANCE] }), { candidates: [], totals: { spendingMinor: 0, incomeMinor: 0 }, omittedCandidateCount: 0 });

  const result = find({ entries, settlementCheckpoints: [], groupBalances: [BALI_BALANCE], includeMedium: true });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "settlement:split-group-bali:entry-bali-out:-");
  assert.equal(result.candidates[0].confidence, "medium");
  assert.equal(result.candidates[0].bothSidesFound, false);
  assert.equal(result.candidates[0].reasons.some((reason) => reason.code === "counterparty_named"), false);
  assert.deepEqual(result.totals, { spendingMinor: 4200, incomeMinor: 0 });
});

test("a one-sided checkpoint payment is high even when it names nobody: Money insights offers the same payment", () => {
  // internal-moves.ts: the exact remaining amount of an open checkpoint in
  // its window is the settlement's payment candidate on Splits, so Ask's
  // check must not hide it.
  const result = find({ entries: [payerOutflow({ description: "FAST PAYMENT 0412" })] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "settlement:split-checkpoint-may:entry-paynow-out:-");
  assert.equal(result.candidates[0].confidence, "high");
  assert.equal(result.candidates[0].reasons.some((reason) => reason.code === "counterparty_named"), false);
});

test("negative: hiding medium settlements keeps named one-sided settlements and medium own transfers", () => {
  // A one-sided group-balance payment that names the payee is high confidence and always shown.
  const named = find({ entries: [{ ...unnamedBaliOutflow(), description: "PAYNOW SERENE BALI" }], settlementCheckpoints: [], groupBalances: [BALI_BALANCE] });
  assert.equal(named.candidates.length, 1);
  assert.equal(named.candidates[0].confidence, "high");

  // A hidden medium settlement still holds its entry, so the same entry is
  // never offered as something else depending on the filter.
  const hidden = find({
    settlementCheckpoints: [],
    groupBalances: [BALI_BALANCE],
    entries: [
      unnamedBaliOutflow(),
      entry({ id: "entry-uob-in", date: "2026-05-06", accountId: "acct-uob-one", entryType: "income", categoryName: "Salary", amountMinor: 4200 })
    ]
  });
  assert.deepEqual(hidden.candidates, []);
  // Medium own transfers stay: see "two equally close receiving entries" below.
});

test("an amount one cent off the settlement is not a candidate", () => {
  const result = find({ entries: [payerOutflow({ amountMinor: 18244 }), payeeInflow({ amountMinor: 18244 })] });

  assert.deepEqual(result, { candidates: [], totals: { spendingMinor: 0, incomeMinor: 0 }, omittedCandidateCount: 0 });
});

test("a payment from 5 days before to 14 days after the settlement date is inside the window; a day more is outside", () => {
  const outside = find({ entries: [payerOutflow({ date: "2026-05-25" }), payeeInflow({ date: "2026-05-04" })] });
  assert.deepEqual(outside.candidates, []);

  const inside = find({ entries: [payerOutflow({ date: "2026-05-24" }), payeeInflow({ date: "2026-05-05" })] });
  assert.equal(inside.candidates.length, 1);
  assert.equal(inside.candidates[0].bothSidesFound, true);
});

test("entries already linked as a transfer, to a settle-up or to a checkpoint are never candidates", () => {
  const linkedPair = find({
    entries: [
      payerOutflow({ entryType: "transfer", transferDirection: "out", categoryName: "Transfer", linkedTransfer: { transactionId: "entry-paynow-in", accountName: "DBS Multiplier Account", amountMinor: 18245, transactionDate: "2026-05-13" } }),
      payeeInflow({ entryType: "transfer", transferDirection: "in", categoryName: "Transfer", linkedTransfer: { transactionId: "entry-paynow-out", accountName: "OCBC 360 Account", amountMinor: 18245, transactionDate: "2026-05-13" } })
    ]
  });
  assert.deepEqual(linkedPair.candidates, []);

  // A transfer group whose counterpart is outside the loaded dates, or a
  // settle-up link: the loader names these ids.
  const linkedElsewhere = find({ entries: [payerOutflow(), payeeInflow()], alreadyLinkedEntryIds: ["entry-paynow-out", "entry-paynow-in"] });
  assert.deepEqual(linkedElsewhere.candidates, []);

  const splitLinked = find({ entries: [payerOutflow({ linkedSplitExpenseId: "split-expense-1" })] });
  assert.deepEqual(splitLinked.candidates, []);

  const matchedElsewhere = find({
    entries: [payerOutflow()],
    settlementCheckpoints: [
      CHECKPOINT,
      { ...CHECKPOINT, id: "split-checkpoint-april", status: "matched", matchedAmountMinor: 18245, matchedTransfers: [{ transactionId: "entry-paynow-out", transactionDate: "2026-05-13", description: "x", amountMinor: 18245, currency: "SGD" }] }
    ]
  });
  assert.deepEqual(matchedElsewhere.candidates, []);
});

test("a matched, reopened or offset checkpoint offers nothing; a partly matched one offers its remainder", () => {
  for (const status of ["matched", "reopened", "voided", "internally_offset"]) {
    assert.deepEqual(find({ entries: [payerOutflow()], settlementCheckpoints: [{ ...CHECKPOINT, status }] }).candidates, [], status);
  }

  const partly = find({
    entries: [payerOutflow({ amountMinor: 8245 })],
    settlementCheckpoints: [{ ...CHECKPOINT, status: "partially_matched", matchedAmountMinor: 10000 }]
  });
  assert.equal(partly.candidates.length, 1);
  assert.equal(partly.candidates[0].amountMinor, 8245);
});

test("the payment must run from the payer's account to the payee's account", () => {
  // Serene paying Ethan the same amount is the wrong direction for this settlement.
  const reversed = find({
    entries: [
      entry({ id: "out-serene", date: "2026-05-12", accountId: "acct-dbs-serene", entryType: "expense", categoryName: "Other", amountMinor: 18245 }),
      entry({ id: "in-ethan", date: "2026-05-12", accountId: "acct-uob-one", entryType: "income", categoryName: "Other - Income", amountMinor: 18245 })
    ]
  });
  assert.deepEqual(reversed.candidates, []);

  // A joint account belongs to neither person.
  const joint = find({ entries: [entry({ id: "out-joint", date: "2026-05-12", accountId: "acct-posb-joint", entryType: "expense", categoryName: "Other", amountMinor: 18245 })] });
  assert.deepEqual(joint.candidates, []);
});

test("an open group balance with no checkpoint matches a payment soon after the group's last activity", () => {
  const groupBalances = [{
    groupId: "split-group-bali",
    groupName: "Bali trip",
    currency: "SGD",
    amountMinor: 4200,
    fromPersonId: SERENE.id,
    toPersonId: ETHAN.id,
    lastActivityDate: "2026-05-02"
  }];
  const entries = [
    entry({ id: "out-serene", date: "2026-05-09", accountId: "acct-dbs-serene", entryType: "expense", categoryName: "Other", amountMinor: 4200, description: "PAYNOW ETHAN BALI" }),
    entry({ id: "in-ethan", date: "2026-05-09", accountId: "acct-uob-one", entryType: "income", categoryName: "Other - Income", amountMinor: 4200, description: "PAYNOW FROM SERENE" })
  ];
  const result = find({ entries, settlementCheckpoints: [], groupBalances });

  assert.equal(result.candidates.length, 1);
  const [candidate] = result.candidates;
  assert.equal(candidate.kind, "settlement");
  assert.deepEqual(candidate.settlement, { source: "group_balance", groupId: "split-group-bali", groupName: "Bali trip", anchorDate: "2026-05-02" });
  assert.deepEqual(candidate.fromPerson, SERENE);
  assert.deepEqual(candidate.toPerson, ETHAN);
  assert.deepEqual(candidate.skew, { spendingMinor: 4200, incomeMinor: 4200 });
  assert.deepEqual(candidate.reasons.find((reason) => reason.code === "days_from_settlement" && reason.entryId === "out-serene"), { code: "days_from_settlement", entryId: "out-serene", days: 7 });
  assert.deepEqual(candidate.suggestedActions, [
    { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: "out-serene", toEntryId: "in-ethan" } },
    {
      action: "record_group_settle_up",
      method: "POST",
      path: "/api/splits/settlements/create",
      body: { groupId: "split-group-bali", date: "2026-05-09", fromPersonName: "Serene", toPersonName: "Ethan", amountMinor: 4200, currency: "SGD", paymentMethod: "bank", paymentStatus: "recorded" },
      linkTransactionId: "out-serene"
    }
  ]);

  // Filed under Travel on both sides, the household's Travel spending nets to
  // zero (Ethan's inflow is a payback), but each person's view is skewed.
  const travelEntries = entries.map((item) => ({ ...item, categoryName: "Travel" }));
  assert.deepEqual(find({ entries: travelEntries, settlementCheckpoints: [], groupBalances }).candidates, []);
  assert.deepEqual(find({ viewId: SERENE.id, entries: travelEntries, settlementCheckpoints: [], groupBalances }).candidates.map((item) => item.skew), [{ spendingMinor: 4200, incomeMinor: 0 }]);
  assert.deepEqual(find({ viewId: ETHAN.id, entries: travelEntries, settlementCheckpoints: [], groupBalances }).candidates.map((item) => item.skew), [{ spendingMinor: -4200, incomeMinor: 0 }]);

  // Before the group's last activity, or long after it, is no candidate.
  assert.deepEqual(find({ entries, settlementCheckpoints: [], groupBalances: [{ ...groupBalances[0], lastActivityDate: "2026-05-10" }] }).candidates, []);
  assert.deepEqual(find({ entries, settlementCheckpoints: [], groupBalances: [{ ...groupBalances[0], lastActivityDate: "2026-04-20" }] }).candidates, []);
});

// -------------------------------------------------------- own transfers

const ownOutflow = (overrides = {}) => entry({
  id: "entry-ocbc-out",
  date: "2026-05-03",
  accountId: "acct-ocbc-360",
  entryType: "transfer",
  transferDirection: "out",
  categoryName: "Transfer",
  amountMinor: 50000,
  description: "PAYNOW TO UOB ONE",
  ...overrides
});

const ownInflow = (overrides = {}) => entry({
  id: "entry-uob-in",
  date: "2026-05-04",
  accountId: "acct-uob-one",
  entryType: "income",
  categoryName: "Salary",
  amountMinor: 50000,
  description: "PAYNOW FROM OCBC",
  ...overrides
});

test("a move between one person's accounts filed as Salary on the receiving side is an own transfer", () => {
  const result = find({ entries: [ownOutflow(), ownInflow()], settlementCheckpoints: [] });

  assert.deepEqual(result, {
    candidates: [{
      id: "own_transfer:entry-ocbc-out:entry-uob-in",
      kind: "own_transfer",
      confidence: "high",
      amountMinor: 50000,
      currency: "SGD",
      fromPerson: ETHAN,
      toPerson: ETHAN,
      bothSidesFound: true,
      entryIds: ["entry-ocbc-out", "entry-uob-in"],
      outflowEntry: {
        id: "entry-ocbc-out",
        date: "2026-05-03",
        description: "PAYNOW TO UOB ONE",
        accountId: "acct-ocbc-360",
        accountName: "OCBC 360 Account",
        ownerPersonId: ETHAN.id,
        entryType: "transfer",
        transferDirection: "out",
        categoryName: "Transfer",
        amountMinor: 50000,
        inMonth: true
      },
      inflowEntry: {
        id: "entry-uob-in",
        date: "2026-05-04",
        description: "PAYNOW FROM OCBC",
        accountId: "acct-uob-one",
        accountName: "UOB One Account",
        ownerPersonId: ETHAN.id,
        entryType: "income",
        categoryName: "Salary",
        amountMinor: 50000,
        inMonth: true
      },
      reasons: [
        { code: "same_amount", amountMinor: 50000 },
        { code: "days_apart", days: 1 },
        { code: "same_owner", personId: ETHAN.id, personName: "Ethan", fromAccountName: "OCBC 360 Account", toAccountName: "UOB One Account" },
        { code: "counted_as_income", entryId: "entry-uob-in", categoryName: "Salary" }
      ],
      skew: { spendingMinor: 0, incomeMinor: 50000 },
      suggestedActions: [
        { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: "entry-ocbc-out", toEntryId: "entry-uob-in" } }
      ]
    }],
    totals: { spendingMinor: 0, incomeMinor: 50000 },
    omittedCandidateCount: 0
  });
});

test("the same amount between two different people's accounts is not an own transfer", () => {
  const result = find({
    entries: [ownOutflow(), ownInflow({ accountId: "acct-dbs-serene" })],
    settlementCheckpoints: []
  });

  assert.deepEqual(result.candidates, []);
});

test("an own transfer needs both sides unlinked, within three days, and something counted", () => {
  // Four days apart.
  assert.deepEqual(find({ entries: [ownOutflow(), ownInflow({ date: "2026-05-07" })], settlementCheckpoints: [] }).candidates, []);
  // Into the joint account.
  assert.deepEqual(find({ entries: [ownOutflow(), ownInflow({ accountId: "acct-posb-joint" })], settlementCheckpoints: [] }).candidates, []);
  // Both sides already filed as (unlinked) transfers: nothing is counted, so
  // it belongs to the unresolved transfer review, not here.
  assert.deepEqual(find({ entries: [ownOutflow(), ownInflow({ entryType: "transfer", transferDirection: "in", categoryName: "Transfer" })], settlementCheckpoints: [] }).candidates, []);
  // The receiving side already linked elsewhere.
  assert.deepEqual(find({ entries: [ownOutflow(), ownInflow()], alreadyLinkedEntryIds: ["entry-uob-in"], settlementCheckpoints: [] }).candidates, []);
  // Same account on both sides.
  assert.deepEqual(find({ entries: [ownOutflow(), ownInflow({ accountId: "acct-ocbc-360" })], settlementCheckpoints: [] }).candidates, []);
});

test("two equally close receiving entries make the own transfer medium confidence, paired by date then id", () => {
  const result = find({
    entries: [ownOutflow(), ownInflow({ id: "entry-uob-in-b" }), ownInflow({ id: "entry-uob-in-a" })],
    settlementCheckpoints: []
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].confidence, "medium");
  assert.deepEqual(result.candidates[0].entryIds, ["entry-ocbc-out", "entry-uob-in-a"]);
});

// ----------------------------------------------------- months and views

test("only the month's entries count: a pair across the month end skews only the month holding the counted side", () => {
  const entries = [ownOutflow({ date: "2026-04-30" }), ownInflow({ date: "2026-05-01" })];

  const may = find({ entries, settlementCheckpoints: [] });
  assert.equal(may.candidates.length, 1);
  assert.equal(may.candidates[0].outflowEntry.inMonth, false);
  assert.equal(may.candidates[0].inflowEntry.inMonth, true);
  assert.deepEqual(may.totals, { spendingMinor: 0, incomeMinor: 50000 });

  // April holds only the uncounted transfer-out side: nothing skews April.
  assert.deepEqual(find({ month: "2026-04", entries, settlementCheckpoints: [] }).candidates, []);
});

test("a person view shows only that person's side of the skew", () => {
  const entries = [payerOutflow(), payeeInflow(), ownOutflow(), ownInflow()];

  const serene = find({ viewId: SERENE.id, entries });
  assert.deepEqual(serene.candidates.map((candidate) => [candidate.kind, candidate.skew]), [
    ["settlement", { spendingMinor: 0, incomeMinor: 18245 }]
  ]);

  const ethan = find({ viewId: ETHAN.id, entries });
  assert.deepEqual(ethan.candidates.map((candidate) => [candidate.kind, candidate.skew]), [
    ["own_transfer", { spendingMinor: 0, incomeMinor: 50000 }],
    ["settlement", { spendingMinor: 18245, incomeMinor: 0 }]
  ]);
  assert.deepEqual(ethan.totals, { spendingMinor: 18245, incomeMinor: 50000 });

  // Shared scope counts split shares only; these unlinked entries are direct.
  assert.deepEqual(find({ viewId: ETHAN.id, scope: "shared", entries }).candidates, []);
});

test("candidates are capped and the omitted count is reported, totals still cover every candidate", () => {
  const entries = [];
  for (let index = 0; index < 60; index += 1) {
    const suffix = String(index).padStart(2, "0");
    entries.push(ownOutflow({ id: `out-${suffix}`, amountMinor: 10000 + index }));
    entries.push(ownInflow({ id: `in-${suffix}`, amountMinor: 10000 + index }));
  }
  const result = find({ entries, settlementCheckpoints: [] });

  assert.equal(result.candidates.length, 50);
  assert.equal(result.omittedCandidateCount, 10);
  // Largest skew first.
  assert.equal(result.candidates[0].amountMinor, 10059);
  const expectedIncome = Array.from({ length: 60 }, (_, index) => 10000 + index).reduce((sum, value) => sum + value, 0);
  assert.deepEqual(result.totals, { spendingMinor: 0, incomeMinor: expectedIncome });
});

// ------------------------------------------------------ group balances

test("group balances come from the Splits projection seen by the first person", () => {
  const balances = deriveSkewGroupBalances({
    groups: [
      { id: "split-group-none", name: "Non-group expenses", balanceMinor: 0, currency: "SGD" },
      { id: "split-group-bali", name: "Bali trip", balanceMinor: 4200, currency: "SGD" },
      { id: "split-group-home", name: "Home", balanceMinor: -1550, currency: "SGD" }
    ],
    activity: [
      { groupId: "split-group-bali", date: "2026-05-02", settlementStatus: "open" },
      { groupId: "split-group-bali", date: "2026-05-20", settlementStatus: "settled" },
      { groupId: "split-group-bali", date: "2026-04-28", settlementStatus: "open" },
      { groupId: "split-group-home", date: "2026-05-06", settlementStatus: "open" }
    ],
    viewerPersonId: ETHAN.id,
    otherPersonId: SERENE.id
  });

  assert.deepEqual(balances, [
    { groupId: "split-group-bali", groupName: "Bali trip", currency: "SGD", amountMinor: 4200, fromPersonId: SERENE.id, toPersonId: ETHAN.id, lastActivityDate: "2026-05-02" },
    { groupId: "split-group-home", groupName: "Home", currency: "SGD", amountMinor: 1550, fromPersonId: ETHAN.id, toPersonId: SERENE.id, lastActivityDate: "2026-05-06" }
  ]);
});
