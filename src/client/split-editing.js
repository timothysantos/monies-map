import { useCallback, useMemo, useState } from "react";

import {
  buildExpenseDraft,
  buildNewExpenseDraft,
  buildNewSettlementDraft,
  buildSettlementDraft
} from "./splits-drafts";
import { syncSplitShareState } from "./split-share-state";

export function useSplitEditState({ categoryOptions, people }) {
  const [expenseDialog, setExpenseDialog] = useState(null);
  const [settlementDialog, setSettlementDialog] = useState(null);
  const [inlineSplitDraft, setInlineSplitDraft] = useState(null);
  const [expenseDialogSnapshot, setExpenseDialogSnapshot] = useState(null);
  const [settlementDialogSnapshot, setSettlementDialogSnapshot] = useState(null);
  const [inlineSplitDraftSnapshot, setInlineSplitDraftSnapshot] = useState(null);
  const [inlineSplitError, setInlineSplitError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formError, setFormError] = useState("");

  const isEditingExpenseDialog = Boolean(expenseDialog?.id);
  const isEditingSettlementDialog = Boolean(settlementDialog?.id);
  const hasExpenseDialogChanges = useMemo(() => {
    if (!isEditingExpenseDialog || !expenseDialogSnapshot) {
      return true;
    }

    return JSON.stringify(buildComparableSplitDraft(expenseDialog))
      !== JSON.stringify(buildComparableSplitDraft(expenseDialogSnapshot));
  }, [expenseDialog, expenseDialogSnapshot, isEditingExpenseDialog]);
  const hasSettlementDialogChanges = useMemo(() => {
    if (!isEditingSettlementDialog || !settlementDialogSnapshot) {
      return true;
    }

    return JSON.stringify(buildComparableSplitDraft(settlementDialog))
      !== JSON.stringify(buildComparableSplitDraft(settlementDialogSnapshot));
  }, [isEditingSettlementDialog, settlementDialog, settlementDialogSnapshot]);
  const hasInlineSplitChanges = useMemo(() => {
    if (!inlineSplitDraft?.id || !inlineSplitDraftSnapshot) {
      return true;
    }

    return JSON.stringify(buildComparableSplitDraft(inlineSplitDraft))
      !== JSON.stringify(buildComparableSplitDraft(inlineSplitDraftSnapshot));
  }, [inlineSplitDraft, inlineSplitDraftSnapshot]);

  const openExpenseEditor = useCallback((item) => {
    setFormError("");
    const draft = buildExpenseDraft(item, categoryOptions, people);
    setExpenseDialog(draft);
    setExpenseDialogSnapshot(draft);
  }, [categoryOptions, people]);

  const openSettlementEditor = useCallback((item) => {
    setFormError("");
    const draft = buildSettlementDraft(item, people);
    setSettlementDialog(draft);
    setSettlementDialogSnapshot(draft);
  }, [people]);

  const openInlineExpenseEditor = useCallback((item) => {
    setFormError("");
    setInlineSplitError("");
    const draft = buildExpenseDraft(item, categoryOptions, people);
    setInlineSplitDraft(draft);
    setInlineSplitDraftSnapshot(draft);
  }, [categoryOptions, people]);

  const openInlineSettlementEditor = useCallback((item) => {
    setFormError("");
    setInlineSplitError("");
    const draft = buildSettlementDraft(item, people);
    setInlineSplitDraft(draft);
    setInlineSplitDraftSnapshot(draft);
  }, [people]);

  const openNewExpenseDialog = useCallback(({ activeGroup, view }) => {
    setFormError("");
    setExpenseDialog(buildNewExpenseDraft({ activeGroup, categoryOptions, people, view }));
    setExpenseDialogSnapshot(null);
  }, [categoryOptions, people]);

  const openNewSettlementDialog = useCallback(({ activeGroup, groupBalanceMinor }) => {
    setFormError("");
    setSettlementDialog(buildNewSettlementDraft({ activeGroup, groupBalanceMinor, people }));
    setSettlementDialogSnapshot(null);
  }, [people]);

  const closeExpenseDialog = useCallback(() => {
    setExpenseDialog(null);
    setExpenseDialogSnapshot(null);
  }, []);

  const closeSettlementDialog = useCallback(() => {
    setSettlementDialog(null);
    setSettlementDialogSnapshot(null);
  }, []);

  const clearInlineSplitDraft = useCallback(() => {
    setInlineSplitDraft(null);
    setInlineSplitDraftSnapshot(null);
    setInlineSplitError("");
  }, []);

  const resetForViewChange = useCallback(() => {
    setFormError("");
    clearInlineSplitDraft();
    setDeleteTarget(null);
  }, [clearInlineSplitDraft]);

  const requestDeleteSplit = useCallback((item) => {
    setFormError("");
    setInlineSplitError("");
    setDeleteTarget(item);
  }, []);

  return {
    expenseDialog,
    settlementDialog,
    inlineSplitDraft,
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
    clearExpenseDialogSnapshot: useCallback(() => setExpenseDialogSnapshot(null), []),
    clearSettlementDialogSnapshot: useCallback(() => setSettlementDialogSnapshot(null), []),
    clearInlineSplitSnapshot: useCallback(() => setInlineSplitDraftSnapshot(null), [])
  };
}

export function validateSplitExpenseDraft(draft) {
  if (!draft?.description?.trim() || !draft.date || !draft.payerPersonName || !draft.categoryName) {
    return "Expense description, date, payer, and category are required.";
  }

  if (Number(draft.amountMinor ?? 0) <= 0) {
    return "Expense amount must be greater than zero.";
  }

  if (Number(draft.splitAmountMinor ?? 0) < 0 || Number(draft.splitAmountMinor ?? 0) > Number(draft.amountMinor ?? 0)) {
    return "Exact split amount must be between zero and the full expense amount.";
  }

  return "";
}

export function validateSplitSettlementDraft(draft) {
  if (!draft?.date || !draft.fromPersonName || !draft.toPersonName) {
    return "Settlement date and both people are required.";
  }

  return "";
}

function buildComparableSplitDraft(draft) {
  if (!draft) {
    return null;
  }

  if (draft.kind === "expense") {
    return {
      kind: draft.kind,
      id: draft.id ?? null,
      groupId: draft.groupId ?? "split-group-none",
      date: draft.date,
      description: draft.description,
      categoryName: draft.categoryName,
      payerPersonName: draft.payerPersonName,
      amountMinor: Number(draft.amountMinor ?? 0),
      note: draft.note ?? "",
      sharePersonName: draft.sharePersonName ?? "",
      splitBasisPoints: Number(draft.splitBasisPoints ?? 5000),
      splitAmountMinor: Number(draft.splitAmountMinor ?? 0),
      splitValueMode: draft.splitValueMode ?? "percent"
    };
  }

  return {
    kind: draft.kind,
    id: draft.id ?? null,
    groupId: draft.groupId ?? "split-group-none",
    date: draft.date,
    fromPersonName: draft.fromPersonName,
    toPersonName: draft.toPersonName,
    amountMinor: Number(draft.amountMinor ?? 0),
    note: draft.note ?? ""
  };
}

export function updateSplitExpenseDraft(current, patch = {}, modeOverride) {
  if (!current) {
    return current;
  }

  return syncSplitShareState(current, patch, modeOverride);
}
