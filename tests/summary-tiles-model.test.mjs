// Summary's tiles as data (src/client/summary-tiles-model.js): each tile's
// headline, chip and rows from what its card already read; an empty card has
// no tile; hidden money keeps names only; the change note is never an estimate.
import assert from "node:assert/strict";
import test from "node:test";

import { buildSubscriptionsModel, buildSubsGlance } from "../src/client/subscriptions-model.js";
import { buildBankFeesTile, buildComingTile, buildInvestmentsTile, buildMilesTile, buildSubsTile, buildTaxTile, changeNote } from "../src/client/summary-tiles-model.js";

const series = (key, extra = {}) => ({
  key, name: key.split("|")[0], period: "monthly", kind: "fixed", status: "active", category: "Bills", account: "UOB One",
  usualDay: 14, nextDate: "2026-12-14", runLength: 6,
  latest: { date: "2026-10-14", amountMinor: 1000, ids: ["a"] }, lowMinor: 1000, highMinor: 1000,
  focus: { amountMinor: 1000, ids: ["a"] }, year: { amountMinor: 6000, ids: ["a"] }, ...extra
});
const answer = {
  scope: "direct_plus_shared", today: "2026-11-10", focusMonth: "2026-10", yearStartMonth: "2025-11",
  series: [
    series("NETFLIX|monthly", { usualDay: 14 }),
    series("SINGTEL|monthly", { usualDay: 22, wentUp: { fromMinor: 3890, fromDate: "2026-09-22", fromIds: ["a"], toMinor: 4290, date: "2026-10-22", toIds: ["b"] } }),
    series("SPOTIFY|monthly", { usualDay: 27 }),
    series("GREAT EASTERN|monthly", { usualDay: 1, nextDate: "2026-12-01" }),
    series("SP SERVICES|monthly", { usualDay: 18, kind: "varies", lowMinor: 11860, highMinor: 14285 })
  ],
  mightRepeat: [], takenOff: []
};
const subsLabels = { inMonth: (month) => `In ${month}`, priceRises: (count) => (count === 1 ? "1 price rise" : `${count} price rises`) };

test("Subscriptions tile: this month's total, a price-rise chip, the 4 rows most worth a look, a bar by kind", () => {
  const model = buildSubscriptionsModel(answer);
  const tile = buildSubsTile({ model, glance: buildSubsGlance(model, null), hidden: false, labels: subsLabels });
  assert.deepEqual(tile.headline, { kind: "money", minor: 5000 });
  assert.deepEqual(tile.chip, { text: "1 price rise", tone: "butter" });
  assert.equal(tile.rows.length, 4);
  assert.equal(tile.rows[0].label, "SINGTEL", "what went up leads");
  assert.deepEqual(tile.bars.map((bar) => bar.key), ["monthly", "varies"]);
});

test("Subscriptions tile: nothing listed has no tile; hidden money keeps only the names", () => {
  assert.equal(buildSubsTile({ model: null, glance: null, hidden: false, labels: subsLabels }), null);
  assert.equal(buildSubsTile({ model: buildSubscriptionsModel({ ...answer, series: [] }), glance: null, hidden: false, labels: subsLabels }), null);
  const model = buildSubscriptionsModel(answer);
  const tile = buildSubsTile({ model, glance: buildSubsGlance(model, null), hidden: true, labels: subsLabels });
  assert.equal(tile.headline, null);
  assert.equal(tile.chip, null, "a price rise has a direction");
  assert.deepEqual(tile.bars, []);
  assert.ok(tile.rows.every((row) => row.value === null && row.label));
});

const comingLabels = { chargeCount: (count) => `${count} ${count === 1 ? "charge" : "charges"}`, dayMonth: (date) => date.slice(5) };

test("Coming up tile: the range, how many charges, the next 4 on their days; a bill that changes has no single amount", () => {
  const tile = buildComingTile({ answer, hidden: false, labels: comingLabels });
  assert.equal(tile.headline.kind, "range");
  assert.ok(tile.headline.lowMinor <= tile.headline.highMinor);
  assert.equal(tile.chip.text, "5 charges");
  assert.equal(tile.rows.length, 4);
  assert.deepEqual(tile.rows.map((row) => row.label.split(" · ")[1]), ["NETFLIX", "SP SERVICES", "SINGTEL", "SPOTIFY"]);
  assert.equal(tile.rows[1].value, null);
  assert.equal(Math.round(tile.bars.reduce((sum, bar) => sum + bar.share, 0)), 1);
});

