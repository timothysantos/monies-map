// Statement mismatch diagnosis (src/domain/statement-mismatch-diagnosis.ts):
// the pure explanation of each statement card's difference. The cards, rows
// and amounts follow the sanitized two-card UOB statement
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized):
// OPENAI and Buyandship are printed in the UOB One Card section, but the
// ledger has them, provisional, on UOB Lady's Card.
import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseStatementMismatches } from "../src/domain/statement-mismatch-diagnosis.ts";

const ONE = "acct-one-card";
const LADY = "acct-ladys-card";
const SAVINGS = "acct-uob-savings";
const JOYCE_CARD = "acct-joyce-card";

function accounts(overrides = {}) {
  return [
    { id: ONE, name: "UOB One Card", ownerPersonId: "person-tim", institutionId: "inst-uob", savedCheckpoints: [] },
    { id: LADY, name: "UOB Lady's Card", ownerPersonId: "person-tim", institutionId: "inst-uob", savedCheckpoints: overrides.ladySavedCheckpoints ?? [] },
    { id: SAVINGS, name: "UOB Savings", ownerPersonId: "person-tim", institutionId: "inst-uob", savedCheckpoints: [] },
    { id: JOYCE_CARD, name: "Joyce UOB Card", ownerPersonId: "person-joyce", institutionId: "inst-uob", savedCheckpoints: [] }
  ];
}

function card(accountId, deltaMinor, extra = {}) {
  return {
    accountId,
    accountName: accountId === ONE ? "UOB One Card" : "UOB Lady's Card",
    checkpointMonth: "2026-05",
    startDate: "2026-04-13",
    endDate: "2026-05-12",
    deltaMinor,
    supersededEntryIds: [],
    ...extra
  };
}

// A statement row as the preview reports it: posted date first, the
// statement's transaction date as the event date.
function row(rowIndex, accountId, postedDate, eventDate, description, amountMinor, extra = {}) {
  return {
    rowIndex,
    accountId,
    postedDate,
    eventDate,
    description,
    amountMinor,
    entryType: "expense",
    commitStatus: "included",
    commitStatusExplicit: false,
    reviewCandidateEntryIds: [],
    ...extra
  };
}

function entry(id, accountId, transactionDate, description, amountMinor, extra = {}) {
  return {
    id,
    accountId,
    transactionDate,
    postDate: null,
    note: null,
    description,
    amountMinor,
    entryType: "expense",
    transferDirection: null,
    bankCertificationStatus: "provisional",
    sourceType: "manual",
    transferGroupId: null,
    ...extra
  };
}

function uobStatementRows() {
  return [
    row(1, ONE, "2026-04-13", "2026-04-11", "HONG KONG ZHAI DIMI S Singapore", 1140, { targetEntryId: "txn-dim-sum" }),
    row(5, ONE, "2026-04-22", "2026-04-20", "OPENAI OPENAI.COM", 2949),
    row(6, LADY, "2026-05-02", "2026-04-30", "DON DON DONKI SINGAPORE", 1890, { targetEntryId: "txn-donki" }),
    row(9, ONE, "2026-05-06", "2026-05-05", "Buyandship Limited Hong Kong", 1313)
  ];
}

function uobLedger(extra = []) {
  return [
    entry("txn-dim-sum", ONE, "2026-04-11", "HONG KONG ZHAI DIM SUM", 1140),
    entry("txn-donki", LADY, "2026-04-30", "Don Don Donki", 1890),
    entry("txn-openai", LADY, "2026-04-20", "OpenAI", 2949),
    entry("txn-buyandship", LADY, "2026-05-05", "Buyandship", 1313),
    ...extra
  ];
}

function diagnose({ cards, statementRows = uobStatementRows(), ledgerEntries = uobLedger(), sourceType = "pdf", appliedFixes = [], accountOverrides } = {}) {
  return diagnoseStatementMismatches({
    sourceType,
    accounts: accounts(accountOverrides),
    // Lady's Card: the two One Card purchases add 42.62 owed (internal -4262).
    cards: cards ?? [card(ONE, 0), card(LADY, -4262)],
    statementRows,
    ledgerEntries,
    appliedFixes,
    rejectedFixes: []
  });
}

