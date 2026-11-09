// Summary's "Subscriptions and bills" card as data (design.md
// "Subscriptions and bills"): the totals, the rows in order and the folds,
// from the server's answer (repeating-charges-api.js). Pure, so the
// figures are tested without a page: every amount shown is the sum the
// server named, with the entry ids behind it.

const PHONE_ROWS = 4;

const sumOf = (list, pick) => ({
  amountMinor: list.reduce((sum, series) => sum + pick(series).amountMinor, 0),
  ids: list.flatMap((series) => pick(series).ids)
});

// The rows most worth a look on a phone: anything that went up or stopped
// coming, then the costliest.
function phoneOrder(rows) {
  const flagged = rows.filter((series) => series.wentUp || series.status === "late");
  const rest = rows.filter((series) => !flagged.includes(series));
  return [...flagged, ...rest];
}

/**
 * @param {ReturnType<typeof import("./repeating-charges-api").readRepeatingCharges>} answer
 */
export function buildSubscriptionsModel(answer) {
  if (!answer) {
    return null;
  }
  // Listed: active and late (not seen since). Stopped ones are folded away;
  // all of them were paid, so all count in the totals.
  const rows = answer.series.filter((series) => series.status !== "stopped");
  const stopped = answer.series.filter((series) => series.status === "stopped");
  const counted = answer.series;
  return {
    focusMonth: answer.focusMonth,
    yearStartMonth: answer.yearStartMonth,
    focusPeriod: `${answer.focusMonth}:${answer.focusMonth}`,
    yearPeriod: `${answer.yearStartMonth}:${answer.focusMonth}`,
    totals: {
      focus: sumOf(counted, (series) => series.focus),
      year: sumOf(counted, (series) => series.year)
    },
    rows,
    phoneRows: phoneOrder(rows).slice(0, PHONE_ROWS),
    stopped,
    mightRepeat: answer.mightRepeat,
    takenOff: answer.takenOff,
    isEmpty: !answer.series.length && !answer.mightRepeat.length && !answer.takenOff.length
  };
}

// The month a figure's charges fall in, as a figure period.
export const monthPeriod = (date) => `${String(date).slice(0, 7)}:${String(date).slice(0, 7)}`;
