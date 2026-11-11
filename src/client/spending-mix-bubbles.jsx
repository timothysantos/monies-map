import "./donut-bubbles.css";

import { useMemo, useState } from "react";

import { spendingMixCopy as copy } from "./copy/spending-mix-copy";
import { BUBBLE, EDGES, MORE_KEY, RING, buildDonutBubbles, sectorPath } from "./donut-bubbles-model";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { paletteColour } from "./palette-colour";
import { useSliceFigure } from "./spending-mix-slice-figure";
import { useFirstViewMotion } from "./use-first-view-motion";
import { getIconComponent } from "./ui-components";

// Spending Mix's donut with icon bubbles (design.md "Summary dashboard
// layout", owner mockup Donut.dc.html): a thick ring, one arc per category,
// and a bubble just outside each of the biggest five slices holding the
// category's own icon in its colour with its share beside it; the rest share
// one "N more" bubble. A tap or click on a bubble or a slice selects it: the
// middle of the ring and the pill under it show its name, amount and share
// (the amount hides with money; the share stays). A slice and a bubble are
// also the category's openable figure (View entries, Ask about this), as
// before. The ring draws in once, on first view (use-first-view-motion.js,
// donut-bubbles.css). The total and its change note sit above the ring, in
// the section. A lazy chunk beside Spending Mix.

// Two short lines for a name in the ring's middle.
function wrapName(name, maxChars = 16) {
  const words = name.split(/\s+/).filter(Boolean);
  const lines = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const clipped = lines.slice(0, 2).map((line) => (line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line));
  if (lines.length > 2) clipped[1] = `${clipped[1].replace(/…$/, "")}…`;
  return clipped;
}

// The "N more" bubble is plain grey (the muted ink), not a category colour.
const MORE_COLOUR = "var(--muted)";
const colourOf = (colour) => (colour === MORE_COLOUR ? colour : paletteColour(colour));
const inkOf = (colour, mix = 62) => `color-mix(in srgb, ${paletteColour(colour)} ${mix}%, var(--text))`;

function moveBetweenSlices(event) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  const current = event.target.closest?.(".donut-slice");
  if (!step || !current) return;
  const slices = [...event.currentTarget.querySelectorAll(".donut-slice")];
  const next = slices[(slices.indexOf(current) + step + slices.length) % slices.length];
  event.preventDefault();
  next?.focus();
}

/**
 * @param {{ chartData: any[], shareTotalMinor?: number, sliceFacts?: any, poster?: boolean, onShowAll?: () => void }} props
 */
