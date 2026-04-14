import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { SplitArchiveDialog, SplitExpenseDialog, SplitGroupDialog, SplitLinkedEntryDialog, SplitSettlementDialog } from "./splits-dialogs";
import { SplitsMainSection } from "./splits-main-section";
import {
  groupSplitActivityByBatch,
  groupSplitActivityByDate
} from "./split-helpers";

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
  const groups = view.splitsPage.groups;
  const groupOptions = useMemo(
    () => [{ id: "split-group-none", name: messages.splits.nonGroup }, ...groups.filter((group) => group.id !== "split-group-none")],
    [groups]
  );
  const defaultGroupId = groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const selectedGroupId = searchParams.get("split_group") ?? defaultGroupId;
  const selectedMode = searchParams.get("split_mode") ?? "entries";
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const visibleActivity = view.splitsPage.activity.filter((item) => item.groupId === (activeGroup?.id ?? "split-group-none"));
  const currentActivity = useMemo(
    () => visibleActivity.filter((item) => !item.isArchived),
    [visibleActivity]
  );
  const archivedActivity = useMemo(
    () => visibleActivity.filter((item) => item.isArchived),
    [visibleActivity]
  );
  const groupedCurrentActivity = useMemo(() => groupSplitActivityByDate(currentActivity), [currentActivity]);
  const archivedBatches = useMemo(() => groupSplitActivityByBatch(archivedActivity), [archivedActivity]);
  const selectedArchivedBatch = archiveDialog?.batchId
    ? archivedBatches.find((batch) => batch.batchId === archiveDialog.batchId) ?? null
    : null;
  const visibleMatches = view.splitsPage.matches.filter((item) => (
    item.groupId === (activeGroup?.id ?? "split-group-none") && !dismissedMatchIds.includes(item.id)
  ));
  const pendingMatchCount = view.splitsPage.matches.filter((item) => !dismissedMatchIds.includes(item.id)).length;
  const expenseMatchCount = view.splitsPage.matches.filter((item) => item.kind === "expense" && !dismissedMatchIds.includes(item.id)).length;
  const settlementMatchCount = view.splitsPage.matches.filter((item) => item.kind === "settlement" && !dismissedMatchIds.includes(item.id)).length;
  const groupBalanceMinor = activeGroup?.balanceMinor ?? 0;
  const groupSummaryLabel = groupBalanceMinor === 0
    ? messages.splits.settledUp
    : groupBalanceMinor > 0
      ? messages.splits.youAreOwed
      : messages.splits.youOwe;
  const totalExpenseMinor = currentActivity
    .filter((item) => item.kind === "expense")
    .reduce((sum, item) => sum + item.totalAmountMinor, 0);
  const linkedEntriesById = useMemo(
    () => new Map(view.monthPage.entries.map((entry) => [entry.id, entry])),
    [view.monthPage.entries]
  );
  const donutRows = useMemo(
    () => view.splitsPage.donutChart.map((item, index) => ({
      ...item,
      theme: getCategoryTheme(categories, { categoryName: item.label }, index)
    })),
    [categories, view.splitsPage.donutChart]
  );
  const categoryOptions = categories
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    .map((category) => category.name);

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
    const response = await fetch("/api/splits/groups/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: groupDialog.name })
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to create split group.");
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
    const isEditing = Boolean(expenseDialog?.id);
    const response = await fetch(isEditing ? "/api/splits/expenses/update" : "/api/splits/expenses/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        splitExpenseId: expenseDialog.id,
        groupId: expenseDialog.groupId === "split-group-none" ? null : expenseDialog.groupId,
        date: expenseDialog.date,
        description: expenseDialog.description,
        categoryName: expenseDialog.categoryName,
        payerPersonName: expenseDialog.payerPersonName,
        amountMinor: Number(expenseDialog.amountMinor ?? 0),
        note: expenseDialog.note,
        splitBasisPoints: Number(expenseDialog.splitBasisPoints ?? 5000)
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to create split expense.");
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
    const isEditing = Boolean(settlementDialog?.id);
    const response = await fetch(isEditing ? "/api/splits/settlements/update" : "/api/splits/settlements/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settlementId: settlementDialog.id,
        groupId: settlementDialog.groupId === "split-group-none" ? null : settlementDialog.groupId,
        date: settlementDialog.date,
        fromPersonName: settlementDialog.fromPersonName,
        toPersonName: settlementDialog.toPersonName,
        amountMinor: Number(settlementDialog.amountMinor ?? 0),
        note: settlementDialog.note
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to create settlement.");
      return;
    }

    setSettlementDialog(null);
    await onRefresh();
  }

  async function confirmMatch(match) {
    const endpoint = match.kind === "expense" ? "/api/splits/matches/link-expense" : "/api/splits/matches/link-settlement";
    const body = match.kind === "expense"
      ? { splitExpenseId: match.splitRecordId, transactionId: match.transactionId }
      : { settlementId: match.splitRecordId, transactionId: match.transactionId };
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    await onRefresh();
  }

  function openExpenseEditor(item) {
    const splitPercent = item.totalAmountMinor
      ? Math.round(((item.viewerAmountMinor ?? item.totalAmountMinor / 2) / item.totalAmountMinor) * 100)
      : 50;
    setFormError("");
    setExpenseDialog({
      id: item.id,
      groupId: item.groupId,
      date: item.date,
      description: item.description,
      categoryName: item.categoryName ?? (categoryOptions[0] ?? "Other"),
      payerPersonName: item.paidByPersonName ?? people[0]?.name ?? "",
      amountMinor: item.totalAmountMinor,
      note: item.note ?? "",
      splitBasisPoints: splitPercent * 100
    });
  }

  function openSettlementEditor(item) {
    setFormError("");
    setSettlementDialog({
      id: item.id,
      groupId: item.groupId,
      date: item.date,
      fromPersonName: item.fromPersonName ?? people[1]?.name ?? "",
      toPersonName: item.toPersonName ?? people[0]?.name ?? "",
      amountMinor: item.totalAmountMinor,
      note: item.note ?? ""
    });
  }

  function openLinkedEntryEditor(item) {
    const entry = item.linkedTransactionId ? linkedEntriesById.get(item.linkedTransactionId) : null;
    if (!entry) {
      return;
    }

    setFormError("");
    setLinkedEntryDialog({
      entryId: entry.id,
      date: entry.date,
      description: entry.description,
      accountName: entry.accountName,
      categoryName: entry.categoryName,
      amountMinor: entry.totalAmountMinor ?? entry.amountMinor,
      entryType: entry.entryType,
      transferDirection: entry.transferDirection,
      ownershipType: entry.ownershipType,
      ownerName: entry.ownerName ?? "",
      note: entry.note ?? "",
      splitBasisPoints: entry.viewerSplitRatioBasisPoints ?? entry.splits[0]?.ratioBasisPoints ?? 5000
    });
  }

  async function saveLinkedEntry() {
    if (!linkedEntryDialog?.entryId || !linkedEntryDialog.date || !linkedEntryDialog.description || !linkedEntryDialog.accountName || !linkedEntryDialog.categoryName) {
      setFormError("Linked entry is missing required fields.");
      return;
    }

    setFormError("");
    const response = await fetch("/api/entries/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(linkedEntryDialog)
    });
    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error ?? "Failed to update linked entry.");
      return;
    }

    setLinkedEntryDialog(null);
    await onRefresh();
  }

  function openNewExpenseDialog() {
    setFormError("");
    setExpenseDialog({
      groupId: activeGroup?.id ?? "split-group-none",
      date: new Date().toISOString().slice(0, 10),
      description: "",
      categoryName: categoryOptions[0] ?? "Other",
      payerPersonName: (view.id !== "household"
        ? people.find((person) => person.id === view.id)?.name
        : people[0]?.name) ?? "",
      amountMinor: 0,
      note: "",
      splitBasisPoints: 5000
    });
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
              setSettlementDialog({
                groupId: activeGroup?.id ?? "split-group-none",
                date: new Date().toISOString().slice(0, 10),
                fromPersonName: people[1]?.name ?? "",
                toPersonName: people[0]?.name ?? "",
                amountMinor: Math.abs(groupBalanceMinor),
                note: ""
              });
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
