// "Add to Splits" in the picked rows' bar (src/client/entry-pick-splits-model.js):
// which rows can go, the default group, the share choices and the preview
// line, the body the command takes, and the notice after.
import assert from "node:assert/strict";
import test from "node:test";

import {
  addedNotice,
  chosenAddBody,
  defaultSplitGroupId,
  needsAddConfirm,
  noneAddedReason,
  previewLine,
  shareChoicesFor,
  splitPeopleFor,
  splitsPlanFor
} from "../src/client/entry-pick-splits-model.js";
import { pickSplitsCopy } from "../src/client/copy/pick-splits-copy.js";

const row = (id, extra = {}) => ({ id, entryType: "expense", ownerName: "Tim", ...extra });
const people = [{ name: "Tim" }, { name: "Joyce" }];

test("only expenses not on Splits can go; the others are counted, not sent", () => {
  const plan = splitsPlanFor([
    row("a"),
    row("b", { ownerName: "Joyce" }),
    row("c", { linkedSplitExpenseId: "split-1" }),
    row("d", { entryType: "income" }),
    row("e", { entryType: "transfer" }),
    { id: "f", ledgerEntry: row("f-entry", { linkedSplitExpenseId: "split-2" }) }
  ]);
  assert.deepEqual(plan.ids, ["a", "b"]);
  assert.deepEqual(plan.payerNames.sort(), ["Joyce", "Tim"]);
  assert.equal(plan.alreadyOn, 2);
  assert.equal(plan.leftOut, 2);
  assert.deepEqual(splitsPlanFor([row("c", { linkedSplitExpenseId: "x" })]).ids, []);
});

test("the group starts on the one used last, else the default, else the first; one group is preselected", () => {
  const groups = [{ id: "g1", name: "Okaeri" }, { id: "g2", name: "Baby River", isDefault: true }, { id: "split-group-none", name: "Non-group" }];
  assert.equal(defaultSplitGroupId(groups, "g1"), "g1");
  assert.equal(defaultSplitGroupId(groups, "gone"), "g2");
  assert.equal(defaultSplitGroupId([{ id: "g1", name: "Okaeri" }, { id: "g3", name: "Trip" }], ""), "g1");
  assert.equal(defaultSplitGroupId([{ id: "only", name: "Okaeri" }], "other"), "only");
  assert.equal(defaultSplitGroupId([], ""), "");
});

test("one payer is named with the other person; two payers say 'the other person'", () => {
  assert.deepEqual(splitPeopleFor(["Tim"], people), { payerName: "Tim", otherName: "Joyce" });
  assert.deepEqual(splitPeopleFor(["Joyce"], people), { payerName: "Joyce", otherName: "Tim" });
  assert.deepEqual(splitPeopleFor(["Tim", "Joyce"], people), { payerName: "the payer", otherName: "the other person" });
  assert.deepEqual(splitPeopleFor(["Someone"], people), { payerName: "the payer", otherName: "the other person" });
});

test("the share choices are the payer's 50%, 0% and 100%, in plain words", () => {
  const choices = shareChoicesFor({ payerName: "Tim", otherName: "Joyce" });
  assert.deepEqual(choices.map((choice) => [choice.basisPoints, choice.label]), [
    [5000, "Half each"],
    [0, "Joyce owes all of it"],
    [10000, "All Tim's"]
  ]);
});

test("the preview line names the count, the other person, the share and the group", () => {
  const who = { payerName: "Tim", otherName: "Joyce" };
  const group = { id: "g1", name: "Okaeri" };
  assert.equal(previewLine({ count: 12, people: who, shareBasisPoints: 5000, group }), "12 entries to Splits with Joyce, half each, in Okaeri");
  assert.equal(previewLine({ count: 1, people: who, shareBasisPoints: 0, group }), "1 entry to Splits with Joyce, Joyce owes all of it, in Okaeri");
  assert.equal(previewLine({ count: 3, people: who, shareBasisPoints: 10000, group: { id: "split-group-none", name: "Non-group" } }), "3 entries to Splits with Joyce, all Tim's");
  assert.equal(
    previewLine({ count: 4, people: { payerName: "the payer", otherName: "the other person" }, shareBasisPoints: 5000, group }),
    "4 entries to Splits with the other person, half each, in Okaeri"
  );
});

test("more than 10 need Yes, add all N; the body carries the confirmed count only then", () => {
  assert.equal(needsAddConfirm(10), false);
  assert.equal(needsAddConfirm(11), true);
  const ids = Array.from({ length: 12 }, (_, index) => `e${index}`);
  assert.deepEqual(chosenAddBody({ ids, groupId: "g1", shareBasisPoints: 5000, confirmed: true }), {
    splitGroupId: "g1", payerShareBasisPoints: 5000, entryIds: ids, confirmedCount: 12
  });
  assert.equal("confirmedCount" in chosenAddBody({ ids, groupId: "g1", shareBasisPoints: 5000 }), false);
  assert.equal("confirmedCount" in chosenAddBody({ ids: ids.slice(0, 3), groupId: "g1", shareBasisPoints: 5000, confirmed: true }), false);
  assert.equal(chosenAddBody({ ids, groupId: "split-group-none", shareBasisPoints: 0 }).splitGroupId, null);
  assert.equal(chosenAddBody({ ids, groupId: "", shareBasisPoints: 0 }).splitGroupId, null);
});

test("the notice says what went on Splits, then what was already there, left out or refused", () => {
  const plan = { alreadyOn: 2, leftOut: 1 };
  assert.equal(addedNotice({ addedCount: 10, refused: [] }, { alreadyOn: 0, leftOut: 0 }), "10 entries added to Splits");
  assert.equal(addedNotice({ addedCount: 1, refused: [] }, { alreadyOn: 0, leftOut: 0 }), "1 entry added to Splits");
  assert.equal(
    addedNotice({ addedCount: 10, refused: [] }, plan),
    "10 entries added to Splits. 2 were already on Splits. 1 income or transfer was left out"
  );
  assert.equal(
    addedNotice({ addedCount: 3, refused: [{ entryId: "x", reason: "This entry is already linked to a split." }, { entryId: "y", reason: "Entry not found." }] }, { alreadyOn: 0, leftOut: 0 }),
    "3 entries added to Splits. 1 was already on Splits. 1 could not be added"
  );
});

test("when nothing was added the first refusal reason is what the bar says", () => {
  assert.equal(noneAddedReason({ refused: [{ reason: "This group uses JPY. Split records in the group must use the same currency." }, { reason: "x" }] }), "This group uses JPY. Split records in the group must use the same currency.");
  assert.equal(noneAddedReason({ refused: [] }), pickSplitsCopy.noneAdded);
});
