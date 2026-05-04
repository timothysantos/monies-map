import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { useEntryActions } from "./entry-actions";
import {
  EntryComposerInlineSection,
  EntryComposerMobileSection,
  useEntryComposerSplitOptions
} from "./entry-composer-section";
import { EntryEditorFields, EntryTransferTools } from "./entry-editor";
import { EntriesDateGroups } from "./entries-list";
import { EntriesBreakdownPanel, EntriesFilterStack, EntriesTotalsStrip } from "./entries-overview";
import { EntryMobileEditExpenseFooter, EntryMobileSheet } from "./entry-mobile-sheet";
import {
  getActiveEntryFilterCount,
  getEntryDerivedData,
  getEntryFilterOptions,
  getEntryFormOptions,
  getEntryWalletFilterOptions
} from "./entry-selectors";
import { moniesClient } from "./monies-client-service";
import { queryKeys } from "./query-keys";
import { buildRequestErrorMessage } from "./request-errors";
import { deleteSplitExpense } from "./splits-api";

const ENTRIES_PAGE_PREFETCH_DELAY_MS = 1200;
const ENTRIES_PAGE_PREFETCH_SPACING_MS = 650;
const QUICK_EXPENSE_DRAFT_STORAGE_KEY = "monies.quickExpenseDraft";
const QUICK_EXPENSE_DRAFT_STORAGE_TTL_MS = 15 * 60 * 1000;
const NON_GROUP_SPLIT_VALUE = "__split_group_none__";
const { entries: entryService, format: formatService } = moniesClient;