test("Coming up tile: nothing due has no tile; hidden money has names only", () => {
  assert.equal(buildComingTile({ answer: { ...answer, series: [] }, hidden: false, labels: comingLabels }), null);
  assert.equal(buildComingTile({ answer: null, hidden: false, labels: comingLabels }), null);
  const tile = buildComingTile({ answer, hidden: true, labels: comingLabels });
  assert.equal(tile.headline, null);
  assert.equal(tile.chip, null);
  assert.ok(tile.rows.every((row) => row.value === null));
});

const invest = {
  worthMinor: 3212800, grewMinor: 56780, paidOutMinor: 0, startWorthMinor: 3000000,
  putIn: { amountMinor: 240000, ids: ["x"] },
  accounts: [{ name: "iFAST" }],
  months: [{ month: "2026-08", worthMinor: 3100000, putInMinor: 0 }, { month: "2026-09", worthMinor: null, putInMinor: 0 }, { month: "2026-10", worthMinor: 3212800, putInMinor: 240000 }]
};
const investLabels = { grewBy: (amount) => `Grew by ${amount}`, putIn: "Put in", paidOut: "Paid out" };
const signed = (minor) => `${minor > 0 ? "+" : "−"}$${Math.abs(minor / 100)}`;

test("Investments tile: worth, a mint chip for growth (rose for a fall), put in and paid out, a line over the statements", () => {
  const tile = buildInvestmentsTile({ answer: invest, hidden: false, labels: investLabels, formatSigned: signed });
  assert.deepEqual(tile.headline, { kind: "money", minor: 3212800 });
  assert.deepEqual(tile.chip, { text: "Grew by +$567.8", tone: "mint" });
  assert.deepEqual(tile.points, [3100000, 3212800], "a month with no statement is left out");
  assert.deepEqual(tile.rows.map((row) => row.label), ["Put in", "Paid out"]);
  assert.equal(buildInvestmentsTile({ answer: { ...invest, grewMinor: -500 }, hidden: false, labels: investLabels, formatSigned: signed }).chip.tone, "rose");
  assert.equal(buildInvestmentsTile({ answer: { ...invest, grewMinor: 0 }, hidden: false, labels: investLabels, formatSigned: signed }).chip, null);
});

test("Investments tile: no accounts has no tile; hidden money drops the chart, the chip and the change note", () => {
  assert.equal(buildInvestmentsTile({ answer: { ...invest, accounts: [] }, hidden: false, labels: investLabels, formatSigned: signed }), null);
  assert.equal(buildInvestmentsTile({ answer: null, hidden: false, labels: investLabels, formatSigned: signed }), null);
  const tile = buildInvestmentsTile({ answer: invest, hidden: true, labels: investLabels, formatSigned: signed });
  assert.equal(tile.headline, null);
  assert.deepEqual(tile.points, []);
  assert.equal(tile.chip, null);
  assert.equal(tile.change, null);
});

test("Miles tile: the miles so far, an Estimate chip, the cards that earned most first", () => {
  const model = { isEmpty: false, pictures: [{ cards: [{ name: "Citi", unit: "miles", earned: 281 }, { name: "UOB", unit: "miles", earned: 296 }, { name: "DBS", unit: "cashback", earned: 0.8 }] }] };
  const tile = buildMilesTile({ model, hidden: false, labels: { estimate: "Estimate" } });
  assert.deepEqual(tile.headline, { kind: "miles", amount: 577 });
  assert.equal(tile.chip.text, "Estimate");
  assert.deepEqual(tile.rows.map((row) => row.label), ["UOB", "Citi", "DBS"]);
  assert.equal(buildMilesTile({ model: { ...model, isEmpty: true }, hidden: false, labels: { estimate: "Estimate" } }), null);
  assert.ok(buildMilesTile({ model, hidden: true, labels: { estimate: "Estimate" } }).rows.every((row) => row.value === null));
});