function finding(diagnosis, id) {
  const match = diagnosis.findings.find((item) => item.id === id);
  assert.ok(match, `expected finding ${id}; got ${diagnosis.findings.map((item) => item.id).join(", ")}`);
  return match;
}

function factCodes(item) {
  return item.facts.map((fact) => fact.code);
}

test("entries on the wrong sibling card are found with their rows, dates and the projected close", () => {
  const diagnosis = diagnose();

  const openai = finding(diagnosis, "wrong_account:txn-openai");
  assert.deepEqual({ ...openai, facts: undefined }, {
    id: "wrong_account:txn-openai",
    kind: "wrong_account",
    confidence: "high",
    accountId: LADY,
    relatedAccountId: ONE,
    effectMinor: 2949,
    entry: {
      id: "txn-openai",
      accountId: LADY,
      accountName: "UOB Lady's Card",
      description: "OpenAI",
      transactionDate: "2026-04-20",
      signedAmountMinor: -2949,
      bankCertificationStatus: "provisional"
    },
    statementRow: {
      rowIndex: 5,
      accountId: ONE,
      description: "OPENAI OPENAI.COM",
      transactionDate: "2026-04-20",
      postedDate: "2026-04-22",
      signedAmountMinor: -2949
    },
    facts: undefined,
    fix: { kind: "move_to_statement_account", entryId: "txn-openai", fromAccountId: LADY, toAccountId: ONE, statementRowIndex: 5 },
    applied: false
  });
  // The statement's transaction date matches; it posted two days later.
  assert.deepEqual(openai.facts, [
    { code: "same_amount" },
    { code: "same_merchant" },
    { code: "same_transaction_date" },
    { code: "posted_date_offset", days: 2 },
    { code: "same_owner" },
    { code: "only_candidate" },
    { code: "closes_statement" }
  ]);

  const buyandship = finding(diagnosis, "wrong_account:txn-buyandship");
  assert.equal(buyandship.confidence, "high");
  assert.equal(buyandship.effectMinor, 1313);
  assert.deepEqual(buyandship.fix, { kind: "move_to_statement_account", entryId: "txn-buyandship", fromAccountId: LADY, toAccountId: ONE, statementRowIndex: 9 });

  // Moving both removes 42.62 from Lady's Card's difference; One Card stays
  // closed, and without the moves its two rows would have been duplicates.
  assert.deepEqual(diagnosis.cards.map((item) => [item.accountId, item.deltaMinor, item.projectedDeltaMinor, item.unexplainedMinor, item.outcome]), [
    [ONE, 0, 0, 0, "resolved"],
    [LADY, -4262, 0, 0, "resolved"]
  ]);
  assert.equal(diagnosis.findings.length, 2);
});

test("a later-cycle entry stays provisional and is not part of the difference", () => {
  const diagnosis = diagnose({
    ledgerEntries: uobLedger([entry("txn-sabai", LADY, "2026-05-14", "Sabai Sabai - Valley P", 2049)])
  });

  assert.equal(diagnosis.findings.some((item) => item.entry?.id === "txn-sabai"), false);
  const lady = diagnosis.cards.find((item) => item.accountId === LADY);
  assert.equal(lady.laterStatementEntryCount, 1);
  assert.deepEqual(lady.laterStatementEntries, [{
    id: "txn-sabai",
    accountId: LADY,
    accountName: "",
    description: "Sabai Sabai - Valley P",
    transactionDate: "2026-05-14",
    signedAmountMinor: -2049,
    bankCertificationStatus: "provisional"
  }]);
  assert.equal(lady.outcome, "resolved");
});

test("an entry with a bank posted date still matches its statement row by transaction date", () => {
  // A mid-cycle export carried the posted date, so the entry has both lanes;
  // its text carries the bank's location suffix.
  const diagnosis = diagnose({
    ledgerEntries: uobLedger().map((item) => item.id === "txn-openai"
      ? { ...item, postDate: "2026-04-22", sourceType: "csv", description: "OPENAI OPENAI.COM SINGAPORE" }
      : item)
  });

  const openai = finding(diagnosis, "wrong_account:txn-openai");
  assert.equal(openai.confidence, "high");
  assert.ok(factCodes(openai).includes("same_transaction_date"));
});

