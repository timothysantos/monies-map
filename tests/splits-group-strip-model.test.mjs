import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceLineFor,
  buildSheetRows,
  buildStripTiles,
  countTilesThatFit,
  readLastGroupId
} from "../src/client/splits-group-strip-model.js";

const groups = [
  { id: "split-group-none", name: "Non-group expenses", balanceMinor: 0, summaryText: "Settled up", entryCount: 3 },
  { id: "g-calm", name: "Calm pot", balanceMinor: 0, summaryText: "Settled up", entryCount: 2 },
  { id: "g-owe", name: "Dinners out", balanceMinor: -10858, summaryText: "You owe Serene $108.58", entryCount: 4 },
  { id: "g-owed-small", name: "Home & Bills", balanceMinor: 30315, summaryText: "Serene owes you $303.15", entryCount: 6 },
  { id: "g-owed-big", name: "Japan trip", balanceMinor: 2673000, summaryText: "Serene owes you JP¥26,730", entryCount: 10 }
];
const visible = { areTotalsVisible: true, isHousehold: false };
const hidden = { areTotalsVisible: false, isHousehold: false };
const ids = (list) => list.map((item) => item.id);

test("tiles: owed first, then owe, then Non-group, then settled", () => {
  const tiles = buildStripTiles(groups, { ...visible, activeGroupId: null });
  assert.deepEqual(ids(tiles), ["g-owed-small", "g-owed-big", "g-owe", "split-group-none", "g-calm"]);
  const calm = tiles.find((tile) => tile.id === "g-calm");
  assert.equal(calm.balanceLine, "Settled");
  assert.equal(calm.isSettled, true);
});

test("Non-group expenses says No balance, never Settled", () => {
  assert.equal(balanceLineFor(groups[0], visible), "No balance");
  const tile = buildStripTiles(groups, { ...visible, activeGroupId: "split-group-none" })[0];
  assert.equal(tile.isSettled, false);
  assert.equal(tile.balanceLine, "No balance");
});

test("the open group leads and keeps its entry count", () => {
  const tiles = buildStripTiles(groups, { ...visible, activeGroupId: "g-owe" });
  assert.equal(tiles[0].id, "g-owe");
  assert.equal(tiles[0].isActive, true);
  assert.equal(tiles[0].entryCount, 4);
  assert.equal(tiles.filter((tile) => tile.isActive).length, 1);
});

test("hidden money: every line is Balance hidden, order is by name, nothing settled", () => {
  const tiles = buildStripTiles(groups, { ...hidden, activeGroupId: null });
  assert.deepEqual(ids(tiles), ["g-calm", "g-owe", "g-owed-small", "g-owed-big", "split-group-none"]);
  assert.ok(tiles.every((tile) => tile.balanceLine === "Balance hidden" && !tile.isSettled));
  assert.equal(buildSheetRows(groups, { ...hidden, activeGroupId: null }).settled.length, 0);
});

test("sheet folds real settled groups only", () => {
  const sheet = buildSheetRows(groups, { ...visible, activeGroupId: "g-owe" });
  assert.deepEqual(ids(sheet.settled), ["g-calm"]);
  assert.deepEqual(ids(sheet.open), ["g-owed-small", "g-owed-big", "g-owe", "split-group-none"]);
  assert.equal(sheet.open.find((row) => row.isActive).id, "g-owe");
});

test("desktop fit shows as many tiles as fit and never fewer than the open group", () => {
  const sizes = { controlWidth: 88, leadWidth: 280, tileWidth: 200, gap: 10, total: 6 };
  assert.equal(countTilesThatFit({ ...sizes, rowWidth: 1100 }), 4);
  assert.equal(countTilesThatFit({ ...sizes, rowWidth: 3000 }), 6);
  assert.equal(countTilesThatFit({ ...sizes, rowWidth: 200 }), 1);
});

test("a blocked storage reads as no remembered group", () => {
  globalThis.window = { localStorage: { getItem() { throw new Error("blocked"); } } };
  assert.equal(readLastGroupId("person-tim"), null);
  delete globalThis.window;
});
