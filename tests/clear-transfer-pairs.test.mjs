// Which unlinked transfer pairs are "clear" (zero doubt): the pure rule that
// "Link these N clear pairs" on Check my books uses (docs/audits/ledger-
// checkup.md, "Clear pairs"). A pair is clear only when each side has exactly
// one possible match on the other account and it is the other side of the pair,
// so a third same-amount entry within a week on either account keeps both
// pairs out. Every pair it returns must also be a HIGH finding of the check-up.
import assert from "node:assert/strict";
import test from "node:test";

import { findClearTransferPairs } from "../src/domain/ledger-checkup/clear-transfer-pairs.ts";
import { detectUnmatchedTransfers } from "../src/domain/ledger-checkup/unmatched-transfers.ts";
import { hashFacts } from "../src/domain/ledger-checkup/helpers.ts";
import { checkupContext, transfer } from "./support/ledger-checkup-facts.mjs";

const context = checkupContext();

// What the loader hands over: the unlinked transfers, and every unlinked entry
// of the same amount within a week on another account (the transfers among
// them too).
function facts(transfers, extra = []) {
  return {
    transfers,
    candidates: [
      ...transfers.map((item) => ({ ...item, entryType: "transfer" })),
      ...extra
    ]
  };
}
const extraEntry = (id, accountId, date, amountMinor, entryType, direction = null, extra = {}) => ({
  id, accountId, date, description: "OTHER", amountMinor, currency: "SGD", direction, ownerPersonId: null, entryType, ...extra
});
const out = (id, date, amountMinor = 45_000, accountId = "acct-tim-bank", extra = {}) => transfer(id, accountId, date, amountMinor, "out", extra);
const into = (id, date, amountMinor = 45_000, accountId = "acct-joyce-bank", extra = {}) => transfer(id, accountId, date, amountMinor, "in", extra);
const ids = (pairs) => pairs.map((pair) => `${pair.fromEntryId}>${pair.toEntryId}`);

test("a mutual, unique pair is clear and says which side sent and which received", () => {
  const pairs = findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02")]), context);
  assert.deepEqual(pairs.map((pair) => ({ ...pair })), [{
    fromEntryId: "txn-out00001",
    toEntryId: "txn-in000001",
    fromAccountId: "acct-tim-bank",
    toAccountId: "acct-joyce-bank",
    date: "2026-10-01",
    toDate: "2026-10-02",
    amountMinor: 45_000,
    currency: "SGD",
    findingId: "unmatched_transfer:txn-in000001+txn-out00001",
    personIds: ["person-joyce", "person-tim"]
  }]);
  // Found from the receiving side first changes nothing.
  assert.deepEqual(ids(findClearTransferPairs(facts([into("txn-in000001", "2026-10-02"), out("txn-out00001", "2026-10-01")]), context)), ["txn-out00001>txn-in000001"]);
});