test("an entry with no statement row anywhere is explained as not on this statement, without a fix", () => {
  const diagnosis = diagnose({
    cards: [card(ONE, 0), card(LADY, -4262 - 750)],
    ledgerEntries: uobLedger([entry("txn-taxi", LADY, "2026-04-25", "GRAB RIDE", 750)])
  });

  const taxi = finding(diagnosis, "not_on_statement:txn-taxi");
  assert.equal(taxi.confidence, "low");
  assert.equal(taxi.fix, undefined);
  assert.equal(taxi.effectMinor, 750);
  const lady = diagnosis.cards.find((item) => item.accountId === LADY);
  // The moves leave 7.50 the user must look at; every cent is accounted for.
  assert.deepEqual([lady.projectedDeltaMinor, lady.unexplainedMinor, lady.outcome], [-750, 0, "partially_resolved"]);
  // The moves no longer close the card on their own, so they need a closer look.
  assert.equal(finding(diagnosis, "wrong_account:txn-openai").confidence, "medium");
  assert.ok(factCodes(finding(diagnosis, "wrong_account:txn-openai")).includes("improves_statement"));
});

test("a second copy of a purchase already matched on another card is a duplicate, not a move", () => {
  // OPENAI is certified on One Card from its entry there; Lady's Card has a
  // second copy.
  const statementRows = uobStatementRows().map((item) => item.rowIndex === 5 ? { ...item, targetEntryId: "txn-openai-one" } : item);
  const diagnosis = diagnose({
    statementRows,
    cards: [card(ONE, 0), card(LADY, -4262)],
    ledgerEntries: uobLedger([entry("txn-openai-one", ONE, "2026-04-20", "OpenAI", 2949)])
  });

  const duplicate = finding(diagnosis, "duplicate_entry:txn-openai");
  assert.deepEqual([duplicate.confidence, duplicate.accountId, duplicate.relatedAccountId, duplicate.effectMinor, duplicate.fix], [
    "medium", LADY, ONE, 2949, undefined
  ]);
  assert.equal(diagnosis.findings.some((item) => item.id === "wrong_account:txn-openai"), false);
});

test("several equally plausible entries need a choice, so no move is high confidence", () => {
  // The same purchase sits on Lady's Card and on UOB Savings.
  const diagnosis = diagnose({
    ledgerEntries: uobLedger([entry("txn-openai-savings", SAVINGS, "2026-04-20", "OpenAI", 2949)])
  });

  const openai = diagnosis.findings.find((item) => item.statementRow?.rowIndex === 5);
  assert.equal(openai.confidence, "medium");
  assert.deepEqual(openai.facts.find((fact) => fact.code === "several_candidates"), { code: "several_candidates", count: 2 });
});

test("a certified entry or one inside a saved statement is protected from a move", () => {
  const certified = diagnose({
    ledgerEntries: uobLedger().map((item) => item.id === "txn-openai" ? { ...item, bankCertificationStatus: "statement_certified", sourceType: "pdf" } : item)
  });
  const certifiedFinding = finding(certified, "wrong_account:txn-openai");
  assert.deepEqual([certifiedFinding.confidence, certifiedFinding.fix], ["low", undefined]);

  // Lady's Card's April statement (closed 12 Apr) already covers an entry
  // dated 10 Apr, so moving it would change a saved statement.
  const closed = diagnose({
    accountOverrides: { ladySavedCheckpoints: [{ month: "2026-04", endDate: "2026-04-12" }] },
    statementRows: [row(5, ONE, "2026-04-12", "2026-04-10", "OPENAI OPENAI.COM", 2949)],
    cards: [card(ONE, 0), card(LADY, 0)],
    ledgerEntries: [entry("txn-openai", LADY, "2026-04-10", "OpenAI", 2949)]
  });
  const closedFinding = finding(closed, "wrong_account:txn-openai");
  assert.equal(closedFinding.fix, undefined);
  assert.ok(factCodes(closedFinding).includes("closed_statement_protects_entry"));

  const linked = diagnose({
    ledgerEntries: uobLedger().map((item) => item.id === "txn-openai" ? { ...item, transferGroupId: "transfer-1" } : item)
  });
  assert.equal(finding(linked, "wrong_account:txn-openai").fix, undefined);
});