// Entries page glossary:
// - "entries source view": the person/household view that owns the server payload for this page.
// - "entry view": the active view after local optimistic edits are merged into the server payload.
// - "scope": which ownership slice of the view is visible (direct, shared, or both).
// - "quick expense": a draft launched from an external shortcut/URL that should open the composer.
// - "split group": the shared-expense bucket an expense can be attached to from the Entries page.
// - "linked entry": an entry id carried in the URL so mobile edit state survives route changes.
function waitFor(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function EntriesPanel({
  view,
  entriesSourceView = view,
  selectedMonth,
  mobileContextOpen = false,
  onCloseMobileContext,
  onMobileFilterStateChange,
  externalRefreshToken = 0,
  availableMonths,
  accounts,
  categories,
  people,
  onCategoryAppearanceChange,
  onInvalidateBootstrapCache,
  onBroadcastSplitMutation
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [useMobileEntrySheet, setUseMobileEntrySheet] = useState(false);
  const [isQuickExpenseSaving, setIsQuickExpenseSaving] = useState(false);
  const [quickExpensePendingKey, setQuickExpensePendingKey] = useState("");
  const [quickExpenseWarning, setQuickExpenseWarning] = useState("");
  const [pendingLinkedEntryId, setPendingLinkedEntryId] = useState(() => searchParams.get("editing_entry") ?? "");
  const [createdSplitAction, setCreatedSplitAction] = useState(null);
  const [deletingCreatedSplitId, setDeletingCreatedSplitId] = useState("");
  const [createdSplitActionError, setCreatedSplitActionError] = useState("");
  const [isMobileSplitPickerOpen, setIsMobileSplitPickerOpen] = useState(false);
  const [isMobileSplitSelectorOpen, setIsMobileSplitSelectorOpen] = useState(false);
  const [mobileSplitGroupId, setMobileSplitGroupId] = useState("");
  const handledQuickExpenseKeyRef = useRef("");
  const pendingQuickExpenseDraftRef = useRef(null);
  const {
    entriesPage,
    isEntriesPageLoading,
    refreshEntriesPage
  } = useEntriesPageData({
    queryClient,
    view,
    entriesSourceView,
    selectedMonth,
    availableMonths,
    externalRefreshToken,
    onInvalidateBootstrapCache
  });
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

  const {
    entries,
    editingEntryId,
    hasEditingEntryChanges,
    showEntryComposer,
    entryDraft,
    entrySubmitError,
    isSavingEntryDraft,
    savingEntryId,
    deletingEntryId,
    linkingTransferEntryId,
    settlingTransferEntryId,
    transferSettlementDrafts,
    transferDialogEntryId,
    refreshingTransferCandidatesEntryId,
    transferCandidateErrors,
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
    refreshTransferCandidates,
    getTransferCandidatesForEntry,
    ensureTransferSettlementDraft,
    updateTransferSettlementDraft,
    settleTransfer,
    addEntryToSplits,
    deleteEntry,
    updateEntry,
    updateEntrySplit,
    saveEntryCategory
  } = useEntryActions({
    view: entryView,
    accounts,
    categories,
    people,
    onRefresh: () => refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true }),
    onSplitMutation: onBroadcastSplitMutation
  });
  const openEntryComposerRef = useRef(openEntryComposer);
  const entryComposerEditorRef = useRef(null);
  const defaultEntryPerson = entryView.id !== "household" ? entryView.label : "";
  const {
    searchParamsKey,
    selectedScope,
    walletFilters,
    walletFilterKey,
    entryFilters
  } = useEntriesSearchFilters(searchParams, entryView.monthPage.selectedScope);

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

  useLayoutEffect(() => {
    if (!useMobileEntrySheet) {
      return;
    }
    setShowMobileFilters(mobileContextOpen);
  }, [mobileContextOpen, useMobileEntrySheet]);

  const wallets = useMemo(
    () => getEntryWalletFilterOptions(accounts),
    [accounts]
  );
  const { entryCategoryOptions } = useMemo(
    () => getEntryFilterOptions(entries),
    [entries]
  );
  useEffect(() => {
    const category = searchParams.get("entry_category");
    const person = searchParams.get("entry_person");
    const walletValues = wallets.map((option) => option.value);
    const staleWalletFilters = walletFilters.filter((wallet) => (
      !walletValues.includes(wallet) && !entries.some((entry) => entry.accountName === wallet)
    ));
    const categoryIsStale = category && !entryCategoryOptions.includes(category);

    if (!staleWalletFilters.length && !categoryIsStale && !person) {
      return;
    }

    // Filters live in the URL, so this effect prunes values that stopped
    // making sense after the month/view payload changed.
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (staleWalletFilters.length) {
        next.delete("entry_wallet");
        walletFilters
          .filter((wallet) => !staleWalletFilters.includes(wallet))
          .forEach((wallet) => next.append("entry_wallet", wallet));
      }
      if (categoryIsStale) {
        next.delete("entry_category");
      }
      if (person) {
        next.delete("entry_person");
      }
      return next;
    }, { replace: true });
  }, [entries, entryCategoryOptions, searchParams, setSearchParams, walletFilterKey, wallets]);
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

    // Shortcut URLs are translated once into a normal entry draft, then the
    // special query params are cleared so refreshes do not reopen the composer.
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

    // Mobile edit sheets preserve their target row in the URL so route changes
    // or panel switches can reopen the same entry.
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

    // Session storage is only a safety net for reloads in the middle of a
    // quick-expense flow. Normal entry creation does not depend on it.
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

    // Wait until the correct month payload is loaded before opening the
    // composer so account/category options match the visible page context.
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

    // Opening a linked entry overrides any pending quick-expense draft because
    // the user explicitly navigated to an existing row to edit it.
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
      const result = await saveEntryDraft();
      if (result?.saved) {
        pendingQuickExpenseDraftRef.current = null;
        setQuickExpensePendingKey("");
        setQuickExpenseWarning("");
        clearStoredQuickExpenseDraft();
        if (result.splitAddError && typeof window !== "undefined") {
          window.setTimeout(() => window.alert(result.splitAddError), 0);
        }
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
    filteredEntries,
    groupedEntries,
    entryTotals,
    entryOutflowMinor,
    entryNetMinor,
    expenseBreakdown
  } = useMemo(
    () => getEntryDerivedData({ entries, entryFilters, selectedScope, viewId: entryView.id }),
    [entries, entryFilters, selectedScope, entryView.id]
  );
  const entriesEmptyStateSuggestion = useMemo(
    () => getEntriesEmptyStateSuggestion({
      accounts,
      people,
      walletFilters,
      filteredEntries,
      viewId: entryView.id,
      searchParams
    }),
    [accounts, filteredEntries, people, searchParams, walletFilterKey, entryView.id]
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
  const {
    entrySplitGroupOptions,
    splitGroupOptions,
    singleSplitGroupValue,
    shouldShowComposerSplitOptions,
    isComposerSaveDisabled,
    composerSplitOptionsProps
  } = useEntryComposerSplitOptions({
    showEntryComposer,
    entryDraft,
    splitGroups: entriesPage.splitGroups,
    isSavingEntryDraft,
    isQuickExpenseSaving,
    updateEntryDraft
  });
  const activeLinkedSplitExpenseId = createdSplitAction && createdSplitAction.entryId === activeEditingEntry?.id
    ? createdSplitAction.splitExpenseId
    : activeEditingEntry?.linkedSplitExpenseId;
  const mobileEditExpenseFooterMode = activeLinkedSplitExpenseId
    ? "linked"
    : isMobileSplitPickerOpen
      ? "picker"
      : "default";

  useEffect(() => {
    if (!shouldShowComposerSplitOptions || !entryDraft.addToSplits) {
      return;
    }

    // When there is exactly one eligible split group we pick it automatically.
    // Otherwise we keep the draft selection aligned with the latest group list.
    if (singleSplitGroupValue && entryDraft.splitGroupId !== singleSplitGroupValue) {
      updateEntryDraft({ splitGroupId: singleSplitGroupValue });
      return;
    }

    if (!singleSplitGroupValue && entryDraft.splitGroupId && !entrySplitGroupOptions.some((option) => option.value === entryDraft.splitGroupId)) {
      updateEntryDraft({ splitGroupId: "" });
    }
  }, [
    entryDraft.addToSplits,
    entryDraft.splitGroupId,
    entryDraft.entryType,
    entrySplitGroupOptions,
    shouldShowComposerSplitOptions,
    singleSplitGroupValue,
    updateEntryDraft
  ]);

  useEffect(() => {
    resetMobileSplitPickerState();
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
    resetMobileSplitPickerState();
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
    preserveEntryEditorInUrl(entry.id);
    const result = await addEntryToSplits(entry, splitGroupId);
    if (result?.alreadyLinked) {
      await refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true });
      return;
    }

    if (!result?.splitExpenseId) {
      return;
    }

    setCreatedSplitAction({
      entryId: entry.id,
      splitExpenseId: result.splitExpenseId,
      splitGroupId: splitGroupId ?? "split-group-none"
    });
    resetMobileSplitPickerState();
  }

  async function refreshLatestSplitGroups() {
    const latestEntriesPage = await refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true });
    return latestEntriesPage?.splitGroups ?? entriesPage.splitGroups;
  }

  function resetMobileSplitPickerState() {
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
      onBroadcastSplitMutation?.({
        month: selectedMonth,
        invalidateEntries: true
      });
      await refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true });
    } catch (error) {
      setCreatedSplitActionError(error instanceof Error ? error.message : "Failed to delete split expense.");
    } finally {
      setDeletingCreatedSplitId("");
    }
  }

  async function handleDeleteEntry(entry) {
    preserveEntryEditorInUrl(entry.id);
    const result = await deleteEntry(entry);
    if (result?.ok) {
      clearEditingEntrySearchParam();
      setCreatedSplitAction(null);
      setDeletingCreatedSplitId("");
      setCreatedSplitActionError("");
      resetMobileSplitPickerState();
    }
  }

  function openCreatedSplit(entryId, splitExpenseId) {
    const activeCreatedSplitAction = createdSplitAction && createdSplitAction.entryId === entryId
      ? createdSplitAction
      : null;
    setCreatedSplitAction(null);
    navigate({
      pathname: "/splits",
      search: (() => {
        const next = new URLSearchParams(searchParams);
        next.delete("editing_entry");
        next.set("editing_split_expense", splitExpenseId);
        next.set("split_mode", "entries");
        if (activeCreatedSplitAction?.splitGroupId) {
          next.set("split_group", activeCreatedSplitAction.splitGroupId);
        }
        return next.toString();
      })()
    });
  }

  const updateEntryFilter = useCallback((key, value) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const paramKey = `entry_${key}`;
      if (key === "wallet") {
        next.delete(paramKey);
        normalizeWalletFilterValues(value).forEach((wallet) => next.append(paramKey, wallet));
        return next;
      }
      if (!value) {
        next.delete(paramKey);
      } else {
        next.set(paramKey, value);
      }
      return next;
    });
  }, [setSearchParams]);

  const resetEntryFilters = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("entry_id");
      next.delete("entry_wallet");
      next.delete("entry_category");
      next.delete("entry_type");
      return next;
    });
  }, [setSearchParams]);

  function applySuggestedView(viewId) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", viewId);
      next.delete("entry_person");
      return next;
    });
  }

  const toggleMobileFilters = useCallback(() => {
    setShowMobileFilters((current) => !current);
  }, []);

  const refreshEntriesFilters = useCallback(() => (
    refreshEntriesPage({ bypassCache: true, invalidateBootstrap: true })
  ), [refreshEntriesPage]);

  const filterStackProps = useMemo(() => ({
    showMobileFilters,
    activeEntryFilterCount,
    entryFilters,
    wallets,
    entryCategoryOptions,
    hideToggle: useMobileEntrySheet,
    hideRefresh: useMobileEntrySheet,
    onToggleMobileFilters: toggleMobileFilters,
    onChangeFilter: updateEntryFilter,
    onResetFilters: resetEntryFilters,
    onRefresh: refreshEntriesFilters,
    onDone: useMobileEntrySheet ? onCloseMobileContext : undefined
  }), [
    activeEntryFilterCount,
    entryCategoryOptions,
    entryFilters,
    onCloseMobileContext,
    refreshEntriesFilters,
    resetEntryFilters,
    showMobileFilters,
    toggleMobileFilters,
    updateEntryFilter,
    useMobileEntrySheet,
    wallets
  ]);

  useEffect(() => {
    if (!onMobileFilterStateChange) {
      return undefined;
    }

    if (!useMobileEntrySheet) {
      onMobileFilterStateChange(null);
      return undefined;
    }

    // On mobile the parent context owns the filter controls, so this effect
    // exports the current filter-stack props upward.
    onMobileFilterStateChange(filterStackProps);
  }, [filterStackProps, onMobileFilterStateChange, useMobileEntrySheet]);

  useEffect(() => {
    if (!onMobileFilterStateChange) {
      return undefined;
    }
    return () => onMobileFilterStateChange(null);
  }, [onMobileFilterStateChange]);

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

      {!useMobileEntrySheet ? <EntriesFilterStack {...filterStackProps} /> : null}

      {isEntriesPageLoading ? (
        <div className="app-loading-overlay entries-page-loading" role="status" aria-live="polite">
          <span className="app-spinner" aria-hidden="true" />
          <span>{messages.common.loadingLatest}</span>
        </div>
      ) : null}

      {showEntryComposer && !useMobileEntrySheet ? (
        <EntryComposerInlineSection
          warningMessage={quickExpenseWarning}
          errorMessage={entrySubmitError}
          isSaveDisabled={isComposerSaveDisabled}
          isSaving={isSavingEntryDraft || isQuickExpenseSaving}
          entry={entryDraft}
          categories={categories}
          categoryOptions={categoryOptions}
          accountOptions={accountOptions}
          ownerOptions={ownerOptions}
          viewId={entryView.id}
          showSplitOptions={shouldShowComposerSplitOptions}
          splitOptionsProps={composerSplitOptionsProps}
          onChange={updateEntryDraft}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onOwnerChange={updateEntryDraftOwner}
          onSplitPercentChange={updateEntryDraftSplit}
          onSave={() => void saveEntryDraftAndClearQuickExpense()}
          onCancel={closeEntryComposerAndClearQuickExpense}
        />
      ) : null}

      {showEntryComposer && canPortalEntryComposer && useMobileEntrySheet ? createPortal(
        <EntryComposerMobileSection
          errorMessage={entrySubmitError || quickExpenseWarning}
          saveLabel={isSavingEntryDraft || isQuickExpenseSaving ? "Saving..." : "Save"}
          isSaveDisabled={isComposerSaveDisabled}
          entry={entryDraft}
          categories={categories}
          categoryOptions={categoryOptions}
          accountOptions={accountOptions}
          ownerOptions={ownerOptions}
          viewId={entryView.id}
          showSplitOptions={shouldShowComposerSplitOptions}
          splitOptionsProps={composerSplitOptionsProps}
          onChange={updateEntryDraft}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onOwnerChange={updateEntryDraftOwner}
          onSplitPercentChange={updateEntryDraftSplit}
          onClose={closeEntryComposerAndClearQuickExpense}
          onSave={() => void saveEntryDraftAndClearQuickExpense()}
        />,
        document.body
      ) : null}

      {activeEditingEntry && canPortalEntryComposer && useMobileEntrySheet ? createPortal(
        <EntryMobileSheet
          title="Edit entry"
          description="Update the row in a bottom sheet instead of editing inline."
          errorMessage={entrySubmitError || createdSplitActionError}
          saveLabel={savingEntryId === activeEditingEntry.id ? messages.common.saving : "Save"}
          isSaveDisabled={Boolean(savingEntryId) || Boolean(deletingEntryId) || !hasEditingEntryChanges}
          secondaryAction={activeEditingEntry.entryType !== "expense"
            ? (
                <button
                  type="button"
                  className="subtle-action entry-mobile-sheet-secondary"
                  disabled={deletingEntryId === activeEditingEntry.id || savingEntryId === activeEditingEntry.id}
                  onClick={() => void handleDeleteEntry(activeEditingEntry)}
                >
                  {deletingEntryId === activeEditingEntry.id ? messages.common.working : "Delete entry"}
                </button>
              )
            : null}
          footerContent={activeEditingEntry.entryType === "expense"
            ? (
                <EntryMobileEditExpenseFooter
                  mode={mobileEditExpenseFooterMode}
                  addToSplitsLabel={messages.entries.addToSplits}
                  deleteEntryLabel={deletingEntryId === activeEditingEntry.id ? messages.common.working : "Delete entry"}
                  deleteLabel={deletingCreatedSplitId === activeLinkedSplitExpenseId ? messages.common.working : "Delete split"}
                  saveLabel={savingEntryId === activeEditingEntry.id ? messages.common.saving : "Save"}
                  isWorking={
                    addingToSplitsEntryId === activeEditingEntry.id
                    || deletingCreatedSplitId === activeLinkedSplitExpenseId
                    || deletingEntryId === activeEditingEntry.id
                    || savingEntryId === activeEditingEntry.id
                  }
                  isSaveDisabled={Boolean(savingEntryId) || Boolean(deletingEntryId) || !hasEditingEntryChanges}
                  splitGroupId={mobileSplitGroupId}
                  splitGroupOptions={splitGroupOptions}
                  isSplitSelectorOpen={isMobileSplitSelectorOpen}
                  onViewSplit={() => openCreatedSplit(activeEditingEntry.id, activeLinkedSplitExpenseId)}
                  onDeleteSplit={() => void handleDeleteCreatedSplit(activeEditingEntry.id, activeLinkedSplitExpenseId)}
                  onDeleteEntry={() => void handleDeleteEntry(activeEditingEntry)}
                  onCancel={closeEntryEditSheet}
                  onSave={() => void finishEntryEditAndClearLink()}
                  onOpenAddToSplits={() => {
                    void (async () => {
                      const latestSplitGroups = await refreshLatestSplitGroups();
                      const latestOptions = latestSplitGroups.map((group) => ({
                        value: group.id === "split-group-none" ? NON_GROUP_SPLIT_VALUE : group.id,
                        label: group.name
                      }));
                      const latestSingleSplitGroupValue = latestOptions.length === 1
                        ? latestOptions[0].value
                        : null;

                      if (latestSingleSplitGroupValue) {
                        await handleAddEntryToSplits(
                          activeEditingEntry,
                          latestSingleSplitGroupValue === NON_GROUP_SPLIT_VALUE ? null : latestSingleSplitGroupValue
                        );
                        return;
                      }

                      setIsMobileSplitPickerOpen(true);
                      setIsMobileSplitSelectorOpen(true);
                    })();
                  }}
                  onSplitSelectorOpenChange={(open) => {
                    setIsMobileSplitSelectorOpen(open);
                    if (!open && !addingToSplitsEntryId) {
                      resetMobileSplitPickerState();
                    }
                  }}
                  onSelectSplitGroup={(nextValue) => {
                    void handleMobileSplitGroupSelection(nextValue);
                  }}
                  onCancelSplitPicker={resetMobileSplitPickerState}
                />
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
            splitPercentValue={activeEditingEntry.ownershipType === "shared" ? entryService.getVisibleSplitPercent(activeEditingEntry, entryView.id) ?? null : null}
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
                transferCandidates={activeEditingEntry.entryType === "transfer" ? getTransferCandidatesForEntry(activeEditingEntry) : []}
                transferDialogEntryId={transferDialogEntryId}
                transferSettlementDrafts={transferSettlementDrafts}
                linkingTransferEntryId={linkingTransferEntryId}
                settlingTransferEntryId={settlingTransferEntryId}
                refreshingTransferCandidatesEntryId={refreshingTransferCandidatesEntryId}
                transferCandidatesError={transferCandidateErrors[activeEditingEntry.id] ?? ""}
                onEnsureSettlementDraft={ensureTransferSettlementDraft}
                onTransferDialogEntryChange={setTransferDialogEntryId}
                onSettlementDraftChange={updateTransferSettlementDraft}
                onRefreshCandidates={refreshTransferCandidates}
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

      {groupedEntries.length ? (
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
          savingEntryId={savingEntryId}
          deletingEntryId={deletingEntryId}
          transferDialogEntryId={transferDialogEntryId}
          transferSettlementDrafts={transferSettlementDrafts}
          linkingTransferEntryId={linkingTransferEntryId}
          settlingTransferEntryId={settlingTransferEntryId}
          refreshingTransferCandidatesEntryId={refreshingTransferCandidatesEntryId}
          transferCandidateErrors={transferCandidateErrors}
          onBeginEntryEdit={beginEntryEdit}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          onUpdateEntry={updateEntry}
          onUpdateEntrySplit={updateEntrySplit}
          onSaveEntryCategory={saveEntryCategory}
          onEnsureTransferSettlementDraft={ensureTransferSettlementDraft}
          onTransferDialogEntryChange={setTransferDialogEntryId}
          onUpdateTransferSettlementDraft={updateTransferSettlementDraft}
          onRefreshTransferCandidates={refreshTransferCandidates}
          getTransferCandidatesForEntry={getTransferCandidatesForEntry}
          onLinkTransferCandidate={linkTransferCandidate}
          onSettleTransfer={settleTransfer}
          createdSplitAction={createdSplitAction}
          deletingCreatedSplitId={deletingCreatedSplitId}
          onAddEntryToSplits={handleAddEntryToSplits}
          onRefreshSplitGroups={refreshLatestSplitGroups}
          onViewCreatedSplit={openCreatedSplit}
          onDeleteCreatedSplit={handleDeleteCreatedSplit}
          onDeleteEntry={handleDeleteEntry}
          onFinishEntryEdit={finishEntryEditAndClearLink}
          onCancelEntryEdit={closeEntryEditSheet}
          hasEditingChanges={hasEditingEntryChanges}
          renderInlineEditor={!useMobileEntrySheet}
        />
      ) : (
        <EntriesEmptyState
          suggestion={entriesEmptyStateSuggestion}
          onSwitchView={applySuggestedView}
        />
      )}
    </article>
  );
}

function EntriesEmptyState({ suggestion, onSwitchView }) {
  if (!suggestion) {
    return <p className="empty-state">{messages.entries.noEntries}</p>;
  }

  return (
    <section className="entries-empty-state linked-entry-notice">
      <strong>{messages.entries.walletViewMismatchTitle}</strong>
      <p>{messages.entries.walletViewMismatchDetail(suggestion.walletLabel, suggestion.ownerLabel, suggestion.viewLabel)}</p>
      <div className="entries-empty-state-actions">
        <button type="button" className="subtle-action" onClick={() => onSwitchView("household")}>
          {messages.entries.walletViewMismatchHouseholdAction}
        </button>
        <button type="button" className="subtle-action is-primary" onClick={() => onSwitchView(suggestion.ownerPersonId)}>
          {messages.entries.walletViewMismatchOwnerAction(suggestion.ownerLabel)}
        </button>
      </div>
    </section>
  );
}

function useEntriesPageData({
  queryClient,
  view,
  entriesSourceView,
  selectedMonth,
  availableMonths,
  externalRefreshToken,
  onInvalidateBootstrapCache
}) {
  const [entriesPage, setEntriesPage] = useState(() => buildInitialEntriesPage(view));
  const [isEntriesPageLoading, setIsEntriesPageLoading] = useState(false);
  const entriesQueryEpochRef = useRef(0);
  const entriesPagePrefetchTimerRef = useRef(null);
  const entriesPageParams = useMemo(
    () => buildEntriesPageParams({
      viewId: entriesSourceView.id,
      month: selectedMonth
    }),
    [entriesSourceView.id, selectedMonth]
  );
  const entriesPageCacheKey = entriesPageParams.toString();

  const clearEntriesPageCache = useCallback(() => {
    entriesQueryEpochRef.current += 1;
    queryClient.cancelQueries({ queryKey: ["entries-page"] });
    queryClient.removeQueries({ queryKey: ["entries-page"] });
  }, [queryClient]);

  // This is the single network boundary for the panel. Everything else reads
  // from local state or react-query cache.
  const fetchEntriesPage = useCallback(async (params, { bypassCache = false, signal } = {}) => {
    const queryKey = queryKeys.entriesPage(params);
    if (signal?.aborted) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }

    if (!bypassCache) {
      const cachedData = queryClient.getQueryData(queryKey);
      if (cachedData) {
        return cachedData;
      }
    }

    const fetcher = async () => {
      const response = await fetch(`/api/entries-page?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, "Entries page failed."));
      }
      return response.json();
    };

    const data = bypassCache
      ? await queryClient.fetchQuery({
          queryKey,
          queryFn: fetcher,
          staleTime: 0
        })
      : await queryClient.ensureQueryData({
          queryKey,
          queryFn: fetcher,
          revalidateIfStale: true
        });

    if (signal?.aborted) {
      throw new DOMException("Entries page request aborted.", "AbortError");
    }
    return data;
  }, [queryClient]);

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
  }, [entriesPageCacheKey, entriesSourceView, selectedMonth]);

  useEffect(() => {
    const controller = new AbortController();
    const hasCachedPage = Boolean(queryClient.getQueryData(queryKeys.entriesPage(entriesPageParams)));
    setIsEntriesPageLoading(!hasCachedPage);

    void fetchEntriesPage(entriesPageParams, { signal: controller.signal })
      .then((data) => {
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
  }, [entriesPageCacheKey, entriesPageParams, fetchEntriesPage, queryClient]);

  useEffect(() => {
    if (!externalRefreshToken) {
      return;
    }

    void refreshEntriesPage({ bypassCache: true });
  }, [externalRefreshToken, refreshEntriesPage]);

  // Prefetch adjacent months on desktop so moving month-to-month feels instant.
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
    const entriesQueryEpoch = entriesQueryEpochRef.current;

    entriesPagePrefetchTimerRef.current = window.setTimeout(() => {
      const currentIndex = availableMonths.indexOf(selectedMonth);
      if (currentIndex === -1) {
        return;
      }

      void (async () => {
        for (const offset of [-1, 1]) {
          if (isCancelled || entriesQueryEpochRef.current !== entriesQueryEpoch) {
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
  }, [availableMonths, entriesSourceView.id, fetchEntriesPage, selectedMonth]);

  return {
    entriesPage,
    isEntriesPageLoading,
    refreshEntriesPage
  };
}

function useEntriesSearchFilters(searchParams, defaultScope) {
  const searchParamsKey = searchParams.toString();
  const selectedScope = searchParams.get("entries_scope") ?? defaultScope;
  const walletFilters = useMemo(
    () => getWalletFilterValues(searchParams),
    [searchParamsKey, searchParams]
  );
  const walletFilterKey = walletFilters.join("\u0000");
  const entryIdFilters = useMemo(
    () => searchParams.getAll("entry_id"),
    [searchParamsKey, searchParams]
  );
  const entryIdFilterKey = entryIdFilters.join("\u0000");
  const categoryFilter = searchParams.get("entry_category") ?? "";
  const typeFilter = searchParams.get("entry_type") ?? "";
  const entryFilters = useMemo(() => ({
    entryIds: entryIdFilters,
    wallets: walletFilters,
    category: categoryFilter,
    type: typeFilter
  }), [categoryFilter, entryIdFilterKey, typeFilter, walletFilterKey, walletFilters]);

  return {
    searchParamsKey,
    selectedScope,
    walletFilters,
    walletFilterKey,
    entryFilters
  };
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

function getWalletFilterValues(searchParams) {
  const values = searchParams.getAll("entry_wallet");
  if (values.length > 1) {
    return normalizeWalletFilterValues(values);
  }

  const singleValue = values[0] ?? searchParams.get("entry_wallet") ?? "";
  if (!singleValue) {
    return [];
  }

  return normalizeWalletFilterValues(singleValue
    .split(",")
    .map((value) => value.trim())
  );
}

function normalizeWalletFilterValues(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)));
}

function getEntriesEmptyStateSuggestion({ accounts, people, walletFilters, filteredEntries, viewId, searchParams }) {
  if (
    viewId === "household"
    || filteredEntries.length
    || walletFilters.length !== 1
    || searchParams.get("entry_category")
    || searchParams.get("entry_type")
  ) {
    return null;
  }

  const currentPerson = people.find((person) => person.id === viewId);
  const explicitPersonFilter = searchParams.get("entry_person");
  if (explicitPersonFilter && explicitPersonFilter !== currentPerson?.name) {
    return null;
  }

  const selectedWallet = walletFilters[0];
  const account = accounts.find((item) => (
    item.id === selectedWallet
    || item.accountId === selectedWallet
    || item.name === selectedWallet
    || item.accountName === selectedWallet
  ));
  if (!account || account.isJoint || !account.ownerPersonId || account.ownerPersonId === viewId) {
    return null;
  }

  const owner = people.find((person) => person.id === account.ownerPersonId);
  if (!owner) {
    return null;
  }

  return {
    ownerPersonId: owner.id,
    ownerLabel: owner.name,
    viewLabel: currentPerson?.name ?? "this view",
    walletLabel: account.name ?? account.accountName ?? owner.name
  };
}

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
  const amountMinor = Math.abs(formatService.parseDraftMoneyInput(rawAmount ?? "0"));
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
      note: isQuickExpensePlaceholder(searchParams.get("note")) ? "" : searchParams.get("note") ?? "",
      addToSplits: false,
      splitGroupId: ""
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
        ? `Bank facts certified ${formatService.formatDateOnly(entry.statementCertifiedAt.slice(0, 10))}`
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
