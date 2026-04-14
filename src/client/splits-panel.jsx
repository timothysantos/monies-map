import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { createSplitGroup, linkSplitMatch, saveSplitExpense, saveSplitSettlement, updateSplitLinkedEntry } from "./splits-api";
import { SplitArchiveDialog } from "./splits-archive-dialog";
import { SplitExpenseDialog, SplitGroupDialog, SplitSettlementDialog } from "./splits-dialogs";
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
  const [formError, setFormError] = useState("");
  const [dismissedMatchIds, setDismissedMatchIds] = useState([]);
  const defaultGroupId = view.splitsPage.groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const selectedGroupId = searchParams.get("split_group") ?? defaultGroupId;
  const selectedMode = searchParams.get("split_mode") ?? "entries";
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
    let data;
    try {
      data = await createSplitGroup(groupDialog);
    } catch (error) {
      setFormError(error.message);
      return;
    }

    setGroupDialog(null);
    await onRefresh();
    updateSplitView({ groupId: data.groupId, mode: "entries" });
  }

  async function saveExpense() {
    if (!expenseDialog?.description?.trim() || !expenseDialog.date || !expenseDialog.payerPersonName || !expenseDialog.categoryName) {
      setFormError("Expense description, date, payer, and category are required.");
      return;
    }

    setFormError("");
    try {
      await saveSplitExpense(expenseDialog);
    } catch (error) {
      setFormError(error.message);
      return;
    }

    setExpenseDialog(null);
    await onRefresh();
  }

  async function saveSettlement() {
    if (!settlementDialog?.date || !settlementDialog.fromPersonName || !settlementDialog.toPersonName) {
      setFormError("Settlement date and both people are required.");
      return;
    }

    setFormError("");
    try {
      await saveSplitSettlement(settlementDialog);
    } catch (error) {
      setFormError(error.message);
      return;
    }

    setSettlementDialog(null);
    await onRefresh();
  }

  async function confirmMatch(match) {
    await linkSplitMatch(match);
    await onRefresh();
  }

  function openExpenseEditor(item) {
    setFormError("");
    setExpenseDialog(buildExpenseDraft(item, categoryOptions, people));
  }

  function openSettlementEditor(item) {
    setFormError("");
    setSettlementDialog(buildSettlementDraft(item, people));
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
    try {
      await updateSplitLinkedEntry(linkedEntryDialog);
    } catch (error) {
      setFormError(error.message);
      return;
    }

    setLinkedEntryDialog(null);
    await onRefresh();
  }

  function openNewExpenseDialog() {
    setFormError("");
    setExpenseDialog(buildNewExpenseDraft({ activeGroup, categoryOptions, people, view }));
  }

  return (
    <article className="panel panel-accent panel-splits">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.splits}</h2>
          <p className="panel-context">{messages.splits.viewing(view.label)}</p>
        </div>
        {selectedMode !== "matches" ? (
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
        visibleMatches={visibleMatches}
        groupedCurrentActivity={groupedCurrentActivity}
        archivedBatches={archivedBatches}
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
        onEditExpense={openExpenseEditor}
        onEditSettlement={openSettlementEditor}
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

      <SplitGroupDialog
        dialog={groupDialog}
        formError={formError}
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
        onChange={setExpenseDialog}
        onClose={() => setExpenseDialog(null)}
        onSave={saveExpense}
      />

      <SplitSettlementDialog
        dialog={settlementDialog}
        groupOptions={groupOptions}
        people={people}
        formError={formError}
        onChange={setSettlementDialog}
        onClose={() => setSettlementDialog(null)}
        onSave={saveSettlement}
      />

      <SplitLinkedEntryDialog
        dialog={linkedEntryDialog}
        people={people}
        categoryOptions={categoryOptions}
        formError={formError}
        onChange={setLinkedEntryDialog}
        onClose={() => setLinkedEntryDialog(null)}
        onSave={saveLinkedEntry}
      />
    </article>
  );
}
