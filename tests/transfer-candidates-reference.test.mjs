// A statement from an investment provider names its account number, and the
// bank row that paid it carries the same number in its text. The pick is the
// shared transfer-candidate ranking plus that reference as the strong signal
// (src/domain/transfer-candidates.ts), so there is one matcher.
import assert from "node:assert/strict";
import test from "node:test";

import { describesAccountReference, pickReferencedTransferCandidate } from "../src/domain/transfer-candidates.ts";

const GIRO = (reference) => `IBG GIRO COLL ${reference} IFAST FINANCIAL PL- ${reference}`;

function bankRow(id, extra = {}) {
  return {
    id,
    date: "2026-07-03",
    accountId: "acct-ocbc",
    accountName: "OCBC 360",
    amountMinor: 68_500,
    transferDirection: "out",
    description: GIRO("P0000194"),
    ...extra
  };
}

// The statement's contribution, already a transfer in on the investment account.
const SUBJECT = { date: "2026-07-08", accountId: "acct-ifast", accountName: "Alex iFAST", amountMinor: 68_500, transferDirection: "in" };

test("reference: the number is found whatever the spacing or case", () => {
  assert.equal(describesAccountReference("IBG GIRO COLL P0000194 IFAST FINANCIAL PL- P0000194", "P0000194"), true);
  assert.equal(describesAccountReference("ibg giro coll p 0000194", "P0000194"), true);
  assert.equal(describesAccountReference(GIRO("P0000192"), "P0000194"), false);
  assert.equal(describesAccountReference("COLL", ""), false);
});

test("pick: the bank row naming the account wins over a closer row that does not", () => {
  const entries = [
    bankRow("closer-no-reference", { date: "2026-07-08", description: "FAST PAYMENT transfer to a friend" }),
    bankRow("named", { date: "2026-07-03" })
  ];
  const pick = pickReferencedTransferCandidate(SUBJECT, entries, "P0000194");
  assert.deepEqual([pick.candidate.id, pick.basis], ["named", "reference"]);
});

test("pick: a row naming the other iFAST account is never offered, even with the same amount and date", () => {
  const entries = [bankRow("other-account", { description: GIRO("P0000192") })];
  assert.equal(pickReferencedTransferCandidate(SUBJECT, entries, "P0000194"), undefined);
});

test("pick: with the reference on two same-amount rows (two months) the closer date wins and a claimed row is skipped", () => {
  const entries = [
    bankRow("june", { date: "2026-06-12" }),
    bankRow("july", { date: "2026-07-03" })
  ];
  assert.equal(pickReferencedTransferCandidate(SUBJECT, entries, "P0000194").candidate.id, "july");
  assert.equal(pickReferencedTransferCandidate(SUBJECT, entries, "P0000194", new Set(["july"])).candidate.id, "june");
  assert.equal(pickReferencedTransferCandidate(SUBJECT, entries, "P0000194", new Set(["july", "june"])), undefined);
});

test("pick: without a reference only a lone amount-and-date match within ten days is offered", () => {
  const plain = (id, extra) => bankRow(id, { description: "GIRO PAYMENT", ...extra });
  const alone = pickReferencedTransferCandidate(SUBJECT, [plain("only")], "P0000194");
  assert.deepEqual([alone.candidate.id, alone.basis], ["only", "amount_and_date"]);
  // Two plausible rows: no guess.
  assert.equal(pickReferencedTransferCandidate(SUBJECT, [plain("a"), plain("b", { accountId: "acct-uob", accountName: "UOB One" })], "P0000194"), undefined);
  // Too far away without a reference.
  assert.equal(pickReferencedTransferCandidate(SUBJECT, [plain("late", { date: "2026-07-25" })], "P0000194"), undefined);
});

test("pick: the wrong amount, the investment account itself and the same direction are never a match", () => {
  const entries = [
    bankRow("wrong-amount", { amountMinor: 68_501 }),
    bankRow("same-account", { accountId: "acct-ifast" }),
    bankRow("same-direction", { transferDirection: "in" })
  ];
  assert.equal(pickReferencedTransferCandidate(SUBJECT, entries, "P0000194"), undefined);
});

test("pick: a withdrawal (transfer out of the investment account) pairs with the bank's money in", () => {
  const withdrawal = { ...SUBJECT, transferDirection: "out" };
  const entries = [bankRow("credit", { transferDirection: "in", description: "FAST PAYMENT IFAST FINANCIAL P0000194" })];
  assert.equal(pickReferencedTransferCandidate(withdrawal, entries, "P0000194").candidate.id, "credit");
});

test("pick: a reference match more than a month away is not offered", () => {
  assert.equal(pickReferencedTransferCandidate(SUBJECT, [bankRow("stale", { date: "2026-05-01" })], "P0000194"), undefined);
});
