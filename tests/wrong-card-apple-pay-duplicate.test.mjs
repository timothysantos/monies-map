// Wrong-card Apple Pay duplicate (src/domain/wrong-card-apple-pay-duplicate.ts):
// the pure confidence rules. The first group is the real case, sanitized:
// three Apple Pay entries on UOB Lady's Card for purchases made with UOB One
// Card, whose own activity file holds the same three bank rows. The rest are
// adversarial: every way a flag could be wrong must end in no offer.
import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  assessWrongCardDuplicates,
  derivePostingLagDays,
  matchMerchants,
  readMerchantTokens,
  singaporeToday
} from "../src/domain/wrong-card-apple-pay-duplicate.ts";

const LADY = "acct-ladys-card";
const ONE = "acct-one-card";
const JOYCE_CARD = "acct-joyce-card";
const JOINT = "acct-joint";
const TODAY = "2026-10-15";

const accounts = new Map([
  [LADY, { id: LADY, name: "UOB Lady's Card", ownerPersonId: "person-tim", isJoint: false, currency: "SGD" }],
  [ONE, { id: ONE, name: "UOB One Card", ownerPersonId: "person-tim", isJoint: false, currency: "SGD" }],
  [JOYCE_CARD, { id: JOYCE_CARD, name: "Joyce UOB Card", ownerPersonId: "person-joyce", isJoint: false, currency: "SGD" }],
  [JOINT, { id: JOINT, name: "Joint card", ownerPersonId: null, isJoint: true, currency: "SGD" }]
]);

const apple = (id, accountId, date, description, amountMinor, extra = {}) => ({
  id, accountId, date, description, amountMinor, currency: "SGD", originalCurrency: null, ownerPersonId: "person-tim", hasLinks: false, ...extra
});
// A bank row in the ledger: an export row carries the purchase day as its
// date and the posted day beside it.
const bank = (id, accountId, date, description, amountMinor, extra = {}) => ({
  id, accountId, date, postDate: date, description, amountMinor, currency: "SGD", entryType: "expense", transferGroupId: null,
  originalCurrency: null, isBankRow: true, isPaired: false, isOpenApplePay: false, importedAt: "2026-10-14 09:00:00", ...extra
});
const fileRow = (rowId, accountId, date, description, amountMinor, postDate = null) => ({ rowId, accountId, date, postDate, description, amountMinor, currency: "SGD" });
const ladyFileCoverage = { accountId: LADY, first: "2026-07-13", last: "2026-10-13", referenceDate: TODAY, kind: "this_file" };

function assess(overrides) {
  return assessWrongCardDuplicates({
    entries: [],
    ledger: [],
    fileRows: [],
    listedEntryIds: new Set(),
    coverages: [ladyFileCoverage],
    accounts,
    postingLagDays: () => 3,
    ...overrides
  });
}

const REAL_ENTRIES = [
  apple("e-cold", LADY, "2026-10-11", "Cold Storage-Star Vist", 180),
  apple("e-fresh", LADY, "2026-10-11", "CS Fresh", 970),
  apple("e-fairprice", LADY, "2026-10-11", "FairPrice finest", 784)
];
const ONE_CARD_ROWS = [
  bank("b-cold", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180),
  bank("b-fresh", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 970),
  bank("b-fairprice", ONE, "2026-10-11", "FAIRPRICE FINEST-STAR VISTA SINGAPORE SG", 784)
];

