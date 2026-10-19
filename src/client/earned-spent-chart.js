import "./earned-spent-chart.css";

import { earnedSpentChartCopy as copy } from "./copy/earned-spent-chart-copy";
import {
  buildChartMonths,
  chartGeometry,
  chartScales,
  chartSeries,
  compactMoney,
  pointFigure,
  toggleSeries
} from "./earned-spent-chart-model";
import { formatMonthLabel } from "./formatters";

// The column + line chart at the top of Summary's month-by-month card (the
// Simple view's "Earned vs spent by month", the Plan view's Intent vs
// Outcome; design.md "Plan or Simple"). Simple: Earned and Spent columns and
// a Kept line. Plan: Earned and Spent columns, a Planned spending line and
// Spent so far, adding up: a dashed ink running total on its own axis on the
// right (it would flatten the columns on theirs).
// It shows only for a range of two or more months (a single column says
// nothing the card does not), and with money hidden it draws nothing: no
// columns, no line, no axis, because their sizes and the line's side of zero
// would show the money.
//
// Hand-drawn SVG, no chart library, in its own lazy chunk like Spending Mix,
// with an invisible placeholder of the same height while it loads
// (.earned-spent-chart-reserve in summary-body.css). Every column and point
// is an openable figure like a Spending Mix slice (design.md "Openable
// figures", figure-menu.js): a tap, a click, Enter, or a resting pointer on a
// desktop opens a menu titled with the series and the month, with quick
// facts, View entries for that month, Open plan where there is a plan line,
// and Ask about this. The arrow keys move between points (Left and Right
// along a series, Up and Down between series, Home and End to the ends). The
// legend chips show or hide a series. On first view the columns grow from
// the baseline and the line draws on, unless the person asks for reduced
// motion.
//
// It is written with createElement, not JSX, imports no money-privacy and
// does not import React: the page hands React in (createEarnedSpentChart),
// as it hands `h` to simple-detail.js. Any of those would make the bundler
// split a shared module (jsx-runtime, react, money-privacy) out of the first
// screen's chunks, which is a file and bytes the Summary page must not pay
// for (npm run check:bundle). The page only mounts it while money shows.

/** @typedef {Pick<typeof import("react"), "createElement" | "useEffect" | "useLayoutEffect" | "useMemo" | "useRef" | "useState">} ReactHooks */
/** @type {ReactHooks} */
let R;

/** @param {any} type @param {any} [props] @param {...any} children */
const h = (type, props, ...children) => R.createElement(type, props, ...children);

/**
 * The chart component, built over the page's React (summary-panel.jsx).
 * @param {ReactHooks} react
 */
export function createEarnedSpentChart(react) {
  R = react;
  return EarnedSpentChart;
}

/**
 * @param {{ mode: "plan" | "simple", page: { months: any[], categoryShareByMonth?: any[], investmentMovesByMonth?: any[] } }} props
 *   `page` is the Summary page's own slice (summary-panel.jsx).
 */
function EarnedSpentChart({ mode, page }) {
  const rows = R.useMemo(() => buildChartMonths({ mode, ...page }), [mode, page]);
  // The panel draws no chart while money is hidden; this is the second guard.
  // It reads the page's privacy mark, as money() does.
  const isHidden = typeof document !== "undefined" && document.documentElement.dataset.moneyPrivacy === "hidden";
  if (isHidden || rows.length < 2) {
    return null;
  }
  return h(EarnedSpentChartBody, { mode, rows });
}

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Nothing animates on the server or for reduced motion; otherwise the shapes
// wait at their starting state until the chart is on screen, then play.
const initialMotion = () => (typeof window === "undefined" || prefersReducedMotion() ? "off" : "armed");

