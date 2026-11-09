import "./subscriptions-section.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Receipt } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { subscriptionsCopy as copy } from "./copy/subscriptions-copy";
import { getCategory } from "./category-utils";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { paletteColour } from "./palette-colour";
import { buildSubscriptionsModel, monthPeriod } from "./subscriptions-model";
import { ICON_REGISTRY } from "./ui-options";
import { useIsMobileLayout } from "./use-viewport";
import { useRepeatingCharges } from "./use-repeating-charges";

// Where Summary keeps the card's last height (summary-panel.jsx reads it; a
// string here so this chunk imports nothing from the first screen).
const SUBSCRIPTIONS_HEIGHT_KEY = "monies-map:subs-card-height";

// Subscriptions and bills (design.md "Subscriptions and bills"; DOMAIN.md
// "Repeating Charge"): one list of every charge that comes back each month
// or year, found by fixed rules from the view's entries. A Summary card
// under Money insights, in its own lazy chunk; its data is read only once
// the top summary is usable, and while it loads the card keeps its place.
//
// Every amount is an openable figure (design.md "Openable figures"):
// data-fig="spent" with the exact entry ids the server named, so View
// entries lists those charges and its Spent total is the amount to the cent
// (money-figures.ts, "repeating"). Hidden money shows ••••, and "Went up"
// without its amounts.

function CategoryIcon({ categories, name }) {
  const category = getCategory(categories, { categoryName: name });
  const Icon = (category?.iconKey && ICON_REGISTRY[category.iconKey]) || Receipt;
  const colour = category?.colorHex ? paletteColour(category.colorHex) : undefined;
  return (
    <span className="subs-icon" style={colour ? { "--c": colour } : undefined} aria-hidden="true">
      <Icon size={17} strokeWidth={2.2} />
    </span>
  );
}

// A figure: the amount the server named, opening exactly its entries.
function Figure({ amount, period, name, className = "" }) {
  if (!amount.ids.length) {
    return <span className={className}>{money(amount.amountMinor)}</span>;
  }
  return (
    <span
      className={className}
      data-fig="spent"
      data-fig-ids={amount.ids.join(" ")}
      data-fig-period={period}
      data-fig-name={name}
      data-fig-ask="shop"
      tabIndex={0}
      role="button"
    >
      {money(amount.amountMinor)}
    </span>
  );
}

function amountLabel(series) {
  if (series.status === "late" || series.kind === "varies") {
    return copy.lastOne;
  }
  return series.period === "yearly" ? copy.aYear : copy.aMonth;
}

function WentUp({ series, phone }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const { wentUp } = series;
  if (!areTotalsVisible) {
    return <span className="subs-chip is-up">{copy.wentUpHidden(wentUp.date)}</span>;
  }
  if (phone) {
    return <span className="subs-chip is-up">{copy.wentUpPhone(money(Math.abs(wentUp.toMinor - wentUp.fromMinor)), wentUp.date)}</span>;
  }
  // The old and the new price, each opening its own charge.
  const [before, between, after] = copy.wentUpParts(wentUp.date);
  return (
    <span className="subs-chip is-up">
      {before}
      <Figure amount={{ amountMinor: wentUp.fromMinor, ids: wentUp.fromIds }} period={monthPeriod(wentUp.fromDate)} name={series.name} />
      {between}
      <Figure amount={{ amountMinor: wentUp.toMinor, ids: wentUp.toIds }} period={monthPeriod(wentUp.date)} name={series.name} />
      {after}
    </span>
  );
}

function SeriesRow({ series, categories, yearPeriod, phone }) {
  const isLate = series.status === "late" || series.status === "stopped";
  const chips = (
    <>
      {series.wentUp ? <WentUp series={series} phone={phone} /> : null}
      {isLate && series.lastSeenMonth ? <span className="subs-chip is-stop">{copy.notSeenSince(series.lastSeenMonth)}</span> : null}
      {!phone && series.kind === "varies" && !isLate ? <span className="subs-chip">{copy.changesEachMonth}</span> : null}
    </>
  );
  const meta = isLate ? copy.lateMeta(series) : phone ? copy.metaPhone(series) : copy.meta(series);
  return (
    <li className={`subs-row ${isLate ? "is-stopped" : ""}`} data-series={series.key}>
      <CategoryIcon categories={categories} name={series.category} />
      <div className="subs-row-main">
        <span className="subs-name">{series.name}{phone ? null : chips}</span>
        <span className="subs-meta">{phone && (series.wentUp || isLate) ? chips : meta}</span>
      </div>
      <span className="subs-usual">
        <Figure amount={series.latest} period={monthPeriod(series.latest.date)} name={series.name} />
        <span className="subs-label">{amountLabel(series)}</span>
      </span>
      {phone ? null : (
        <span className="subs-year">
          <Figure amount={series.year} period={yearPeriod} name={series.name} />
          <span className="subs-label">{copy.yearLabel}</span>
        </span>
      )}
    </li>
  );
}

