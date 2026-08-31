import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { FinancialInsight } from "./financial-insight";
import { PrivateMoney } from "./money-privacy";
import { LinkedNoteSyncDialog } from "./linked-note-sync-dialog";
import {
  useSplitEditState,
  validateSplitExpenseDraft,
  validateSplitSettlementDraft
} from "./split-editing";
import {
  createSplitGroup,
  createSettlementCheckpoint,
  deleteSplitExpense,
  deleteSplitSettlement,
  linkSplitMatch,
  markSettlementCheckpointPaid,
  matchSettlementCheckpoint,
  reopenSettlementCheckpoint,
  undoSettlementCheckpointPaid,
  unmatchSettlementCheckpoint,
  saveSplitExpense,
  saveSplitSettlement,
  restoreSplitRecord,
  updateLinkedEntryCategory,
  updateLinkedEntryNote
} from "./splits-api";
import {
  applyOptimisticSplitMatch,
  buildOptimisticExpenseActivityItem,
  buildOptimisticSettlementActivityItem,
  removeOptimisticSplitActivity,
  upsertOptimisticSplitActivity
} from "./splits-optimistic";
import { SplitArchiveDialog } from "./splits-archive-dialog";
import { SplitHistoryDialog } from "./splits-history-dialog";
import { splitActivityDomId } from "./splits-activity";
import { SplitDeleteDialog, SplitExpenseDialog, SplitGroupDialog, SplitSettlementDialog } from "./splits-dialogs";
import { SearchFilterInput } from "./entries-overview";
import { SplitsMainSection } from "./splits-main-section";
import { buildSplitsPanelModel } from "./splits-selectors";
import { moniesClient } from "./monies-client-service";
import {
  buildLinkedSplitRefreshOptions,
  createSplitRefreshGuard
} from "./splits-workflow";
import { buildFinancialInsightFacts } from "../domain/ai-assistance-insights";

const { format: formatService } = moniesClient;

