import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import "./trip-page.css";
import { tripPageCopy as copy } from "./copy/en-SG-trip";
import { formatTripDates } from "./copy/trip-events-copy";
import { money } from "./formatters";
import { moneyToneClass } from "./money-tone-class";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { getPersonColourVars } from "./person-colour";
import { SpendingMixSection } from "./spending-mix-section";
import { TripEventGlyph } from "./trip-event-glyph";
import { formatForeignMoney } from "./trip-event-review-sheet";
import { readTripPageId } from "./trip-figure-search";
import { createTripPageOwner } from "./trip-page-owner";
import { EmptyState, ErrorPanel } from "./ui-states";
import { useRouteWorkReport } from "./use-route-work-status";
import { entryAmountTone } from "../domain/money-tone";

// A trip or event's own page (DOMAIN.md "Trip page"; design.md "Trip page";
// docs/flows/entries-flow.md "Trip page"): what it cost the household, on
// Summary's cards. The header (name, dates, Spent), Day by day (a tap opens
// the day's entries in place), Where it went (Summary's Spending mix, the
// same card), Who paid, Still owed (only when it is on Splits) and Biggest
// spending. Read-only: one read when the page opens (trip-page-owner.js)
// and one per day opened.
//
// The household's money, whole amounts (data-fig-view="household"): every
// figure is a trip figure (figure-menu-model.js) whose View entries opens
// the trip view on Entries narrowed to it, and Entries' Spent lead there is
// the figure to the cent (tests/openable-figures.test.mjs). Hidden money
// hides every amount and its tone (PrivateMoney, money()).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Sat 14 Mar".
function dayLabel(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

// A trip figure's attributes (figure-menu.js reads them).
function tripFigure(trip, extra = {}) {
  return {
    "data-fig": "trip",
    "data-fig-arg": trip.id,
    "data-fig-name": trip.name,
    "data-fig-trip-name": trip.name,
    ...extra
  };
}

// The same, on a text figure: quietly openable, never a button look.
const textFigure = (trip, extra = {}) => ({ ...tripFigure(trip, extra), role: "button", tabIndex: 0 });

const barWidth = (amountMinor, maxMinor) => `${maxMinor > 0 ? Math.max(2, Math.round((Math.max(0, amountMinor) / maxMinor) * 100)) : 0}%`;

function TripEntryRow({ trip, entry, hidden }) {
  const signed = entry.entryType === "income" ? entry.amountMinor : -entry.amountMinor;
  const meta = [
    dayLabel(entry.date),
    entry.categoryName,
    entry.payerName,
    entry.estimate && !hidden ? formatForeignMoney(entry.estimate.amountMinor, entry.estimate.currency) : ""
  ].filter(Boolean).join(" · ");
  return (
    <li className="trip-entry" data-trip-entry={entry.id}>
      <span className="trip-entry-text">
        <span className="trip-entry-name">{entry.name}</span>
        <span className="trip-entry-meta">{meta}</span>
      </span>
      {entry.estimate ? <span className="trip-estimate">{copy.estimate}</span> : null}
      <span
        className={`trip-entry-amount ${moneyToneClass(entryAmountTone(entry.entryType, signed))}`}
        {...textFigure(trip, { "data-fig-ids": entry.id, "data-fig-name": `${trip.name} · ${entry.name}` })}
      >
        <PrivateMoney>{money(signed)}</PrivateMoney>
      </span>
    </li>
  );
}

function CardHead({ title, subtitle, action = null }) {
  return (
    <div className="summary-card-head is-spaced">
      <div className="summary-card-heading">
        <h3 className="summary-card-title">{title}</h3>
        {subtitle ? <p className="summary-card-sub">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function TripLead({ page, hidden, onOpenEntries }) {
  const trip = page.tripEvent;
  const dates = formatTripDates(trip.startDate ? trip : { startDate: page.firstDate, endDate: page.lastDate }, { year: true });
  const meta = [dates, copy.entries(page.entryCount)].filter(Boolean).join(" · ");
  return (
    <section className="chart-card trip-page-lead" aria-labelledby="trip-page-title">
      <div className="trip-page-head">
        <span className="trip-page-icon" aria-hidden="true"><TripEventGlyph iconKey={trip.iconKey} size={20} /></span>
        <div className="trip-page-title">
          <h2 id="trip-page-title">{trip.name}</h2>
          <p className="trip-page-meta">{meta}</p>
        </div>
        <button type="button" className="subtle-action trip-page-open" onClick={onOpenEntries}>{copy.openInEntries}</button>
      </div>
      <p className="trip-page-eyebrow">{copy.spent}</p>
      <p className="trip-page-spent">
        <span data-trip-spent="" {...textFigure(trip, trip.splitGroupId ? { "data-fig-trip-group": trip.splitGroupId } : {})}>
          <PrivateMoney>{money(page.spentMinor)}</PrivateMoney>
        </span>
      </p>
      {page.estimateCount ? (
        <p className="trip-page-note" data-trip-estimates="">
          <span className="trip-estimate">{copy.estimate}</span> {copy.estimates(page.estimateCount)}
        </p>
      ) : null}
      {!page.entryCount ? <p className="trip-page-note">{copy.nothingYet}</p> : null}
    </section>
  );
}

function DayByDay({ page, days, onToggleDay, open, hidden }) {
  const trip = page.tripEvent;
  const maxMinor = Math.max(0, ...page.days.map((row) => row.amountMinor));
  return (
    <section className="chart-card trip-page-days" aria-label={copy.dayByDay}>
      <CardHead title={copy.dayByDay} subtitle={copy.dayByDaySub} />
      <ul className="trip-day-list">
        {page.days.map((row) => {
          const label = dayLabel(row.day);
          const isOpen = open.has(row.day);
          const day = days[row.day];
          return (
            <li key={row.day} className={`trip-day ${isOpen ? "is-open" : ""}`} data-trip-day={row.day}>
              <div className="trip-row">
                <button type="button" className="trip-row-main" aria-expanded={isOpen} onClick={() => onToggleDay(row.day)}>
                  <span className="trip-row-label">{label}</span>
                  <span className="trip-row-track" aria-hidden="true">
                    <span className="trip-row-fill" style={{ width: barWidth(row.amountMinor, maxMinor) }} />
                  </span>
                  <span className="trip-row-amount"><PrivateMoney>{money(row.amountMinor)}</PrivateMoney></span>
                  {isOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="summary-mix-arrow"
                  aria-label={copy.viewDay(label)}
                  title={copy.viewDay(label)}
                  {...tripFigure(trip, { "data-fig-ids": row.entryIds.join(" "), "data-fig-name": `${trip.name} · ${label}` })}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              {isOpen ? (
                <div className="trip-day-entries" aria-busy={day?.status === "loading"}>
                  {!day || day.status === "loading" ? <p className="trip-page-quiet">{copy.dayLoading}</p> : null}
                  {day?.status === "failed" ? <p className="trip-page-quiet" role="alert">{copy.dayFailed}</p> : null}
                  {day?.status === "ready" ? (
                    <ul className="trip-entry-list">
                      {day.entries.map((entry) => <TripEntryRow key={entry.id} trip={trip} entry={entry} hidden={hidden} />)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WhoPaid({ page }) {
  const trip = page.tripEvent;
  const total = page.payers.reduce((sum, row) => sum + Math.max(0, row.amountMinor), 0);
  return (
    <section className="chart-card trip-page-payers" aria-label={copy.whoPaid}>
      <CardHead title={copy.whoPaid} subtitle={copy.whoPaidSub} />
      <ul className="trip-payer-list">
        {page.payers.map((row) => {
          const name = row.name || copy.shared;
          const share = total > 0 ? Math.round((Math.max(0, row.amountMinor) / total) * 100) : 0;
          return (
            <li key={row.personId || "shared"} className="trip-payer" data-trip-payer={name} style={getPersonColourVars(row.name || "shared")}>
              <span className="cr-owner trip-payer-name">{name}</span>
              <span className="trip-row-track trip-payer-track" aria-hidden="true">
                <span className="trip-row-fill trip-payer-fill" style={{ width: `${share}%` }} />
              </span>
              <span className="trip-payer-amount" {...textFigure(trip, { "data-fig-ids": row.entryIds.join(" "), "data-fig-name": `${trip.name} · ${name}` })}>
                <PrivateMoney>{money(row.amountMinor)}</PrivateMoney>
              </span>
              <span className="trip-payer-share">{share}%</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StillOwed({ page, onOpenSplits }) {
  const trip = page.tripEvent;
  const owed = page.owed;
  const group = owed.splitGroupId || trip.splitGroupId || "";
  const figure = { "data-fig-trip-list": "", ...(group ? { "data-fig-trip-group": group } : {}) };
  return (
    <section className="chart-card trip-page-owed" aria-label={copy.stillOwed}>
      <CardHead
        title={copy.stillOwed}
        subtitle={copy.stillOwedSub}
        action={<button type="button" className="subtle-action" onClick={() => onOpenSplits(group)}>{copy.openSplits}</button>}
      />
      {owed.debts.length ? (
        <ul className="trip-owed-list">
          {owed.debts.map((debt) => (
            <li key={`${debt.fromName}-${debt.toName}`} className="trip-owed" data-trip-owed="">
              <span className="trip-owed-who">{copy.owes(debt.fromName, debt.toName)}</span>
              <span className="trip-owed-amount" {...textFigure(trip, { ...figure, "data-fig-name": `${trip.name} · ${copy.owes(debt.fromName, debt.toName)}` })}>
                <PrivateMoney>{money(debt.amountMinor)}</PrivateMoney>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="trip-page-quiet" data-trip-owed="none">{copy.nobodyOwes}</p>
      )}
    </section>
  );
}

function Biggest({ page, hidden }) {
  return (
    <section className="chart-card trip-page-biggest" aria-label={copy.biggest}>
      <CardHead title={copy.biggest} subtitle={copy.biggestSub(page.biggest.length)} />
      <ul className="trip-entry-list">
        {page.biggest.map((entry) => <TripEntryRow key={entry.id} trip={page.tripEvent} entry={entry} hidden={hidden} />)}
      </ul>
    </section>
  );
}

/**
 * @param {{ fetchRequiredQuery: (options: any) => Promise<any>, categories?: any[], onCategoryAppearanceChange?: any }} props
 */
export function TripPanel({ fetchRequiredQuery, categories = [], onCategoryAppearanceChange = undefined }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { areTotalsVisible } = useMoneyPrivacy();
  const hidden = !areTotalsVisible;
  const tripId = readTripPageId(location.pathname);
  const [owner] = useState(() => createTripPageOwner({ fetchRequiredQuery }));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [open, setOpen] = useState(() => new Set());
  useRouteWorkReport({ ready: state.status === "ready", busy: state.status === "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setOpen(new Set());
    void owner.load({ tripId, signal: controller.signal });
    return () => controller.abort();
  }, [owner, tripId]);

  const page = state.tripId === tripId ? state.page : null;
  const trip = page?.tripEvent ?? null;
  // Where it went: Summary's Spending mix over the trip's categories.
  const donutData = useMemo(() => (page?.categories ?? [])
    .filter((row) => row.amountMinor > 0)
    .map((row) => ({ key: row.categoryName, label: row.categoryName, categoryId: row.categoryId, valueMinor: row.amountMinor, entryCount: row.entryCount })), [page]);
  const categoryFigure = useMemo(() => (trip
    ? (item) => tripFigure(trip, { "data-fig-trip-category": item.label, "data-fig-name": `${trip.name} · ${item.label}` })
    : undefined), [trip]);

  const keep = (params) => {
    const current = new URLSearchParams(location.search);
    for (const key of ["month"]) {
      const value = current.get(key);
      if (value) params.set(key, value);
    }
    return params;
  };
  const openEntries = () => {
    const params = keep(new URLSearchParams({ view: "household", scope: "direct_plus_shared", entries_scope: "direct_plus_shared", entry_trip: tripId }));
    navigate({ pathname: "/entries", search: `?${params.toString()}` });
  };
  const openSplits = (group) => {
    const params = keep(new URLSearchParams({ view: "household" }));
    if (group) params.set("split_group", group);
    navigate({ pathname: "/splits", search: `?${params.toString()}`, hash: "#splits-activity" });
  };
  const toggleDay = (day) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
    if (!open.has(day) || state.days[day]?.status === "failed") void owner.loadDay(day);
  };

  if (!page && state.status === "ready" && state.failed) {
    return (
      <ErrorPanel
        title={copy.loadFailed}
        detail={copy.loadFailedDetail}
        actions={[{ label: copy.tryAgain, primary: true, onClick: () => void owner.load({ tripId }) }]}
      />
    );
  }
  if (!page && state.status === "ready") {
    return (
      <EmptyState
        title={copy.missing}
        className="trip-page-missing"
        action={{ label: copy.backToEntries, onClick: () => navigate({ pathname: "/entries", search: location.search }) }}
      >
        {copy.missingDetail}
      </EmptyState>
    );
  }
  if (!page) {
    return <section className="chart-card trip-page-lead is-loading" aria-busy="true"><p className="trip-page-quiet">{copy.loading}</p></section>;
  }

  const hasOwed = Boolean(page.owed);
  return (
    <div className="trip-page" data-trip-page={trip.id} data-fig-view="household">
      <div className="summary-grid trip-page-grid">
        <div className="summary-card-slot" style={{ "--s12": 12, "--s2": 2 }}>
          <TripLead page={page} hidden={hidden} onOpenEntries={openEntries} />
        </div>
        {page.entryCount ? (
          <>
            <div className="summary-card-slot" data-trip-card="mix" style={{ "--s12": 6, "--s2": 2 }}>
              <SpendingMixSection
                className="trip-page-mix"
                donutData={donutData}
                categories={categories}
                onCategoryAppearanceChange={onCategoryAppearanceChange}
                period=""
                dashboard
                title={copy.whereItWent}
                subtitle={copy.whereItWentSub}
                figureAttrs={categoryFigure}
              />
            </div>
            <div className="summary-card-slot" data-trip-card="days" style={{ "--s12": 6, "--s2": 2 }}>
              <DayByDay page={page} days={state.days} open={open} onToggleDay={toggleDay} hidden={hidden} />
            </div>
            <div className="summary-card-slot" data-trip-card="payers" style={{ "--s12": hasOwed ? 4 : 6, "--s2": hasOwed ? 1 : 2 }}>
              <WhoPaid page={page} />
            </div>
            {hasOwed ? (
              <div className="summary-card-slot" data-trip-card="owed" style={{ "--s12": 4, "--s2": 1 }}>
                <StillOwed page={page} onOpenSplits={openSplits} />
              </div>
            ) : null}
            <div className="summary-card-slot" data-trip-card="biggest" style={{ "--s12": hasOwed ? 4 : 6, "--s2": 2 }}>
              <Biggest page={page} hidden={hidden} />
            </div>
          </>
        ) : hasOwed ? (
          <div className="summary-card-slot" data-trip-card="owed" style={{ "--s12": 12, "--s2": 2 }}>
            <StillOwed page={page} onOpenSplits={openSplits} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