export default function SpendingMixBubbles({ chartData, shareTotalMinor = 0, sliceFacts = undefined, poster = false, onShowAll = undefined }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const hidden = !areTotalsVisible;
  const shareTotal = shareTotalMinor || chartData.reduce((sum, item) => sum + item.valueMinor, 0);
  const { figureProps } = useSliceFigure({ shareTotal, hidden, sliceFacts });
  const { ref, motion } = useFirstViewMotion({ attribute: "donutMotion", playMs: 1400 });
  const [selectedKey, setSelectedKey] = useState("");
  const geometry = useMemo(() => buildDonutBubbles(chartData, { shareTotalMinor }), [chartData, shareTotalMinor]);
  const items = useMemo(() => new Map(chartData.map((item) => [item.key, item])), [chartData]);
  const biggest = useMemo(() => chartData.reduce((best, item) => (!best || item.valueMinor > best.valueMinor ? item : best), null), [chartData]);

  const arcByKey = new Map(geometry.arcs.map((arc) => [arc.key, arc]));
  const more = geometry.more;
  const selectedMore = selectedKey === MORE_KEY && more ? more : null;
  const selected = selectedMore ? null : items.get(selectedKey) ?? biggest;
  if (!selected && !selectedMore) return null;

  const percentOf = (valueMinor) => `${Math.round((valueMinor / (shareTotal || 1)) * 100)}%`;
  const summary = selectedMore
    ? { name: copy.moreName(more.count ?? 0), valueMinor: more.valueMinor ?? 0, colour: MORE_COLOUR, item: null }
    : { name: selected.label, valueMinor: selected.valueMinor, colour: selected.color, item: selected };
  const summaryShare = percentOf(summary.valueMinor);
  const nameLines = wrapName(summary.name);
  const centreLines = [
    ...(hidden ? [] : [{ text: money(summary.valueMinor), size: 22, weight: 700, fill: "var(--text)", gap: 32 }]),
    ...nameLines.map((text) => ({ text, size: 11.5, weight: 500, fill: "var(--muted)", gap: 17 })),
    ...(hidden ? [{ text: copy.shareOfSpending(summaryShare), size: 13, weight: 700, fill: "var(--text)", gap: 20 }] : [])
  ];
  const blockHeight = centreLines.reduce((sum, line) => sum + line.gap, 0);
  let cursor = RING.cy - blockHeight / 2;
  const placed = centreLines.map((line) => {
    cursor += line.gap;
    return { ...line, y: cursor - line.gap / 2 };
  });

  const select = (key) => setSelectedKey(key);
  const figure = selected ? figureProps(selected) : null;
  const { onPointerEnter: _enter, onPointerLeave: _leave, ...pillFigure } = figure?.props ?? {};
  const label = (name, percent) => copy.sliceLabel(name, percent);

  return (
    <div ref={ref} className={`spending-mix-bubbles ${poster ? "is-poster" : ""}`} data-donut-motion={motion} onKeyDown={moveBetweenSlices}>
      <svg
        className="mix-svg"
        viewBox="-10 0 420 380"
        role="group"
        aria-label={copy.chartLabel}
      >
        <g className="mix-ring" aria-hidden="true">
          {chartData.filter((item) => arcByKey.has(item.key)).map((item, index) => {
            const arc = arcByKey.get(item.key);
            const length = Math.min(arc.length * 100, 99.99);
            return (
              <circle
                key={item.key}
                className="mix-arc"
                data-arc={item.key}
                cx={RING.cx}
                cy={RING.cy}
                r={RING.radius}
                fill="none"
                stroke={item.color}
                style={{ stroke: paletteColour(item.color), "--i": index }}
                strokeWidth={RING.width}
                pathLength="100"
                strokeDasharray={`${length.toFixed(3)} ${(100 - length).toFixed(3)}`}
                strokeDashoffset={(-arc.start * 100).toFixed(3)}
                transform={`rotate(-90 ${RING.cx} ${RING.cy})`}
              />
            );
          })}
        </g>

        <g className="mix-centre">
          {placed.map((line, index) => (
            <text key={`${index}-${line.text}`} x={RING.cx} y={line.y} textAnchor="middle" dominantBaseline="central" fontSize={line.size} fontWeight={line.weight} style={{ fill: line.fill }}>{line.text}</text>
          ))}
        </g>

        {/* The slices' clear targets: a tap, a click, a focus selects; the shell's listener opens the figure menu. */}
        <g className="mix-hits">
          {chartData.filter((item) => arcByKey.has(item.key)).map((item) => {
            const arc = arcByKey.get(item.key);
            const { percent, props } = figureProps(item);
            return (
              <g
                key={item.key}
                className="donut-slice"
                style={{ "--slice-colour": paletteColour(item.color) }}
                data-slice={item.label}
                {...props}
                role="button"
                tabIndex={0}
                aria-label={label(item.label, percent)}
                aria-pressed={selected?.key === item.key}
                onClick={() => select(item.key)}
                onFocus={() => select(item.key)}
              >
                <path className="donut-slice-hit" d={sectorPath(arc.start, arc.start + arc.length, EDGES.inner, EDGES.outer)} fill="transparent" />
              </g>
            );
          })}
        </g>

        <g className="mix-bubbles">
          {geometry.bubbles.map((bubble, index) => {
            const isMore = bubble.kind === "more";
            const item = isMore ? null : items.get(bubble.key);
            const isSelected = isMore ? selectedMore !== null : selected?.key === bubble.key;
            const colour = isMore ? MORE_COLOUR : item.color;
            const radius = isSelected ? BUBBLE.selectedRadius : BUBBLE.radius;
            const Icon = item ? getIconComponent(item.iconKey) : null;
            const ink = isMore ? "var(--muted)" : inkOf(colour);
            const labelX = bubble.x + (bubble.side === "right" ? radius + 6 : -(radius + 6));
            const fig = item ? figureProps(item).props : {};
            return (
              <g
                key={bubble.key}
                className={`mix-bubble ${isSelected ? "is-selected" : ""}`}
                data-bubble={isMore ? "more" : item.label}
                style={{ "--i": index, "--bubble-ink": ink }}
                aria-hidden="true"
                {...fig}
                onClick={() => {
                  select(bubble.key);
                  if (isMore) onShowAll?.();
                }}
              >
                <g className="mix-bubble-disc">
                  <circle cx={bubble.x} cy={bubble.y} r={radius} style={{ fill: colourOf(colour) }} fillOpacity={isSelected ? 0.26 : 0.2} />
                  {isSelected ? <circle cx={bubble.x} cy={bubble.y} r={radius} fill="none" strokeWidth="2" style={{ stroke: ink }} /> : null}
                  {isMore ? (
                    <g fill="currentColor" style={{ color: ink }}>
                      {[-6, 0, 6].map((dx) => <circle key={dx} cx={bubble.x + dx} cy={bubble.y} r="2.2" />)}
                    </g>
                  ) : (
                    <g style={{ color: ink }}>
                      <Icon x={bubble.x - 10} y={bubble.y - 10} width={20} height={20} strokeWidth={2} aria-hidden="true" />
                    </g>
                  )}
                </g>
                <text
                  className="mix-bubble-percent"
                  x={labelX}
                  y={bubble.y}
                  textAnchor={bubble.side === "right" ? "start" : "end"}
                  dominantBaseline="central"
                  fontSize={isSelected ? 18 : 17}
                  fontWeight={isSelected ? 700 : 600}
                  style={{ fill: ink }}
                >
                  {`${bubble.percent}%`}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <p
        className="mix-pill"
        style={{ "--pill-colour": colourOf(summary.colour), "--pill-ink": selectedMore ? "var(--muted)" : inkOf(summary.colour, 45) }}
        {...(selected ? { ...pillFigure, role: "button", tabIndex: 0 } : {})}
      >
        {hidden ? `${summary.name} · ${summaryShare}` : `${summary.name} · ${money(summary.valueMinor)} · ${summaryShare}`}
      </p>
    </div>
  );
}
