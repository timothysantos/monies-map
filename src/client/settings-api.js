import { buildCheckpointExportHref, getContentDispositionFilename } from "./formatters";
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

export async function saveSettingsAccount({
  mode,
  accountId,
  name,
  institution,
  kind,
  currency,
  openingBalanceMinor,
  ownerPersonId,
  isJoint
}) {
  const endpoint = mode === "create" ? "/api/accounts/create" : "/api/accounts/update";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: accountId || undefined,
      name,
      institution,
      kind,
      currency,
      openingBalanceMinor,
      ownerPersonId: isJoint ? null : (ownerPersonId || null),
      isJoint
    })
  });

  if (!response.ok) {
    throw new Error(await buildRequestErrorMessage(response, "Account save failed."));
  }

  return response.json().catch(() => ({}));
}

export function archiveSettingsAccount(accountId) {
  return postJson(
    "/api/accounts/archive",
    { accountId },
    "Account archive failed."
  );
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

export function ignoreCategoryMatchRuleSuggestion(suggestionId) {
  return postJson(
    "/api/category-match-suggestions/ignore",
    { suggestionId },
    "Failed to ignore category match suggestion"
  );
}

// Checkpoint requests are grouped here because reconcile, history delete, export,
// and statement compare all operate on the same statement-period boundary.
export function saveAccountCheckpoint({
  accountId,
  checkpointMonth,
  statementStartDate,
  statementEndDate,
  statementBalanceMinor,
  note
}) {
  return postJson(
    "/api/accounts/reconcile",
    {
      accountId,
      checkpointMonth,
      statementStartDate: statementStartDate || null,
      statementEndDate: statementEndDate || null,
      statementBalanceMinor,
      note
    },
    "Checkpoint save failed."
  );
}

export function deleteAccountCheckpoint({ accountId, checkpointMonth }) {
  return postJson(
    "/api/accounts/checkpoints/delete",
    { accountId, checkpointMonth },
    "Checkpoint delete failed."
  );
}

export function compareAccountCheckpointStatement({
  accountId,
  checkpointMonth,
  uploadedStatementStartDate,
  uploadedStatementEndDate,
  rows
}) {
  return postJson(
    "/api/accounts/checkpoints/compare-statement",
    {
      accountId,
      checkpointMonth,
      uploadedStatementStartDate,
      uploadedStatementEndDate,
      rows
    },
    "Statement compare failed."
  );
}

export async function fetchCheckpointExport({ accountId, checkpointMonth }) {
  const response = await fetch(buildCheckpointExportHref(accountId, checkpointMonth), {
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(await buildRequestErrorMessage(response, "Checkpoint export failed."));
  }

  return {
    blob: await response.blob(),
    filename: getContentDispositionFilename(response.headers.get("Content-Disposition"))
      ?? `checkpoint-${accountId}-${checkpointMonth}.csv`
  };
}