export function SplitsPanel({ view, categories, people, onRefresh }) {
  const splitsPage = view.splitsPage ?? {
    groups: [],
    activity: [],
    matches: [],
    donutChart: [],
    month: view.monthPage?.month ?? ""
  };
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [useMobileSplitSheet, setUseMobileSplitSheet] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [groupDialog, setGroupDialog] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [splitNoteSyncPrompt, setSplitNoteSyncPrompt] = useState(null);
  const [isSyncingSplitNote, setIsSyncingSplitNote] = useState(false);
  const [splitCategorySyncPrompt, setSplitCategorySyncPrompt] = useState(null);
  const [isSyncingSplitCategory, setIsSyncingSplitCategory] = useState(false);
  const [isRefreshingDerived, setIsRefreshingDerived] = useState(false);
  const [optimisticSplitsPage, setOptimisticSplitsPage] = useState(null);
  const [dismissedMatchIds, setDismissedMatchIds] = useState([]);
  const [checkpointError, setCheckpointError] = useState("");
  const [checkpointNotice, setCheckpointNotice] = useState("");
  const [isCheckpointing, setIsCheckpointing] = useState(false);
  const [checkpointTransferId, setCheckpointTransferId] = useState("");
  const [checkpointFxRateInput, setCheckpointFxRateInput] = useState("1");
  const [checkpointMatchTargetId, setCheckpointMatchTargetId] = useState(null);
  const [showSettlementFollowUps, setShowSettlementFollowUps] = useState(false);
  const refreshGuardRef = useRef(null);
  const latestSplitsPageRef = useRef(splitsPage);
  const returnToSplitIdRef = useRef("");
  const defaultGroupId = splitsPage.groups.find((group) => group.isDefault)?.id ?? "split-group-none";
  const selectedGroupParam = searchParams.get("split_group");
  const selectedGroupId = selectedGroupParam ?? defaultGroupId;
  const selectedMode = searchParams.get("split_mode") ?? "entries";
  const splitSearchQuery = searchParams.get("split_search") ?? "";
  const isHouseholdView = view.id === "household";
  const displayView = useMemo(
    () => (optimisticSplitsPage ? { ...view, splitsPage: optimisticSplitsPage } : { ...view, splitsPage }),
    [optimisticSplitsPage, splitsPage, view]
  );
  const splitModel = useMemo(
    () => buildSplitsPanelModel({
      view: displayView,
      categories,
      selectedGroupId,
      searchQuery: splitSearchQuery,
      dismissedMatchIds,
      archiveBatchId: archiveDialog?.batchId
    }),
    [archiveDialog?.batchId, categories, dismissedMatchIds, displayView, selectedGroupId, splitSearchQuery]
  );
  const {
    activeGroup,
    archivedBatches,
    categoryOptions,
    currentGroupActivity,
    donutRows,
    groupedCurrentActivity,
    groupBalanceMinor,
    groups,
    groupOptions,
    groupSummaryLabel,
    pendingMatchCount,
    selectedArchivedBatch,
    searchSuggestions,
    totalExpenseMinor,
    visibleMatches
  } = splitModel;
  const financialInsightFacts = useMemo(() => buildFinancialInsightFacts({
    contextLabel: `${activeGroup?.name ?? "Split"} group${splitSearchQuery ? " search" : ""}`,
    records: currentGroupActivity.map((item) => ({
      amountMinor: item.totalAmountMinor,
      entryType: item.kind === "expense" ? "expense" : "transfer",
      categoryName: item.categoryName ?? "Split expense",
      description: item.description
    })),
    formatMoney: formatService.money,
    perspective: "split_obligation",
    accountingAdvice: splitSearchQuery
      ? "This is a filtered group view, so check the matching split record before treating the displayed amount as the full group balance."
      : pendingMatchCount
        ? "Review possible bank matches before creating another split record. Treat the group balance as a settlement obligation, not new spending."
        : groupBalanceMinor
          ? "Treat the group balance as a settlement obligation between people, not new spending; record or match the settlement when it happens."
          : "The group is settled. Keep bank-linked expenses and settlements matched so the audit trail stays complete."
  }), [activeGroup?.name, currentGroupActivity, groupBalanceMinor, pendingMatchCount, splitSearchQuery]);
  const financialInsightActions = useMemo(() => pendingMatchCount ? [{
    label: `Review ${pendingMatchCount} bank ${pendingMatchCount === 1 ? "match" : "matches"}`,
    onClick: () => openMatchesView()
  }] : [], [pendingMatchCount, activeGroup?.id, defaultGroupId]);
  const settlementCheckpoints = splitsPage.settlementCheckpoints ?? [];
  const activeCheckpointStatuses = ["open", "partially_matched"];
  const activeCheckpoint = settlementCheckpoints.find((checkpoint) =>
    !checkpoint.settledAt
    && activeCheckpointStatuses.includes(checkpoint.status)
    && checkpoint.currency === (activeGroup?.currency ?? "SGD")
  );
  const paidCheckpointsAwaitingBankMatch = settlementCheckpoints.filter((checkpoint) =>
    Boolean(checkpoint.settledAt)
    && activeCheckpointStatuses.includes(checkpoint.status)
  );
  const checkpointHasOverpayment = Boolean(activeCheckpoint && activeCheckpoint.matchedAmountMinor > activeCheckpoint.amountMinor);
  const {
    expenseDialog,
    settlementDialog,
    inlineSplitDraft,
    expenseDialogSnapshot,
    settlementDialogSnapshot,
    inlineSplitDraftSnapshot,
    inlineSplitError,
    deleteTarget,
    formError,
    hasExpenseDialogChanges,
    hasSettlementDialogChanges,
    hasInlineSplitChanges,
    setExpenseDialog,
    setSettlementDialog,
    setInlineSplitDraft,
    setInlineSplitError,
    setDeleteTarget,
    setFormError,
    openExpenseEditor,
    openSettlementEditor,
    openInlineExpenseEditor,
    openInlineSettlementEditor,
    openNewExpenseDialog,
    openNewSettlementDialog,
    closeExpenseDialog,
    closeSettlementDialog,
    clearInlineSplitDraft,
    resetForViewChange,
    requestDeleteSplit,
    clearExpenseDialogSnapshot,
    clearSettlementDialogSnapshot,
    clearInlineSplitSnapshot
  } = useSplitEditState({ categoryOptions, people });

  useEffect(() => {
    refreshGuardRef.current = refreshGuardRef.current ?? createSplitRefreshGuard();
    latestSplitsPageRef.current = splitsPage;
  }, [splitsPage]);

  useEffect(() => {
    // Keep the URL explicit once the default group is known so refreshes and
    // deep links reopen the same split workspace.
    if (selectedGroupParam || selectedMode === "matches" || selectedGroupId === defaultGroupId) {
      return;
    }

    updateSplitView({ groupId: defaultGroupId, mode: "entries" });
  }, [defaultGroupId, selectedGroupId, selectedGroupParam, selectedMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const update = () => setUseMobileSplitSheet(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    setDismissedMatchIds([]);
    setShowBreakdown(false);
    setOptimisticSplitsPage(null);
    setIsRefreshingDerived(false);
    refreshGuardRef.current = createSplitRefreshGuard();
    resetForViewChange();
    setArchiveDialog(null);
  }, [resetForViewChange, splitsPage.month, view.id]);

  useEffect(() => {
    if (!useMobileSplitSheet) {
      return;
    }

    clearInlineSplitDraft();
  }, [clearInlineSplitDraft, useMobileSplitSheet]);

  useEffect(() => {
    const targetSplitExpenseId = searchParams.get("editing_split_expense");
    if (!targetSplitExpenseId) {
      return;
    }

    const targetExpense = splitsPage.activity.find((item) => (
      item.kind === "expense" && item.id === targetSplitExpenseId && !item.isArchived
    ));
    if (!targetExpense) {
      return;
    }

    const targetGroupId = targetExpense.groupId ?? "split-group-none";
    if (selectedMode !== "entries" || selectedGroupId !== targetGroupId) {
      updateSplitView({ groupId: targetGroupId, mode: "entries" });
      return;
    }

    if (expenseDialog?.id === targetSplitExpenseId) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("editing_split_expense");
        return next;
      }, { replace: true });
      return;
    }

    returnToSplitIdRef.current = targetSplitExpenseId;
    openExpenseEditor(targetExpense);
  }, [
    expenseDialog?.id,
    searchParams,
    selectedGroupId,
    selectedMode,
    setSearchParams,
    splitsPage.activity
  ]);

  function scrollBackToSplitCard(splitExpenseId) {
    if (!splitExpenseId || typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      const element = document.getElementById(splitActivityDomId("expense", splitExpenseId));
      if (!element) {
        return;
      }

      element.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function scrollToSettlementActivity(checkpoint = activeCheckpoint) {
    const targetId = checkpoint?.includedRecordIds?.find((recordId) => (
      document.getElementById(splitActivityDomId("expense", recordId)) ||
      document.getElementById(splitActivityDomId("settlement", recordId))
    ));
    if (!targetId || typeof window === "undefined") {
      return;
    }

    const element = document.getElementById(splitActivityDomId("expense", targetId))
      ?? document.getElementById(splitActivityDomId("settlement", targetId));
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function closeExpenseDialogAndReturn() {
    const returnToSplitId = returnToSplitIdRef.current || expenseDialog?.id || "";
    closeExpenseDialog();
    returnToSplitIdRef.current = "";
    scrollBackToSplitCard(returnToSplitId);
  }

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

  function updateSplitSearch(value) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const normalizedValue = String(value ?? "").trim();
      if (normalizedValue) {
        next.set("split_search", normalizedValue);
      } else {
        next.delete("split_search");
      }
      return next;
    }, { replace: true });
  }

  function openArchiveList() {
    setArchiveDialog({ batchId: null });
  }

  function openArchivedBatch(batchId) {
    setArchiveDialog({ batchId });
  }

  function applyOptimisticSplitsPage(updatePage) {
    setOptimisticSplitsPage((currentPage) => updatePage(currentPage ?? latestSplitsPageRef.current));
  }

  function refreshAfterSplitMutation(options) {
    // Split saves update the local activity list immediately, then ask the
    // server to recompute any downstream data that depends on ledger ownership
    // or linked entries. The generation guard prevents older refreshes from
    // clobbering newer optimistic edits.
    const refreshGeneration = refreshGuardRef.current?.next() ?? 1;
    setIsRefreshingDerived(true);

    void onRefresh(options)
      .then(() => {
        if (refreshGuardRef.current?.isCurrent(refreshGeneration)) {
          setOptimisticSplitsPage(null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (refreshGuardRef.current?.isCurrent(refreshGeneration)) {
          setIsRefreshingDerived(false);
        }
      });
  }

  function buildSplitNoteSyncPrompt(draft, snapshot) {
    if (!draft?.linkedTransactionId || !snapshot) {
      return null;
    }

    const previousNote = snapshot.note ?? "";
    const nextNote = draft.note ?? "";
    const linkedNote = draft.linkedTransactionNote ?? "";
    if (previousNote === nextNote || linkedNote === nextNote) {
      return null;
    }

    return {
      draftKind: draft.kind,
      editedValue: nextNote,
      connectedValue: linkedNote,
      editedLabel: draft.kind === "settlement" ? "Split settlement note being saved" : "Split expense note being saved",
      connectedLabel: "Connected ledger entry current note",
      description: "This split is connected to a ledger entry. Apply the same note to the ledger entry too?"
    };
  }

  function buildSplitCategorySyncPrompt(draft, snapshot) {
    if (draft?.kind !== "expense" || !draft.linkedTransactionId || !snapshot) {
      return null;
    }

    const previousCategory = snapshot.categoryName ?? "";
    const nextCategory = draft.categoryName ?? "";
    const linkedCategory = draft.linkedTransactionCategoryName ?? "";
    if (!nextCategory || previousCategory === nextCategory || linkedCategory === nextCategory) {
      return null;
    }

    return {
      draftKind: draft.kind,
      categoryName: nextCategory,
      editedValue: nextCategory,
      connectedValue: linkedCategory || previousCategory,
      title: "Update connected entry category?",
      editedLabel: "Split category being saved",
      connectedLabel: "Connected ledger entry current category",
      description: `This split expense changed category from ${previousCategory || "Unassigned"} to ${nextCategory}. Apply the same category to the connected ledger entry too?`,
      helpText: "Choose \"Update both\" when the ledger entry and split expense describe the same real-world item. Choose \"Save only this\" when the ledger entry should keep a different category.",
      valueFormatter: (value) => value || "Unassigned"
    };
  }

  function requestSplitCategorySync(draft, snapshot, saveKind) {
    const prompt = buildSplitCategorySyncPrompt(draft, snapshot);
    if (!prompt) {
      return false;
    }

    setSplitCategorySyncPrompt({
      ...prompt,
      saveKind
    });
    return true;
  }

  function requestSplitNoteSync(draft, snapshot, saveKind) {
    const prompt = buildSplitNoteSyncPrompt(draft, snapshot);
    if (!prompt) {
      return false;
    }

    setSplitNoteSyncPrompt({
      ...prompt,
      saveKind
    });
    return true;
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
      await onRefresh({ refreshShell: true, broadcast: true });
      setGroupDialog(null);
      updateSplitView({ groupId: data.groupId, mode: "entries" });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveExpense({ syncLinkedNote = false, syncLinkedCategory = false } = {}) {
    const draft = expenseDialog;
    const validationError = validateSplitExpenseDraft(expenseDialog);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const response = await saveSplitExpense(draft);
      applyOptimisticSplitsPage((currentPage) => {
        // Keep the timeline snappy by inserting/updating the optimistic card
        // immediately. The later refresh fills in canonical balances and any
        // ledger-coupled recalculations.
        const existingItem = currentPage.activity.find((item) => item.kind === "expense" && item.id === (draft?.id ?? response.splitExpenseId));
        return {
          ...currentPage,
          activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticExpenseActivityItem({
            draft,
            splitExpenseId: response.splitExpenseId,
            viewId: view.id,
            people,
            groupOptions,
            existingItem
          }))
        };
      });
      if (syncLinkedNote && draft?.linkedTransactionId) {
        await updateLinkedEntryNote({
          entryId: draft.linkedTransactionId,
          note: draft.note ?? ""
        });
      }
      if (syncLinkedCategory && draft?.linkedTransactionId) {
        await updateLinkedEntryCategory({
          entryId: draft.linkedTransactionId,
          categoryName: draft.categoryName
        });
      }
      closeExpenseDialogAndReturn();
      refreshAfterSplitMutation(buildLinkedSplitRefreshOptions(draft?.linkedTransactionId));
      return true;
    } catch (error) {
      setFormError(error.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveSettlement({ syncLinkedNote = false } = {}) {
    const draft = settlementDialog;
    const validationError = validateSplitSettlementDraft(settlementDialog);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const response = await saveSplitSettlement(draft);
      applyOptimisticSplitsPage((currentPage) => {
        const existingItem = currentPage.activity.find((item) => item.kind === "settlement" && item.id === (draft?.id ?? response.settlementId));
        return {
          ...currentPage,
          activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticSettlementActivityItem({
            draft,
            settlementId: response.settlementId,
            viewId: view.id,
            people,
            groupOptions,
            existingItem
          }))
        };
      });
      if (syncLinkedNote && draft?.linkedTransactionId) {
        await updateLinkedEntryNote({
          entryId: draft.linkedTransactionId,
          note: draft.note ?? ""
        });
      }
      closeSettlementDialog();
      refreshAfterSplitMutation(buildLinkedSplitRefreshOptions(draft?.linkedTransactionId));
      return true;
    } catch (error) {
      setFormError(error.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmMatch(match) {
    setIsSubmitting(true);
    try {
      await linkSplitMatch(match);
      // Matching changes both the split record and, for expenses, the way the
      // linked ledger row should appear elsewhere in the app.
      applyOptimisticSplitsPage((currentPage) => applyOptimisticSplitMatch(currentPage, match));
      refreshAfterSplitMutation(buildLinkedSplitRefreshOptions(match.transactionId));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveInlineSplit({ syncLinkedNote = false, syncLinkedCategory = false } = {}) {
    if (!inlineSplitDraft) {
      return;
    }

    const draft = inlineSplitDraft;
    const validationError = inlineSplitDraft.kind === "expense"
      ? validateSplitExpenseDraft(inlineSplitDraft)
      : validateSplitSettlementDraft(inlineSplitDraft);
    if (validationError) {
      setInlineSplitError(validationError);
      return;
    }

    setInlineSplitError("");
    setIsSubmitting(true);
    try {
      if (draft.kind === "expense") {
        const response = await saveSplitExpense(draft);
        applyOptimisticSplitsPage((currentPage) => {
          const existingItem = currentPage.activity.find((item) => item.kind === "expense" && item.id === (draft.id ?? response.splitExpenseId));
          return {
            ...currentPage,
            activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticExpenseActivityItem({
              draft,
              splitExpenseId: response.splitExpenseId,
              viewId: view.id,
              people,
              groupOptions,
              existingItem
            }))
          };
        });
      } else {
        const response = await saveSplitSettlement(draft);
        applyOptimisticSplitsPage((currentPage) => {
          const existingItem = currentPage.activity.find((item) => item.kind === "settlement" && item.id === (draft.id ?? response.settlementId));
          return {
            ...currentPage,
            activity: upsertOptimisticSplitActivity(currentPage.activity, buildOptimisticSettlementActivityItem({
              draft,
              settlementId: response.settlementId,
              viewId: view.id,
              people,
              groupOptions,
              existingItem
            }))
          };
        });
      }
      if (syncLinkedNote && draft.linkedTransactionId) {
        await updateLinkedEntryNote({
          entryId: draft.linkedTransactionId,
          note: draft.note ?? ""
        });
      }
      if (syncLinkedCategory && draft.kind === "expense" && draft.linkedTransactionId) {
        await updateLinkedEntryCategory({
          entryId: draft.linkedTransactionId,
          categoryName: draft.categoryName
        });
      }
      clearInlineSplitDraft();
      refreshAfterSplitMutation(
        draft.linkedTransactionId
          ? buildLinkedSplitRefreshOptions(draft.linkedTransactionId)
          : { broadcast: true }
      );
      return true;
    } catch (error) {
      setInlineSplitError(error.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  function requestSaveExpense() {
    if (requestSplitCategorySync(expenseDialog, expenseDialogSnapshot, "expense-dialog")) {
      return;
    }

    if (requestSplitNoteSync(expenseDialog, expenseDialogSnapshot, "expense-dialog")) {
      return;
    }

    void saveExpense();
  }

  function requestSaveSettlement() {
    if (requestSplitNoteSync(settlementDialog, settlementDialogSnapshot, "settlement-dialog")) {
      return;
    }

    void saveSettlement();
  }

  function requestSaveInlineSplit() {
    if (requestSplitCategorySync(inlineSplitDraft, inlineSplitDraftSnapshot, "inline-split")) {
      return;
    }

    if (requestSplitNoteSync(inlineSplitDraft, inlineSplitDraftSnapshot, "inline-split")) {
      return;
    }

    void saveInlineSplit();
  }

  async function confirmSplitNoteSync({ updateLinked }) {
    const prompt = splitNoteSyncPrompt;
    if (!prompt) {
      return;
    }

    setIsSyncingSplitNote(true);
    setSplitNoteSyncPrompt((current) => current ? { ...current, error: "" } : current);
    try {
      let saved = false;
      if (prompt.saveKind === "expense-dialog") {
        saved = await saveExpense({ syncLinkedNote: updateLinked });
      } else if (prompt.saveKind === "settlement-dialog") {
        saved = await saveSettlement({ syncLinkedNote: updateLinked });
      } else {
        saved = await saveInlineSplit({ syncLinkedNote: updateLinked });
      }
      if (!saved) {
        return;
      }
      setSplitNoteSyncPrompt(null);
    } catch (error) {
      setSplitNoteSyncPrompt((current) => current
        ? { ...current, error: error instanceof Error ? error.message : "Failed to update connected note." }
        : current);
    } finally {
      setIsSyncingSplitNote(false);
    }
  }

  async function confirmSplitCategorySync({ updateLinked }) {
    const prompt = splitCategorySyncPrompt;
    if (!prompt) {
      return;
    }

    setIsSyncingSplitCategory(true);
    setSplitCategorySyncPrompt((current) => current ? { ...current, error: "" } : current);
    try {
      const saved = prompt.saveKind === "expense-dialog"
        ? await saveExpense({ syncLinkedCategory: updateLinked })
        : await saveInlineSplit({ syncLinkedCategory: updateLinked });
      if (!saved) {
        return;
      }
      setSplitCategorySyncPrompt(null);
    } catch (error) {
      setSplitCategorySyncPrompt((current) => current
        ? { ...current, error: error instanceof Error ? error.message : "Failed to update connected entry category." }
        : current);
    } finally {
      setIsSyncingSplitCategory(false);
    }
  }

  function openLinkedEntry(item) {
    if (!item.linkedTransactionId) {
      return;
    }

    const params = new URLSearchParams({
      view: view.id,
      month: item.date?.slice(0, 7) ?? splitsPage.month,
      entries_scope: searchParams.get("scope") ?? "direct_plus_shared",
      editing_entry: item.linkedTransactionId
    });
    navigate({
      pathname: "/entries",
      search: `?${params.toString()}`
    });
  }

  function openMatchesView() {
    updateSplitView({ groupId: activeGroup?.id ?? defaultGroupId, mode: "matches" });
  }

  function openActiveGroupView() {
    updateSplitView({ groupId: activeGroup?.id ?? defaultGroupId, mode: "entries" });
  }

  async function simplifySettlement() {
    if (isHouseholdView || isCheckpointing) return;
    setCheckpointError("");
    setIsCheckpointing(true);
    try {
      await createSettlementCheckpoint({
        viewerPersonId: view.id,
        date: new Date().toISOString().slice(0, 10),
        note: "Simplified settlement",
        currency: activeGroup?.currency
      });
      refreshAfterSplitMutation({ broadcast: true });
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to simplify settlement.");
    } finally {
      setIsCheckpointing(false);
    }
  }

  async function restoreSplitHistoryItem(item) {
    setIsSubmitting(true);
    try {
      await restoreSplitRecord({ recordKind: item.recordKind, recordId: item.recordId });
      setShowHistory(false);
      onRefresh({ broadcast: true });
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to restore split.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function reopenSettlement() {
    if (!activeCheckpoint || isCheckpointing) return;
    setCheckpointError("");
    setCheckpointNotice("");
    setIsCheckpointing(true);
    try {
      await reopenSettlementCheckpoint(activeCheckpoint.id);
      setCheckpointNotice("Simplified settlement undone. Its included activity is open again.");
      refreshAfterSplitMutation({ broadcast: true });
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to reopen settlement.");
    } finally {
      setIsCheckpointing(false);
    }
  }

  async function markCheckpointPaid(checkpoint) {
    if (!checkpoint || isCheckpointing) return;
    setCheckpointError("");
    setCheckpointNotice("");
    setIsCheckpointing(true);
    try {
      await markSettlementCheckpointPaid(checkpoint.id);
      setCheckpointMatchTargetId(null);
      setCheckpointTransferId("");
      setCheckpointNotice("Marked paid. It is now in Settled, awaiting bank match until you link the transfer.");
      refreshAfterSplitMutation({ broadcast: true });
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to mark settlement paid.");
    } finally {
      setIsCheckpointing(false);
    }
  }

  async function undoCheckpointPaid(checkpoint) {
    if (!checkpoint || isCheckpointing) return;
    setCheckpointError("");
    setCheckpointNotice("");
    setIsCheckpointing(true);
    try {
      await undoSettlementCheckpointPaid(checkpoint.id);
      setCheckpointMatchTargetId(null);
      setCheckpointTransferId("");
      setCheckpointNotice("Payment confirmation undone. The settlement is active again.");
      refreshAfterSplitMutation({ broadcast: true });
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to undo paid settlement.");
    } finally {
      setIsCheckpointing(false);
    }
  }

  async function matchCheckpoint(checkpoint) {
    if (!checkpoint || !checkpointTransferId || isCheckpointing) return;
    setCheckpointError("");
    setCheckpointNotice("");
    setIsCheckpointing(true);
    try {
      const selectedTransfer = (view.monthPage?.entries ?? []).find((entry) => entry.id === checkpointTransferId);
      const fxRateBasisPoints = selectedTransfer && selectedTransfer.currency !== checkpoint.currency
        ? Math.round(Number(checkpointFxRateInput || 0) * 10000)
        : 10000;
      await matchSettlementCheckpoint({ checkpointId: checkpoint.id, transactionId: checkpointTransferId, fxRateBasisPoints });
      setCheckpointTransferId("");
      setCheckpointFxRateInput("1");
      setCheckpointMatchTargetId(null);
      setCheckpointNotice("Bank transfer matched to the settlement.");
      refreshAfterSplitMutation({ broadcast: true, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to match settlement.");
    } finally {
      setIsCheckpointing(false);
    }
  }

  async function unmatchCheckpoint(checkpoint, transactionId) {
    if (!checkpoint || isCheckpointing) return;
    setCheckpointError("");
    setCheckpointNotice("");
    setIsCheckpointing(true);
    try {
      await unmatchSettlementCheckpoint({ checkpointId: checkpoint.id, transactionId });
      setCheckpointNotice("Bank transfer removed from the settlement.");
      refreshAfterSplitMutation({ broadcast: true, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to remove settlement transfer.");
    } finally {
      setIsCheckpointing(false);
    }
  }

  async function confirmDeleteSplit() {
    if (!deleteTarget) {
      return;
    }

    setFormError("");
    setInlineSplitError("");
    setIsSubmitting(true);
    try {
      const deletedSplitKey = `${deleteTarget.kind}:${deleteTarget.id}`;
      if (deleteTarget.kind === "expense") {
        await deleteSplitExpense(deleteTarget.id);
      } else {
        await deleteSplitSettlement(deleteTarget.id);
      }
      applyOptimisticSplitsPage((currentPage) => ({
        ...currentPage,
        activity: removeOptimisticSplitActivity(currentPage.activity, deleteTarget),
        matches: currentPage.matches.filter((item) => item.splitRecordId !== deleteTarget.id)
      }));
      setDeleteTarget(null);
      if (`${inlineSplitDraft?.kind}:${inlineSplitDraft?.id}` === deletedSplitKey) {
        clearInlineSplitSnapshot();
        setInlineSplitError("");
        setInlineSplitDraft(null);
      }
      refreshAfterSplitMutation({
        broadcast: true,
        invalidateEntries: Boolean(deleteTarget.linkedTransactionId),
        invalidateMonth: Boolean(deleteTarget.linkedTransactionId),
        invalidateSummary: Boolean(deleteTarget.linkedTransactionId)
      });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderSplitActions(className) {
    return (
      <div className={className}>
        <button
          type="button"
          className={`split-matches-link ${selectedMode === "matches" ? "is-active" : ""}`}
          onClick={selectedMode === "matches" ? openActiveGroupView : openMatchesView}
        >
          {selectedMode === "matches" ? messages.splits.backToGroup : messages.splits.reviewMatches}
          {selectedMode !== "matches" && pendingMatchCount ? ` (${pendingMatchCount})` : ""}
        </button>
        {!isHouseholdView && selectedMode !== "matches" ? (
          <button
            type="button"
            className="subtle-action split-settle-header"
            onClick={() => {
              openNewSettlementDialog({ activeGroup, groupBalanceMinor });
            }}
            disabled={!activeGroup || groupBalanceMinor === 0}
          >
            {messages.splits.settleUp}
          </button>
        ) : null}
        {!isHouseholdView && selectedMode !== "matches" && !activeCheckpoint ? (
          <button type="button" className="subtle-action split-simplify-action" onClick={() => void simplifySettlement()} disabled={isCheckpointing}>
            {isCheckpointing ? "Simplifying..." : "Simplify settlement"}
          </button>
        ) : null}
      </div>
    );
  }

  const splitSearchControl = (
    <SearchFilterInput
      className="split-summary-search"
      label={messages.common.search}
      value={splitSearchQuery}
      placeholder={messages.splits.searchPlaceholder}
      suggestions={searchSuggestions}
      listId="splits-search-suggestions"
      onChange={updateSplitSearch}
    />
  );
  const splitSummaryToolbar = renderSplitActions("split-head-actions split-summary-toolbar");
  const formatCheckpointMoney = (amountMinor, currency) => formatService.moneyWithCurrency(amountMinor, currency ?? "SGD");
  const selectedCheckpointForMatching = settlementCheckpoints.find((checkpoint) => checkpoint.id === checkpointMatchTargetId);
  const renderCheckpointTransfers = (checkpoint) => checkpoint.matchedTransfers?.length ? (
    <div className="split-checkpoint-transfers" aria-label="Matched transfers">
      {checkpoint.matchedTransfers.map((transfer) => (
        <div className="split-checkpoint-transfer" key={transfer.transactionId}>
          <span>{transfer.description} · {formatCheckpointMoney(transfer.ledgerAmountMinor ?? transfer.amountMinor, transfer.currency)}{transfer.currency !== checkpoint.currency ? ` · ${formatCheckpointMoney(transfer.amountMinor, checkpoint.currency)}` : ""}</span>
          <button type="button" className="subtle-action" onClick={() => void unmatchCheckpoint(checkpoint, transfer.transactionId)} disabled={isCheckpointing}>Remove</button>
        </div>
      ))}
    </div>
  ) : null;
  const renderCheckpointMatchControls = (checkpoint, { collapsed = false } = {}) => {
    const isExpanded = !collapsed || selectedCheckpointForMatching?.id === checkpoint.id;
    const availableTransfers = (view.monthPage?.entries ?? []).filter((entry) => (
      entry.entryType === "transfer" && !(checkpoint.matchedTransfers ?? []).some((transfer) => transfer.transactionId === entry.id)
    ));
    if (!isExpanded) {
      return (
        <button type="button" className={collapsed ? "subtle-action split-settlement-follow-up-match-action" : "subtle-action"} onClick={() => {
          setCheckpointMatchTargetId(checkpoint.id);
          setCheckpointTransferId("");
          setCheckpointFxRateInput("1");
        }} disabled={isCheckpointing}>Match bank transfer</button>
      );
    }
    return (
      <div className="split-checkpoint-actions">
        <select aria-label={`Transfer to match ${checkpoint.fromPersonName} to ${checkpoint.toPersonName}`} value={checkpointTransferId} onChange={(event) => setCheckpointTransferId(event.target.value)}>
          <option value="">Match a transfer...</option>
          {availableTransfers.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.description} · {formatCheckpointMoney(entry.amountMinor, entry.currency ?? "SGD")}</option>
          ))}
        </select>
        {(view.monthPage?.entries ?? []).find((entry) => entry.id === checkpointTransferId)?.currency !== checkpoint.currency && checkpointTransferId ? (
          <input aria-label={`FX rate from ${(view.monthPage?.entries ?? []).find((entry) => entry.id === checkpointTransferId)?.currency ?? "ledger currency"} to ${checkpoint.currency}`} inputMode="decimal" type="number" min="0.000001" step="0.000001" value={checkpointFxRateInput} onChange={(event) => setCheckpointFxRateInput(event.target.value)} />
        ) : null}
        <button type="button" className="subtle-action" onClick={() => void matchCheckpoint(checkpoint)} disabled={!checkpointTransferId || isCheckpointing}>Match transfer</button>
        {collapsed ? <button type="button" className="subtle-action" onClick={() => setCheckpointMatchTargetId(null)} disabled={isCheckpointing}>Hide</button> : null}
        {!availableTransfers.length ? <small className="split-checkpoint-match-hint">No transfers in this month yet. When the bank posts it, return here with that month selected.</small> : null}
      </div>
    );
  };
  const splitSettlementStatus = activeCheckpoint ? (
    <section className={`split-checkpoint-panel is-${activeCheckpoint.status}`} aria-live="polite">
      <div className="split-checkpoint-summary">
        <div className="split-checkpoint-heading">
          <span className="split-checkpoint-kicker">Settlement status</span>
          <strong>{activeCheckpoint.status === "internally_offset" ? "Groups internally offset" : "Simplified settlement"}</strong>
        </div>
        <p>
          {checkpointHasOverpayment
            ? "Matched transfers exceed the checkpoint. Review the difference before considering this settled."
            : activeCheckpoint.amountMinor === 0
            ? "The included groups now net to zero. No bank transfer is needed."
            : <>{activeCheckpoint.fromPersonName} pays {activeCheckpoint.toPersonName} <PrivateMoney>{formatCheckpointMoney(activeCheckpoint.amountMinor, activeCheckpoint.currency)}</PrivateMoney>.</>}
        </p>
        <small>{activeCheckpoint.currency ?? "SGD"} · {activeCheckpoint.includedRecordCount} included split records · {activeCheckpoint.matchedAmountMinor > 0 ? <><PrivateMoney>{formatCheckpointMoney(activeCheckpoint.matchedAmountMinor, activeCheckpoint.currency)}</PrivateMoney> matched · </> : null}{activeCheckpoint.status.replaceAll("_", " ")}</small>
      </div>
      <div className="split-checkpoint-navigation">
        <button type="button" className="split-checkpoint-view-action" onClick={scrollToSettlementActivity}>
          View included activity
        </button>
        <span className="split-checkpoint-navigation-hint">Included rows are marked in the timeline below.</span>
      </div>
      {renderCheckpointTransfers(activeCheckpoint)}
      {activeCheckpoint.amountMinor !== 0 ? renderCheckpointMatchControls(activeCheckpoint) : null}
      <div className="split-checkpoint-completion-actions">
        <button type="button" className="split-checkpoint-view-action" onClick={() => void markCheckpointPaid(activeCheckpoint)} disabled={isCheckpointing}>Mark paid</button>
        <small>Moves this repayment out of the active view. It remains awaiting a bank transfer match.</small>
        <button type="button" className="subtle-action split-checkpoint-reopen" onClick={() => void reopenSettlement()} disabled={isCheckpointing}>Undo simplification</button>
      </div>
    </section>
  ) : null;
  const settlementFollowUps = paidCheckpointsAwaitingBankMatch.length ? (
    <section className="split-settlement-follow-ups" aria-live="polite">
      <button
        type="button"
        className="split-settlement-follow-up-trigger"
        aria-expanded={showSettlementFollowUps}
        onClick={() => setShowSettlementFollowUps((current) => !current)}
      >
        <span>Settled, awaiting bank match ({paidCheckpointsAwaitingBankMatch.length})</span>
        <small>{showSettlementFollowUps ? "Hide follow-up" : "Review when the transfer reaches the ledger"}</small>
      </button>
      {showSettlementFollowUps ? (
        <div className="split-settlement-follow-up-list">
          {paidCheckpointsAwaitingBankMatch.map((checkpoint) => (
            <section className="split-settlement-follow-up" key={checkpoint.id}>
              <div>
                <strong>{checkpoint.fromPersonName} paid {checkpoint.toPersonName} <PrivateMoney>{formatCheckpointMoney(checkpoint.amountMinor, checkpoint.currency)}</PrivateMoney></strong>
                <small>Marked paid {checkpoint.settledAt?.slice(0, 10)} · {checkpoint.includedRecordCount} included split records · {checkpoint.matchedAmountMinor ? <><PrivateMoney>{formatCheckpointMoney(checkpoint.matchedAmountMinor, checkpoint.currency)}</PrivateMoney> bank-matched so far</> : "No bank transfer matched yet"}</small>
              </div>
              <div className="split-settlement-follow-up-actions">
                <button type="button" className="subtle-action split-settlement-follow-up-view-action" onClick={() => scrollToSettlementActivity(checkpoint)}>View included activity</button>
                <button type="button" className="subtle-action split-settlement-follow-up-undo-action" onClick={() => void undoCheckpointPaid(checkpoint)} disabled={isCheckpointing}>Undo paid</button>
              </div>
              {renderCheckpointTransfers(checkpoint)}
              {renderCheckpointMatchControls(checkpoint, { collapsed: true })}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  ) : null;

  return (
    <article className="panel panel-accent panel-splits">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.splits}</h2>
          <p className="panel-context">{messages.splits.viewing(view.label)}</p>
          {isRefreshingDerived ? (
            <div className="split-refresh-status" role="status" aria-live="polite">
              <span className="app-spinner" aria-hidden="true" />
              <span>{messages.common.loadingLatest}</span>
            </div>
          ) : null}
        </div>
        {renderSplitActions("split-head-actions split-header-toolbar")}
      </div>

      <FinancialInsight facts={financialInsightFacts} actions={financialInsightActions} className="financial-insight-splits" />

      <SplitsMainSection
        groups={groups}
        activeGroup={activeGroup}
        selectedMode={selectedMode}
        pendingMatchCount={pendingMatchCount}
        showBreakdown={showBreakdown}
        totalExpenseMinor={totalExpenseMinor}
        groupBalanceMinor={groupBalanceMinor}
        groupSummaryLabel={groupSummaryLabel}
        donutRows={donutRows}
        donutChart={splitsPage.donutChart}
        categories={categories}
        groupOptions={groupOptions}
        people={people}
        categoryOptions={categoryOptions}
        searchControl={splitSearchControl}
        summaryToolbar={splitSummaryToolbar}
        visibleMatches={visibleMatches}
        groupedCurrentActivity={groupedCurrentActivity}
        archivedBatches={archivedBatches}
        searchQuery={splitSearchQuery}
        inlineSplitDraft={inlineSplitDraft}
        inlineSplitError={inlineSplitError}
        isSubmitting={isSubmitting}
        onSelectGroup={(groupId) => updateSplitView({ groupId, mode: "entries" })}
        onOpenMatches={openMatchesView}
        onOpenHistory={() => setShowHistory(true)}
        onBackToGroup={openActiveGroupView}
        onCreateGroup={() => {
          setFormError("");
          setGroupDialog({ name: "", currency: "SGD", expenseSource: "mixed" });
        }}
        onToggleBreakdown={() => setShowBreakdown((current) => !current)}
        onAddExpense={() => openNewExpenseDialog({ activeGroup, view })}
        onDismissMatch={(matchId) => setDismissedMatchIds((current) => [...current, matchId])}
        onConfirmMatch={confirmMatch}
        onOpenArchive={openArchiveList}
        readOnly={isHouseholdView}
        onEditExpense={isHouseholdView ? openExpenseEditor : (useMobileSplitSheet ? openExpenseEditor : openInlineExpenseEditor)}
        onEditSettlement={isHouseholdView ? openSettlementEditor : (useMobileSplitSheet ? openSettlementEditor : openInlineSettlementEditor)}
        onChangeInlineSplitDraft={setInlineSplitDraft}
        onCancelInlineSplit={() => {
          setInlineSplitDraft(null);
          clearInlineSplitSnapshot();
          setInlineSplitError("");
        }}
        hasInlineSplitChanges={hasInlineSplitChanges}
        onSaveInlineSplit={requestSaveInlineSplit}
        onRequestDeleteSplit={requestDeleteSplit}
        onViewLinkedEntry={openLinkedEntry}
        onRefreshActivity={() => onRefresh()}
        viewId={view.id}
        isRefreshingDerived={isRefreshingDerived}
        settlementStatus={<>{splitSettlementStatus}{settlementFollowUps}</>}
      />
      {checkpointError ? <p className="form-error" role="alert">{checkpointError}</p> : null}
      {checkpointNotice ? <p className="form-success" role="status">{checkpointNotice}</p> : null}

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
        onViewLinkedEntry={openLinkedEntry}
      />

      <SplitHistoryDialog
        open={showHistory}
        history={splitsPage.activityHistory ?? []}
        isSubmitting={isSubmitting}
        onClose={() => setShowHistory(false)}
        onRestore={restoreSplitHistoryItem}
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
        categories={categories}
        formError={formError}
        isSubmitting={isSubmitting}
        isSaveDisabled={!hasExpenseDialogChanges}
        onChange={setExpenseDialog}
        onClose={closeExpenseDialogAndReturn}
        onSave={requestSaveExpense}
        onViewLinkedEntry={openLinkedEntry}
        onRequestDelete={requestDeleteSplit}
        readOnly={isHouseholdView}
      />

      <SplitSettlementDialog
        dialog={settlementDialog}
        groupOptions={groupOptions}
        people={people}
        formError={formError}
        isSubmitting={isSubmitting}
        isSaveDisabled={!hasSettlementDialogChanges}
        onChange={setSettlementDialog}
        onClose={() => {
          closeSettlementDialog();
        }}
        onSave={requestSaveSettlement}
        onViewLinkedEntry={openLinkedEntry}
        onRequestDelete={requestDeleteSplit}
        readOnly={isHouseholdView}
      />
      <LinkedNoteSyncDialog
        prompt={splitNoteSyncPrompt}
        isSubmitting={isSyncingSplitNote || isSubmitting}
        onCancel={() => setSplitNoteSyncPrompt(null)}
        onSaveOnly={() => void confirmSplitNoteSync({ updateLinked: false })}
        onUpdateBoth={() => void confirmSplitNoteSync({ updateLinked: true })}
      />
      <LinkedNoteSyncDialog
        prompt={splitCategorySyncPrompt}
        isSubmitting={isSyncingSplitCategory || isSubmitting}
        onCancel={() => setSplitCategorySyncPrompt(null)}
        onSaveOnly={() => void confirmSplitCategorySync({ updateLinked: false })}
        onUpdateBoth={() => void confirmSplitCategorySync({ updateLinked: true })}
      />
    </article>
  );
}
