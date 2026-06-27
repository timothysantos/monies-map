async function postJson(endpoint, body, fallbackError) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const responseText = await response.text().catch(() => "");
  const data = responseText ? parseJsonResponse(responseText) : {};
  if (!response.ok) {
    throw new Error(getResponseErrorMessage({
      data,
      fallbackError,
      response,
      responseText
    }));
  }
  return data;
}

function parseJsonResponse(responseText) {
  try {
    return JSON.parse(responseText);
  } catch {
    return {};
  }
}

function getResponseErrorMessage({ data, fallbackError, response, responseText }) {
  if (data?.error || data?.message) {
    return data.error ?? data.message;
  }

  const statusLine = response.status
    ? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`
    : "";
  const bodySnippet = responseText
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  const detail = [statusLine, bodySnippet].filter(Boolean).join(": ");
  return detail ? `${fallbackError} ${detail}` : fallbackError;
}

// Keep import endpoint payloads out of ImportsPanel so the panel can focus on flow state.
export function previewImportBatch({
  sourceLabel,
  sourceType,
  rows,
  defaultAccountName,
  ownershipType,
  ownerName,
  splitPercent,
  statementCheckpoints
}) {
  return postJson(
    "/api/imports/preview",
    {
      sourceLabel,
      sourceType,
      rows,
      defaultAccountName,
      ownershipType,
      ownerName,
      splitBasisPoints: Math.round(Number(splitPercent || "50") * 100),
      statementCheckpoints: normalizeStatementCheckpoints(statementCheckpoints)
    },
    "Import preview failed."
  );
}

export function commitImportBatch({
  sourceLabel,
  sourceType,
  parserKey,
  note,
  statementCheckpoints,
  statementControlRows,
  statementReconciliations,
  rows
}) {
  return postJson(
    "/api/imports/commit",
    {
      sourceLabel,
      sourceType,
      parserKey,
      note,
      statementCheckpoints: normalizeStatementCheckpoints(statementCheckpoints),
      statementControlRows: statementControlRows?.map((row) => ({
        ...row,
        splitBasisPoints: Number(row.splitBasisPoints ?? 10000)
      })),
      statementReconciliations,
      rows: rows.map((row) => ({
        ...row,
        splitBasisPoints: Number(row.splitBasisPoints ?? 10000)
      }))
    },
    "Import commit failed."
  );
}

export function rollbackImportBatch(importId) {
  return postJson(
    "/api/imports/rollback",
    { importId },
    "Import rollback failed."
  );
}

function normalizeStatementCheckpoints(statementCheckpoints) {
  return statementCheckpoints.map((checkpoint) => ({
    ...checkpoint,
    statementBalanceMinor: Number(checkpoint.statementBalanceMinor ?? 0),
    previousBalanceMinor: checkpoint.previousBalanceMinor == null
      ? undefined
      : Number(checkpoint.previousBalanceMinor)
  }));
}
