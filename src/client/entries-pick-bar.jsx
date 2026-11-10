// The floating bar for picked Entries rows (design.md "Trips and events on
// Entries", "Picking many"): a lazy chunk, loaded when picking starts. It
// shows how many rows are picked and their total (as the rows show it,
// hidden with the rest of the money), and offers "Put on a trip or event"
// (T), "Category", "Add to Splits" and Cancel (Esc). It sits where the wide screen's floating
// bar sits, and on a phone where the tab bar is, under the thumb.
//
// Category uses the one category list and the bulk category command: over
// 10 rows it asks "Yes, change all N" here in the bar (never a browser
// confirm); over 200 the bar refuses, and so does the server.
//
// Add to Splits opens a small choice (entries-pick-splits.jsx: group, share,
// a plain preview) and puts the rows that can go on Splits (expenses not on
// Splits yet) through the bulk add command with one group and share; over 10
// it asks "Yes, add all N" here too, and the panel's note offers Undo.
import "./entries-pick.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { CategoryPickerHost } from "./category-picker-host";
import { tripEventsCopy as copy } from "./copy/trip-events-copy";
import { CategoryGlyph } from "./ui-components";
import { PrivateMoney } from "./money-privacy";
import { moniesClient } from "./monies-client-service";
import { pickSplitsCopy as splitsCopy } from "./copy/pick-splits-copy";
import { addPickedToSplits, changeEntryCategories } from "./trip-events-api";
import {
  chosenAddBody,
  defaultSplitGroupId,
  needsAddConfirm,
  noneAddedReason,
  splitPeopleFor,
  splitsPlanFor
} from "./entry-pick-splits-model";
import { readLastGroupId } from "./splits-group-strip-model";
import { categoryChangesFor, isPickKeyIgnored, needsConfirm, PICK_MAX } from "./entry-pick-model";

const { format: formatService } = moniesClient;

// The choice (popover or sheet) is fetched when it first opens.
const PickSplitsChoice = lazy(() => import("./entries-pick-splits").then((module) => ({ default: module.PickSplitsChoice })));

/**
 * @param {{
 *   rows: any[], summary: { count: number, totalMinor: number, tooMany: boolean },
 *   categories: any[],
 *   splitGroups?: Array<{ id: string, name: string }>, people?: Array<{ name: string }>, viewId?: string,
 *   onAddedToSplits?: (added: { result: any, plan: any }) => void,
 *   onPutOnTrip: (element: HTMLElement | null) => void,
 *   onCategoryChanged: (change: { changes: any[], categoryName: string, confirmedCount?: number }) => void,
 *   onCancel: () => void
 * }} props
 */
