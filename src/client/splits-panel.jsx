import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import {
  createSplitGroup,
  deleteSplitExpense,
  deleteSplitSettlement,
  linkSplitMatch,
  saveSplitExpense,
  saveSplitSettlement,
  updateSplitLinkedEntry
} from "./splits-api";
import { SplitArchiveDialog } from "./splits-archive-dialog";
import { SplitDeleteDialog, SplitExpenseDialog, SplitGroupDialog, SplitSettlementDialog } from "./splits-dialogs";
import { buildExpenseDraft, buildLinkedEntryDraft, buildNewExpenseDraft, buildNewSettlementDraft, buildSettlementDraft } from "./splits-drafts";
import { SplitLinkedEntryDialog } from "./splits-linked-entry-dialog";
import { SplitsMainSection } from "./splits-main-section";
import { buildSplitsPanelModel } from "./splits-selectors";

export function SplitsPanel({ view, categories, people, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [expenseDialog, setExpenseDialog] = useState(null);
  const [settlementDialog, setSettlementDialog] = useState(null);
  const [linkedEntryDialog, setLinkedEntryDialog] = useState(null);
  const [inlineSplitDraft, setInlineSplitDraft] = useState(null);
  const [inlineSplitError, setInlineSplitError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dismissedMatchIds, setDismissedMatchIds] = useState([]);
  const defaultGroupId = view.splitsPage.groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const selectedGroupId = searchParams.get("split_group") ?? defaultGroupId;
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
    expenseMatchCount,
    groupedCurrentActivity,
    groupBalanceMinor,
    groups,
    groupOptions,
    groupSummaryLabel,
    pendingMatchCount,
    selectedArchivedBatch,
    settlementMatchCount,
    totalExpenseMinor,
    visibleMatches
  } = splitModel;

  useEffect(() => {
    setDismissedMatchIds([]);
    setShowBreakdown(false);
    setFormError("");
    setInlineSplitDraft(null);
    setInlineSplitError("");
    setDeleteTarget(null);
    setLinkedEntryDialog(null);
    setArchiveDialog(null);
  }, [view.id, view.splitsPage.month]);

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
      setGroupDialog(null);
      await onRefresh();
      updateSplitView({ groupId: data.groupId, mode: "entries" });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveExpense() {
    if (!expenseDialog?.description?.trim() || !expenseDialog.date || !expenseDialog.payerPersonName || !expenseDialog.categoryName) {
      setFormError("Expense description, date, payer, and category are required.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await saveSplitExpense(expenseDialog);
      setExpenseDialog(null);
      await onRefresh();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveSettlement() {
    if (!settlementDialog?.date || !settlementDialog.fromPersonName || !settlementDialog.toPersonName) {
      setFormError("Settlement date and both people are required.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await saveSplitSettlement(settlementDialog);
      setSettlementDialog(null);
      await onRefresh();
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
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  function openExpenseEditor(item) {
    setFormError("");
    setExpenseDialog(buildExpenseDraft(item, categoryOptions, people));
  }

  function openSettlementEditor(item) {
    setFormError("");
    setSettlementDialog(buildSettlementDraft(item, people));
  }

  function openInlineExpenseEditor(item) {
    setFormError("");
    setInlineSplitError("");
    setInlineSplitDraft(buildExpenseDraft(item, categoryOptions, people));
  }

  function openInlineSettlementEditor(item) {
    setFormError("");
    setInlineSplitError("");
    setInlineSplitDraft(buildSettlementDraft(item, people));
  }

  async function saveInlineSplit() {
    if (!inlineSplitDraft) {
      return;
    }

    if (inlineSplitDraft.kind === "expense" && (!inlineSplitDraft.description?.trim() || !inlineSplitDraft.date || !inlineSplitDraft.payerPersonName || !inlineSplitDraft.categoryName)) {
      setInlineSplitError("Expense description, date, payer, and category are required.");
      return;
    }

    if (inlineSplitDraft.kind === "settlement" && (!inlineSplitDraft.date || !inlineSplitDraft.fromPersonName || !inlineSplitDraft.toPersonName)) {
      setInlineSplitError("Settlement date and both people are required.");
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
      setInlineSplitDraft(null);
      await onRefresh();
    } catch (error) {
      setInlineSplitError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function openLinkedEntryEditor(item) {
    const entry = item.linkedTransactionId ? splitModel.linkedEntriesById.get(item.linkedTransactionId) : null;
    if (!entry) {
      return;
    }

    setFormError("");
    setLinkedEntryDialog(buildLinkedEntryDraft(entry));
  }

  async function saveLinkedEntry() {
    if (!linkedEntryDialog?.entryId || !linkedEntryDialog.date || !linkedEntryDialog.description || !linkedEntryDialog.accountName || !linkedEntryDialog.categoryName) {
      setFormError("Linked entry is missing required fields.");
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      await updateSplitLinkedEntry(linkedEntryDialog);
      setLinkedEntryDialog(null);
      await onRefresh();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function openNewExpenseDialog() {
    setFormError("");
    setExpenseDialog(buildNewExpenseDraft({ activeGroup, categoryOptions, people, view }));
  }

  function requestDeleteSplit(item) {
    setFormError("");
    setInlineSplitError("");
    setDeleteTarget(item);
  }

  async function confirmDeleteSplit() {
    if (!deleteTarget) {
      return;
    }

    setFormError("");
    setInlineSplitError("");
    setIsSubmitting(true);
    try {
      if (deleteTarget.kind === "expense") {
        await deleteSplitExpense(deleteTarget.id);
      } else {
        await deleteSplitSettlement(deleteTarget.id);
      }
      setDeleteTarget(null);
      setInlineSplitDraft((current) => (current?.kind === deleteTarget.kind && current?.id === deleteTarget.id ? null : current));
      await onRefresh();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="panel panel-accent panel-splits">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.splits}</h2>
          <p className="panel-context">{messages.splits.viewing(view.label)}</p>
        </div>
        {!isHouseholdView && selectedMode !== "matches" ? (
          <button
            type="button"
            className="subtle-action split-settle-header"
            onClick={() => {
              setFormError("");
              setSettlementDialog(buildNewSettlementDraft({ activeGroup, groupBalanceMinor, people }));
            }}
            disabled={!activeGroup || groupBalanceMinor === 0}
          >
            {messages.splits.settleUp}
          </button>
        ) : null}
      </div>

      <SplitsMainSection
        groups={groups}
        activeGroup={activeGroup}
        defaultGroupId={defaultGroupId}
        selectedMode={selectedMode}
        pendingMatchCount={pendingMatchCount}
        expenseMatchCount={expenseMatchCount}
        settlementMatchCount={settlementMatchCount}
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
        visibleMatches={visibleMatches}
        groupedCurrentActivity={groupedCurrentActivity}
        archivedBatches={archivedBatches}
        inlineSplitDraft={inlineSplitDraft}
        inlineSplitError={inlineSplitError}
        isSubmitting={isSubmitting}
        onSelectGroup={(groupId) => updateSplitView({ groupId, mode: "entries" })}
        onSelectMatches={(groupId) => updateSplitView({ groupId, mode: "matches" })}
        onCreateGroup={() => {
          setFormError("");
          setGroupDialog({ name: "" });
        }}
        onToggleBreakdown={() => setShowBreakdown((current) => !current)}
        onAddExpense={openNewExpenseDialog}
        onDismissMatch={(matchId) => setDismissedMatchIds((current) => [...current, matchId])}
        onConfirmMatch={confirmMatch}
        onOpenArchive={openArchiveList}
        readOnly={isHouseholdView}
        onEditExpense={isHouseholdView ? undefined : openInlineExpenseEditor}
        onEditSettlement={isHouseholdView ? undefined : openInlineSettlementEditor}
        onChangeInlineSplitDraft={setInlineSplitDraft}
        onCancelInlineSplit={() => {
          setInlineSplitDraft(null);
          setInlineSplitError("");
        }}
        onSaveInlineSplit={saveInlineSplit}
        onRequestDeleteSplit={requestDeleteSplit}
        onEditLinkedEntry={openLinkedEntryEditor}
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
        onEditLinkedEntry={openLinkedEntryEditor}
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
        formError={formError}
        isSubmitting={isSubmitting}
        onChange={setExpenseDialog}
        onClose={() => setExpenseDialog(null)}
        onSave={saveExpense}
      />

      <SplitSettlementDialog
        dialog={settlementDialog}
        groupOptions={groupOptions}
        people={people}
        formError={formError}
        isSubmitting={isSubmitting}
        onChange={setSettlementDialog}
        onClose={() => setSettlementDialog(null)}
        onSave={saveSettlement}
      />

      <SplitLinkedEntryDialog
        dialog={linkedEntryDialog}
        people={people}
        categoryOptions={categoryOptions}
        formError={formError}
        isSubmitting={isSubmitting}
        onChange={setLinkedEntryDialog}
        onClose={() => setLinkedEntryDialog(null)}
        onSave={saveLinkedEntry}
      />
    </article>
  );
}
