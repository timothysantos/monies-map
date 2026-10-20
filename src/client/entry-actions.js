import { useEffect, useMemo, useRef, useState } from "react";

import { moniesClient } from "./monies-client-service";
import { buildEntryMutationRefreshPlan, hasLedgerAffectingEntryChange } from "./entry-refresh-plan";
import { buildComparableEntryState, mergeEntriesById, withoutSplitLink } from "./entry-state";
import { buildPersistedEntryPayload, createEntryFromDraft } from "./entry-create-request";
import { buildRequestErrorMessage } from "./request-errors";
import { readSettlementLock, settlementLockUndoRequest } from "./settlement-lock-notice";

const { entries: entryService, categories: categoryService } = moniesClient;

// This hook is the Entries page "write side".
// It owns draft/edit state, optimistic updates, and the mutation calls that
// eventually rehydrate from the canonical server payload.

// Owns the local edit/draft state and server mutations for the entries page.
// The panel still owns filters and derived lists so this hook stays about edits.
export function useEntryActions({ view, accounts, categories, people, onRefresh, onSplitMutation, onEntryMutation }) {
  const [entries, setEntries] = useState(view.monthPage.entries);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [showEntryComposer, setShowEntryComposer] = useState(false);
  const [entryDraft, setEntryDraft] = useState(() => entryService.buildDraft(view, accounts, categories, people));
  const [entrySubmitError, setEntrySubmitError] = useState("");
  // The simplified settlement that refused the last entry save, if any.
  const [entrySettlementLock, setEntrySettlementLock] = useState(null);
  const [isUndoingEntrySettlementLock, setIsUndoingEntrySettlementLock] = useState(false);
  const [isSavingEntryDraft, setIsSavingEntryDraft] = useState(false);
  const [savingEntryId, setSavingEntryId] = useState(null);
  const [deletingEntryId, setDeletingEntryId] = useState(null);
  const [linkingTransferEntryId, setLinkingTransferEntryId] = useState(null);
  const [settlingTransferEntryId, setSettlingTransferEntryId] = useState(null);
  const [transferSettlementDrafts, setTransferSettlementDrafts] = useState({});
  const [transferDialogEntryId, setTransferDialogEntryId] = useState(null);
  const [refreshingTransferCandidatesEntryId, setRefreshingTransferCandidatesEntryId] = useState(null);
  const [transferCandidateOverrides, setTransferCandidateOverrides] = useState({});
  const [transferCandidateErrors, setTransferCandidateErrors] = useState({});
  const [addingToSplitsEntryId, setAddingToSplitsEntryId] = useState(null);
  const queuedComposerDraftRef = useRef(null);
  const deletedEntryIdsRef = useRef(new Set());
  const preferServerEntriesOnNextMergeRef = useRef(false);
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
    deletedEntryIdsRef.current.clear();
    preferServerEntriesOnNextMergeRef.current = false;
  }, [viewIdentityKey]);

  useEffect(() => {
    const queuedComposerDraft = queuedComposerDraftRef.current;
    queuedComposerDraftRef.current = null;

    // A view/month/scope change means the local editor state is no longer
    // trustworthy, so the hook resets to the fresh server-backed baseline.
    setEntries(mergeEntriesById([], view.monthPage.entries, null, deletedEntryIdsRef.current));
    setEditingEntryId(null);
    setEntrySnapshot(null);
    setShowEntryComposer(Boolean(queuedComposerDraft));
    setEntryDraft(entryService.normalize(
      mergeEntryDraftPatch(entryService.buildDraft(view, accounts, categories, people), queuedComposerDraft),
      people
    ));
    setEntrySubmitError("");
    setEntrySettlementLock(null);
    setIsSavingEntryDraft(false);
    setSavingEntryId(null);
    setDeletingEntryId(null);
    setLinkingTransferEntryId(null);
    setSettlingTransferEntryId(null);
    setTransferSettlementDrafts({});
    setTransferDialogEntryId(null);
    setRefreshingTransferCandidatesEntryId(null);
    setTransferCandidateOverrides({});
    setTransferCandidateErrors({});
    setAddingToSplitsEntryId(null);
  }, [viewIdentityKey]);

  useEffect(() => {
    if (editingEntryId) {
      preferServerEntriesOnNextMergeRef.current = false;
      return;
    }

    const preferServerEntries = preferServerEntriesOnNextMergeRef.current;
    preferServerEntriesOnNextMergeRef.current = false;
    setEntries((current) => mergeEntriesById(
      current,
      view.monthPage.entries,
      editingEntryId,
      deletedEntryIdsRef.current,
      { preferServerEntries }
    ));

    const serverEntryIds = new Set(view.monthPage.entries.map((entry) => entry.id));
    for (const deletedEntryId of deletedEntryIdsRef.current) {
      if (!serverEntryIds.has(deletedEntryId)) {
        deletedEntryIdsRef.current.delete(deletedEntryId);
      }
    }
  }, [editingEntryId, view.monthPage.entries]);

  function refreshEntriesInBackground() {
    void onRefresh();
  }

  async function refreshEntriesFromServerTruth() {
    preferServerEntriesOnNextMergeRef.current = true;
    try {
      // A refresh that failed or was superseded resolves to null and brings
      // no server truth, so the next unrelated merge must not prefer it.
      if (!(await onRefresh())) {
        preferServerEntriesOnNextMergeRef.current = false;
      }
    } catch (error) {
      preferServerEntriesOnNextMergeRef.current = false;
      throw error;
    }
  }

  // The composer can be launched directly from the page or seeded by a
  // quick-expense shortcut. In both cases it rebuilds from the current view.
  function openEntryComposer(initialPatch) {
    if (initialPatch) {
      queuedComposerDraftRef.current = initialPatch;
    }
    if (showEntryComposer) {
      if (initialPatch) {
        setEditingEntryId(null);
        setEntrySnapshot(null);
        setEntrySubmitError("");
        setEntryDraft(entryService.normalize(
          mergeEntryDraftPatch(entryService.buildDraft(view, accounts, categories, people), initialPatch),
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
    setEntryDraft(entryService.normalize(
      mergeEntryDraftPatch(entryService.buildDraft(view, accounts, categories, people), initialPatch),
      people
    ));
    setShowEntryComposer(true);
  }

  function closeEntryComposer() {
    setShowEntryComposer(false);
    setEntryDraft(entryService.buildDraft(view, accounts, categories, people));
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

      return entryService.normalize(nextDraft, people);
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
      splits: entryService.applySharedSplit(entryDraft, people, percentage),
      viewerSplitRatioBasisPoints: view.id === "household" ? undefined : Math.round(percentage * 100)
    });
  }

  async function persistExistingEntry(entryId, { closeEditor = undefined, patch = undefined, previousEntry = undefined } = {}) {
    if (!entryId) {
      return { ok: false };
    }

    const existingEntry = entries.find((entry) => entry.id === entryId);
    if (!existingEntry) {
      setEditingEntryId(null);
      setEntrySnapshot(null);
      return { ok: false };
    }
    const currentEntry = patch
      ? entryService.normalize({ ...existingEntry, ...withLinkedEntryTotal(existingEntry, patch) }, people, existingEntry)
      : existingEntry;

    const primarySplit = currentEntry.ownershipType === "shared" ? currentEntry.splits[0] : undefined;

    setEntrySubmitError("");
    setEntrySettlementLock(null);
    setSavingEntryId(entryId);
    try {
      const response = await fetch("/api/entries/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: currentEntry.id,
          ...buildPersistedEntryPayload(currentEntry, primarySplit)
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage = data.error ?? "Failed to save entry.";
        setEntrySubmitError(errorMessage);
        setEntrySettlementLock(readSettlementLock({ code: data.code, checkpointId: data.checkpointId, batchId: data.batchId, message: errorMessage }, currentEntry.id));
        return {
          ok: false,
          error: errorMessage
        };
      }

      const savedEntrySnapshot = {
        ...currentEntry,
        splits: currentEntry.splits.map((split) => ({ ...split }))
      };
      setEntries((current) => current.map((entry) => (
        entry.id === currentEntry.id
          ? {
              ...savedEntrySnapshot,
              isPendingDerived: true
            }
          : entry
      )));
      if (closeEditor) {
        setEditingEntryId(null);
        setEntrySnapshot(null);
      } else {
        setEntrySnapshot(savedEntrySnapshot);
      }
      const refreshPlan = buildEntryMutationRefreshPlan({
        kind: hasLedgerAffectingEntryChange(currentEntry, previousEntry ?? entrySnapshot ?? currentEntry)
          ? "entry-edit"
          : "note-only-edit",
        nextEntry: currentEntry,
        previousEntry: previousEntry ?? entrySnapshot ?? currentEntry
      });
      if (refreshPlan.invalidateEntries || refreshPlan.invalidateMonth || refreshPlan.invalidateSummary) {
        onEntryMutation?.({
          month: view.monthPage.month,
          invalidateEntries: refreshPlan.invalidateEntries,
          invalidateMonth: refreshPlan.invalidateMonth,
          invalidateSummary: refreshPlan.invalidateSummary
        });
      }
      if (refreshPlan.invalidateSplits) {
        onSplitMutation?.({ month: view.monthPage.month });
      }
      await onRefresh();
      return {
        ok: true,
        entry: savedEntrySnapshot
      };
    } finally {
      setSavingEntryId((current) => current === entryId ? null : current);
    }
  }

  // Undo the simplified settlement or group settle-up that refused an entry
  // save. The editor keeps the person's change, so saving again applies it
  // and the linked split follows. Splits reloads its now reopened activity.
  async function undoEntrySettlementLock() {
    const lock = entrySettlementLock;
    if (!lock || isUndoingEntrySettlementLock) {
      return;
    }

    const request = settlementLockUndoRequest(lock);
    setIsUndoingEntrySettlementLock(true);
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? request.failure);
      }
      setEntrySubmitError("");
      setEntrySettlementLock({ ...lock, undone: true });
      onSplitMutation?.({ month: view.monthPage.month });
    } catch (error) {
      setEntrySettlementLock({ ...lock, message: error instanceof Error ? error.message : request.failure });
    } finally {
      setIsUndoingEntrySettlementLock(false);
    }
  }

  async function saveEntryDraft() {
    if (isSavingEntryDraft) {
      return false;
    }

    setEntrySubmitError("");
    setIsSavingEntryDraft(true);
    try {
      const created = await createEntryFromDraft(entryDraft);
      if (!created.ok) {
        setEntrySubmitError(created.error);
        return false;
      }

      const { splitAddError, splitExpenseId: createdSplitExpenseId } = created;

      const optimisticEntry = entryService.normalize({
        ...entryDraft,
        id: created.entryId,
        linkedTransfer: undefined,
        linkedSplitExpenseId: createdSplitExpenseId,
        isPendingDerived: true
      }, people, entryDraft);
      setEntries((current) => [optimisticEntry, ...current]);
      onEntryMutation?.({
        month: view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
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

  function beginEntryEdit(row) {
    if (editingEntryId === row.id) {
      cancelEntryEdit();
      return;
    }

    // The snapshot is the listed entry itself: a row read for a person view
    // (a transfer with a purpose shown as spending) is not what is saved.
    const entry = entries.find((item) => item.id === row.id) ?? row;
    setShowEntryComposer(false);
    setEntrySubmitError("");
    setEditingEntryId(entry.id);
    setEntrySnapshot({ ...entry, splits: entry.splits.map((split) => ({ ...split })) });
  }

  // "What is this for?" on a transfer to someone in the household
  // (POST /api/transfers/purpose; null clears it). Saved at once, like the
  // row's category list; the entry keeps the answer while its editor is
  // open, and the views' figures refresh behind it.
  async function setTransferPurpose(row, categoryName) {
    const entry = entries.find((item) => item.id === row.id) ?? row;
    try {
      const response = await fetch("/api/transfers/purpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, categoryName: categoryName ?? null })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: data.error };
      }
      const transferPurpose = categoryName
        ? {
            categoryName,
            toPersonId: entry.transferPurpose?.toPersonId ?? "",
            toPersonName: entry.transferPurpose?.toPersonName ?? entry.linkedTransfer?.accountOwnerLabel ?? ""
          }
        : undefined;
      const withPurpose = (item) => {
        const next = { ...item, transferPurpose };
        if (!transferPurpose) {
          delete next.transferPurpose;
        }
        return next;
      };
      setEntries((current) => current.map((item) => (item.id === entry.id ? withPurpose(item) : item)));
      setEntrySnapshot((current) => (current?.id === entry.id ? withPurpose(current) : current));
      onEntryMutation?.({
        month: view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
      refreshEntriesInBackground();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // Reopens the editor on `draft`, an edited copy of one of these entries
  // kept while the person was on Ask (use-ask-origin.js). The snapshot is
  // the entry as saved now, so Close still discards the draft.
  function resumeEntryEdit(draft) {
    const saved = entries.find((entry) => entry.id === draft?.id);
    if (!saved) {
      return;
    }
    setShowEntryComposer(false);
    setEntrySubmitError("");
    setEditingEntryId(saved.id);
    setEntrySnapshot({ ...saved, splits: saved.splits.map((split) => ({ ...split })) });
    setEntries((current) => current.map((entry) => (entry.id === saved.id ? { ...saved, ...draft } : entry)));
  }

  async function finishEntryEdit(patch) {
    const result = await persistExistingEntry(editingEntryId, { closeEditor: true, patch });
    return result.ok;
  }

  // A category picked from a closed row's category list (design.md "Category
  // list"). It saves through the same command as the editor's "Save category"
  // (persistExistingEntry: one /api/entries/update, the same refresh plan with
  // the row as it was as the previous state, then the background refresh), so
  // the audit event, habit learning and rule suggestions are the editor's.
  // The list reads the answer: a refused save keeps it open with the message.
  // A row linked to Splits opens its editor with the new category instead, so
  // the connected split's own question is asked before anything is saved.
  async function changeEntryCategory(entry, categoryName) {
    if (!categoryName || categoryName === entry.categoryName) {
      return { ok: true };
    }
    // A person view shows a transfer with a purpose under its purpose:
    // choosing another category there changes what it is for.
    if (entry.transferPurpose?.role) {
      return setTransferPurpose(entry, categoryName);
    }
    const patch = categoryService.buildPatch(categories, categoryName);
    if (entry.linkedSplitExpenseId) {
      beginEntryEdit(entry);
      updateEntry(entry.id, patch);
      return { ok: true };
    }
    const result = await persistExistingEntry(entry.id, { patch, previousEntry: entry });
    if (result.ok) {
      return { ok: true };
    }
    setEntrySubmitError("");
    setEntrySettlementLock(null);
    return { ok: false, error: result.error };
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
    // The API stores transfers directionally as from -> to, but the editor can
    // be opened from either side of the pair.
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
      onEntryMutation?.({
        month: view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
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
    return transferCandidateOverrides[entry.id] ?? entryService.getTransferMatchCandidates(entry, entries);
  }

  function ensureTransferSettlementDraft(entry) {
    // Settlement reclassifies an already-linked transfer into real categories,
    // so we lazily seed draft choices the first time the dialog opens.
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
      onEntryMutation?.({
        month: view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
      refreshEntriesInBackground();
    } finally {
      setSettlingTransferEntryId(null);
    }
  }

  async function addEntryToSplits(entry, splitGroupId = null, splitBasisPoints = 5000) {
    setEntrySubmitError("");
    setAddingToSplitsEntryId(entry.id);

    try {
      const shouldPersistEditingChanges =
        editingEntryId === entry.id
        && entrySnapshot
        && JSON.stringify(buildComparableEntryState(entry))
          !== JSON.stringify(buildComparableEntryState(entrySnapshot));
      if (shouldPersistEditingChanges) {
        const saveResult = await persistExistingEntry(entry.id, { closeEditor: false });
        if (!saveResult.ok) {
          return saveResult;
        }
      }

      const response = await fetch("/api/splits/expenses/from-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: entry.id,
          splitGroupId,
          splitBasisPoints
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

        nextLinkedEntry = entryService.normalize({
          ...currentEntry,
          linkedSplitExpenseId: data.splitExpenseId,
          isPendingDerived: true
        }, people, currentEntry);
        return nextLinkedEntry;
      }));
      if (nextLinkedEntry) {
        setEntrySnapshot(nextLinkedEntry);
      }
      onSplitMutation?.({
        month: data.splitExpenseMonth ?? view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
      await onRefresh();
      return {
        ok: true,
        ...data
      };
    } finally {
      setAddingToSplitsEntryId(null);
    }
  }

  // After its split is deleted, an entry open in the editor (which ignores
  // server refreshes until it closes) shows the ledger amount and can be
  // added to splits again; the snapshot follows so Cancel keeps that. Only
  // the split fields change: a full normalize would also fill in an owner.
  function clearEntrySplitLink(entryId) {
    setEntries((current) => current.map((entry) => (
      entry.id === entryId ? withoutSplitLink(entry) : entry
    )));
    setEntrySnapshot((current) => (current?.id === entryId ? withoutSplitLink(current) : current));
  }

  function updateEntry(entryId, patch) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      return entryService.normalize({ ...entry, ...withLinkedEntryTotal(entry, patch) }, people, entry);
    }));
  }

  function updateEntryAmount(entryId, { amountMinor, amountInput }) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      if (view.id === "household" || entry.ownershipType !== "shared" || entry.splits.length < 2) {
        return entryService.normalize({ ...entry, ...withLinkedEntryTotal(entry, { amountMinor, amountInput }) }, people, entry);
      }

      const splitPercent = entryService.getVisibleSplitPercent(entry, view.id) ?? 50;
      const nextSplits = entryService.applySharedSplit({
        ...entry,
        totalAmountMinor: amountMinor
      }, people, splitPercent, view.id);
      const primaryIndex = entryService.getVisibleSplitIndex(entry, view.id);

      return {
        ...entry,
        amountMinor: nextSplits[primaryIndex]?.amountMinor ?? amountMinor,
        amountInput,
        totalAmountMinor: amountMinor,
        viewerSplitRatioBasisPoints: nextSplits[primaryIndex]?.ratioBasisPoints ?? entry.viewerSplitRatioBasisPoints,
        splits: nextSplits
      };
    }));
  }

  function updateEntrySplit(entryId, percentage) {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== entryId || entry.ownershipType !== "shared" || entry.splits.length < 2) {
        return entry;
      }

      const nextSplits = entryService.applySharedSplit(entry, people, percentage, view.id);
      const primaryIndex = entryService.getVisibleSplitIndex(entry, view.id);
      const totalAmountMinor = entryService.getTotalAmountMinor(entry);

      return {
        ...entry,
        amountMinor: view.id === "household" ? totalAmountMinor : nextSplits[primaryIndex].amountMinor,
        totalAmountMinor,
        viewerSplitRatioBasisPoints: view.id === "household" ? undefined : nextSplits[primaryIndex].ratioBasisPoints,
        splits: nextSplits
      };
    }));
  }

  async function deleteEntry(entry) {
    if (!entry?.id || deletingEntryId) {
      return { ok: false };
    }

    setEntrySubmitError("");
    setDeletingEntryId(entry.id);
    try {
      const response = await fetch("/api/entries/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: entry.id
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMessage = data.error ?? "Failed to delete entry.";
        setEntrySubmitError(errorMessage);
        return {
          ok: false,
          error: errorMessage
        };
      }

      deletedEntryIdsRef.current.add(entry.id);
      setEntries((current) => current.filter((currentEntry) => currentEntry.id !== entry.id));
      setEditingEntryId((current) => (current === entry.id ? null : current));
      setEntrySnapshot((current) => (current?.id === entry.id ? null : current));
      onEntryMutation?.({
        month: view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
      onSplitMutation?.({
        month: view.monthPage.month,
        invalidateEntries: true,
        invalidateMonth: true,
        invalidateSummary: true
      });
      refreshEntriesInBackground();
      return {
        ok: true,
        ...data
      };
    } finally {
      setDeletingEntryId((current) => current === entry.id ? null : current);
    }
  }

  return {
    entries,
    editingEntryId,
    entrySnapshot,
    hasEditingEntryChanges,
    showEntryComposer,
    entryDraft,
    entrySubmitError,
    entrySettlementLock,
    isUndoingEntrySettlementLock,
    undoEntrySettlementLock,
    isSavingEntryDraft,
    savingEntryId,
    deletingEntryId,
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
    resumeEntryEdit,
    finishEntryEdit,
    changeEntryCategory,
    setTransferPurpose,
    cancelEntryEdit,
    linkTransferCandidate,
    refreshTransferCandidates,
    getTransferCandidatesForEntry,
    ensureTransferSettlementDraft,
    updateTransferSettlementDraft,
    settleTransfer,
    refreshEntriesFromServerTruth,
    addEntryToSplits,
    clearEntrySplitLink,
    deleteEntry,
    updateEntry,
    updateEntryAmount,
    updateEntrySplit
  };
}

// The amount field of a split-linked entry edits the ledger total, even in a
// person view where the row's amountMinor is the viewer's share.
function withLinkedEntryTotal(entry, patch) {
  return entry.linkedSplitExpenseId && Object.prototype.hasOwnProperty.call(patch, "amountMinor")
    ? { ...patch, totalAmountMinor: patch.amountMinor }
    : patch;
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
    if (Number(patch.amountMinor) > 0) {
      delete nextDraft.amountInput;
    } else {
      // No amount in the link (a blank card): the field stays empty rather
      // than showing "0".
      nextDraft.amountInput = "";
    }
  }
  return nextDraft;
}
