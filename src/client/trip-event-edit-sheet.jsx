// The New sheet for a trip or event, also used to change one (design 2d,
// "Everything from these dates"; DOMAIN.md "Trip or Event"). Part of the
// lazy entries-trip-events chunk.
//
// Only the name is needed (progressive disclosure); the icon is guessed from
// it until the person picks one. Dates, the currency it was paid in and a
// linked split group are optional and only help: with them, the sheet
// previews how many entries look like part of it ("37 entries look like part
// of it…") and offers "Check them" (save, then the review list) or "Make it
// empty". Smart defaults: from picked rows, their first and last day and
// their foreign currency; from a split group, its name, icon and currency,
// linked.
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { tripEventsCopy as copy } from "./copy/trip-events-copy";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { BottomActions } from "./ui-components";
import { TripEventGlyph } from "./trip-event-glyph";
import {
  forgetTripEvents,
  loadTripEventDefaults,
  loadTripEventsWithSplitGroups,
  loadTripSuggestions,
  saveTripEvent,
  setTripEventEntries
} from "./trip-events-api";
import { useKeyboardInset } from "./use-keyboard-inset";
import { useRouteWorkBusy } from "./use-route-work-status";
import { TRIP_EVENT_ICONS, guessTripEventIcon } from "../domain/trip-events";
import { HOME_CURRENCY, TRIP_CURRENCIES, tripCurrencyWord } from "../domain/trip-event-suggestions";

const ICON_NAMES = { plane: "Plane", cake: "Cake", house: "House", heart: "Heart", gift: "Gift", car: "Car", star: "Star" };

/**
 * The preview line's counts from a suggestions read, leaving out the rows
 * the sheet puts on anyway (the picked ones).
 * @param {any} suggestions
 * @param {Set<string>} pickedIds
 */
export function summarizeTripPreview(suggestions, pickedIds = new Set()) {
  const count = (key, ticked) => (suggestions?.groups ?? [])
    .filter((group) => group.key === key)
    .flatMap((group) => group.entries)
    .filter((entry) => !pickedIds.has(entry.id) && (ticked === undefined || entry.ticked === ticked)).length;
  const inCurrency = count("currency", true);
  const onSplits = count("splits", true);
  const others = count("currency", false) + count("splits", false) + count("dollars");
  return { ticked: inCurrency + onSplits, inCurrency, onSplits, others };
}

/**
 * @param {{
 *   open: boolean, onOpenChange: (open: boolean) => void,
 *   tripEvent?: any, entries?: Array<{ id: string, date?: string }>, startGroupId?: string,
 *   onSaved: (result: { tripEvent: any, check: boolean, setResult?: any, created: boolean }) => void
 * }} props
 */
