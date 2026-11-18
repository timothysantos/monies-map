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
  assert.deepEqual(splitPeopleFor(["Tim", "Joyce"], people), { payerName: "the payer", otherName: "the other person", mixedPayers: true });
  assert.deepEqual(splitPeopleFor(["Someone"], people), { payerName: "the payer", otherName: "the other person", mixedPayers: true });
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
});

test("mixed payers: no one is named in the choices or the line, every choice starts with a capital", () => {
  const mixed = { payerName: "the payer", otherName: "the other person", mixedPayers: true };
  const group = { id: "g1", name: "Okaeri" };
  const choices = shareChoicesFor(mixed);
  assert.deepEqual(choices.map((choice) => [choice.basisPoints, choice.label]), [
    [5000, "Half each"],
    [0, "The one who didn't pay owes it all"],
    [10000, "All on the one who paid"]
  ]);
  assert.ok(choices.every((choice) => /^[A-Z]/.test(choice.label)));
  assert.deepEqual([5000, 0, 10000].map((shareBasisPoints) => previewLine({ count: 2, people: mixed, shareBasisPoints, group })), [
    "2 entries to Splits, half each, in Okaeri",
    "2 entries to Splits, the one who didn't pay owes it all, in Okaeri",
    "2 entries to Splits, all on the one who paid, in Okaeri"
  ]);
  // Negative: nothing in a mixed line says "with" or the fallback names.
  for (const shareBasisPoints of [5000, 0, 10000]) {
    assert.doesNotMatch(previewLine({ count: 2, people: mixed, shareBasisPoints, group }), /with|other person|the payer/);
  }
  // One payer keeps the named wording exactly.
  assert.equal(previewLine({ count: 4, people: { payerName: "Joyce", otherName: "Tim" }, shareBasisPoints: 10000, group }), "4 entries to Splits with Tim, all Joyce's, in Okaeri");
  assert.deepEqual(shareChoicesFor({ payerName: "Joyce", otherName: "Tim" }).map((choice) => choice.label), ["Half each", "Tim owes all of it", "All Joyce's"]);
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

// Who paid is the one rule the server uses (src/domain/split-payer.ts; DOMAIN.md
// "Split Payer"): the wallet's one owner, else the entry's owner. A joint
// wallet's label is "Shared".
test("the bar names who paid by the wallet: Tim's entry on Joyce's card is Joyce's, a joint wallet keeps Tim", () => {
  const onJoyces = splitsPlanFor([row("a", { accountOwnerLabel: "Joyce" })]);
  assert.deepEqual(onJoyces.payerNames, ["Joyce"]);
  assert.deepEqual(splitPeopleFor(onJoyces.payerNames, people), { payerName: "Joyce", otherName: "Tim" });
  assert.equal(previewLine({ count: 1, people: splitPeopleFor(onJoyces.payerNames, people), shareBasisPoints: 0, group: null }), "1 entry to Splits with Tim, Tim owes all of it");

  const onJoint = splitsPlanFor([row("b", { accountOwnerLabel: "Shared" })]);
  assert.deepEqual(onJoint.payerNames, ["Tim"]);
  assert.deepEqual(splitPeopleFor(onJoint.payerNames, people), { payerName: "Tim", otherName: "Joyce" });
});

test("rows with different payers say 'the payer' and 'the other person', never one name", () => {
  const plan = splitsPlanFor([
    row("a", { accountOwnerLabel: "Tim" }),
    row("b", { accountOwnerLabel: "Joyce" }),
    row("c", { accountOwnerLabel: "Shared" })
  ]);
  assert.deepEqual(plan.payerNames.sort(), ["Joyce", "Tim"]);
  const mixed = splitPeopleFor(plan.payerNames, people);
  assert.deepEqual(mixed, { payerName: "the payer", otherName: "the other person", mixedPayers: true });
  assert.equal(previewLine({ count: 3, people: mixed, shareBasisPoints: 5000, group: null }), "3 entries to Splits, half each");
  // Two rows both on Tim's wallet, one of them Joyce's own entry: Tim paid both.
  assert.deepEqual(splitsPlanFor([row("d", { accountOwnerLabel: "Tim" }), row("e", { ownerName: "Joyce", accountOwnerLabel: "Tim" })]).payerNames, ["Tim"]);
});