function Fold({ label, hint, rows, categories, yearPeriod, phone }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) {
    return null;
  }
  return (
    <>
      <li className="subs-fold">
        <button type="button" className="subs-fold-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span>{label}</span>
          <span className="subs-fold-hint">{open ? copy.hide : hint}</span>
        </button>
      </li>
      {open ? rows.map((series) => (
        <SeriesRow key={series.key} series={series} categories={categories} yearPeriod={yearPeriod} phone={phone} />
      )) : null}
    </>
  );
}

/**
 * @param {{ view: any, categories: any[], enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, reserveHeight?: number }} props
 */
export function SubscriptionsSection({ view, categories, enabled, fetchRequiredQuery, reserveHeight = 0 }) {
  const queryClient = useQueryClient();
  const phone = useIsMobileLayout();
  const [showAll, setShowAll] = useState(false);
  const { answer } = useRepeatingCharges({ queryClient, viewId: view.id, scope: view.selectedScope, enabled, fetchRequiredQuery });
  const model = useMemo(() => buildSubscriptionsModel(answer), [answer]);
  const cardRef = useRef(null);
  // The height Summary reserves next time on this device (0: nothing shown).
  useLayoutEffect(() => {
    if (!model) {
      return;
    }
    const height = model.isEmpty ? 0 : Math.round(cardRef.current?.getBoundingClientRect().height ?? 0);
    try {
      window.localStorage.setItem(SUBSCRIPTIONS_HEIGHT_KEY, String(height));
    } catch {
      // Blocked storage: the next visit reserves nothing.
    }
  }, [model, phone, showAll]);

  if (!model) {
    // Loading: keep the card's place so nothing under it moves.
    return reserveHeight ? <div className="subs-reserve" aria-hidden="true" style={{ minHeight: reserveHeight }} /> : null;
  }
  if (model.isEmpty) {
    return null;
  }
  const rows = phone && !showAll ? model.phoneRows : model.rows;
  return (
    <section ref={cardRef} className="chart-card subs-card" aria-labelledby="subs-title">
      <div className="subs-head">
        <h3 id="subs-title">{copy.title}</h3>
        <p className="subs-intro">{phone ? copy.introPhone : copy.intro}</p>
      </div>
      <div className="subs-totals">
        <div className="subs-total">
          <span className="subs-total-label">{copy.inMonth(model.focusMonth)}</span>
          <Figure className="subs-total-figure" amount={model.totals.focus} period={model.focusPeriod} name={copy.title} />
        </div>
        <div className="subs-total">
          <span className="subs-total-label">{copy.lastYear}</span>
          <Figure className="subs-total-figure" amount={model.totals.year} period={model.yearPeriod} name={copy.title} />
        </div>
      </div>
      {phone ? null : <p className="subs-sorted">{copy.all(model.rows.length)} · {copy.sorted}</p>}
      <ul className="subs-list" aria-label={copy.title}>
        {rows.map((series) => (
          <SeriesRow key={series.key} series={series} categories={categories} yearPeriod={model.yearPeriod} phone={phone} />
        ))}
        {phone && !showAll && model.rows.length > rows.length ? (
          <li className="subs-fold">
            <button type="button" className="subs-fold-button" onClick={() => setShowAll(true)}>
              <span>{copy.seeAll(model.rows.length)}</span>
            </button>
          </li>
        ) : null}
        {!phone || showAll ? (
          <>
            <Fold label={copy.stopped(model.stopped.length)} hint={copy.show} rows={model.stopped} categories={categories} yearPeriod={model.yearPeriod} phone={phone} />
            <Fold label={copy.mightRepeat(model.mightRepeat.length)} hint={copy.mightRepeatHint} rows={model.mightRepeat} categories={categories} yearPeriod={model.yearPeriod} phone={phone} />
            <Fold label={copy.takenOff(model.takenOff.length)} hint={copy.show} rows={model.takenOff} categories={categories} yearPeriod={model.yearPeriod} phone={phone} />
          </>
        ) : null}
      </ul>
    </section>
  );
}
