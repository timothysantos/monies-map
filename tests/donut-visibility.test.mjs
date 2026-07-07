import assert from "node:assert/strict";
import test from "node:test";

import {
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "../src/client/donut-visibility.js";

test("donut visibility toggles one category without mutating the input set", () => {
  const hidden = new Set(["food"]);
  const next = toggleHiddenDonutItemIds(hidden, "taxi");

  assert.deepEqual([...hidden], ["food"]);
  assert.deepEqual([...next].sort(), ["food", "taxi"]);
  assert.deepEqual([...toggleHiddenDonutItemIds(next, "food")], ["taxi"]);
});

test("donut visibility filters chart rows and recomputes visible total", () => {
  const data = [
    { key: "food", label: "Food", valueMinor: 1000 },
    { key: "taxi", label: "Taxi", valueMinor: 400 },
    { key: "bills", label: "Bills", valueMinor: 600 }
  ];
  const visible = getVisibleDonutData(data, new Set(["taxi"]));

  assert.deepEqual(visible.map((item) => item.key), ["food", "bills"]);
  assert.equal(sumDonutValueMinor(visible), 1600);
});
