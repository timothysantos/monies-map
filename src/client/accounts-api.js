import { moniesClient } from "./monies-client-service";
import { buildRequestErrorMessage } from "./request-errors";

const { format: formatService } = moniesClient;

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

// Account mutation and reconciliation endpoints are shared by settings and
// imports, so keep them out of the broader settings API surface.
export async function saveAccount({
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

export function archiveAccount(accountId) {
  return postJson(
    "/api/accounts/archive",
    { accountId },
    "Account archive failed."
  );
}

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
  const response = await fetch(formatService.buildCheckpointExportHref(accountId, checkpointMonth), {
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(await buildRequestErrorMessage(response, "Checkpoint export failed."));
  }

  return {
    blob: await response.blob(),
    filename: formatService.getContentDispositionFilename(response.headers.get("Content-Disposition"))
      ?? `checkpoint-${accountId}-${checkpointMonth}.csv`
  };
}
