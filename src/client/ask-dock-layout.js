// Desktop Ask layout (design.md "Desktop Ask"): pure rules for where the Ask
// conversation opens beside the page. Loads with the dock panel
// (ask-dock-panel.jsx), not in the first screen.
//
// - A phone (760 px and narrower) has no field or panel: Ask is its tab.
// - From 761 px to 1,279 px the conversation is a popup over the page,
//   anchored bottom right.
// - From 1,280 px it docks as a panel that pushes the page narrower (the
//   page keeps at least 880 px, where the header still fits on one row).
// The mode is chosen when the person opens Ask. A docked panel turns into
// the popup while the window is too narrow to push the page; a popup kept
// open while the window widens stays put and offers the expand control.

import { isAskShortcutKey } from "./ask-dock-entry";
import { ASK_DOCK_MIN_WIDTH, ASK_DOCK_WIDE_QUERY, MOBILE_LAYOUT_MAX_WIDTH } from "./use-viewport";

export { ASK_DOCK_MIN_WIDTH, ASK_DOCK_WIDE_QUERY, isAskShortcutKey };

// The browser answers the two media queries (use-viewport.js is the only
// module that asks); this turns them into a width inside the right band.
export function askDockBandWidth({ phone, wide }) {
  if (phone) return MOBILE_LAYOUT_MAX_WIDTH;
  return wide ? ASK_DOCK_MIN_WIDTH : MOBILE_LAYOUT_MAX_WIDTH + 1;
}

/** @param {number} width */
export function askDockModeOnOpen(width) {
  return Number.isFinite(width) && width >= ASK_DOCK_MIN_WIDTH ? "docked" : "popup";
}

/**
 * @param {{ width: number, mode: string }} input
 * @returns {{ layout: "hidden" | "popup" | "docked", canExpand: boolean }}
 */
export function selectAskDockLayout({ width, mode }) {
  if (!Number.isFinite(width) || width <= MOBILE_LAYOUT_MAX_WIDTH) {
    return { layout: "hidden", canExpand: false };
  }
  if (width < ASK_DOCK_MIN_WIDTH) {
    return { layout: "popup", canExpand: false };
  }
  return mode === "popup" ? { layout: "popup", canExpand: true } : { layout: "docked", canExpand: false };
}