function EarnedSpentChartBody({ mode, rows }) {
  const series = R.useMemo(() => chartSeries(mode), [mode]);
  const allKeys = series.map((item) => item.key);
  const rootRef = R.useRef(null);
  const hoverTimer = R.useRef(0);
  const [width, setWidth] = R.useState(366);
  const [hiddenKeys, setHiddenKeys] = R.useState(() => new Set());
  const [activeKey, setActiveKey] = R.useState("");
  const [motion, setMotion] = R.useState(initialMotion);

  R.useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    const measure = () => setWidth(Math.max(200, Math.round(element.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Plays once, the first time the chart is on screen.
  R.useEffect(() => {
    if (motion !== "armed") return undefined;
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setMotion("playing");
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        setMotion("playing");
      }
    }, { threshold: 0.3 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [motion]);
  R.useEffect(() => {
    if (motion !== "playing") return undefined;
    const timer = window.setTimeout(() => setMotion("done"), 1400);
    return () => window.clearTimeout(timer);
  }, [motion]);
  R.useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const visible = series.filter((item) => !hiddenKeys.has(item.key));
  const bars = visible.filter((item) => item.kind === "bar");
  const lines = visible.filter((item) => item.kind === "line");
  // The left scale is of every month figure, so hiding one never rescales
  // the rest; the running total has the right one to itself.
  const scales = R.useMemo(() => chartScales(rows), [rows]);
  const scale = scales.left;
  const rightScale = lines.some((line) => line.axis === "right") ? scales.right : null;
  const geometry = chartGeometry({ width, monthCount: rows.length, barCount: bars.length, rightAxis: Boolean(rightScale) });
  const { top, plotHeight, plotWidth, height } = geometry;
  const yAt = (axis) => (minor) => top + (plotHeight * (axis.max - minor)) / (axis.max - axis.min);
  const yOf = yAt(scale);
  const yRight = rightScale ? yAt(rightScale) : yOf;
  const yFor = (seriesItem) => (seriesItem.axis === "right" ? yRight : yOf);
  const firstMonth = rows[0]?.month ?? "";
  const baseline = yOf(0);

  const points = [];
  rows.forEach((row, index) => {
    bars.forEach((item, barIndex) => points.push({ series: item, row, index, barIndex }));
  });
  lines.forEach((line) => {
    rows.forEach((row, index) => {
      if (lineValue(row, line.key) !== null) points.push({ series: line, row, index, barIndex: -1 });
    });
  });
  const keyOf = (point) => `${point.series.key}:${point.index}`;
  const tabKey = points.some((point) => keyOf(point) === activeKey) ? activeKey : points.length ? keyOf(points[0]) : "";

  function toggle(key) {
    setHiddenKeys((current) => toggleSeries(current, key, allKeys));
  }

  // The month's row in the list under the chart is marked while the pointer
  // or the focus is on its column.
  function markRow(month, on) {
    const card = rootRef.current?.closest(".chart-card");
    for (const row of card?.querySelectorAll(`[data-month="${month}"]`) ?? []) {
      row.classList.toggle("is-chart-active", on);
    }
  }

  // A resting mouse opens the menu beside the pointer, as a Spending Mix
  // slice does; passing over columns on the way elsewhere does not.
  function hoverOpen(event, month) {
    markRow(month, true);
    if (event.pointerType !== "mouse") return;
    const target = event.currentTarget;
    const at = { x: event.clientX, y: event.clientY };
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      import("./figure-menu.js").then((menu) => menu.openFigureMenu(target, { point: at, focus: false }), () => {});
    }, 250);
  }

  function hoverLeave(month) {
    window.clearTimeout(hoverTimer.current);
    markRow(month, false);
  }

  function moveBetweenPoints(event) {
    const current = event.target.closest?.(".ec-point");
    if (!current) return;
    const seriesKey = current.getAttribute("data-ec-series");
    const index = Number(current.getAttribute("data-ec-index"));
    const find = (key, at) => points.find((point) => point.series.key === key && point.index === at);
    const order = visible.map((item) => item.key);
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const step = event.key === "ArrowRight" ? 1 : -1;
      for (let at = index + step; at >= 0 && at < rows.length && !next; at += step) next = find(seriesKey, at);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      for (let at = order.indexOf(seriesKey) + step; at >= 0 && at < order.length && !next; at += step) next = find(order[at], index);
    } else if (event.key === "Home" || event.key === "End") {
      const ends = points.filter((point) => point.series.key === seriesKey);
      next = event.key === "Home" ? ends[0] : ends.at(-1);
    }
    if (!next) return;
    event.preventDefault();
    rootRef.current.querySelector(`[data-ec-series="${next.series.key}"][data-ec-index="${next.index}"]`)?.focus();
  }

  const handlers = (point) => ({
    isTab: keyOf(point) === tabKey,
    onFocus: () => {
      setActiveKey(keyOf(point));
      markRow(point.row.month, true);
    },
    onBlur: () => markRow(point.row.month, false),
    onHoverOpen: hoverOpen,
    onHoverLeave: hoverLeave
  });
  const yearShown = (row, index) => index === 0 || row.month.endsWith("-01");

  const barPoints = points.filter((point) => point.series.kind === "bar").map((point) => {
    const { series: item, row, index, barIndex } = point;
    const value = item.key === "earned" ? row.earnedMinor : row.spentMinor;
    const barTop = Math.min(yOf(value), baseline);
    const barHeight = Math.max(Math.abs(yOf(value) - baseline), value === 0 ? 0 : 1);
    const x = geometry.barX(index, barIndex);
    const hitWidth = geometry.band / bars.length;
    return h(
      PointGroup,
      { key: keyOf(point), point, mode, firstMonth, ...handlers(point) },
      h("rect", {
        className: `ec-bar is-${item.key}`,
        x,
        y: barTop,
        width: geometry.barWidth,
        height: barHeight,
        rx: 2,
        style: { transformOrigin: `${x + geometry.barWidth / 2}px ${baseline}px`, "--ec-i": index }
      }),
      h("rect", { className: "ec-hit", x: geometry.bandStart(index) + barIndex * hitWidth, y: top, width: hitWidth, height: plotHeight })
    );
  });

  // A dashed line keeps its dashes in pixels: it fades in instead of drawing
  // on (the draw-on uses a one-unit path length and dash).
  const linePaths = lines.flatMap((line) => lineSegments(rows, geometry, yFor(line), line.key).map((segment) => h("path", {
    key: `line-${line.key}-${segment.start}`,
    className: `ec-line is-${line.key}`,
    d: segment.d,
    pathLength: line.axis === "right" ? undefined : 1,
    fill: "none"
  })));
  const linePoints = points.filter((point) => point.series.kind === "line").map((point) => {
    const cx = geometry.bandCenter(point.index);
    const value = lineValue(point.row, point.series.key);
    const cy = yFor(point.series)(value);
    return h(
      PointGroup,
      { key: keyOf(point), point, mode, firstMonth, ...handlers(point) },
      h("circle", { className: `ec-dot is-${point.series.key}${value < 0 ? " is-negative" : ""}`, cx, cy, r: 4.5, style: { "--ec-i": point.index } }),
      h("circle", { className: "ec-hit", cx, cy, r: 14 })
    );
  });

  return h(
    "div",
    {
      ref: rootRef,
      className: "earned-spent-chart",
      "data-earned-spent-chart": mode,
      "data-chart-motion": motion,
      role: "group",
      "aria-label": copy.chartLabel[mode]
    },
    h(
      "div",
      { className: "ec-legend", role: "group", "aria-label": copy.legendLabel },
      series.map((item) => {
        const isOn = !hiddenKeys.has(item.key);
        return h(
          "button",
          {
            key: item.key,
            type: "button",
            className: `ec-chip${isOn ? "" : " is-off"}`,
            "data-series": item.key,
            "aria-pressed": isOn,
            onClick: () => toggle(item.key)
          },
          h("span", { className: "ec-chip-face" }, h("span", { className: `ec-swatch is-${item.kind}`, "aria-hidden": "true" }), item.label)
        );
      })
    ),
    h(
      "div",
      { className: "ec-frame", style: { "--ec-height": `${height}px` } },
      h(
        "svg",
        { className: "ec-axis", width: geometry.axisWidth, height, "aria-hidden": "true" },
        scale.ticks.map((tick) => h("text", { key: tick, className: "ec-axis-label", x: geometry.axisWidth - 6, y: yOf(tick) + 3.5, textAnchor: "end" }, compactMoney(tick)))
      ),
      h(
        "div",
        { className: `ec-scroll${geometry.scrolls ? " is-scrolling" : ""}` },
        h(
          "svg",
          { className: "ec-plot", width: plotWidth, height, role: "presentation", onKeyDown: moveBetweenPoints },
          scale.ticks.map((tick) => h("line", { key: `grid-${tick}`, className: tick === 0 ? "ec-zero" : "ec-grid", x1: 0, x2: plotWidth, y1: yOf(tick), y2: yOf(tick) })),
          rows.map((row, index) => {
            const [monthWord, yearWord] = formatMonthLabel(row.month).split(" ");
            const x = geometry.bandCenter(index);
            return h(
              "text",
              { key: row.month, className: "ec-month-label", x, y: height - 20, textAnchor: "middle", "aria-hidden": "true" },
              h("tspan", { x }, monthWord),
              yearShown(row, index) ? h("tspan", { className: "ec-year-label", x, dy: 12 }, yearWord) : null
            );
          }),
          barPoints,
          linePaths,
          linePoints
        )
      ),
      rightScale ? h(
        "svg",
        { className: "ec-axis is-right", width: geometry.rightAxisWidth, height, "aria-hidden": "true" },
        rightScale.ticks.map((tick) => h("text", { key: tick, className: "ec-axis-label is-running", x: 6, y: yRight(tick) + 3.5, textAnchor: "start" }, compactMoney(tick)))
      ) : null
    )
  );
}

