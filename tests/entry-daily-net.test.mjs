import assert from "node:assert/strict";
import test from "node:test";

import { groupEntriesByDate } from "../src/client/entry-helpers.js";

function entry(overrides) {
  return {
    id: overrides.id,
    date: overrides.date ?? "2026-06-08",
    description: overrides.description ?? overrides.id,
    accountName: overrides.accountName ?? "Wallet",
    categoryName: overrides.categoryName ?? "Other",
    entryType: overrides.entryType ?? "expense",
    transferDirection: overrides.transferDirection,
    ownershipType: "direct",
    ownerName: overrides.ownerName ?? "Tim",
    amountMinor: overrides.amountMinor ?? 0,
    offsetsCategory: false,
    splits: [],
    linkedTransfer: overrides.linkedTransfer
  };
}

test("daily net ignores both sides of a matched transfer visible in the current scope", () => {
  const groups = groupEntriesByDate([
    entry({
      id: "transfer-out",
      entryType: "transfer",
      transferDirection: "out",
      amountMinor: 462602,
      linkedTransfer: { transactionId: "transfer-in", accountName: "Citi Rewards", amountMinor: 462602, transactionDate: "2026-06-08" }
    }),
    entry({
      id: "transfer-in",
      entryType: "transfer",
      transferDirection: "in",
      amountMinor: 462602,
      linkedTransfer: { transactionId: "transfer-out", accountName: "UOB One", amountMinor: 462602, transactionDate: "2026-06-08" }
    }),
    entry({
      id: "card-fee-reversal",
      entryType: "income",
      categoryName: "Fees",
      amountMinor: 10000
    }),
    entry({
      id: "shopping",
      entryType: "expense",
      categoryName: "Shopping",
      amountMinor: 2911
    })
  ]);

  assert.equal(groups[0].netMinor, 7089);
});

test("daily net counts a matched transfer when only one side is visible", () => {
  const transferInGroup = groupEntriesByDate([
    entry({
      id: "transfer-in",
      entryType: "transfer",
      transferDirection: "in",
      amountMinor: 24168,
      linkedTransfer: { transactionId: "transfer-out", accountName: "UOB One", amountMinor: 24168, transactionDate: "2026-06-08" }
    })
  ]);
  const transferOutGroup = groupEntriesByDate([
    entry({
      id: "transfer-out",
      entryType: "transfer",
      transferDirection: "out",
      amountMinor: 24168,
      linkedTransfer: { transactionId: "transfer-in", accountName: "Citi Miles", amountMinor: 24168, transactionDate: "2026-06-08" }
    })
  ]);

  assert.equal(transferInGroup[0].netMinor, 24168);
  assert.equal(transferOutGroup[0].netMinor, -24168);
});
