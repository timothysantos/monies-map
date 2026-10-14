// The page side of Ask's habits: the readers check what the server sends, the
// saved card follows what Ask did or undid, and a failed request is simply
// no row.
import assert from "node:assert/strict";
import test from "node:test";

import { declineHabit, readDoneItems, readHabitSuggestion, requestEntryHabits, undoDoneForYou } from "../src/client/ask-habits-api.js";
import { patchCardAfterAuto, patchCardAfterUndo } from "../src/client/ask-habits-card.js";
import { formatDoneWhen } from "../src/client/ask-habits-ui.jsx";

const category = { id: "done-1", kind: "category", entryId: "txn-1", entryDescription: "BENGAWAN SOLO", summary: "Category set to Food & Drinks", habitId: "category:bengawan solo", from: "Other", to: "Food & Drinks", splitExpenseId: null, at: "2026-10-14T09:30:00Z", undone: false };
const split = { ...category, id: "done-2", kind: "split", summary: "Added to splits 50/50 with Joyce", habitId: "split:bengawan solo", from: null, to: null, splitExpenseId: "split-expense-9" };
const savedCard = { status: "saved", fields: { categoryName: "Other" }, share: { on: false, splitGroupId: "" }, saved: { entryId: "txn-1", splitExpenseId: null } };

test("the done list keeps well-formed lines and drops anything else", () => {
  const items = readDoneItems({ ok: true, items: [category, { id: "x" }, null, { ...split, kind: "delete_everything" }, split] });
  assert.deepEqual(items.map((item) => item.id), ["done-1", "done-2"]);
  assert.deepEqual(readDoneItems({ ok: false, items: [category] }), []);
  assert.deepEqual(readDoneItems(null), []);
});

test("a suggestion needs its line and at least one thing to do", () => {
  const good = { entryId: "txn-1", text: "Food & Drinks, as you usually do", category: { habitId: "category:x", categoryName: "Food & Drinks" }, split: null };
  assert.deepEqual(readHabitSuggestion(good), good);
  assert.equal(readHabitSuggestion({ ...good, category: null }), null);
  assert.equal(readHabitSuggestion({ ...good, text: "" }), null);
  assert.equal(readHabitSuggestion({ ...good, split: { habitId: "split:x", groupId: null, firstPersonBasisPoints: "half" }, category: null }), null);
  assert.deepEqual(readHabitSuggestion({ ...good, category: null, split: { habitId: "split:x", groupId: "g", firstPersonBasisPoints: 5000 } }).split, { habitId: "split:x", groupId: "g", firstPersonBasisPoints: 5000 });
});

test("the saved card follows what Ask did to its own entry and ignores other entries", () => {
  assert.equal(patchCardAfterAuto(savedCard, category).fields.categoryName, "Food & Drinks");
  const onSplits = patchCardAfterAuto(savedCard, split);
  assert.deepEqual([onSplits.share.on, onSplits.saved.splitExpenseId], [true, "split-expense-9"]);
  assert.equal(patchCardAfterAuto(savedCard, { ...category, entryId: "txn-other" }), savedCard);
  assert.equal(patchCardAfterAuto(savedCard, { ...category, undone: true }), savedCard);
  assert.equal(patchCardAfterAuto({ ...savedCard, status: "draft" }, category).fields.categoryName, "Other");
});

test("undo puts the card's category and split back", () => {
  const done = { ...savedCard, fields: { categoryName: "Food & Drinks" }, share: { on: true, splitGroupId: "g" }, saved: { entryId: "txn-1", splitExpenseId: "split-expense-9", splitGroupName: "Trip" } };
  assert.equal(patchCardAfterUndo(done, category).fields.categoryName, "Other");
  const off = patchCardAfterUndo(done, split);
  assert.deepEqual([off.share.on, off.saved.splitExpenseId, off.saved.splitGroupName], [false, null, ""]);
  assert.equal(patchCardAfterUndo(done, { ...category, entryId: "txn-other" }), done);
  assert.equal(patchCardAfterUndo(done, { ...category, from: null }), done, "no earlier category known: nothing to put back");
});

test("when a line was done reads in plain words", () => {
  const now = new Date(2026, 9, 14, 20, 0);
  assert.match(formatDoneWhen(new Date(2026, 9, 14, 18, 42).toISOString(), now), /^Today, 6:42/i);
  assert.match(formatDoneWhen(new Date(2026, 9, 13, 9, 5).toISOString(), now), /^Yesterday, 9:05/i);
  assert.match(formatDoneWhen(new Date(2026, 9, 2, 19, 30).toISOString(), now), /^2 Oct, 7:30/i);
  assert.equal(formatDoneWhen("not a date", now), "");
});

test("a failed request is no suggestion and no crash; a refused undo says why", async () => {
  const failing = async () => { throw new Error("offline"); };
  assert.equal(await requestEntryHabits("txn-1", { fetchImpl: failing }), null);
  assert.equal(await requestEntryHabits("txn-1", { fetchImpl: async () => new Response("nope", { status: 500 }) }), null);
  const refused = await undoDoneForYou("done-1", { fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "This entry's category was changed since, so there is nothing to undo." }), { status: 409 }) });
  assert.deepEqual(refused, { ok: false, error: "This entry's category was changed since, so there is nothing to undo." });
  assert.deepEqual(await declineHabit("category:x", { fetchImpl: failing }), { ok: false, error: "That could not be saved." });
});
