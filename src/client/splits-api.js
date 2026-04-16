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
    { name: draft.name },
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
      splitBasisPoints: Number(draft.splitBasisPoints ?? 5000)
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
      note: draft.note
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
