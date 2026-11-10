// Picking many Entries rows (design.md "Trips and events on Entries",
// "Picking many"): the pure model behind the tick boxes and the floating
// bar. Runs in screen order, whole days, toggles, the 200 limit, the total at
// the rows' own amounts, the bulk category changes and their Undo, and the
// keyboard guard.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_PICK,
  PICK_MAX,
  addPick,
  categoryChangesFor,
  isPickKeyIgnored,
  needsConfirm,
  pickDay,
  pickRange,
  pickScopeKey,
  pickedRows,
  rowClickIntent,
  rowOrder,
  startPicking,
  summarizePick,
  togglePick,
  undoCategoryChanges
} from "../src/client/entry-pick-model.js";

const row = (id, extra = {}) => ({
  id,
  date: "2026-10-05",
  description: `Shop ${id}`,
  categoryName: "Food",
  entryType: "expense",
  ownershipType: "direct",
  ownerName: "Tim",
  amountMinor: 1000,
  ...extra
});

// Screen order: newest day first, rows as the list shows them (not by id).
const grouped = [
  { date: "2026-10-06", entries: [row("c"), row("a")] },
  { date: "2026-10-05", entries: [row("e"), row("b"), row("d")] }
];
const ids = (state) => [...state.ids].sort();

test("Shift-click picks the run between the last picked row and this one, in the order on screen", () => {
  const order = rowOrder(grouped);
  assert.deepEqual(order, ["c", "a", "e", "b", "d"]);
  let state = togglePick(startPicking(), "a");
  state = pickRange(state, order, "b");
  // a, e, b: the rows between them on screen, not "a" to "b" by id.
  assert.deepEqual(ids(state), ["a", "b", "e"]);
  assert.equal(state.anchorId, "b");
  // Backwards from b up to c adds c and keeps the rest.
  state = pickRange(state, order, "c");
  assert.deepEqual(ids(state), ["a", "b", "c", "e"]);
  assert.equal(state.picking, true);
});

test("Shift-click with nothing picked yet (or a last row no longer shown) picks just that row", () => {
  const order = rowOrder(grouped);
  assert.deepEqual(ids(pickRange(NO_PICK, order, "e")), ["e"]);
  const stale = { picking: true, ids: new Set(["gone"]), anchorId: "gone" };
  assert.deepEqual(ids(pickRange(stale, order, "d")), ["d", "gone"]);
  // A row not on screen changes nothing.
  assert.equal(pickRange(stale, order, "zzz"), stale);
});

test("a plain click toggles while picking; Ctrl or Cmd toggles and starts; Shift is a run; otherwise the editor opens", () => {
  assert.equal(rowClickIntent(NO_PICK, {}), "open");
  assert.equal(rowClickIntent(NO_PICK, { ctrlKey: true }), "toggle");
  assert.equal(rowClickIntent(NO_PICK, { metaKey: true }), "toggle");
  assert.equal(rowClickIntent(NO_PICK, { shiftKey: true }), "range");
  const picking = startPicking();
  assert.equal(rowClickIntent(picking, {}), "toggle");
  let state = togglePick(picking, "a");
  state = togglePick(state, "b");
  state = togglePick(state, "a");
  assert.deepEqual(ids(state), ["b"]);
  assert.equal(state.picking, true, "taking the last row off keeps picking on");
  assert.deepEqual(ids(addPick(addPick(NO_PICK, "c"), "c")), ["c"], "a hold never takes a row off");
});

test("Pick the whole day adds the day's rows, and takes them off when all are picked", () => {
  const day = grouped[1].entries.map((entry) => entry.id);
  let state = togglePick(startPicking(), "c");
  state = pickDay(state, day);
  assert.deepEqual(ids(state), ["b", "c", "d", "e"]);
  state = pickDay(state, day);
  assert.deepEqual(ids(state), ["c"]);
  // Part of the day picked: the rest is added, nothing is taken off.
  state = pickDay(togglePick(state, "b"), day);
  assert.deepEqual(ids(state), ["b", "c", "d", "e"]);
  assert.equal(pickDay(state, []), state);
});

test("the picked rows come in screen order and rows no longer shown drop out", () => {
  const state = { picking: true, ids: new Set(["d", "c", "gone"]), anchorId: "d" };
  assert.deepEqual(pickedRows(grouped, state.ids).map((entry) => entry.id), ["c", "d"]);
  assert.deepEqual(pickedRows(grouped, new Set()), []);
});