test("Miles tile: a ring gauge for the bonus furthest through its cap; none without a cap or with nothing used; hidden money drops it", () => {
  const card = (name, bonuses) => ({ name, unit: "miles", earned: 100, bonuses });
  const model = { isEmpty: false, pictures: [{ cards: [
    card("Citi", [{ capMinor: 100000, usedMinor: 30000 }]),
    card("UOB Lady's", [{ capMinor: 100000, usedMinor: 62000 }, { capMinor: null, usedMinor: 99999 }])
  ] }] };
  const labels = { estimate: "Estimate" };
  assert.deepEqual(buildMilesTile({ model, hidden: false, labels }).gauge, { percent: 62, cardName: "UOB Lady's" });
  // The ring takes the room of two of the four rows.
  assert.equal(buildMilesTile({ model, hidden: false, labels }).rows.length, 2);
  assert.equal(buildMilesTile({ model: { ...model, pictures: [{ cards: [card("A", []), card("B", []), card("C", []), card("D", [])] }] }, hidden: false, labels }).rows.length, 4);
  // Over the cap reads as full, never above 100.
  assert.equal(buildMilesTile({ model: { ...model, pictures: [{ cards: [card("A", [{ capMinor: 1000, usedMinor: 4000 }])] }] }, hidden: false, labels }).gauge.percent, 100);
  // No cap, or nothing used: no gauge.
  assert.equal(buildMilesTile({ model: { ...model, pictures: [{ cards: [card("A", [{ capMinor: null, usedMinor: 500 }]), card("B", [{ capMinor: 1000, usedMinor: 0 }])] }] }, hidden: false, labels }).gauge, null);
  assert.equal(buildMilesTile({ model: { ...model, pictures: [{ cards: [{ name: "A", unit: "miles", earned: 5 }] }] }, hidden: false, labels }).gauge, null);
  assert.equal(buildMilesTile({ model, hidden: true, labels }).gauge, null);
});

test("Tax reliefs tile rows carry the share used as a percent; hidden money drops it", () => {
  const tax = { year: "2026", daysLeft: 51, people: [{ name: "Ethan", reliefs: [{ key: "srs", amountMinor: 1000000, limitMinor: 1530000, roomMinor: 530000 }, { key: "cpf_self", amountMinor: 900000, limitMinor: 800000, roomMinor: 0 }, { key: "x", amountMinor: 5, limitMinor: 0, roomMinor: 0 }] }] };
  const labels = { daysLeft: (days) => `${days} days left`, relief: { srs: "SRS", cpf_self: "CPF", x: "X" } };
  assert.deepEqual(buildTaxTile({ answer: tax, hidden: false, labels }).rows.map((row) => row.value), [{ kind: "percent", percent: 65 }, { kind: "percent", percent: 100 }, null]);
  assert.ok(buildTaxTile({ answer: tax, hidden: true, labels }).rows.every((row) => row.value === null));
});

test("Bank fees tile: by-month bars, each a share of the biggest month, the biggest marked; under two months, none", () => {
  const labels = { kinds: { annual_fee: "Annual fees" }, chargeCount: (count) => `${count} charges` };
  const fees = { netMinor: 14200, parts: [{ kind: "annual_fee", minor: 14200, count: 3 }], months: [{ month: "2026-03", minor: 1000 }, { month: "2026-06", minor: 12000 }, { month: "2026-09", minor: 1200 }] };
  const tile = buildBankFeesTile({ fees, hidden: false, labels });
  assert.deepEqual(tile.months.map((item) => [item.month, Math.round(item.share * 100), item.isBiggest]), [["2026-03", 8, false], ["2026-06", 100, true], ["2026-09", 10, false]]);
  assert.deepEqual(buildBankFeesTile({ fees: { ...fees, months: [{ month: "2026-06", minor: 14200 }] }, hidden: false, labels }).months, []);
  assert.deepEqual(buildBankFeesTile({ fees: { ...fees, months: undefined }, hidden: false, labels }).months, []);
  assert.deepEqual(buildBankFeesTile({ fees, hidden: true, labels }).months, []);
});

test("Tax reliefs tile: the room left, the days left, one bar per relief and person; nothing used has no tile", () => {
  const tax = {
    year: "2026", daysLeft: 51,
    people: [
      { name: "Ethan", reliefs: [{ key: "srs", amountMinor: 1000000, limitMinor: 1530000, roomMinor: 530000 }, { key: "cpf_self", amountMinor: 800000, limitMinor: 800000, roomMinor: 0 }] },
      { name: "Serene", reliefs: [{ key: "srs", amountMinor: 0, limitMinor: 1530000, roomMinor: 1530000 }] }
    ]
  };
  const labels = { daysLeft: (days) => `${days} days left`, relief: { srs: "SRS top-ups", cpf_self: "CPF top-up" } };
  const tile = buildTaxTile({ answer: tax, hidden: false, labels });
  assert.deepEqual(tile.headline, { kind: "money", minor: 2060000 });
  assert.equal(tile.chip.tone, "butter");
  assert.deepEqual(tile.bars.map((bar) => Math.round(bar.share * 100)), [65, 100, 0]);
  assert.equal(buildTaxTile({ answer: { ...tax, people: [] }, hidden: false, labels }), null);
  assert.deepEqual(buildTaxTile({ answer: tax, hidden: true, labels }).bars, []);
  assert.equal(buildTaxTile({ answer: { ...tax, daysLeft: 200 }, hidden: false, labels }).chip.tone, "sky");
});

