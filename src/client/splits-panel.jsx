import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { SpendingMixChart } from "./category-visuals";
import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { SplitActivityGroups } from "./splits-activity";
import {
  decimalStringToMinor,
  formatDate,
  formatDateOnly,
  minorToDecimalString,
  money
} from "./formatters";
import {
  formatArchiveDate,
  getArchivedBatchSummary,
  groupSplitActivityByBatch,
  groupSplitActivityByDate
} from "./split-helpers";
import { CategoryGlyph, getIconComponent } from "./ui-components";

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

      <section className="splits-groups-row">
        <div className="splits-group-pills">
          {groups.map((group) => {
            const Icon = getIconComponent(group.iconKey);
            return (
              <button
                key={group.id}
                type="button"
                className={`split-group-pill ${group.id === activeGroup?.id && selectedMode !== "matches" ? "is-active" : ""}`}
                onClick={() => updateSplitView({ groupId: group.id, mode: "entries" })}
              >
                <span className="split-group-pill-icon"><Icon size={18} strokeWidth={2.1} /></span>
                <span className="split-group-pill-content">
                  <strong>{group.name}</strong>
                  <span>{group.summaryText}</span>
                  <span>{group.entryCount} {messages.splits.entries}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={`split-group-pill split-matches-pill ${selectedMode === "matches" ? "is-active" : ""}`}
            onClick={() => updateSplitView({ groupId: activeGroup?.id ?? defaultGroupId, mode: "matches" })}
          >
            <span className="split-group-pill-content">
              <strong>{messages.splits.matches}</strong>
              <span>{pendingMatchCount ? messages.splits.toReview(pendingMatchCount) : messages.splits.allClear}</span>
              <span>{expenseMatchCount} expense, {settlementMatchCount} settle-up</span>
            </span>
          </button>
          <button
            type="button"
            className="split-group-pill split-group-pill-create"
            onClick={() => {
              setFormError("");
              setGroupDialog({ name: "" });
            }}
            aria-label={messages.splits.createGroup}
          >
            <strong>{messages.splits.addGroup}</strong>
          </button>
        </div>
      </section>

      <section className="entries-summary-strip splits-summary-strip">
        <button
          type="button"
          className={`summary-chevron ${showBreakdown ? "is-open" : ""}`}
          aria-label="Toggle split donut"
          onClick={() => setShowBreakdown((current) => !current)}
        >
          <ChevronRight size={18} />
        </button>
        <div className="entries-summary-metrics">
          <span>{messages.entries.totalSpend} <strong>{money(totalExpenseMinor)}</strong></span>
          <span>{groupSummaryLabel} <strong className={groupBalanceMinor >= 0 ? "tone-positive" : "tone-negative"}>{money(Math.abs(groupBalanceMinor))}</strong></span>
        </div>
        <div className="splits-summary-actions">
          <button
            type="button"
            className="subtle-action"
            onClick={openNewExpenseDialog}
          >
            {messages.splits.addExpense}
          </button>
        </div>
      </section>

      {showBreakdown ? (
        <section className="split-donut-panel">
          {donutRows.length ? (
            <div className="entries-breakdown-panel split-breakdown-panel">
              <div className="entries-breakdown-chart">
                <SpendingMixChart
                  data={view.splitsPage.donutChart}
                  categories={categories}
                  totalLabel={messages.entries.totalSpend}
                  compact
                  height={300}
                  innerRadius={58}
                  outerRadius={96}
                />
              </div>
              <div className="entries-breakdown-list category-list">
                {donutRows.map((item) => (
                  <div key={item.key} className="category-row">
                    <div className="category-key">
                      <span className="category-icon category-icon-static" style={{ "--category-color": item.theme.color }}>
                        <CategoryGlyph iconKey={item.theme.iconKey} />
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{messages.common.triplet(money(item.valueMinor), `${item.entryCount} ${item.entryCount === 1 ? "entry" : "entries"}`, `${((item.valueMinor / Math.max(totalExpenseMinor, 1)) * 100).toFixed(1)}%`)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="lede compact">{messages.splits.noEntries}</p>
          )}
        </section>
      ) : null}

      {selectedMode === "matches" ? (
        <section className="split-list-section">
          <div className="panel-subhead">
            <div>
              <h2>{messages.splits.matches}</h2>
              <p className="lede compact">{pendingMatchCount ? messages.splits.toReview(pendingMatchCount) : messages.splits.noMatches}</p>
            </div>
          </div>
          <div className="split-match-list">
            {visibleMatches.length ? visibleMatches.map((match) => (
              <div key={match.id} className="split-match-card">
                <div>
                  <strong>{match.reviewLabel}</strong>
                  <p>{messages.common.triplet(formatDate(match.transactionDate), money(match.amountMinor), match.confidenceLabel)}</p>
                  <p>{match.transactionDescription}</p>
                </div>
                <div className="split-match-actions">
                  <button type="button" className="subtle-action" onClick={() => setDismissedMatchIds((current) => [...current, match.id])}>
                    {messages.splits.keepSeparate}
                  </button>
                  <button type="button" className="dialog-primary" onClick={() => void confirmMatch(match)}>
                    {messages.splits.match}
                  </button>
                </div>
              </div>
            )) : (
              <p className="lede compact">{messages.splits.noMatches}</p>
            )}
          </div>
        </section>
      ) : (
        <section className="split-list-section">
          <button
            type="button"
            data-splits-fab-trigger="true"
            className="entries-fab-trigger"
            onClick={openNewExpenseDialog}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="split-activity-list">
            {groupedCurrentActivity.length ? (
              <SplitActivityGroups
                groups={groupedCurrentActivity}
                categories={categories}
                onEditExpense={openExpenseEditor}
                onEditSettlement={openSettlementEditor}
                onEditLinkedEntry={openLinkedEntryEditor}
              />
            ) : null}
            {!groupedCurrentActivity.length && !archivedBatches.length ? <p className="lede compact">{messages.splits.noEntries}</p> : null}
            <button
              type="button"
              className={`split-archive-trigger ${archivedBatches.length ? "" : "is-empty"}`}
              onClick={archivedBatches.length ? openArchiveList : undefined}
              disabled={!archivedBatches.length}
            >
              <span>Archived batches</span>
              <small>
                {archivedBatches.length
                  ? `${archivedBatches.length} settled ${archivedBatches.length === 1 ? "batch" : "batches"}`
                  : "No settled batches yet"}
              </small>
            </button>
          </div>
        </section>
      )}

      <Dialog.Root open={Boolean(archiveDialog)} onOpenChange={(open) => { if (!open) setArchiveDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content split-archive-dialog">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{selectedArchivedBatch ? selectedArchivedBatch.label : "Archived batches"}</Dialog.Title>
              <Dialog.Description>
                {selectedArchivedBatch
                  ? (selectedArchivedBatch.closedAt ? `Settled ${formatDateOnly(selectedArchivedBatch.closedAt)}` : "Settled batch")
                  : "Closed settle-up batches stay here as muted history."}
              </Dialog.Description>
            </div>
            {selectedArchivedBatch ? (
              <div className="split-archive-dialog-body">
                <button type="button" className="subtle-action split-archive-back" onClick={() => setArchiveDialog({ batchId: null })}>
                  Back to archived batches
                </button>
                <div className="split-archive-batch-detail">
                  <SplitActivityGroups
                    groups={selectedArchivedBatch.groups}
                    categories={categories}
                    archived
                    onEditExpense={openExpenseEditor}
                    onEditSettlement={openSettlementEditor}
                    onEditLinkedEntry={openLinkedEntryEditor}
                  />
                </div>
              </div>
            ) : (
              <div className="split-archive-dialog-body split-archive-list-dialog">
                {archivedBatches.map((batch) => {
                  const summary = getArchivedBatchSummary(batch, view.id);
                  return (
                    <button key={batch.batchId} type="button" className="split-archive-row" onClick={() => openArchivedBatch(batch.batchId)}>
                      <span className="split-archive-row-date">{formatArchiveDate(batch.closedAt)}</span>
                      <span className="split-archive-row-icon category-icon category-icon-static" style={{ "--category-color": "#c58b62" }}>
                        <ArrowRightLeft size={16} />
                      </span>
                      <span className="split-archive-row-copy">
                        <strong>{summary.title}</strong>
                        <small>{summary.subtitle}</small>
                      </span>
                      <span className="split-archive-row-meta">{batch.items.length} {batch.items.length === 1 ? "entry" : "entries"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setArchiveDialog(null)}>Close</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(groupDialog)} onOpenChange={(open) => { if (!open) setGroupDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{messages.splits.createGroup}</Dialog.Title>
              <Dialog.Description>Add a named split group for shared expenses.</Dialog.Description>
            </div>
            <label className="split-dialog-field">
              <span>{messages.splits.groupName}</span>
              <input className="table-edit-input" value={groupDialog?.name ?? ""} onChange={(event) => setGroupDialog((current) => current ? { ...current, name: event.target.value } : current)} />
            </label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setGroupDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveGroup()}>{messages.splits.saveGroup}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(expenseDialog)} onOpenChange={(open) => { if (!open) setExpenseDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{expenseDialog?.id ? messages.splits.editSplit : messages.splits.createExpense}</Dialog.Title>
              <Dialog.Description>Create or edit a split expense without touching the bank import workflow.</Dialog.Description>
            </div>
            <div className="split-dialog-section">
              <div className="entry-core-grid split-dialog-grid">
                <label className="split-dialog-field">
                <span>Group</span>
                <select className="table-edit-input" value={expenseDialog?.groupId ?? "split-group-none"} onChange={(event) => setExpenseDialog((current) => current ? { ...current, groupId: event.target.value } : current)}>
                  {groupOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseDate}</span>
                <input className="table-edit-input" type="date" value={expenseDialog?.date ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, date: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expensePaidBy}</span>
                <select className="table-edit-input" value={expenseDialog?.payerPersonName ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, payerPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseCategory}</span>
                <select className="table-edit-input" value={expenseDialog?.categoryName ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, categoryName: event.target.value } : current)}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                </label>
              </div>
            </div>
            <div className="split-dialog-section split-dialog-section-compact">
              <div className="split-dialog-inline">
                <label className="split-dialog-field">
                <span>{messages.splits.expenseAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(expenseDialog?.amountMinor ?? 0)} onChange={(event) => setExpenseDialog((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseSplit}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" max="100" value={Number(expenseDialog?.splitBasisPoints ?? 5000) / 100} onChange={(event) => setExpenseDialog((current) => current ? { ...current, splitBasisPoints: Math.round(Number(event.target.value || 0) * 100) } : current)} />
                </label>
              </div>
            </div>
            <div className="split-dialog-section">
              <div className="entry-writing-grid split-dialog-writing-grid">
                <label className="split-dialog-field">
                <span>{messages.splits.expenseDescription}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={expenseDialog?.description ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, description: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.expenseNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={expenseDialog?.note ?? ""} onChange={(event) => setExpenseDialog((current) => current ? { ...current, note: event.target.value } : current)} />
                </label>
              </div>
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setExpenseDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveExpense()}>{messages.splits.saveExpense}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(settlementDialog)} onOpenChange={(open) => { if (!open) setSettlementDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{settlementDialog?.id ? messages.splits.editSplit : messages.splits.createSettlement}</Dialog.Title>
              <Dialog.Description>Record or edit a settle-up and match the bank transfer later from the Matches view.</Dialog.Description>
            </div>
            <div className="split-dialog-section">
              <div className="entry-core-grid split-dialog-grid">
                <label className="split-dialog-field">
                <span>Group</span>
                <select className="table-edit-input" value={settlementDialog?.groupId ?? "split-group-none"} onChange={(event) => setSettlementDialog((current) => current ? { ...current, groupId: event.target.value } : current)}>
                  {groupOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.settlementDate}</span>
                <input className="table-edit-input" type="date" value={settlementDialog?.date ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, date: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.settlementFrom}</span>
                <select className="table-edit-input" value={settlementDialog?.fromPersonName ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, fromPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
                </label>
                <label className="split-dialog-field">
                <span>{messages.splits.settlementTo}</span>
                <select className="table-edit-input" value={settlementDialog?.toPersonName ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, toPersonName: event.target.value } : current)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                </select>
                </label>
              </div>
            </div>
            <div className="split-dialog-section split-dialog-section-compact">
              <div className="split-dialog-inline">
                <label className="split-dialog-field">
                <span>{messages.splits.settlementAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(settlementDialog?.amountMinor ?? 0)} onChange={(event) => setSettlementDialog((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
                </label>
              </div>
            </div>
            <div className="split-dialog-section">
              <label className="split-dialog-field">
                <span>{messages.splits.expenseNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={4} value={settlementDialog?.note ?? ""} onChange={(event) => setSettlementDialog((current) => current ? { ...current, note: event.target.value } : current)} />
              </label>
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setSettlementDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveSettlement()}>{messages.splits.saveSettlement}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(linkedEntryDialog)} onOpenChange={(open) => { if (!open) setLinkedEntryDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content split-dialog-content">
            <div className="note-dialog-head split-dialog-head">
              <Dialog.Title>{messages.splits.editLinkedEntry}</Dialog.Title>
              <Dialog.Description>Edit the same ledger entry that also appears on the Entries page. Changes here update that row there too.</Dialog.Description>
            </div>
            <div className="linked-entry-notice">
              <strong>Linked to Entries</strong>
              <p>This form edits the underlying ledger row. When you save here, the matching entry in `Entries` updates too.</p>
            </div>
            <div className="split-dialog-section">
              <div className="entry-core-grid split-dialog-grid">
                <label className="split-dialog-field">
                <span>{messages.entries.editDate}</span>
                <input className="table-edit-input" type="date" value={linkedEntryDialog?.date ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, date: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editWallet}</span>
                <input className="table-edit-input" value={linkedEntryDialog?.accountName ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, accountName: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editCategory}</span>
                <select className="table-edit-input" value={linkedEntryDialog?.categoryName ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, categoryName: event.target.value } : current)}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                </label>
              </div>
            </div>
            <div className="split-dialog-section split-dialog-section-compact">
              <div className="split-dialog-inline">
                <label className="split-dialog-field">
                <span>{messages.entries.editAmount}</span>
                <input className="table-edit-input table-edit-input-money" type="number" min="0" step="0.01" value={minorToDecimalString(linkedEntryDialog?.amountMinor ?? 0)} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, amountMinor: decimalStringToMinor(event.target.value) } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editOwner}</span>
                <select className="table-edit-input" value={linkedEntryDialog?.ownershipType === "shared" ? "Shared" : (linkedEntryDialog?.ownerName ?? "")} onChange={(event) => {
                  const nextValue = event.target.value;
                  setLinkedEntryDialog((current) => current ? {
                    ...current,
                    ownershipType: nextValue === "Shared" ? "shared" : "direct",
                    ownerName: nextValue === "Shared" ? undefined : nextValue
                  } : current);
                }}>
                  {[...people.map((person) => person.name), "Shared"].map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                </label>
                {linkedEntryDialog?.ownershipType === "shared" ? (
                  <label className="split-dialog-field">
                  <span>{messages.entries.editSplit}</span>
                  <input className="table-edit-input table-edit-input-money" type="number" min="0" max="100" value={Number(linkedEntryDialog?.splitBasisPoints ?? 5000) / 100} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, splitBasisPoints: Math.round(Number(event.target.value || 0) * 100) } : current)} />
                  </label>
                ) : null}
              </div>
            </div>
            <div className="split-dialog-section">
              <div className="entry-writing-grid split-dialog-writing-grid">
                <label className="split-dialog-field">
                <span>{messages.entries.editDescription}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={linkedEntryDialog?.description ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, description: event.target.value } : current)} />
                </label>
                <label className="split-dialog-field">
                <span>{messages.entries.editNote}</span>
                <textarea className="table-edit-input table-edit-textarea" rows={3} value={linkedEntryDialog?.note ?? ""} onChange={(event) => setLinkedEntryDialog((current) => current ? { ...current, note: event.target.value } : current)} />
                </label>
              </div>
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setLinkedEntryDialog(null)}>Cancel</button>
              <button type="button" className="dialog-primary" onClick={() => void saveLinkedEntry()}>Save linked entry</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}
