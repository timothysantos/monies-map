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

// A transfer with a purpose stays visibly a transfer (DOMAIN.md "Transfer
// Purpose"): the household row says what it was for, and each person's row,
// read as spending or a payback in its category, names who it went to or
// came from. Hidden money changes none of these (they carry no amount).
test("a transfer with a purpose keeps a transfer chip in every view", async () => {
  const { readEntryForPerson } = await import("../src/domain/transfer-purpose.ts");
  const transfer = {
    id: "t1", date: "2026-10-01", description: "FAST to Joyce", accountName: "UOB Savings", accountOwnerLabel: "Tim",
    categoryName: "Transfer", entryType: "transfer", transferDirection: "out", ownershipType: "direct", ownerName: "Tim",
    amountMinor: 45000, offsetsCategory: false,
    linkedTransfer: { transactionId: "t1-in", accountName: "Joyce Bank", accountOwnerLabel: "Joyce", amountMinor: 45000, transactionDate: "2026-10-01" },
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 45000 }],
    transferPurpose: { categoryName: "Home", toPersonId: "person-joyce", toPersonName: "Joyce" }
  };
  const household = buildEntryRowDisplay(transfer, "household");
  assert.deepEqual([household.transferLabel, household.isTransferMatched, household.primarySignedAmountMinor], ["Matched transfer out · for Home", true, -45000]);
  const tim = buildEntryRowDisplay(readEntryForPerson(transfer, "person-tim"), "person-tim");
  assert.deepEqual([tim.transferLabel, tim.isTransferMatched, tim.amountTone, tim.primarySignedAmountMinor], ["Transfer to Joyce", true, "out", -45000]);
  const joyce = buildEntryRowDisplay(readEntryForPerson(transfer, "person-joyce"), "person-joyce");
  assert.deepEqual([joyce.transferLabel, joyce.amountTone, joyce.primarySignedAmountMinor], ["Tim's transfer to you", "in", 45000]);
  // Without a purpose nothing changes.
  const { transferPurpose: _purpose, ...plain } = transfer;
  assert.equal(buildEntryRowDisplay(plain, "household").transferLabel, "Matched transfer out");
});
