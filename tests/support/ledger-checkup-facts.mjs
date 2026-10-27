// Hand-built read models for the Ledger check-up's pure detectors. Names are
// the demo household's (Tim and Joyce); every id, shop and amount is invented
// or a public merchant's name, nothing comes from a real statement.

export const TODAY = "2026-10-27";

const account = (id, name, kind, ownerPersonId, extra = {}) => ({
  id, name, kind, ownerPersonId, isJoint: false, isActive: true, currency: "SGD", openingBalanceMinor: 0, lastEntryDate: TODAY, ...extra
});

export function checkupContext(overrides = {}) {
  const accounts = new Map([
    account("acct-one", "UOB One Card", "credit_card", "person-tim"),
    account("acct-ladys", "UOB Lady's Card", "credit_card", "person-tim"),
    account("acct-tim-bank", "DBS Savings", "bank", "person-tim"),
    account("acct-joyce-bank", "OCBC 365", "bank", "person-joyce"),
    account("acct-joint", "Joint Account", "bank", null, { isJoint: true }),
    account("acct-invest", "StashAway", "investment", "person-tim"),
    account("acct-cash", "Wallet cash", "cash", "person-tim")
  ].map((item) => [item.id, item]));
  return {
    today: TODAY,
    accounts,
    people: new Map([["person-tim", "Tim"], ["person-joyce", "Joyce"]]),
    ...overrides
  };
}

export function emptyFacts(overrides = {}) {
  return {
    context: checkupContext(),
    wrongCard: { input: null },
    duplicateEntries: { pairs: [] },
    splitPairs: { pairs: [], deletedInSettled: [] },
    transfers: { transfers: [], candidates: [] },
    statements: { statements: [], segments: [], activity: [], chainBreaks: [], laterEntries: [] },
    estimates: { estimates: [], postingLagDays: {}, coverages: [] },
    plan: { rows: [], candidates: [] },
    hygiene: { otherEntries: [], oddEntries: [], categoryNames: [], rules: [], habits: [] },
    incomplete: [],
    ...overrides
  };
}

export function transfer(id, accountId, date, amountMinor, direction, extra = {}) {
  return { id, accountId, date, description: "FAST PAYMENT", amountMinor, currency: "SGD", direction, ownerPersonId: null, ...extra };
}

export function splitRecord(id, extra = {}) {
  return {
    id,
    kind: "expense",
    description: "Singapore Airlines flights",
    date: "2026-06-12",
    amountMinor: 105_184,
    currency: "SGD",
    groupId: "split-group-trip",
    groupName: "Okaeri trip",
    payerPersonId: "person-tim",
    toPersonId: null,
    linkedTransactionId: null,
    linkedEntry: null,
    shares: [{ personId: "person-tim", amountMinor: 52_592 }, { personId: "person-joyce", amountMinor: 52_592 }],
    coveredBy: null,
    createdAt: "2026-06-12T10:00:00Z",
    ...extra
  };
}

export function statement(accountId, month, extra = {}) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return {
    accountId,
    month,
    startDate: `${month}-01`,
    endDate: `${month}-${String(last).padStart(2, "0")}`,
    balanceMinor: 0,
    proven: true,
    certifiedAt: `${month}-28 10:00:00`,
    ...extra
  };
}

export function plannedRow(id, extra = {}) {
  return {
    id,
    month: "2026-10",
    section: "planned_items",
    personId: "person-tim",
    categoryId: "cat-home",
    categoryName: "Home",
    label: "House loan",
    planDate: "2026-10-05",
    plannedMinor: 45_000,
    actualMinor: 0,
    linkCount: 0,
    ...extra
  };
}

// The ledger entry a split record is linked to (the flight on Tim's card).
export const flightEntry = (extra = {}) => ({
  date: "2026-06-12", amountMinor: 105_184, currency: "SGD", entryType: "expense", description: "SINGAPORE AIRLINES SINGAPORE SG", ownerPersonId: "person-tim", ...extra
});
