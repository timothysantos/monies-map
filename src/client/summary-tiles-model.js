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
import { changeNote } from "./change-note";
import { buildComingUp } from "./subscriptions-model";

export { changeNote };

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
    points: [],
    change: subsChange(model, hidden)
  }, hidden);
}

const monthBefore = (month, back = 1) => {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

// The change notes on the Subscriptions, Miles and Bank fees tiles use
// Spending mix's rule (changeNote; design.md "Change notes"): worked out only
// from figures the card already holds, nothing when the comparison is missing,
// too small to count, or money is hidden. `vs` names the words after the
// percent (summary-tiles.jsx): "month" is "vs the month before",
// "fullMonths" adds "(full months only)".
//
// Subscriptions: the month's total (the last full month) against the month
// before it (the server's `focusBeforeMinor`, the same charges), rose when it went up. A base under
// $100 is too small, as it is for Spending mix.
export function subsChange(model, hidden) {
  if (hidden || !Number.isFinite(model.focusBeforeMinor)) return null;
  const base = model.focusBeforeMinor;
  const note = changeNote({ current: model.totals.focus.amountMinor - base, base, upIsGood: false, minBase: 10_000 });
  return note ? { ...note, vs: "month" } : null;
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

// Miles and cashback: earned so far this cycle against the same days of the
// cycle before (the server's `earnedBefore`, card-rewards.ts), so half a cycle
// is not set against a whole one; earning more is mint. A base under 100 miles
// (or 100 cents) is too small, and an answer without the figure says nothing.
export function milesChange(cards, hidden) {
  if (hidden || cards.some((card) => !Number.isFinite(card.earnedBefore))) return null;
  const earned = cards.reduce((sum, card) => sum + card.earned, 0);
  const base = cards.reduce((sum, card) => sum + card.earnedBefore, 0);
  const note = changeNote({ current: earned - base, base, upIsGood: true, minBase: 100 });
  return note ? { ...note, vs: "month" } : null;
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
    points: [],
    change: milesChange(useMiles ? milesCards : cards, hidden)
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

// Bank fees: the last full month's fees against the month before it, both in
// the fee year (so none in January), never the month in progress. A base under
// $10 is too small; fees that went up are rose. Months with no fee are absent
// from the list, so they count as nothing.
export function feesChange(fees, currentMonth, hidden) {
  if (hidden || !currentMonth) return null;
  const last = monthBefore(currentMonth);
  const before = monthBefore(currentMonth, 2);
  if (!last.startsWith(fees.year) || !before.startsWith(fees.year)) return null;
  const minorOf = (month) => fees.months?.find((item) => item.month === month)?.minor ?? 0;
  const base = minorOf(before);
  const note = changeNote({ current: minorOf(last) - base, base, upIsGood: false, minBase: 1_000 });
  return note ? { ...note, vs: "fullMonths" } : null;
}

/** @param {{ fees: any, hidden: boolean, currentMonth?: string, labels: { kinds: Record<string, string>, chargeCount: (count: number) => string } }} input */
export function buildBankFeesTile({ fees, hidden, labels, currentMonth = "" }) {
  if (!fees || !fees.parts?.length || fees.netMinor <= 0) return null;
  const count = fees.parts.reduce((sum, part) => sum + part.count, 0);
  return finish({
    id: "bankfees",
    headline: { kind: "money", minor: fees.netMinor },
    chip: { text: labels.chargeCount(count), tone: "sky" },
    rows: fees.parts.slice(0, ROWS).map((part) => ({ label: labels.kinds[part.kind] ?? labels.kinds.other_fee, value: { kind: "money", minor: part.minor } })),
    bars: fees.parts.slice(0, ROWS).map((part) => ({ key: part.kind, share: part.minor / fees.netMinor })),
    months: feeMonths(fees.months),
    points: [],
    change: feesChange(fees, currentMonth, hidden)
  }, hidden);
}

/** @param {{ balances: Array<{ name: string, currency: string, balanceMinor: number, owes: string }> | undefined, hidden: boolean, labels: { settledUp: string } }} input */
export function buildSplitsTile({ balances, hidden, labels }) {
  if (!balances?.length) return null;
  const amount = (balance) => ({ kind: "currency", minor: Math.abs(balance.balanceMinor), currency: balance.currency });
  // Who owes whom reads from the viewer: owed to you is mint, a debt rose;
  // the household has no direction ("Net balance"), so it is sky.
  const toneOf = (balance) => (balance.balanceMinor === 0 ? null : balance.owes === "Net balance" ? "sky" : balance.balanceMinor > 0 ? "mint" : "rose");
  const top = balances[0];
  return finish({
    id: "splits",
    headline: top.balanceMinor === 0 ? { kind: "words", text: labels.settledUp } : amount(top),
    chip: top.balanceMinor === 0 ? null : { text: top.owes, tone: toneOf(top) },
    rows: balances.slice(0, ROWS).map((balance) => ({
      label: balance.name,
      value: balance.balanceMinor === 0 ? null : amount(balance),
      // Money tones are text only; sky is the household's neutral, so a row has no tone then.
      tone: toneOf(balance) === "sky" ? null : toneOf(balance)
    })),
    bars: [],
    points: []
  }, hidden);
}

export { plural };

