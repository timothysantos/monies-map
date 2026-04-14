import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import {
  buildPlanLinkCandidates,
  buildMonthMetricCards,
  getDefaultMonthSectionOpen,
  getPlanRowById,
  getVisibleMonthAccounts
} from "./month-helpers";
import { MonthMetricRow, MonthNotesAndAccounts, MonthPanelHeader } from "./month-overview";
import { MonthPlanStack } from "./month-plan-tables";
import { getRowDateValue } from "./table-helpers";
import {
  formatDateOnly,
  formatMinorInput,
  money,
  parseDraftMoneyInput
} from "./formatters";

const MONTH_SECTION_STATE_CACHE = new Map();

export function MonthPanel({ view, accounts, people, categories, householdMonthEntries, onCategoryAppearanceChange, onRefresh }) {
  const navigate = useNavigate();
  const monthUiKey = `${view.id}:${view.monthPage.month}:${view.monthPage.selectedScope}`;
  const [planSections, setPlanSections] = useState(view.monthPage.planSections);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [editingDrafts, setEditingDrafts] = useState({});
  const [incomeRows, setIncomeRows] = useState([]);
  const [sectionOpen, setSectionOpen] = useState(() => MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? getDefaultMonthSectionOpen());
  const [noteDialog, setNoteDialog] = useState(null);
  const [planLinkDialog, setPlanLinkDialog] = useState(null);
  const [resetMonthText, setResetMonthText] = useState("");
  const [deleteMonthText, setDeleteMonthText] = useState("");
  const [monthNoteDialog, setMonthNoteDialog] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [tableSorts, setTableSorts] = useState({
    income: null,
    planned_items: null,
    budget_buckets: null
  });
  const isCombinedHouseholdView = view.id === "household" && view.monthPage.selectedScope === "direct_plus_shared";

  useEffect(() => {
    setPlanSections(view.monthPage.planSections);
    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
    setNoteDialog(null);
    setPlanLinkDialog(null);
    setMonthNoteDialog(null);
    setTableSorts({
      income: null,
      planned_items: null,
      budget_buckets: null
    });
    setIncomeRows(view.monthPage.incomeRows);
  }, [view]);

  useEffect(() => {
    setSectionOpen(MONTH_SECTION_STATE_CACHE.get(monthUiKey) ?? getDefaultMonthSectionOpen());
  }, [monthUiKey]);

  const currentMonthSummary = useMemo(
    () => view.summaryPage.months.find((month) => month.month === view.monthPage.month) ?? null,
    [view]
  );

  const monthMetricCards = useMemo(
    () => buildMonthMetricCards({ planSections, incomeRows, currentMonthSummary }),
    [currentMonthSummary, incomeRows, planSections]
  );
  const visibleAccounts = useMemo(
    () => getVisibleMonthAccounts(accounts, view.id),
    [accounts, view.id]
  );

  function handleRowChange(sectionKey, rowId, patch) {
    setPlanSections((current) => current.map((section) => {
      if (section.key !== sectionKey) {
        return section;
      }

      return {
        ...section,
        rows: section.rows.map((row) => {
          if (row.id !== rowId) {
            return row;
          }

          return {
            ...row,
            ...patch
          };
        })
      };
    }));
  }

  async function persistMonthRow(sectionKey, row, nextPlannedMinor) {
    await fetch("/api/month-plan/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId: row.id,
        month: view.monthPage.month,
        sectionKey,
        categoryName: row.categoryName,
        label: row.label,
        planDate: sectionKey === "planned_items" ? (getRowDateValue(row, view.monthPage.month) || null) : null,
        accountName: sectionKey === "planned_items" ? (row.accountName || null) : null,
        plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor,
        note: row.note ?? null,
        ownershipType: row.ownershipType,
        ownerName: row.ownerName,
        splitBasisPoints: row.ownershipType === "shared"
          ? row.splits[0]?.ratioBasisPoints ?? 5000
          : undefined
      })
    });
  }

  function beginIncomeEdit(row) {
    if (isCombinedHouseholdView || row.isDerived) {
      return;
    }
    if (editingRowId === row.id) {
      return;
    }

    setEditingRowId(row.id);
    setEditingSnapshot({ kind: "income", rowId: row.id, original: { ...row } });
    setEditingDrafts({
      plannedMinor: formatMinorInput(row.plannedMinor)
    });
  }

  function beginPlanEdit(sectionKey, row) {
    if (isCombinedHouseholdView || row.isDerived) {
      return;
    }
    if (editingRowId === row.id) {
      return;
    }

    setEditingRowId(row.id);
    setEditingSnapshot({ kind: "plan", sectionKey, rowId: row.id, original: { ...row } });
    setEditingDrafts({
      plannedMinor: formatMinorInput(row.plannedMinor)
    });
  }

  async function finishEdit() {
    if (!editingSnapshot) {
      return;
    }

    let nextPlannedMinor;
    if (editingSnapshot && Object.prototype.hasOwnProperty.call(editingDrafts, "plannedMinor")) {
      nextPlannedMinor = parseDraftMoneyInput(editingDrafts.plannedMinor);
      if (editingSnapshot.kind === "income") {
        handleIncomeRowChange(editingSnapshot.rowId, { plannedMinor: nextPlannedMinor });
      } else {
        handleRowChange(editingSnapshot.sectionKey, editingSnapshot.rowId, { plannedMinor: nextPlannedMinor });
      }
    }

    if (editingSnapshot.kind === "income") {
      const row = incomeRows.find((item) => item.id === editingSnapshot.rowId);
      if (row) {
        await persistMonthRow("income", {
          ...row,
          plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor
        }, nextPlannedMinor);
      }
    } else {
      const section = planSections.find((item) => item.key === editingSnapshot.sectionKey);
      const row = section?.rows.find((item) => item.id === editingSnapshot.rowId);
      if (row) {
        await persistMonthRow(editingSnapshot.sectionKey, {
          ...row,
          plannedMinor: typeof nextPlannedMinor === "number" ? nextPlannedMinor : row.plannedMinor
        }, nextPlannedMinor);
      }
    }

    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
    await onRefresh();
  }

  function cancelEdit() {
    if (!editingSnapshot) {
      setEditingRowId(null);
      return;
    }

    if (editingSnapshot.kind === "income") {
      setIncomeRows((current) => current.map((row) => (
        row.id === editingSnapshot.rowId ? editingSnapshot.original : row
      )));
    } else {
      setPlanSections((current) => current.map((section) => (
        section.key === editingSnapshot.sectionKey
          ? {
              ...section,
              rows: section.rows.map((row) => (
                row.id === editingSnapshot.rowId ? editingSnapshot.original : row
              ))
            }
          : section
      )));
    }

    setEditingRowId(null);
    setEditingSnapshot(null);
    setEditingDrafts({});
  }

  function handleAddPlanRow(sectionKey) {
    const nextId = `month-plan-${crypto.randomUUID()}`;
    const defaultCategoryName = sectionKey === "planned_items" ? "Savings" : "Food & Drinks";
    const ownerName = view.id === "household" ? undefined : view.label;
    const ownerPerson = ownerName ? people.find((person) => person.name === ownerName) : null;
    const ownershipType = view.monthPage.selectedScope === "shared" ? "shared" : "direct";
    const nextRow = {
      id: nextId,
      section: sectionKey,
      categoryName: defaultCategoryName,
      categoryId: categories.find((category) => category.name === defaultCategoryName)?.id,
      label: sectionKey === "planned_items" ? "New item" : "New bucket",
      dayLabel: sectionKey === "planned_items" ? `${view.monthPage.month}-01` : undefined,
      dayOfWeek: undefined,
      plannedMinor: 0,
      actualMinor: 0,
      accountName: sectionKey === "planned_items" ? "" : undefined,
      note: sectionKey === "planned_items" ? messages.month.newPlannedItemNote : messages.month.newBudgetBucketNote,
      ownershipType,
      ownerName,
      splits: ownershipType === "shared"
        ? people.slice(0, 2).map((person) => ({
            personId: person.id,
            personName: person.name,
            ratioBasisPoints: 5000,
            amountMinor: 0
          }))
        : ownerPerson
          ? [{
              personId: ownerPerson.id,
              personName: ownerPerson.name,
              ratioBasisPoints: 10000,
              amountMinor: 0
            }]
          : [],
      isDraft: true
    };

    setPlanSections((current) => current.map((section) => (
      section.key === sectionKey
        ? {
            ...section,
            rows: [nextRow, ...section.rows]
          }
        : section
    )));
    setTableSorts((current) => ({
      ...current,
      [sectionKey]: null
    }));
    setSectionOpen((current) => {
      const next = {
        ...current,
        [sectionKey]: true
      };
      MONTH_SECTION_STATE_CACHE.set(monthUiKey, next);
      return next;
    });
    setEditingRowId(nextId);
    setEditingDrafts({
      plannedMinor: "0.00"
    });
  }

  async function handleRemovePlanRow(sectionKey, rowId) {
    const section = planSections.find((item) => item.key === sectionKey);
    const row = section?.rows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    if (row.isDraft) {
      setPlanSections((current) => current.map((item) => (
        item.key === sectionKey
          ? { ...item, rows: item.rows.filter((planRow) => planRow.id !== rowId) }
          : item
      )));
      setEditingRowId((current) => (current === rowId ? null : current));
      return;
    }

    await fetch("/api/month-plan/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId,
        month: view.monthPage.month
      })
    });
    setEditingRowId((current) => (current === rowId ? null : current));
    await onRefresh();
  }

  function handleIncomeRowChange(rowId, patch) {
    setIncomeRows((current) => current.map((row) => (
      row.id === rowId
        ? {
            ...row,
            ...patch
          }
        : row
    )));
  }

  function openNoteDialog(kind, rowId, sectionKey, note) {
    setNoteDialog({
      kind,
      rowId,
      sectionKey,
      draft: note ?? ""
    });
  }

  async function commitNoteDialog() {
    if (!noteDialog) {
      return;
    }

    if (noteDialog.kind === "income") {
      handleIncomeRowChange(noteDialog.rowId, { note: noteDialog.draft });
      const row = incomeRows.find((item) => item.id === noteDialog.rowId);
      if (row) {
        await persistMonthRow("income", { ...row, note: noteDialog.draft });
      }
    } else {
      handleRowChange(noteDialog.sectionKey, noteDialog.rowId, { note: noteDialog.draft });
      const section = planSections.find((item) => item.key === noteDialog.sectionKey);
      const row = section?.rows.find((item) => item.id === noteDialog.rowId);
      if (row) {
        await persistMonthRow(noteDialog.sectionKey, { ...row, note: noteDialog.draft });
      }
    }

    setNoteDialog(null);
    await onRefresh();
  }

  async function commitMonthNoteDialog() {
    if (!monthNoteDialog) {
      return;
    }

    await fetch("/api/month-note/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: view.monthPage.month,
        personScope: view.id,
        note: monthNoteDialog.draft
      })
    });

    setMonthNoteDialog(null);
    await onRefresh();
  }

  function handleOpenEntriesForAccount(account) {
    const next = new URLSearchParams();
    next.set("view", view.id);
    next.set("month", view.monthPage.month);
    next.set("entry_wallet", account.name);
    next.set("scope", view.monthPage.selectedScope);

    if (view.id !== "household") {
      next.set("entry_person", view.label);
    } else if (!account.isJoint && account.ownerLabel !== "Shared") {
      next.set("entry_person", account.ownerLabel);
    }

    navigate({
      pathname: "/entries",
      search: `?${next.toString()}`
    });
  }

  function handleAddIncomeRow() {
    const nextId = `month-income-${crypto.randomUUID()}`;
    const ownerName = view.id === "household" ? undefined : view.label;
    const ownerPerson = ownerName ? people.find((person) => person.name === ownerName) : null;
    setIncomeRows((current) => [
      {
        id: nextId,
        categoryName: "Income",
        categoryId: categories.find((category) => category.name === "Income")?.id,
        label: "Other income",
        plannedMinor: 0,
        actualMinor: 0,
        note: messages.month.extraIncomeNote,
        ownershipType: "direct",
        personId: ownerPerson?.id,
        ownerName,
        splits: ownerPerson ? [{
          personId: ownerPerson.id,
          personName: ownerPerson.name,
          ratioBasisPoints: 10000,
          amountMinor: 0
        }] : [],
        isDraft: true
      },
      ...current
    ]);
    setTableSorts((current) => ({
      ...current,
      income: null
    }));
    setSectionOpen((current) => {
      const next = {
        ...current,
        income: true
      };
      MONTH_SECTION_STATE_CACHE.set(monthUiKey, next);
      return next;
    });
    setEditingRowId(nextId);
    setEditingDrafts({
      plannedMinor: "0.00"
    });
  }

  async function handleRemoveIncomeRow(rowId) {
    const row = incomeRows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    if (row.isDraft) {
      setIncomeRows((current) => current.filter((item) => item.id !== rowId));
      setEditingRowId((current) => (current === rowId ? null : current));
      return;
    }

    await fetch("/api/month-plan/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId,
        month: view.monthPage.month
      })
    });
    setEditingRowId((current) => (current === rowId ? null : current));
    await onRefresh();
  }

  function handleSortChange(tableKey, key) {
    setTableSorts((current) => {
      const existing = current[tableKey];
      if (!existing || existing.key !== key) {
        return {
          ...current,
          [tableKey]: { key, direction: "asc" }
        };
      }

      return {
        ...current,
        [tableKey]: {
          key,
          direction: existing.direction === "asc" ? "desc" : "asc"
        }
      };
    });
  }

  async function openPlanLinkDialog(row) {
    if (editingSnapshot?.rowId === row.id) {
      await finishEdit();
    }

    setPlanLinkDialog({
      rowId: row.id,
      draftEntryIds: row.linkedEntryIds ?? []
    });
  }

  async function savePlanLinkDialog() {
    if (!planLinkDialog) {
      return;
    }

    await fetch("/api/month-plan/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId: planLinkDialog.rowId,
        month: view.monthPage.month,
        transactionIds: planLinkDialog.draftEntryIds
      })
    });

    setPlanLinkDialog(null);
    await onRefresh();
  }

  const monthKey = view.monthPage.month;
  function toggleSection(sectionKey) {
    setSectionOpen((current) => {
      const next = {
        ...current,
        [sectionKey]: !current[sectionKey]
      };
      MONTH_SECTION_STATE_CACHE.set(monthUiKey, next);
      return next;
    });
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isResettingMonth, setIsResettingMonth] = useState(false);
  const [isDeletingMonth, setIsDeletingMonth] = useState(false);

  async function handleDuplicateMonth() {
    setIsDuplicating(true);
    try {
      const response = await fetch(`/api/months/duplicate?source=${view.monthPage.month}`, { method: "POST" });
      const data = await response.json();
      if (data?.targetMonth) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("month", data.targetMonth);
          return next;
        });
      }
    } finally {
      setIsDuplicating(false);
    }
  }

  async function handleResetMonth() {
    setIsResettingMonth(true);
    try {
      await fetch(`/api/months/reset?month=${view.monthPage.month}`, { method: "POST" });
      await onRefresh();
      setResetMonthText("");
    } finally {
      setIsResettingMonth(false);
    }
  }

  async function handleDeleteMonth() {
    setIsDeletingMonth(true);
    try {
      await fetch(`/api/months/delete?month=${view.monthPage.month}`, { method: "POST" });
      await onRefresh();
      setDeleteMonthText("");
    } finally {
      setIsDeletingMonth(false);
    }
  }

  return (
    <article className="panel">
      <MonthPanelHeader
        view={view}
        actionsOpen={actionsOpen}
        isDuplicating={isDuplicating}
        isResettingMonth={isResettingMonth}
        isDeletingMonth={isDeletingMonth}
        resetMonthText={resetMonthText}
        deleteMonthText={deleteMonthText}
        onActionsOpenChange={setActionsOpen}
        onScopeChange={(scopeKey) => {
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set("scope", scopeKey);
            return next;
          });
        }}
        onDuplicateMonth={handleDuplicateMonth}
        onResetMonthTextChange={setResetMonthText}
        onDeleteMonthTextChange={setDeleteMonthText}
        onResetMonth={handleResetMonth}
        onDeleteMonth={handleDeleteMonth}
      />

      <MonthMetricRow cards={monthMetricCards} />

      <MonthPlanStack
        view={view}
        categories={categories}
        accounts={accounts}
        incomeRows={incomeRows}
        planSections={planSections}
        sectionOpen={sectionOpen}
        tableSorts={tableSorts}
        editingRowId={editingRowId}
        editingDrafts={editingDrafts}
        isCombinedHouseholdView={isCombinedHouseholdView}
        monthKey={monthKey}
        onToggleSection={toggleSection}
        onAddIncomeRow={handleAddIncomeRow}
        onAddPlanRow={handleAddPlanRow}
        onBeginIncomeEdit={beginIncomeEdit}
        onBeginPlanEdit={beginPlanEdit}
        onIncomeRowChange={handleIncomeRowChange}
        onPlanRowChange={handleRowChange}
        onEditingDraftChange={(patch) => setEditingDrafts((current) => ({ ...current, ...patch }))}
        onFinishEdit={finishEdit}
        onCancelEdit={cancelEdit}
        onRemoveIncomeRow={handleRemoveIncomeRow}
        onRemovePlanRow={handleRemovePlanRow}
        onOpenNoteDialog={openNoteDialog}
        onOpenPlanLinkDialog={openPlanLinkDialog}
        onSortChange={handleSortChange}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
      />

      <MonthNotesAndAccounts
        monthNote={view.monthPage.monthNote}
        visibleAccounts={visibleAccounts}
        onEditMonthNote={() => setMonthNoteDialog({ draft: view.monthPage.monthNote ?? "" })}
        onOpenEntriesForAccount={handleOpenEntriesForAccount}
      />

      <Dialog.Root open={Boolean(noteDialog)} onOpenChange={(open) => { if (!open) setNoteDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>Edit note</Dialog.Title>
                <Dialog.Description>Write the planning context without squeezing it into the table.</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close note editor"
                onClick={() => setNoteDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="note-dialog-textarea"
              value={noteDialog?.draft ?? ""}
              onChange={(event) => setNoteDialog((current) => current ? { ...current, draft: event.target.value } : current)}
              rows={10}
            />
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setNoteDialog(null)}>
                {messages.month.cancelEdit}
              </button>
              <button type="button" className="dialog-primary" onClick={commitNoteDialog}>
                {messages.month.doneEdit}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(planLinkDialog)} onOpenChange={(open) => { if (!open) setPlanLinkDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content planned-link-dialog">
            {(() => {
              const row = planLinkDialog ? getPlanRowById(planSections, planLinkDialog.rowId) : null;
              const candidates = buildPlanLinkCandidates({
                row,
                householdMonthEntries,
                monthEntries: view.monthPage.entries,
                monthKey: view.monthPage.month
              });
              const selectedIds = new Set(planLinkDialog?.draftEntryIds ?? []);
              return (
                <>
                  <div className="note-dialog-head">
                    <div>
                      <Dialog.Title>Match planned item</Dialog.Title>
                      <Dialog.Description>
                        Link exact ledger entries to {row?.label ?? "this planned item"}. Budget buckets still use category totals.
                      </Dialog.Description>
                    </div>
                    <button
                      type="button"
                      className="icon-action subtle-cancel"
                      aria-label="Close planned item matching"
                      onClick={() => setPlanLinkDialog(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {candidates.length ? (
                    <div className="planned-link-list">
                      {candidates.map((entry) => (
                        <label key={entry.id} className="planned-link-row">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.id)}
                            onChange={(event) => {
                              setPlanLinkDialog((current) => {
                                if (!current) {
                                  return current;
                                }
                                const nextIds = new Set(current.draftEntryIds);
                                if (event.target.checked) {
                                  nextIds.add(entry.id);
                                } else {
                                  nextIds.delete(entry.id);
                                }
                                return {
                                  ...current,
                                  draftEntryIds: [...nextIds]
                                };
                              });
                            }}
                          />
                          <span className="planned-link-row-main">
                            <strong>{entry.description}</strong>
                            <small>{formatDateOnly(entry.date)} • {entry.accountName} • {entry.categoryName}</small>
                            {entry.matchReasons?.length ? <em>{entry.matchReasons.slice(0, 3).join(" · ")}</em> : null}
                          </span>
                          <span>{money(entry.amountMinor)}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-copy">No expense entries are available in the selected month.</p>
                  )}
                  <div className="note-dialog-actions">
                    <button type="button" className="subtle-cancel" onClick={() => setPlanLinkDialog(null)}>
                      {messages.month.cancelEdit}
                    </button>
                    <button type="button" className="dialog-primary" onClick={() => void savePlanLinkDialog()}>
                      Save matches
                    </button>
                  </div>
                </>
              );
            })()}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(monthNoteDialog)} onOpenChange={(open) => { if (!open) setMonthNoteDialog(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{messages.month.notesTitle}</Dialog.Title>
                <Dialog.Description>{messages.month.notesDetail}</Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close month note editor"
                onClick={() => setMonthNoteDialog(null)}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="note-dialog-textarea"
              value={monthNoteDialog?.draft ?? ""}
              onChange={(event) => setMonthNoteDialog((current) => current ? { ...current, draft: event.target.value } : current)}
              rows={10}
            />
            <div className="note-dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setMonthNoteDialog(null)}>
                {messages.month.cancelEdit}
              </button>
              <button type="button" className="dialog-primary" onClick={() => void commitMonthNoteDialog()}>
                {messages.month.doneEdit}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}
