import { useEffect, useMemo, useRef, useState } from "react";

import {
  applySharedSplit,
  buildEntryDraft,
  getVisibleSplitIndex,
  normalizeEntryShape
} from "./entry-helpers";
import { buildRequestErrorMessage } from "./request-errors";

// Owns the local edit/draft state and server mutations for the entries page.
// The panel still owns filters and derived lists so this hook stays about edits.
export function useEntryActions({ view, accounts, categories, people, onRefresh }) {
  const [entries, setEntries] = useState(view.monthPage.entries);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [showEntryComposer, setShowEntryComposer] = useState(false);
  const [entryDraft, setEntryDraft] = useState(() => buildEntryDraft(view, accounts, categories, people));
  const [entrySubmitError, setEntrySubmitError] = useState("");
  const [isSavingEntryDraft, setIsSavingEntryDraft] = useState(false);
  const [linkingTransferEntryId, setLinkingTransferEntryId] = useState(null);
  const [settlingTransferEntryId, setSettlingTransferEntryId] = useState(null);
  const [transferSettlementDrafts, setTransferSettlementDrafts] = useState({});
  const [transferDialogEntryId, setTransferDialogEntryId] = useState(null);
  const [addingToSplitsEntryId, setAddingToSplitsEntryId] = useState(null);
  const queuedComposerDraftRef = useRef(null);
  const activeEditingEntry = useMemo(
    () => editingEntryId ? entries.find((entry) => entry.id === editingEntryId) ?? null : null,
    [editingEntryId, entries]
  );
  const hasEditingEntryChanges = useMemo(() => {
    if (!activeEditingEntry || !entrySnapshot) {
      return false;
    }

    return JSON.stringify(buildComparableEntryState(activeEditingEntry))
      !== JSON.stringify(buildComparableEntryState(entrySnapshot));
  }, [activeEditingEntry, entrySnapshot]);

  useEffect(() => {
    const queuedComposerDraft = queuedComposerDraftRef.current;
    queuedComposerDraftRef.current = null;
    setEntries(view.monthPage.entries);
    setEditingEntryId(null);
    setEntrySnapshot(null);
    setShowEntryComposer(Boolean(queuedComposerDraft));
    setEntryDraft(normalizeEntryShape(
      mergeEntryDraftPatch(buildEntryDraft(view, accounts, categories, people), queuedComposerDraft),
      people
    ));
    setEntrySubmitError("");
    setIsSavingEntryDraft(false);
    setLinkingTransferEntryId(null);
    setSettlingTransferEntryId(null);
    setTransferSettlementDrafts({});
    setTransferDialogEntryId(null);
    setAddingToSplitsEntryId(null);
  }, [view, accounts, categories, people]);

  function openEntryComposer(initialPatch) {
    if (initialPatch) {
      queuedComposerDraftRef.current = initialPatch;
    }
    if (showEntryComposer) {
      if (initialPatch) {
        setEditingEntryId(null);
        setEntrySnapshot(null);
        setEntrySubmitError("");
        setEntryDraft(normalizeEntryShape(
          mergeEntryDraftPatch(buildEntryDraft(view, accounts, categories, people), initialPatch),
          people
        ));
        setShowEntryComposer(true);
        return;
      }
      closeEntryComposer();
      return;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
    setEntrySubmitError("");
    setEntryDraft(normalizeEntryShape(
      mergeEntryDraftPatch(buildEntryDraft(view, accounts, categories, people), initialPatch),
      people
    ));
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
    if (isSavingEntryDraft) {
      return false;
    }

    setEntrySubmitError("");
    const primarySplit = entryDraft.ownershipType === "shared" ? entryDraft.splits[0] : undefined;
    setIsSavingEntryDraft(true);
    try {
      const response = await fetch("/api/entries/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          date: entryDraft.date,
          description: entryDraft.description,
          accountId: entryDraft.accountId,
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
        return false;
      }

      queuedComposerDraftRef.current = null;
      closeEntryComposer();
      await onRefresh();
      return true;
    } finally {
      setIsSavingEntryDraft(false);
    }
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
      return false;
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
        accountId: currentEntry.accountId,
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
      return false;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
    await onRefresh();
    return true;
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
      throw new Error(await buildRequestErrorMessage(response, "Failed to save category."));
    }

    setEntrySnapshot((current) => current && current.id === entryId
      ? { ...current, categoryName }
      : current
    );
    await onRefresh();
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

  async function addEntryToSplits(entry, splitGroupId = null) {
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
          splitGroupId
        })
      });
      const data = await response.json();
      if (!response.ok) {
        const errorMessage = data.error ?? "Failed to add entry to splits.";
        setEntrySubmitError(errorMessage);
        return {
          ok: false,
          error: errorMessage,
          alreadyLinked: errorMessage === "This entry is already linked to a split expense."
        };
      }

      let nextLinkedEntry = null;
      setEntries((current) => current.map((currentEntry) => {
        if (currentEntry.id !== entry.id) {
          return currentEntry;
        }

        nextLinkedEntry = normalizeEntryShape({
          ...currentEntry,
          ownershipType: "shared",
          ownerName: undefined,
          linkedSplitExpenseId: data.splitExpenseId
        }, people, currentEntry);
        return nextLinkedEntry;
      }));
      if (nextLinkedEntry) {
        setEntrySnapshot(nextLinkedEntry);
      }
      return {
        ok: true,
        ...data
      };
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
    hasEditingEntryChanges,
    showEntryComposer,
    entryDraft,
    entrySubmitError,
    isSavingEntryDraft,
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

function buildComparableEntryState(entry) {
  return {
    date: entry.date,
    description: entry.description,
    accountId: entry.accountId ?? null,
    accountName: entry.accountName ?? "",
    categoryName: entry.categoryName,
    amountMinor: Number(entry.amountMinor ?? 0),
    entryType: entry.entryType,
    transferDirection: entry.transferDirection ?? null,
    ownershipType: entry.ownershipType,
    ownerName: entry.ownerName ?? null,
    note: entry.note ?? "",
    splitBasisPoints: entry.ownershipType === "shared"
      ? Number(entry.splits?.[0]?.ratioBasisPoints ?? 5000)
      : null
  };
}

function mergeEntryDraftPatch(baseDraft, patch) {
  if (!patch) {
    return baseDraft;
  }

  const nextDraft = { ...baseDraft, ...patch };
  if (
    Object.prototype.hasOwnProperty.call(patch, "amountMinor")
    && !Object.prototype.hasOwnProperty.call(patch, "amountInput")
  ) {
    delete nextDraft.amountInput;
  }
  return nextDraft;
}
