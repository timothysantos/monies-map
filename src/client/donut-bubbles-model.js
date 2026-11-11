// Where the Spending Mix donut puts its ring and its icon bubbles (design.md,
// "Summary dashboard layout"; owner mockup Donut.dc.html). Pure geometry, so
// it is tested without a page. The ring is drawn clockwise from 12 o'clock.
// Only the biggest five slices get a bubble, just outside the ring at the
// slice's middle angle; the slices after them share one "N more" bubble at
// the middle of their combined arc, so labels never collide. A bubble whose
// disc or label would touch its neighbour's is pushed along the ring until
// the two clear each other. Every figure comes from the slices' own amounts.

export const RING = { cx: 200, cy: 190, radius: 81, width: 38 };
export const MAX_BUBBLES = 5;
export const BUBBLE = { radius: 22, selectedRadius: 25, orbit: 140, gap: 4 };
// The ring's inner and outer edges, where a slice's tap target sits.
export const EDGES = { inner: RING.radius - RING.width / 2, outer: RING.radius + RING.width / 2 };

const TAU = Math.PI * 2;
// A full circle cannot be one arc, so the last sliver is left off it.
const FULL = 0.9999;

export const MORE_KEY = "__more__";

/** A point on a circle around the ring's centre; `fraction` is a turn from 12 o'clock, clockwise. */
export function pointOnRing(fraction, radius) {
  const angle = fraction * TAU;
  return { x: RING.cx + radius * Math.sin(angle), y: RING.cy - radius * Math.cos(angle) };
}

/** The ring's slice between two turns as a closed path (the slice's tap target). */
export function sectorPath(startFraction, endFraction, inner = EDGES.inner, outer = EDGES.outer) {
  const end = Math.min(endFraction, startFraction + FULL);
  const large = end - startFraction > 0.5 ? 1 : 0;
  const a = pointOnRing(startFraction, outer);
  const b = pointOnRing(end, outer);
  const c = pointOnRing(end, inner);
  const d = pointOnRing(startFraction, inner);
  const f = (value) => Math.round(value * 100) / 100;
  return `M${f(a.x)} ${f(a.y)}A${outer} ${outer} 0 ${large} 1 ${f(b.x)} ${f(b.y)}L${f(c.x)} ${f(c.y)}A${inner} ${inner} 0 ${large} 0 ${f(d.x)} ${f(d.y)}Z`;
}

// A bubble's footprint: its disc and its share label on the outer side (the
// label is about 11 units a character at the 17-unit size, plus the gap).
const LABEL_UNITS_PER_CHAR = 11;
const LABEL_HEIGHT = 22;
const LABEL_OFFSET = 6;

function footprint(angle, chars) {
  const point = pointOnRing(angle, BUBBLE.orbit);
  const r = BUBBLE.selectedRadius;
  const right = point.x >= RING.cx;
  const width = chars * LABEL_UNITS_PER_CHAR;
  const disc = { x: point.x - r, y: point.y - r, w: r * 2, h: r * 2 };
  const label = { x: right ? point.x + r + LABEL_OFFSET : point.x - r - LABEL_OFFSET - width, y: point.y - LABEL_HEIGHT / 2, w: width, h: LABEL_HEIGHT };
  return [disc, label];
}

const clash = (a, b) => a.x < b.x + b.w + BUBBLE.gap && b.x < a.x + a.w + BUBBLE.gap && a.y < b.y + b.h + BUBBLE.gap && b.y < a.y + a.h + BUBBLE.gap;

function clashes(angleA, charsA, angleB, charsB) {
  const a = footprint(angleA, charsA);
  const b = footprint(angleB, charsB);
  return a.some((one) => b.some((other) => clash(one, other)));
}

// Push bubble angles (turns) apart along the ring until no bubble's disc or
// label touches another's: neighbours too close in angle step away from each
// other a little at a time. Bounded, so a crowd of five or six settles.
function spreadAngles(angles, chars) {
  const count = angles.length;
  if (count < 2) return angles;
  const order = angles.map((_, index) => index).sort((a, b) => angles[a] - angles[b]);
  const spread = order.map((index) => angles[index]);
  const sizes = order.map((index) => chars[index]);
  const STEP = 0.004;
  for (let pass = 0; pass < 400; pass += 1) {
    let moved = false;
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      if (next === i) continue;
      if (clashes(spread[i], sizes[i], spread[next], sizes[next])) {
        spread[i] -= STEP;
        spread[next] += STEP;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const result = angles.slice();
  order.forEach((index, position) => { result[index] = ((spread[position] % 1) + 1) % 1; });
  return result;
}

/**
 * @param {{ key: string, label: string, valueMinor: number }[]} slices in ring order (biggest first)
 * @param {{ shareTotalMinor?: number, maxBubbles?: number }} [options]
 */
export function buildDonutBubbles(slices, { shareTotalMinor = 0, maxBubbles = MAX_BUBBLES } = {}) {
  const live = slices.filter((slice) => slice.valueMinor > 0);
  const ringTotal = live.reduce((sum, slice) => sum + slice.valueMinor, 0);
  const shareTotal = shareTotalMinor || ringTotal;
  if (!ringTotal) return { arcs: [], bubbles: [], more: null };
  let start = 0;
  const arcs = live.map((slice) => {
    const length = slice.valueMinor / ringTotal;
    const arc = { key: slice.key, start, length, mid: start + length / 2, share: slice.valueMinor / shareTotal };
    start += length;
    return arc;
  });
  const biggest = [...live].sort((a, b) => b.valueMinor - a.valueMinor).slice(0, maxBubbles).map((slice) => slice.key);
  const shown = arcs.filter((arc) => biggest.includes(arc.key));
  const rest = arcs.filter((arc) => !biggest.includes(arc.key));
  /** @type {{ kind: string, key: string, angle: number, share: number, count?: number, valueMinor?: number, keys?: string[] }[]} */
  const entries = shown.map((arc) => ({ kind: "slice", key: arc.key, angle: arc.mid, share: arc.share }));
  if (rest.length) {
    // The rest are the smallest slices, but a caller's order need not be
    // sorted, so the bubble sits at the middle of their span on the ring.
    const first = Math.min(...rest.map((arc) => arc.start));
    const last = Math.max(...rest.map((arc) => arc.start + arc.length));
    const valueMinor = live.filter((slice) => !biggest.includes(slice.key)).reduce((sum, slice) => sum + slice.valueMinor, 0);
    entries.push({ kind: "more", key: MORE_KEY, count: rest.length, valueMinor, share: valueMinor / shareTotal, angle: (first + last) / 2, keys: rest.map((arc) => arc.key) });
  }
  const angles = spreadAngles(entries.map((entry) => entry.angle), entries.map((entry) => `${Math.round(entry.share * 100)}%`.length));
  const bubbles = entries.map((entry, index) => {
    const point = pointOnRing(angles[index], BUBBLE.orbit);
    return {
      ...entry,
      angle: angles[index],
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
      // Labels go on the outer side: left bubbles label left, right bubbles right.
      side: point.x >= RING.cx ? "right" : "left",
      percent: Math.round(entry.share * 100)
    };
  });
  const more = bubbles.find((bubble) => bubble.kind === "more") ?? null;
  return { arcs, bubbles, more };
}
