import { useEffect, useRef, useState } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";
import { moneyToneClass } from "./money-tone-class";
import { RollingMoney } from "./plan-studio-parts";

const copy = planStudioCopy;
// A slice shows its name when it is at least this many pixels wide.
const LABEL_MIN_PX = 64;
const BURST_MS = 700;

// The bar's scale: every slice on one scale, wide enough for the planned
// money in and for everything planned out (so an over-allocation spills past
// the "Planned in" line); inside a job, the job's slices fill the bar.
export function barScale(segments, totals, zoom) {
  if (zoom) return Math.max(segments.reduce((sum, segment) => sum + segment.amountMinor, 0), 1);
  return Math.max(totals.income, totals.out, 1);
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function segmentName(segment) {
  if (segment.kind === "left") return copy.jobs.left;
  return segment.kind === "job" ? copy.jobs[segment.job] : segment.label;
}

// One draggable line between two slices: a slider (arrow keys move it five
// steps with Shift) 44px wide so a thumb can find it.
function Divider({ index, leftMinor, scaleMinor, before, after, fmt, onMove, onGestureStart, onGestureEnd, barRef, step }) {
  const drag = useRef(null);
  const keys = useRef({ active: false, timer: 0 });
  const latest = useRef(/** @type {any} */ ({}));
  latest.current = { scaleMinor, leftMinor, onMove, onGestureStart, onGestureEnd, step };

  useEffect(() => () => window.clearTimeout(keys.current.timer), []);

  function valueAt(clientX) {
    const rect = barRef.current.getBoundingClientRect();
    return ((clientX - rect.left) / Math.max(rect.width, 1)) * latest.current.scaleMinor;
  }

  function endKeys() {
    window.clearTimeout(keys.current.timer);
    if (keys.current.active) {
      keys.current.active = false;
      latest.current.onGestureEnd();
    }
  }

  return (
    <button
      type="button"
      role="slider"
      className="ps-divider"
      style={{ left: `${(leftMinor / scaleMinor) * 100}%` }}
      aria-label={copy.moveLine(segmentName(before), segmentName(after))}
      aria-valuemin={0}
      aria-valuemax={Math.round(scaleMinor / 100)}
      aria-valuenow={Math.round(leftMinor / 100)}
      aria-valuetext={fmt.hidden ? copy.hidden : copy.moveLineValue(fmt.money(leftMinor))}
      data-ps-divider={index}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = true;
        latest.current.onGestureStart();
      }}
      onPointerMove={(event) => {
        if (drag.current) latest.current.onMove(index, valueAt(event.clientX));
      }}
      onPointerUp={() => {
        if (drag.current) {
          drag.current = null;
          latest.current.onGestureEnd();
        }
      }}
      onPointerCancel={() => {
        if (drag.current) {
          drag.current = null;
          latest.current.onGestureEnd();
        }
      }}
      onKeyDown={(event) => {
        const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        if (!keys.current.active) {
          keys.current.active = true;
          latest.current.onGestureStart();
        }
        latest.current.onMove(index, latest.current.leftMinor + direction * (event.shiftKey ? 5 : 1) * latest.current.step);
        window.clearTimeout(keys.current.timer);
        keys.current.timer = window.setTimeout(endKeys, BURST_MS);
      }}
      onBlur={endKeys}
    />
  );
}

/**
 * The big picture (design.md "Plan Studio"): one bar for where planned money
 * in goes (Spend, Save, Invest, left over), a "Planned in" line that an
 * over-allocation spills past, lines to drag money between jobs, and the plan
 * balance in plain words with a one-tap fix. A job opens to one slice per
 * category.
 */
