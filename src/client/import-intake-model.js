export function buildIntakeFingerprint({ parsed, sourceType, csvText = "" }) {
  if (parsed?.rows?.length) {
    return JSON.stringify({
      sourceType,
      parserKey: parsed.parserKey,
      checkpoints: (parsed.checkpoints ?? []).map((checkpoint) => ({
        accountName: checkpoint.accountName ?? checkpoint.detectedAccountName ?? "",
        month: checkpoint.checkpointMonth ?? "",
        balance: Number(checkpoint.statementBalanceMinor ?? 0)
      })),
      rows: parsed.rows.map((row) => ({
        date: row.date ?? "",
        description: normalizeDescription(row.description ?? ""),
        amount: Number(row.amountMinor ?? row.amount ?? 0),
        accountName: row.accountName ?? row.statementAccountName ?? ""
      }))
    });
  }

  return JSON.stringify({
    sourceType,
    csvText: csvText.trim().replace(/\s+/g, " ").slice(0, 12000)
  });
}

export function buildIntakeMatch({ parsed, sourceType, inbox }) {
  const expectedFiles = inbox?.reviewQueue ?? [];
  if (!expectedFiles.length || !parsed) {
    return { status: "unknown", expectedFileIds: [] };
  }

  const sourceKind = sourceType === "pdf" ? "pdf_statement" : "activity_export";
  const parsedEvidence = getParsedEvidence(parsed);
  const matches = expectedFiles.filter((file) => {
    if (file.sourceType !== sourceKind) {
      return false;
    }

    const accountMatches = parsedEvidence.accountNames.some((accountName) => (
      namesLookRelated(accountName, file.accountName)
    ));
    const monthMatches = !parsedEvidence.months.length || parsedEvidence.months.includes(file.periodMonth);
    return accountMatches && monthMatches;
  });

  if (matches.length === 1) {
    return { status: "matched", expectedFileIds: [matches[0].id] };
  }

  if (matches.length > 1) {
    return { status: "ambiguous", expectedFileIds: matches.map((file) => file.id) };
  }

  return { status: "unexpected", expectedFileIds: [] };
}

export function buildIntakeQueueItem({
  id,
  fileName,
  parsed,
  sourceType,
  csvText = "",
  inbox,
  existingFingerprints = new Set()
}) {
  const fingerprint = buildIntakeFingerprint({ parsed, sourceType, csvText });
  const match = buildIntakeMatch({ parsed, sourceType, inbox });
  return {
    id,
    fileName,
    sourceLabel: parsed?.sourceLabel ?? fileName,
    parserKey: parsed?.parserKey ?? "generic_csv",
    sourceType,
    rowCount: parsed?.rows?.length ?? countCsvRows(csvText),
    checkpointCount: parsed?.checkpoints?.length ?? 0,
    fingerprint,
    duplicate: existingFingerprints.has(fingerprint),
    matchStatus: match.status,
    expectedFileIds: match.expectedFileIds,
    parsed,
    csvText
  };
}

export function summarizeIntakeQueue(items) {
  return {
    total: items.length,
    ready: items.filter((item) => item.matchStatus === "matched" && !item.duplicate).length,
    ambiguous: items.filter((item) => item.matchStatus === "ambiguous").length,
    unexpected: items.filter((item) => item.matchStatus === "unexpected" || item.matchStatus === "unknown").length,
    duplicate: items.filter((item) => item.duplicate).length
  };
}

function getParsedEvidence(parsed) {
  const accountNames = new Set();
  const months = new Set();

  for (const checkpoint of parsed.checkpoints ?? []) {
    if (checkpoint.accountName) {
      accountNames.add(checkpoint.accountName);
    }
    if (checkpoint.detectedAccountName) {
      accountNames.add(checkpoint.detectedAccountName);
    }
    if (checkpoint.checkpointMonth) {
      months.add(checkpoint.checkpointMonth);
    }
  }

  for (const row of parsed.rows ?? []) {
    if (row.accountName) {
      accountNames.add(row.accountName);
    }
    if (row.statementAccountName) {
      accountNames.add(row.statementAccountName);
    }
    if (row.date) {
      months.add(row.date.slice(0, 7));
    }
  }

  return {
    accountNames: Array.from(accountNames),
    months: Array.from(months)
  };
}

function normalizeDescription(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesLookRelated(left, right) {
  const normalizedLeft = normalizeName(left);
  const normalizedRight = normalizeName(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function countCsvRows(csvText) {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return 0;
  }

  return Math.max(0, trimmed.split(/\r?\n/).length - 1);
}
