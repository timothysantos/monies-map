import assert from "node:assert/strict";
import test from "node:test";

import { buildEntryRowDisplay, getEntryOwnerCue, getSplitGroupChipStyle } from "../src/client/entry-row-display.js";

const sharedEntry = {
  id: "entry-shared",
  date: "2026-05-24",
  description: "CHEERS - KK HOSPITAL SINGAPORE",
  accountName: "UOB One Card",
  accountOwnerLabel: "Tim",
  categoryName: "Food & Drinks",
  entryType: "expense",
  ownershipType: "shared",
  amountMinor: 300,
  splits: [
    { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 150 },
    { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 150 }
  ]
};

test("legacy shared ledger rows do not use the Splits shared cue", () => {
  const display = buildEntryRowDisplay(sharedEntry, "person-tim", false);
  const ownerCue = getEntryOwnerCue(sharedEntry, false);

  assert.equal(display.ownerLabel, "Tim");
  assert.equal(display.ownerTitle, "Tim");
  assert.equal(display.ownerChipClassName, "entry-chip-owner");
  assert.equal(display.splitPercent, 50);
  assert.equal(ownerCue.style["--entry-owner-border-color"], "var(--cat-46788e, #46788E)");
});

test("linked split rows keep the Splits workspace label and cue", () => {
  const display = buildEntryRowDisplay({
    ...sharedEntry,
    ownershipType: "direct",
    ownerName: "Tim",
    linkedSplitExpenseId: "split-expense-1",
    linkedSplitGroupName: "Okaeri",
    linkedSplitShares: sharedEntry.splits
  }, "person-tim", true);
  const ownerCue = getEntryOwnerCue({ ...sharedEntry, ownershipType: "direct" }, true);

  assert.equal(display.ownerLabel, "On splits · Okaeri");
  assert.equal(display.ownerTitle, "On Splits: Okaeri");
  assert.equal(display.ownerChipClassName, "entry-chip-shared entry-chip-linked-split");
  assert.equal(display.linkedSplitGroupName, "Okaeri");
  assert.equal(display.splitPercent, 50);
  assert.deepEqual(display.linkedSplitGroupStyle, getSplitGroupChipStyle("Okaeri"));
  assert.equal(ownerCue.style["--entry-owner-border-color"], "var(--cat-bf7d51, #BF7D51)");
});

test("split group chip colors are stable per group name", () => {
  assert.deepEqual(getSplitGroupChipStyle("Okaeri"), getSplitGroupChipStyle("Okaeri"));
  assert.notDeepEqual(getSplitGroupChipStyle("Okaeri"), getSplitGroupChipStyle("B.River"));
});

const transferOut = {
  ...sharedEntry,
  id: "entry-transfer",
  description: "FAST TRANSFER TO POSB",
  accountName: "OCBC 360 Account",
  accountOwnerLabel: "Tim",
  categoryName: "Transfer",
  entryType: "transfer",
  transferDirection: "out",
  ownershipType: "direct",
  ownerName: "Tim"
};

test("a matched transfer row is the quiet kind and names the other wallet; an unmatched one is not", () => {
  const matched = buildEntryRowDisplay({ ...transferOut, linkedTransfer: { accountName: "POSB Joint Account" } }, "person-tim", false);
  assert.equal(matched.transferLabel, "Matched transfer out");
  assert.equal(matched.isTransferMatched, true);
  assert.equal(matched.transferDetail, "To POSB Joint Account");
  assert.equal(matched.accountDetail, "OCBC 360 Account - Tim");

  const unmatched = buildEntryRowDisplay(transferOut, "person-tim", false);
  assert.equal(unmatched.transferLabel, "Transfer out");
  assert.equal(unmatched.isTransferMatched, false);

  const expense = buildEntryRowDisplay(sharedEntry, "person-tim", false);
  assert.equal(expense.transferLabel, null);
  assert.equal(expense.isTransferMatched, false);
});
