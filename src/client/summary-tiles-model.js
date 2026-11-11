// The small tile each of Summary's Coming up, Subscriptions (on a phone),
// Investments, Miles, Tax reliefs and Bank fees cards stands in as (design.md
// "Summary tiles"), as data so it is tested without a page. A tile is only a
// glance at what its card already read: a title, a headline, one status chip
// (mint, rose, butter or sky), a few rows, and optionally bars or a small
// chart. Nothing is estimated and nothing is read that the card does not read.
//
// Every builder returns null when the card would show nothing (the tile is
// then not drawn). With money hidden a tile keeps its title and the names of
// its rows and drops every amount, direction, chip and mark that would show
// one (`hidden: true`), as the cards do.
import { buildComingUp } from "./subscriptions-model";

const ROWS = 4;

const hiddenTile = (tile) => ({ ...tile, headline: null, chip: null, change: null, bars: [], points: [], gauge: null, months: [], rows: tile.rows.map((row) => ({ label: row.label, value: null })) });
const finish = (tile, hidden) => (hidden ? hiddenTile(tile) : tile);
const plural = (count, one, many) => (count === 1 ? one : many);

/** @param {{ model: any, glance: any, hidden: boolean, labels: { inMonth: (month: string) => string, priceRises: (count: number) => string } }} input */
export function buildSubsTile({ model, glance, hidden, labels }) {
  if (!model || model.isEmpty) return null;
  return finish({
    id: "subs",
    headline: { kind: "money", minor: model.totals.focus.amountMinor },
    headlineLabel: labels.inMonth(model.focusMonth),
    chip: glance?.priceRises ? { text: labels.priceRises(glance.priceRises), tone: "butter" } : null,
    rows: model.glanceRows.slice(0, ROWS).map((series) => ({ label: series.name, value: { kind: "money", minor: series.latest.amountMinor } })),
    bars: (glance?.kinds ?? []).map((kind) => ({ key: kind.key, share: kind.share })),
    points: []
  }, hidden);
}

/** @param {{ answer: any, hidden: boolean, labels: { chargeCount: (count: number) => string, dayMonth: (date: string) => string } }} input */
export function buildComingTile({ answer, hidden, labels }) {
  const coming = buildComingUp(answer);
  if (!coming || !coming.count) return null;
  const items = coming.groups.flatMap((group) => group.items);
  return finish({
    id: "coming",
    headline: { kind: "range", lowMinor: coming.total.lowMinor, highMinor: coming.total.highMinor },
    chip: { text: labels.chargeCount(coming.count), tone: "sky" },
    rows: items.slice(0, ROWS).map((item) => ({
      label: `${labels.dayMonth(item.date)} · ${item.series?.name ?? ""}`,
      value: item.lowMinor === item.highMinor ? { kind: "money", minor: item.lowMinor } : null
    })),
    bars: coming.groups.map((group) => ({ key: group.key, share: group.items.length / coming.count })),
    points: []
  }, hidden);
}

/** @param {{ answer: any, hidden: boolean, formatSigned: (minor: number) => string, labels: { grewBy: (signedAmount: string) => string, putIn: string, paidOut: string } }} input */
export function buildInvestmentsTile({ answer, hidden, labels, formatSigned }) {
  if (!answer || !answer.accounts?.length) return null;
  const grew = answer.grewMinor;
  const points = answer.months.filter((month) => month.worthMinor !== null).map((month) => month.worthMinor);
  return finish({
    id: "investments",
    headline: { kind: "money", minor: answer.worthMinor },
    chip: grew === 0 ? null : { text: labels.grewBy(formatSigned(grew)), tone: grew > 0 ? "mint" : "rose" },
    rows: [
      { label: labels.putIn, value: { kind: "money", minor: answer.putIn.amountMinor } },
      { label: labels.paidOut, value: { kind: "money", minor: answer.paidOutMinor } }
    ],
    bars: [],
    points: points.length > 1 ? points : [],
    change: changeNote({ current: grew, base: answer.startWorthMinor, upIsGood: true, minBase: 1 })
  }, hidden);
}

// The miles bonus furthest through its cap this cycle, as a ring gauge: how
// much of the cap is used, and the card it is on. Only bonuses with a cap; a
// card whose bonus has no cap, or nothing used, has no gauge.
function bonusGauge(milesCards) {
  let best = null;
  for (const card of milesCards) {
    for (const bonus of card.bonuses ?? []) {
      if (!(bonus.capMinor > 0)) continue;
      const share = Math.min(1, Math.max(0, bonus.usedMinor / bonus.capMinor));
      if (share > 0 && (!best || share > best.share)) best = { share, cardName: card.name };
    }
  }
  return best ? { percent: Math.round(best.share * 100), cardName: best.cardName } : null;
}

