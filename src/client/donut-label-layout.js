// Where the Spending Mix donut puts its slice labels (design.md, "Summary
// body"). Biggest slice first, each slice whose arc is long enough gets
// "Name 32.1%" just outside the ring, or "32.1%" when the name does not fit,
// or nothing: a label must stay inside the chart, off the ring and clear of
// every label already placed. Small slices go unlabelled; the ranked list
// under or beside the donut names every category. Angles follow Recharts'
// Pie defaults (start at 3 o'clock, counter-clockwise).

export const MIN_LABEL_ARC = 18; // px of ring edge a labelled slice needs
const RING_GAP = 6; // ring edge to label
const LABEL_GAP = 4; // between two labels

function overlaps(a, b) {
  return a.x < b.x + b.width + LABEL_GAP && b.x < a.x + a.width + LABEL_GAP
    && a.y < b.y + b.height + LABEL_GAP && b.y < a.y + a.height + LABEL_GAP;
}

// The label box just outside the ring at `angle`, pushed out until no corner
// sits on the ring.
function boxAt(angle, width, height, { cx, cy, outerRadius }) {
  const cos = Math.cos(angle);
  const sin = -Math.sin(angle);
  for (let radius = outerRadius + RING_GAP; radius < outerRadius + 40; radius += 2) {
    const x = cx + cos * radius + (cos - 1) * width / 2;
    const y = cy + sin * radius + (sin - 1) * height / 2;
    const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]];
    if (corners.every(([px, py]) => Math.hypot(px - cx, py - cy) >= outerRadius + 2)) {
      return { x, y, width, height };
    }
  }
  return null;
}

// slices: [{ key, label, valueMinor }] in ring order. Returns one entry per
// slice: null, or { name, percent, x, y, width, height } (the box's top left).
export function layoutDonutLabels(slices, { width, height, outerRadius, shareTotalMinor, measure, lineHeight }) {
  const ringTotal = slices.reduce((sum, slice) => sum + Math.max(0, slice.valueMinor), 0);
  const shareTotal = shareTotalMinor || ringTotal;
  const geometry = { cx: width / 2, cy: height / 2, outerRadius };
  const placed = [];
  const result = slices.map(() => null);
  let start = 0;
  const angles = slices.map((slice) => {
    const sweep = ringTotal ? (Math.max(0, slice.valueMinor) / ringTotal) * Math.PI * 2 : 0;
    const mid = start + sweep / 2;
    start += sweep;
    return { sweep, mid };
  });
  const order = slices.map((_, index) => index).sort((a, b) => angles[b].sweep - angles[a].sweep);
  for (const index of order) {
    const { sweep, mid } = angles[index];
    if (sweep * outerRadius < MIN_LABEL_ARC) continue;
    const percent = `${((slices[index].valueMinor / shareTotal) * 100).toFixed(1)}%`;
    for (const name of [slices[index].label, ""]) {
      const box = boxAt(mid, measure(name ? `${name} ${percent}` : percent), lineHeight, geometry);
      const inside = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
      if (inside && !placed.some((other) => overlaps(box, other))) {
        placed.push(box);
        result[index] = { name, percent, ...box };
        break;
      }
    }
  }
  return result;
}