test("the real case: three Apple Pay entries on the wrong card are each offered with HIGH confidence", () => {
  const result = assess({ entries: REAL_ENTRIES, ledger: ONE_CARD_ROWS });
  assert.deepEqual(result.map((item) => [item.entryId, item.confidence, item.twin?.id]), [
    ["e-cold", "high", "b-cold"],
    ["e-fresh", "high", "b-fresh"],
    ["e-fairprice", "high", "b-fairprice"]
  ]);
  for (const item of result) {
    assert.ok(item.score >= 75 && item.score <= 100, `score ${item.score}`);
    assert.deepEqual(item.blockers, []);
    assert.deepEqual(item.reasons, [
      "file_covers_date", "older_than_posting_lag", "no_same_amount_row_on_card", "exact_amount", "same_currency",
      "twin_one_to_one", "date_within_2_days", "merchant_strong", "no_splits_or_links"
    ]);
    assert.equal(item.coverage.kind, "this_file");
  }
  // Wrong card amounts add up to the 19.34 the card is overstated by.
  assert.equal(REAL_ENTRIES.reduce((sum, entry) => sum + entry.amountMinor, 0), 1934);
});

test("the real case in the other order: the One Card file arrives second and its rows are the twins", () => {
  // Lady's file was imported earlier (its window is a past import's); the
  // One Card file is the one being previewed now.
  const earlier = { accountId: LADY, first: "2026-07-13", last: "2026-10-13", referenceDate: "2026-10-14", kind: "earlier_import", importedAt: "2026-10-14 08:00:00" };
  const result = assess({
    entries: REAL_ENTRIES,
    coverages: [earlier],
    fileRows: ONE_CARD_ROWS.map((row) => fileRow(`preview-${row.id}`, ONE, row.date, row.description, row.amountMinor))
  });
  assert.deepEqual(result.map((item) => [item.confidence, item.twin?.kind, item.coverage.kind]), [
    ["high", "this_file", "earlier_import"], ["high", "this_file", "earlier_import"], ["high", "this_file", "earlier_import"]
  ]);
});

test("the real case in the first order: the Lady's file arrives second against One Card rows already saved", () => {
  const result = assess({ entries: REAL_ENTRIES, ledger: ONE_CARD_ROWS, coverages: [ladyFileCoverage] });
  assert.deepEqual(result.map((item) => item.confidence), ["high", "high", "high"]);
  assert.deepEqual(result.map((item) => item.twin.kind), ["ledger", "ledger", "ledger"]);
});

test("an Apple Pay entry the card's file lists is never flagged, even with a lookalike on the other card", () => {
  const result = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], listedEntryIds: new Set(["e-cold"]) });
  assert.equal(result[0].confidence, "low");
  assert.ok(result[0].blockers.includes("listed_in_file"));
});

test("a same-amount row on the entry's own card, in the ledger or in the file, stops the offer", () => {
  const inLedger = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0], bank("a-row", LADY, "2026-10-12", "SOME OTHER SHOP SG", 180)] });
  assert.equal(inLedger[0].confidence, "low");
  assert.ok(inLedger[0].blockers.includes("same_amount_row_on_card"));
  const inFile = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], fileRows: [fileRow("preview-9", LADY, "2026-10-09", "NEW ROW UNRELATED", 180)] });
  assert.equal(inFile[0].confidence, "low");
  // Four days away is not a neighbour.
  const farAway = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0], bank("a-row", LADY, "2026-10-06", "SOME OTHER SHOP SG", 180)] });
  assert.equal(farAway[0].confidence, "high");
});

test("genuine same-amount purchases on both cards the same day resolve to no offer", () => {
  // The same 7.90 coffee on both cards: the Lady's Card file lists its own.
  const entry = apple("e-coffee", LADY, "2026-10-11", "Toast Box", 790);
  const result = assess({
    entries: [entry],
    ledger: [bank("b-one", ONE, "2026-10-11", "TOAST BOX SINGAPORE SG", 790), bank("b-lady", LADY, "2026-10-11", "TOAST BOX SINGAPORE SG", 790)],
    listedEntryIds: new Set(["e-coffee"])
  });
  assert.equal(result[0].confidence, "low");
  // Even when the entry were not listed, the card's own row stops it.
  const unlisted = assess({
    entries: [entry],
    ledger: [bank("b-one", ONE, "2026-10-11", "TOAST BOX SINGAPORE SG", 790), bank("b-lady", LADY, "2026-10-11", "TOAST BOX SINGAPORE SG", 790)]
  });
  assert.equal(unlisted[0].confidence, "low");
});

