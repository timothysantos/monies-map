// Picking many Entries rows at once (design.md "Trips and events on
// Entries", "Picking many"): which rows are picked, in the order they are on
// screen, and what the floating bar can do with them. Pure functions over a
// small immutable state, so the panel keeps one value and the rows get a
// boolean each.
import { buildEntryRowDisplay } from "./entry-row-display";
import { BULK_RECATEGORISE_CONFIRM_ABOVE, BULK_RECATEGORISE_MAX } from "../domain/entry-category-bulk";

// One change (a trip or a category) takes at most this many rows; the
// server refuses more too (MAX_TRIP_EVENT_CHANGE, BULK_RECATEGORISE_MAX).
export const PICK_MAX = BULK_RECATEGORISE_MAX;

/** @typedef {{ picking: boolean, ids: Set<string>, anchorId: string }} PickState */

/** @type {PickState} */
export const NO_PICK = Object.freeze({ picking: false, ids: new Set(), anchorId: "" });

/** @returns {PickState} */
export function startPicking(state = NO_PICK) {
  return state.picking ? state : { picking: true, ids: new Set(), anchorId: "" };
}

/** Adds or removes one row; it becomes the start of the next Shift-click run. */
export function togglePick(state, id) {
  const ids = new Set(state.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { picking: true, ids, anchorId: id };
}

/** Adds one row (a press and hold, or a Ctrl-click that starts picking). */
export function addPick(state, id) {
  const ids = new Set(state.ids);
  ids.add(id);
  return { picking: true, ids, anchorId: id };
}

/**
 * Shift-click: every row from the last one picked to this one, in the order
 * on screen, is added. With no last row (or one no longer shown) it picks
 * just this one.
 * @param {PickState} state
 * @param {string[]} orderedIds the rows' ids as they are on screen
 * @param {string} id
 */
export function pickRange(state, orderedIds, id) {
  const to = orderedIds.indexOf(id);
  const from = state.anchorId ? orderedIds.indexOf(state.anchorId) : -1;
  if (to < 0) return state;
  if (from < 0) return addPick(state, id);
  const ids = new Set(state.ids);
  const [start, end] = from <= to ? [from, to] : [to, from];
  for (let index = start; index <= end; index += 1) ids.add(orderedIds[index]);
  return { picking: true, ids, anchorId: id };
}

/**
 * "Pick the whole day": adds every row of the day; when all of them are
 * picked already, takes them all off again.
 * @param {PickState} state
 * @param {string[]} dayIds
 */
export function pickDay(state, dayIds) {
  if (!dayIds.length) return state;
  const ids = new Set(state.ids);
  const allPicked = dayIds.every((id) => ids.has(id));
  dayIds.forEach((id) => (allPicked ? ids.delete(id) : ids.add(id)));
  return { picking: true, ids, anchorId: dayIds.at(-1) ?? state.anchorId };
}

/** What a click on a row does: "range", "toggle", or "open" (the editor). */
export function rowClickIntent(state, { shiftKey = false, metaKey = false, ctrlKey = false } = {}) {
  if (shiftKey) return "range";
  if (metaKey || ctrlKey || state.picking) return "toggle";
  return "open";
}

/**
 * What the picked rows belong to: the month, view, scope and every Entries
 * filter in the URL. When it changes the rows on screen are others, so
 * picking ends. An open editor (`editing_entry`) is not part of it.
 * @param {URLSearchParams} searchParams
 */
export function pickScopeKey(searchParams) {
  return [...searchParams.entries()]
    .filter(([key]) => key === "view" || key === "month" || key === "entries_scope" || key.startsWith("entry_"))
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
}

/** The rows' ids in the order on screen (date groups, then rows). */
export function rowOrder(groupedEntries) {
  return groupedEntries.flatMap((group) => group.entries.map((entry) => entry.id));
}

/** The picked rows, in the order on screen; rows no longer shown drop out. */
export function pickedRows(groupedEntries, ids) {
  if (!ids.size) return [];
  return groupedEntries.flatMap((group) => group.entries.filter((entry) => ids.has(entry.id)));
}

/**
 * The bar's line: how many rows, their total as the rows show it (the
 * view's amounts), and whether there are too many for one change.
 */
export function summarizePick(rows, viewId) {
  const totalMinor = rows.reduce(
    (sum, entry) => sum + buildEntryRowDisplay(entry, viewId, Boolean(entry.linkedSplitExpenseId)).primarySignedAmountMinor,
    0
  );
  return { count: rows.length, totalMinor, tooMany: rows.length > PICK_MAX };
}

/**
 * The bulk category command's changes for the picked rows: each row's own
 * category is what it moves from. A transfer keeps its Transfer category, and
 * a row already in the chosen category has nothing to change.
 * @returns {{ changes: Array<{ entryId: string, fromCategoryName: string, categoryName: string }>, transfers: number }}
 */
export function categoryChangesFor(rows, categoryName) {
  const changes = [];
  let transfers = 0;
  for (const row of rows) {
    const entry = row.ledgerEntry ?? row;
    if (entry.entryType === "transfer") {
      transfers += 1;
      continue;
    }
    if (entry.categoryName === categoryName) continue;
    changes.push({ entryId: entry.id, fromCategoryName: entry.categoryName, categoryName });
  }
  return { changes, transfers };
}

/** Undo puts every row back in the category it came from. */
export function undoCategoryChanges(changes) {
  return changes.map((change) => ({ entryId: change.entryId, fromCategoryName: change.categoryName, categoryName: change.fromCategoryName }));
}

/** More than 10 rows need the person's "Yes, change all N" first. */
export function needsConfirm(count) {
  return count > BULK_RECATEGORISE_CONFIRM_ABOVE;
}

/**
 * The page's own keys (T, Esc) stay out of the way of typing and of an open
 * dialog, sheet, popover or menu: those keep their own keys.
 */
export function isPickKeyIgnored(event, doc = globalThis.document) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return true;
  const target = event.target;
  if (target && typeof target === "object") {
    const tag = String(target.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) return true;
  }
  return Boolean(doc?.querySelector?.('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]'));
}
