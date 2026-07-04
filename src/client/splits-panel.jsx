import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { LinkedNoteSyncDialog } from "./linked-note-sync-dialog";
import {
  useSplitEditState,
  validateSplitExpenseDraft,
  validateSplitSettlementDraft
} from "./split-editing";
import {
  createSplitGroup,
  deleteSplitExpense,
  deleteSplitSettlement,
  linkSplitMatch,
  saveSplitExpense,
  saveSplitSettlement,
  updateLinkedEntryNote
} from "./splits-api";
import {
  applyOptimisticSplitMatch,
  buildOptimisticExpenseActivityItem,
  buildOptimisticSettlementActivityItem,
  removeOptimisticSplitActivity,
  upsertOptimisticSplitActivity
} from "./splits-optimistic";
import { SplitArchiveDialog } from "./splits-archive-dialog";
import { splitActivityDomId } from "./splits-activity";
import { SplitDeleteDialog, SplitExpenseDialog, SplitGroupDialog, SplitSettlementDialog } from "./splits-dialogs";
import { SplitsMainSection } from "./splits-main-section";
import { buildSplitsPanelModel } from "./splits-selectors";
import {
  buildLinkedSplitRefreshOptions,
  createSplitRefreshGuard
} from "./splits-workflow";

export function SplitsPanel({ view, categories, people, onRefresh }) {
  const splitsPage = view.splitsPage ?? {
    groups: [],
    activity: [],
    matches: [],
    donutChart: [],
    month: view.monthPage?.month ?? ""
  };
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [useMobileSplitSheet, setUseMobileSplitSheet] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [splitNoteSyncPrompt, setSplitNoteSyncPrompt] = useState(null);
  const [isSyncingSplitNote, setIsSyncingSplitNote] = useState(false);
  const [isRefreshingDerived, setIsRefreshingDerived] = useState(false);
  const [optimisticSplitsPage, setOptimisticSplitsPage] = useState(null);
  const [dismissedMatchIds, setDismissedMatchIds] = useState([]);
  const refreshGuardRef = useRef(null);
  const latestSplitsPageRef = useRef(splitsPage);
  const returnToSplitIdRef = useRef("");
  const defaultGroupId = splitsPage.groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const selectedGroupParam = searchParams.get("split_group");
  const selectedGroupId = selectedGroupParam ?? defaultGroupId;
  const selectedMode = searchParams.get("split_mode") ?? "entries";
  const isHouseholdView = view.id === "household";
  const displayView = useMemo(
    () => (optimisticSplitsPage ? { ...view, splitsPage: optimisticSplitsPage } : { ...view, splitsPage }),
    [optimisticSplitsPage, splitsPage, view]
  );
  const splitModel = useMemo(
    () => buildSplitsPanelModel({
      view: displayView,
      categories,
      selectedGroupId,
      dismissedMatchIds,
      archiveBatchId: archiveDialog?.batchId
    }),
    [archiveDialog?.batchId, categories, dismissedMatchIds, displayView, selectedGroupId]
  );
  const {
    activeGroup,
    archivedBatches,
    categoryOptions,
    donutRows,
    groupedCurrentActivity,
    groupBalanceMinor,
    groups,
    groupOptions,
    groupSummaryLabel,
    pendingMatchCount,
    selectedArchivedBatch,
    totalExpenseMinor,
    visibleMatches
  } = splitModel;
  const {
    expenseDialog,
    settlementDialog,
    inlineSplitDraft,
    expenseDialogSnapshot,
    settlementDialogSnapshot,
    inlineSplitDraftSnapshot,
    inlineSplitError,
    deleteTarget,
    formError,
    hasExpenseDialogChanges,
    hasSettlementDialogChanges,
    hasInlineSplitChanges,
    setExpenseDialog,
    setSettlementDialog,
    setInlineSplitDraft,
    setInlineSplitError,
    setDeleteTarget,
    setFormError,
    openExpenseEditor,
    openSettlementEditor,
    openInlineExpenseEditor,
    openInlineSettlementEditor,
    openNewExpenseDialog,
    openNewSettlementDialog,
    closeExpenseDialog,
    closeSettlementDialog,
    clearInlineSplitDraft,
    resetForViewChange,
    requestDeleteSplit,
    clearExpenseDialogSnapshot,
    clearSettlementDialogSnapshot,
    clearInlineSplitSnapshot
  } = useSplitEditState({ categoryOptions, people });

  useEffect(() => {
    refreshGuardRef.current = refreshGuardRef.current ?? createSplitRefreshGuard();
    latestSplitsPageRef.current = splitsPage;
  }, [splitsPage]);

  useEffect(() => {
    // Keep the URL explicit once the default group is known so refreshes and
    // deep links reopen the same split workspace.
    if (selectedGroupParam || selectedMode === "matches" || selectedGroupId === defaultGroupId) {
      return;
    }

    updateSplitView({ groupId: defaultGroupId, mode: "entries" });
  }, [defaultGroupId, selectedGroupId, selectedGroupParam, selectedMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const update = () => setUseMobileSplitSheet(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    setDismissedMatchIds([]);
    setShowBreakdown(false);
    setOptimisticSplitsPage(null);
    setIsRefreshingDerived(false);
    refreshGuardRef.current = createSplitRefreshGuard();
    resetForViewChange();
    setArchiveDialog(null);
  }, [resetForViewChange, splitsPage.month, view.id]);

  useEffect(() => {
    if (!useMobileSplitSheet) {
      return;
    }

    clearInlineSplitDraft();
  }, [clearInlineSplitDraft, useMobileSplitSheet]);

  useEffect(() => {
    const targetSplitExpenseId = searchParams.get("editing_split_expense");
    if (!targetSplitExpenseId) {
      return;
    }

    const targetExpense = splitsPage.activity.find((item) => (
      item.kind === "expense" && item.id === targetSplitExpenseId && !item.isArchived
    ));
    if (!targetExpense) {
      return;
    }

    const targetGroupId = targetExpense.groupId ?? "split-group-none";
    if (selectedMode !== "entries" || selectedGroupId !== targetGroupId) {
      updateSplitView({ groupId: targetGroupId, mode: "entries" });
      return;
    }

    if (expenseDialog?.id === targetSplitExpenseId) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("editing_split_expense");
        return next;
      }, { replace: true });
      return;
    }

    returnToSplitIdRef.current = targetSplitExpenseId;
    openExpenseEditor(targetExpense);
  }, [
    expenseDialog?.id,
    searchParams,
    selectedGroupId,
    selectedMode,
    setSearchParams,
    splitsPage.activity
  ]);

  function scrollBackToSplitCard(splitExpenseId) {
    if (!splitExpenseId || typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      const element = document.getElementById(splitActivityDomId("expense", splitExpenseId));
      if (!element) {
        return;
      }

      element.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function closeExpenseDialogAndReturn() {
    const returnToSplitId = returnToSplitIdRef.current || expenseDialog?.id || "";
    closeExpenseDialog();
    returnToSplitIdRef.current = "";
    scrollBackToSplitCard(returnToSplitId);
  }

  function updateSplitView(patch) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (patch.groupId) {
        next.set("split_group", patch.groupId);
      }
      if (patch.mode) {
        next.set("split_mode", patch.mode);
      }
      return next;
    });
  }

  function openArchiveList() {
    setArchiveDialog({ batchId: null });
  }

  function openArchivedBatch(batchId) {
    setArchiveDialog({ batchId });
  }

  function applyOptimisticSplitsPage(updatePage) {
    setOptimisticSplitsPage((currentPage) => updatePage(currentPage ?? latestSplitsPageRef.current));
  }

  function refreshAfterSplitMutation(options) {
    // Split saves update the local activity list immediately, then ask the
    // server to recompute any downstream data that depends on ledger ownership
    // or linked entries. The generation guard prevents older refreshes from
    // clobbering newer optimistic edits.
    const refreshGeneration = refreshGuardRef.current?.next() ?? 1;
    setIsRefreshingDerived(true);

    void onRefresh(options)
      .then(() => {
        if (refreshGuardRef.current?.isCurrent(refreshGeneration)) {
          setOptimisticSplitsPage(null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (refreshGuardRef.current?.isCurrent(refreshGeneration)) {
          setIsRefreshingDerived(false);
        }
      });
  }

  function buildSplitNoteSyncPrompt(draft, snapshot) {
    if (!draft?.linkedTransactionId || !snapshot) {
      return null;
    }

    const previousNote = snapshot.note ?? "";
    const nextNote = draft.note ?? "";
    const linkedNote = draft.linkedTransactionNote ?? "";
    if (previousNote === nextNote || linkedNote === nextNote) {
      return null;
    }

    return {
      draftKind: draft.kind,
      editedNote: nextNote,
      connectedNote: linkedNote,
      editedLabel: draft.kind === "settlement" ? "Split settlement note being saved" : "Split expense note being saved",
      connectedLabel: "Connected ledger entry current note",
      description: "This split is connected to a ledger entry. Apply the same note to the ledger entry too?"
    };
  }

  function requestSplitNoteSync(draft, snapshot, saveKind) {
    const prompt = buildSplitNoteSyncPrompt(draft, snapshot);
    if (!prompt) {
      return false;
    }

    setSplitNoteSyncPrompt({
      ...prompt,
      saveKind
    });
    return true;
  }

  async function saveGroup() {
    if (!groupDialog?.name?.trim()) {
      setFormError("Group name is required.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const data = await createSplitGroup(groupDialog);
      await onRefresh({ refreshShell: true, broadcast: true });
      setGroupDialog(null);
      updateSplitView({ groupId: data.groupId, mode: "entries" });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveExpense({ syncLinkedNote = false } = {}) {
    const draft = expenseDialog;
    const validationError = validateSplitExpenseDraft(expenseDialog);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const response = await saveSplitExpense(draft);
      applyOptimisticSplitsPage((currentPage) => {
        // Keep the timeline snappy by inserting/updating the optimistic card
        // immediately. The later refresh fills in canonical balances and any
        // ledger-coupled recalculations.
        const existingItem = currentPage.activity.find((item) => item.kind === "expense" && item.id === (draft?.id ?? response.splitExpenseId));
        return {
          ...currentPage,
          activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticExpenseActivityItem({
            draft,
            splitExpenseId: response.splitExpenseId,
            viewId: view.id,
            people,
            groupOptions,
            existingItem
          }))
        };
      });
      if (syncLinkedNote && draft?.linkedTransactionId) {
        await updateLinkedEntryNote({
          entryId: draft.linkedTransactionId,
          note: draft.note ?? ""
        });
      }
      closeExpenseDialogAndReturn();
      refreshAfterSplitMutation(buildLinkedSplitRefreshOptions(draft?.linkedTransactionId));
      return true;
    } catch (error) {
      setFormError(error.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveSettlement({ syncLinkedNote = false } = {}) {
    const draft = settlementDialog;
    const validationError = validateSplitSettlementDraft(settlementDialog);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const response = await saveSplitSettlement(draft);
      applyOptimisticSplitsPage((currentPage) => {
        const existingItem = currentPage.activity.find((item) => item.kind === "settlement" && item.id === (draft?.id ?? response.settlementId));
        return {
          ...currentPage,
          activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticSettlementActivityItem({
            draft,
            settlementId: response.settlementId,
            viewId: view.id,
            people,
            groupOptions,
            existingItem
          }))
        };
      });
      if (syncLinkedNote && draft?.linkedTransactionId) {
        await updateLinkedEntryNote({
          entryId: draft.linkedTransactionId,
          note: draft.note ?? ""
        });
      }
      closeSettlementDialog();
      refreshAfterSplitMutation(buildLinkedSplitRefreshOptions(draft?.linkedTransactionId));
      return true;
    } catch (error) {
      setFormError(error.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmMatch(match) {
    setIsSubmitting(true);
    try {
      await linkSplitMatch(match);
      // Matching changes both the split record and, for expenses, the way the
      // linked ledger row should appear elsewhere in the app.
      applyOptimisticSplitsPage((currentPage) => applyOptimisticSplitMatch(currentPage, match));
      refreshAfterSplitMutation(buildLinkedSplitRefreshOptions(match.transactionId));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveInlineSplit({ syncLinkedNote = false } = {}) {
    if (!inlineSplitDraft) {
      return;
    }

    const draft = inlineSplitDraft;
    const validationError = inlineSplitDraft.kind === "expense"
      ? validateSplitExpenseDraft(inlineSplitDraft)
      : validateSplitSettlementDraft(inlineSplitDraft);
    if (validationError) {
      setInlineSplitError(validationError);
      return;
    }

    setInlineSplitError("");
    setIsSubmitting(true);
    try {
      if (draft.kind === "expense") {
        const response = await saveSplitExpense(draft);
        applyOptimisticSplitsPage((currentPage) => {
          const existingItem = currentPage.activity.find((item) => item.kind === "expense" && item.id === (draft.id ?? response.splitExpenseId));
          return {
            ...currentPage,
            activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticExpenseActivityItem({
              draft,
              splitExpenseId: response.splitExpenseId,
              viewId: view.id,
              people,
              groupOptions,
              existingItem
            }))
          };
        });
      } else {
        const response = await saveSplitSettlement(draft);
        applyOptimisticSplitsPage((currentPage) => {
          const existingItem = currentPage.activity.find((item) => item.kind === "settlement" && item.id === (draft.id ?? response.settlementId));
          return {
            ...currentPage,
            activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticSettlementActivityItem({
              draft,
              settlementId: response.settlementId,
              viewId: view.id,
              people,
              groupOptions,
              existingItem
            }))
          };
        });
      }
      if (syncLinkedNote && draft.linkedTransactionId) {
        await updateLinkedEntryNote({
          entryId: draft.linkedTransactionId,
          note: draft.note ?? ""
        });
      }
      clearInlineSplitDraft();
      refreshAfterSplitMutation(
        draft.linkedTransactionId
          ? buildLinkedSplitRefreshOptions(draft.linkedTransactionId)
          : { broadcast: true }
      );
      return true;
    } catch (error) {
      setInlineSplitError(error.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  function requestSaveExpense() {
    if (requestSplitNoteSync(expenseDialog, expenseDialogSnapshot, "expense-dialog")) {
      return;
    }

    void saveExpense();
  }

  function requestSaveSettlement() {
    if (requestSplitNoteSync(settlementDialog, settlementDialogSnapshot, "settlement-dialog")) {
      return;
    }

    void saveSettlement();
  }

  function requestSaveInlineSplit() {
    if (requestSplitNoteSync(inlineSplitDraft, inlineSplitDraftSnapshot, "inline-split")) {
      return;
    }

    void saveInlineSplit();
  }

  async function confirmSplitNoteSync({ updateLinked }) {
    const prompt = splitNoteSyncPrompt;
    if (!prompt) {
      return;
    }

    setIsSyncingSplitNote(true);
    setSplitNoteSyncPrompt((current) => current ? { ...current, error: "" } : current);
    try {
      let saved = false;
      if (prompt.saveKind === "expense-dialog") {
        saved = await saveExpense({ syncLinkedNote: updateLinked });
      } else if (prompt.saveKind === "settlement-dialog") {
        saved = await saveSettlement({ syncLinkedNote: updateLinked });
      } else {
        saved = await saveInlineSplit({ syncLinkedNote: updateLinked });
      }
      if (!saved) {
        return;
      }
      setSplitNoteSyncPrompt(null);
    } catch (error) {
      setSplitNoteSyncPrompt((current) => current
        ? { ...current, error: error instanceof Error ? error.message : "Failed to update connected note." }
        : current);
    } finally {
      setIsSyncingSplitNote(false);
    }
  }

  function openLinkedEntry(item) {
    if (!item.linkedTransactionId) {
      return;
    }

    const params = new URLSearchParams({
      view: view.id,
      month: splitsPage.month,
      editing_entry: item.linkedTransactionId
    });
    navigate({
      pathname: "/entries",
      search: `?${params.toString()}`
    });
  }

  function openMatchesView() {
    updateSplitView({ groupId: activeGroup?.id ?? defaultGroupId, mode: "matches" });
  }

  function openActiveGroupView() {
    updateSplitView({ groupId: activeGroup?.id ?? defaultGroupId, mode: "entries" });
  }

  async function confirmDeleteSplit() {
    if (!deleteTarget) {
      return;
    }

    setFormError("");
    setInlineSplitError("");
    setIsSubmitting(true);
    try {
      const deletedSplitKey = `${deleteTarget.kind}:${deleteTarget.id}`;
      if (deleteTarget.kind === "expense") {
        await deleteSplitExpense(deleteTarget.id);
      } else {
        await deleteSplitSettlement(deleteTarget.id);
      }
      applyOptimisticSplitsPage((currentPage) => ({
        ...currentPage,
        activity: removeOptimisticSplitActivity(currentPage.activity, deleteTarget),
        matches: currentPage.matches.filter((item) => item.splitRecordId !== deleteTarget.id)
      }));
      setDeleteTarget(null);
      if (`${inlineSplitDraft?.kind}:${inlineSplitDraft?.id}` === deletedSplitKey) {
        clearInlineSplitSnapshot();
        setInlineSplitError("");
        setInlineSplitDraft(null);
      }
      refreshAfterSplitMutation({
        broadcast: true,
        invalidateEntries: Boolean(deleteTarget.linkedTransactionId),
        invalidateMonth: Boolean(deleteTarget.linkedTransactionId),
        invalidateSummary: Boolean(deleteTarget.linkedTransactionId)
      });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderSplitActions(className) {
    return (
      <div className={className}>
        <button
          type="button"
          className={`split-matches-link ${selectedMode === "matches" ? "is-active" : ""}`}
          onClick={selectedMode === "matches" ? openActiveGroupView : openMatchesView}
        >
          {selectedMode === "matches" ? messages.splits.backToGroup : messages.splits.reviewMatches}
          {selectedMode !== "matches" && pendingMatchCount ? ` (${pendingMatchCount})` : ""}
        </button>
        {!isHouseholdView && selectedMode !== "matches" ? (
          <button
            type="button"
            className="subtle-action split-settle-header"
            onClick={() => {
              openNewSettlementDialog({ activeGroup, groupBalanceMinor });
            }}
            disabled={!activeGroup || groupBalanceMinor === 0}
          >
            {messages.splits.settleUp}
          </button>
        ) : null}
      </div>
    );
  }

  const splitSummaryToolbar = renderSplitActions("split-head-actions split-summary-toolbar");

  return (
    <article className="panel panel-accent panel-splits">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.splits}</h2>
          <p className="panel-context">{messages.splits.viewing(view.label)}</p>
          {isRefreshingDerived ? (
            <div className="split-refresh-status" role="status" aria-live="polite">
              <span className="app-spinner" aria-hidden="true" />
              <span>{messages.common.loadingLatest}</span>
            </div>
          ) : null}
        </div>
        {renderSplitActions("split-head-actions split-header-toolbar")}
      </div>

      <SplitsMainSection
        groups={groups}
        activeGroup={activeGroup}
        selectedMode={selectedMode}
        pendingMatchCount={pendingMatchCount}
        showBreakdown={showBreakdown}
        totalExpenseMinor={totalExpenseMinor}
        groupBalanceMinor={groupBalanceMinor}
        groupSummaryLabel={groupSummaryLabel}
        donutRows={donutRows}
        donutChart={splitsPage.donutChart}
        categories={categories}
        groupOptions={groupOptions}
        people={people}
        categoryOptions={categoryOptions}
        summaryToolbar={splitSummaryToolbar}
        visibleMatches={visibleMatches}
        groupedCurrentActivity={groupedCurrentActivity}
        archivedBatches={archivedBatches}
        inlineSplitDraft={inlineSplitDraft}
        inlineSplitError={inlineSplitError}
        isSubmitting={isSubmitting}
        onSelectGroup={(groupId) => updateSplitView({ groupId, mode: "entries" })}
        onCreateGroup={() => {
          setFormError("");
          setGroupDialog({ name: "" });
        }}
        onToggleBreakdown={() => setShowBreakdown((current) => !current)}
        onAddExpense={() => openNewExpenseDialog({ activeGroup, view })}
        onDismissMatch={(matchId) => setDismissedMatchIds((current) => [...current, matchId])}
        onConfirmMatch={confirmMatch}
        onOpenArchive={openArchiveList}
        readOnly={isHouseholdView}
        onEditExpense={isHouseholdView ? undefined : (useMobileSplitSheet ? openExpenseEditor : openInlineExpenseEditor)}
        onEditSettlement={isHouseholdView ? undefined : (useMobileSplitSheet ? openSettlementEditor : openInlineSettlementEditor)}
        onChangeInlineSplitDraft={setInlineSplitDraft}
        onCancelInlineSplit={() => {
          setInlineSplitDraft(null);
          clearInlineSplitSnapshot();
          setInlineSplitError("");
        }}
        hasInlineSplitChanges={hasInlineSplitChanges}
        onSaveInlineSplit={requestSaveInlineSplit}
        onRequestDeleteSplit={requestDeleteSplit}
        onViewLinkedEntry={openLinkedEntry}
        viewId={view.id}
        isRefreshingDerived={isRefreshingDerived}
      />

      <SplitArchiveDialog
        archiveDialog={archiveDialog}
        archivedBatches={archivedBatches}
        selectedArchivedBatch={selectedArchivedBatch}
        categories={categories}
        viewId={view.id}
        onClose={() => setArchiveDialog(null)}
        onBackToList={() => setArchiveDialog({ batchId: null })}
        onOpenBatch={openArchivedBatch}
        onEditExpense={openExpenseEditor}
        onEditSettlement={openSettlementEditor}
        onViewLinkedEntry={openLinkedEntry}
      />

      <SplitDeleteDialog
        target={deleteTarget}
        formError={formError}
        isSubmitting={isSubmitting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteSplit}
      />

      <SplitGroupDialog
        dialog={groupDialog}
        formError={formError}
        isSubmitting={isSubmitting}
        onChange={setGroupDialog}
        onClose={() => setGroupDialog(null)}
        onSave={saveGroup}
      />

      <SplitExpenseDialog
        dialog={expenseDialog}
        groupOptions={groupOptions}
        people={people}
        categoryOptions={categoryOptions}
        categories={categories}
        formError={formError}
        isSubmitting={isSubmitting}
        isSaveDisabled={!hasExpenseDialogChanges}
        onChange={setExpenseDialog}
        onClose={closeExpenseDialogAndReturn}
        onSave={requestSaveExpense}
        onViewLinkedEntry={openLinkedEntry}
      />

      <SplitSettlementDialog
        dialog={settlementDialog}
        groupOptions={groupOptions}
        people={people}
        formError={formError}
        isSubmitting={isSubmitting}
        isSaveDisabled={!hasSettlementDialogChanges}
        onChange={setSettlementDialog}
        onClose={() => {
          closeSettlementDialog();
        }}
        onSave={requestSaveSettlement}
        onViewLinkedEntry={openLinkedEntry}
      />
      <LinkedNoteSyncDialog
        prompt={splitNoteSyncPrompt}
        isSubmitting={isSyncingSplitNote || isSubmitting}
        onCancel={() => setSplitNoteSyncPrompt(null)}
        onSaveOnly={() => void confirmSplitNoteSync({ updateLinked: false })}
        onUpdateBoth={() => void confirmSplitNoteSync({ updateLinked: true })}
      />
    </article>
  );
}
