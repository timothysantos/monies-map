import { useMemo, useRef } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from "recharts";

import { spendingMixCopy } from "./copy/spending-mix-copy";
import { layoutDonutLabels } from "./donut-label-layout";
import { useMoneyPrivacy } from "./money-privacy";

import { money, moneyWithCurrency } from "./formatters";
import { getIconComponent } from "./ui-components";
import { PrivateMoney } from "./money-privacy";
import { paletteColour } from "./palette-colour";

export default function SpendingMixRecharts({
  chartData,
  total,
  currency = "",
  totalLabel,
  compact,
  callouts,
  sliceLabels,
  sliceFacts = undefined,
  shareTotalMinor,
  isNarrowViewport,
  resolvedHeight,
  resolvedInnerRadius,
  resolvedOuterRadius
}) {
  const renderSliceLabel = useMemo(
    () => (sliceLabels ? sliceLabelRenderer(chartData, shareTotalMinor, isNarrowViewport ? 11 : 12) : null),
    [sliceLabels, chartData, shareTotalMinor, isNarrowViewport]
  );
  const { areTotalsVisible } = useMoneyPrivacy();
  // Spending Mix (sliceLabels): every slice is an openable figure.
  const renderSlice = useOpenableSlices(sliceLabels, { shareTotal: shareTotalMinor || total, hidden: !areTotalsVisible, sliceFacts });
  return (
    <div className={`spending-mix-chart ${compact ? "is-compact" : ""} ${renderSlice ? "has-slice-menus" : ""}`} onKeyDown={sliceLabels ? moveBetweenSlices : undefined}>
      <ResponsiveContainer width="100%" height={resolvedHeight}>
        <PieChart accessibilityLayer={!renderSlice}>
          <Pie
            data={chartData}
            dataKey="valueMinor"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={resolvedInnerRadius}
            outerRadius={resolvedOuterRadius}
            paddingAngle={0}
            isAnimationActive={false}
            labelLine={false}
            label={callouts
              ? (props) => renderPieCallout(props, total, { compact: isNarrowViewport })
              : renderSlice ? (props) => renderSlice(props, renderSliceLabel(props)) : (renderSliceLabel ?? false)}
            rootTabIndex={renderSlice ? -1 : undefined}
          >
            {chartData.map((entry) => (
              // The fill attribute keeps the plain colour; the style (which
              // takes a var()) shows the colour preset's one.
              <Cell key={entry.key} fill={entry.color} style={{ fill: paletteColour(entry.color) }} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className={`donut-center recharts-donut-center ${compact ? "is-compact" : ""}`}>
        <span>{totalLabel}</span>
        <strong><PrivateMoney>{currency ? moneyWithCurrency(total, currency) : money(total)}</PrivateMoney></strong>
      </div>
    </div>
  );
}

// Slice labels (donut-label-layout.js): laid out once per chart size, the
// first time Recharts asks for one, then read by slice key. The text is
// plain ink on the page, so it reads in every colour preset; it is hidden
// from assistive tech, which reads the ranked list instead.
let measureContext = null;
function measureText(text, font) {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * 7;
  measureContext.font = font;
  return Math.ceil(measureContext.measureText(text).width) + 2;
}

function sliceLabelRenderer(chartData, shareTotalMinor, fontSize) {
  let size = "";
  let labels = new Map();
  return (props) => {
    const { cx, cy, outerRadius, payload } = props;
    if (size !== `${cx},${cy},${outerRadius}`) {
      size = `${cx},${cy},${outerRadius}`;
      const font = `700 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
      const layout = layoutDonutLabels(chartData, {
        width: cx * 2,
        height: cy * 2,
        outerRadius,
        shareTotalMinor,
        lineHeight: Math.round(fontSize * 1.3),
        measure: (text) => measureText(text, font)
      });
      labels = new Map(chartData.map((item, index) => [item.key, layout[index]]));
    }
    const label = labels.get(payload?.key);
    if (!label) return <g />;
    return (
      <text
        className="donut-slice-label"
        data-slice-key={payload.key}
        aria-hidden="true"
        x={label.x + label.width / 2}
        y={label.y + label.height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        style={{ fill: "var(--text)" }}
      >
        {label.twoLines ? (
          <>
            <tspan x={label.x + label.width / 2} dy="-0.72em" fontWeight="500">{label.name}</tspan>
            <tspan x={label.x + label.width / 2} dy="1.44em" fontWeight="700">{label.percent}</tspan>
          </>
        ) : (
          <>
            <tspan fontWeight="500">{`${label.name} `}</tspan>
            <tspan fontWeight="700">{label.percent}</tspan>
          </>
        )}
      </text>
    );
  };
}

function renderPieCallout(props, total, options = {}) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props;
  const { compact = false } = options;
  if (!percent || !payload || !total) {
    return null;
  }

  if (compact && percent < 0.03) {
    return null;
  }

  const radians = (Math.PI / 180) * -midAngle;
  const stemOffset = compact ? 4 : 6;
  const midOffset = compact ? 10 : 22;
  const badgeOffset = compact ? 20 : 46;
  const textOffset = compact ? 18 : 34;
  const badgeSize = compact ? 28 : 44;
  const iconSize = compact ? 12 : 18;
  const fontSize = compact ? 10 : 15;
  const sx = cx + Math.cos(radians) * (outerRadius + stemOffset);
  const sy = cy + Math.sin(radians) * (outerRadius + stemOffset);
  const mx = cx + Math.cos(radians) * (outerRadius + midOffset);
  const my = cy + Math.sin(radians) * (outerRadius + midOffset);
  const bx = cx + Math.cos(radians) * (outerRadius + badgeOffset);
  const by = cy + Math.sin(radians) * (outerRadius + badgeOffset);
  const isRight = Math.cos(radians) >= 0;
  const tx = bx + (isRight ? textOffset : -textOffset);
  const percentage = ((payload.valueMinor / total) * 100).toFixed(1);
  const Icon = getIconComponent(payload.iconKey);
  const colour = paletteColour(payload.color);

  return (
    <g>
      <path d={`M${sx},${sy} L${mx},${my} L${bx},${by}`} style={{ stroke: colour }} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.82" />
      <foreignObject x={bx - (badgeSize / 2)} y={by - (badgeSize / 2)} width={badgeSize} height={badgeSize}>
        <div className="donut-callout-badge" style={{ "--category-color": colour, "--callout-size": `${badgeSize}px` }}>
          <Icon size={iconSize} strokeWidth={2.2} />
        </div>
      </foreignObject>
      <text x={tx} y={by + 1} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" style={{ fill: `color-mix(in srgb, ${colour} 62%, var(--text))` }} fontSize={fontSize} fontWeight="700">
        {percentage}%
      </text>
    </g>
  );
}

// Spending Mix's slices as openable figures (design.md "Openable figures",
// figure-menu.js): each is a focusable group around its sector with the
// category's figure attributes and its quick facts (`data-fig-note`, one
// fact per line: amount and share, entries, then the page's own facts such
// as the plan and the top merchants). A tap, a click or Enter opens its menu
// through the shell's listener; on a desktop a resting pointer (a quarter of
// a second) opens it too, beside the pointer, so passing over slices on the
// way to the menu does not. Hidden money: shares only.
function useOpenableSlices(enabled, { shareTotal, hidden, sliceFacts }) {
  const hoverTimer = useRef(0);
  return useMemo(() => {
    if (!enabled) {
      return null;
    }
    const facts = (payload) => {
      const percent = `${((payload.valueMinor / (shareTotal || 1)) * 100).toFixed(1)}%`;
      const extra = sliceFacts?.(payload, hidden) ?? null;
      const lines = [
        hidden ? spendingMixCopy.sliceShare(percent) : spendingMixCopy.sliceAmount(money(payload.valueMinor), percent),
        payload.entryCount ? spendingMixCopy.sliceEntries(payload.entryCount) : null,
        ...(extra?.lines ?? [])
      ].filter(Boolean);
      return { percent, lines, hasPlan: Boolean(extra?.hasPlan) };
    };
    const hoverOpen = (event) => {
      if (event.pointerType !== "mouse") return;
      const slice = event.currentTarget;
      const point = { x: event.clientX, y: event.clientY };
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        import("./figure-menu.js").then((menu) => menu.openFigureMenu(slice, { point, focus: false }), () => {});
      }, 250);
    };
    const hoverLeave = () => window.clearTimeout(hoverTimer.current);
    // Drawn in the labels' layer, over the coloured sector (whose own
    // pointer events are off, so Recharts never swaps it for an "active"
    // copy under the pointer): a clear sector of the same shape that takes
    // the tap, the hover and the focus, and the slice's label.
    return function OpenableSlice(props, labelNode) {
      const { payload, cx, cy, innerRadius, outerRadius, startAngle, endAngle } = props;
      const name = payload?.label ?? "";
      const { percent, lines, hasPlan } = facts(payload ?? { valueMinor: 0 });
      return (
        <g
          className="donut-slice"
          data-slice={name}
          data-fig="category"
          data-fig-arg={name}
          data-fig-colour={paletteColour(payload?.color)}
          data-fig-note={lines.join("\n")}
          data-fig-plan={hasPlan ? "" : undefined}
          role="button"
          tabIndex={0}
          aria-label={spendingMixCopy.sliceLabel(name, percent)}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverLeave}
        >
          <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius} startAngle={startAngle} endAngle={endAngle} fill="transparent" className="donut-slice-hit" />
          {labelNode}
        </g>
      );
    };
  }, [enabled, hidden, shareTotal, sliceFacts]);
}

// The arrow keys move between the slices, in ring order.
function moveBetweenSlices(event) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  const current = event.target.closest?.(".donut-slice");
  if (!step || !current) return;
  const slices = [...event.currentTarget.querySelectorAll(".donut-slice")];
  const next = slices[(slices.indexOf(current) + step + slices.length) % slices.length];
  event.preventDefault();
  next?.focus();
}