/** @param {{ model: any, hidden: boolean, labels: { estimate: string } }} input */
export function buildMilesTile({ model, hidden, labels }) {
  if (!model || model.isEmpty) return null;
  const cards = model.pictures.flatMap((picture) => picture.cards);
  const milesCards = cards.filter((card) => card.unit === "miles");
  const total = milesCards.reduce((sum, card) => sum + card.earned, 0);
  const useMiles = milesCards.length > 0;
  const value = (card) => ({ kind: card.unit === "miles" ? "miles" : "cashback", amount: card.earned });
  const gauge = bonusGauge(milesCards);
  return finish({
    gauge,
    id: "miles",
    headline: useMiles ? { kind: "miles", amount: total } : { kind: "cashback", amount: cards.reduce((sum, card) => sum + card.earned, 0) },
    chip: { text: labels.estimate, tone: "butter" },
    // The ring takes the room of two rows.
    rows: [...cards].sort((left, right) => right.earned - left.earned).slice(0, gauge ? ROWS - 2 : ROWS).map((card) => ({ label: card.name, value: value(card) })),
    bars: [],
    points: []
  }, hidden);
}

/** @param {{ answer: any, hidden: boolean, labels: { daysLeft: (days: number) => string, relief: Record<string, string> } }} input */
export function buildTaxTile({ answer, hidden, labels }) {
  if (!answer || !answer.people?.length) return null;
  const reliefs = answer.people.flatMap((person) => person.reliefs.map((relief) => ({ person: person.name, relief })));
  const room = reliefs.reduce((sum, item) => sum + Math.max(0, item.relief.roomMinor), 0);
  return finish({
    id: "taxreliefs",
    headline: { kind: "money", minor: room },
    headlineLabel: null,
    chip: { text: labels.daysLeft(answer.daysLeft), tone: answer.daysLeft <= 60 ? "butter" : "sky" },
    rows: reliefs.slice(0, 3).map((item) => ({
      label: `${item.person} · ${labels.relief[item.relief.key]}`,
      value: item.relief.limitMinor > 0 ? { kind: "percent", percent: Math.round(Math.min(1, item.relief.amountMinor / item.relief.limitMinor) * 100) } : null
    })),
    bars: reliefs.slice(0, 3).map((item) => ({
      key: `${item.person}-${item.relief.key}`,
      share: item.relief.limitMinor > 0 ? Math.min(1, item.relief.amountMinor / item.relief.limitMinor) : 0
    })),
    points: []
  }, hidden);
}

// The year's fees by month as small bars: each month's share of the biggest
// month, the biggest one marked. Two or more months, or no chart.
function feeMonths(months) {
  const list = (months ?? []).filter((item) => item.minor > 0);
  if (list.length < 2) return [];
  const biggest = Math.max(...list.map((item) => item.minor));
  const first = list.find((item) => item.minor === biggest);
  return list.map((item) => ({ key: item.month, month: item.month, share: item.minor / biggest, isBiggest: item === first }));
}

/** @param {{ fees: any, hidden: boolean, labels: { kinds: Record<string, string>, chargeCount: (count: number) => string } }} input */
export function buildBankFeesTile({ fees, hidden, labels }) {
  if (!fees || !fees.parts?.length || fees.netMinor <= 0) return null;
  const count = fees.parts.reduce((sum, part) => sum + part.count, 0);
  return finish({
    id: "bankfees",
    headline: { kind: "money", minor: fees.netMinor },
    chip: { text: labels.chargeCount(count), tone: "sky" },
    rows: fees.parts.slice(0, ROWS).map((part) => ({ label: labels.kinds[part.kind] ?? labels.kinds.other_fee, value: { kind: "money", minor: part.minor } })),
    bars: fees.parts.slice(0, ROWS).map((part) => ({ key: part.kind, share: part.minor / fees.netMinor })),
    months: feeMonths(fees.months),
    points: []
  }, hidden);
}

export { plural };

// The change note under a big number (owner, 2026-11-11): "▲ 12%" and the
// quiet words after it. Worked out only from two figures the card already
// has; with no base to compare to (nothing, or too small), or money hidden,
// there is no note: never an estimate. `upIsGood` sets the tone (mint for
// growth in investments, rose for spending that went up).
export function changeNote({ current, base, upIsGood, minBase = 1, hidden = false }) {
  if (hidden || base === null || base === undefined || !(base >= minBase) || !Number.isFinite(current)) return null;
  const percent = Math.round((Math.abs(current) / base) * 100);
  if (percent === 0 || current === 0) return null;
  const up = current > 0;
  return { arrow: up ? "▲" : "▼", percent, tone: up === upIsGood ? "mint" : "rose" };
}