export function BigPicture({
  monthLine, paceChip, balance, fix, onFix, segments, totals, zoom, onZoom, fmt, dotColours, jobColours, incomeParts = [],
  onMoveLine, onGestureStart, onGestureEnd, dragging, readOnly = false
}) {
  const barRef = useRef(null);
  const barWidth = useWidth(barRef);
  const scale = barScale(segments, totals, zoom);
  let cumulative = 0;
  const lefts = segments.map((segment) => {
    cumulative += segment.amountMinor;
    return cumulative;
  });
  const over = !zoom && totals.out > totals.income;
  const text = balance.text;
  const zoomName = zoom ? copy.jobs[zoom] : "";
  return (
    <section className="ps-card ps-big" data-ps-big aria-label={copy.barTitle}>
      <div className="ps-card-head">
        <span className="ps-eyebrow">{monthLine}</span>
        {paceChip ? <span className={`ps-pill ${fmt.hidden ? "" : moneyToneClass(paceChip.tone, "soft")}`}>{paceChip.text}</span> : null}
      </div>
      <div className={`ps-banner ${fmt.hidden ? "is-neutral" : `is-${balance.tone}`}`} data-ps-balance data-kind={fmt.hidden ? "hidden" : balance.kind}>
        <div>
          <b>{balance.title}</b>
          <span>{text}</span>
        </div>
        {fix ? <button type="button" className="ps-banner-action" data-ps-fix onClick={onFix}>{fix.label}</button> : null}
      </div>
      <div className="ps-card-head ps-bar-head">
        <span className="ps-eyebrow">{zoom ? copy.barTitleJob(zoomName) : copy.barTitle}</span>
        {zoom ? <button type="button" className="ps-quiet" onClick={() => onZoom(null)}>{copy.allJobs}</button> : null}
      </div>
      <div className={`ps-bar${dragging ? " is-dragging" : ""}`} ref={barRef} data-ps-bar>
        <div className="ps-bar-segs">
          {segments.map((segment) => {
            const widthPx = (segment.amountMinor / scale) * barWidth;
            const colour = segment.kind === "left" ? undefined : fmt.hidden ? "var(--ps-neutral)" : (segment.kind === "job" ? jobColours[segment.job] : dotColours[segment.key]);
            return (
              <div
                key={segment.id}
                className={`ps-seg${segment.kind === "left" ? " is-left" : ""}`}
                style={{ width: `${(segment.amountMinor / scale) * 100}%`, "--ps-seg": colour }}
                data-ps-seg={segment.id}
              >
                {widthPx >= LABEL_MIN_PX ? <span>{segmentName(segment)}</span> : null}
              </div>
            );
          })}
        </div>
        {over ? (
          <div
            className={`ps-bar-over${fmt.hidden ? " is-neutral" : ""}`}
            style={{ left: `${(totals.income / scale) * 100}%`, width: `${((totals.out - totals.income) / scale) * 100}%` }}
            data-ps-over
          >
            {((totals.out - totals.income) / scale) * barWidth >= 70 ? copy.over(fmt.money(totals.out - totals.income)) : null}
          </div>
        ) : null}
        {!zoom ? (
          <div className="ps-bar-flag" style={{ left: `${(totals.income / scale) * 100}%` }} data-ps-flag>
            <i>{copy.plannedIn(fmt.money(totals.income))}</i>
          </div>
        ) : null}
        {!zoom && incomeParts.length ? (
          <div className="ps-income-strip" style={{ width: `${(totals.income / scale) * 100}%` }} data-ps-income-strip aria-hidden="true">
            {incomeParts.map((part) => (
              <i key={part.key} style={{ flexGrow: part.amountMinor, "--ps-seg": fmt.hidden ? "var(--ps-neutral)" : dotColours[part.key] }} data-ps-income-seg={part.key} />
            ))}
          </div>
        ) : null}
        {readOnly ? null : segments.slice(0, -1).map((segment, index) => (
          <Divider
            key={segment.id}
            index={index}
            leftMinor={lefts[index]}
            scaleMinor={scale}
            before={segment}
            after={segments[index + 1]}
            fmt={fmt}
            barRef={barRef}
            step={segment.kind === "job" ? 5000 : 1000}
            onMove={onMoveLine}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
        ))}
      </div>
      <div className="ps-legend">
        {segments.map((segment) => {
          const name = segmentName(segment);
          const colour = segment.kind === "left" ? undefined : fmt.hidden ? "var(--ps-neutral)" : (segment.kind === "job" ? jobColours[segment.job] : dotColours[segment.key]);
          const body = (
            <>
              <i className={segment.kind === "left" ? "is-left" : ""} style={{ "--ps-seg": colour }} />
              <span>{name}</span>
              <b><RollingMoney minor={segment.amountMinor} fmt={fmt} /></b>
            </>
          );
          return segment.kind === "job" ? (
            <button key={segment.id} type="button" className="ps-legend-item" aria-label={copy.resizeCategories(name)} onClick={() => onZoom(segment.job)}>{body}</button>
          ) : (
            <span key={segment.id} className="ps-legend-item is-static">{body}</span>
          );
        })}
      </div>
      {!zoom && incomeParts.length ? (
        <div className="ps-legend ps-legend-income" data-ps-income-legend role="group" aria-label={copy.incomeStrip.hiddenLabel}>
          <span className="ps-legend-title">{copy.incomeStrip.label}</span>
          {incomeParts.map((part) => (
            <span key={part.key} className="ps-legend-item is-static" data-ps-income-part={part.key}>
              <i style={{ "--ps-seg": fmt.hidden ? "var(--ps-neutral)" : dotColours[part.key] }} />
              <span>{part.label}</span>
              <b><RollingMoney minor={part.amountMinor} fmt={fmt} /></b>
            </span>
          ))}
        </div>
      ) : null}
      <p className="ps-hint">{readOnly ? copy.barHintReadOnly : zoom ? copy.barHintJob : copy.barHint}</p>
    </section>
  );
}