test("a daily repeat on the other card is never picked from: several twins means no offer", () => {
  const entry = apple("e-coffee", LADY, "2026-10-11", "Toast Box", 790);
  const result = assess({
    entries: [entry],
    ledger: [
      bank("b-10", ONE, "2026-10-10", "TOAST BOX SINGAPORE SG", 790),
      bank("b-11", ONE, "2026-10-11", "TOAST BOX SINGAPORE SG", 790),
      bank("b-12", ONE, "2026-10-12", "TOAST BOX SINGAPORE SG", 790)
    ]
  });
  assert.equal(result[0].confidence, "low");
  assert.ok(result[0].blockers.includes("several_twins"));
});

test("two Apple Pay entries and one twin: neither entry is offered", () => {
  const result = assess({
    entries: [apple("e-one", LADY, "2026-10-10", "Toast Box", 790), apple("e-two", LADY, "2026-10-11", "Toast Box", 790)],
    ledger: [bank("b-11", ONE, "2026-10-11", "TOAST BOX SINGAPORE SG", 790)]
  });
  assert.deepEqual(result.map((item) => item.confidence), ["low", "low"]);
  for (const item of result) {
    assert.ok(item.blockers.includes("twin_contested"));
  }
});

test("an open Apple Pay entry on the twin's own card claims the bank row first", () => {
  const result = assess({
    entries: [REAL_ENTRIES[0]],
    ledger: [ONE_CARD_ROWS[0], {
      id: "e-own", accountId: ONE, date: "2026-10-11", postDate: null, description: "Cold Storage", amountMinor: 180, currency: "SGD",
      entryType: "expense", transferGroupId: null, originalCurrency: null, isBankRow: false, isPaired: false, isOpenApplePay: true, importedAt: null
    }]
  });
  assert.equal(result[0].confidence, "low");
  assert.ok(result[0].blockers.includes("twin_contested"));
});

test("a bank row already paired with its own Apple Pay entry is not a twin", () => {
  const paired = { ...ONE_CARD_ROWS[0], isPaired: true };
  const result = assess({ entries: [REAL_ENTRIES[0]], ledger: [paired] });
  assert.equal(result[0].confidence, "low");
  assert.equal(result[0].twin, null);
});

test("equal amounts with unrelated merchants have no twin", () => {
  const result = assess({ entries: [REAL_ENTRIES[0]], ledger: [bank("b-x", ONE, "2026-10-11", "NETFLIX.COM SINGAPORE SG", 180)] });
  assert.equal(result[0].confidence, "low");
  assert.equal(result[0].twin, null);
});

test("dates: two days apart is HIGH, three days apart a note, four days apart nothing", () => {
  const at = (date) => assess({ entries: [REAL_ENTRIES[0]], ledger: [bank("b", ONE, date, "COLD STORAGE-STAR VISTA SINGAPORE SG", 180)] })[0];
  assert.equal(at("2026-10-13").confidence, "high");
  const three = at("2026-10-14");
  assert.equal(three.confidence, "medium");
  assert.deepEqual(three.blockers, ["date_three_days_apart"]);
  assert.equal(at("2026-10-15").confidence, "low");
  assert.equal(at("2026-10-15").twin, null);
  // The bank's posted day counts as well as the purchase day.
  const posted = assess({ entries: [REAL_ENTRIES[0]], ledger: [bank("b", ONE, "2026-10-08", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180, { postDate: "2026-10-12" })] })[0];
  assert.equal(posted.confidence, "high");
});

test("another amount or another currency is not the same purchase", () => {
  const entry = REAL_ENTRIES[0];
  const dearer = assess({ entries: [entry], ledger: [bank("b", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 181)] })[0];
  assert.equal(dearer.twin, null);
  const dollars = assess({ entries: [entry], ledger: [bank("b", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180, { currency: "USD" })] })[0];
  assert.equal(dollars.twin, null);
});

