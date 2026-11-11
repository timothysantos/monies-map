import assert from "node:assert/strict";
import test from "node:test";

import { BUBBLE, MORE_KEY, RING, buildDonutBubbles, pointOnRing, sectorPath } from "../src/client/donut-bubbles-model.js";

const slices = (values) => values.map((valueMinor, index) => ({ key: `c${index}`, label: `Category ${index + 1}`, valueMinor }));

// Disc and label of each bubble, as the model lays them out (11 units a character).
function footprints(bubble) {
  const r = BUBBLE.radius;
  const width = `${bubble.percent}%`.length * 11;
  const disc = { x: bubble.x - r, y: bubble.y - r, w: r * 2, h: r * 2 };
  const label = { x: bubble.side === "right" ? bubble.x + r + 6 : bubble.x - r - 6 - width, y: bubble.y - 11, w: width, h: 22 };
  return [disc, label];
}
const touch = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function labelsClear(bubbles) {
  for (let i = 0; i < bubbles.length; i += 1) {
    for (let j = i + 1; j < bubbles.length; j += 1) {
      for (const a of footprints(bubbles[i])) {
        for (const b of footprints(bubbles[j])) assert.equal(touch(a, b), false, `${bubbles[i].key} and ${bubbles[j].key} (disc or label) touch`);
      }
    }
  }
}

function bubblesClear(bubbles) {
  for (let i = 0; i < bubbles.length; i += 1) {
    for (let j = i + 1; j < bubbles.length; j += 1) {
      const gap = Math.hypot(bubbles[i].x - bubbles[j].x, bubbles[i].y - bubbles[j].y);
      assert.ok(gap >= BUBBLE.radius * 2, `${bubbles[i].key} and ${bubbles[j].key} overlap (${gap.toFixed(1)}px apart)`);
    }
  }
}

test("21 categories: five bubbles at their slices' middle angles plus one 'N more' bubble", () => {
  const values = [1600, 1200, 1100, 1000, 900, ...Array.from({ length: 16 }, () => 262.5)];
  const { arcs, bubbles, more } = buildDonutBubbles(slices(values));
  assert.equal(arcs.length, 21);
  assert.equal(bubbles.length, 6);
  assert.deepEqual(bubbles.slice(0, 5).map((bubble) => bubble.key), ["c0", "c1", "c2", "c3", "c4"]);
  assert.equal(more.key, MORE_KEY);
  assert.equal(more.count, 16);
  assert.deepEqual(bubbles.slice(0, 5).map((bubble) => bubble.percent), [16, 12, 11, 10, 9]);
  assert.equal(more.percent, 42);
  // The first slice's bubble sits at its own middle angle: 8% of a turn.
  const expected = pointOnRing(0.08, BUBBLE.orbit);
  assert.ok(Math.abs(bubbles[0].x - expected.x) < 0.2 && Math.abs(bubbles[0].y - expected.y) < 0.2);
  // The "more" bubble is at the middle of the arc the other 16 share.
  assert.ok(Math.abs(more.angle - 0.79) < 1e-6, `more at ${more.angle}`);
  bubblesClear(bubbles);
});

test("crowded slices around the top: no bubble's disc or label touches another's", () => {
  for (const values of [[6, 6, 6, 6, 6, 70], [30, 20, 15, 12, 8, 5, 5, 5], [22, 21, 20, 19, 18], [1000, 12, 11, 10, 9, 8], [18, 14, 13, 12, 11, 10, 8, 7, 7]]) {
    const { bubbles } = buildDonutBubbles(slices(values));
    bubblesClear(bubbles);
    labelsClear(bubbles);
  }
});

test("labels go on the outer side: bubbles right of the centre label right, left ones left", () => {
  const { bubbles } = buildDonutBubbles(slices([40, 30, 20, 5, 3, 2]));
  for (const bubble of bubbles) assert.equal(bubble.side, bubble.x >= RING.cx ? "right" : "left");
  assert.ok(bubbles.some((bubble) => bubble.side === "left") && bubbles.some((bubble) => bubble.side === "right"));
});

test("fewer than five slices: one bubble each and no 'more' bubble", () => {
  const { bubbles, more } = buildDonutBubbles(slices([600, 300, 100]));
  assert.equal(bubbles.length, 3);
  assert.equal(more, null);
  assert.deepEqual(bubbles.map((bubble) => bubble.percent), [60, 30, 10]);
});

test("exactly five slices have no 'more' bubble; a sixth makes one holding just that slice", () => {
  assert.equal(buildDonutBubbles(slices([5, 4, 3, 2, 1])).more, null);
  const six = buildDonutBubbles(slices([5, 4, 3, 2, 1, 1]));
  assert.equal(six.more.count, 1);
  assert.deepEqual(six.more.keys, ["c5"]);
});

test("one 100% slice: a single full ring and one bubble", () => {
  const { arcs, bubbles } = buildDonutBubbles(slices([4200]));
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].length, 1);
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].percent, 100);
  // The sector of a full ring is still a drawable closed path (never a zero-length arc).
  assert.match(sectorPath(0, 1), /^M.+Z$/);
});

test("bubbles for neighbouring small slices are pushed apart so none overlap", () => {
  // Five slices of 6% each side by side, then a big remainder.
  const { bubbles } = buildDonutBubbles(slices([6, 6, 6, 6, 6, 70]));
  bubblesClear(bubbles);
});

test("ignores empty slices; no spending gives nothing to draw", () => {
  assert.deepEqual(buildDonutBubbles(slices([0, 0])), { arcs: [], bubbles: [], more: null });
  const { arcs } = buildDonutBubbles(slices([100, 0, 50]));
  assert.equal(arcs.length, 2);
});

test("shares are of all spending when a total is given (a hidden slice does not move them)", () => {
  const { bubbles } = buildDonutBubbles(slices([300, 100]), { shareTotalMinor: 800 });
  assert.deepEqual(bubbles.map((bubble) => bubble.percent), [38, 13]);
});

test("a large slice's sector is flagged large-arc; a small one is not", () => {
  assert.match(sectorPath(0, 0.6), /A100 100 0 1 1/);
  assert.match(sectorPath(0, 0.1), /A100 100 0 0 1/);
});
