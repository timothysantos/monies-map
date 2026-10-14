import assert from "node:assert/strict";
import test from "node:test";

import { MIN_LABEL_ARC, layoutDonutLabels } from "../src/client/donut-label-layout.js";

// About the width of 11px UI text: 6.5px a character.
const measure = (text) => text.length * 6.5;
const PHONE = { width: 326, height: 236, outerRadius: 92, lineHeight: 15, measure };
const DESKTOP = { width: 440, height: 310, outerRadius: 128, lineHeight: 16, measure: (text) => text.length * 7 };

const slices = (values) => values.map((valueMinor, index) => ({ key: `c${index}`, label: `Category ${index + 1}`, valueMinor }));

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function expectSound(layout, options) {
  const boxes = layout.filter(Boolean);
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    assert.ok(box.x >= 0 && box.y >= 0, "inside the chart");
    assert.ok(box.x + box.width <= options.width && box.y + box.height <= options.height, "inside the chart");
    for (const [x, y] of [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]) {
      assert.ok(Math.hypot(x - options.width / 2, y - options.height / 2) >= options.outerRadius, "off the ring");
    }
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(boxesOverlap(box, boxes[j]), false, `${box.percent} overlaps ${boxes[j].percent}`);
    }
  }
}

for (const [name, options] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  test(`${name}: big slices are labelled, tiny ones are not, and no two labels overlap`, () => {
    const data = slices([4200, 2600, 1500, 800, 400, 200, 120, 80, 60, 40]);
    const layout = layoutDonutLabels(data, options);
    expectSound(layout, options);
    assert.equal(layout.length, data.length);
    // The three biggest always get a label.
    for (const index of [0, 1, 2]) {
      assert.ok(layout[index], `slice ${index} is labelled`);
    }
    assert.equal(layout[0].percent, "42.0%");
    // A slice whose arc is shorter than the minimum never gets one.
    const total = data.reduce((sum, slice) => sum + slice.valueMinor, 0);
    data.forEach((slice, index) => {
      const arc = (slice.valueMinor / total) * Math.PI * 2 * options.outerRadius;
      if (arc < MIN_LABEL_ARC) assert.equal(layout[index], null, `slice ${index} (${arc.toFixed(1)}px) has no label`);
    });
    assert.equal(layout.at(-1), null);
  });
}

test("many equal small slices: none is labelled", () => {
  const layout = layoutDonutLabels(slices(Array.from({ length: 40 }, () => 100)), PHONE);
  assert.deepEqual(layout.filter(Boolean), []);
});

test("never a bare share: a name too long for one line goes over its share on two lines, and one that fits nowhere is left out", () => {
  const data = [
    { key: "a", label: "Groceries and pets", valueMinor: 5000 },
    { key: "b", label: "Taxi", valueMinor: 5000 }
  ];
  const narrow = { ...PHONE, width: 150, height: 300, outerRadius: 60 };
  const layout = layoutDonutLabels(data, narrow);
  expectSound(layout, narrow);
  // Every label carries its name; the long one takes two lines.
  for (const label of layout.filter(Boolean)) {
    assert.ok(label.name, `${label.percent} has its name`);
  }
  assert.deepEqual(layout.map((label) => label && [label.name, label.twoLines]), [["Groceries and pets", true], ["Taxi", false]]);
  assert.equal(layout[0].height, narrow.lineHeight * 2 + 2);
  // A name too long for either shape is left out rather than shown as "50.0%".
  const tooLong = layoutDonutLabels([{ key: "x", label: "Groceries, household supplies, pet food and garden things", valueMinor: 5000 }, { key: "y", label: "Taxi", valueMinor: 5000 }], narrow);
  assert.equal(tooLong[0], null);
  assert.equal(tooLong[1].name, "Taxi");
  // A slice with no name is never labelled.
  assert.deepEqual(layoutDonutLabels([{ key: "z", label: "", valueMinor: 100 }], DESKTOP), [null]);
});

test("shares are of all spending when slices are hidden", () => {
  const layout = layoutDonutLabels(slices([3000, 1000]), { ...DESKTOP, shareTotalMinor: 8000 });
  assert.equal(layout[0].percent, "37.5%");
  assert.equal(layout[1].percent, "12.5%");
});

test("no room at all: no labels", () => {
  const layout = layoutDonutLabels(slices([5000, 3000, 2000]), { ...PHONE, width: 184, height: 184 });
  assert.deepEqual(layout, [null, null, null]);
});