test("a move between different owners is never high confidence", () => {
  const diagnosis = diagnose({
    cards: [card(ONE, 0)],
    ledgerEntries: [entry("txn-openai-joyce", JOYCE_CARD, "2026-04-20", "OpenAI", 2949)],
    statementRows: [row(5, ONE, "2026-04-22", "2026-04-20", "OPENAI OPENAI.COM", 2949)]
  });

  // Joyce's card is not on this statement and is not Tim's, so it is not
  // searched at all.
  assert.equal(diagnosis.findings.length, 0);

  const siblings = diagnose({
    cards: [card(ONE, 0), card(JOYCE_CARD, -2949, { accountName: "Joyce UOB Card" })],
    ledgerEntries: [entry("txn-openai-joyce", JOYCE_CARD, "2026-04-20", "OpenAI", 2949)],
    statementRows: [row(5, ONE, "2026-04-22", "2026-04-20", "OPENAI OPENAI.COM", 2949)]
  });
  const crossOwner = finding(siblings, "wrong_account:txn-openai-joyce");
  assert.equal(crossOwner.confidence, "medium");
  assert.ok(factCodes(crossOwner).includes("different_owner"));
});

test("an opening balance that differs from the statement's previous balance is its own part", () => {
  // The ledger says Lady's Card owed 0.00 before the cycle; the statement
  // printed a 12.50 credit.
  const diagnosis = diagnose({
    cards: [card(ONE, 0), card(LADY, -4262 - 1250, { priorLedgerBalanceMinor: 0, previousStatementBalanceMinor: 1250 })]
  });

  const gap = finding(diagnosis, `opening_balance_gap:${LADY}`);
  assert.deepEqual([gap.confidence, gap.effectMinor, gap.fix], ["medium", 1250, undefined]);
  const lady = diagnosis.cards.find((item) => item.accountId === LADY);
  assert.deepEqual([lady.projectedDeltaMinor, lady.unexplainedMinor], [-1250, 0]);
});

test("a statement row left out of the import explains its share of the difference", () => {
  const statementRows = [
    ...uobStatementRows(),
    row(7, LADY, "2026-05-03", "2026-05-03", "SHAW THEATRES SINGAPORE", 2800, { commitStatus: "skipped", commitStatusExplicit: true })
  ];
  const diagnosis = diagnose({ statementRows, cards: [card(ONE, 0), card(LADY, -4262 + 2800)] });

  const excluded = finding(diagnosis, "excluded_statement_row:7");
  assert.deepEqual([excluded.effectMinor, factCodes(excluded)], [-2800, ["excluded_by_you"]]);
  assert.equal(diagnosis.cards.find((item) => item.accountId === LADY).unexplainedMinor, 0);
});

test("an entry dated just before the statement closed with no posted date is deferred to the next statement", () => {
  const diagnosis = diagnose({
    cards: [card(ONE, 0), card(LADY, -4262 - 2049)],
    ledgerEntries: uobLedger([entry("txn-sabai", LADY, "2026-05-10", "Sabai Sabai - Valley P", 2049)])
  });

  const deferral = finding(diagnosis, "next_statement:txn-sabai");
  assert.deepEqual(deferral.fix, { kind: "defer_to_next_statement", entryId: "txn-sabai", accountId: LADY, postDate: "2026-05-13" });
  // Together with the two moves it closes the card exactly.
  assert.equal(deferral.confidence, "high");
  assert.deepEqual(deferral.facts, [{ code: "no_posted_date" }, { code: "near_statement_end", days: 2 }, { code: "closes_statement" }]);
});

