// The trip view's lead and the Trips & events sheet (design.md "Trips and
// events on Entries"; DOMAIN.md "Trip or Event"). Part of the lazy
// entries-trip-events chunk (re-exported there), so neither the first
// screen nor the Entries route carries it.
//
// Every figure here is openable (design.md "Openable figures"):
// data-fig="trip" with the trip's id; its menu opens the trip view narrowed
// to the figure (figure-menu-model.js), whose Spent lead is that figure to
// the cent (tests/openable-figures.test.mjs).
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { tripEventsCopy as copy, formatTripDates } from "./copy/trip-events-copy";
import { TripEventGlyph } from "./trip-event-glyph";
import { buildTripEventLeadModel } from "./trip-event-lead-model";
import { getEntryDerivedData } from "./entry-filtering";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney } from "./money-privacy";
import { BottomActions } from "./ui-components";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { fetchQueryWithLease } from "./query-leases";
import { isWithinTripEventDates } from "../domain/trip-events";
import { todayInAppTimeZone } from "./app-dates";
import { formatForeignMoney } from "./trip-event-review-sheet";

const money = (minor) => moniesClient.format.money(minor);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}`;
}

function longDates(trip) {
  if (!trip?.startDate) return "";
  const start = new Date(`${trip.startDate}T00:00:00Z`);
  const end = new Date(`${(trip.endDate ?? trip.startDate)}T00:00:00Z`);
  const year = end.getUTCFullYear();
  if (trip.startDate === (trip.endDate ?? trip.startDate)) {
    return `${WEEKDAYS[start.getUTCDay()]} ${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} ${year}`;
  }
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === year;
  return `${WEEKDAYS[start.getUTCDay()]} ${start.getUTCDate()}${sameMonth ? "" : ` ${MONTHS[start.getUTCMonth()]}`} – ${WEEKDAYS[end.getUTCDay()]} ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${year}`;
}

function figureProps(trip, extra = {}) {
  return {
    "data-fig": "trip",
    "data-fig-arg": trip.id,
    "data-fig-name": trip.name,
    "data-fig-trip-name": trip.name,
    role: "button",
    tabIndex: 0,
    ...extra
  };
}

function Bars({ title, rows, maxMinor, showTitle = true }) {
  return (
    <section className="trip-lead-bars" aria-label={title}>
      {showTitle ? <h4>{title}</h4> : null}
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <span className="trip-lead-bar-label">{row.label}</span>
            <span className="trip-lead-bar-track" aria-hidden="true">
              <span className="trip-lead-bar-fill" style={{ width: `${maxMinor > 0 ? Math.max(2, Math.round((Math.max(0, row.amountMinor) / maxMinor) * 100)) : 0}%` }} />
            </span>
            <span className="trip-lead-bar-amount" {...row.fig}><PrivateMoney>{money(row.amountMinor)}</PrivateMoney></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The trip view's lead, in place of the Entries totals.
 * `onChange` opens the New sheet on this trip; `onCheckDates` its review
 * list ("Check entries from these dates"), offered when it has dates or a
 * linked split group.
 * `onOpen` opens the trip's own page (DOMAIN.md "Trip page").
 * @param {{ tripView: any, aggregateEntries: any[], pageEntries: any[], entryFilters: any, viewId: string, people: any[], investmentAccountIds?: Set<string>, entryCount: number, isMobile?: boolean, onClear: () => void, onPutAway: (trip: any, putAway: boolean) => void, onDelete: (trip: any) => void, onChange?: (trip: any) => void, onCheckDates?: (trip: any) => void, onOpen?: (trip: any) => void }} props
 */
export function TripEventLead({ tripView, aggregateEntries, pageEntries, entryFilters, viewId, people, investmentAccountIds, entryCount, isMobile = false, onClear, onPutAway, onDelete, onChange = undefined, onCheckDates = undefined, onOpen = undefined }) {
  const trip = tripView?.tripEvent ?? null;
  const model = useMemo(
    () => (trip ? buildTripEventLeadModel({ tripEvent: trip, aggregateEntries, pageEntries, entryFilters, viewId, people, investmentAccountIds }) : null),
    [aggregateEntries, entryFilters, investmentAccountIds, pageEntries, people, trip, viewId]
  );
  const [open, setOpen] = useState({ where: false, days: false });
  if (!trip || !model) {
    return (
      <section className="trip-lead" data-trip-lead="missing">
        <p className="trip-lead-meta">{copy.missing}</p>
        <button type="button" className="subtle-action" onClick={onClear}>{copy.clear}</button>
      </section>
    );
  }
  const maxCategory = Math.max(0, ...model.byCategory.map((row) => row.amountMinor));
  const maxDay = Math.max(0, ...model.byDay.map((row) => row.amountMinor));
  const categoryRows = model.byCategory.map((row) => ({
    key: row.categoryName,
    label: row.categoryName,
    amountMinor: row.amountMinor,
    fig: figureProps(trip, { "data-fig-trip-category": row.categoryName, "data-fig-name": `${trip.name} · ${row.categoryName}` })
  }));
  const dayRows = model.byDay.map((row) => ({
    key: row.key,
    label: row.key === "before" ? copy.before : dayLabel(row.key),
    amountMinor: row.amountMinor,
    fig: figureProps(trip, { "data-fig-ids": row.entryIds.join(" "), "data-fig-name": `${trip.name} · ${row.key === "before" ? copy.beforeYouWent : dayLabel(row.key)}` })
  }));
  const beforeIds = model.byDay.find((row) => row.key === "before")?.entryIds ?? [];
  const awayIds = model.byDay.filter((row) => row.key !== "before").flatMap((row) => row.entryIds);
  const meta = [longDates(trip), model.days ? copy.days(model.days) : "", copy.entries(entryCount)].filter(Boolean).join(" · ");
  const pills = [
    ...model.personPills.map((pill) => ({
      key: pill.personId,
      label: pill.name,
      amountMinor: pill.amountMinor,
      aside: pill.percent !== null ? `${pill.percent}%` : "",
      fig: figureProps(trip, { "data-fig-trip-view": pill.personId, "data-fig-name": `${trip.name} · ${pill.name}` })
    })),
    ...(model.whileAwayMinor !== null ? [{
      key: "away",
      label: copy.whileAway,
      amountMinor: model.whileAwayMinor,
      aside: model.perDayMinor !== null ? copy.perDay(money(model.perDayMinor)) : "",
      fig: figureProps(trip, { "data-fig-ids": awayIds.join(" "), "data-fig-name": `${trip.name} · ${copy.whileAway}` })
    }] : []),
    ...(model.beforeMinor ? [{
      key: "before",
      label: copy.beforeYouWent,
      amountMinor: model.beforeMinor,
      aside: "",
      fig: figureProps(trip, { "data-fig-ids": beforeIds.join(" "), "data-fig-name": `${trip.name} · ${copy.beforeYouWent}` })
    }] : [])
  ];
  return (
    <section className="trip-lead" data-trip-lead={trip.id} aria-label={trip.name}>
      <div className="trip-lead-head">
        <span className="trip-lead-icon" aria-hidden="true"><TripEventGlyph iconKey={trip.iconKey} size={18} /></span>
        <div className="trip-lead-title">
          <h3>{trip.name}</h3>
          {meta ? <p className="trip-lead-meta">{meta}</p> : null}
        </div>
        <button type="button" className="subtle-action trip-lead-clear" onClick={onClear}>{copy.clear}</button>
      </div>
      <p className="trip-lead-eyebrow">{copy.spent}</p>
      <p className="trip-lead-spent">
        <span {...figureProps(trip, { "data-fig-trip-list": "", ...(trip.splitGroupId ? { "data-fig-trip-group": trip.splitGroupId } : {}) })} data-trip-spent="">
          <PrivateMoney>{money(model.spentMinor)}</PrivateMoney>
        </span>
      </p>
      {(trip.splitCash ?? []).map((cash) => (
        // The linked split group's cash in its own currency: not entries, so
        // not in Spent (DOMAIN.md "Trip or Event").
        <p key={cash.currency} className="trip-lead-meta trip-lead-cash" data-trip-split-cash={cash.currency}>
          {copy.splitCash(trip.splitGroupName ?? trip.name).before}
          <span {...figureProps(trip, { "data-fig-trip-list": "", "data-fig-trip-group": trip.splitGroupId, "data-fig-name": `${trip.name} · ${copy.groupSplits(trip.splitGroupName ?? trip.name)}` })}>
            <PrivateMoney>{formatForeignMoney(cash.amountMinor, cash.currency)}</PrivateMoney>
          </span>
          {copy.splitCash(trip.splitGroupName ?? trip.name).after}
        </p>
      ))}
      {pills.length ? (
        <ul className="trip-lead-pills">
          {pills.map((pill) => (
            <li key={pill.key} className="trip-lead-pill" data-trip-pill={pill.key}>
              <span className="trip-lead-pill-label">{pill.label}</span>
              <span className="trip-lead-pill-amount" {...pill.fig}><PrivateMoney>{money(pill.amountMinor)}</PrivateMoney></span>
              {pill.aside ? <span className="trip-lead-pill-aside">{pill.aside}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {isMobile ? (
        <div className="trip-lead-folds">
          <button type="button" className="trip-lead-fold" aria-expanded={open.where} onClick={() => setOpen((current) => ({ ...current, where: !current.where }))}>
            <span>{copy.whereItWent}</span>
            <span className="trip-lead-fold-hint">{copy.categories(categoryRows.length)} <ChevronDown size={14} aria-hidden="true" /></span>
          </button>
          {open.where ? <Bars title={copy.whereItWent} rows={categoryRows} maxMinor={maxCategory} showTitle={false} /> : null}
          <button type="button" className="trip-lead-fold" aria-expanded={open.days} onClick={() => setOpen((current) => ({ ...current, days: !current.days }))}>
            <span>{copy.dayByDay}</span>
            <span className="trip-lead-fold-hint">{copy.days(dayRows.filter((row) => row.key !== "before").length)} <ChevronDown size={14} aria-hidden="true" /></span>
          </button>
          {open.days ? <Bars title={copy.dayByDay} rows={dayRows} maxMinor={maxDay} showTitle={false} /> : null}
        </div>
      ) : (
        <div className="trip-lead-columns">
          {categoryRows.length ? <Bars title={copy.whereItWent} rows={categoryRows} maxMinor={maxCategory} /> : null}
          {dayRows.length ? <Bars title={copy.dayByDay} rows={dayRows} maxMinor={maxDay} /> : null}
        </div>
      )}
      <div className="trip-lead-actions">
        {onOpen ? <button type="button" className="subtle-action" data-trip-open="" onClick={() => onOpen(trip)}>{copy.openTrip(trip.name)}</button> : null}
        {onCheckDates && (trip.startDate || trip.splitGroupId) ? (
          <button type="button" className="subtle-action" data-trip-check-dates="" onClick={() => onCheckDates(trip)}>{copy.checkDates}</button>
        ) : null}
        {onChange ? <button type="button" className="subtle-action" data-trip-change="" onClick={() => onChange(trip)}>{copy.change}</button> : null}
        <button type="button" className="subtle-action" onClick={() => onPutAway(trip, !trip.putAway)}>{trip.putAway ? copy.bringBack : copy.putAway}</button>
        <button type="button" className="subtle-action is-danger" onClick={() => onDelete(trip)}>{copy.delete}</button>
      </div>
    </section>
  );
}

// Every trip's entries in the page's view (one request, only when the sheet
// opens), so each Spent is the trip view's own lead to the cent.
function useTripTotals({ open, viewId, month, selectedScope }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ ready: false, page: null, error: "" });
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams({ view: viewId, month, trip: "all" });
    setState((current) => ({ ...current, error: "" }));
    fetchQueryWithLease(queryClient, {
      queryKey: ["trip-events-totals", viewId, month],
      bypassCache: true,
      signal: controller.signal,
      abortMessage: "Trips and events request aborted.",
      fetcher: async ({ signal }) => {
        const response = await fetch(`/api/entries-page?${params.toString()}`, { cache: "no-store", signal });
        if (!response.ok) throw new Error(copy.loadFailed);
        return response.json();
      }
    }).then((page) => setState({ ready: true, page, error: "" }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ ready: true, page: null, error: copy.loadFailed });
      });
    return () => controller.abort();
  }, [month, open, queryClient, viewId]);
  return useMemo(() => {
    const tripEvents = state.page?.tripView?.tripEvents ?? [];
    const entries = state.page?.monthPage?.entries ?? [];
    const spent = new Map();
    for (const trip of tripEvents) {
      const tripEntries = entries.filter((entry) => entry.tripEventId === trip.id);
      const derived = getEntryDerivedData({ entries: tripEntries, entryFilters: {}, selectedScope, viewId: state.page?.viewId ?? viewId, pinnedEntryIds: [] });
      spent.set(trip.id, { amountMinor: derived.entryTotals.spendMinor, count: derived.filteredEntries.length });
    }
    return { ...state, tripEvents, spent };
  }, [selectedScope, state, viewId]);
}

/**
 * Trips & events: every one, newest first, each with its Spent; choosing
 * one opens its trip view. Put-away ones fold under "N put away · Show".
 * `onOpen` adds each row's arrow to the trip's own page (DOMAIN.md "Trip
 * page"), the way Spending mix's rows carry an arrow beside their tap.
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, viewId: string, month: string, selectedScope: string, currentTripEventId?: string, onChoose: (trip: any) => void, onOpen?: (trip: any) => void, footer?: any, emptyActions?: any }} props
 */
export function TripEventsSheet({ open, onOpenChange, viewId, month, selectedScope, currentTripEventId = "", onChoose, onOpen = undefined, footer = null, emptyActions = null }) {
  const totals = useTripTotals({ open, viewId, month, selectedScope });
  const [showPutAway, setShowPutAway] = useState(false);
  const today = todayInAppTimeZone();
  const shown = totals.tripEvents.filter((trip) => !trip.putAway);
  const putAway = totals.tripEvents.filter((trip) => trip.putAway);
  const close = () => onOpenChange(false);
  const row = (trip) => {
    const spent = totals.spent.get(trip.id);
    const isNow = isWithinTripEventDates(trip, today);
    return (
      <li key={trip.id} className={onOpen ? "trip-sheet-item has-open" : "trip-sheet-item"}>
        <button
          type="button"
          className={`trip-sheet-row ${trip.id === currentTripEventId ? "is-selected" : ""}`}
          data-trip-sheet-row={trip.name}
          onClick={() => {
            onChoose(trip);
            close();
          }}
        >
          <span className="category-pick-row-icon trip-pick-icon" aria-hidden="true"><TripEventGlyph iconKey={trip.iconKey} size={15} /></span>
          <span className="trip-pick-text">
            <span className="trip-sheet-name">
              {trip.name}
              {isNow ? <span className="category-pick-tag">{copy.nowTag}</span> : null}
            </span>
            <span className="trip-pick-meta">{formatTripDates(trip, { year: true }) || copy.noDates}</span>
          </span>
          <span className="trip-sheet-figures">
            <span className="trip-sheet-spent" {...figureProps(trip)}><PrivateMoney>{money(spent?.amountMinor ?? 0)}</PrivateMoney></span>
            <span className="trip-pick-meta">{copy.entries(trip.entryCount)}</span>
          </span>
        </button>
        {onOpen ? (
          <button
            type="button"
            className="trip-sheet-open"
            data-trip-sheet-open={trip.name}
            aria-label={copy.openTrip(trip.name)}
            title={copy.openTrip(trip.name)}
            onClick={() => {
              close();
              onOpen(trip);
            }}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ) : null}
      </li>
    );
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {open ? (
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content mobile-select-dialog is-picker-sheet trip-sheet" aria-describedby={undefined}>
            <SheetSwipeDismiss onClose={close} />
            <div className="note-dialog-head mobile-select-head">
              <Dialog.Title>{copy.listTitle}</Dialog.Title>
              <button type="button" className="icon-action subtle-cancel mobile-select-close" aria-label={copy.close} onClick={close}>
                <X size={16} />
              </button>
            </div>
            <div className="mobile-select-options trip-sheet-body" data-sheet-body aria-busy={!totals.ready}>
              {totals.error ? <p className="category-pick-error" role="alert">{totals.error}</p> : null}
              {totals.ready && !totals.error && !totals.tripEvents.length ? (
                <div className="trip-sheet-empty" data-trip-sheet-empty="">
                  <h4>{copy.emptyTitle}</h4>
                  <p>{copy.emptyBody}</p>
                  {emptyActions}
                </div>
              ) : null}
              {shown.length ? <ul className="trip-sheet-list">{shown.map(row)}</ul> : null}
              {putAway.length ? (
                <>
                  <button type="button" className="subtle-action trip-sheet-putaway" aria-expanded={showPutAway} onClick={() => setShowPutAway((current) => !current)}>
                    {copy.putAwayCount(putAway.length, showPutAway)}
                  </button>
                  {showPutAway ? <ul className="trip-sheet-list is-put-away">{putAway.map(row)}</ul> : null}
                </>
              ) : null}
            </div>
            <BottomActions
              className="is-sheet-bar"
              secondary={footer}
              primary={<button type="button" className="lsd-primary" onClick={close}>{copy.done}</button>}
            />
          </Dialog.Content>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}
