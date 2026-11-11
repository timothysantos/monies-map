import "./subscriptions-section.css";
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Receipt } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { subscriptionsCopy as copy } from "./copy/subscriptions-copy";
import { paceCopy } from "./copy/pace-copy";
import { PaceLine, PaceQuietNote } from "./pace-line";
import { paceLineWords } from "./pace-line-model";
import { getCategory } from "./category-utils";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { paletteColour } from "./palette-colour";
import { buildComingUp, buildSubscriptionsModel, buildSubsGlance, monthPeriod } from "./subscriptions-model";
import { ICON_REGISTRY } from "./ui-options";
import { useCompactSummaryCard } from "./use-viewport";
import { useRepeatingCharges } from "./use-repeating-charges";
import { saveRepeatingChoice } from "./repeating-charges-api";

// A rounded total reads "$540", never "$540.00".
const wholeMoney = (minor) => money(minor).replace(/\.00(?=\D*$)/, "");

// The details and choices of one charge load only when a row is opened.
const SubscriptionsChargeDialog = lazy(() => import("./subscriptions-charge-dialog").then((module) => ({ default: module.SubscriptionsChargeDialog })));

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

// A row opens its details and the household's choices (the lazy
// subscriptions-charge-dialog.jsx); a tap on one of its figures opens that
// figure's menu instead (the shell's capture listener takes it first).
function SeriesRow({ series, categories, yearPeriod, phone, onOpen }) {
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
    <li
      className={`subs-row is-openable ${isLate || series.status === "taken_off" ? "is-stopped" : ""}`}
      data-series={series.key}
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest("[data-fig], button"))) {
          onOpen(series);
        }
      }}
    >
      <CategoryIcon categories={categories} name={series.category} />
      <div className="subs-row-main">
        <span className="subs-name">
          <button type="button" className="subs-open" aria-label={copy.openRow(series.name)} onClick={() => onOpen(series)}>{series.name}</button>
          {phone ? null : chips}
        </span>
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

// Coming up: the next 30 days on their usual days, by week, each with its
// last amount (a bill that changes: the lowest and highest of its last 3).
// These are not figures: nothing here has happened yet.
const PHONE_COMING = 5;

function ComingUpList({ comingUp, categories, phone }) {
  const [showAll, setShowAll] = useState(false);
  if (!comingUp.count) {
    return <li className="subs-empty">{copy.nothingComing}</li>;
  }
  let shown = 0;
  const limit = phone && !showAll ? PHONE_COMING : Infinity;
  const blocks = [];
  for (const group of comingUp.groups) {
    const items = group.items.slice(0, Math.max(0, limit - shown));
    shown += items.length;
    if (!items.length) continue;
    blocks.push(<li key={`week-${group.key}`} className="subs-week">{copy.weeks[group.key]}</li>);
    for (const item of items) {
      const varies = item.lowMinor !== item.highMinor;
      blocks.push(
        <li key={`${item.key}:${item.date}`} className="subs-row" data-coming={item.key}>
          <CategoryIcon categories={categories} name={item.series?.category} />
          <div className="subs-row-main">
            <span className="subs-name">{item.series?.name ?? ""}</span>
            <span className="subs-meta">{copy.usuallyAround(item.date)}</span>
          </div>
          <span className="subs-usual">
            <span>{varies ? `${money(item.lowMinor)}–${money(item.highMinor)}` : money(item.lowMinor)}</span>
            <span className="subs-label">{varies ? copy.lastThree : copy.lastOne}</span>
          </span>
        </li>
      );
    }
  }
  if (comingUp.count > shown) {
    blocks.push(
      <li key="more" className="subs-fold">
        <button type="button" className="subs-fold-button" onClick={() => setShowAll(true)}>
          <span>{copy.moreBy(comingUp.count - shown, comingUp.endDate)}</span>
        </button>
      </li>
    );
  }
  return blocks;
}

function Fold({ label, hint, rows, categories, yearPeriod, phone, onOpen }) {
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
        <SeriesRow key={series.key} series={series} categories={categories} yearPeriod={yearPeriod} phone={phone} onOpen={onOpen} />
      )) : null}
    </>
  );
}