export function EntriesPickBar({ rows, summary, categories, splitGroups = [], people = [], viewId = "", onAddedToSplits = undefined, onPutOnTrip, onCategoryChanged, onCancel }) {
  const tripButtonRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const categoryButtonRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const splitsButtonRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [splitsChoice, setSplitsChoice] = useState({ mounted: false, open: false });
  const [categoryList, setCategoryList] = useState({ mounted: false, open: false });
  const [confirm, setConfirm] = useState(/** @type {{ kind: "category", categoryName: string, changes: any[] } | { kind: "splits", choice: { groupId: string, shareBasisPoints: number } } | null} */ (null));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const { count, totalMinor, tooMany } = summary;
  const nothing = count === 0;

  // A new pick changes what a waiting confirm or refusal was about.
  const pickKey = rows.map((row) => row.id).join(",");
  const [shownPickKey, setShownPickKey] = useState(pickKey);
  if (shownPickKey !== pickKey) {
    setShownPickKey(pickKey);
    setConfirm(null);
    setMessage("");
  }

  const options = useMemo(
    () => categories
      .filter((category) => category.name !== "Transfer")
      .map((category) => ({
        value: category.name,
        label: category.name,
        iconKey: category.iconKey,
        colorHex: category.colorHex,
        icon: <CategoryGlyph iconKey={category.iconKey} />
      })),
    [categories]
  );
  const sharedCategory = useMemo(() => {
    const names = new Set(rows.map((row) => (row.ledgerEntry ?? row).categoryName));
    return names.size === 1 ? [...names][0] : "";
  }, [rows]);

  function putOnTrip() {
    if (nothing) return;
    if (tooMany) {
      setMessage(copy.tooMany(PICK_MAX));
      return;
    }
    setMessage("");
    onPutOnTrip(tripButtonRef.current);
  }

  function openCategories() {
    if (nothing) return;
    if (tooMany) {
      setMessage(copy.tooMany(PICK_MAX));
      return;
    }
    setMessage("");
    setConfirm(null);
    setCategoryList({ mounted: true, open: true });
  }

  async function save(categoryName, changes, confirmedCount = undefined) {
    setSaving(true);
    const result = await changeEntryCategories(changes, { confirmedCount }, copy.saveFailed);
    setSaving(false);
    // The command's "changed meanwhile" words are Ask's ("Ask again"); here
    // the rows are on screen, so it says to pick them again.
    if (!result.ok) return /changed meanwhile/i.test(result.error) ? { ok: false, error: copy.changedMeanwhile } : result;
    onCategoryChanged({ changes, categoryName, confirmedCount });
    return result;
  }

  async function chooseCategory(categoryName) {
    const { changes, transfers } = categoryChangesFor(rows, categoryName);
    if (!changes.length) {
      return { ok: false, error: transfers ? copy.transfersKeep : copy.alreadyInCategory(categoryName) };
    }
    if (needsConfirm(changes.length)) {
      // The list closes; the bar asks before changing that many.
      setConfirm({ kind: "category", categoryName, changes });
      return { ok: true };
    }
    return save(categoryName, changes);
  }

  async function confirmAll() {
    if (!confirm || saving) return;
    if (confirm.kind === "splits") {
      const result = await addToSplits(confirm.choice, true);
      if (!result.ok) {
        setMessage(result.error);
        setConfirm(null);
      }
      return;
    }
    const result = await save(confirm.categoryName, confirm.changes, confirm.changes.length);
    if (!result.ok) {
      setMessage(result.error);
      setConfirm(null);
    }
  }

  // Add to Splits: the rows that can go (expenses not already on Splits), the
  // group it starts on and who the words name come from the picked rows.
  const splitsPlan = useMemo(() => splitsPlanFor(rows), [rows]);
  const splitsPeople = useMemo(() => splitPeopleFor(splitsPlan.payerNames, people), [people, splitsPlan.payerNames]);
  const initialGroupId = useMemo(() => defaultSplitGroupId(splitGroups, readLastGroupId(viewId) ?? ""), [splitGroups, viewId]);

  function openSplits() {
    if (nothing) return;
    if (tooMany) {
      setMessage(copy.tooMany(PICK_MAX));
      return;
    }
    if (!splitsPlan.ids.length) {
      setMessage(splitsCopy.nothingToAdd);
      return;
    }
    setMessage("");
    setConfirm(null);
    setSplitsChoice({ mounted: true, open: true });
  }

  async function addToSplits({ groupId, shareBasisPoints }, confirmed = false) {
    const ids = splitsPlan.ids;
    if (needsAddConfirm(ids.length) && !confirmed) {
      // The choice closes; the bar asks before adding that many.
      setConfirm({ kind: "splits", choice: { groupId, shareBasisPoints } });
      return { ok: true };
    }
    setSaving(true);
    const result = await addPickedToSplits(chosenAddBody({ ids, groupId, shareBasisPoints, confirmed }), splitsCopy.saveFailed);
    setSaving(false);
    if (!result.ok) return result;
    if (!result.addedCount) return { ok: false, error: noneAddedReason(result) };
    onAddedToSplits?.({ result, plan: splitsPlan });
    return result;
  }

  // T puts the picked rows on a trip; Esc (in the panel) stops picking.
  const putOnTripRef = useRef(putOnTrip);
  putOnTripRef.current = putOnTrip;
  useEffect(() => {
    function handleKey(event) {
      if ((event.key !== "t" && event.key !== "T") || event.shiftKey || isPickKeyIgnored(event)) return;
      event.preventDefault();
      putOnTripRef.current();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <section className="entries-pick-bar" aria-label={copy.pickBarLabel} data-pick-bar="">
      <div className="entries-pick-bar-head">
        <p className="entries-pick-bar-count" role="status">
          <strong>{copy.picked(count)}</strong>
          {count ? (
            <>
              <span aria-hidden="true"> · </span>
              <PrivateMoney className="entries-pick-bar-total">{formatService.money(totalMinor)}</PrivateMoney>
            </>
          ) : null}
        </p>
        <button type="button" className="lsd-quiet entries-pick-bar-cancel" onClick={onCancel}>
          {copy.cancel}
          <kbd className="entries-pick-key">Esc</kbd>
        </button>
      </div>
      {message ? <p className="entries-pick-bar-message" role="alert">{message}</p> : null}
      {confirm ? (
        <div className="entries-pick-bar-actions is-confirm">
          <p className="entries-pick-bar-question">
            {confirm.kind === "splits" ? splitsCopy.confirmAll(splitsPlan.ids.length) : copy.confirmAll(confirm.changes.length, confirm.categoryName)}
          </p>
          <button type="button" className="lsd-primary entries-pick-bar-main" data-pick-confirm="" disabled={saving} onClick={() => void confirmAll()}>
            {confirm.kind === "splits" ? splitsCopy.yesAll(splitsPlan.ids.length) : copy.yesAll(confirm.changes.length)}
          </button>
          <button type="button" className="lsd-quiet entries-pick-bar-second" disabled={saving} onClick={() => setConfirm(null)}>
            {copy.cancel}
          </button>
        </div>
      ) : (
        <div className="entries-pick-bar-actions">
          <button
            ref={tripButtonRef}
            type="button"
            className="lsd-primary entries-pick-bar-main"
            data-pick-trip=""
            aria-keyshortcuts="T"
            disabled={nothing}
            onClick={putOnTrip}
          >
            {copy.putOnTrip}
            <kbd className="entries-pick-key">T</kbd>
          </button>
          <button
            ref={categoryButtonRef}
            type="button"
            className="lsd-quiet entries-pick-bar-second"
            data-pick-category=""
            aria-haspopup="dialog"
            aria-expanded={categoryList.open}
            disabled={nothing || saving}
            onClick={openCategories}
          >
            {copy.category}
          </button>
          <button
            ref={splitsButtonRef}
            type="button"
            className="lsd-quiet entries-pick-bar-second"
            data-pick-splits-open=""
            aria-haspopup="dialog"
            aria-expanded={splitsChoice.open}
            disabled={nothing || saving}
            onClick={openSplits}
          >
            {splitsCopy.button}
          </button>
        </div>
      )}
      {splitsChoice.mounted ? (
        <Suspense fallback={null}>
          <PickSplitsChoice
            open={splitsChoice.open}
            onOpenChange={(open) => setSplitsChoice((current) => ({ ...current, open }))}
            anchorRef={splitsButtonRef}
            count={splitsPlan.ids.length}
            groups={splitGroups}
            people={splitsPeople}
            initialGroupId={initialGroupId}
            onChoose={addToSplits}
          />
        </Suspense>
      ) : null}
      {categoryList.mounted ? (
        <CategoryPickerHost
          open={categoryList.open}
          onOpenChange={(open) => setCategoryList((current) => ({ ...current, open }))}
          anchorRef={categoryButtonRef}
          returnFocusRef={categoryButtonRef}
          title={copy.categoryTitle(count)}
          options={options}
          value={sharedCategory}
          onChoose={chooseCategory}
        />
      ) : null}
    </section>
  );
}
