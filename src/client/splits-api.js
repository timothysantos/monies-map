async function postJson(endpoint, body, fallbackError) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? fallbackError);
  }
  return data;
}

// Keep split write endpoints in one place so panel components do not need to know API payload shapes.
export function createSplitGroup(draft) {
  return postJson(
    "/api/splits/groups/create",
    { name: draft.name, currency: draft.currency, expenseSource: draft.expenseSource },
    "Failed to create split group."
  );
}

export function saveSplitExpense(draft) {
  const isEditing = Boolean(draft?.id);
  return postJson(
    isEditing ? "/api/splits/expenses/update" : "/api/splits/expenses/create",
    {
      splitExpenseId: draft.id,
      groupId: draft.groupId === "split-group-none" ? null : draft.groupId,
      date: draft.date,
      description: draft.description,
      categoryName: draft.categoryName,
      payerPersonName: draft.payerPersonName,
      amountMinor: Number(draft.amountMinor ?? 0),
      note: draft.note,
      splitBasisPoints: Number(draft.splitBasisPoints ?? 5000),
      splitAmountMinor: Number(draft.splitAmountMinor ?? 0),
      currency: draft.currency,
      homeAmountMinor: draft.homeAmountMinor == null ? undefined : Number(draft.homeAmountMinor),
      fxRateBasisPoints: draft.fxRateBasisPoints == null ? undefined : Number(draft.fxRateBasisPoints),
      paymentMethod: draft.paymentMethod,
      paymentStatus: draft.paymentStatus
    },
    "Failed to create split expense."
  );
}

export function saveSplitSettlement(draft) {
  const isEditing = Boolean(draft?.id);
  return postJson(
    isEditing ? "/api/splits/settlements/update" : "/api/splits/settlements/create",
    {
      settlementId: draft.id,
      groupId: draft.groupId === "split-group-none" ? null : draft.groupId,
      date: draft.date,
      fromPersonName: draft.fromPersonName,
      toPersonName: draft.toPersonName,
      amountMinor: Number(draft.amountMinor ?? 0),
      note: draft.note,
      currency: draft.currency,
      fxRateBasisPoints: draft.fxRateBasisPoints == null ? undefined : Number(draft.fxRateBasisPoints),
      paymentMethod: draft.paymentMethod,
      paymentStatus: draft.paymentStatus
    },
    "Failed to create settlement."
  );
}

export function deleteSplitExpense(splitExpenseId) {
  return postJson(
    "/api/splits/expenses/delete",
    { splitExpenseId },
    "Failed to delete split expense."
  );
}

export function deleteSplitSettlement(settlementId) {
  return postJson(
    "/api/splits/settlements/delete",
    { settlementId },
    "Failed to delete settlement."
  );
}

export function restoreSplitRecord({ recordKind, recordId }) {
  return postJson("/api/splits/activity-history/restore", { recordKind, recordId }, "Failed to restore split.");
}

export function createSettlementCheckpoint({ viewerPersonId, date, note, currency }) {
  return postJson("/api/splits/checkpoints/create", { viewerPersonId, date, note, currency }, "Failed to simplify settlement.");
}

export function reopenSettlementCheckpoint(checkpointId) {
  return postJson("/api/splits/checkpoints/reopen", { checkpointId }, "Failed to reopen settlement.");
}

export function markSettlementCheckpointPaid(checkpointId) {
  return postJson("/api/splits/checkpoints/mark-paid", { checkpointId }, "Failed to mark settlement paid.");
}

export function undoSettlementCheckpointPaid(checkpointId) {
  return postJson("/api/splits/checkpoints/undo-paid", { checkpointId }, "Failed to undo paid settlement.");
}

export function matchSettlementCheckpoint({ checkpointId, transactionId, fxRateBasisPoints }) {
  return postJson("/api/splits/checkpoints/match", { checkpointId, transactionId, fxRateBasisPoints }, "Failed to match settlement.");
}

export function unmatchSettlementCheckpoint({ checkpointId, transactionId }) {
  return postJson("/api/splits/checkpoints/unmatch", { checkpointId, transactionId }, "Failed to remove settlement transfer.");
}

export function linkSplitMatch(match) {
  const endpoint = match.kind === "expense" ? "/api/splits/matches/link-expense" : "/api/splits/matches/link-settlement";
  const body = match.kind === "expense"
    ? { splitExpenseId: match.splitRecordId, transactionId: match.transactionId }
    : { settlementId: match.splitRecordId, transactionId: match.transactionId };
  return postJson(endpoint, body, "Failed to match split record.");
}

export function updateSplitLinkedEntry(draft) {
  return postJson(
    "/api/entries/update",
    draft,
    "Failed to update linked entry."
  );
}

export function updateLinkedEntryNote({ entryId, note }) {
  return postJson(
    "/api/entries/update-note",
    { entryId, note },
    "Failed to update linked entry note."
  );
}

export function updateLinkedEntryCategory({ entryId, categoryName }) {
  return postJson(
    "/api/entries/update-category",
    { entryId, categoryName },
    "Failed to update linked entry category."
  );
}

export function updateSplitExpenseNote({ splitExpenseId, note }) {
  return postJson(
    "/api/splits/expenses/update-note",
    { splitExpenseId, note },
    "Failed to update split note."
  );
}

export function updateSplitExpenseCategory({ splitExpenseId, categoryName }) {
  return postJson(
    "/api/splits/expenses/update-category",
    { splitExpenseId, categoryName },
    "Failed to update split category."
  );
}

export function updateSplitSettlementNote({ settlementId, note }) {
  return postJson(
    "/api/splits/settlements/update-note",
    { settlementId, note },
    "Failed to update settlement note."
  );
}