// The wide card's glance (shown from a 1,064px page, subscriptions-section.css):
// chips for what went up and the next charge due, and one stacked bar of what
// is paid by kind. With money hidden: no amount and no bar (its shares would
// say how the money splits).
function SubsGlance({ glance, hiddenMoney }) {
  const { priceRises, next, kinds } = glance;
  if (!priceRises && !next && !kinds.length) {
    return null;
  }
  return (
    <div className="subs-glance">
      <div className="subs-glance-chips">
        {priceRises ? <span className="subs-chip is-up">{copy.priceRises(priceRises)}</span> : null}
        {next ? <span className="subs-chip">{copy.nextCharge(next.name, hiddenMoney || next.amountMinor === null ? "" : wholeMoney(next.amountMinor), next.date)}</span> : null}
      </div>
      {hiddenMoney || kinds.length < 2 ? null : (
        <div className="subs-kinds">
          <div className="subs-kinds-bar" role="img" aria-label={copy.kindBarLabel}>
            {kinds.map((kind) => <span key={kind.key} className={`subs-kind is-${kind.key}`} style={{ width: `${kind.share * 100}%` }} />)}
          </div>
          <div className="subs-kinds-legend">
            {kinds.map((kind) => <span key={kind.key}><i className={`subs-kind-dot is-${kind.key}`} aria-hidden="true" />{copy.kindLabel[kind.key]}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{ view: any, categories: any[], enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, runBackgroundRefresh?: (task: () => Promise<any>) => any, reserveHeight?: number, initialTab?: "all" | "coming" }} props
 */
export function SubscriptionsSection({ view, categories, enabled, fetchRequiredQuery, runBackgroundRefresh = undefined, reserveHeight = 0, initialTab = "all" }) {
  const queryClient = useQueryClient();
  // Summary's cards sit a third of a wide page across, so they use the short form everywhere.
  const phone = useCompactSummaryCard();
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState(/** @type {string} */ (initialTab));
  const [openSeries, setOpenSeries] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // The line after a choice: what was done and the state to restore (Undo).
  const [notice, setNotice] = useState(null);
  const { answer, refresh } = useRepeatingCharges({ queryClient, viewId: view.id, scope: view.selectedScope, enabled, fetchRequiredQuery });
  const model = useMemo(() => buildSubscriptionsModel(answer), [answer]);
  const comingUp = useMemo(() => buildComingUp(answer), [answer]);
  const glance = useMemo(() => buildSubsGlance(model, comingUp), [model, comingUp]);
  const hiddenMoney = !useMoneyPrivacy().areTotalsVisible;
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
  }, [model, phone, showAll, tab]);

  // Read the list again after a choice; a failure keeps the saved choice and
  // shows the shell's retryable refresh notice. The price change reminder
  // reads the choices too.
  function refreshAfterSave() {
    const task = () => refresh(undefined);
    if (runBackgroundRefresh) {
      runBackgroundRefresh(task);
    } else {
      task().catch(() => {
        // The kept list stays; the next visit reads it again.
      });
    }
    void queryClient.invalidateQueries({ queryKey: ["reminders"] });
  }

  async function choose(series, action, displayName = undefined) {
    setSaving(true);
    setErrorMessage("");
    const result = await saveRepeatingChoice({ seriesKey: series.key, action, ...(displayName === undefined ? {} : { displayName }) });
    setSaving(false);
    if (!result.ok) {
      setErrorMessage(result.error || copy.saveFailed);
      return;
    }
    setOpenSeries(null);
    setNotice({ action, seriesKey: result.seriesKey, previous: result.previous });
    refreshAfterSave();
  }

  async function undo() {
    if (!notice || notice.action === "restore") {
      return;
    }
    const result = await saveRepeatingChoice({ seriesKey: notice.seriesKey, action: "restore", choice: notice.previous.choice, displayName: notice.previous.displayName });
    setNotice(result.ok ? { action: "restore", seriesKey: notice.seriesKey, previous: result.previous } : { ...notice, failed: true });
    if (result.ok) {
      refreshAfterSave();
    }
  }

  if (!model) {
    // Loading: keep the card's place so nothing under it moves.
    return reserveHeight ? <div className="subs-reserve" aria-hidden="true" style={{ minHeight: reserveHeight }} /> : null;
  }
  if (model.isEmpty) {
    return null;
  }
  // Narrow, 4 rows then Show all; a wide card (subscriptions-section.css)
  // lists the 8 in two columns and hides the button when there are no more.
  const rows = phone && !showAll ? model.glanceRows : model.rows;
  const rowProps = { categories, yearPeriod: model.yearPeriod, phone, onOpen: (series) => { setErrorMessage(""); setOpenSeries(series); } };
  return (
    <section ref={cardRef} className="chart-card subs-card" aria-labelledby="subs-title">
      <div className="subs-head">
        <h3 id="subs-title">{copy.title}</h3>
        <p className="subs-intro">{phone ? copy.introPhone : copy.introChoices}</p>
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
      {glance ? <SubsGlance glance={glance} hiddenMoney={hiddenMoney} /> : null}
      {notice ? (
        <p className="subs-notice" role="status">
          <span>{notice.failed ? copy.saveFailed : copy.done[notice.action]}</span>
          {notice.action !== "restore" ? <button type="button" className="subtle-action" onClick={undo}>{copy.undo}</button> : null}
        </p>
      ) : null}
      <div className="subs-tabs" role="tablist" aria-label={copy.tabsLabel}>
        {[["all", copy.all(model.rows.length)], ["coming", copy.comingUp]].map(([key, label]) => (
          <button key={key} type="button" role="tab" className="subs-tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
        {!phone && tab === "all" ? <span className="subs-sorted">{copy.sorted}</span> : null}
      </div>
      {tab === "coming" ? (
        <>
          {comingUp?.count && !hiddenMoney ? (
            <p className="subs-coming-total" data-pace="coming-up">{paceCopy.comingUpTotal(wholeMoney(comingUp.total.lowMinor), wholeMoney(comingUp.total.highMinor), comingUp.endDate)}</p>
          ) : null}
          <ul className="subs-list" aria-label={copy.comingUp}>
            <ComingUpList comingUp={comingUp} categories={categories} phone={phone} />
          </ul>
        </>
      ) : (
      <ul className={`subs-list ${showAll ? "is-all" : "is-glance"}`} aria-label={copy.title}>
        {rows.map((series) => <SeriesRow key={series.key} series={series} {...rowProps} />)}
        {phone && !showAll && model.rows.length > 4 ? (
          <li className="subs-fold" data-wide-hide={model.rows.length <= rows.length ? "" : undefined}>
            <button type="button" className="subs-fold-button" onClick={() => setShowAll(true)}>
              <span>{copy.seeAll(model.rows.length)}</span>
            </button>
          </li>
        ) : null}
        {!phone || showAll || rows.length >= model.rows.length ? (
          <>
            <Fold label={copy.stopped(model.stopped.length)} hint={copy.show} rows={model.stopped} {...rowProps} />
            <Fold label={copy.mightRepeat(model.mightRepeat.length)} hint={copy.mightRepeatHint} rows={model.mightRepeat} {...rowProps} />
            <Fold label={copy.takenOff(model.takenOff.length)} hint={copy.show} rows={model.takenOff} {...rowProps} />
          </>
        ) : null}
      </ul>
      )}
      {openSeries ? (
        <Suspense fallback={null}>
          <SubscriptionsChargeDialog
            series={openSeries}
            saving={saving}
            errorMessage={errorMessage}
            onChoose={(action, displayName) => choose(openSeries, action, displayName)}
            onClose={() => setOpenSeries(null)}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

/**
 * If this keeps up for today's month, from the same answer as the card (one
 * request for both). Summary draws it into its month-by-month chart (the
 * current month's column carries the low-to-high range, owner decision,
 * 2026-11-10) and puts the sentence directly under the chart, or, when it
 * cannot show, one plain line saying why (PaceQuietNote). `renderChart`
 * draws the chart with the range (or null while there is none), so the chart
 * stays in one place in the tree whether or not the answer has arrived.
 * Month reads the same answer itself (month-panel.jsx), for its insight
 * lines too. `yearMonths` (Summary's months) adds the year-end line from April.
 * @param {{ view: any, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, renderChart: (extension: { month: string, lowMinor: number, highMinor: number } | null) => any, spentSoFarMinor?: number | null, planMinor?: number | null, showLeft?: boolean, yearMonths?: any[] | null, onOpenImports?: () => void }} props
 */
export function PaceChartSection({ view, enabled, fetchRequiredQuery, renderChart, spentSoFarMinor = null, planMinor = null, showLeft = false, yearMonths = null, onOpenImports }) {
  const queryClient = useQueryClient();
  const { areTotalsVisible } = useMoneyPrivacy();
  const { answer } = useRepeatingCharges({ queryClient, viewId: view.id, scope: view.selectedScope, enabled, fetchRequiredQuery });
  const pace = answer?.pace;
  const showRange = Boolean(pace?.range && areTotalsVisible);
  const extension = useMemo(() => {
    if (!showRange) {
      return null;
    }
    const { totals } = paceLineWords({ pace, spentSoFarMinor, planMinor, money });
    return { month: pace.month, lowMinor: totals.shown.lowMinor, highMinor: totals.shown.highMinor };
  }, [showRange, pace, spentSoFarMinor, planMinor]);
  return (
    <>
      {renderChart(extension)}
      {showRange
        ? <PaceLine pace={pace} spentSoFarMinor={spentSoFarMinor} planMinor={planMinor} money={money} hidden={!areTotalsVisible} showLeft={showLeft} showBar={false} yearMonths={yearMonths} />
        : areTotalsVisible && pace?.quiet ? <PaceQuietNote pace={pace} onOpenImports={onOpenImports} /> : null}
    </>
  );
}
