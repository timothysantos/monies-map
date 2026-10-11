// The request body every entry write posts (/api/entries/create and
// /api/entries/update), and the one create path for a new entry. Small and
// free of page state, so the Entries composer (entry-actions.js) and the
// Ask page's entry card (ask-api.js) save through the same code.

import { getTotalAmountMinor } from "./entry-helpers";

// The one create path for a new entry: POST /api/entries/create, then, when
// the draft asks for it, the linked split expense through
// /api/splits/expenses/from-entry. The Entries composer and the Ask page's
// entry card both save through it. "Add to splits" is a second workflow
// layered on top of entry creation: the row itself is valid even if the
// split-expense creation fails, so that failure comes back as splitAddError
// beside a created entry.
export async function createEntryFromDraft(entryDraft, { fetchImpl = fetch } = {}) {
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
  if (entryDraft.addToSplits && entryDraft.entryType === "expense") {
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

  return { ok: true, error: "", entryId: data.entryId, splitExpenseId, splitExpenseMonth, splitAddError };
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
    splitBasisPoints: primarySplit?.ratioBasisPoints
  };
}
