// Trips and events on Entries (DOMAIN.md "Trip or Event"): the lazy chunk
// that holds the picker and the Undo note. Entries loads it only when a
// picker first opens, so neither the first screen nor the Entries route
// carries it.
//
// The picker follows the category list (design.md "Category list"): a
// search, the trip on now first, then the three used most recently, then the
// rest A to Z, then None. Typing a name nobody has makes it ("Make 'Jeju
// weekend'") and puts the entries on it in one step. Choosing saves at once
// (no "Are you sure?") and the note offers Undo.
import "./category-pick.css";
import "./trip-events.css";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Check, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { tripEventsCopy as copy } from "./copy/trip-events-copy";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { BottomActions } from "./ui-components";
import { TripEventGlyph } from "./trip-event-glyph";
import { forgetTripEvents, loadTripEvents, loadTripEventsWithSplitGroups, setTripEventEntries, undoTripEventChange } from "./trip-events-api";
import { todayInAppTimeZone } from "./app-dates";

import { useKeyboardInset } from "./use-keyboard-inset";
import { useRouteWorkBusy } from "./use-route-work-status";
import { orderTripEventsForPicker, tripEventNameKey } from "../domain/trip-events";

/**
 * The rows the picker offers, in order, with their section headings.
 * @param {{ tripEvents: any[], query: string, today: string, currentTripEventId: string | null, showNone: boolean, entryCount: number }} input
 */
export function buildTripEventPickRows({ tripEvents, query, today, currentTripEventId, showNone }) {
  const text = query.trim();
  const key = tripEventNameKey(text);
  if (text) {
    const matches = tripEvents
      .filter((trip) => !trip.putAway && trip.name.toLowerCase().includes(text.toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name));
    const exact = tripEvents.find((trip) => tripEventNameKey(trip.name) === key);
    const rows = [];
    if (!exact) {
      rows.push({ kind: "make", value: `make:${text}`, name: text });
    }
    if (matches.length) {
      rows.push({ kind: "heading", label: exact ? null : copy.similar });
      matches.forEach((trip) => rows.push({ kind: "trip", value: trip.id, trip }));
    }
    return rows.filter((row) => row.kind !== "heading" || row.label);
  }
  const { now, recent, rest } = orderTripEventsForPicker(tripEvents, today);
  const rows = [];
  const section = (label, list, isNow = false) => {
    if (!list.length) return;
    rows.push({ kind: "heading", label });
    list.forEach((trip) => rows.push({ kind: "trip", value: trip.id, trip, isNow }));
  };
  section(copy.now, now, true);
  section(copy.recent, recent);
  section(copy.more, rest);
  if (showNone) {
    rows.push({ kind: "none", value: "none", isCurrent: currentTripEventId === null });
  }
  rows.push({ kind: "new", value: "new" });
  return rows;
}

/**
 * The picker: a popover under `anchorRef` on a wide screen, a sheet on a
 * phone. `entries` are the entries it puts on (one, or the picked rows).
 * `onSaved(result)` gets the command's answer and the words for the note.
 */
export function TripEventPicker({ open, onOpenChange, anchorRef, entries, onSaved, onNew = undefined, isMobile = false }) {
  useRouteWorkBusy(open);
  const close = () => onOpenChange(false);
  const title = entries.length === 1 ? copy.rowLabel : copy.putManyTitle(entries.length);
  if (isMobile) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        {open ? <TripEventSheet title={title} entries={entries} onSaved={onSaved} onNew={onNew} onClose={close} /> : null}
      </Dialog.Root>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchorRef} />
      {open ? (
        <Popover.Portal>
          <Popover.Content
            className="category-popover trip-pick-popover"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            aria-label={title}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = anchorRef?.current;
              if (target && typeof target.focus === "function" && document.activeElement === document.body) {
                target.focus({ preventScroll: true });
              }
            }}
          >
            {entries.length > 1 ? <p className="trip-pick-title">{title}</p> : null}
            <TripEventPickList variant="popover" entries={entries} onSaved={onSaved} onNew={onNew} onClose={close} />
          </Popover.Content>
        </Popover.Portal>
      ) : null}
    </Popover.Root>
  );
}