test("Bank fees tile: what the year's fees came to, the kinds, the number of charges; no fees has no tile", () => {
  const fees = { netMinor: 14200, parts: [{ kind: "annual_fee", minor: 12000, count: 1 }, { kind: "fx_fee", minor: 2200, count: 5 }] };
  const labels = { kinds: { annual_fee: "Annual fees", fx_fee: "Foreign currency fees", other_fee: "Card fees" }, chargeCount: (count) => `${count} charges` };
  const tile = buildBankFeesTile({ fees, hidden: false, labels });
  assert.deepEqual(tile.headline, { kind: "money", minor: 14200 });
  assert.equal(tile.chip.text, "6 charges");
  assert.deepEqual(tile.rows.map((row) => row.label), ["Annual fees", "Foreign currency fees"]);
  assert.equal(buildBankFeesTile({ fees: undefined, hidden: false, labels }), null);
  assert.equal(buildBankFeesTile({ fees: { netMinor: 0, parts: [] }, hidden: false, labels }), null);
  const hidden = buildBankFeesTile({ fees, hidden: true, labels });
  assert.equal(hidden.headline, null);
  assert.deepEqual(hidden.bars, []);
});

test("change note: the arrow and percent only from two figures the card has, never an estimate", () => {
  assert.deepEqual(changeNote({ current: 5000, base: 100000, upIsGood: true }), { arrow: "▲", percent: 5, tone: "mint" });
  assert.deepEqual(changeNote({ current: -5000, base: 100000, upIsGood: true }), { arrow: "▼", percent: 5, tone: "rose" });
  // Spending that went up is rose, down is mint.
  assert.equal(changeNote({ current: 5000, base: 100000, upIsGood: false }).tone, "rose");
  assert.equal(changeNote({ current: -5000, base: 100000, upIsGood: false }).tone, "mint");
  // No history, a zero or tiny base, no change, or money hidden: no note.
  assert.equal(changeNote({ current: 5000, base: null, upIsGood: true }), null);
  assert.equal(changeNote({ current: 5000, base: 0, upIsGood: true }), null);
  assert.equal(changeNote({ current: 5000, base: 500, upIsGood: true, minBase: 10000 }), null);
  assert.equal(changeNote({ current: 0, base: 100000, upIsGood: true }), null);
  assert.equal(changeNote({ current: 100, base: 1000000, upIsGood: true }), null, "under 1% is no change");
  assert.equal(changeNote({ current: 5000, base: 100000, upIsGood: true, hidden: true }), null);
});

test("Tax reliefs tile chip: the days alone, one line in a half-width tile; the card keeps 'until 31 Dec'", async () => {
  const { summaryTilesCopy } = await import("../src/client/copy/summary-tiles-copy.js");
  const { taxReliefsCopy } = await import("../src/client/copy/summary-cards-copy.js");
  assert.equal(summaryTilesCopy.taxDaysLeft(50), "50 days left");
  assert.equal(summaryTilesCopy.taxDaysLeft(1), "1 day left");
  assert.equal(summaryTilesCopy.taxDaysLeft(0), "Last day");
  for (const days of [0, 1, 9, 50, 365]) assert.ok(summaryTilesCopy.taxDaysLeft(days).length <= 20, `${days}`);
  assert.equal(taxReliefsCopy.daysLeft(50), "50 days left, until 31 Dec");
  assert.equal(taxReliefsCopy.daysLeft(0), "Last day, until 31 Dec");
  const tax = { year: "2026", daysLeft: 50, people: [{ name: "Ethan", reliefs: [{ key: "srs", amountMinor: 0, limitMinor: 1530000, roomMinor: 1530000 }] }] };
  const tile = buildTaxTile({ answer: tax, hidden: false, labels: { daysLeft: summaryTilesCopy.taxDaysLeft, relief: { srs: "SRS" } } });
  assert.equal(tile.chip.text, "50 days left");
});
