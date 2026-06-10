import { buildRequestErrorMessage } from "./request-errors";

async function postJson(endpoint, body, fallbackError) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? fallbackError);
  }
  return data;
}

export async function runDemoAction(endpoint, fallbackError) {
  const response = await fetch(endpoint, { method: "POST" });

  if (!response.ok) {
    throw new Error(await buildRequestErrorMessage(response, fallbackError));
  }

  const data = await response.json().catch(() => ({}));
  if (data.ok === false) {
    throw new Error(data.error ?? fallbackError);
  }

  return data;
}

export function saveSettingsCategory({
  mode,
  categoryId,
  name,
  slug,
  iconKey,
  colorHex
}) {
  return postJson(
    mode === "create" ? "/api/categories/create" : "/api/categories/update",
    {
      categoryId: categoryId || undefined,
      name,
      slug,
      iconKey,
      colorHex
    },
    "Failed to save category"
  );
}

export function updateSettingsPerson({ personId, name }) {
  return postJson(
    "/api/people/update",
    { personId, name },
    "Failed to update person"
  );
}

export function deleteSettingsCategory(categoryId) {
  return postJson(
    "/api/categories/delete",
    { categoryId },
    "Failed to delete category"
  );
}

export function saveCategoryMatchRule({ ruleId, sourceSuggestionId, pattern, categoryId, priority, isActive, note }) {
  return postJson(
    "/api/category-match-rules/save",
    { ruleId, sourceSuggestionId, pattern, categoryId, priority, isActive, note },
    "Failed to save category match rule"
  );
}

export function deleteCategoryMatchRule(ruleId) {
  return postJson(
    "/api/category-match-rules/delete",
    { ruleId },
    "Failed to delete category match rule"
  );
}

export function dismissUnresolvedTransfer(entryId) {
  return postJson(
    "/api/transfers/dismiss-unresolved",
    { entryId },
    "Failed to clear unresolved transfer"
  );
}

export function dismissAllUnresolvedTransfers() {
  return postJson(
    "/api/transfers/dismiss-all-unresolved",
    {},
    "Failed to clear unresolved transfers"
  );
}

export function ignoreCategoryMatchRuleSuggestion(suggestionId) {
  return postJson(
    "/api/category-match-suggestions/ignore",
    { suggestionId },
    "Failed to ignore category match suggestion"
  );
}

export function createReconciliationException({
  accountId,
  transactionId,
  checkpointMonth,
  kind,
  severity,
  title,
  note
}) {
  return postJson(
    "/api/reconciliation-exceptions/create",
    { accountId, transactionId, checkpointMonth, kind, severity, title, note },
    "Failed to create reconciliation exception."
  );
}

export function resolveReconciliationException({ exceptionId, resolutionNote }) {
  return postJson(
    "/api/reconciliation-exceptions/resolve",
    { exceptionId, resolutionNote },
    "Failed to resolve reconciliation exception."
  );
}