function TripEventSheet({ title, entries, onSaved, onNew, onClose }) {
  const [sheet, setSheet] = useState(/** @type {HTMLElement | null} */ (null));
  useKeyboardInset(sheet, { scrollFocused: false });
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="note-dialog-overlay" />
      <Dialog.Content
        ref={setSheet}
        className="note-dialog-content split-dialog-content mobile-select-dialog is-picker-sheet is-category-sheet trip-pick-sheet"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetSwipeDismiss onClose={onClose} />
        <div className="note-dialog-head mobile-select-head">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{copy.searchLabel}</Dialog.Description>
          <button type="button" className="icon-action subtle-cancel mobile-select-close" aria-label={copy.close} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <TripEventPickList variant="sheet" entries={entries} onSaved={onSaved} onNew={onNew} onClose={onClose} />
        <BottomActions
          className="is-sheet-bar"
          secondary={<button type="button" className="lsd-quiet" onClick={onClose}>{copy.close}</button>}
        />
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function TripEventPickList({ variant, entries, onSaved, onNew, onClose }) {
  const queryClient = useQueryClient();
  const listId = useId();
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [state, setState] = useState({ ready: false, tripEvents: [], error: "" });
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const today = todayInAppTimeZone();
  const currentIds = [...new Set(entries.map((entry) => entry.tripEventId ?? null))];
  const currentTripEventId = currentIds.length === 1 ? currentIds[0] : undefined;
  const showNone = entries.some((entry) => entry.tripEventId);

  useEffect(() => {
    const controller = new AbortController();
    loadTripEvents(queryClient, { signal: controller.signal })
      .then((result) => setState({ ready: true, tripEvents: result.tripEvents, error: "" }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ ready: true, tripEvents: [], error: copy.loadFailed });
      });
    return () => controller.abort();
  }, [queryClient]);

  useEffect(() => {
    if (canFocusSearchOnOpen()) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const rows = useMemo(
    () => buildTripEventPickRows({ tripEvents: state.tripEvents, query, today, currentTripEventId: currentTripEventId ?? "", showNone, entryCount: entries.length }),
    [currentTripEventId, entries.length, query, showNone, state.tripEvents, today]
  );
  const choosable = rows.filter((row) => row.kind !== "heading");

  function changeQuery(next) {
    setQuery(next);
    setActiveIndex(next.trim() ? 0 : -1);
  }

  async function choose(row) {
    if (pending) return;
    if (row.kind === "new") {
      // The full New sheet, with these entries' days and currency.
      if (onNew) {
        onClose();
        onNew(entries);
      } else {
        inputRef.current?.focus();
      }
      return;
    }
    setError("");
    setPending(row.value);
    const dates = entries.map((entry) => entry.date).filter(Boolean).sort();
    const body = row.kind === "make"
      ? {
        changes: entries.map((entry) => ({ entryId: entry.id, tripEventId: "new" })),
        newTripEvent: { name: row.name, startDate: dates[0] ?? null, endDate: dates.at(-1) ?? null }
      }
      : { entryIds: entries.map((entry) => entry.id), tripEventId: row.kind === "none" ? null : row.value };
    const result = await setTripEventEntries(body, copy.saveFailed);
    setPending("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    forgetTripEvents(queryClient);
    const name = row.kind === "make" ? row.name : row.kind === "trip" ? row.trip.name : "";
    onSaved?.({ ...result, name, message: describeTripEventChange({ ...result, name }, entries.length) });
    onClose();
  }

  function move(step) {
    if (!choosable.length) return;
    const next = activeIndex < 0 ? (step > 0 ? 0 : choosable.length - 1) : Math.min(choosable.length - 1, Math.max(0, activeIndex + step));
    setActiveIndex(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const row = choosable[activeIndex];
      if (row) void choose(row);
    }
  }

  let index = -1;
  return (
    <div className={`category-pick trip-pick is-${variant}`} aria-busy={!state.ready || Boolean(pending)}>
      <div className="category-pick-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-label={copy.searchLabel}
          placeholder={copy.searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={60}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {query ? (
          <button type="button" className="category-pick-clear" aria-label="Clear" onMouseDown={(event) => event.preventDefault()} onClick={() => changeQuery("")}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {error || state.error ? <p className="category-pick-error" role="alert">{error || state.error}</p> : null}
      <div className={`category-pick-options ${variant === "sheet" ? "mobile-select-options" : ""}`} data-sheet-body={variant === "sheet" ? "" : undefined}>
        {state.ready ? (
          <div id={listId} role="listbox" aria-label={copy.listTitle} className="category-pick-listbox">
            {rows.map((row, position) => {
              if (row.kind === "heading") {
                return <p key={`h-${position}`} className="trip-pick-heading" role="presentation">{row.label}</p>;
              }
              index += 1;
              const rowIndex = index;
              const isActive = rowIndex === activeIndex;
              const isCurrent = row.kind === "trip" ? row.value === currentTripEventId : row.kind === "none" ? Boolean(row.isCurrent) && entries.length === 1 : false;
              return (
                <button
                  key={row.value}
                  id={`${listId}-${rowIndex}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={isCurrent}
                  disabled={Boolean(pending) && pending !== row.value}
                  data-trip-option={row.kind === "trip" ? row.trip.name : row.kind}
                  className={`category-pick-row trip-pick-row is-${row.kind} ${isCurrent ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => (isActive ? undefined : setActiveIndex(rowIndex))}
                  onClick={() => void choose(row)}
                >
                  <span className="category-pick-row-main">
                    <span className="category-pick-row-icon trip-pick-icon" aria-hidden="true">
                      {row.kind === "trip" ? <TripEventGlyph iconKey={row.trip.iconKey} size={15} /> : row.kind === "none" ? <X size={15} /> : <Plus size={15} />}
                    </span>
                    <span className="trip-pick-text">
                      <span className="category-pick-row-label">
                        {row.kind === "trip" ? row.trip.name
                          : row.kind === "none" ? (entries.length > 1 ? copy.takeOffAll : copy.none)
                            : row.kind === "make" ? copy.make(row.name)
                              : copy.newRow}
                      </span>
                      {row.kind === "trip" ? <span className="trip-pick-meta">{copy.tripMeta(row.trip)}</span> : null}
                      {row.kind === "make" ? <span className="trip-pick-meta">{copy.makeHint(entries.length)}</span> : null}
                      {row.kind === "new" && !onNew ? <span className="trip-pick-meta">{copy.newRowHint}</span> : null}
                    </span>
                  </span>
                  {row.isNow ? <span className="category-pick-tag">{copy.nowTag}</span> : null}
                  {isCurrent ? <Check size={18} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// A mouse and keyboard device focuses the search at once; a touch device
// waits for a tap so the keyboard does not cover the list (as the category
// list does).
function canFocusSearchOnOpen() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// The note after a change: what happened, and Undo through the change's
// audit event (or, for the picked rows' Category, the note's own `undo`,
// which runs the same command back). It stays a few seconds; a new change
// replaces it.
export function TripEventNote({ note, onUndone, onDismiss }) {
  const [state, setState] = useState({ undoing: false, error: "", undone: false });
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss?.(), 9000);
    return () => window.clearTimeout(timer);
  }, [note, onDismiss]);
  if (!note) return null;
  const canUndo = Boolean(note.undoId || note.undo);
  async function undo() {
    setState({ undoing: true, error: "", undone: false });
    const result = note.undo ? await note.undo() : await undoTripEventChange(note.undoId, copy.saveFailed);
    if (!result.ok) {
      setState({ undoing: false, error: result.error, undone: false });
      return;
    }
    setState({ undoing: false, error: "", undone: true });
    onUndone?.(note);
  }
  return (
    <div className="trip-note" role="status" data-trip-note="">
      <span className="trip-note-text">{state.error || (state.undone ? copy.undone : note.message)}</span>
      {canUndo && !state.undone ? (
        <button type="button" className="trip-note-undo" disabled={state.undoing} onClick={() => void undo()}>{copy.undo}</button>
      ) : null}
      <button type="button" className="trip-note-close" aria-label={copy.close} onClick={() => onDismiss?.()}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

// The words for the note after a set.
export function describeTripEventChange(result, entryCount) {
  const changed = Number(result?.changed ?? 0);
  if (!changed) return copy.nothingChanged;
  const tookOff = (result.changes ?? []).every((change) => change.to === null);
  if (tookOff) return copy.takenOff(changed);
  const moved = entryCount === 1 && (result.changes ?? [])[0]?.from;
  return moved ? copy.moved(result.name) : copy.putOn(changed, result.name);
}

// The Trips & events sheet's empty state (design: "Empty states that
// teach"): make the first one, or start from the household's most recent
// split group, which brings its name, icon and currency.
export function TripEventsEmptyActions({ onMakeFirst, onStartFrom }) {
  const queryClient = useQueryClient();
  const [group, setGroup] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    loadTripEventsWithSplitGroups(queryClient, { signal: controller.signal })
      .then((result) => setGroup(result.splitGroups[0] ?? null))
      .catch(() => undefined);
    return () => controller.abort();
  }, [queryClient]);
  return (
    <div className="trip-sheet-empty-actions">
      <button type="button" className="lsd-primary" data-trip-make-first="" onClick={onMakeFirst}>{copy.makeFirst}</button>
      {group ? (
        <button type="button" className="subtle-action" data-trip-start-from={group.name} onClick={() => onStartFrom(group.id)}>{copy.startFrom(group.name)}</button>
      ) : null}
    </div>
  );
}

// The trip view, the Trips & events sheet, the New sheet and the review
// list ride in this same chunk.
export { TripEventLead, TripEventsSheet } from "./trip-event-views";
export { TripEventEditSheet } from "./trip-event-edit-sheet";
export { TripEventReviewSheet } from "./trip-event-review-sheet";
