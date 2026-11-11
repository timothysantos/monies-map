import "./summary-changed.css";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { summaryChangedCopy as copy } from "./copy/summary-changed-copy";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { useCompactSummaryCard } from "./use-viewport";
import { queryKeys } from "./query-keys";
import { requestSummaryChanged } from "./summary-changed-api";
import { useSummaryCardQuery } from "./use-summary-card-query";
import { useFirstViewMotion } from "./use-first-view-motion";
import { CardHead, cardTitle } from "./summary-card-head";

// What changed this month (design.md "What changed card"; DOMAIN.md "What
// Changed Card"): the month so far against the same point of the month
// before, the 3 categories that went up most and the 3 that went down most
// (plus a category above its usual that is not among them). Tapping a row
// opens the shops behind the change. A Summary card under Money insights, in
// its own lazy chunk; its data is read only once the top summary is usable.
//
// Every amount is an openable figure (design.md "Openable figures"):
// data-fig="spent" with the exact entry ids the server named, so View
// entries lists those entries and its Spent total is the amount to the cent
// (money-figures.ts, "changed"). With money hidden the card shows names only:
// no amount, no up or down, no "more than usual".

const PHONE_ROWS = 3;

// A figure: the amount the server named, opening exactly its entries. Its
// period is its own month (last month's figure is not this month's).
function Figure({ amountMinor, ids, month, name, ask, arg = undefined }) {
  if (!ids.length) {
    return <span>{money(amountMinor)}</span>;
  }
  return (
    <span data-fig-period={`${month}:${month}`}>
      <span
        data-fig="spent"
        data-fig-ids={ids.join(" ")}
        data-fig-name={name}
        data-fig-arg={arg}
        data-fig-ask={ask}
        tabIndex={0}
        role="button"
      >
        {money(amountMinor)}
      </span>
    </span>
  );
}

function Row({ row, changed, visible, open, onToggle, barShare }) {
  const direction = copy[row.direction];
  const panelId = `chg-shops-${row.category.replace(/[^A-Za-z0-9]+/g, "-")}`;
  return (
    <li
      className={`chg-row ${open ? "is-open" : ""}`}
      data-category={row.category}
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest("[data-fig], button"))) {
          onToggle();
        }
      }}
    >
      <div className="chg-main">
        <button type="button" className="chg-open" aria-expanded={open} aria-controls={panelId} aria-label={copy.openRow(row.category)} onClick={onToggle}>
          {row.category}
        </button>
        {visible && row.moreThanUsual ? <span className="chg-chip">{copy.moreThanUsual}</span> : null}
        {visible ? <span className="chg-diff">{direction} {money(Math.abs(row.diffMinor))}</span> : null}
        <span className="chg-chevron" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </div>
      {visible ? (
        <span className="chg-bar" aria-hidden="true">
          <span className={`chg-bar-fill is-${row.direction}`} style={{ width: `${Math.round(barShare * 50)}%` }} />
        </span>
      ) : null}
      {visible ? (
        <div className="chg-meta">
          <span>
            <Figure amountMinor={row.amountMinor} ids={row.ids} month={changed.month} name={row.category} ask="category" arg={row.category} /> {copy.soFar}
          </span>
          <span>
            <Figure amountMinor={row.baseMinor} ids={row.baseIds} month={changed.baseMonth} name={`${row.category}, ${copy.lastMonth}`} ask="category" arg={row.category} /> {copy.lastMonth}
          </span>
        </div>
      ) : null}
      {open ? (
        <div className="chg-shops" id={panelId}>
          <p className="chg-shops-title">{copy.shopsBehind}</p>
          <ul>
            {row.shops.map((shop) => (
              <li key={shop.name} className="chg-shop">
                <span className="chg-shop-name">{shop.name}</span>
                {visible ? (
                  <span className="chg-shop-figures">
                    <span>{shop.diffMinor > 0 ? copy.up : copy.down} {money(Math.abs(shop.diffMinor))}</span>
                    <span className="chg-shop-sofar">
                      <Figure amountMinor={shop.amountMinor} ids={shop.ids} month={changed.month} name={shop.name} ask="shop" /> {copy.soFar}
                    </span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/**
 * @param {{ view: any, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any> }} props
 */
export function SummaryChangedSection({ view, enabled, fetchRequiredQuery }) {
  const queryClient = useQueryClient();
  // Summary's cards sit a third of a wide page across, so they use the short form everywhere.
  const phone = useCompactSummaryCard();
  const { areTotalsVisible: visible } = useMoneyPrivacy();
  const [openCategory, setOpenCategory] = useState("");
  const [showAll, setShowAll] = useState(false);
  const viewId = view?.id ?? "household";
  const scope = view?.selectedScope;
  const queryKey = useMemo(() => queryKeys.summaryChanged(viewId, scope), [scope, viewId]);
  const fetcher = useCallback((options) => requestSummaryChanged(viewId, scope, options), [scope, viewId]);
  const answer = useSummaryCardQuery({ queryClient, queryKey, enabled, fetchRequiredQuery, fetcher, abortMessage: "What changed request aborted." });
  const changed = answer?.changed ?? null;
  // The bars draw once, when the card first scrolls into view.
  const { ref: motionRef, motion } = useFirstViewMotion({ attribute: "chartMotion", playMs: 1100, threshold: 0.3, ready: Boolean(changed) });
  // Hidden money lists names only, A to Z, so even the order says nothing
  // about which way a category moved.
  const rows = useMemo(() => {
    if (!changed) return [];
    return visible ? changed.rows : [...changed.rows].sort((left, right) => left.category.localeCompare(right.category));
  }, [changed, visible]);
  if (!changed) {
    return null;
  }
  const shown = phone && !showAll ? rows.slice(0, PHONE_ROWS) : rows;
  // Each bar's length is its change against the biggest change on the card.
  const biggest = Math.max(1, ...rows.map((row) => Math.abs(row.diffMinor)));
  return (
    <section ref={motionRef} className="chart-card chg-card" aria-labelledby="chg-title" data-fig-period={`${changed.month}:${changed.month}`} data-chart-motion={motion}>
      <CardHead id="changed" titleId="chg-title" context={{ month: changed.month, baseMonth: changed.baseMonth }} className="is-spaced" />
      {rows.length ? (
        <ul className="chg-list" aria-label={cardTitle("changed")}>
          {shown.map((row) => (
            <Row
              key={row.category}
              row={row}
              changed={changed}
              visible={visible}
              barShare={Math.abs(row.diffMinor) / biggest}
              open={openCategory === row.category}
              onToggle={() => setOpenCategory((current) => (current === row.category ? "" : row.category))}
            />
          ))}
          {phone && !showAll && rows.length > shown.length ? (
            <li className="chg-fold">
              <button type="button" className="chg-fold-button" onClick={() => setShowAll(true)}>
                <span>{copy.showAll(rows.length)}</span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="chg-quiet">{copy.quiet}</p>
      )}
    </section>
  );
}
