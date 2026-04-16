import { useEffect, useState } from "react";

import {
  applySharedSplit,
  buildEntryDraft,
  getVisibleSplitIndex,
  normalizeEntryShape
} from "./entry-helpers";

// Owns the local edit/draft state and server mutations for the entries page.
// The panel still owns filters and derived lists so this hook stays about edits.
export function useEntryActions({ view, accounts, categories, people, onRefresh }) {
  const [entries, setEntries] = useState(view.monthPage.entries);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [showEntryComposer, setShowEntryComposer] = useState(false);
  const [entryDraft, setEntryDraft] = useState(() => buildEntryDraft(view, accounts, categories, people));
  const [entrySubmitError, setEntrySubmitError] = useState("");
  const [linkingTransferEntryId, setLinkingTransferEntryId] = useState(null);
  const [settlingTransferEntryId, setSettlingTransferEntryId] = useState(null);
  const [transferSettlementDrafts, setTransferSettlementDrafts] = useState({});
  const [transferDialogEntryId, setTransferDialogEntryId] = useState(null);
  const [addingToSplitsEntryId, setAddingToSplitsEntryId] = useState(null);

  useEffect(() => {
    setEntries(view.monthPage.entries);
    setEditingEntryId(null);
    setEntrySnapshot(null);
    setShowEntryComposer(false);
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
    setEntrySubmitError("");
    setLinkingTransferEntryId(null);
    setSettlingTransferEntryId(null);
    setTransferSettlementDrafts({});
    setTransferDialogEntryId(null);
    setAddingToSplitsEntryId(null);
  }, [view, accounts, categories, people]);

  function openEntryComposer() {
    if (showEntryComposer) {
      closeEntryComposer();
      return;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
    setEntrySubmitError("");
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
    setShowEntryComposer(true);
  }

  function closeEntryComposer() {
    setShowEntryComposer(false);
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
    setEntrySubmitError("");
  }

  function updateEntryDraft(patch) {
    setEntryDraft((current) => normalizeEntryShape({ ...current, ...patch }, people));
  }

  function updateEntryDraftOwner(nextValue) {
    if (nextValue === "Shared") {
      updateEntryDraft({ ownershipType: "shared", ownerName: undefined });
      return;
    }

    updateEntryDraft({ ownershipType: "direct", ownerName: nextValue });
  }

  function updateEntryDraftSplit(percentage) {
    updateEntryDraft({
      splits: applySharedSplit(entryDraft, people, percentage),
      viewerSplitRatioBasisPoints: view.id === "household" ? undefined : Math.round(percentage * 100)
    });
  }

  async function saveEntryDraft() {
    setEntrySubmitError("");
    const primarySplit = entryDraft.ownershipType === "shared" ? entryDraft.splits[0] : undefined;
    const response = await fetch("/api/entries/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        date: entryDraft.date,
        description: entryDraft.description,
        accountName: entryDraft.accountName,
        categoryName: entryDraft.categoryName,
        amountMinor: entryDraft.amountMinor,
        entryType: entryDraft.entryType,
        transferDirection: entryDraft.transferDirection,
        ownershipType: entryDraft.ownershipType,
        ownerName: entryDraft.ownerName,
        note: entryDraft.note ?? "",
        splitBasisPoints: primarySplit?.ratioBasisPoints
      })
    });

    const data = await response.json();
    if (!response.ok) {
      setEntrySubmitError(data.error ?? "Failed to create entry.");
      return;
    }

    closeEntryComposer();
    await onRefresh();
  }

  function beginEntryEdit(entry) {
    if (editingEntryId === entry.id) {
      cancelEntryEdit();
      return;
    }

    setShowEntryComposer(false);
    setEntrySubmitError("");
    setEditingEntryId(entry.id);
    setEntrySnapshot({ ...entry, splits: entry.splits.map((split) => ({ ...split })) });
  }

  async function finishEntryEdit() {
    const currentEntry = entries.find((entry) => entry.id === editingEntryId);
    if (!currentEntry) {
      setEditingEntryId(null);
      setEntrySnapshot(null);
      return;
    }

    const primarySplit = currentEntry.ownershipType === "shared" ? currentEntry.splits[0] : undefined;

    const response = await fetch("/api/entries/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entryId: currentEntry.id,
        date: currentEntry.date,
        description: currentEntry.description,
        accountName: currentEntry.accountName,
        categoryName: currentEntry.categoryName,
        amountMinor: currentEntry.amountMinor,
        entryType: currentEntry.entryType,
        transferDirection: currentEntry.transferDirection,
        ownershipType: currentEntry.ownershipType,
        ownerName: currentEntry.ownerName,
        note: currentEntry.note ?? "",
        splitBasisPoints: primarySplit?.ratioBasisPoints
      })
    });

    if (!response.ok) {
      return;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
    await onRefresh();
  }

  async function saveEntryCategory(entryId, categoryName) {
    const currentEntry = entries.find((entry) => entry.id === entryId);
    if (!currentEntry) {
      return;
    }

    const response = await fetch("/api/entries/update-classification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entryId: currentEntry.id,
        entryType: currentEntry.entryType,
        transferDirection: currentEntry.transferDirection,
        categoryName
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to save category.");
    }

    setEntrySnapshot((current) => current && current.id === entryId
      ? { ...current, categoryName }
      : current
    );
  }

  function cancelEntryEdit() {
    if (!entrySnapshot) {
      setEditingEntryId(null);
      return;
    }

    setEntries((current) => current.map((entry) => (
      entry.id === entrySnapshot.id ? entrySnapshot : entry
    )));
    setEditingEntryId(null);
    setEntrySnapshot(null);
  }

  async function linkTransferCandidate(entry, candidate) {
    const fromEntryId = entry.transferDirection === "in" ? candidate.id : entry.id;
    const toEntryId = entry.transferDirection === "in" ? entry.id : candidate.id;
    setLinkingTransferEntryId(entry.id);

    try {
      const response = await fetch("/api/transfers/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fromEntryId,
          toEntryId
        })
      });

      if (!response.ok) {
        return;
      }

      setTransferDialogEntryId(null);
      setEditingEntryId(null);
      setEntrySnapshot(null);
      await onRefresh();
    } finally {
      setLinkingTransferEntryId(null);
    }
  }

  function ensureTransferSettlementDraft(entry) {
    setTransferSettlementDrafts((current) => {
      if (current[entry.id]) {
        return current;
      }

      return {
        ...current,
        [entry.id]: {
          currentCategoryName: "Other",
          counterpartCategoryName: "Other"
        }
      };
    });
  }

  function updateTransferSettlementDraft(entryId, patch) {
    setTransferSettlementDrafts((current) => ({
      ...current,
      [entryId]: {
        currentCategoryName: current[entryId]?.currentCategoryName ?? "Other",
        counterpartCategoryName: current[entryId]?.counterpartCategoryName ?? "Other",
        ...patch
      }
    }));
  }

  async function settleTransfer(entry) {
    const draft = transferSettlementDrafts[entry.id] ?? {
      currentCategoryName: "Other",
      counterpartCategoryName: "Other"
    };
    setSettlingTransferEntryId(entry.id);

    try {
      const response = await fetch("/api/transfers/settle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: entry.id,
          counterpartEntryId: entry.linkedTransfer?.transactionId,
          currentCategoryName: draft.currentCategoryName,
          counterpartCategoryName: draft.counterpartCategoryName
        })
      });

      if (!response.ok) {
        return;
      }

      setTransferDialogEntryId(null);
      setEditingEntryId(null);
      setEntrySnapshot(null);
      await onRefresh();
    } finally {
      setSettlingTransferEntryId(null);
    }
  }

  async function addEntryToSplits(entry) {
    setEntrySubmitError("");
    setAddingToSplitsEntryId(entry.id);

    try {
      const response = await fetch("/api/splits/expenses/from-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: entry.id,
          splitGroupId: null
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setEntrySubmitError(data.error ?? "Failed to add entry to splits.");
        return;
      }

      setEditingEntryId(null);
      setEntrySnapshot(null);
      await onRefresh();
    } finally {
      setAddingToSplitsEntryId(null);
    }
  }

  function updateEntry(entryId, patch) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      return normalizeEntryShape({ ...entry, ...patch }, people, entry);
    }));
  }

  function updateEntrySplit(entryId, percentage) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId || entry.ownershipType !== "shared" || entry.splits.length < 2) {
        return entry;
      }

      const nextSplits = applySharedSplit(entry, people, percentage, view.id);
      const primaryIndex = getVisibleSplitIndex(entry, view.id);
      const totalAmountMinor = entry.totalAmountMinor ?? entry.amountMinor;

      return {
        ...entry,
        amountMinor: view.id === "household" ? totalAmountMinor : nextSplits[primaryIndex].amountMinor,
        totalAmountMinor,
        viewerSplitRatioBasisPoints: view.id === "household" ? undefined : nextSplits[primaryIndex].ratioBasisPoints,
        splits: nextSplits
      };
    }));
  }

  return {
    entries,
    editingEntryId,
    showEntryComposer,
    entryDraft,
    entrySubmitError,
    linkingTransferEntryId,
    settlingTransferEntryId,
    transferSettlementDrafts,
    transferDialogEntryId,
    addingToSplitsEntryId,
    setTransferDialogEntryId,
    openEntryComposer,
    closeEntryComposer,
    updateEntryDraft,
    updateEntryDraftOwner,
    updateEntryDraftSplit,
    saveEntryDraft,
    beginEntryEdit,
    finishEntryEdit,
    cancelEntryEdit,
    linkTransferCandidate,
    ensureTransferSettlementDraft,
    updateTransferSettlementDraft,
    settleTransfer,
    addEntryToSplits,
    updateEntry,
    updateEntrySplit,
    saveEntryCategory
  };
}
