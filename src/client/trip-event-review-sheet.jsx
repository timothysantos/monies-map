// The review list for a trip or event (design 2d, "Everything from these
// dates"; DOMAIN.md "Trip or Event", "Suggestions"). Part of the lazy
// entries-trip-events chunk.
//
// The server groups the likely entries and ticks them (paid in the trip's
// currency, on its linked split group); dollars in the same days and home
// bills are listed unticked. Groups fold with their counts. "Booked before
// you went?" searches before the first day. One button adds the ticked ones
// through the one command (as a suggestion) and the note offers Undo.
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { tripEventsCopy as copy, formatTripDates } from "./copy/trip-events-copy";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { BottomActions } from "./ui-components";
import { forgetTripEvents, loadTripSuggestions, searchTripSuggestions, setTripEventEntries } from "./trip-events-api";
import { useKeyboardInset } from "./use-keyboard-inset";
import { useRouteWorkBusy } from "./use-route-work-status";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { entryAmountTone } from "../domain/money-tone";
import { MAX_TRIP_EVENT_CHANGE } from "../domain/trip-events";
import { tripCurrencyWord } from "../domain/trip-event-suggestions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (minor) => moniesClient.format.money(minor);

function shortDay(iso) {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

// "₩1,260,000": the amount the entry shows in the trip's currency.
export function formatForeignMoney(minor, currency) {
  try {
    return new Intl.NumberFormat("en-SG", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toLocaleString("en-SG")}`;
  }
}

/**
 * The groups as the sheet shows them: each with its label, its entries and
 * how many are ticked. The search's rows come last.
 * @param {any} suggestions
 * @param {any[]} searchRows
 * @param {Set<string>} ticked
 */
export function buildReviewGroups(suggestions, searchRows, ticked) {
  const currencyWord = tripCurrencyWord(suggestions?.currency);
  const labelOf = (key) => (key === "currency" ? copy.groupCurrency(currencyWord)
    : key === "splits" ? copy.groupSplits(suggestions?.splitGroupName ?? "")
      : key === "dollars" ? (suggestions?.currency ? copy.groupDollars : copy.groupInDates)
        : copy.groupSearch);
  const listed = new Set();
  const groups = (suggestions?.groups ?? []).map((group) => {
    group.entries.forEach((entry) => listed.add(entry.id));
    return { key: group.key, label: labelOf(group.key), entries: group.entries };
  });
  const found = searchRows.filter((entry) => !listed.has(entry.id));
  if (found.length) groups.push({ key: "search", label: labelOf("search"), entries: found });
  return groups.map((group) => ({
    ...group,
    tickedCount: group.entries.filter((entry) => ticked.has(entry.id)).length,
    // "28 of 28 ticked" where the app ticked some, "0 of 12" where it did not.
    countLabel: group.key === "currency" || group.key === "splits"
      ? copy.ofTicked(group.entries.filter((entry) => ticked.has(entry.id)).length, group.entries.length)
      : copy.ofCount(group.entries.filter((entry) => ticked.has(entry.id)).length, group.entries.length)
  }));
}

/**
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, tripEvent: any, onAdded: (result: any) => void }} props
 */
export function TripEventReviewSheet({ open, onOpenChange, tripEvent, onAdded }) {
  useRouteWorkBusy(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {open && tripEvent ? <ReviewContent tripEvent={tripEvent} onAdded={onAdded} onClose={() => onOpenChange(false)} /> : null}
    </Dialog.Root>
  );
}

function ReviewContent({ tripEvent, onAdded, onClose }) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState(/** @type {HTMLElement | null} */ (null));
  useKeyboardInset(sheet);
  const [load, setLoad] = useState({ ready: false, result: null, error: "" });
  const [ticked, setTicked] = useState(() => new Set());
  const [openGroups, setOpenGroups] = useState(() => new Set(["currency"]));
  const [search, setSearch] = useState({ open: false, words: "", busy: false, rows: [], searched: false, error: "" });
  const [saving, setSaving] = useState({ busy: false, error: "" });
  // Hidden money shows no tone and no amount in another currency either.
  const { areTotalsVisible } = useMoneyPrivacy();
  const outTone = areTotalsVisible ? moneyToneClass(entryAmountTone("expense", -1)) : "money-neutral";

  useEffect(() => {
    const controller = new AbortController();
    loadTripSuggestions({ tripEventId: tripEvent.id }, { signal: controller.signal }, copy.loadFailed)
      .then((result) => {
        if (!result.ok) {
          setLoad({ ready: true, result: null, error: result.error });
          return;
        }
        setLoad({ ready: true, result, error: "" });
        setTicked(new Set(result.groups.flatMap((group) => group.entries).filter((entry) => entry.ticked).map((entry) => entry.id)));
        const first = result.groups[0]?.key;
        if (first) setOpenGroups(new Set([first]));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [tripEvent.id]);

  const groups = useMemo(() => buildReviewGroups(load.result, search.rows, ticked), [load.result, search.rows, ticked]);
  const count = ticked.size;
  const tooMany = count > MAX_TRIP_EVENT_CHANGE;

  function toggle(entryId) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function toggleGroup(key) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function runSearch(event) {
    event?.preventDefault();
    if (!search.words.trim() || search.busy) return;
    setSearch((current) => ({ ...current, busy: true, error: "" }));
    const result = await searchTripSuggestions(tripEvent.id, search.words, {}, copy.loadFailed).catch(() => ({ ok: false, error: copy.loadFailed }));
    setSearch((current) => ({
      ...current,
      busy: false,
      searched: true,
      rows: result.ok ? result.group.entries : current.rows,
      error: result.ok ? "" : result.error
    }));
    if (result.ok) setOpenGroups((current) => new Set([...current, "search"]));
  }

  async function add() {
    if (!count || tooMany || saving.busy) return;
    setSaving({ busy: true, error: "" });
    const result = await setTripEventEntries({ entryIds: [...ticked], tripEventId: tripEvent.id, addedBy: "suggestion" }, copy.saveFailed);
    if (!result.ok) {
      setSaving({ busy: false, error: result.error });
      return;
    }
    forgetTripEvents(queryClient);
    onAdded({ ...result, name: tripEvent.name, message: copy.added(result.changed ?? count, tripEvent.name) });
    onClose();
  }

  const dates = formatTripDates(tripEvent);
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="note-dialog-overlay" />
      <Dialog.Content
        ref={setSheet}
        className="note-dialog-content split-dialog-content mobile-select-dialog is-picker-sheet trip-review-sheet"
        aria-describedby={undefined}
        data-trip-review=""
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetSwipeDismiss onClose={onClose} />
        <div className="note-dialog-head mobile-select-head">
          <Dialog.Title>
            {copy.reviewTitle(tripEvent.name)}
            {dates ? <span className="trip-review-dates">{dates}</span> : null}
          </Dialog.Title>
          <button type="button" className="icon-action subtle-cancel mobile-select-close" aria-label={copy.close} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="mobile-select-options trip-review-body" data-sheet-body aria-busy={!load.ready}>
          {load.error ? <p className="category-pick-error" role="alert">{load.error}</p> : null}
          {load.ready && !load.error && !groups.length ? <p className="trip-review-empty">{copy.nothingToAdd}</p> : null}
          {groups.map((group) => {
            const isOpen = openGroups.has(group.key);
            return (
              <section key={group.key} className="trip-review-group" data-trip-review-group={group.key}>
                <button type="button" className="trip-review-group-head" aria-expanded={isOpen} onClick={() => toggleGroup(group.key)}>
                  <span className="trip-review-group-label">{group.label}</span>
                  <span className="trip-review-group-count">{group.countLabel}</span>
                  {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                </button>
                {isOpen ? (
                  <ul className="trip-review-list">
                    {group.entries.map((entry) => {
                      const meta = [
                        shortDay(entry.date),
                        areTotalsVisible && entry.foreignAmountMinor !== undefined ? formatForeignMoney(entry.foreignAmountMinor, entry.foreignCurrency) : "",
                        entry.who ?? ""
                      ].filter(Boolean).join(" · ");
                      return (
                        <li key={entry.id}>
                          <label className="trip-review-row" data-trip-review-row={entry.description}>
                            <input type="checkbox" checked={ticked.has(entry.id)} onChange={() => toggle(entry.id)} />
                            <span className="trip-review-text">
                              <span className="trip-review-name">{entry.description}</span>
                              <span className="trip-pick-meta">{meta}</span>
                            </span>
                            <span className={`trip-review-amount ${outTone}`}>
                              <PrivateMoney>{money(-Math.abs(entry.amountMinor))}</PrivateMoney>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            );
          })}
          {load.ready && !load.error ? (
            <section className="trip-review-group" data-trip-review-group="search-form">
              <button
                type="button"
                className="trip-review-group-head"
                aria-expanded={search.open}
                onClick={() => setSearch((current) => ({ ...current, open: !current.open }))}
              >
                <span className="trip-review-group-label">{copy.groupSearch}</span>
                <span className="trip-review-group-count">{copy.search}</span>
                {search.open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
              {search.open ? (
                <form className="trip-review-search" onSubmit={(event) => void runSearch(event)}>
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label={copy.searchWords}
                    placeholder={copy.searchWords}
                    enterKeyHint="search"
                    maxLength={60}
                    value={search.words}
                    onChange={(event) => setSearch((current) => ({ ...current, words: event.target.value }))}
                  />
                  <button type="submit" className="subtle-action" disabled={search.busy || !search.words.trim()}>{copy.search}</button>
                </form>
              ) : null}
              {search.open && search.searched && !search.rows.length && !search.error ? <p className="trip-pick-meta trip-review-note">{copy.searchNothing}</p> : null}
              {search.error ? <p className="category-pick-error" role="alert">{search.error}</p> : null}
            </section>
          ) : null}
          {load.result?.homeBillCount ? <p className="trip-review-note" data-trip-home-bills="">{copy.homeBillsLeft}</p> : null}
          {load.result?.truncated ? <p className="trip-review-note">{copy.moreThanListed}</p> : null}
          {tooMany ? <p className="category-pick-error" role="alert">{copy.tooMany(MAX_TRIP_EVENT_CHANGE)}</p> : null}
          {saving.error ? <p className="category-pick-error" role="alert">{saving.error}</p> : null}
        </div>
        <BottomActions
          className="is-sheet-bar"
          secondary={<button type="button" className="lsd-quiet" onClick={onClose}>{copy.cancel}</button>}
          primary={(
            <button type="button" className="lsd-primary" data-trip-review-add="" disabled={!count || tooMany || saving.busy} onClick={() => void add()}>
              {copy.addEntries(count)}
            </button>
          )}
        />
      </Dialog.Content>
    </Dialog.Portal>
  );
}
