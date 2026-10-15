// The request body every entry write posts (/api/entries/create and
// /api/entries/update), and the one create path for a new entry. Small and
// free of page state, so the Entries composer (entry-actions.js) and the
// Ask page's entry card (ask-api.js) save through the same code.

import { getTotalAmountMinor } from "./entry-helpers";
import { ENTRY_DESCRIPTION_MAX, ENTRY_NOTE_MAX, entryTextOverLimit } from "./input-limits";
import { limitsCopy } from "./copy/limits-copy";

// The one create path for a new entry: POST /api/entries/create, then, when
// the draft asks for it, the linked split expense through
// /api/splits/expenses/from-entry. The Entries composer and the Ask page's
// entry card both save through it. "Add to splits" is a second workflow
// layered on top of entry creation: the row itself is valid even if the
// split-expense creation fails, so that failure comes back as splitAddError
// beside a created entry.
//
// A draft with an externalReference (the Ask card's stable client id) can
// be sent again safely: the route returns the entry it already made
// (created: false) with the split linked to it, so a repeat never adds a
// second entry or a second split.
export async function createEntryFromDraft(entryDraft, { fetchImpl = fetch } = {}) {
  // Past the route's text caps the create would be refused: say so in plain
  // words without sending it.
  const tooLong = entryTextOverLimit(entryDraft);
  if (tooLong) {
    const error = tooLong === "note" ? limitsCopy.noteTooLong(ENTRY_NOTE_MAX) : limitsCopy.descriptionTooLong(ENTRY_DESCRIPTION_MAX);
    return { ok: false, error, entryId: null, splitExpenseId: null, splitExpenseMonth: null, splitAddError: "" };
  }
  const primarySplit = entryDraft.ownershipType === "shared" ? entryDraft.splits?.[0] : undefined;
  const response = await fetchImpl("/api/entries/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildPersistedEntryPayload(entryDraft, primarySplit))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: data.error ?? "Failed to create entry.", entryId: null, splitExpenseId: null, splitExpenseMonth: null, splitAddError: "" };
  }

  let splitAddError = "";
  let splitExpenseId = null;
  let splitExpenseMonth = null;
  if (data.created === false && data.linkedSplitExpenseId) {
    splitExpenseId = data.linkedSplitExpenseId;
    splitExpenseMonth = data.linkedSplitExpenseMonth ?? null;
  } else if (entryDraft.addToSplits && entryDraft.entryType === "expense") {
    const splitResponse = await fetchImpl("/api/splits/expenses/from-entry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entryId: data.entryId,
        splitGroupId: entryDraft.splitGroupId === "split-group-none"
          ? null
          : (entryDraft.splitGroupId || null)
      })
    });
    const splitData = await splitResponse.json().catch(() => ({}));
    if (!splitResponse.ok) {
      splitAddError = splitData.error ?? "Entry was created, but adding it to splits failed.";
    } else {
      splitExpenseId = splitData.splitExpenseId ?? null;
      splitExpenseMonth = splitData.splitExpenseMonth ?? null;
    }
  }

  return { ok: true, error: "", entryId: data.entryId, splitExpenseId, splitExpenseMonth, splitAddError, time: data.time ?? null };
}

export function buildPersistedEntryPayload(entry, primarySplit) {
  return {
    date: entry.date,
    postDate: entry.postDate ?? null,
    description: entry.description,
    accountId: entry.accountId,
    accountName: entry.accountName,
    categoryName: entry.categoryName,
    amountMinor: entry.ownershipType === "shared" || entry.linkedSplitExpenseId
      ? getTotalAmountMinor(entry)
      : entry.amountMinor,
    entryType: entry.entryType,
    transferDirection: entry.transferDirection,
    ownershipType: entry.ownershipType,
    ownerName: entry.ownerName,
    note: entry.note ?? "",
    splitBasisPoints: primarySplit?.ratioBasisPoints,
    externalReference: entry.externalReference || undefined,
    // Left out when the entry has no time field (the server then keeps the
    // stored time, or on a new entry uses now for today); "" clears it.
    time: entry.time === undefined ? undefined : (entry.time || null)
  };
}
