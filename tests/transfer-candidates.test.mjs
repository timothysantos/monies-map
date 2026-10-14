// The one rule set for "which entry is the other side of this transfer"
// (src/domain/transfer-candidates.ts): the Entries dialog's loaded rows, the
// server's Recheck matches and Ask all call it, so these tests pin the rule
// once and prove the client helper gives the same answer.
import assert from "node:assert/strict";
import test from "node:test";

import { getTransferMatchCandidates } from "../src/client/entry-helpers.js";
import { chooseTransferOptions, selectTransferCandidates, transferCandidateWindow } from "../src/domain/transfer-candidates.ts";

function row(id, extra = {}) {
  return { id, date: "2026-05-20", accountId: "acct-dbs", accountName: "DBS", amountMinor: 5_000, entryType: "income", ...extra };
}

const SUBJECT = { id: "me", date: "2026-05-20", accountId: "acct-uob", accountName: "UOB One", amountMinor: 5_000, transferDirection: "out" };

test("candidates: the same amount in another wallet, opposite direction first, then the closest date, then the wallet", () => {
  const entries = [
    row("same-wallet", { accountId: "acct-uob", accountName: "UOB One" }),
    row("other-amount", { amountMinor: 5_001 }),
    row("me", { accountId: "acct-uob", accountName: "UOB One" }),
    row("far", { date: "2026-05-27" }),
    row("near-b", { accountId: "acct-b", accountName: "Bank B", date: "2026-05-21" }),
    row("near-a", { accountId: "acct-a", accountName: "Bank A", date: "2026-05-21" }),
    row("same-direction", { entryType: "transfer", transferDirection: "out", date: "2026-05-20" }),
    row("opposite", { entryType: "transfer", transferDirection: "in", date: "2026-05-30" })
  ];
  assert.deepEqual(selectTransferCandidates(SUBJECT, entries).map((entry) => entry.id), ["opposite", "same-direction", "near-a", "near-b", "far"]);
  assert.deepEqual(selectTransferCandidates(SUBJECT, entries, 2).map((entry) => entry.id), ["opposite", "same-direction"]);
  // A split's total amount is what matches, not the viewer's share.
  assert.deepEqual(selectTransferCandidates(SUBJECT, [row("shared", { amountMinor: 2_500, totalAmountMinor: 5_000 })]).map((entry) => entry.id), ["shared"]);
});

test("candidates: rows without a wallet id are compared by wallet name; an unsaved entry (no id) excludes nothing by id", () => {
  const noIds = { date: "2026-05-20", accountName: "Cash", amountMinor: 5_000 };
  assert.deepEqual(selectTransferCandidates(noIds, [row("a", { accountId: undefined, accountName: "Cash" }), row("b", { accountId: undefined, accountName: "Tin" })]).map((entry) => entry.id), ["b"]);
  assert.deepEqual(selectTransferCandidates({ date: "2026-05-20", accountId: "acct-uob", amountMinor: 5_000 }, [row("x")]).map((entry) => entry.id), ["x"]);
});

test("window: a month either side of the entry's date", () => {
  assert.deepEqual(transferCandidateWindow("2026-05-20"), { start: "2026-04-19", endExclusive: "2026-06-21" });
});

test("the Entries dialog's client helper returns the shared rule's answer, five at most", () => {
  const entries = Array.from({ length: 8 }, (_, index) => row(`c${index}`, { accountId: `acct-${index}`, accountName: `Bank ${index}`, date: `2026-05-${String(21 + (index % 4)).padStart(2, "0")}` }));
  const subject = { id: "me", date: "2026-05-20", accountId: "acct-uob", accountName: "UOB One", amountMinor: 5_000, entryType: "expense", transferDirection: "out" };
  const expected = selectTransferCandidates(SUBJECT, entries).map((entry) => entry.id);
  assert.equal(expected.length, 8);
  assert.deepEqual(getTransferMatchCandidates(subject, entries).map((entry) => entry.id), expected.slice(0, 5));
});

test("choices: the best first and at most three more; a named wallet narrows; none there keeps the others and says so; a named day narrows", () => {
  const list = [
    row("a", { accountId: "acct-a" }),
    row("b", { accountId: "acct-b", date: "2026-05-21" }),
    row("c", { accountId: "acct-c" }),
    row("d", { accountId: "acct-d" }),
    row("e", { accountId: "acct-e" })
  ];
  assert.deepEqual(chooseTransferOptions(list), { options: list.slice(0, 4), walletMissed: false });
  assert.deepEqual(chooseTransferOptions(list, { walletId: "acct-b" }), { options: [list[1]], walletMissed: false });
  assert.deepEqual(chooseTransferOptions(list, { walletId: "acct-z" }), { options: list.slice(0, 4), walletMissed: true });
  assert.deepEqual(chooseTransferOptions([], { walletId: "acct-z" }), { options: [], walletMissed: true });
  assert.deepEqual(chooseTransferOptions(list, { date: "2026-05-21" }), { options: [list[1]], walletMissed: false });
  assert.deepEqual(chooseTransferOptions(list, { maxOthers: 1 }).options, list.slice(0, 2));
});
