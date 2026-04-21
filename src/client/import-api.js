async function postJson(endpoint, body, fallbackError) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? fallbackError);
  }
  return data;
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
    statementBalanceMinor: Number(checkpoint.statementBalanceMinor ?? 0)
  }));
}
