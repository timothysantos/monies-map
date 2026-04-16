import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { useEntryActions } from "./entry-actions";
import { EntryEditorFields } from "./entry-editor";
import { EntriesDateGroups } from "./entries-list";
import { EntriesBreakdownPanel, EntriesFilterStack, EntriesTotalsStrip } from "./entries-overview";
import {
  getActiveEntryFilterCount,
  getEntryDerivedData,
  getEntryFilterOptions,
  getEntryFormOptions
} from "./entry-selectors";
import { getVisibleSplitPercent } from "./entry-helpers";

export function EntriesPanel({ view, accounts, categories, people, onCategoryAppearanceChange, onRefresh }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const {
    entries,
    editingEntryId,
    showEntryComposer,
    entryDraft,
    entrySubmitError,
    linkingTransferEntryId,
    settlingTransferEntryId,
    transferSettlementDrafts,
    transferDialogEntryId,
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
    ensureTransferSettlementDraft,
    updateTransferSettlementDraft,
    settleTransfer,
    addEntryToSplits,
    updateEntry,
    updateEntrySplit
  } = useEntryActions({ view, accounts, categories, people, onRefresh });
  const selectedScope = searchParams.get("entries_scope") ?? view.monthPage.selectedScope;
  const defaultEntryPerson = view.id !== "household" ? view.label : "";
  const entryFilters = {
    wallet: searchParams.get("entry_wallet") ?? "",
    category: searchParams.get("entry_category") ?? "",
    person: searchParams.get("entry_person") ?? defaultEntryPerson,
    type: searchParams.get("entry_type") ?? ""
  };

  useEffect(() => {
    setShowExpenseBreakdown(false);
    setShowMobileFilters(false);
  }, [view]);

  const { wallets, entryCategoryOptions, peopleFilterOptions } = useMemo(
    () => getEntryFilterOptions(entries),
    [entries]
  );
  useEffect(() => {
    const wallet = searchParams.get("entry_wallet");
    const category = searchParams.get("entry_category");
    const person = searchParams.get("entry_person");
    const walletIsStale = wallet && !wallets.includes(wallet);
    const categoryIsStale = category && !entryCategoryOptions.includes(category);
    const personIsStale = person && !peopleFilterOptions.includes(person);

    if (!walletIsStale && !categoryIsStale && !personIsStale) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (walletIsStale) {
        next.delete("entry_wallet");
      }
      if (categoryIsStale) {
        next.delete("entry_category");
      }
      if (personIsStale) {
        next.delete("entry_person");
      }
      return next;
    }, { replace: true });
  }, [entryCategoryOptions, peopleFilterOptions, searchParams, setSearchParams, wallets]);
  const { categoryOptions, accountOptions, ownerOptions } = useMemo(
    () => getEntryFormOptions({ accounts, categories, people }),
    [accounts, categories, people]
  );
  const activeEntryFilterCount = useMemo(
    () => getActiveEntryFilterCount(entryFilters),
    [entryFilters]
  );
  const {
    groupedEntries,
    entryTotals,
    entryOutflowMinor,
    entryNetMinor,
    expenseBreakdown
  } = useMemo(
    () => getEntryDerivedData({ entries, entryFilters, selectedScope, viewId: view.id }),
    [entries, entryFilters, selectedScope, view.id]
  );

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

      <EntriesTotalsStrip
        showExpenseBreakdown={showExpenseBreakdown}
        entryTotals={entryTotals}
        entryOutflowMinor={entryOutflowMinor}
        entryNetMinor={entryNetMinor}
        onToggleExpenseBreakdown={() => setShowExpenseBreakdown((current) => !current)}
        onAddEntry={openEntryComposer}
      />

      <button
        type="button"
        data-entries-fab-trigger="true"
        className="entries-fab-trigger"
        onClick={openEntryComposer}
        aria-hidden="true"
        tabIndex={-1}
      />

      {showExpenseBreakdown ? (
        <EntriesBreakdownPanel expenseBreakdown={expenseBreakdown} categories={categories} />
      ) : null}

      <EntriesFilterStack
        showMobileFilters={showMobileFilters}
        activeEntryFilterCount={activeEntryFilterCount}
        entryFilters={entryFilters}
        wallets={wallets}
        entryCategoryOptions={entryCategoryOptions}
        peopleFilterOptions={peopleFilterOptions}
        onToggleMobileFilters={() => setShowMobileFilters((current) => !current)}
        onChangeFilter={updateEntryFilter}
        onResetFilters={resetEntryFilters}
      />

      {showEntryComposer ? (
        <section className="entry-row is-editing entry-composer">
          <div className="entry-inline-editor">
            <EntryEditorFields
              entry={entryDraft}
              categories={categories}
              categoryOptions={categoryOptions}
              accountOptions={accountOptions}
              ownerOptions={ownerOptions}
              splitPercentValue={entryDraft.ownershipType === "shared" ? getVisibleSplitPercent(entryDraft, view.id) ?? 50 : null}
              onChange={updateEntryDraft}
              onCategoryAppearanceChange={onCategoryAppearanceChange}
              onOwnerChange={updateEntryDraftOwner}
              onSplitPercentChange={updateEntryDraftSplit}
            />
            {entrySubmitError ? <p className="entry-submit-error">{entrySubmitError}</p> : null}
            <div className="entry-inline-actions">
              <button type="button" className="inline-action-button inline-save-action" aria-label="Create entry" onClick={() => void saveEntryDraft()}>
                <Check size={16} />
                <span className="desktop-action-label">Save</span>
              </button>
              <button type="button" className="inline-action-button inline-cancel-action" aria-label="Cancel new entry" onClick={closeEntryComposer}>
                <X size={16} />
                <span className="desktop-action-label">Cancel</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <EntriesDateGroups
        groupedEntries={groupedEntries}
        allEntries={entries}
        categories={categories}
        categoryOptions={categoryOptions}
        accountOptions={accountOptions}
        ownerOptions={ownerOptions}
        viewId={view.id}
        editingEntryId={editingEntryId}
        addingToSplitsEntryId={addingToSplitsEntryId}
        transferDialogEntryId={transferDialogEntryId}
        transferSettlementDrafts={transferSettlementDrafts}
        linkingTransferEntryId={linkingTransferEntryId}
        settlingTransferEntryId={settlingTransferEntryId}
        onBeginEntryEdit={beginEntryEdit}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
        onUpdateEntry={updateEntry}
        onUpdateEntrySplit={updateEntrySplit}
        onEnsureTransferSettlementDraft={ensureTransferSettlementDraft}
        onTransferDialogEntryChange={setTransferDialogEntryId}
        onUpdateTransferSettlementDraft={updateTransferSettlementDraft}
        onLinkTransferCandidate={linkTransferCandidate}
        onSettleTransfer={settleTransfer}
        onAddEntryToSplits={addEntryToSplits}
        onFinishEntryEdit={finishEntryEdit}
        onCancelEntryEdit={cancelEntryEdit}
      />
    </article>
  );
}