export function TripEventEditSheet({ open, onOpenChange, tripEvent = null, entries = [], startGroupId = "", onSaved }) {
  useRouteWorkBusy(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {open ? (
        <EditSheetContent
          tripEvent={tripEvent}
          entries={entries}
          startGroupId={startGroupId}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog.Root>
  );
}

function EditSheetContent({ tripEvent, entries, startGroupId, onSaved, onClose }) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState(/** @type {HTMLElement | null} */ (null));
  useKeyboardInset(sheet);
  const editing = Boolean(tripEvent?.id);
  const [form, setForm] = useState(() => ({
    name: tripEvent?.name ?? "",
    iconKey: tripEvent?.iconKey ?? "",
    startDate: tripEvent?.startDate ?? "",
    endDate: tripEvent?.endDate ?? "",
    currency: tripEvent?.currency ?? "",
    splitGroupId: tripEvent?.splitGroupId ?? ""
  }));
  const [lists, setLists] = useState({ ready: false, splitGroups: [] });
  const [preview, setPreview] = useState({ loading: false, result: null });
  const [state, setState] = useState({ saving: "", error: "" });
  const touched = useRef(new Set());
  const pickedIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);
  const iconKey = form.iconKey || guessTripEventIcon(form.name);

  const update = (patch, { byPerson = true } = {}) => {
    if (byPerson) Object.keys(patch).forEach((key) => touched.current.add(key));
    setForm((current) => ({ ...current, ...patch }));
  };

  // A split group's name, icon and currency, linked (design: "Started from
  // a split group").
  function applyGroup(group) {
    if (!group) return;
    update({
      name: group.name,
      iconKey: group.iconKey ?? "",
      currency: group.currency && group.currency !== HOME_CURRENCY ? group.currency : "",
      splitGroupId: group.id
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    loadTripEventsWithSplitGroups(queryClient, { signal: controller.signal })
      .then((result) => {
        setLists({ ready: true, splitGroups: result.splitGroups });
        if (startGroupId) applyGroup(result.splitGroups.find((group) => group.id === startGroupId));
      })
      .catch(() => {
        if (!controller.signal.aborted) setLists({ ready: true, splitGroups: [] });
      });
    return () => controller.abort();
    // Read once when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Picked rows: their first and last day and their foreign currency, unless
  // the person has already typed something there.
  useEffect(() => {
    if (editing || !entries.length) return;
    let live = true;
    loadTripEventDefaults(entries.map((entry) => entry.id), "").then((result) => {
      if (!live || !result.ok) return;
      const patch = {};
      if (!touched.current.has("startDate") && result.startDate) patch.startDate = result.startDate;
      if (!touched.current.has("endDate") && result.endDate) patch.endDate = result.endDate;
      if (!touched.current.has("currency") && result.currency) patch.currency = result.currency;
      setForm((current) => ({ ...current, ...patch }));
    });
    return () => {
      live = false;
    };
  }, [editing, entries]);

  // The preview line: a new trip with dates or a split group.
  const previewKey = editing ? "" : [form.startDate, form.endDate || form.startDate, form.currency, form.splitGroupId].join("|");
  useEffect(() => {
    if (!previewKey || (!form.startDate && !form.splitGroupId)) {
      setPreview({ loading: false, result: null });
      return undefined;
    }
    const controller = new AbortController();
    setPreview((current) => ({ ...current, loading: true }));
    const timer = window.setTimeout(() => {
      loadTripSuggestions({
        start: form.startDate,
        end: form.endDate || form.startDate,
        currency: form.currency,
        splitGroupId: form.splitGroupId
      }, { signal: controller.signal }, "")
        .then((result) => setPreview({ loading: false, result: result.ok && result.available ? result : null }))
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // previewKey holds every field the read depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const counts = useMemo(() => summarizeTripPreview(preview.result, pickedIds), [pickedIds, preview.result]);
  const hasSuggestions = !editing && (counts.ticked + counts.others) > 0;
  const groupName = lists.splitGroups.find((group) => group.id === form.splitGroupId)?.name ?? preview.result?.splitGroupName ?? "";
  const previewText = hasSuggestions
    ? copy.preview({ ...counts, currencyWord: tripCurrencyWord(form.currency), groupName, abroad: Boolean(form.currency) })
    : "";
  const currencyOptions = useMemo(() => {
    const known = TRIP_CURRENCIES.some((currency) => currency.code === form.currency);
    return [
      ...(form.currency && !known ? [{ code: form.currency, label: form.currency }] : []),
      ...TRIP_CURRENCIES
    ];
  }, [form.currency]);

  async function save(check) {
    if (state.saving) return;
    const body = {
      name: form.name,
      iconKey,
      startDate: form.startDate || null,
      endDate: form.endDate || form.startDate || null,
      currency: form.currency || null,
      splitGroupId: form.splitGroupId || null
    };
    setState({ saving: check ? "check" : "save", error: "" });
    if (!editing && entries.length) {
      // Picked rows: make it and put them on it in one change.
      const result = await setTripEventEntries({
        changes: entries.map((entry) => ({ entryId: entry.id, tripEventId: "new" })),
        newTripEvent: body
      }, copy.saveFailed);
      if (!result.ok || !result.tripEvent) {
        setState({ saving: "", error: result.error || copy.saveFailed });
        return;
      }
      forgetTripEvents(queryClient);
      onSaved({ tripEvent: result.tripEvent, check, setResult: result, created: true });
      onClose();
      return;
    }
    const result = await saveTripEvent(editing ? { tripEventId: tripEvent.id, ...body } : body, copy.saveFailed);
    if (!result.ok || !result.tripEvent) {
      setState({ saving: "", error: result.error || copy.saveFailed });
      return;
    }
    forgetTripEvents(queryClient);
    onSaved({ tripEvent: result.tripEvent, check, created: !editing });
    onClose();
  }

  const title = editing ? copy.changeTitle(tripEvent.name) : copy.newTitle;
  const canSave = Boolean(form.name.trim()) && !state.saving;
  const bar = hasSuggestions ? (
    <BottomActions
      className="is-sheet-bar"
      secondary={<button type="button" className="lsd-quiet" disabled={!canSave} onClick={() => void save(false)}>{entries.length ? copy.save : copy.makeEmpty}</button>}
      primary={<button type="button" className="lsd-primary" disabled={!canSave} onClick={() => void save(true)}>{state.saving === "check" ? copy.saving : copy.checkThem}</button>}
    />
  ) : (
    <BottomActions
      className="is-sheet-bar"
      secondary={<button type="button" className="lsd-quiet" onClick={onClose}>{copy.cancel}</button>}
      primary={<button type="button" className="lsd-primary" disabled={!canSave} onClick={() => void save(false)}>{state.saving ? copy.saving : copy.save}</button>}
    />
  );

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="note-dialog-overlay" />
      <Dialog.Content
        ref={setSheet}
        className="note-dialog-content split-dialog-content mobile-select-dialog is-picker-sheet trip-edit-sheet"
        aria-describedby={undefined}
        data-trip-edit-sheet={editing ? "change" : "new"}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetSwipeDismiss onClose={onClose} />
        <div className="note-dialog-head mobile-select-head">
          <Dialog.Title>{title}</Dialog.Title>
          <button type="button" className="icon-action subtle-cancel mobile-select-close" aria-label={copy.cancel} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <form
          className="mobile-select-options trip-form"
          data-sheet-body
          onSubmit={(event) => {
            event.preventDefault();
            void save(hasSuggestions);
          }}
        >
          {!editing && lists.splitGroups.length ? (
            <label className="trip-form-row">
              <span className="trip-form-label">{copy.startFromGroup}</span>
              <select
                className="trip-form-input"
                data-trip-field="start-from-group"
                value=""
                onChange={(event) => applyGroup(lists.splitGroups.find((group) => group.id === event.target.value))}
              >
                <option value="">{copy.startFromGroup}</option>
                {lists.splitGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="trip-form-row">
            <span className="trip-form-label">{copy.name}</span>
            <input
              className="trip-form-input"
              data-trip-field="name"
              type="text"
              maxLength={60}
              autoComplete="off"
              enterKeyHint="done"
              placeholder={copy.namePlaceholder}
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <div className="trip-form-row" role="radiogroup" aria-label={copy.icon}>
            <span className="trip-form-label" aria-hidden="true">{copy.icon}</span>
            <span className="trip-form-icons">
              {TRIP_EVENT_ICONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={iconKey === key}
                  aria-label={ICON_NAMES[key]}
                  className={`trip-form-icon ${iconKey === key ? "is-selected" : ""}`}
                  onClick={() => update({ iconKey: key })}
                >
                  <TripEventGlyph iconKey={key} size={16} />
                </button>
              ))}
            </span>
          </div>
          <div className="trip-form-row">
            <span className="trip-form-label">{copy.dates}</span>
            <span className="trip-form-dates">
              <input
                className="trip-form-input"
                data-trip-field="start"
                type="date"
                aria-label={copy.firstDay}
                value={form.startDate}
                onChange={(event) => update({ startDate: event.target.value })}
              />
              <span className="trip-form-to" aria-hidden="true">{copy.to}</span>
              <input
                className="trip-form-input"
                data-trip-field="end"
                type="date"
                aria-label={copy.lastDay}
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(event) => update({ endDate: event.target.value })}
              />
            </span>
          </div>
          <label className="trip-form-row">
            <span className="trip-form-label">{copy.paidIn}</span>
            <select className="trip-form-input" data-trip-field="currency" value={form.currency} onChange={(event) => update({ currency: event.target.value })}>
              <option value="">{copy.notAbroad}</option>
              {currencyOptions.map((currency) => <option key={currency.code} value={currency.code}>{currency.label}</option>)}
            </select>
          </label>
          {lists.splitGroups.length || form.splitGroupId ? (
            <label className="trip-form-row">
              <span className="trip-form-label">{copy.sharedCosts}</span>
              <select className="trip-form-input" data-trip-field="split-group" value={form.splitGroupId} onChange={(event) => update({ splitGroupId: event.target.value })}>
                <option value="">{copy.noLink}</option>
                {lists.splitGroups.map((group) => <option key={group.id} value={group.id}>{copy.linkSplits(group.name)}</option>)}
              </select>
            </label>
          ) : null}
          {previewText ? <p className="trip-form-preview" data-trip-preview="" aria-live="polite">{previewText}</p> : null}
          {state.error ? <p className="category-pick-error" role="alert">{state.error}</p> : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
        {bar}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
