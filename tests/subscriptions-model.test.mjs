// Summary's Subscriptions and bills as data (src/client/subscriptions-model.js):
// the totals come only from the listed and stopped charges, a phone shows the
// rows most worth a look first, and Coming up groups the next 30 days by week.
import assert from "node:assert/strict";
import test from "node:test";

import { buildComingUp, buildSubscriptionsModel } from "../src/client/subscriptions-model.js";

const series = (key, extra = {}) => ({
  key,
  name: key.split("|")[0],
  period: "monthly",
  kind: "fixed",
  status: "active",
  category: "Bills",
  account: "UOB One • Tim",
  usualDay: 14,
  nextDate: "2026-11-14",
  runLength: 6,
  latest: { date: "2026-10-14", amountMinor: 1000, ids: [`${key}-last`] },
  lowMinor: 1000,
  highMinor: 1000,
  focus: { amountMinor: 1000, ids: [`${key}-last`] },
  year: { amountMinor: 6000, ids: [`${key}-1`, `${key}-last`] },
  ...extra
});

const answer = {
  viewId: "household",
  scope: "direct_plus_shared",
  today: "2026-11-10",
  focusMonth: "2026-10",
  yearStartMonth: "2025-11",
  series: [
    series("GREAT EASTERN|monthly", { usualDay: 1, nextDate: "2026-12-01", latest: { date: "2026-11-01", amountMinor: 18630, ids: ["ge"] }, year: { amountMinor: 223560, ids: ["ge"] } }),
    series("NETFLIX|monthly", { usualDay: 14 }),
    series("SP SERVICES|monthly", { usualDay: 18, kind: "varies", lowMinor: 11860, highMinor: 14285 }),
    series("SINGTEL|monthly", { usualDay: 22, wentUp: { fromMinor: 3890, fromDate: "2026-09-22", fromIds: ["a"], toMinor: 4290, date: "2026-10-22", toIds: ["b"] } }),
    series("SPOTIFY|monthly", { usualDay: 27 }),
    series("VIU|monthly", { status: "stopped", lastSeenMonth: "2026-07", year: { amountMinor: 3592, ids: ["v1"] }, focus: { amountMinor: 0, ids: [] } })
  ],
  mightRepeat: [series("DISNEY|monthly", { status: "might_repeat", year: { amountMinor: 999999, ids: ["d"] } })],
  takenOff: [series("ALLOWANCE|monthly", { status: "taken_off", year: { amountMinor: 600000, ids: ["x"] } })]
};

test("totals add the listed and stopped charges only; a phone leads with what went up", () => {
  const model = buildSubscriptionsModel(answer);
  assert.equal(model.totals.year.amountMinor, 223560 + 6000 * 4 + 3592);
  assert.ok(!model.totals.year.ids.includes("d") && !model.totals.year.ids.includes("x"));
  assert.deepEqual(model.rows.map((item) => item.key.split("|")[0]), ["GREAT EASTERN", "NETFLIX", "SP SERVICES", "SINGTEL", "SPOTIFY"]);
  assert.deepEqual(model.stopped.map((item) => item.key), ["VIU|monthly"]);
  assert.deepEqual(model.phoneRows.map((item) => item.key.split("|")[0]), ["SINGTEL", "GREAT EASTERN", "NETFLIX", "SP SERVICES"]);
  assert.equal(buildSubscriptionsModel(null), null);
});

test("coming up: this week to Sunday, next week, later; a bill that changes keeps its range; nothing stopped", () => {
  const coming = buildComingUp(answer);
  assert.equal(coming.endDate, "2026-12-10");
  assert.deepEqual(coming.groups.map((group) => [group.key, group.items.map((item) => `${item.key.split("|")[0]} ${item.date}`)]), [
    ["this", ["NETFLIX 2026-11-14"]],
    ["next", ["SP SERVICES 2026-11-18", "SINGTEL 2026-11-22"]],
    ["later", ["SPOTIFY 2026-11-27", "GREAT EASTERN 2026-12-01"]]
  ]);
  const sp = coming.groups[1].items[0];
  assert.deepEqual([sp.lowMinor, sp.highMinor], [11860, 14285]);
  assert.equal(coming.count, 5);
  // If this keeps up: the 30 days' total, rounded outward around the exact sums.
  const items = coming.groups.flatMap((group) => group.items);
  const low = items.reduce((sum, item) => sum + item.lowMinor, 0);
  const high = items.reduce((sum, item) => sum + item.highMinor, 0);
  assert.ok(low < high);
  assert.ok(coming.total.lowMinor <= low && coming.total.highMinor >= high);
  assert.equal(coming.total.lowMinor % 1_000, 0);
  assert.equal(coming.total.highMinor % 1_000, 0);
  assert.ok(coming.total.highMinor - high < 5_000 && low - coming.total.lowMinor < 5_000);
});