test("foreign currency estimates are never HIGH: their amount is a guess at the day's rate", () => {
  const estimate = apple("e-grab", LADY, "2026-10-11", "GrabFood Burger", 3606, { originalCurrency: "IDR" });
  const equal = assess({ entries: [estimate], ledger: [bank("b", ONE, "2026-10-11", "GRABFOOD BURGER SINGAPORE SG", 3606)] })[0];
  assert.equal(equal.confidence, "medium");
  assert.ok(equal.blockers.includes("foreign_estimate"));
  // The rate differs: the amounts differ, so there is no twin at all.
  const rateDiffers = assess({ entries: [estimate], ledger: [bank("b", ONE, "2026-10-11", "GRABFOOD BURGER SINGAPORE SG", 3750)] })[0];
  assert.equal(rateDiffers.twin, null);
  // A row an estimate already updated is the user's purchase, not a loose bank row.
  const updatedEstimate = assess({ entries: [REAL_ENTRIES[0]], ledger: [bank("b", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180, { originalCurrency: "IDR" })] })[0];
  assert.equal(updatedEstimate.twin, null);
});

test("an entry newer than the card's usual posting lag is not offered, and a longer lag waits longer", () => {
  const fresh = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], coverages: [{ ...ladyFileCoverage, referenceDate: "2026-10-13" }] })[0];
  assert.equal(fresh.confidence, "low");
  assert.ok(fresh.blockers.includes("within_posting_lag"));
  const slowCard = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], postingLagDays: () => 5 })[0];
  assert.equal(slowCard.confidence, "low");
  assert.ok(slowCard.blockers.includes("within_posting_lag"));
  const exactlyLag = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], coverages: [{ ...ladyFileCoverage, referenceDate: "2026-10-14" }] })[0];
  assert.equal(exactlyLag.confidence, "high");
});

test("a file that does not cover the day says nothing", () => {
  const after = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], coverages: [{ ...ladyFileCoverage, last: "2026-10-10" }] })[0];
  assert.equal(after.confidence, "low");
  assert.ok(after.blockers.includes("not_covered_by_file"));
  const before = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], coverages: [{ ...ladyFileCoverage, first: "2026-10-12" }] })[0];
  assert.ok(before.blockers.includes("not_covered_by_file"));
  const otherCard = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], coverages: [{ ...ladyFileCoverage, accountId: ONE }] })[0];
  assert.ok(otherCard.blockers.includes("not_covered_by_file"));
  const none = assess({ entries: [REAL_ENTRIES[0]], ledger: [ONE_CARD_ROWS[0]], coverages: [] })[0];
  assert.equal(none.confidence, "low");
});

test("an entry linked to a split or a plan is only ever a note", () => {
  const linked = assess({ entries: [{ ...REAL_ENTRIES[0], hasLinks: true }], ledger: [ONE_CARD_ROWS[0]] })[0];
  assert.equal(linked.confidence, "medium");
  assert.deepEqual(linked.blockers, ["has_links"]);
});

test("a partial shop-name match is a note, not an offer", () => {
  const entry = apple("e-grab", LADY, "2026-10-11", "Grab", 1250);
  const result = assess({ entries: [entry], ledger: [bank("b", ONE, "2026-10-11", "GRAB* A-5XYZ123 SINGAPORE SG", 1250)] })[0];
  assert.equal(result.confidence, "medium");
  assert.deepEqual(result.blockers, ["merchant_partial"]);
});

