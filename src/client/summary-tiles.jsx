import "./summary-tiles.css";
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { buildCardRewardsModel } from "./card-rewards-model";
import { cardRewardsCopy as cardRewardsCopy, formatMiles } from "./copy/card-rewards-copy";
import { summaryTilesCopy as copy } from "./copy/summary-tiles-copy";
import { dayMonth, subscriptionsCopy } from "./copy/subscriptions-copy";
import { investmentsCopy, taxReliefsCopy } from "./copy/summary-cards-copy";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { queryKeys } from "./query-keys";
import { buildSubscriptionsModel, buildSubsGlance, buildComingUp } from "./subscriptions-model";
import { InvestmentsCard } from "./investments-card";
import { CardRewardsSection } from "./card-rewards-section";
import { SubscriptionsSection } from "./subscriptions-section";
import { TaxReliefsCard } from "./tax-reliefs-card";
import { SheetDialog } from "./sheet-dialog";
import { buildBankFeesTile, buildComingTile, buildInvestmentsTile, buildMilesTile, buildSubsTile, buildTaxTile } from "./summary-tiles-model";
import { requestInvestmentsOverTime, requestTaxReliefs } from "./summary-cards-api";
import { useCardRewards } from "./use-card-rewards";
import { useRepeatingCharges } from "./use-repeating-charges";
import { useSummaryCardQuery } from "./use-summary-card-query";

// Summary's tiles (design.md "Summary tiles"): a glance at a card, built from
// the data the card already reads (the same queries, so nothing new is read),
// and the sheet or dialog that opens the whole card when a tile is tapped.
// The models are in summary-tiles-model.js; this file only draws them. In
// Spending Mix's lazy chunk, like the cards.

const HIDDEN = "••••";
// A rounded amount reads "$540", never "$540.00".
const whole = (minor) => money(minor).replace(/\.00(?=\D*$)/, "");
const signed = (minor) => {
  const amount = money(Math.abs(minor));
  return amount.includes("$") ? `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${amount}` : amount;
};

function formatValue(value) {
  if (!value) return null;
  if (value.kind === "money") return whole(value.minor);
  if (value.kind === "miles") return cardRewardsCopy.miles(value.amount);
  if (value.kind === "cashback") return money(Math.floor(value.amount));
  return null;
}

function formatHeadline(headline) {
  if (!headline) return HIDDEN;
  if (headline.kind === "range") return `${whole(headline.lowMinor)} to ${whole(headline.highMinor)}`;
  if (headline.kind === "miles") return formatMiles(headline.amount);
  return formatValue(headline);
}

const TONE_CLASS = { mint: "money-in", rose: "money-short" };

