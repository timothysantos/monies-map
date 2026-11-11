// Summary's "Subscriptions and bills" card as data (design.md
// "Subscriptions and bills"): the totals, the rows in order and the folds,
// from the server's answer (repeating-charges-api.js). Pure, so the
// figures are tested without a page: every amount shown is the sum the
// server named, with the entry ids behind it.

import { addDays } from "../domain/money-signals/format";
import { COMING_UP_DAYS, upcomingCharges } from "../domain/repeating-charges";
import { roundRange } from "../domain/pace";

const PHONE_ROWS = 4;
// A wide card lists the 8 most worth a look in two columns (the rest hide
// behind the same Show all on a narrow one).
const GLANCE_ROWS = 8;

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
    glanceRows: phoneOrder(rows).slice(0, GLANCE_ROWS),
    stopped,
    mightRepeat: answer.mightRepeat,
    takenOff: answer.takenOff,
    isEmpty: !answer.series.length && !answer.mightRepeat.length && !answer.takenOff.length
  };
}

// The month a figure's charges fall in, as a figure period.
export const monthPeriod = (date) => `${String(date).slice(0, 7)}:${String(date).slice(0, 7)}`;

// Coming up (design.md "Subscriptions and bills"): the next 30 days of the
// listed charges on their usual days, grouped by week: this week (to
// Sunday), next week, later. Dates and the last amounts only; the total
// comes with "If this keeps up".
export function buildComingUp(answer, days = COMING_UP_DAYS) {
  if (!answer) {
    return null;
  }
  const today = answer.today;
  const byKey = new Map(answer.series.map((series) => [series.key, series]));
  const upcoming = upcomingCharges(answer.series, today, days);
  // Sunday ends a week: the days left in this one, then seven more.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const thisWeekEnd = addDays(today, (7 - weekday) % 7);
  const nextWeekEnd = addDays(thisWeekEnd, 7);
  const groups = [
    { key: "this", items: [] },
    { key: "next", items: [] },
    { key: "later", items: [] }
  ];
  for (const charge of upcoming) {
    const group = charge.date <= thisWeekEnd ? groups[0] : charge.date <= nextWeekEnd ? groups[1] : groups[2];
    group.items.push({ ...charge, series: byKey.get(charge.key) });
  }
  // The 30 days' total (If this keeps up, DOMAIN.md "Pace"): a range rounded
  // outward, one amount rounded to its nearest step.
  const total = roundRange(upcoming.reduce((sum, item) => sum + item.lowMinor, 0), upcoming.reduce((sum, item) => sum + item.highMinor, 0));
  return { endDate: addDays(today, days), count: upcoming.length, total, groups: groups.filter((group) => group.items.length) };
}

// The wide card's glance (design.md "Summary dashboard layout"), from facts
// already on the card: how many charges went up, the next charge due (name,
// day and, when it is one amount, the amount) and the listed charges' cost
// over the 12 months split by what kind they are, for the stacked bar.
export function buildSubsGlance(model, comingUp) {
  if (!model) {
    return null;
  }
  const priceRises = model.rows.filter((series) => series.wentUp).length;
  const first = comingUp?.groups?.[0]?.items?.[0] ?? null;
  const next = first ? {
    name: first.series?.name ?? "",
    date: first.date,
    amountMinor: first.lowMinor === first.highMinor ? first.lowMinor : null
  } : null;
  const kinds = [
    { key: "monthly", minor: 0 },
    { key: "varies", minor: 0 },
    { key: "yearly", minor: 0 }
  ];
  for (const series of model.rows) {
    const kind = series.period === "yearly" ? kinds[2] : series.kind === "varies" ? kinds[1] : kinds[0];
    kind.minor += Math.max(0, series.year.amountMinor);
  }
  const total = kinds.reduce((sum, kind) => sum + kind.minor, 0);
  return {
    priceRises,
    next,
    kinds: kinds.filter((kind) => kind.minor > 0).map((kind) => ({ ...kind, share: total > 0 ? kind.minor / total : 0 }))
  };
}
