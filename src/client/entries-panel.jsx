import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { useEntryActions } from "./entry-actions";
import { EntryEditorFields, EntryTransferTools } from "./entry-editor";
import { EntriesDateGroups } from "./entries-list";
import { EntriesBreakdownPanel, EntriesFilterStack, EntriesTotalsStrip } from "./entries-overview";
import {
  getActiveEntryFilterCount,
  getEntryDerivedData,
  getEntryFilterOptions,
  getEntryFormOptions,
  getEntryWalletFilterOptions
} from "./entry-selectors";
import { getTransferMatchCandidates, getVisibleSplitPercent } from "./entry-helpers";
import { formatDateOnly, parseDraftMoneyInput } from "./formatters";
import { buildRequestErrorMessage } from "./request-errors";
import { ResponsiveSelect } from "./responsive-select";
import { deleteSplitExpense } from "./splits-api";

const ENTRIES_PAGE_PREFETCH_DELAY_MS = 1200;
const ENTRIES_PAGE_PREFETCH_SPACING_MS = 650;
const QUICK_EXPENSE_DRAFT_STORAGE_KEY = "monies.quickExpenseDraft";
const QUICK_EXPENSE_DRAFT_STORAGE_TTL_MS = 15 * 60 * 1000;
const NON_GROUP_SPLIT_VALUE = "__split_group_none__";

