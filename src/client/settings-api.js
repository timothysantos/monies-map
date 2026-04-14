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