test("the bar's total adds the amounts as the rows show them, signed", () => {
  const rows = [
    row("x", { amountMinor: 4260 }),
    row("y", { amountMinor: 16270 }),
    row("z", { entryType: "income", amountMinor: 1000 }),
    // A person view of a shared entry shows the whole amount first (its
    // share in brackets): the total counts what the row shows first.
    row("s", {
      ownershipType: "shared",
      amountMinor: 150,
      splits: [{ personName: "Tim", amountMinor: 150 }, { personName: "Joyce", amountMinor: 150 }]
    })
  ];
  assert.deepEqual(summarizePick(rows, "person-tim"), { count: 4, totalMinor: -4260 - 16270 + 1000 - 300, tooMany: false });
  assert.deepEqual(summarizePick([], "household"), { count: 0, totalMinor: 0, tooMany: false });
});

test("more than 200 picked is too many for one change; 200 is fine", () => {
  const many = (count) => Array.from({ length: count }, (_, index) => row(`r${index}`, { amountMinor: 1 }));
  assert.equal(PICK_MAX, 200);
  assert.equal(summarizePick(many(200), "household").tooMany, false);
  const over = summarizePick(many(201), "household");
  assert.equal(over.tooMany, true);
  assert.equal(over.count, 201);
  assert.equal(over.totalMinor, -201);
});

test("Category changes: each row moves from its own category; transfers and rows already there are left", () => {
  const rows = [
    row("a", { categoryName: "Food" }),
    row("b", { categoryName: "Transport" }),
    row("c", { categoryName: "Shopping" }),
    row("t", { entryType: "transfer", categoryName: "Transfer", transferDirection: "out" }),
    // A person view's transfer read as spending is still a transfer.
    row("p", { categoryName: "Food", ledgerEntry: row("p", { entryType: "transfer", categoryName: "Transfer" }) })
  ];
  const { changes, transfers } = categoryChangesFor(rows, "Shopping");
  assert.deepEqual(changes, [
    { entryId: "a", fromCategoryName: "Food", categoryName: "Shopping" },
    { entryId: "b", fromCategoryName: "Transport", categoryName: "Shopping" }
  ]);
  assert.equal(transfers, 2);
  assert.deepEqual(undoCategoryChanges(changes), [
    { entryId: "a", fromCategoryName: "Shopping", categoryName: "Food" },
    { entryId: "b", fromCategoryName: "Shopping", categoryName: "Transport" }
  ]);
  assert.equal(needsConfirm(10), false);
  assert.equal(needsConfirm(11), true);
});

test("picking belongs to the month, view, scope and filters; opening an entry is not a change", () => {
  const key = (query) => pickScopeKey(new URLSearchParams(query));
  const base = key("view=person-tim&month=2026-10&entry_category=Food");
  assert.equal(key("month=2026-10&entry_category=Food&view=person-tim&editing_entry=txn-1"), base);
  assert.notEqual(key("view=person-tim&month=2026-11&entry_category=Food"), base);
  assert.notEqual(key("view=household&month=2026-10&entry_category=Food"), base);
  assert.notEqual(key("view=person-tim&month=2026-10&entry_category=Food&entry_search=grab"), base);
  assert.notEqual(key("view=person-tim&month=2026-10&entry_category=Food&entries_scope=direct"), base);
});

test("T and Esc stay out of the way of typing and of an open dialog or popover", () => {
  const noDialog = { querySelector: () => null };
  const dialogOpen = { querySelector: (selector) => (selector.includes("dialog") ? {} : null) };
  const key = (extra = {}) => ({ key: "t", defaultPrevented: false, target: { tagName: "DIV", isContentEditable: false }, ...extra });
  assert.equal(isPickKeyIgnored(key(), noDialog), false);
  assert.equal(isPickKeyIgnored(key(), dialogOpen), true);
  assert.equal(isPickKeyIgnored(key({ target: { tagName: "INPUT" } }), noDialog), true);
  assert.equal(isPickKeyIgnored(key({ target: { tagName: "TEXTAREA" } }), noDialog), true);
  assert.equal(isPickKeyIgnored(key({ target: { tagName: "DIV", isContentEditable: true } }), noDialog), true);
  assert.equal(isPickKeyIgnored(key({ metaKey: true }), noDialog), true, "Cmd-T stays the browser's");
  assert.equal(isPickKeyIgnored(key({ ctrlKey: true }), noDialog), true);
  assert.equal(isPickKeyIgnored(key({ defaultPrevented: true }), noDialog), true);
});