test("owners: a card of someone else is a note; a shared card and the same person are not", () => {
  const onJoyce = assess({ entries: [REAL_ENTRIES[0]], ledger: [bank("b", JOYCE_CARD, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180)] })[0];
  assert.equal(onJoyce.confidence, "medium");
  assert.deepEqual(onJoyce.blockers, ["different_owner"]);
  const onJoint = assess({ entries: [REAL_ENTRIES[0]], ledger: [bank("b", JOINT, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180)] })[0];
  assert.equal(onJoint.confidence, "high");
  // The entry is on a shared card: the twin on a person's card is compatible.
  const fromJoint = assess({
    entries: [apple("e-joint", JOINT, "2026-10-11", "Cold Storage-Star Vist", 180, { ownerPersonId: null })],
    ledger: [ONE_CARD_ROWS[0]],
    coverages: [{ ...ladyFileCoverage, accountId: JOINT }]
  })[0];
  assert.equal(fromJoint.confidence, "high");
});

test("transfers and money in are never twins", () => {
  const entry = REAL_ENTRIES[0];
  const transfer = assess({ entries: [entry], ledger: [bank("b", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180, { transferGroupId: "group-1" })] })[0];
  assert.equal(transfer.twin, null);
  const income = assess({ entries: [entry], ledger: [bank("b", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180, { entryType: "income" })] })[0];
  assert.equal(income.twin, null);
  const manual = assess({ entries: [entry], ledger: [bank("b", ONE, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180, { isBankRow: false })] })[0];
  assert.equal(manual.twin, null);
});

test("a twin on the entry's own card is never a twin", () => {
  const result = assess({ entries: [REAL_ENTRIES[0]], ledger: [bank("b", LADY, "2026-10-11", "COLD STORAGE-STAR VISTA SINGAPORE SG", 180)] })[0];
  assert.equal(result.twin, null);
});

test("an entry with no twin anywhere is simply not mentioned (no twin, LOW)", () => {
  const result = assess({ entries: REAL_ENTRIES, ledger: [] });
  assert.deepEqual(result.map((item) => [item.confidence, item.twin]), [["low", null], ["low", null], ["low", null]]);
});

test("merchant matching: shortened Apple Pay names, shop aliases and noise words", () => {
  assert.deepEqual(readMerchantTokens("COLD STORAGE-STAR VISTA SINGAPORE SG"), ["cold", "storage", "star", "vista"]);
  assert.equal(matchMerchants("Cold Storage-Star Vist", "COLD STORAGE-STAR VISTA SINGAPORE SG").strong, true);
  assert.equal(matchMerchants("CS Fresh", "COLD STORAGE-STAR VISTA SINGAPORE SG").strong, true);
  assert.equal(matchMerchants("FairPrice finest", "FAIRPRICE FINEST-STAR VISTA SINGAPORE SG").strong, true);
  assert.equal(matchMerchants("Starbucks", "STARBUCKS COFFEE SINGAPORE SG").strong, true);
  assert.equal(matchMerchants("Grab", "GRAB* A-5XYZ123 SINGAPORE SG").strong, false);
  assert.equal(matchMerchants("Cold Storage", "NETFLIX.COM").matched, 0);
  // A shared bare place name is not a shared shop.
  assert.equal(matchMerchants("Singapore Zoo", "SINGAPORE FLYER").matched, 0);
  assert.equal(matchMerchants("", "COLD STORAGE").matched, 0);
});

test("posting lag: at least three days, a card's slower history lengthens it, never past a week", () => {
  assert.equal(derivePostingLagDays([]), 3);
  assert.equal(derivePostingLagDays([1, 2, 1]), 3);
  assert.equal(derivePostingLagDays([2, 5, 3]), 5);
  assert.equal(derivePostingLagDays([30]), 7);
  assert.equal(derivePostingLagDays([Number.NaN, -2, 4]), 4);
  // Only the last twenty count.
  assert.equal(derivePostingLagDays([...Array(20).fill(1), 6]), 3);
});

test("dates: Singapore's today and date arithmetic", () => {
  assert.equal(singaporeToday(Date.parse("2026-10-14T17:00:00Z")), "2026-10-15");
  assert.equal(singaporeToday(Date.parse("2026-10-14T15:59:00Z")), "2026-10-14");
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
});
