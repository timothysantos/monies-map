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
  assert.match(ownerCue.style["--entry-owner-border-color"], /116, 198, 157/);
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
  assert.match(ownerCue.style["--entry-owner-border-color"], /37, 99, 235/);
});

test("split group chip colors are stable per group name", () => {
  assert.deepEqual(getSplitGroupChipStyle("Okaeri"), getSplitGroupChipStyle("Okaeri"));
  assert.notDeepEqual(getSplitGroupChipStyle("Okaeri"), getSplitGroupChipStyle("B.River"));
});