function Visual({ id, tile }) {
  if (tile.points.length > 1) {
    const low = Math.min(...tile.points);
    const high = Math.max(...tile.points);
    const span = high - low || 1;
    const points = tile.points.map((point, index) => `${Math.round((index / (tile.points.length - 1)) * 200)},${Math.round(34 - ((point - low) / span) * 30)}`).join(" ");
    return (
      <svg className="summary-tile-line" viewBox="0 0 200 38" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  if (!tile.bars.length) return null;
  if (id === "taxreliefs") {
    return (
      <span className="summary-tile-bars" aria-hidden="true">
        {tile.bars.map((bar) => <span key={bar.key} className="summary-tile-track"><span style={{ width: `${Math.round(bar.share * 100)}%` }} /></span>)}
      </span>
    );
  }
  if (id === "coming") {
    return (
      <span className="summary-tile-weeks" aria-hidden="true">
        {tile.bars.map((bar) => <span key={bar.key} style={{ height: `${Math.max(12, Math.round(bar.share * 100))}%` }} />)}
      </span>
    );
  }
  return (
    <span className="summary-tile-stack" aria-hidden="true">
      {tile.bars.map((bar, index) => <span key={bar.key} className={`is-k${index % 4}`} style={{ width: `${bar.share * 100}%` }} />)}
    </span>
  );
}

function TileView({ tile, title, label = null, onOpen }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const headline = formatHeadline(tile.headline);
  return (
    <button type="button" className="summary-tile" data-tile={tile.id} aria-haspopup="dialog" onClick={() => onOpen(tile.id)}>
      <span className="summary-tile-head">
        <span className="summary-tile-title">{title}</span>
        <span className="summary-tile-open">{copy.open}</span>
      </span>
      {label && areTotalsVisible ? <span className="summary-tile-label">{label}</span> : null}
      <span className="summary-tile-headline">
        {headline}
        {tile.id === "miles" && tile.headline?.kind === "miles" ? <small>{copy.milesSoFar}</small> : null}
        {tile.id === "taxreliefs" && tile.headline ? <small>{copy.roomLeft}</small> : null}
      </span>
      <span className="summary-tile-meta">
        {tile.chip ? <span className={`summary-tile-chip is-${tile.chip.tone}`}>{tile.chip.text}</span> : null}
        {tile.change ? (
          <span className="summary-tile-note"><b className={TONE_CLASS[tile.change.tone]}>{tile.change.arrow} {tile.change.percent}%</b> {copy.changeSinceJan}</span>
        ) : null}
      </span>
      <span className="summary-tile-rows">
        {tile.rows.map((row) => (
          <span key={row.label} className="summary-tile-row">
            <span>{row.label}</span>
            {areTotalsVisible && row.value ? <b>{formatValue(row.value)}</b> : null}
          </span>
        ))}
      </span>
      <Visual id={tile.id} tile={tile} />
    </button>
  );
}

function useHidden() {
  return !useMoneyPrivacy().areTotalsVisible;
}

function SubsTileCard({ view, enabled, fetchRequiredQuery, onOpen, id }) {
  const queryClient = useQueryClient();
  const hidden = useHidden();
  const { answer } = useRepeatingCharges({ queryClient, viewId: view.id, scope: view.selectedScope, enabled, fetchRequiredQuery });
  const tile = useMemo(() => {
    if (id === "coming") {
      return buildComingTile({ answer, hidden, labels: { chargeCount: copy.chargeCount, dayMonth } });
    }
    const model = buildSubscriptionsModel(answer);
    return buildSubsTile({ model, glance: buildSubsGlance(model, buildComingUp(answer)), hidden, labels: { inMonth: subscriptionsCopy.inMonth, priceRises: subscriptionsCopy.priceRises } });
  }, [answer, hidden, id]);
  if (!tile) return null;
  return <TileView tile={tile} title={copy.titles[id]} label={id === "subs" ? subscriptionsCopy.inMonth(answer.focusMonth) : null} onOpen={onOpen} />;
}

function InvestmentsTile({ view, enabled, fetchRequiredQuery, onOpen }) {
  const queryClient = useQueryClient();
  const hidden = useHidden();
  const viewId = view?.id ?? "household";
  const queryKey = useMemo(() => queryKeys.investmentsOverTime(viewId), [viewId]);
  const fetcher = useCallback((options) => requestInvestmentsOverTime(viewId, options), [viewId]);
  const answer = useSummaryCardQuery({ queryClient, queryKey, enabled, fetchRequiredQuery, fetcher, abortMessage: "Investments request aborted." });
  const tile = useMemo(() => buildInvestmentsTile({
    answer, hidden, formatSigned: signed, labels: { grewBy: copy.grewBy, putIn: investmentsCopy.putIn, paidOut: investmentsCopy.paidOut }
  }), [answer, hidden]);
  return tile ? <TileView tile={tile} title={copy.titles.investments} onOpen={onOpen} /> : null;
}

function MilesTile({ view, enabled, fetchRequiredQuery, onOpen }) {
  const queryClient = useQueryClient();
  const hidden = useHidden();
  const { answer } = useCardRewards({ queryClient, viewId: view.id, enabled, fetchRequiredQuery });
  const model = useMemo(() => buildCardRewardsModel(answer), [answer]);
  const tile = useMemo(() => buildMilesTile({ model, hidden, labels: { estimate: cardRewardsCopy.estimate } }), [model, hidden]);
  return tile ? <TileView tile={tile} title={copy.titles.miles} onOpen={onOpen} /> : null;
}

function TaxTile({ view, enabled, fetchRequiredQuery, onOpen }) {
  const queryClient = useQueryClient();
  const hidden = useHidden();
  const viewId = view?.id ?? "household";
  const queryKey = useMemo(() => queryKeys.taxReliefs(viewId), [viewId]);
  const fetcher = useCallback((options) => requestTaxReliefs(viewId, options), [viewId]);
  const answer = useSummaryCardQuery({ queryClient, queryKey, enabled, fetchRequiredQuery, fetcher, abortMessage: "Tax reliefs request aborted." });
  const tile = useMemo(() => buildTaxTile({ answer, hidden, labels: { daysLeft: taxReliefsCopy.daysLeft, relief: taxReliefsCopy.reliefs } }), [answer, hidden]);
  return tile ? <TileView tile={tile} title={copy.titles.taxreliefs} onOpen={onOpen} /> : null;
}

function BankFeesTile({ fees, onOpen }) {
  const hidden = useHidden();
  const tile = useMemo(() => buildBankFeesTile({ fees, hidden, labels: { kinds: copy.bankFeeKinds, chargeCount: copy.chargeCount } }), [fees, hidden]);
  return tile ? <TileView tile={tile} title={copy.titles.bankfees} onOpen={onOpen} /> : null;
}

/**
 * The tile of a registered card. It draws nothing when its card would show
 * nothing; `onOpen(id)` opens the card in the sheet.
 * @param {{ id: string, view: any, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, fees?: any, onOpen: (id: string) => void }} props
 */
export function SummaryTile({ id, view, enabled, fetchRequiredQuery, fees = undefined, onOpen }) {
  const shared = { view, enabled, fetchRequiredQuery, onOpen };
  if (id === "subs" || id === "coming") return <SubsTileCard {...shared} id={id} />;
  if (id === "investments") return <InvestmentsTile {...shared} />;
  if (id === "miles") return <MilesTile {...shared} />;
  if (id === "taxreliefs") return <TaxTile {...shared} />;
  if (id === "bankfees") return <BankFeesTile fees={fees} onOpen={onOpen} />;
  return null;
}

// Bank fees this year: the card a Bank fees tile opens. From the page's own
// answer (no read of its own): what the year's fees came to, by kind. The
// total is an openable figure (`spent` over the fee rows' ids, View entries lists exactly the
// fee rows, whose Spent total is the figure).
export function BankFeesCard({ fees, rangeEndMonth }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  if (!fees || !fees.parts?.length) return null;
  const count = fees.parts.reduce((sum, part) => sum + part.count, 0);
  const refunded = fees.refundedParts?.reduce((sum, part) => sum + part.minor, 0) ?? 0;
  return (
    <section className="chart-card bankfees-card" aria-labelledby="bankfees-title" data-fig-period={`${fees.year}-01:${rangeEndMonth}`}>
      <div className="bankfees-head">
        <h3 id="bankfees-title">{copy.titles.bankfees}</h3>
        <p>{copy.bankFees.intro}</p>
      </div>
      <p className="bankfees-total">
        <span data-fig="spent" data-fig-ids={fees.ids.join(" ")} data-fig-name={copy.titles.bankfees} tabIndex={0} role="button">{areTotalsVisible ? whole(fees.netMinor) : HIDDEN}</span>
        <small>{copy.bankFees.charges(count)}</small>
      </p>
      <ul className="bankfees-list" aria-label={copy.titles.bankfees}>
        {fees.parts.map((part) => (
          <li key={part.kind} className="bankfees-row">
            <span>{copy.bankFeeKinds[part.kind] ?? copy.bankFeeKinds.other_fee}<small> · {copy.bankFees.charges(part.count)}</small></span>
            <b>{areTotalsVisible ? whole(part.minor) : HIDDEN}</b>
          </li>
        ))}
      </ul>
      {refunded > 0 && areTotalsVisible ? <p className="bankfees-refunded">{copy.bankFees.refunded(whole(refunded))}</p> : null}
    </section>
  );
}

/**
 * The sheet (a phone) or centred dialog (a desktop) that opens a tile's whole
 * card: the same component the card uses, with its own tabs, lists and
 * openable figures. Esc, a swipe down and the close button close it.
 * @param {{ id: string, view: any, categories: any[], enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, runBackgroundRefresh?: any, fees?: any, rangeEndMonth: string, onClose: () => void }} props
 */
export function SummaryTileSheet({ id, view, categories, enabled, fetchRequiredQuery, runBackgroundRefresh = undefined, fees = undefined, rangeEndMonth, onClose }) {
  const shared = { view, enabled, fetchRequiredQuery };
  return (
    <SheetDialog
      className="summary-tile-sheet"
      title={copy.sheetTitles[id]}
      descriptionHidden
      description={copy.sheetTitles[id]}
      hideSubmit
      quietLabel="Close"
      onQuiet={onClose}
      onClose={onClose}
      wide
    >
      {/* The cards' shared spacing rules are prefixed with this class (summary-body.css). */}
      <div className="summary-card-slot">
      {id === "subs" || id === "coming" ? (
        <SubscriptionsSection {...shared} categories={categories} runBackgroundRefresh={runBackgroundRefresh} initialTab={id === "coming" ? "coming" : "all"} />
      ) : null}
      {id === "investments" ? <InvestmentsCard {...shared} /> : null}
      {id === "miles" ? <CardRewardsSection {...shared} /> : null}
      {id === "taxreliefs" ? <TaxReliefsCard {...shared} /> : null}
      {id === "bankfees" ? <BankFeesCard fees={fees} rangeEndMonth={rangeEndMonth} /> : null}
      </div>
    </SheetDialog>
  );
}
