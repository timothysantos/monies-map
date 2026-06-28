const DIAGNOSTICS_PATH = "/settings?settings_section=errorDiagnostics";
const RESPONSE_BODY_LIMIT = 20000;
const RESPONSE_EXCERPT_LIMIT = 800;

class ImportRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ImportRequestError";
    this.diagnosticHref = options.diagnosticHref;
    this.diagnosticId = options.diagnosticId;
  }
}

async function postJson(endpoint, body, fallbackError, diagnosticContext = {}) {
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
    const classified = getResponseErrorMessage({
      data,
      fallbackError,
      response,
      responseText
    });
    if (!classified.shouldRecordDiagnostic) {
      throw new Error(classified.message);
    }
    const diagnosticId = await recordImportDiagnostic({
      endpoint,
      method: "POST",
      response,
      responseText,
      message: classified.message,
      possibleReason: classified.possibleReason,
      diagnosticContext
    });
    throw new ImportRequestError(classified.message, {
      diagnosticHref: DIAGNOSTICS_PATH,
      diagnosticId
    });
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
    return { message: data.error ?? data.message, possibleReason: "", shouldRecordDiagnostic: false };
  }

  const statusLine = response.status
    ? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`
    : "";
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html") || /^<!doctype html|<html[\s>]/i.test(responseText.trim());
  if (isHtml && response.status === 503 && responseText.includes("Worker exceeded resource limits")) {
    return {
      message: `${fallbackError} ${statusLine}: Cloudflare ended the request because the Worker exceeded resource limits. Open Settings -> Error diagnostics for the saved response and action context.`,
      possibleReason: "Cloudflare returned a Worker resource-limit page before the app could return JSON. Common causes include a large import preview, repeated heavy previews close together, CPU pressure, memory pressure, or a matching path that needs to be made cheaper.",
      shouldRecordDiagnostic: true
    };
  }

  if (isHtml) {
    return {
      message: `${fallbackError} ${statusLine}: The server returned an HTML error page instead of app JSON. Open Settings -> Error diagnostics for the saved response and action context.`,
      possibleReason: "The app expected JSON, but the edge returned an HTML error page. This usually points to an infrastructure, routing, or Worker runtime failure before application error handling completed.",
      shouldRecordDiagnostic: true
    };
  }

  const bodySnippet = normalizeResponseText(responseText).slice(0, 220);
  const detail = [statusLine, bodySnippet].filter(Boolean).join(": ");
  return {
    message: detail ? `${fallbackError} ${detail}` : fallbackError,
    possibleReason: "",
    shouldRecordDiagnostic: response.status >= 500
  };
}

function normalizeResponseText(responseText) {
  return responseText
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function recordImportDiagnostic({
  endpoint,
  method,
  response,
  responseText,
  message,
  possibleReason,
  diagnosticContext
}) {
  try {
    const diagnosticResponse = await fetch("/api/error-diagnostics/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: diagnosticContext.source ?? "import_preview",
        action: diagnosticContext.action ?? "Preview import",
        previousAction: diagnosticContext.previousAction ?? "",
        method,
        route: endpoint,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type") ?? "",
        errorMessage: message,
        possibleReason,
        requestContextJson: JSON.stringify(diagnosticContext.requestContext ?? {}),
        responseExcerpt: normalizeResponseText(responseText).slice(0, RESPONSE_EXCERPT_LIMIT),
        responseBody: responseText.slice(0, RESPONSE_BODY_LIMIT)
      })
    });
    const data = await diagnosticResponse.json().catch(() => ({}));
    return data?.diagnosticId;
  } catch {
    return undefined;
  }
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
  statementCheckpoints,
  diagnosticContext
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
    "Import preview failed.",
    diagnosticContext
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
