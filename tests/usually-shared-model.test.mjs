// The "Usually shared" section's pure side (src/client/usually-shared-model.js
// and its copy): what one Add posts, when it needs "Yes, add all N", and the
// plain words.
import assert from "node:assert/strict";
import test from "node:test";

import { usuallySharedCopy as copy } from "../src/client/copy/splits-usually-shared-copy.js";
import {
  buildAddBody,
  figurePeriod,
  groupsAfterAdd,
  needsConfirm,
  refusedReasons,
  tickedEntries,
  undoBody
} from "../src/client/usually-shared-model.js";
import { findRetiredNames } from "../src/domain/retired-names.ts";

const entry = (id, date, amountMinor = 1000) => ({ id, date, description: "Cold Storage", amountMinor, currency: "SGD", ownerPersonId: "person-tim", ownerName: "Tim" });
const group = (overrides = {}) => ({
  key: "cold storage|person-tim|split-group-home|5000|SGD",
  shopName: "Cold Storage",
  groupId: "split-group-home",
  groupName: "Home",
  basisPoints: 5000,
  ownerName: "Tim",
  otherPersonName: "Joyce",
  evidenceCount: 8,
  matchedCount: 9,
  matchedBy: "description",
  currency: "SGD",
  totalMinor: 3000,
  entries: [entry("a", "2026-10-28"), entry("b", "2026-10-02"), entry("c", "2026-09-20")],
  ...overrides
});

test("all entries are ticked until the person unticks some, and the Add posts only the ticked ones", () => {
  const g = group();
  assert.deepEqual(tickedEntries(g, undefined).map((row) => row.id), ["a", "b", "c"]);
  assert.deepEqual(tickedEntries(g, new Set(["b"])).map((row) => row.id), ["a", "c"]);
  assert.deepEqual(buildAddBody(g, new Set(["b"])), {
    groups: [{ splitGroupId: "split-group-home", payerShareBasisPoints: 5000, entryIds: ["a", "c"] }]
  });
});

test("Non-group expenses post no group id", () => {
  assert.equal(buildAddBody(group({ groupId: "split-group-none" }), undefined).groups[0].splitGroupId, null);
});

test("more than 10 entries need the confirm step and send their count; 10 or fewer never do", () => {
  assert.equal(needsConfirm(10), false);
  assert.equal(needsConfirm(11), true);
  const many = group({ entries: Array.from({ length: 12 }, (_, index) => entry(`e${index}`, "2026-10-01")) });
  assert.equal(buildAddBody(many, undefined, { confirmed: true }).confirmedCount, 12);
  assert.equal("confirmedCount" in buildAddBody(many, undefined), false);
  const few = group({ entries: Array.from({ length: 10 }, (_, index) => entry(`e${index}`, "2026-10-01")) });
  assert.equal("confirmedCount" in buildAddBody(few, undefined, { confirmed: true }), false);
});

test("the figure's period spans the months the entries fall in", () => {
  assert.equal(figurePeriod(group()), "2026-09:2026-10");
});

test("after an Add the added entries leave the list; refused ones stay with a fresh total", () => {
  const groups = [group(), group({ key: "other", shopName: "Ikea", entries: [entry("x", "2026-10-01")] })];
  const result = { added: [{ entryId: "a" }, { entryId: "b" }], refused: [{ entryId: "c", reason: "This entry is already linked to a split expense." }] };
  const next = groupsAfterAdd(groups, groups[0].key, result);
  assert.deepEqual(next.map((row) => row.entries.map((item) => item.id)), [["c"], ["x"]]);
  assert.equal(next[0].totalMinor, 1000);
  assert.deepEqual(refusedReasons(result), ["This entry is already linked to a split expense."]);
  const all = groupsAfterAdd(groups, groups[1].key, { added: [{ entryId: "x" }], refused: [] });
  assert.deepEqual(all.map((row) => row.shopName), ["Cold Storage"]);
});

test("Undo posts the split ids the Add returned, nothing else", () => {
  assert.deepEqual(undoBody({ undoSplitExpenseIds: ["s1", "s2"] }), { splitExpenseIds: ["s1", "s2"] });
  assert.deepEqual(undoBody({}), { splitExpenseIds: [] });
});

test("the words are plain: half each says so, other shares name both people, a group is named only when there is one", () => {
  assert.equal(copy.usually({ ownerName: "Tim", otherPersonName: "Joyce", groupName: "Baby River", basisPoints: 5000, inGroup: true }), "Usually half each with Joyce in Baby River.");
  assert.equal(copy.usually({ ownerName: "Tim", otherPersonName: "Joyce", groupName: "Non-group expenses", basisPoints: 7000, inGroup: false }), "Usually Tim 70% and Joyce 30%.");
  assert.equal(copy.evidence({ evidenceCount: 8, matchedCount: 9, matchedBy: "description" }), "Shared 8 of 9 times.");
  assert.equal(copy.evidence({ evidenceCount: 5, matchedCount: 6, matchedBy: "category" }), "Shared 5 of 6 similar purchases.");
  assert.equal(copy.summary(1, 1), "You usually share these: 1 entry at 1 shop.");
  assert.equal(copy.add(4), "Add 4");
  assert.equal(copy.confirmAll(12), "Yes, add all 12");
});

test("none of the words is a retired name or says 50/50", () => {
  const words = [
    copy.title, copy.sheetTitle, copy.sheetHint, copy.review, copy.hide, copy.close, copy.cancel, copy.adding, copy.undo, copy.undoing, copy.undone,
    copy.failed, copy.undoFailed, copy.loadFailed, copy.summary(3, 2), copy.confirmHint(12), copy.added(2), copy.notAdded(2)
  ].join(" ");
  assert.deepEqual(findRetiredNames(words), []);
  assert.equal(/50\/50/.test(words), false);
});