// One column or point as an openable figure (figure-menu.js reads these
// attributes): the figure, the month as its period, the quick facts, the
// plan link, and a label that says the month, the series and the amount.
function PointGroup({ point, mode, firstMonth, isTab, onFocus, onBlur, onHoverOpen, onHoverLeave, children }) {
  const { series: item, row, index } = point;
  const figure = pointFigure(mode, item, row, firstMonth);
  return h(
    "g",
    {
      className: `ec-point is-${item.kind}`,
      "data-ec-series": item.key,
      "data-ec-index": index,
      "data-ec-month": row.month,
      "data-fig": figure.fig,
      "data-fig-period": figure.period,
      "data-fig-name": figure.name || undefined,
      "data-fig-ask": figure.ask || undefined,
      "data-fig-plan": figure.plan === null ? undefined : figure.plan,
      "data-fig-note": figure.note.join("\n"),
      role: "button",
      tabIndex: isTab ? 0 : -1,
      "aria-label": figure.label,
      onFocus,
      onBlur,
      onPointerEnter: (event) => onHoverOpen(event, row.month),
      onPointerLeave: () => onHoverLeave(row.month)
    },
    children
  );
}

// Runs of months that have a point, each its own path, so a month without
// one (no plan) breaks the line instead of being drawn through zero.
function lineValue(row, key) {
  if (key === "running") return row.runningMinor ?? null;
  return row.lineMinor;
}

function lineSegments(rows, geometry, yOf, key) {
  const segments = [];
  let current = null;
  rows.forEach((row, index) => {
    const value = lineValue(row, key);
    if (value === null) {
      current = null;
      return;
    }
    const command = `${geometry.bandCenter(index).toFixed(1)} ${yOf(value).toFixed(1)}`;
    if (current) {
      current.d += ` L${command}`;
    } else {
      current = { start: index, d: `M${command}` };
      segments.push(current);
    }
  });
  return segments;
}
