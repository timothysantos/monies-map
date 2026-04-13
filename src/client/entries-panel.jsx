import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { CategoryAppearancePopover, SpendingMixChart } from "./category-visuals";
import { getCategory, getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import {
  applySharedSplit,
  buildEntryDraft,
  entryMatchesScope,
  getAmountToneClass,
  getSignedAmountMinor,
  getSignedTotalAmountMinor,
  getTransferMatchCandidates,
  getTransferWallets,
  getVisibleSplitIndex,
  getVisibleSplitPercent,
  groupEntriesByDate,
  normalizeEntryShape,
  uniqueValues
} from "./entry-helpers";
import { CategoryGlyph, FilterSelect } from "./ui-components";
import {
  formatDateOnly,
  formatEditableMinorInput,
  money,
  parseMoneyInput
} from "./formatters";

export function EntriesPanel({ view, accounts, categories, people, onCategoryAppearanceChange, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState(view.monthPage.entries);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [showEntryComposer, setShowEntryComposer] = useState(false);
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [entryDraft, setEntryDraft] = useState(() => buildEntryDraft(view, accounts, categories, people));
  const [entrySubmitError, setEntrySubmitError] = useState("");
  const [linkingTransferEntryId, setLinkingTransferEntryId] = useState(null);
  const [settlingTransferEntryId, setSettlingTransferEntryId] = useState(null);
  const [transferSettlementDrafts, setTransferSettlementDrafts] = useState({});
  const [transferDialogEntryId, setTransferDialogEntryId] = useState(null);
  const [addingToSplitsEntryId, setAddingToSplitsEntryId] = useState(null);
  const selectedScope = searchParams.get("entries_scope") ?? view.monthPage.selectedScope;
  const defaultEntryPerson = view.id !== "household" ? view.label : "";
  const entryFilters = {
    wallet: searchParams.get("entry_wallet") ?? "",
    category: searchParams.get("entry_category") ?? "",
    person: searchParams.get("entry_person") ?? defaultEntryPerson,
    type: searchParams.get("entry_type") ?? ""
  };

  useEffect(() => {
    setEntries(view.monthPage.entries);
    setEditingEntryId(null);
    setEntrySnapshot(null);
    setShowEntryComposer(false);
    setShowExpenseBreakdown(false);
    setShowMobileFilters(false);
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
    setEntrySubmitError("");
    setLinkingTransferEntryId(null);
    setSettlingTransferEntryId(null);
    setTransferSettlementDrafts({});
    setTransferDialogEntryId(null);
    setAddingToSplitsEntryId(null);
  }, [view, accounts, categories, people]);

  const wallets = useMemo(() => uniqueValues(entries.map((entry) => entry.accountName)), [entries]);
  const entryCategoryOptions = useMemo(() => uniqueValues(entries.map((entry) => entry.categoryName)), [entries]);
  const categoryOptions = useMemo(
    () => categories
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
      .map((category) => category.name),
    [categories]
  );
  const accountOptions = useMemo(
    () => accounts
      .filter((account) => account.isActive !== false)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((account) => account.name),
    [accounts]
  );
  const peopleFilterOptions = useMemo(
    () => uniqueValues(entries.flatMap((entry) => entry.ownershipType === "shared" ? ["Shared"] : [entry.ownerName ?? ""])),
    [entries]
  );
  const activeEntryFilterCount = useMemo(
    () => ["wallet", "category", "person", "type"].reduce((count, key) => count + (entryFilters[key] ? 1 : 0), 0),
    [entryFilters]
  );
  const ownerOptions = useMemo(
    () => [...people.map((person) => person.name), "Shared"],
    [people]
  );

  const filteredEntries = useMemo(
    () => entries.filter((entry) => {
      if (!entryMatchesScope(entry, view.id, selectedScope)) {
        return false;
      }
      if (entryFilters.wallet && entry.accountName !== entryFilters.wallet) {
        return false;
      }
      if (entryFilters.category && entry.categoryName !== entryFilters.category) {
        return false;
      }
      if (entryFilters.type && entry.entryType !== entryFilters.type) {
        return false;
      }
      if (entryFilters.person) {
        if (entryFilters.person === "Shared") {
          return entry.ownershipType === "shared";
        }
        return entry.ownerName === entryFilters.person || entry.splits.some((split) => split.personName === entryFilters.person);
      }
      return true;
    }),
    [entries, entryFilters, selectedScope, view.id]
  );

  const groupedEntries = useMemo(() => groupEntriesByDate(filteredEntries), [filteredEntries]);
  const entryTotals = useMemo(() => filteredEntries.reduce((totals, entry) => {
    if (entry.entryType === "income") {
      totals.incomeMinor += entry.amountMinor;
    } else if (entry.entryType === "expense") {
      totals.spendMinor += entry.amountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "out") {
      totals.transferOutMinor += entry.amountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "in") {
      totals.transferInMinor += entry.amountMinor;
    }

    return totals;
  }, { incomeMinor: 0, spendMinor: 0, transferInMinor: 0, transferOutMinor: 0 }), [filteredEntries]);
  const entryOutflowMinor = entryTotals.spendMinor + entryTotals.transferOutMinor;
  const entryNetMinor = entryTotals.incomeMinor - entryTotals.spendMinor;
  const expenseBreakdown = useMemo(() => {
    const grouped = new Map();
    for (const entry of filteredEntries) {
      if (entry.entryType !== "expense") {
        continue;
      }
      const key = entry.categoryName;
      const current = grouped.get(key) ?? {
        key,
        label: key,
        categoryName: key,
        valueMinor: 0,
        entryCount: 0
      };
      current.valueMinor += entry.amountMinor;
      current.entryCount += 1;
      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.valueMinor - left.valueMinor);
  }, [filteredEntries]);

  function updateEntryFilter(key, value) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const paramKey = `entry_${key}`;
      if (!value) {
        next.delete(paramKey);
      } else {
        next.set(paramKey, value);
      }
      return next;
    });
  }

  function resetEntryFilters() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("entry_wallet");
      next.delete("entry_category");
      next.delete("entry_person");
      next.delete("entry_type");
      return next;
    });
  }

  function openEntryComposer() {
    if (showEntryComposer) {
      closeEntryComposer();
      return;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
    setEntrySubmitError("");
    setEntryDraft(buildEntryDraft(view, accounts, categories, people));
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

  async function saveEntryDraft() {
    setEntrySubmitError("");
    const primarySplit = entryDraft.ownershipType === "shared" ? entryDraft.splits[0] : undefined;
    const response = await fetch("/api/entries/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        date: entryDraft.date,
        description: entryDraft.description,
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
      return;
    }

    closeEntryComposer();
    await onRefresh();
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
      return;
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
      return;
    }

    setEditingEntryId(null);
    setEntrySnapshot(null);
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

  async function addEntryToSplits(entry) {
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
          splitGroupId: null
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setEntrySubmitError(data.error ?? "Failed to add entry to splits.");
        return;
      }

      setEditingEntryId(null);
      setEntrySnapshot(null);
      await onRefresh();
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

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.entries}</h2>
          <span className="panel-context">{messages.entries.viewing(view.label)}</span>
        </div>
        <div className="scope-toggle pill-row scope-toggle-row desktop-scope-toggle">
          {view.monthPage.scopes.map((scope) => (
              <button
                key={scope.key}
                className={`pill scope-button ${scope.key === selectedScope ? "is-active" : ""}`}
                type="button"
                onClick={() => {
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("entries_scope", scope.key);
                    return next;
                  });
                }}
              >
                {scope.label}
              </button>
          ))}
        </div>
      </div>

      <section className="entries-totals-strip" aria-label={messages.entries.totalsLabel}>
        <button
          type="button"
          className={`entries-breakdown-toggle ${showExpenseBreakdown ? "is-open" : ""}`}
          onClick={() => setShowExpenseBreakdown((current) => !current)}
          aria-expanded={showExpenseBreakdown}
          aria-label={showExpenseBreakdown ? "Hide expense breakdown" : "Show expense breakdown"}
        >
          {showExpenseBreakdown ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalSpend}</span>
          <strong className={getAmountToneClass(-entryTotals.spendMinor)}>{money(entryTotals.spendMinor)}</strong>
        </span>
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalIncome}</span>
          <strong className={getAmountToneClass(entryTotals.incomeMinor)}>{money(entryTotals.incomeMinor)}</strong>
        </span>
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalDifference}</span>
          <strong className={getAmountToneClass(entryNetMinor)}>{money(entryNetMinor)}</strong>
        </span>
        <span className="entries-totals-item">
          <span className="entries-totals-label">{messages.entries.totalOutflow}</span>
          <strong className={getAmountToneClass(-entryOutflowMinor)}>{money(entryOutflowMinor)}</strong>
        </span>
        <div className="entries-totals-spacer" />
        <button type="button" className="subtle-action is-primary entries-add-inline" onClick={openEntryComposer}>
          {messages.entries.addEntry}
        </button>
      </section>

      <button
        type="button"
        data-entries-fab-trigger="true"
        className="entries-fab-trigger"
        onClick={openEntryComposer}
        aria-hidden="true"
        tabIndex={-1}
      />

      {showExpenseBreakdown ? (
        <section className="entries-breakdown-panel">
          <div className="entries-breakdown-chart">
            {expenseBreakdown.length ? (
              <SpendingMixChart
                data={expenseBreakdown}
                categories={categories}
                totalLabel={messages.entries.totalSpend}
                compact
                height={300}
                innerRadius={58}
                outerRadius={96}
              />
            ) : (
              <p className="lede compact">{messages.entries.noSpendBreakdown}</p>
            )}
          </div>
          <div className="entries-breakdown-list category-list">
            {expenseBreakdown.map((item, index) => {
              const theme = getCategoryTheme(categories, item, index);
              return (
                <div key={item.key} className="category-row">
                  <div className="category-key">
                    <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                      <CategoryGlyph iconKey={theme.iconKey} />
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{money(item.valueMinor)} • {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={`entries-filter-stack ${showMobileFilters ? "is-open" : ""}`}>
        <button type="button" className="entries-filter-toggle" onClick={() => setShowMobileFilters((current) => !current)}>
          <span>{activeEntryFilterCount ? `Filters · ${activeEntryFilterCount}` : "Filters"}</span>
          <span>{showMobileFilters ? "Hide" : "Show"}</span>
        </button>
        <section className="entries-filter-bar">
          <FilterSelect
            label={messages.entries.wallet}
            value={entryFilters.wallet}
            options={wallets}
            emptyLabel={messages.entries.allWallets}
            onChange={(value) => updateEntryFilter("wallet", value)}
          />
          <FilterSelect
            label={messages.entries.category}
            value={entryFilters.category}
            options={entryCategoryOptions}
            emptyLabel={messages.entries.allCategories}
            onChange={(value) => updateEntryFilter("category", value)}
          />
          <FilterSelect
            label={messages.entries.person}
            value={entryFilters.person}
            options={peopleFilterOptions}
            emptyLabel={messages.entries.allPeople}
            onChange={(value) => updateEntryFilter("person", value)}
          />
          <FilterSelect
            label={messages.entries.type}
            value={entryFilters.type}
            options={["expense", "income", "transfer"]}
            emptyLabel={messages.entries.allTypes}
            onChange={(value) => updateEntryFilter("type", value)}
          />
          <div className="entries-filter-reset">
            <button type="button" className="subtle-action" onClick={resetEntryFilters}>
              {messages.entries.resetFilters}
            </button>
          </div>
        </section>
      </section>

      {showEntryComposer ? (
        <section className="entry-row is-editing entry-composer">
          <div className="entry-inline-editor">
            <div className="entry-edit-grid">
              <label>
                <span>{messages.entries.editDate}</span>
                <input
                  className="table-edit-input"
                  type="date"
                  value={entryDraft.date}
                  onChange={(event) => updateEntryDraft({ date: event.target.value })}
                />
              </label>
              <label>
                <span>{messages.entries.editType}</span>
                <select
                  className="table-edit-input"
                  value={entryDraft.entryType}
                  onChange={(event) => updateEntryDraft({ entryType: event.target.value })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>
              <label>
                <span>{messages.entries.editAmount}</span>
                <input
                  className="table-edit-input table-edit-input-money"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={formatEditableMinorInput(entryDraft.amountMinor)}
                  onChange={(event) => updateEntryDraft({ amountMinor: Math.max(0, parseMoneyInput(event.target.value, entryDraft.amountMinor)) })}
                />
              </label>
              <label>
                <span>{messages.entries.editCategory}</span>
                <div className="entry-category-field">
                  <span
                    className="category-icon category-icon-static"
                    style={{ "--category-color": getCategoryTheme(categories, { categoryName: entryDraft.categoryName }, 0).color }}
                  >
                    <CategoryGlyph iconKey={getCategoryTheme(categories, { categoryName: entryDraft.categoryName }, 0).iconKey} />
                  </span>
                  <select
                    className="table-edit-input"
                    value={entryDraft.categoryName}
                    onChange={(event) => updateEntryDraft({ categoryName: event.target.value })}
                  >
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label>
                <span>{messages.entries.editWallet}</span>
                <select
                  className="table-edit-input"
                  value={entryDraft.accountName}
                  onChange={(event) => updateEntryDraft({ accountName: event.target.value })}
                >
                  {accountOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{messages.entries.editOwner}</span>
                <select
                  className="table-edit-input"
                  value={entryDraft.ownershipType === "shared" ? "Shared" : (entryDraft.ownerName ?? "")}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (nextValue === "Shared") {
                      updateEntryDraft({ ownershipType: "shared", ownerName: undefined });
                    } else {
                      updateEntryDraft({ ownershipType: "direct", ownerName: nextValue });
                    }
                  }}
                >
                  {ownerOptions.map((person) => (
                    <option key={person} value={person}>{person}</option>
                  ))}
                </select>
              </label>
              {entryDraft.entryType === "transfer" ? (
                <label>
                  <span>{messages.entries.editTransferDirection}</span>
                  <select
                    className="table-edit-input"
                    value={entryDraft.transferDirection ?? "out"}
                    onChange={(event) => updateEntryDraft({ transferDirection: event.target.value })}
                  >
                    <option value="out">Transfer out</option>
                    <option value="in">Transfer in</option>
                  </select>
                </label>
              ) : null}
              {entryDraft.ownershipType === "shared" ? (
                <label>
                  <span>{messages.entries.editSplit}</span>
                  <input
                    className="table-edit-input table-edit-input-money"
                    type="number"
                    min="0"
                    max="100"
                    value={getVisibleSplitPercent(entryDraft, view.id) ?? 50}
                    onChange={(event) => {
                      const percentage = Number(event.target.value);
                      updateEntryDraft({
                        splits: applySharedSplit(entryDraft, people, percentage),
                        viewerSplitRatioBasisPoints: view.id === "household" ? undefined : Math.round(percentage * 100)
                      });
                    }}
                  />
                </label>
              ) : null}
            </div>
            <div className="entry-writing-grid">
              <label>
                <span>{messages.entries.editDescription}</span>
                <textarea
                  className="table-edit-input table-edit-textarea"
                  value={entryDraft.description}
                  onChange={(event) => updateEntryDraft({ description: event.target.value })}
                  rows={3}
                />
              </label>
              <label>
                <span>{messages.entries.editNote}</span>
                <textarea
                  className="table-edit-input table-edit-textarea"
                  value={entryDraft.note ?? ""}
                  onChange={(event) => updateEntryDraft({ note: event.target.value })}
                  rows={3}
                />
              </label>
            </div>
            {entrySubmitError ? <p className="entry-submit-error">{entrySubmitError}</p> : null}
            <div className="entry-inline-actions">
              <button type="button" className="icon-action" aria-label="Create entry" onClick={() => void saveEntryDraft()}>
                <Check size={16} />
              </button>
              <button type="button" className="icon-action subtle-cancel" aria-label="Cancel new entry" onClick={closeEntryComposer}>
                <X size={16} />
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="entries-date-groups">
        {groupedEntries.map((group) => (
          <section key={group.date} className="entries-date-group">
            <div className="entries-date-head">
              <strong>{formatDateOnly(group.date)}</strong>
              <span>{messages.entries.dateNet}: {money(group.netMinor)}</span>
            </div>

            <div className="entries-rows">
              {group.entries.map((entry) => {
                const isEditing = editingEntryId === entry.id;
                const ownerLabel = entry.ownershipType === "shared" ? "Shared" : entry.ownerName ?? messages.common.emptyValue;
                const splitPercent = getVisibleSplitPercent(entry, view.id);
                const category = getCategory(categories, entry);
                const transferLabel = entry.entryType === "transfer"
                  ? entry.transferDirection === "in" ? "Transfer in" : "Transfer out"
                  : null;
                const transferDetail = entry.linkedTransfer
                  ? `${entry.transferDirection === "out" ? "To" : "From"} ${entry.linkedTransfer.accountName}`
                  : entry.accountName;
                const signedAmountMinor = getSignedAmountMinor(entry);
                const signedTotalAmountMinor = getSignedTotalAmountMinor(entry);
                const hasWeightedTotal = signedTotalAmountMinor != null && signedTotalAmountMinor !== signedAmountMinor;
                const transferCandidates = entry.entryType === "transfer"
                  ? getTransferMatchCandidates(entry, entries)
                  : [];

                return (
                  <div key={entry.id} className={`entry-row ${isEditing ? "is-editing" : ""}`} id={entry.id}>
                    <button type="button" className="entry-row-main" onClick={() => beginEntryEdit(entry)}>
                      <div className="entry-row-category">
                        <CategoryAppearancePopover
                          category={category}
                          onChange={onCategoryAppearanceChange}
                        />
                        <strong>{category?.name ?? entry.categoryName}</strong>
                      </div>
                      <div className="entry-row-description">
                        <strong>{entry.description}</strong>
                        <p>{entry.note || messages.common.emptyValue}</p>
                      </div>
                      <div className="entry-row-transfer">
                        <strong>{transferDetail}</strong>
                        <p>{entry.accountName}</p>
                      </div>
                      <div className="entry-row-right">
                        <div className="entry-row-amount">
                          <strong className={getAmountToneClass(signedAmountMinor)}>{money(signedAmountMinor)}</strong>
                          {hasWeightedTotal ? <p>({money(signedTotalAmountMinor)} total)</p> : null}
                        </div>
                        <div className="entry-pills">
                          {transferLabel ? <span className="entry-chip entry-chip-transfer">{transferLabel}</span> : null}
                          <span className={`entry-chip ${entry.ownershipType === "shared" ? "entry-chip-shared" : "entry-chip-owner"}`}>{ownerLabel}</span>
                          {entry.ownershipType === "shared" && splitPercent != null ? (
                            <span className="entry-chip entry-chip-split">{splitPercent}%</span>
                          ) : null}
                        </div>
                      </div>
                    </button>

                    {isEditing ? (
                      <div className="entry-inline-editor">
                        <div className="entry-edit-grid">
                          <label>
                            <span>{messages.entries.editDate}</span>
                            <input
                              className="table-edit-input"
                              type="date"
                              value={entry.date}
                              onChange={(event) => updateEntry(entry.id, { date: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>{messages.entries.editType}</span>
                            <select
                              className="table-edit-input"
                              value={entry.entryType}
                              onChange={(event) => updateEntry(entry.id, { entryType: event.target.value })}
                            >
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                              <option value="transfer">Transfer</option>
                            </select>
                          </label>
                          <label>
                            <span>{messages.entries.editAmount}</span>
                            <input
                              className="table-edit-input table-edit-input-money"
                              type="number"
                              step="0.01"
                              inputMode="decimal"
                              value={formatEditableMinorInput(entry.amountMinor)}
                              onChange={(event) => updateEntry(entry.id, { amountMinor: Math.max(0, parseMoneyInput(event.target.value, entry.amountMinor)) })}
                            />
                          </label>
                          <label>
                            <span>{messages.entries.editCategory}</span>
                            {entry.entryType === "transfer" ? (
                              <div className="entry-category-field">
                                <span
                                  className="category-icon category-icon-static"
                                  style={{ "--category-color": getCategoryTheme(categories, { categoryName: "Transfer" }, 0).color }}
                                >
                                  <CategoryGlyph iconKey={getCategoryTheme(categories, { categoryName: "Transfer" }, 0).iconKey} />
                                </span>
                                <input
                                  className="table-edit-input"
                                  value="Transfer"
                                  readOnly
                                />
                              </div>
                            ) : (
                              <div className="entry-category-field">
                                <span
                                  className="category-icon category-icon-static"
                                  style={{ "--category-color": getCategoryTheme(categories, { categoryName: entry.categoryName }, 0).color }}
                                >
                                  <CategoryGlyph iconKey={getCategoryTheme(categories, { categoryName: entry.categoryName }, 0).iconKey} />
                                </span>
                                <select
                                  className="table-edit-input"
                                  value={entry.categoryName}
                                  onChange={(event) => updateEntry(entry.id, { categoryName: event.target.value })}
                                >
                                  {categoryOptions.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </label>
                          <label>
                            <span>{messages.entries.editWallet}</span>
                            <select
                              className="table-edit-input"
                              value={entry.accountName}
                              onChange={(event) => updateEntry(entry.id, { accountName: event.target.value })}
                            >
                              {accountOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>{messages.entries.editOwner}</span>
                            <select
                              className="table-edit-input"
                              value={entry.ownershipType === "shared" ? "Shared" : (entry.ownerName ?? "")}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (nextValue === "Shared") {
                                  updateEntry(entry.id, { ownershipType: "shared", ownerName: undefined });
                                } else {
                                  updateEntry(entry.id, { ownershipType: "direct", ownerName: nextValue });
                                }
                              }}
                            >
                              {ownerOptions.map((person) => (
                                <option key={person} value={person}>{person}</option>
                              ))}
                            </select>
                          </label>
                          {entry.entryType === "transfer" ? (
                            <label>
                              <span>{messages.entries.editTransferDirection}</span>
                              <select
                                className="table-edit-input"
                                value={entry.transferDirection ?? "out"}
                                onChange={(event) => updateEntry(entry.id, { transferDirection: event.target.value })}
                              >
                                <option value="out">Transfer out</option>
                                <option value="in">Transfer in</option>
                              </select>
                            </label>
                          ) : null}
                          {entry.entryType === "transfer" ? (
                            <div className="entry-edit-transfer-helper">
                              <span>Transfer match</span>
                              <Dialog.Root
                                open={transferDialogEntryId === entry.id}
                                onOpenChange={(open) => {
                                  if (open) {
                                    ensureTransferSettlementDraft(entry);
                                    setTransferDialogEntryId(entry.id);
                                    return;
                                  }
                                  setTransferDialogEntryId((current) => current === entry.id ? null : current);
                                }}
                              >
                                <Dialog.Trigger asChild>
                                  <button type="button" className="subtle-action">
                                    Manage transfer
                                  </button>
                                </Dialog.Trigger>
                                <Dialog.Portal>
                                  <Dialog.Overlay className="note-dialog-overlay" />
                                  <Dialog.Content className="note-dialog-content transfer-match-dialog">
                                    <div className="transfer-match-head">
                                      <div>
                                        <Dialog.Title>Transfer details</Dialog.Title>
                                        <Dialog.Description>Relink or unlink this transfer pair together.</Dialog.Description>
                                      </div>
                                      <button
                                        type="button"
                                        className="icon-action subtle-cancel"
                                        aria-label="Close transfer manager"
                                        onClick={() => setTransferDialogEntryId(null)}
                                      >
                                        <X size={16} />
                                      </button>
                                    </div>
                                    <div className="transfer-match-layout">
                                      <section className="transfer-match-section">
                                        <h4>Wallets</h4>
                                        <div className="transfer-wallet-grid">
                                          <div>
                                            <span className="transfer-match-label">From wallet</span>
                                            <strong>{getTransferWallets(entry).fromWalletName}</strong>
                                          </div>
                                          <div>
                                            <span className="transfer-match-label">To wallet</span>
                                            <strong>{getTransferWallets(entry).toWalletName}</strong>
                                          </div>
                                        </div>
                                      </section>
                                      <section className="transfer-match-section">
                                        <h4>Exact matches</h4>
                                        <span className="transfer-match-label">Potential exact matches</span>
                                        <div className="transfer-match-stack">
                                          {transferCandidates.length ? transferCandidates.map((candidate) => {
                                            const isCurrentLink = entry.linkedTransfer?.transactionId === candidate.id;
                                            return (
                                              <div key={candidate.id} className="transfer-match-card">
                                                <div>
                                                  <strong>{candidate.accountName}</strong>
                                                  <p>{formatDateOnly(candidate.date)} • {candidate.description}</p>
                                                </div>
                                                {isCurrentLink ? (
                                                  <span className="entry-chip entry-chip-transfer">Current match</span>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    className="subtle-action"
                                                    disabled={linkingTransferEntryId === entry.id}
                                                    onClick={() => void linkTransferCandidate(entry, candidate)}
                                                  >
                                                    Use match
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          }) : (
                                            <p className="transfer-match-empty">No exact amount match found in another wallet for this month.</p>
                                          )}
                                        </div>
                                      </section>
                                      <section className="transfer-match-section transfer-settlement">
                                        <h4>Break connection</h4>
                                        <span className="transfer-match-label">Break connection and convert both sides</span>
                                        <div className="transfer-settlement-grid">
                                          <label>
                                            <span>This entry becomes</span>
                                            <select
                                              className="table-edit-input"
                                              value={transferSettlementDrafts[entry.id]?.currentCategoryName ?? "Other"}
                                              onChange={(event) => updateTransferSettlementDraft(entry.id, { currentCategoryName: event.target.value })}
                                            >
                                              {categoryOptions.filter((option) => option !== "Transfer").map((option) => (
                                                <option key={option} value={option}>{option}</option>
                                              ))}
                                            </select>
                                          </label>
                                          {entry.linkedTransfer ? (
                                            <label>
                                              <span>Counterpart becomes</span>
                                              <select
                                                className="table-edit-input"
                                                value={transferSettlementDrafts[entry.id]?.counterpartCategoryName ?? "Other"}
                                                onChange={(event) => updateTransferSettlementDraft(entry.id, { counterpartCategoryName: event.target.value })}
                                              >
                                                {categoryOptions.filter((option) => option !== "Transfer").map((option) => (
                                                  <option key={option} value={option}>{option}</option>
                                                ))}
                                              </select>
                                            </label>
                                          ) : null}
                                        </div>
                                        <p className="transfer-match-empty">
                                          This removes the transfer link for both sides so you do not leave the counterpart behind as a transfer.
                                        </p>
                                        <button
                                          type="button"
                                          className="subtle-action"
                                          disabled={settlingTransferEntryId === entry.id}
                                          onClick={() => void settleTransfer(entry)}
                                        >
                                          Break connection
                                        </button>
                                      </section>
                                    </div>
                                  </Dialog.Content>
                                </Dialog.Portal>
                              </Dialog.Root>
                            </div>
                          ) : null}
                          {entry.ownershipType === "shared" && splitPercent != null ? (
                            <label>
                              <span>{messages.entries.editSplit}</span>
                              <input
                                className="table-edit-input table-edit-input-money"
                                type="number"
                                min="0"
                                max="100"
                                value={splitPercent}
                                onChange={(event) => updateEntrySplit(entry.id, Number(event.target.value))}
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="entry-writing-grid">
                          <label>
                            <span>{messages.entries.editDescription}</span>
                            <textarea
                              className="table-edit-input table-edit-textarea"
                              value={entry.description}
                              onChange={(event) => updateEntry(entry.id, { description: event.target.value })}
                              rows={3}
                            />
                          </label>
                          <label>
                            <span>{messages.entries.editNote}</span>
                            <textarea
                              className="table-edit-input table-edit-textarea"
                              value={entry.note ?? ""}
                              onChange={(event) => updateEntry(entry.id, { note: event.target.value })}
                              rows={3}
                            />
                          </label>
                        </div>
                        <div className="entry-inline-actions">
                          {entry.entryType === "expense" ? (
                            <button
                              type="button"
                              className="subtle-action"
                              disabled={addingToSplitsEntryId === entry.id}
                              onClick={() => void addEntryToSplits(entry)}
                            >
                              {messages.entries.addToSplits}
                            </button>
                          ) : null}
                          <button type="button" className="icon-action" aria-label="Done editing entry" onClick={finishEntryEdit}>
                            <Check size={16} />
                          </button>
                          <button type="button" className="icon-action subtle-cancel" aria-label="Cancel editing entry" onClick={cancelEntryEdit}>
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