test("approved moves are reported as applied and no longer suggested", () => {
  // The preview applied both moves: the entries are on One Card and the
  // statement rows certify them, so both cards close.
  const statementRows = uobStatementRows().map((item) => item.rowIndex === 5
    ? { ...item, targetEntryId: "txn-openai" }
    : item.rowIndex === 9 ? { ...item, targetEntryId: "txn-buyandship" } : item);
  const ledgerEntries = uobLedger().map((item) => ["txn-openai", "txn-buyandship"].includes(item.id) ? { ...item, accountId: ONE } : item);
  const appliedFixes = [
    { kind: "move_to_statement_account", entryId: "txn-openai", fromAccountId: LADY, toAccountId: ONE, statementRowIndex: 5 },
    { kind: "move_to_statement_account", entryId: "txn-buyandship", fromAccountId: LADY, toAccountId: ONE, statementRowIndex: 9 }
  ];
  const diagnosis = diagnose({ statementRows, ledgerEntries, appliedFixes, cards: [card(ONE, 0), card(LADY, 0)] });

  assert.deepEqual(diagnosis.findings.map((item) => [item.id, item.applied, item.entry.accountName]), [
    ["wrong_account:txn-openai", true, "UOB Lady's Card"],
    ["wrong_account:txn-buyandship", true, "UOB Lady's Card"]
  ]);
  assert.deepEqual(diagnosis.cards.map((item) => item.outcome), ["resolved", "resolved"]);
});

test("merchant text matches through punctuation, spacing and case; an unknown abbreviation needs review", () => {
  const punctuation = diagnose({
    cards: [card(ONE, 0), card(LADY, -1067)],
    statementRows: [row(3, ONE, "2026-05-01", "2026-04-30", "GUARDIAN-GREAT  WORLD", 1067)],
    ledgerEntries: [entry("txn-guardian", LADY, "2026-04-30", "guardian great world", 1067, { sourceType: "csv" })]
  });
  assert.equal(finding(punctuation, "wrong_account:txn-guardian").confidence, "high");

  // "FP XTRA VIVO" and "FairPrice Xtra VivoCity" share one word. A bank
  // export is not typed by hand, so that alone is not evidence.
  const abbreviation = diagnose({
    cards: [card(ONE, 0), card(LADY, -22679)],
    statementRows: [row(2, ONE, "2026-04-30", "2026-04-28", "FP XTRA VIVO", 22679)],
    ledgerEntries: [entry("txn-fp", LADY, "2026-04-28", "FairPrice Xtra VivoCity", 22679, { sourceType: "csv" })]
  });
  const fp = finding(abbreviation, "wrong_account:txn-fp");
  assert.deepEqual([fp.confidence, fp.fix], ["low", undefined]);

  // Typed by hand on the purchase day (a manual or Shortcut entry), the
  // shared word is enough, as in the preview's own matching.
  const manual = diagnose({
    cards: [card(ONE, 0), card(LADY, -22679)],
    statementRows: [row(2, ONE, "2026-04-30", "2026-04-28", "FP XTRA VIVO", 22679)],
    ledgerEntries: [entry("txn-fp", LADY, "2026-04-28", "FairPrice Xtra VivoCity", 22679)]
  });
  assert.equal(finding(manual, "wrong_account:txn-fp").confidence, "high");
});

test("low-value repeats far apart are separate purchases, not a wrong card", () => {
  const diagnosis = diagnose({
    cards: [card(ONE, 0), card(LADY, -394)],
    statementRows: [row(10, ONE, "2026-05-09", "2026-05-05", "BUS/MRT 000000000 SINGAPORE", 394)],
    ledgerEntries: [entry("txn-bus", LADY, "2026-05-01", "BUS/MRT", 394)]
  });

  assert.equal(diagnosis.findings.some((item) => item.kind === "wrong_account"), false);
  assert.equal(finding(diagnosis, "not_on_statement:txn-bus").confidence, "low");
});

test("a mid-cycle import gets explanations but never a fix", () => {
  const diagnosis = diagnose({ sourceType: "csv" });

  const openai = finding(diagnosis, "wrong_account:txn-openai");
  assert.equal(openai.fix, undefined);
  assert.equal(diagnosis.cards.find((item) => item.accountId === LADY).outcome, "needs_manual_review");
});
