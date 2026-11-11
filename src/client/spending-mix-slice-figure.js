import { useMemo, useRef } from "react";

import { spendingMixCopy } from "./copy/spending-mix-copy";
import { money } from "./formatters";
import { paletteColour } from "./palette-colour";

// A Spending Mix slice as an openable figure (design.md "Openable figures",
// figure-menu.js), shared by both donuts (spending-mix-recharts.jsx,
// spending-mix-bubbles.jsx): the category's figure attributes and its quick
// facts (`data-fig-note`, one fact per line: amount and share, entries, then
// the page's own facts such as the plan and the top merchants), and a
// resting mouse (a quarter of a second) opens the menu beside the pointer,
// so passing over slices on the way to the menu does not. Hidden money:
// shares only.
export function useSliceFigure({ shareTotal, hidden, sliceFacts }) {
  const hoverTimer = useRef(0);
  return useMemo(() => {
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
    /** The figure attributes of a slice's payload (spread onto its element). */
    const figureProps = (payload) => {
      const name = payload?.label ?? "";
      const { percent, lines, hasPlan } = facts(payload ?? { valueMinor: 0 });
      return {
        percent,
        props: {
          "data-fig": "category",
          "data-fig-arg": name,
          "data-fig-colour": paletteColour(payload?.color),
          "data-fig-note": lines.join("\n"),
          "data-fig-plan": hasPlan ? "" : undefined,
          onPointerEnter: hoverOpen,
          onPointerLeave: hoverLeave
        }
      };
    };
    return { facts, hoverOpen, hoverLeave, figureProps };
  }, [hidden, shareTotal, sliceFacts]);
}
