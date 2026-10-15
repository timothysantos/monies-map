import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";

const copy = planStudioCopy.info;
// A resting pointer opens it after this, and leaving closes it after this, so
// sweeping the pointer down a list does not flash a popover on every row.
const HOVER_MS = 140;

// What a row's popover reads: the facts of rowInfo() in plain words. A line is
// only there when the figure behind it is (a row new this month has no last
// month; income, saving and past months have no pace).
export function InfoBody({ row, info, fmt, id }) {
  const verb = copy.spent[row.job];
  const lines = [];
  if (info.lastPlannedMinor !== null) {
    lines.push([copy.lastMonth, copy.lastMonthValue(fmt.money(info.lastPlannedMinor), info.lastActualMinor === null ? null : fmt.money(info.lastActualMinor), verb)]);
  }
  if (info.averageActualMinor !== null && info.averageMonths > 0) {
    lines.push([copy.average, copy.averageValue(fmt.money(info.averageActualMinor), info.averageMonths, verb)]);
  }
  if (!lines.length) lines.push([copy.lastMonth, copy.noPast]);

  let rest;
  if (info.overMinor > 0) rest = copy.over(fmt.money(info.overMinor));
  else if (row.job === "income") rest = copy.toCome(fmt.money(info.leftMinor));
  else if (row.job === "save") rest = copy.toKeep(fmt.money(info.leftMinor));
  else if (row.job === "invest") rest = copy.toMove(fmt.money(info.leftMinor));
  else rest = copy.left(fmt.money(info.leftMinor));
  lines.push([copy.soFar, `${copy.soFarValue(fmt.money(info.spentMinor), verb)}, ${rest}`]);

  if (info.pace) {
    // A pace gap is a rough measure: whole dollars, not cents.
    const gap = fmt.money(Math.round(info.pace.amountMinor / 100) * 100);
    let pace = copy.paceOn;
    if (info.pace.kind === "ahead") pace = copy.paceAhead(gap);
    else if (info.pace.kind === "behind") pace = info.pace.dated ? copy.paceDueBehind(gap) : copy.paceBehind(gap);
    lines.push([copy.pace, pace, info.pace.kind]);
  }
  if (info.effect) {
    lines.push([copy.change, copy.effect(fmt.signed(info.effect.changeMinor), fmt.money(info.effect.leftOverMinor)), "effect"]);
  }
  return (
    <dl className="ps-info" id={id} data-ps-info>
      {lines.map(([term, text, kind]) => (
        <div key={term} data-kind={kind}>
          <dt>{term}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Open state for a row's popover: it shows while the pointer rests on the
 * row's controls (a wide screen), while any control in them has focus, while
 * the info button has pinned it (a phone), and while a slider is moving.
 * Escape closes it until the next hover, focus or drag.
 */
// The last time anything was pressed with a pointer: a slider that takes focus
// from a press (a drag, a tap) is not a keyboard visit, whatever the browser
// says about :focus-visible.
let lastPointerAt = 0;
let listening = false;
function listenForPointers() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pointerdown", () => { lastPointerAt = Date.now(); }, true);
}

export function useInfoOpen() {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef(0);
  useEffect(() => {
    listenForPointers();
    return () => window.clearTimeout(timer.current);
  }, []);

  const reopen = useCallback(() => setDismissed(false), []);
  const handlers = {
    onPointerEnter: (event) => {
      if (event.pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setDismissed(false); setHover(true); }, HOVER_MS);
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setHover(false), HOVER_MS);
    },
    onFocus: (event) => {
      // Only a keyboard focus opens it: a tap or click on a slider is a drag.
      if (Date.now() - lastPointerAt > 500 && event.target.matches?.(":focus-visible")) { setDismissed(false); setFocus(true); }
    },
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false);
    }
  };
  return {
    open: !dismissed && (hover || focus || pinned || dragging),
    handlers,
    dragging,
    pinned,
    setDragging: (next) => { if (next) reopen(); setDragging(next); },
    togglePinned: () => { reopen(); setPinned((current) => !current); },
    dismiss: () => { setDismissed(true); setPinned(false); }
  };
}

/**
 * A row's controls with their popover: the anchor is the controls' wrapper.
 * It is the same Radix popover as the exact-amount editor, placed under the
 * controls and kept inside the viewport. Hidden money renders no popover.
 */
export function InfoPopover({ id, anchorProps, open, hidden, row, info, fmt, onDismiss, children }) {
  const shown = open && !hidden;
  // The row's own state decides when it shows (hover, focus, the info button,
  // a drag), so a press on the slider is never an "outside" press; only
  // Escape closes it.
  return (
    <Popover.Root open={shown}>
      <Popover.Anchor asChild>
        <div {...anchorProps}>{children}</div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="ps-pop ps-info-pop"
          side="bottom"
          align="center"
          sideOffset={6}
          collisionPadding={12}
          role="tooltip"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={onDismiss}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <InfoBody row={row} info={info} fmt={fmt} id={id} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The phone's way in: a 44px button that pins the popover open. */
export function InfoButton({ label, pinned, onClick }) {
  return (
    <button type="button" className="ps-icon-button ps-info-button" aria-label={copy.button(label)} aria-pressed={pinned} onClick={onClick} data-ps-info-button>
      <Info size={18} aria-hidden="true" />
    </button>
  );
}
