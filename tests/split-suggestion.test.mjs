// Split suggestion (DOMAIN.md "Split Suggestion"): when a new expense looks
// like the ones its payer usually puts on Splits, suggest the split group,
// the share and the other person. Pure and deterministic: the household's
// own last 12 months, the same shop first, else the same category, and only
// when enough of those entries went to one group with one share.
import assert from "node:assert/strict";
import test from "node:test";

import { SPLIT_SUGGESTION_POLICY, suggestSplitForEntry } from "../src/domain/split-suggestion.ts";

const TIM = { id: "person-tim", name: "Tim" };
const JOYCE = { id: "person-joyce", name: "Joyce" };
const SHARE_PEOPLE = [TIM, JOYCE];
const GROUPS = [
  { id: "split-group-none", name: "Non-group expenses", currency: "SGD" },
  { id: "split-group-home", name: "Home", currency: "SGD" },
  { id: "split-group-trip", name: "Japan trip", currency: "JPY" },
  { id: "split-group-baby", name: "Baby River", currency: "SGD" }
];

const target = (overrides = {}) => ({
  entryType: "expense",
  description: "NTUC FairPrice Bukit Timah",
  categoryName: "Groceries",
  ownerPersonId: TIM.id,
  currency: "SGD",
  date: "2026-10-12",
  ...overrides
});

let nextId = 0;
function past(overrides = {}) {
  nextId += 1;
  return {
    entryId: `txn-${nextId}`,
    date: "2026-08-01",
    entryType: "expense",
    description: "NTUC FAIRPRICE BUKIT TIMAH",
    categoryName: "Groceries",
    ownerPersonId: TIM.id,
    split: null,
    ...overrides
  };
}

function split(groupId, timBasisPoints = 5000, { payer = TIM.id, other = JOYCE.id } = {}) {
  return {
    groupId,
    payerPersonId: payer,
    shares: [
      { personId: TIM.id, basisPoints: timBasisPoints },
      { personId: other, basisPoints: 10000 - timBasisPoints }
    ]
  };
}

const suggest = (history, overrides = {}) => suggestSplitForEntry({
  target: target(overrides),
  history,
  groups: GROUPS,
  sharePeople: SHARE_PEOPLE
});

test("the thresholds are the documented ones", () => {
  assert.deepEqual(SPLIT_SUGGESTION_POLICY, {
    lookbackDays: 365,
    description: { minEvidence: 2, minShare: 0.6 },
    category: { minEvidence: 4, minShare: 0.75 }
  });
});

test("the same shop split 50/50 in one group three times out of four suggests that group", () => {
  const history = [
    past({ split: split("split-group-home") }),
    past({ date: "2026-06-03", split: split("split-group-home") }),
    past({ date: "2026-02-11", description: "NTUC FairPrice  Bukit-Timah", split: split("split-group-home") }),
    past({ date: "2026-01-20" })
  ];
  assert.deepEqual(suggest(history), {
    groupId: "split-group-home",
    groupName: "Home",
    basisPoints: 5000,
    otherPersonId: JOYCE.id,
    otherPersonName: "Joyce",
    evidenceCount: 3,
    matchedCount: 4,
    matchedBy: "description"
  });
});

test("the share is the payer's: Tim paying 70/30 twice suggests 7000", () => {
  const history = [
    past({ split: split("split-group-baby", 7000) }),
    past({ split: split("split-group-baby", 7000) })
  ];
  assert.equal(suggest(history)?.basisPoints, 7000);
  assert.equal(suggest(history)?.groupId, "split-group-baby");
});

test("a share stored with its cent rounding counts as the whole percent", () => {
  // $24.01 split evenly is stored as 49.98% / 50.02%.
  const history = [
    past({ split: split("split-group-home", 4998) }),
    past({ split: split("split-group-home", 5000) }),
    past({ split: split("split-group-home", 5002) })
  ];
  assert.equal(suggest(history)?.basisPoints, 5000);
  assert.equal(suggest(history)?.evidenceCount, 3);
});

test("a split with no group suggests Non-group expenses", () => {
  const history = [past({ split: split(null) }), past({ split: split(null) })];
  assert.equal(suggest(history)?.groupId, "split-group-none");
  assert.equal(suggest(history)?.groupName, "Non-group expenses");
});

test("too little history: one split entry is not enough, nor two out of four", () => {
  assert.equal(suggest([past({ split: split("split-group-home") })]), null);
  assert.equal(suggest([
    past({ split: split("split-group-home") }),
    past({ split: split("split-group-home") }),
    past(),
    past()
  ]), null);
  assert.equal(suggest([]), null);
});

test("history older than 12 months, or after the entry's day, does not count", () => {
  const history = [
    past({ date: "2025-10-11", split: split("split-group-home") }),
    past({ date: "2025-09-01", split: split("split-group-home") }),
    past({ date: "2026-10-13", split: split("split-group-home") })
  ];
  assert.equal(suggest(history), null);
  // The window's first day still counts.
  assert.equal(suggest([past({ date: "2025-10-12", split: split("split-group-home") }), past({ split: split("split-group-home") })])?.evidenceCount, 2);
});

