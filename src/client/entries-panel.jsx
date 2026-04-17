import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getEntryFormOptions,
  getEntryWalletFilterOptions
} from "./entry-selectors";
import { getVisibleSplitPercent } from "./entry-helpers";

const ENTRIES_PAGE_PREFETCH_DELAY_MS = 160;

export function EntriesPanel({
  view,
  entriesSourceView = view,
  selectedMonth,
  availableMonths,
  accounts,
  categories,
  people,
  onCategoryAppearanceChange,
  onInvalidateBootstrapCache
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [entriesPage, setEntriesPage] = useState(() => buildInitialEntriesPage(view));
  const [isEntriesPageLoading, setIsEntriesPageLoading] = useState(false);
  const entriesPageCacheRef = useRef(new Map());
  const entriesPageInflightRef = useRef(new Map());
  const entriesPageCacheVersionRef = useRef(0);
  const entriesPagePrefetchTimerRef = useRef(null);
  const entriesPageParams = useMemo(
    () => buildEntriesPageParams({
      viewId: entriesSourceView.id,
      month: selectedMonth
    }),
    [entriesSourceView.id, selectedMonth]
  );
  const entriesPageCacheKey = entriesPageParams.toString();
  const entryView = useMemo(
    () => ({
      ...view,
      monthPage: {
        ...view.monthPage,
        month: entriesPage.monthPage.month,
        entries: entriesPage.monthPage.entries
      }
    }),
    [entriesPage, view]
  );

  const clearEntriesPageCache = useCallback(() => {
    entriesPageCacheVersionRef.current += 1;
    entriesPageCacheRef.current.clear();
    entriesPageInflightRef.current.clear();
  }, []);

  const fetchEntriesPage = useCallback(async (params, { bypassCache = false, signal } = {}) => {
    const cacheKey = params.toString();
    const cacheVersion = entriesPageCacheVersionRef.current;
    if (signal?.aborted) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }

    if (!bypassCache && entriesPageCacheRef.current.has(cacheKey)) {
      return entriesPageCacheRef.current.get(cacheKey);
    }

    if (!bypassCache && entriesPageInflightRef.current.has(cacheKey)) {
      const data = await entriesPageInflightRef.current.get(cacheKey);
      if (signal?.aborted) {
        throw new DOMException("Entries page request aborted.", "AbortError");
      }
      return data;
    }

    const request = fetch(`/api/entries-page?${cacheKey}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message ?? data.error ?? "Entries page failed.");
        }
        if (entriesPageCacheVersionRef.current === cacheVersion) {
          entriesPageCacheRef.current.set(cacheKey, data);
        }
        return data;
      })
      .finally(() => {
        entriesPageInflightRef.current.delete(cacheKey);
      });

    entriesPageInflightRef.current.set(cacheKey, request);
    const data = await request;
    if (signal?.aborted || entriesPageCacheVersionRef.current !== cacheVersion) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }
    return data;
  }, []);

  const refreshEntriesPage = useCallback(async ({ bypassCache = false, invalidateBootstrap = false } = {}) => {
    if (bypassCache) {
      clearEntriesPageCache();
    }
    if (invalidateBootstrap) {
      onInvalidateBootstrapCache?.();
    }
    setIsEntriesPageLoading(true);
    try {
      const data = await fetchEntriesPage(entriesPageParams, { bypassCache });
      setEntriesPage(data);
      return data;
    } finally {
      setIsEntriesPageLoading(false);
    }
  }, [clearEntriesPageCache, entriesPageParams, fetchEntriesPage, onInvalidateBootstrapCache]);

  useEffect(() => {
    clearEntriesPageCache();
    setEntriesPage(buildInitialEntriesPage(entriesSourceView));
  }, [clearEntriesPageCache, entriesSourceView]);

  useEffect(() => {
    const controller = new AbortController();
    const hasCachedPage = entriesPageCacheRef.current.has(entriesPageCacheKey);
    setIsEntriesPageLoading(!hasCachedPage);

    void fetchEntriesPage(entriesPageParams, { signal: controller.signal })
      .then(async (data) => {
        if (controller.signal.aborted) {
          return;
        }
        setEntriesPage(data);
        setIsEntriesPageLoading(false);

        if (!hasCachedPage) {
          return;
        }

        try {
          const freshData = await fetchEntriesPage(entriesPageParams, {
            bypassCache: true,
            signal: controller.signal
          });
          if (!controller.signal.aborted) {
            setEntriesPage(freshData);
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setIsEntriesPageLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [entriesPageCacheKey, entriesPageParams, fetchEntriesPage]);

  useEffect(() => {
    if (!availableMonths.length || typeof window === "undefined" || window.navigator?.connection?.saveData) {
      return undefined;
    }

    entriesPagePrefetchTimerRef.current = window.setTimeout(() => {
      const currentIndex = availableMonths.indexOf(selectedMonth);
      if (currentIndex === -1) {
        return;
      }

      for (const offset of [-1, 1]) {
        const adjacentMonth = availableMonths[currentIndex + offset];
        if (!adjacentMonth) {
          continue;
        }
        void fetchEntriesPage(buildEntriesPageParams({ viewId: entriesSourceView.id, month: adjacentMonth })).catch(() => {});
      }
    }, ENTRIES_PAGE_PREFETCH_DELAY_MS);

    return () => {
      if (entriesPagePrefetchTimerRef.current) {
        window.clearTimeout(entriesPagePrefetchTimerRef.current);
        entriesPagePrefetchTimerRef.current = null;
      }
    };
  }, [availableMonths, entriesSourceView.id, fetchEntriesPage, selectedMonth]);

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
    updateEntrySplit,
    saveEntryCategory
  } = useEntryActions({
    view: entryView,
    accounts,
    categories,
    people,
    onRefresh: () => refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true })
  });
  const selectedScope = searchParams.get("entries_scope") ?? entryView.monthPage.selectedScope;
  const defaultEntryPerson = entryView.id !== "household" ? entryView.label : "";
  const entryFilters = {
    wallet: searchParams.get("entry_wallet") ?? "",
    category: searchParams.get("entry_category") ?? "",
    person: searchParams.get("entry_person") ?? defaultEntryPerson,
    type: searchParams.get("entry_type") ?? ""
  };

  useEffect(() => {
    setShowExpenseBreakdown(false);
    setShowMobileFilters(false);
  }, [entryView]);

  const wallets = useMemo(
    () => getEntryWalletFilterOptions(accounts),
    [accounts]
  );
  const { entryCategoryOptions, peopleFilterOptions } = useMemo(
    () => getEntryFilterOptions(entries),
    [entries]
  );
  useEffect(() => {
    const wallet = searchParams.get("entry_wallet");
    const category = searchParams.get("entry_category");
    const person = searchParams.get("entry_person");
    const walletValues = wallets.map((option) => option.value);
    const walletIsStale = wallet && !walletValues.includes(wallet) && !entries.some((entry) => entry.accountName === wallet);
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
  }, [entries, entryCategoryOptions, peopleFilterOptions, searchParams, setSearchParams, wallets]);
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
    () => getEntryDerivedData({ entries, entryFilters, selectedScope, viewId: entryView.id }),
    [entries, entryFilters, selectedScope, entryView.id]
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
    <article className="panel entries-panel-root">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.entries}</h2>
          <span className="panel-context">{messages.entries.viewing(entryView.label)}</span>
        </div>
        <div className="scope-toggle pill-row scope-toggle-row desktop-scope-toggle">
          {entryView.monthPage.scopes.map((scope) => (
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
        onRefresh={() => refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true })}
      />

      {isEntriesPageLoading ? (
        <div className="app-loading-overlay entries-page-loading" role="status" aria-live="polite">
          <span className="app-spinner" aria-hidden="true" />
          <span>{messages.common.loadingLatest}</span>
        </div>
      ) : null}

      {showEntryComposer ? (
        <section className="entry-row is-editing entry-composer">
          <div className="entry-inline-editor">
            <EntryEditorFields
              entry={entryDraft}
              categories={categories}
              categoryOptions={categoryOptions}
              accountOptions={accountOptions}
              ownerOptions={ownerOptions}
              splitPercentValue={entryDraft.ownershipType === "shared" ? getVisibleSplitPercent(entryDraft, entryView.id) ?? 50 : null}
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
        viewId={entryView.id}
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
        onSaveEntryCategory={saveEntryCategory}
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

function buildInitialEntriesPage(view) {
  return {
    viewId: view.id,
    label: view.label,
    monthPage: {
      month: view.monthPage.month,
      selectedPersonId: view.monthPage.selectedPersonId,
      selectedScope: view.monthPage.selectedScope,
      scopes: view.monthPage.scopes,
      entries: view.monthPage.entries
    }
  };
}

function buildEntriesPageParams({ viewId, month }) {
  return new URLSearchParams({
    view: viewId,
    month
  });
}