function waitFor(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function EntriesPanel({
  view,
  entriesSourceView = view,
  selectedMonth,
  availableMonths,
  accounts,
  categories,
  people,
  onCategoryAppearanceChange,
  onInvalidateBootstrapCache,
  entriesPageCache
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [useMobileEntrySheet, setUseMobileEntrySheet] = useState(false);
  const [entriesPage, setEntriesPage] = useState(() => buildInitialEntriesPage(view));
  const [isEntriesPageLoading, setIsEntriesPageLoading] = useState(false);
  const [isQuickExpenseSaving, setIsQuickExpenseSaving] = useState(false);
  const [isConfirmingAddToSplits, setIsConfirmingAddToSplits] = useState(false);
  const [quickExpensePendingKey, setQuickExpensePendingKey] = useState("");
  const [quickExpenseWarning, setQuickExpenseWarning] = useState("");
  const [pendingLinkedEntryId, setPendingLinkedEntryId] = useState(() => searchParams.get("editing_entry") ?? "");
  const [createdSplitAction, setCreatedSplitAction] = useState(null);
  const [deletingCreatedSplitId, setDeletingCreatedSplitId] = useState("");
  const [createdSplitActionError, setCreatedSplitActionError] = useState("");
  const [isMobileSplitPickerOpen, setIsMobileSplitPickerOpen] = useState(false);
  const [isMobileSplitSelectorOpen, setIsMobileSplitSelectorOpen] = useState(false);
  const [mobileSplitGroupId, setMobileSplitGroupId] = useState("");
  const fallbackEntriesPageCacheRef = useRef(new Map());
  const fallbackEntriesPageInflightRef = useRef(new Map());
  const fallbackEntriesPageCacheVersionRef = useRef(0);
  const entriesPagePrefetchTimerRef = useRef(null);
  const handledQuickExpenseKeyRef = useRef("");
  const pendingQuickExpenseDraftRef = useRef(null);
  const entriesPageCacheRefs = useMemo(() => entriesPageCache ?? {
    cacheRef: fallbackEntriesPageCacheRef,
    inflightRef: fallbackEntriesPageInflightRef,
    versionRef: fallbackEntriesPageCacheVersionRef
  }, [entriesPageCache]);
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
    if (entriesPageCache?.clear) {
      entriesPageCache.clear();
      return;
    }
    entriesPageCacheRefs.versionRef.current += 1;
    entriesPageCacheRefs.cacheRef.current.clear();
    entriesPageCacheRefs.inflightRef.current.clear();
  }, [entriesPageCache, entriesPageCacheRefs]);

  const fetchEntriesPage = useCallback(async (params, { bypassCache = false, signal } = {}) => {
    const cacheKey = params.toString();
    const cacheVersion = entriesPageCacheRefs.versionRef.current;
    if (signal?.aborted) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }

    if (!bypassCache && entriesPageCacheRefs.cacheRef.current.has(cacheKey)) {
      return entriesPageCacheRefs.cacheRef.current.get(cacheKey);
    }

    if (!bypassCache && entriesPageCacheRefs.inflightRef.current.has(cacheKey)) {
      const data = await entriesPageCacheRefs.inflightRef.current.get(cacheKey);
      if (signal?.aborted) {
        throw new DOMException("Entries page request aborted.", "AbortError");
      }
      return data;
    }

    const request = fetch(`/api/entries-page?${cacheKey}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await buildRequestErrorMessage(response, "Entries page failed."));
        }
        const data = await response.json();
        if (entriesPageCacheRefs.versionRef.current === cacheVersion) {
          entriesPageCacheRefs.cacheRef.current.set(cacheKey, data);
        }
        return data;
      })
      .finally(() => {
        entriesPageCacheRefs.inflightRef.current.delete(cacheKey);
      });

    entriesPageCacheRefs.inflightRef.current.set(cacheKey, request);
    const data = await request;
    if (signal?.aborted || entriesPageCacheRefs.versionRef.current !== cacheVersion) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }
    return data;
  }, [entriesPageCacheRefs]);

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
    const initialPage = buildInitialEntriesPage(entriesSourceView);
    if (initialPage.monthPage.month !== selectedMonth) {
      return;
    }

    setEntriesPage(initialPage);
  }, [entriesPageCacheKey, entriesPageCacheRefs, entriesSourceView, selectedMonth]);

  useEffect(() => {
    const controller = new AbortController();
    const hasCachedPage = entriesPageCacheRefs.cacheRef.current.has(entriesPageCacheKey);
    setIsEntriesPageLoading(!hasCachedPage);

    void fetchEntriesPage(entriesPageParams, { signal: controller.signal })
      .then(async (data) => {
        if (controller.signal.aborted) {
          return;
        }
        setEntriesPage(data);
        setIsEntriesPageLoading(false);
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
    if (
      !availableMonths.length
      || typeof window === "undefined"
      || window.navigator?.connection?.saveData
      || window.matchMedia?.("(pointer: coarse)")?.matches
    ) {
      return undefined;
    }

    let isCancelled = false;
    const entriesPageVersion = entriesPageCacheRefs.versionRef.current;

    entriesPagePrefetchTimerRef.current = window.setTimeout(() => {
      const currentIndex = availableMonths.indexOf(selectedMonth);
      if (currentIndex === -1) {
        return;
      }

      void (async () => {
        for (const offset of [-1, 1]) {
          if (isCancelled || entriesPageCacheRefs.versionRef.current !== entriesPageVersion) {
            return;
          }
          const adjacentMonth = availableMonths[currentIndex + offset];
          if (!adjacentMonth) {
            continue;
          }
          await fetchEntriesPage(buildEntriesPageParams({ viewId: entriesSourceView.id, month: adjacentMonth })).catch(() => {});
          if (!isCancelled) {
            await waitFor(ENTRIES_PAGE_PREFETCH_SPACING_MS);
          }
        }
      })();
    }, ENTRIES_PAGE_PREFETCH_DELAY_MS);

    return () => {
      isCancelled = true;
      if (entriesPagePrefetchTimerRef.current) {
        window.clearTimeout(entriesPagePrefetchTimerRef.current);
        entriesPagePrefetchTimerRef.current = null;
      }
    };
  }, [availableMonths, entriesPageCacheRefs, entriesSourceView.id, fetchEntriesPage, selectedMonth]);

  const {
    entries,
    editingEntryId,
    showEntryComposer,
    entryDraft,
    entrySubmitError,
    isSavingEntryDraft,
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
  const openEntryComposerRef = useRef(openEntryComposer);
  const entryComposerEditorRef = useRef(null);
  const selectedScope = searchParams.get("entries_scope") ?? entryView.monthPage.selectedScope;
  const defaultEntryPerson = entryView.id !== "household" ? entryView.label : "";
  const entryFilters = {
    wallet: searchParams.get("entry_wallet") ?? "",
    category: searchParams.get("entry_category") ?? "",
    person: searchParams.get("entry_person") ?? defaultEntryPerson,
    type: searchParams.get("entry_type") ?? ""
  };

  useEffect(() => {
    openEntryComposerRef.current = openEntryComposer;
  }, [openEntryComposer]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const update = () => setUseMobileEntrySheet(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!showEntryComposer) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      entryComposerEditorRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showEntryComposer]);

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
  useEffect(() => {
    const quickAction = searchParams.get("action");
    if (quickAction !== "add-expense" && quickAction !== "quick-expense") {
      return;
    }
    const quickExpenseKey = buildQuickExpenseKey(searchParams);
    if (handledQuickExpenseKeyRef.current === quickExpenseKey) {
      return;
    }
    handledQuickExpenseKeyRef.current = quickExpenseKey;

    const quickExpenseDraft = buildQuickExpenseDraftPatch({
      searchParams,
      accountOptions,
      categoryOptions,
      ownerOptions,
      fallbackOwnerName: defaultEntryPerson || people[0]?.name
    });
    pendingQuickExpenseDraftRef.current = quickExpenseDraft.draft;
    setQuickExpenseWarning(quickExpenseDraft.warning);
    storeQuickExpenseDraft(quickExpenseKey, quickExpenseDraft.draft, quickExpenseDraft.warning);
    setQuickExpensePendingKey(quickExpenseKey);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      QUICK_EXPENSE_PARAMS.forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  }, [accountOptions, categoryOptions, defaultEntryPerson, ownerOptions, people, searchParams, setSearchParams]);

  useEffect(() => {
    const linkedEntryId = searchParams.get("editing_entry") ?? "";
    if (!linkedEntryId || linkedEntryId === pendingLinkedEntryId) {
      return;
    }

    setPendingLinkedEntryId(linkedEntryId);
  }, [pendingLinkedEntryId, searchParams]);

  useEffect(() => {
    if (
      quickExpensePendingKey
      || pendingQuickExpenseDraftRef.current
      || showEntryComposer
      || isQuickExpenseSaving
      || editingEntryId
      || searchParams.get("editing_entry")
    ) {
      return;
    }

    const storedDraft = readStoredQuickExpenseDraft();
    if (!storedDraft) {
      return;
    }

    pendingQuickExpenseDraftRef.current = storedDraft.draft;
    setQuickExpenseWarning(storedDraft.warning ?? "");
    setQuickExpensePendingKey(storedDraft.key);
  }, [editingEntryId, isQuickExpenseSaving, quickExpensePendingKey, searchParams, showEntryComposer]);

  useEffect(() => {
    if (
      !quickExpensePendingKey
      || !pendingQuickExpenseDraftRef.current
      || isEntriesPageLoading
      || entriesPage.monthPage.month !== selectedMonth
    ) {
      return undefined;
    }

    const draftPatch = pendingQuickExpenseDraftRef.current;
    pendingQuickExpenseDraftRef.current = null;
    setQuickExpensePendingKey("");
    openEntryComposerRef.current(draftPatch);
    return undefined;
  }, [entriesPage.monthPage.month, isEntriesPageLoading, quickExpensePendingKey, selectedMonth]);

  useEffect(() => {
    if (!pendingLinkedEntryId || isEntriesPageLoading || editingEntryId === pendingLinkedEntryId) {
      return;
    }

    const linkedEntry = entries.find((entry) => entry.id === pendingLinkedEntryId);
    if (!linkedEntry) {
      return;
    }

    pendingQuickExpenseDraftRef.current = null;
    setQuickExpensePendingKey("");
    setQuickExpenseWarning("");
    clearStoredQuickExpenseDraft();
    beginEntryEdit(linkedEntry);
  }, [beginEntryEdit, editingEntryId, entries, isEntriesPageLoading, pendingLinkedEntryId]);

  function clearEditingEntrySearchParam() {
    setPendingLinkedEntryId("");
    setSearchParams((current) => {
      if (!current.get("editing_entry")) {
        return current;
      }
      const next = new URLSearchParams(current);
      next.delete("editing_entry");
      return next;
    }, { replace: true });
  }

  async function saveEntryDraftAndClearQuickExpense() {
    if (isSavingEntryDraft || isQuickExpenseSaving) {
      return;
    }

    setIsQuickExpenseSaving(true);
    try {
      const saved = await saveEntryDraft();
      if (saved) {
        pendingQuickExpenseDraftRef.current = null;
        setQuickExpensePendingKey("");
        setQuickExpenseWarning("");
        clearStoredQuickExpenseDraft();
      }
    } finally {
      setIsQuickExpenseSaving(false);
    }
  }

  function closeEntryComposerAndClearQuickExpense() {
    pendingQuickExpenseDraftRef.current = null;
    setQuickExpensePendingKey("");
    setQuickExpenseWarning("");
    clearStoredQuickExpenseDraft();
    closeEntryComposer();
  }
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
  const canPortalEntryComposer = typeof document !== "undefined";
  const activeEditingEntry = useMemo(
    () => editingEntryId ? entries.find((entry) => entry.id === editingEntryId) ?? null : null,
    [editingEntryId, entries]
  );
  const activeEditingEntryBankState = useMemo(
    () => activeEditingEntry ? getEntryBankState(activeEditingEntry) : null,
    [activeEditingEntry]
  );
  const splitGroupOptions = useMemo(
    () => [
      { value: "", label: "Choose split group" },
      ...entriesPage.splitGroups.map((group) => ({
        value: group.id === "split-group-none" ? NON_GROUP_SPLIT_VALUE : group.id,
        label: group.name
      }))
    ],
    [entriesPage.splitGroups]
  );
  const singleSplitGroupValue = entriesPage.splitGroups.length === 1
    ? (entriesPage.splitGroups[0].id === "split-group-none"
        ? NON_GROUP_SPLIT_VALUE
        : entriesPage.splitGroups[0].id)
    : null;
  const activeLinkedSplitExpenseId = createdSplitAction && createdSplitAction.entryId === activeEditingEntry?.id
    ? createdSplitAction.splitExpenseId
    : activeEditingEntry?.linkedSplitExpenseId;

  useEffect(() => {
    setIsConfirmingAddToSplits(false);
    setIsMobileSplitPickerOpen(false);
    setIsMobileSplitSelectorOpen(false);
    setMobileSplitGroupId("");
  }, [activeEditingEntry?.id]);

  useEffect(() => {
    if (!createdSplitAction) {
      return;
    }

    if (activeEditingEntry && activeEditingEntry.id !== createdSplitAction.entryId) {
      setCreatedSplitAction(null);
      setDeletingCreatedSplitId("");
      setCreatedSplitActionError("");
    }
  }, [activeEditingEntry, createdSplitAction]);

  function closeEntryEditSheet() {
    clearEditingEntrySearchParam();
    setCreatedSplitAction(null);
    setDeletingCreatedSplitId("");
    setCreatedSplitActionError("");
    setIsConfirmingAddToSplits(false);
    setIsMobileSplitPickerOpen(false);
    setIsMobileSplitSelectorOpen(false);
    setMobileSplitGroupId("");
    cancelEntryEdit();
  }

  async function finishEntryEditAndClearLink() {
    const saved = await finishEntryEdit();
    if (saved) {
      clearEditingEntrySearchParam();
    }
  }

  function preserveEntryEditorInUrl(entryId) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("editing_entry", entryId);
      return next;
    }, { replace: true });
  }

  async function handleAddEntryToSplits(entry, splitGroupId = null) {
    setCreatedSplitActionError("");
    clearEditingEntrySearchParam();
    const result = await addEntryToSplits(entry, splitGroupId);
    if (result?.alreadyLinked) {
      await refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true });
      return;
    }

    if (!result?.splitExpenseId) {
      return;
    }

    setCreatedSplitAction(null);
    setIsConfirmingAddToSplits(false);
    setIsMobileSplitPickerOpen(false);
    setIsMobileSplitSelectorOpen(false);
    setMobileSplitGroupId("");
  }

  async function handleMobileSplitGroupSelection(nextGroupId) {
    setMobileSplitGroupId(nextGroupId);
    if (!activeEditingEntry || !nextGroupId) {
      return;
    }

    await handleAddEntryToSplits(
      activeEditingEntry,
      nextGroupId === NON_GROUP_SPLIT_VALUE ? null : nextGroupId
    );
  }

  async function handleDeleteCreatedSplit(entryId, splitExpenseId) {
    preserveEntryEditorInUrl(entryId);
    setDeletingCreatedSplitId(splitExpenseId);
    setCreatedSplitActionError("");
    try {
      await deleteSplitExpense(splitExpenseId);
      setCreatedSplitAction((current) => (
        current?.splitExpenseId === splitExpenseId ? null : current
      ));
      await refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true });
    } catch (error) {
      setCreatedSplitActionError(error instanceof Error ? error.message : "Failed to delete split expense.");
    } finally {
      setDeletingCreatedSplitId("");
    }
  }

  function openCreatedSplit(entryId, splitExpenseId) {
    setCreatedSplitAction(null);
    navigate({
      pathname: "/splits",
      search: (() => {
        const next = new URLSearchParams(searchParams);
        next.delete("editing_entry");
        next.set("editing_split_expense", splitExpenseId);
        next.set("split_mode", "entries");
        return next.toString();
      })()
    });
  }

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

      {showEntryComposer && !useMobileEntrySheet ? (
        <section className="entry-row is-editing entry-composer">
          <div className="entry-inline-editor">
            {quickExpenseWarning ? <p className="entry-submit-error">{quickExpenseWarning}</p> : null}
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
              <button
                type="button"
                className="inline-action-button inline-save-action"
                aria-label="Create entry"
                disabled={isSavingEntryDraft || isQuickExpenseSaving}
                onClick={() => void saveEntryDraftAndClearQuickExpense()}
              >
                <Check size={16} />
                <span className="desktop-action-label">{isSavingEntryDraft || isQuickExpenseSaving ? "Saving..." : "Save"}</span>
              </button>
              <button
                type="button"
                className="inline-action-button inline-cancel-action"
                aria-label="Cancel new entry"
                disabled={isSavingEntryDraft || isQuickExpenseSaving}
                onClick={closeEntryComposerAndClearQuickExpense}
              >
                <X size={16} />
                <span className="desktop-action-label">Cancel</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {showEntryComposer && canPortalEntryComposer && useMobileEntrySheet ? createPortal(
        <EntryMobileSheet
          title="Add entry"
          description="Create a ledger row without leaving the Entries page."
          errorMessage={entrySubmitError || quickExpenseWarning}
          saveLabel={isSavingEntryDraft || isQuickExpenseSaving ? "Saving..." : "Save"}
          isSaveDisabled={isSavingEntryDraft || isQuickExpenseSaving}
          onClose={closeEntryComposerAndClearQuickExpense}
          onSave={() => void saveEntryDraftAndClearQuickExpense()}
        >
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
        </EntryMobileSheet>,
        document.body
      ) : null}

      {activeEditingEntry && canPortalEntryComposer && useMobileEntrySheet ? createPortal(
        <EntryMobileSheet
          title="Edit entry"
          description="Update the row in a bottom sheet instead of editing inline."
          errorMessage={entrySubmitError || createdSplitActionError}
          saveLabel="Save"
          footerContent={activeEditingEntry.entryType === "expense"
            ? (
                activeLinkedSplitExpenseId ? (
                  <div className="entry-inline-actions entry-mobile-sheet-actions entry-mobile-sheet-linked-actions">
                    <button
                      type="button"
                      className="subtle-action entry-mobile-sheet-secondary"
                      disabled={deletingCreatedSplitId === activeLinkedSplitExpenseId}
                      onClick={() => openCreatedSplit(activeEditingEntry.id, activeLinkedSplitExpenseId)}
                    >
                      View split
                    </button>
                    <button
                      type="button"
                      className="subtle-action entry-mobile-sheet-secondary"
                      disabled={deletingCreatedSplitId === activeLinkedSplitExpenseId}
                      onClick={() => void handleDeleteCreatedSplit(activeEditingEntry.id, activeLinkedSplitExpenseId)}
                    >
                      {deletingCreatedSplitId === activeLinkedSplitExpenseId ? messages.common.working : "Delete split"}
                    </button>
                    <span className="entry-mobile-sheet-action-divider" aria-hidden="true">|</span>
                    <button type="button" className="subtle-cancel" onClick={closeEntryEditSheet}>Cancel</button>
                    <button type="button" className="dialog-primary" onClick={() => void finishEntryEditAndClearLink()}>Save</button>
                  </div>
                ) : isConfirmingAddToSplits ? (
                  <div className="entry-mobile-sheet-confirm-actions">
                    <span className="entry-mobile-sheet-confirm-copy">Add this entry to Splits?</span>
                    <div className="entry-mobile-sheet-confirm-buttons">
                      <button
                        type="button"
                        className="subtle-cancel"
                        disabled={addingToSplitsEntryId === activeEditingEntry.id}
                        onClick={() => setIsConfirmingAddToSplits(false)}
                      >
                        Not now
                      </button>
                      <button
                        type="button"
                        className="dialog-primary"
                        disabled={addingToSplitsEntryId === activeEditingEntry.id}
                        onClick={() => {
                          if (singleSplitGroupValue) {
                            void handleAddEntryToSplits(
                              activeEditingEntry,
                              singleSplitGroupValue === NON_GROUP_SPLIT_VALUE ? null : singleSplitGroupValue
                            );
                            return;
                          }

                          setIsConfirmingAddToSplits(false);
                          setIsMobileSplitPickerOpen(true);
                          setIsMobileSplitSelectorOpen(true);
                        }}
                      >
                        Yes, add it
                      </button>
                    </div>
                  </div>
                ) : isMobileSplitPickerOpen ? (
                  <div className="entry-mobile-sheet-confirm-actions">
                    <span className="entry-mobile-sheet-confirm-copy">Choose split group</span>
                    <ResponsiveSelect
                      title="Split group"
                      value={mobileSplitGroupId}
                      options={splitGroupOptions}
                      onValueChange={(nextValue) => {
                        void handleMobileSplitGroupSelection(nextValue);
                      }}
                      disabled={addingToSplitsEntryId === activeEditingEntry.id}
                      open={isMobileSplitSelectorOpen}
                      onOpenChange={(open) => {
                        setIsMobileSplitSelectorOpen(open);
                        if (!open && !addingToSplitsEntryId) {
                          setIsMobileSplitPickerOpen(false);
                          setMobileSplitGroupId("");
                        }
                      }}
                      hideMobileTrigger
                    />
                    <div className="entry-mobile-sheet-confirm-buttons">
                      <button
                        type="button"
                        className="subtle-cancel"
                        disabled={addingToSplitsEntryId === activeEditingEntry.id}
                        onClick={() => {
                          setIsMobileSplitPickerOpen(false);
                          setIsMobileSplitSelectorOpen(false);
                          setMobileSplitGroupId("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="entry-inline-actions entry-mobile-sheet-actions">
                    <button
                      type="button"
                      className="subtle-action entry-mobile-sheet-secondary"
                      disabled={addingToSplitsEntryId === activeEditingEntry.id}
                      onClick={() => setIsConfirmingAddToSplits(true)}
                    >
                      {messages.entries.addToSplits}
                    </button>
                    <span className="entry-mobile-sheet-action-divider" aria-hidden="true">|</span>
                    <button type="button" className="subtle-cancel" onClick={closeEntryEditSheet}>Cancel</button>
                    <button type="button" className="dialog-primary" onClick={() => void finishEntryEditAndClearLink()}>Save</button>
                  </div>
                )
              )
            : null}
          onClose={closeEntryEditSheet}
          onSave={() => void finishEntryEditAndClearLink()}
        >
          <EntryEditorFields
            entry={activeEditingEntry}
            categories={categories}
            categoryOptions={categoryOptions}
            accountOptions={accountOptions}
            ownerOptions={ownerOptions}
            splitPercentValue={activeEditingEntry.ownershipType === "shared" ? getVisibleSplitPercent(activeEditingEntry, entryView.id) ?? null : null}
            lockTransferCategory
            onChange={(patch) => updateEntry(activeEditingEntry.id, patch)}
            onQuickSaveCategory={(categoryName) => saveEntryCategory(activeEditingEntry.id, categoryName)}
            onCategoryAppearanceChange={onCategoryAppearanceChange}
            onOwnerChange={(nextValue) => {
              if (nextValue === "Shared") {
                updateEntry(activeEditingEntry.id, { ownershipType: "shared", ownerName: undefined });
                return;
              }

              updateEntry(activeEditingEntry.id, { ownershipType: "direct", ownerName: nextValue });
            }}
            onSplitPercentChange={(percentage) => updateEntrySplit(activeEditingEntry.id, percentage)}
            transferTools={(
              <EntryTransferTools
                entry={activeEditingEntry}
                categoryOptions={categoryOptions}
                transferCandidates={activeEditingEntry.entryType === "transfer"
                  ? getTransferMatchCandidates(activeEditingEntry, entries)
                  : []}
                transferDialogEntryId={transferDialogEntryId}
                transferSettlementDrafts={transferSettlementDrafts}
                linkingTransferEntryId={linkingTransferEntryId}
                settlingTransferEntryId={settlingTransferEntryId}
                onEnsureSettlementDraft={ensureTransferSettlementDraft}
                onTransferDialogEntryChange={setTransferDialogEntryId}
                onSettlementDraftChange={updateTransferSettlementDraft}
                onLinkCandidate={linkTransferCandidate}
                onSettleTransfer={settleTransfer}
              />
            )}
          />
          {activeEditingEntryBankState ? (
            <div className="entry-inline-status-legend" aria-label="Entry status legend">
              <span className="entry-inline-status-item">
                <span className="entry-inline-status-label">Status:</span>
                <span
                  className={`entry-chip entry-chip-bank-state ${activeEditingEntryBankState.className} entry-status-dot`}
                  aria-hidden="true"
                />
                <span className="entry-inline-status-separator">-</span>
                <span>{activeEditingEntryBankState.label}</span>
              </span>
            </div>
          ) : null}
        </EntryMobileSheet>,
        document.body
      ) : null}

      <EntriesDateGroups
        groupedEntries={groupedEntries}
        allEntries={entries}
        categories={categories}
        categoryOptions={categoryOptions}
        accountOptions={accountOptions}
        ownerOptions={ownerOptions}
        splitGroups={entriesPage.splitGroups}
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
        createdSplitAction={createdSplitAction}
        deletingCreatedSplitId={deletingCreatedSplitId}
        onAddEntryToSplits={handleAddEntryToSplits}
        onViewCreatedSplit={openCreatedSplit}
        onDeleteCreatedSplit={handleDeleteCreatedSplit}
        onFinishEntryEdit={finishEntryEditAndClearLink}
        onCancelEntryEdit={closeEntryEditSheet}
        renderInlineEditor={!useMobileEntrySheet}
      />
    </article>
  );
}

function EntryMobileSheet({
  title,
  description,
  errorMessage = "",
  saveLabel,
  isSaveDisabled = false,
  secondaryAction = null,
  footerContent = null,
  onClose,
  onSave,
  children
}) {
  return (
    <>
      <button
        type="button"
        className="entry-composer-overlay"
        aria-label={`Close ${title.toLowerCase()}`}
        onClick={onClose}
      />
      <section className="entry-composer entry-mobile-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="entry-mobile-sheet-scroll">
          <div className="note-dialog-head split-dialog-head entry-composer-head">
            <div className="entry-composer-copy">
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel entry-composer-close"
              aria-label={`Close ${title.toLowerCase()}`}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          {errorMessage ? <p className="entry-submit-error">{errorMessage}</p> : null}
          {children}
          {footerContent ?? (
            <div className="entry-inline-actions entry-mobile-sheet-actions">
              {secondaryAction}
              <button type="button" className="subtle-cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="dialog-primary" disabled={isSaveDisabled} onClick={onSave}>{saveLabel}</button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const QUICK_EXPENSE_PARAMS = [
  "action",
  "amount",
  "merchant",
  "description",
  "date",
  "account",
  "account_id",
  "category",
  "note",
  "owner",
  "shared"
];

function buildQuickExpenseDraftPatch({ searchParams, accountOptions, categoryOptions, ownerOptions, fallbackOwnerName }) {
  const warnings = [];
  const rawAmount = searchParams.get("amount");
  const rawDescription = searchParams.get("merchant") ?? searchParams.get("description");
  const rawAccount = searchParams.get("account");
  const account = findQuickExpenseAccount(accountOptions, {
    accountId: searchParams.get("account_id"),
    accountName: rawAccount
  });
  const categoryName = findCaseInsensitiveOption(categoryOptions, searchParams.get("category")) ?? "Other";
  const ownerName = findCaseInsensitiveOption(ownerOptions.filter((option) => option !== "Shared"), searchParams.get("owner"))
    ?? fallbackOwnerName
    ?? "";
  const isShared = ["1", "true", "yes", "shared"].includes(String(searchParams.get("shared") ?? "").trim().toLowerCase());
  const amountMinor = Math.abs(parseDraftMoneyInput(rawAmount ?? "0"));
  const description = isQuickExpensePlaceholder(rawDescription) ? "" : rawDescription ?? "";
  const date = normalizeQuickExpenseDate(searchParams.get("date")) || new Date().toISOString().slice(0, 10);

  if (!hasQuickExpenseAmount(rawAmount)) {
    warnings.push("Shortcut did not pass an amount. Check that the URL uses the real Amount variable, not placeholder text.");
  }
  if (isQuickExpensePlaceholder(rawDescription)) {
    warnings.push("Shortcut did not pass a merchant or description.");
  }
  if (rawAccount && !account && isQuickExpensePlaceholder(rawAccount)) {
    warnings.push("Shortcut did not pass a card or account.");
  }

  return {
    draft: {
      ...(date ? { date } : {}),
      ...(description ? { description } : {}),
      ...(account ? {
        accountId: account.value,
        accountName: account.accountName,
        accountOwnerLabel: account.ownerLabel
      } : {}),
      categoryName,
      amountMinor,
      totalAmountMinor: amountMinor,
      entryType: "expense",
      transferDirection: undefined,
      ownershipType: isShared ? "shared" : "direct",
      ownerName: isShared ? undefined : ownerName,
      note: isQuickExpensePlaceholder(searchParams.get("note")) ? "" : searchParams.get("note") ?? ""
    },
    warning: warnings.join(" ")
  };
}

function hasQuickExpenseAmount(value) {
  return /\d/.test(String(value ?? "")) && !isQuickExpensePlaceholder(value);
}

function isQuickExpensePlaceholder(value) {
  return /^\s*\[[^\]]+\]\s*$/.test(String(value ?? ""));
}

function findQuickExpenseAccount(accountOptions, { accountId, accountName }) {
  if (accountId) {
    const byId = accountOptions.find((option) => option.value === accountId || option.id === accountId);
    if (byId) {
      return byId;
    }
  }

  if (!accountName) {
    return undefined;
  }

  const normalizedAccountName = normalizeQuickExpenseToken(accountName);
  const exactMatch = accountOptions.find((option) => (
    normalizeQuickExpenseToken(option.accountName) === normalizedAccountName
    || normalizeQuickExpenseToken(option.label) === normalizedAccountName
    || normalizeQuickExpenseToken(option.value) === normalizedAccountName
  ));
  if (exactMatch) {
    return exactMatch;
  }

  const partialMatches = accountOptions.filter((option) => (
    normalizeQuickExpenseToken(option.accountName).includes(normalizedAccountName)
    || normalizeQuickExpenseToken(option.label).includes(normalizedAccountName)
  ));
  return partialMatches.length === 1 ? partialMatches[0] : undefined;
}

function findCaseInsensitiveOption(options, value) {
  if (!value) {
    return undefined;
  }
  const normalizedValue = normalizeQuickExpenseToken(value);
  return options.find((option) => normalizeQuickExpenseToken(option) === normalizedValue);
}

function normalizeQuickExpenseToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeQuickExpenseDate(value) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function buildQuickExpenseKey(searchParams) {
  return QUICK_EXPENSE_PARAMS.map((key) => `${key}=${searchParams.get(key) ?? ""}`).join("&");
}

function storeQuickExpenseDraft(key, draft, warning = "") {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(QUICK_EXPENSE_DRAFT_STORAGE_KEY, JSON.stringify({
      key,
      draft,
      warning,
      createdAt: Date.now()
    }));
  } catch {
    // The URL flow still works without storage; storage only protects against a reload.
  }
}

function readStoredQuickExpenseDraft() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.sessionStorage.getItem(QUICK_EXPENSE_DRAFT_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    const parsed = JSON.parse(storedValue);
    if (
      !parsed?.draft
      || typeof parsed.key !== "string"
      || Date.now() - Number(parsed.createdAt ?? 0) > QUICK_EXPENSE_DRAFT_STORAGE_TTL_MS
    ) {
      clearStoredQuickExpenseDraft();
      return null;
    }
    return parsed;
  } catch {
    clearStoredQuickExpenseDraft();
    return null;
  }
}

function clearStoredQuickExpenseDraft() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(QUICK_EXPENSE_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures; this should not block entry editing.
  }
}

function getEntryBankState(entry) {
  if (entry.bankCertificationStatus === "statement_certified") {
    return {
      label: entry.bankCertificationLabel ?? "Statement certified",
      title: entry.statementCertifiedAt
        ? `Bank facts certified ${formatDateOnly(entry.statementCertifiedAt.slice(0, 10))}`
        : "Bank facts are locked by a saved statement.",
      className: "is-statement-certified"
    };
  }

  if (entry.bankCertificationStatus === "import_provisional") {
    return {
      label: entry.bankCertificationLabel ?? "Import provisional",
      title: entry.importedSourceLabel
        ? `Imported from ${entry.importedSourceLabel}; final statement can still certify it.`
        : "Imported working row; final statement can still certify it.",
      className: "is-import-provisional"
    };
  }

  return {
    label: entry.bankCertificationLabel ?? "Manual provisional",
    title: "Manual row; a later bank import or statement should match or certify it.",
    className: "is-manual-provisional"
  };
}

function buildInitialEntriesPage(view) {
  return {
    viewId: view.id,
    label: view.label,
    splitGroups: view.splitsPage.groups.map((group) => ({
      id: group.id,
      name: group.name
    })),
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
