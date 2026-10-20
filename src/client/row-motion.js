import "./row-motion.css";

import { isInvestmentsCategoryName, isSavingsCategoryName } from "../domain/money-jobs";
import { paletteColour } from "./palette-colour";

// The shared hover and press motion of list rows and cards (design.md
// "Motion", row-motion.css): Entries rows, Spending Mix's list, the Summary
// month rows and cards, the Month plan rows, and the Splits rows. A row
// carries the `motion-row` class; a row with a category also carries its
// colour as `--row-tint` (the faint wash under the pointer) and the little
// move its category icon makes, as `data-glyph`.
//
// The moves, by the category's icon (ui-options.jsx), each a quarter of a
// second or less: Food tilts its fork and knife, Travel's plane nudges
// forward, Transport and Taxi slide, Shopping's bag and Groceries' cart
// bounce, Bills and Subscriptions give a small shake, Salary, Extra income,
// Investments and Savings nudge up; everything else pops.

const GLYPH_BY_ICON = {
  utensils: "tilt",
  plane: "fly",
  bus: "drive",
  "car-front": "drive",
  "shopping-bag": "bounce",
  "shopping-cart": "bounce",
  lightbulb: "shake",
  banknote: "shake",
  "washing-machine": "shake",
  "badge-dollar-sign": "rise",
  "banknote-arrow-up": "rise"
};

/**
 * The move a category's icon makes when its row is pointed at.
 * @param {{ iconKey?: string | null, name?: string | null } | null | undefined} category
 */
export function glyphMotion(category) {
  // Investments uses the Bills banknote and Savings the plain receipt, so
  // these two go by name: money put away nudges up, it does not shake.
  if (isInvestmentsCategoryName(category?.name) || isSavingsCategoryName(category?.name)) {
    return "rise";
  }
  return GLYPH_BY_ICON[category?.iconKey ?? ""] ?? "pop";
}

/**
 * The attributes a row with a category adds: its glyph move and its tint.
 * A row without a category needs only the `motion-row` class (it takes the
 * neutral wash).
 * @param {{ iconKey?: string | null, name?: string | null, colorHex?: string | null, color?: string | null } | null | undefined} category
 * @param {Record<string, string | number | undefined>} [style] the row's own style, kept
 */
export function rowMotionProps(category, style = undefined) {
  const colour = category?.colorHex ?? category?.color ?? null;
  return {
    "data-glyph": glyphMotion(category),
    style: colour ? { ...style, "--row-tint": paletteColour(colour) } : style
  };
}
