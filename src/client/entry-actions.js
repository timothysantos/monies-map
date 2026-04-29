import { useEffect, useMemo, useRef, useState } from "react";

import {
  applySharedSplit,
  buildEntryDraft,
  getTransferMatchCandidates,
  getVisibleSplitIndex,
  normalizeEntryShape
} from "./entry-helpers";
import { buildRequestErrorMessage } from "./request-errors";

function mergeEntriesById(currentEntries, serverEntries, editingEntryId) {
  const currentById = new Map(currentEntries.map((entry) => [entry.id, entry]));
  const serverIds = new Set(serverEntries.map((entry) => entry.id));
  const localTransientEntries = currentEntries.filter((entry) => entry.isPendingDerived && !serverIds.has(entry.id));

  return [
    ...localTransientEntries,
    ...serverEntries.map((serverEntry) => {
      const currentEntry = currentById.get(serverEntry.id);
      if (!currentEntry) {
        return serverEntry;
      }

      if (serverEntry.id === editingEntryId) {
        return {
          ...currentEntry,
          linkedTransfer: serverEntry.linkedTransfer,
          linkedSplitExpenseId: serverEntry.linkedSplitExpenseId,
          isPendingDerived: false
        };
      }

      return {
        ...currentEntry,
        ...serverEntry,
        isPendingDerived: false
      };
    })
  ];
}

// Owns the local edit/draft state and server mutations for the entries page.
// The panel still owns filters and derived lists so this hook stays about edits.
export function useEntryActions({ view, accounts, categories, people, onRefresh, onSplitMutation }) {
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
  const [refreshingTransferCandidatesEntryId, setRefreshingTransferCandidatesEntryId] = useState(null);
  const [transferCandidateOverrides, setTransferCandidateOverrides] = useState({});
  const [transferCandidateErrors, setTransferCandidateErrors] = useState({});
  const [addingToSplitsEntryId, setAddingToSplitsEntryId] = useState(null);
  const queuedComposerDraftRef = useRef(null);
  const viewIdentityKey = `${view.id}:${view.monthPage.month}:${view.monthPage.selectedScope}`;
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
    setRefreshingTransferCandidatesEntryId(null);
    setTransferCandidateOverrides({});
    setTransferCandidateErrors({});
    setAddingToSplitsEntryId(null);
  }, [accounts, categories, people, viewIdentityKey]);

  useEffect(() => {
    setEntries((current) => mergeEntriesById(current, view.monthPage.entries, editingEntryId));
  }, [editingEntryId, view.monthPage.entries]);

  function refreshEntriesInBackground() {
    void onRefresh();
  }

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
    setEntryDraft((current) => {
      const nextDraft = { ...current, ...patch };
      if (nextDraft.entryType !== "expense") {
        nextDraft.addToSplits = false;
        nextDraft.splitGroupId = "";
      } else if (!nextDraft.addToSplits) {
        nextDraft.splitGroupId = "";
      }

      return normalizeEntryShape(nextDraft, people);
    });
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

      let splitAddError = "";
      let createdSplitExpenseId = null;
      if (entryDraft.addToSplits && entryDraft.entryType === "expense") {
        const splitResponse = await fetch("/api/splits/expenses/from-entry", {
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

        if (!splitResponse.ok) {
          const splitData = await splitResponse.json().catch(() => ({}));
          splitAddError = splitData.error ?? "Entry was created, but adding it to splits failed.";
        } else {
          const splitData = await splitResponse.json().catch(() => ({}));
          createdSplitExpenseId = splitData.splitExpenseId ?? null;
        }
      }

      const optimisticEntry = normalizeEntryShape({
        ...entryDraft,
        id: data.entryId,
        linkedTransfer: undefined,
        linkedSplitExpenseId: createdSplitExpenseId,
        isPendingDerived: true
      }, people, entryDraft);
      setEntries((current) => [optimisticEntry, ...current]);
      queuedComposerDraftRef.current = null;
      closeEntryComposer();
      if (createdSplitExpenseId) {
        onSplitMutation?.({
          month: view.monthPage.month,
          invalidateEntries: true,
          invalidateMonth: true,
          invalidateSummary: true
        });
      }
      refreshEntriesInBackground();
      return {
        saved: true,
        splitAddError
      };
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

    setEntries((current) => current.map((entry) => (
      entry.id === currentEntry.id
        ? {
            ...currentEntry,
            isPendingDerived: true
          }
        : entry
    )));
    setEditingEntryId(null);
    setEntrySnapshot(null);
    refreshEntriesInBackground();
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
    setEntries((current) => current.map((entry) => (
      entry.id === entryId
        ? {
            ...entry,
            categoryName,
            isPendingDerived: true
          }
        : entry
    )));
    refreshEntriesInBackground();
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
      setEntries((current) => current.map((currentEntry) => (
        currentEntry.id === entry.id || currentEntry.id === candidate.id
          ? { ...currentEntry, isPendingDerived: true }
          : currentEntry
      )));
      setEditingEntryId(null);
      setEntrySnapshot(null);
      refreshEntriesInBackground();
      setTransferCandidateOverrides((current) => {
        if (!current[entry.id]) {
          return current;
        }
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
    } finally {
      setLinkingTransferEntryId(null);
    }
  }

  async function refreshTransferCandidates(entry) {
    setRefreshingTransferCandidatesEntryId(entry.id);
    setTransferCandidateErrors((current) => {
      if (!current[entry.id]) {
        return current;
      }
      const next = { ...current };
      delete next[entry.id];
      return next;
    });

    try {
      const response = await fetch(`/api/transfers/candidates?entryId=${encodeURIComponent(entry.id)}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, "Failed to refresh transfer matches."));
      }

      const data = await response.json();
      setTransferCandidateOverrides((current) => ({
        ...current,
        [entry.id]: Array.isArray(data.candidates) ? data.candidates : []
      }));
    } catch (error) {
      setTransferCandidateErrors((current) => ({
        ...current,
        [entry.id]: error instanceof Error ? error.message : "Failed to refresh transfer matches."
      }));
    } finally {
      setRefreshingTransferCandidatesEntryId((current) => current === entry.id ? null : current);
    }
  }

  function getTransferCandidatesForEntry(entry) {
    return transferCandidateOverrides[entry.id] ?? getTransferMatchCandidates(entry, entries);
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
      setEntries((current) => current.map((currentEntry) => (
        currentEntry.id === entry.id
          ? { ...currentEntry, isPendingDerived: true }
          : currentEntry
      )));
      setEditingEntryId(null);
      setEntrySnapshot(null);
      refreshEntriesInBackground();
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
      onSplitMutation?.({
        month: view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
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
    refreshingTransferCandidatesEntryId,
    transferCandidateErrors,
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
    refreshTransferCandidates,
    getTransferCandidatesForEntry,
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
