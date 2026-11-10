import { paceCopy as copy } from "./copy/pace-copy";
import { paceTotals } from "../domain/pace";

// The words of "If this keeps up" (pace-line.jsx) and its figure menu's
// note, from the same sums as the bar: pure, so they are tested without a
// page (tests/pace-surfaces.test.mjs).

const MONTH_END = (month) => {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
};

// The rounding step, as the note says it ($10, $50 or $100; pace.ts).
function stepWords(minor) {
  return Math.abs(minor) < 100_000 ? "$10" : Math.abs(minor) < 1_000_000 ? "$50" : "$100";
}

// A rounded end reads "$4,700", never "$4,700.00".
const whole = (money, minor) => money(minor).replace(/\.00(?=\D*$)/, "");

/**
 * The words of a pace line and its menu note, from the same sums as the bar.
 * @param {{ pace: any, spentSoFarMinor?: number | null, planMinor?: number | null, money: (minor: number) => string }} input
 */
export function paceLineWords({ pace, spentSoFarMinor = null, planMinor = null, money }) {
  const spent = Number.isFinite(spentSoFarMinor) ? spentSoFarMinor : pace.spentSoFarMinor ?? 0;
  const totals = paceTotals(spent, pace.range);
  const plan = Number.isFinite(planMinor) && planMinor > 0 ? planMinor : null;
  // The plan is named when the whole range is on one side of it.
  const side = !plan ? null : totals.highMinor <= plan ? "under" : totals.lowMinor > plan ? "over" : null;
  const sentence = `${copy.line(whole(money, totals.shown.lowMinor), whole(money, totals.shown.highMinor), MONTH_END(pace.month))}${side ? `, ${copy.plan(whole(money, plan), side === "over")}` : ""}.`;
  const oneOffs = (pace.range.oneOffs ?? []).reduce((sum, item) => sum + item.amountMinor, 0);
  const note = [
    copy.workedOut,
    copy.spentSoFar(money(spent)),
    copy.everyday(pace.range.daysLeft, money(pace.range.everydayLowMinor), money(pace.range.everydayHighMinor)),
    copy.bills(money(pace.range.billsLowMinor), money(pace.range.billsHighMinor)),
    ...(oneOffs > 0 ? [copy.onceOnly(money(oneOffs))] : []),
    copy.roundedTo(stepWords(totals.highMinor))
  ];
  const left = pace.range.incomeMinor > 0 ? copy.left(whole(money, totals.leftShown.lowMinor), whole(money, totals.leftShown.highMinor)) : "";
  return { spent, totals, plan, side, sentence, note, left };
}

