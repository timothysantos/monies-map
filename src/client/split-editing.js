import { useCallback, useMemo, useState } from "react";

import {
  buildExpenseDraft,
  buildNewExpenseDraft,
  buildNewSettlementDraft,
  buildSettlementDraft
} from "./splits-drafts";

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
      splitBasisPoints: Number(draft.splitBasisPoints ?? 5000)
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