test("a third same-amount entry within a week on either account keeps the pair out", () => {
  const base = [out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02")];
  // A second transfer in of the same amount on another account.
  assert.deepEqual(findClearTransferPairs(facts(base, [extraEntry("txn-in000002", "acct-joint", "2026-10-04", 45_000, "transfer", "in")]), context), []);
  // Money in of the same amount (not a transfer): still a second possible match.
  assert.deepEqual(findClearTransferPairs(facts(base, [extraEntry("txn-inc00001", "acct-joint", "2026-10-03", 45_000, "income")]), context), []);
  // A purchase of the same amount next to the transfer out: the detector shrugs it off, a clear pair does not.
  assert.deepEqual(findClearTransferPairs(facts(base, [extraEntry("txn-exp00001", "acct-one", "2026-10-02", 45_000, "expense")]), context), []);
  // A second transfer out of the same amount from another account: the receiving side has two possible senders,
  // so neither pair is clear (both outs are in the transfers list as the loader would give them).
  const second = out("txn-out00002", "2026-10-03", 45_000, "acct-joint");
  assert.deepEqual(findClearTransferPairs(facts([...base, second]), context), []);
  // A lookalike on the sender's own account does not touch the receiving side but is the same-amount transfer
  // out within a week of this pair: the receiver sees both, so it is never clear.
  const sameAccount = out("txn-out00003", "2026-10-05");
  assert.deepEqual(findClearTransferPairs(facts([...base, sameAccount]), context), []);
  // Eight days away is outside the window and does not matter.
  assert.deepEqual(ids(findClearTransferPairs(facts(base, [extraEntry("txn-in000009", "acct-joint", "2026-10-10", 45_000, "transfer", "in")]), context)), ["txn-out00001>txn-in000001"]);
});

test("fourteen monthly $450 transfers: each month's pair is clear and none is ambiguous with its neighbours", () => {
  const months = Array.from({ length: 14 }, (_, index) => {
    const year = 2025 + Math.floor((6 + index) / 12);
    const month = ((6 + index) % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}-01`;
  });
  assert.deepEqual([months[0], months[13]], ["2025-07-01", "2026-08-01"]);
  const transfers = months.flatMap((date, index) => [
    out(`txn-out${String(index).padStart(5, "0")}`, date),
    into(`txn-in${String(index).padStart(6, "0")}`, `${date.slice(0, 8)}02`)
  ]);
  const pairs = findClearTransferPairs(facts(transfers), context);
  assert.equal(pairs.length, 14);
  assert.deepEqual(pairs.map((pair) => pair.date), months, "oldest first, the order they are linked in");
  assert.deepEqual(pairs.map((pair) => pair.fromEntryId), transfers.filter((item) => item.direction === "out").map((item) => item.id));

  // One month's rival two days after its transfer out takes that month out and leaves the other thirteen.
  const withRival = findClearTransferPairs(facts(transfers, [extraEntry("txn-rival001", "acct-joint", "2026-01-04", 45_000, "transfer", "in")]), context);
  assert.equal(withRival.length, 13);
  assert.ok(!withRival.some((pair) => pair.date === "2026-01-01"));
});

test("another amount or currency, the same direction, the same account, a young transfer, an investment account or an unknown one are not clear", () => {
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02", 45_001)]), context), []);
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02", 45_000, "acct-joyce-bank", { currency: "JPY" })]), context), []);
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), out("txn-out00002", "2026-10-02", 45_000, "acct-joyce-bank")]), context), []);
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02", 45_000, "acct-tim-bank")]), context), []);
  // Today is 2026-10-27: a side under a week old waits.
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-21"), into("txn-in000001", "2026-10-22")]), context), []);
  assert.equal(findClearTransferPairs(facts([out("txn-out00001", "2026-10-20"), into("txn-in000001", "2026-10-20")]), context).length, 1);
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02", 45_000, "acct-invest")]), context), []);
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02", 45_000, "acct-missing")]), context), []);
  // A transfer with no direction has no way round to judge.
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), transfer("txn-und00001", "acct-joyce-bank", "2026-10-02", 45_000, null)]), context), []);
  // The other side is not among the unlinked transfers the loader weighed (it is held, dismissed or past the limit).
  assert.deepEqual(findClearTransferPairs({ transfers: [out("txn-out00001", "2026-10-01")], candidates: [extraEntry("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "transfer", "in")] }, context), []);
  // Eight days apart is beyond the window.
  assert.deepEqual(findClearTransferPairs(facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-09")]), context), []);
});

test("a pair marked as fine stays out until its evidence changes; a side the read may have cut short stays out", () => {
  const input = facts([out("txn-out00001", "2026-10-01"), into("txn-in000001", "2026-10-02")]);
  const findingId = "unmatched_transfer:txn-in000001+txn-out00001";
  const evidenceKey = hashFacts(["high", "txn-in000001+txn-out00001", 45_000]);
  assert.deepEqual(findClearTransferPairs(input, context, { dismissals: new Map([[findingId, evidenceKey]]) }), []);
  assert.equal(findClearTransferPairs(input, context, { dismissals: new Map([[findingId, "0000stale"]]) }).length, 1);
  assert.deepEqual(findClearTransferPairs(input, context, { unreliableTransferIds: new Set(["txn-in000001"]) }), []);
});

test("every clear pair is a HIGH finding of the check-up, and a HIGH finding can be left out but never added", () => {
  const transfers = [
    out("txn-out00001", "2026-09-01"), into("txn-in000001", "2026-09-01"),
    out("txn-out00002", "2026-09-02", 12_300), into("txn-in000002", "2026-09-03", 12_300, "acct-joint"),
    out("txn-out00003", "2026-09-05", 9_900), into("txn-in000003", "2026-09-06", 9_900)
  ];
  const input = facts(transfers, [extraEntry("txn-exp00001", "acct-one", "2026-09-05", 9_900, "expense")]);
  const high = new Set(detectUnmatchedTransfers(input, context).filter((item) => item.tier === "high").map((item) => item.id));
  const clear = findClearTransferPairs(input, context);
  assert.deepEqual(clear.map((pair) => pair.findingId).sort(), ["unmatched_transfer:txn-in000001+txn-out00001", "unmatched_transfer:txn-in000002+txn-out00002"]);
  for (const pair of clear) assert.ok(high.has(pair.findingId));
  assert.ok(high.has("unmatched_transfer:txn-in000003+txn-out00003"), "the detector still calls the third a pair");
});
