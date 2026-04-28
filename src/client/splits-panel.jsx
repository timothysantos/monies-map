import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
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
  saveSplitSettlement
} from "./splits-api";
import { SplitArchiveDialog } from "./splits-archive-dialog";
import { SplitDeleteDialog, SplitExpenseDialog, SplitGroupDialog, SplitSettlementDialog } from "./splits-dialogs";
import { SplitsMainSection } from "./splits-main-section";
import { buildSplitsPanelModel } from "./splits-selectors";

export function SplitsPanel({ view, categories, people, onRefresh }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [useMobileSplitSheet, setUseMobileSplitSheet] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dismissedMatchIds, setDismissedMatchIds] = useState([]);
  const defaultGroupId = view.splitsPage.groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const selectedGroupParam = searchParams.get("split_group");
  const selectedGroupId = selectedGroupParam ?? defaultGroupId;
  const selectedMode = searchParams.get("split_mode") ?? "entries";
  const isHouseholdView = view.id === "household";
  const splitModel = useMemo(
    () => buildSplitsPanelModel({
      view,
      categories,
      selectedGroupId,
      dismissedMatchIds,
      archiveBatchId: archiveDialog?.batchId
    }),
    [archiveDialog?.batchId, categories, dismissedMatchIds, selectedGroupId, view]
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
    resetForViewChange();
    setArchiveDialog(null);
  }, [resetForViewChange, view.id, view.splitsPage.month]);

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

    const targetExpense = view.splitsPage.activity.find((item) => (
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

    openExpenseEditor(targetExpense);
  }, [
    expenseDialog?.id,
    searchParams,
    selectedGroupId,
    selectedMode,
    setSearchParams,
    view.splitsPage.activity
  ]);

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

  async function saveGroup() {
    if (!groupDialog?.name?.trim()) {
      setFormError("Group name is required.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const data = await createSplitGroup(groupDialog);
      await onRefresh();
      setGroupDialog(null);
      updateSplitView({ groupId: data.groupId, mode: "entries" });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveExpense() {
    const validationError = validateSplitExpenseDraft(expenseDialog);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await saveSplitExpense(expenseDialog);
      await onRefresh({ refreshShell: true, broadcast: true });
      closeExpenseDialog();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveSettlement() {
    const validationError = validateSplitSettlementDraft(settlementDialog);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await saveSplitSettlement(settlementDialog);
      await onRefresh({ refreshShell: true, broadcast: true });
      closeSettlementDialog();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmMatch(match) {
    setIsSubmitting(true);
    try {
      await linkSplitMatch(match);
      await onRefresh({ refreshShell: true, broadcast: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveInlineSplit() {
    if (!inlineSplitDraft) {
      return;
    }

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
      if (inlineSplitDraft.kind === "expense") {
        await saveSplitExpense(inlineSplitDraft);
      } else {
        await saveSplitSettlement(inlineSplitDraft);
      }
      await onRefresh({ refreshShell: true, broadcast: true });
      clearInlineSplitDraft();
    } catch (error) {
      setInlineSplitError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function openLinkedEntry(item) {
    if (!item.linkedTransactionId) {
      return;
    }

    const params = new URLSearchParams({
      view: view.id,
      month: view.splitsPage.month,
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
      await onRefresh({ refreshShell: true, broadcast: true });
      setDeleteTarget(null);
      if (`${inlineSplitDraft?.kind}:${inlineSplitDraft?.id}` === deletedSplitKey) {
        clearInlineSplitSnapshot();
        setInlineSplitError("");
        setInlineSplitDraft(null);
      }
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
        donutChart={view.splitsPage.donutChart}
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
          setInlineSplitDraftSnapshot(null);
          setInlineSplitError("");
        }}
        hasInlineSplitChanges={hasInlineSplitChanges}
        onSaveInlineSplit={saveInlineSplit}
        onRequestDeleteSplit={requestDeleteSplit}
        onViewLinkedEntry={openLinkedEntry}
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
        onClose={() => {
          closeExpenseDialog();
        }}
        onSave={saveExpense}
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
        onSave={saveSettlement}
        onViewLinkedEntry={openLinkedEntry}
      />
    </article>
  );
}