test("different people: someone else's purchases at the shop do not count for Tim", () => {
  const history = [
    past({ ownerPersonId: JOYCE.id, split: split("split-group-home", 5000, { payer: JOYCE.id }) }),
    past({ ownerPersonId: JOYCE.id, split: split("split-group-home", 5000, { payer: JOYCE.id }) })
  ];
  assert.equal(suggest(history), null);
});

test("never across people outside the pair Splits shares with", () => {
  // Shared with a third person: not a share the Splits switch can make.
  const history = [
    past({ split: split("split-group-home", 5000, { other: "person-guest" }) }),
    past({ split: split("split-group-home", 5000, { other: "person-guest" }) })
  ];
  assert.equal(suggest(history), null);
  // An owner who is not one of the two share people gets nothing.
  assert.equal(suggestSplitForEntry({
    target: target({ ownerPersonId: "person-guest" }),
    history: [past({ ownerPersonId: "person-guest", split: split("split-group-home") }), past({ ownerPersonId: "person-guest", split: split("split-group-home") })],
    groups: GROUPS,
    sharePeople: SHARE_PEOPLE
  }), null);
  // A household with one person has no one to split with.
  assert.equal(suggestSplitForEntry({
    target: target(),
    history: [past({ split: split("split-group-home") }), past({ split: split("split-group-home") })],
    groups: GROUPS,
    sharePeople: [TIM]
  }), null);
});

test("never for income or a transfer, and income history never counts", () => {
  const history = [past({ split: split("split-group-home") }), past({ split: split("split-group-home") })];
  assert.equal(suggest(history, { entryType: "income" }), null);
  assert.equal(suggest(history, { entryType: "transfer" }), null);
  assert.equal(suggest([
    past({ entryType: "income", split: split("split-group-home") }),
    past({ entryType: "transfer", split: split("split-group-home") })
  ]), null);
});

test("an entry already on Splits gets no suggestion, and is never its own evidence", () => {
  const history = [past({ split: split("split-group-home") }), past({ split: split("split-group-home") })];
  assert.equal(suggest(history, { onSplits: true }), null);
  const own = past({ entryId: "txn-self", date: "2026-10-12", split: split("split-group-home") });
  assert.equal(suggest([own, past({ split: split("split-group-home") })], { entryId: "txn-self" }), null);
});

test("mixed groups or mixed shares: no single habit, no suggestion", () => {
  assert.equal(suggest([
    past({ split: split("split-group-home") }),
    past({ split: split("split-group-home") }),
    past({ split: split("split-group-baby") }),
    past({ split: split("split-group-baby") })
  ]), null);
  assert.equal(suggest([
    past({ split: split("split-group-home", 5000) }),
    past({ split: split("split-group-home", 7000) }),
    past({ split: split("split-group-home", 5000) }),
    past({ split: split("split-group-home", 7000) })
  ]), null);
});

test("a group in another currency than the entry's is never suggested (the split route refuses it)", () => {
  const history = [past({ split: split("split-group-trip") }), past({ split: split("split-group-trip") })];
  assert.equal(suggest(history), null);
  assert.equal(suggest(history, { currency: "JPY" })?.groupId, "split-group-trip");
});

test("a group that no longer exists is never suggested", () => {
  const history = [past({ split: split("split-group-gone") }), past({ split: split("split-group-gone") })];
  assert.equal(suggest(history), null);
});

test("a split someone else paid for is not Tim's habit", () => {
  const history = [
    past({ split: split("split-group-home", 5000, { payer: JOYCE.id }) }),
    past({ split: split("split-group-home", 5000, { payer: JOYCE.id }) })
  ];
  assert.equal(suggest(history), null);
});

test("with no history at the shop, the category decides, more strictly", () => {
  const groceries = (n, withSplit) => Array.from({ length: n }, (_, index) => past({
    description: `Grocer ${index}`,
    split: withSplit ? split("split-group-home") : null
  }));
  // Four of five groceries split in Home: 80%.
  assert.deepEqual(suggest([...groceries(4, true), ...groceries(1, false)]), {
    groupId: "split-group-home",
    groupName: "Home",
    basisPoints: 5000,
    otherPersonId: JOYCE.id,
    otherPersonName: "Joyce",
    evidenceCount: 4,
    matchedCount: 5,
    matchedBy: "category"
  });
  // Three split is too few for a category, and 4 of 6 (67%) too weak.
  assert.equal(suggest(groceries(3, true)), null);
  assert.equal(suggest([...groceries(4, true), ...groceries(2, false)]), null);
});

test("the shop's own history wins: a shop never split is not rescued by its category", () => {
  const history = [
    past(),
    past(),
    ...Array.from({ length: 6 }, (_, index) => past({ description: `Grocer ${index}`, split: split("split-group-home") }))
  ];
  assert.equal(suggest(history), null);
});

test("Other and the income categories never stand in for a shop", () => {
  const others = Array.from({ length: 6 }, (_, index) => past({ description: `Thing ${index}`, categoryName: "Other", split: split("split-group-home") }));
  assert.equal(suggest(others, { description: "Something new", categoryName: "Other" }), null);
});

test("a blank description falls back to the category", () => {
  const groceries = Array.from({ length: 4 }, (_, index) => past({ description: `Grocer ${index}`, split: split("split-group-home") }));
  assert.equal(suggest(groceries, { description: "   " })?.matchedBy, "category");
});
