// Statement reconciliation API contracts, part 1: statement matching,
// certification of provisional rows and near-match rules, through the real
// Worker and a real local D1. Moved from tests/e2e/import-ledger-flow.spec.js,
// where they never touched the page (see docs/audits/e2e-unit-audit.md); the
// requests and assertions are unchanged. The browser statement workflow
// stays in that spec.
import test from "node:test";
import { expect } from "@playwright/test";

import { postJson, useSeededWorkerRequest } from "./support/worker-request.mjs";

const openRequest = useSeededWorkerRequest();

async function loadReferenceData(request) {
  const response = await request.get("/api/reference-data");
  if (!response.ok()) {
    throw new Error(`Reference data failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function loadSettingsPage(request) {
  const response = await request.get("/api/settings-page");
  if (!response.ok()) {
    throw new Error(`Settings page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

test("statement mismatch preview explains period ledger rows and skipped statement rows", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright Reconciliation Diagnostics ${Date.now()}`;
  const createPayload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const accountId = createPayload.accountId;
  expect(accountId).toBeTruthy();

  await postJson(request, "/api/entries/create", {
    date: "2026-04-15",
    description: "EXTRA MIDCYCLE ROW",
    amountMinor: 500,
    entryType: "expense",
    accountId,
    accountName,
    categoryName: "Other",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  for (let index = 1; index <= 9; index += 1) {
    await postJson(request, "/api/entries/create", {
      date: "2026-04-15",
      description: `EXTRA MIDCYCLE ROW ${index}`,
      amountMinor: 1,
      entryType: "expense",
      accountId,
      accountName,
      categoryName: "Other",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }

  const preview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Diagnostics PDF preview",
    sourceType: "pdf",
    rows: [{
      date: "2026-04-16",
      description: "PDF STATEMENT ROW",
      expense: "10.00",
      accountId,
      account: accountName,
      category: "Other",
      note: "txn date: 2026-04-14"
    }],
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: [{
      accountId,
      accountName,
      detectedAccountName: accountName,
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-13",
      statementEndDate: "2026-05-12",
      statementBalanceMinor: 1000,
      note: "Diagnostics checkpoint"
    }]
  });

  const reconciliation = preview.preview.statementReconciliations[0];
  expect(reconciliation.status).toBe("mismatch");
  expect(reconciliation.deltaMinor).toBe(-509);
  expect(reconciliation.reconciliationBreakdown).toMatchObject({
    priorLedgerBalanceMinor: 0,
    statementPeriodExistingRowsMinor: -509,
    includedStatementRowsMinor: -1000,
    projectedLedgerBalanceMinor: -1509,
    statementBalanceMinor: -1000,
    deltaMinor: -509,
    periodExistingLedgerRowCount: 10
  });
  expect(reconciliation.reconciliationBreakdown.periodExistingLedgerRows).toHaveLength(10);
  expect(reconciliation.reconciliationBreakdown.periodExistingLedgerRows[0]).toMatchObject({
    accountId,
    dateRole: "transaction",
    description: "EXTRA MIDCYCLE ROW",
    signedAmountMinor: -500,
    source: "ledger"
  });
  expect(reconciliation.reconciliationBreakdown.suspectedCauses.join(" ")).toContain("Existing ledger rows inside this statement period");

  const explanation = await postJson(request, "/api/ai-assist/import-explanation", {
    preview: preview.preview
  });
  expect(explanation.available).toBe(false);
  expect(explanation.explanations).toHaveLength(1);
  expect(explanation.explanations[0]).toMatchObject({
    accountName,
    source: "deterministic"
  });
  expect(explanation.explanations[0].message).toContain(accountName);
});

test("UOB PDF foreign-currency descriptions certify matching provisional card rows", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright UOB FX Match ${Date.now()}`;
  const createPayload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const accountId = createPayload.accountId;
  expect(accountId).toBeTruthy();

  const existing = await postJson(request, "/api/entries/create", {
    date: "2026-04-16",
    description: "OPENAI OPENAI.COM US",
    amountMinor: 734,
    entryType: "expense",
    accountId,
    accountName,
    categoryName: "Other",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  expect(existing.entryId).toBeTruthy();

  const preview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "UOB FX description preview",
    sourceType: "pdf",
    rows: [{
      date: "2026-04-16",
      description: "OPENAI OPENAI.COM USD 5.58",
      expense: "7.34",
      accountId,
      account: accountName,
      category: "Other",
      note: "txn date: 2026-04-16"
    }],
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: [{
      accountId,
      accountName,
      detectedAccountName: accountName,
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-13",
      statementEndDate: "2026-05-12",
      statementBalanceMinor: 734,
      note: "UOB FX description checkpoint"
    }]
  });

  const previewRow = preview.preview.previewRows[0];
  expect(previewRow.reconciliationTargetTransactionId).toBe(existing.entryId);
  expect(previewRow.commitStatus).toBe("included");
  const reconciliation = preview.preview.statementReconciliations[0];
  expect(reconciliation.status).toBe("matched");
  expect(reconciliation.reconciliationBreakdown.periodExistingLedgerRows).toHaveLength(0);
  expect(reconciliation.reconciliationBreakdown.matchedStatementRows).toHaveLength(1);
});

test("repeated UOB PDF card rows certify more than three matching provisional rows", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright UOB Repeated Rows ${Date.now()}`;
  const createPayload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const accountId = createPayload.accountId;
  expect(accountId).toBeTruthy();

  const existingEntryIds = [];
  for (let index = 0; index < 4; index += 1) {
    const existing = await postJson(request, "/api/entries/create", {
      date: "2026-04-16",
      description: "OPENAI OPENAI.COM US",
      amountMinor: 722,
      entryType: "expense",
      accountId,
      accountName,
      categoryName: "Other",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    expect(existing.entryId).toBeTruthy();
    existingEntryIds.push(existing.entryId);
  }

  const preview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "UOB repeated OpenAI rows preview",
    sourceType: "pdf",
    rows: Array.from({ length: 4 }, (_, index) => ({
      date: "2026-04-16",
      description: `OPENAI OPENAI.COM USD 5.49 Ref ${index + 1}`,
      expense: "7.22",
      accountId,
      account: accountName,
      category: "Other",
      note: "txn date: 2026-04-16"
    })),
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: [{
      accountId,
      accountName,
      detectedAccountName: accountName,
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-13",
      statementEndDate: "2026-05-12",
      statementBalanceMinor: 2888,
      note: "UOB repeated row checkpoint"
    }]
  });

  const targetIds = preview.preview.previewRows.map((row) => row.reconciliationTargetTransactionId);
  expect(targetIds).toHaveLength(4);
  expect(new Set(targetIds)).toEqual(new Set(existingEntryIds));
  expect(preview.preview.previewRows.every((row) => row.commitStatus === "included")).toBe(true);

  const reconciliation = preview.preview.statementReconciliations[0];
  expect(reconciliation.status).toBe("matched");
  expect(reconciliation.reconciliationBreakdown.periodExistingLedgerRows).toHaveLength(0);
  expect(reconciliation.reconciliationBreakdown.matchedStatementRows).toHaveLength(4);
});

test("statement preview can certify midcycle rows and still save the checkpoint", async (t) => {
  const request = await openRequest(t);
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  const importedRow = {
    rowId: "midcycle-row-1",
    rowIndex: 1,
    date: "2025-10-14",
    description: "Playwright midcycle duplicate",
    amountMinor: 1111,
    entryType: "expense",
    accountId: account.id,
    accountName: account.name,
    categoryName: "Food & Drinks",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-10-14",
      description: "Playwright midcycle duplicate",
      expense: "11.11",
      accountId: account.id,
      account: account.name,
      category: "Food & Drinks"
    }
  };

  const midcycleCommit = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright midcycle XLS",
        sourceType: "csv",
        parserKey: "uob_current_xls",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: importedRow });
  expect(midcycleCommit.ok, midcycleCommit.text).toBeTruthy();

  const statementCheckpoints = [{
    accountId: account.id,
    accountName: account.name,
    detectedAccountName: account.name,
    checkpointMonth: "2025-10",
    statementStartDate: "2025-10-01",
    statementEndDate: "2025-10-31",
    statementBalanceMinor: 0,
    note: "Playwright statement checkpoint"
  }];

  const previewWithMismatchedCheckpoint = await request.evaluate(async ({ row, statementCheckpoints }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright monthly PDF",
        sourceType: "pdf",
        rows: [row.rawRow],
        defaultAccountName: row.accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { row: importedRow, statementCheckpoints });

  expect(previewWithMismatchedCheckpoint.ok, JSON.stringify(previewWithMismatchedCheckpoint.json)).toBeTruthy();
  const projectedBalanceMinor = previewWithMismatchedCheckpoint.json.preview.statementReconciliations[0].projectedLedgerBalanceMinor;
  expect(Number.isFinite(projectedBalanceMinor)).toBeTruthy();
  const matchingStatementCheckpoints = [{
    ...statementCheckpoints[0],
    statementBalanceMinor: account.kind === "credit_card" ? -projectedBalanceMinor : projectedBalanceMinor
  }];

  const preview = await request.evaluate(async ({ row, statementCheckpoints }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright monthly PDF",
        sourceType: "pdf",
        rows: [row.rawRow],
        defaultAccountName: row.accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { row: importedRow, statementCheckpoints: matchingStatementCheckpoints });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.previewRows).toHaveLength(1);
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(preview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeTruthy();
  expect(preview.json.preview.previewRows[0].isStatementMatchResolved).toBe(true);
  expect(preview.json.preview.previewRows[0].duplicateMatches).toBeUndefined();
  expect(
    preview.json.preview.statementReconciliations[0].status,
    JSON.stringify(preview.json.preview.statementReconciliations[0])
  ).toBe("matched");

  const ambiguousStatementCheckpoints = matchingStatementCheckpoints.map(({ accountId: _accountId, ...checkpoint }) => checkpoint);
  const ambiguousCheckpointOnlyCommit = await request.evaluate(async ({ statementCheckpoints, statementControlRows, statementReconciliations }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright monthly PDF ambiguous checkpoint",
        sourceType: "pdf",
        parserKey: "uob_credit_card_pdf",
        rows: [],
        statementCheckpoints,
        statementControlRows,
        statementReconciliations
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, {
    statementCheckpoints: ambiguousStatementCheckpoints,
    statementControlRows: preview.json.preview.previewRows,
    statementReconciliations: preview.json.preview.statementReconciliations
  });
  expect(ambiguousCheckpointOnlyCommit.ok, ambiguousCheckpointOnlyCommit.text).toBeTruthy();

  const checkpointOnlyCommit = await request.evaluate(async ({ statementCheckpoints }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright monthly PDF checkpoint",
        sourceType: "pdf",
        parserKey: "uob_credit_card_pdf",
        rows: [],
        statementCheckpoints
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { statementCheckpoints: matchingStatementCheckpoints });
  expect(checkpointOnlyCommit.ok, checkpointOnlyCommit.text).toBeTruthy();

  const afterSettingsPage = await loadSettingsPage(request);
  const afterAccount = afterSettingsPage.settingsPage.accounts.find((item) => item.id === account.id);
  expect(afterAccount?.latestCheckpointMonth).toBe("2025-10");
  expect(Number.isFinite(afterAccount?.latestCheckpointDeltaMinor)).toBeTruthy();
});

test("statement preview certifies repeated same-merchant rows against unique ledger targets", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright Repeated Statement ${Date.now()}`;
  const createPayload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const accountId = createPayload.accountId;
  expect(accountId).toBeTruthy();

  for (const description of ["OPENAI OPENAI.COM US first", "OPENAI OPENAI.COM US second"]) {
    await postJson(request, "/api/entries/create", {
      date: "2026-04-16",
      description,
      amountMinor: 729,
      entryType: "expense",
      accountId,
      accountName,
      categoryName: "Other",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }

  const preview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Repeated OpenAI PDF",
    sourceType: "pdf",
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    rows: [
      {
        date: "2026-04-16",
        description: "OPENAI OPENAI.COM",
        expense: "7.29",
        accountId,
        account: accountName,
        category: "Other",
        note: "txn date: 2026-04-16"
      },
      {
        date: "2026-04-16",
        description: "OPENAI OPENAI.COM",
        expense: "7.29",
        accountId,
        account: accountName,
        category: "Other",
        note: "txn date: 2026-04-16"
      }
    ],
    statementCheckpoints: [{
      accountId,
      accountName,
      detectedAccountName: accountName,
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-13",
      statementEndDate: "2026-05-12",
      statementBalanceMinor: 1458,
      note: "Repeated OpenAI certification checkpoint"
    }]
  });

  const targets = preview.preview.previewRows.map((row) => row.reconciliationTargetTransactionId);
  expect(targets.every(Boolean), JSON.stringify(preview.preview.previewRows)).toBeTruthy();
  expect(new Set(targets).size).toBe(2);
  expect(preview.preview.statementReconciliations[0].status).toBe("matched");
  expect(preview.preview.statementReconciliations[0].reconciliationBreakdown.periodExistingLedgerRows).toHaveLength(0);
});

test("statement balance can certify a near-match provisional row when amount clears the velocity rule", async (t) => {
  const request = await openRequest(t);
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  const existingRow = {
    rowId: "near-match-existing",
    rowIndex: 1,
    date: "2025-08-11",
    description: "BUS MRT 123",
    amountMinor: 648,
    entryType: "expense",
    accountId: account.id,
    accountName: account.name,
    categoryName: "Public Transport",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-08-11",
      description: "BUS MRT 123",
      expense: "6.48",
      accountId: account.id,
      account: account.name,
      category: "Public Transport"
    }
  };

  const existingCommit = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright existing transit",
        sourceType: "csv",
        parserKey: "uob_current_xls",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: existingRow });
  expect(existingCommit.ok, existingCommit.text).toBeTruthy();

  const statementRow = {
    date: "2025-08-14",
    description: "BUS MRT 687",
    expense: "6.48",
    accountId: account.id,
    account: account.name,
    category: "Public Transport"
  };
  const statementCheckpoints = [{
    accountId: account.id,
    accountName: account.name,
    detectedAccountName: account.name,
    checkpointMonth: "2025-08",
    statementStartDate: "2025-08-01",
    statementEndDate: "2025-08-31",
    statementBalanceMinor: 0,
    note: "Playwright near-match statement checkpoint"
  }];

  const mismatchedPreview = await request.evaluate(async ({ row, statementCheckpoints }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright near-match PDF",
        sourceType: "pdf",
        rows: [row],
        defaultAccountName: row.account,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { row: statementRow, statementCheckpoints });
  expect(mismatchedPreview.ok, JSON.stringify(mismatchedPreview.json)).toBeTruthy();
  expect(mismatchedPreview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(mismatchedPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeTruthy();
  expect(mismatchedPreview.json.preview.previewRows[0].reconciliationMatch).toBeTruthy();
  expect(mismatchedPreview.json.preview.previewRows[0].duplicateMatches).toBeUndefined();

  const projectedWithCertifiedNearMatch = mismatchedPreview.json.preview.statementReconciliations[0].projectedLedgerBalanceMinor;
  const resolvingStatementCheckpoints = [{
    ...statementCheckpoints[0],
    statementBalanceMinor: account.kind === "credit_card" ? -projectedWithCertifiedNearMatch : projectedWithCertifiedNearMatch
  }];

  const resolvedPreview = await request.evaluate(async ({ row, statementCheckpoints }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright near-match PDF",
        sourceType: "pdf",
        rows: [row],
        defaultAccountName: row.account,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { row: statementRow, statementCheckpoints: resolvingStatementCheckpoints });

  expect(resolvedPreview.ok, JSON.stringify(resolvedPreview.json)).toBeTruthy();
  expect(resolvedPreview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(resolvedPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeTruthy();
  expect(resolvedPreview.json.preview.previewRows[0].reconciliationMatch).toBeTruthy();
  expect(resolvedPreview.json.preview.previewRows[0].duplicateMatches).toBeUndefined();
  expect(resolvedPreview.json.preview.reconciliationCandidateCount).toBe(0);
  expect(resolvedPreview.json.preview.statementReconciliations[0].status).toBe("matched");
});

// Commits $2.48 fares from a bank export, then previews a statement's $2.48
// fare on 14 Aug and returns the transaction it would be matched to.
async function previewFareAgainstCommittedFares(request, fareDates) {
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  const existingRows = fareDates.map((date, index) => ({
    rowId: `velocity-lane-existing-${index + 1}`,
    rowIndex: index + 1,
    date,
    description: `BUS MRT ${123 + index}`,
    amountMinor: 248,
    entryType: "expense",
    accountId: account.id,
    accountName: account.name,
    categoryName: "Public Transport",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date,
      description: `BUS MRT ${123 + index}`,
      expense: "2.48",
      accountId: account.id,
      account: account.name,
      category: "Public Transport"
    }
  }));

  const existingCommit = await request.evaluate(async ({ rows }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright velocity existing transit",
        sourceType: "csv",
        parserKey: "uob_current_xls",
        rows,
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { rows: existingRows });
  expect(existingCommit.ok, existingCommit.text).toBeTruthy();

  const preview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright velocity PDF",
        sourceType: "pdf",
        rows: [{
          date: "2025-08-14",
          description: "BUS MRT 687",
          expense: "2.48",
          accountId,
          account: accountName,
          category: "Public Transport"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  return preview.json.preview;
}

test("repeated fares more than two days apart stay out of the reconciliation lane", async (t) => {
  const request = await openRequest(t);
  // A commute: the same fare on 7 and 11 Aug. The statement's 14 Aug fare is
  // a third trip, not the 11 Aug one three days later.
  const preview = await previewFareAgainstCommittedFares(request, ["2025-08-07", "2025-08-11"]);

  expect(preview.previewRows[0].reconciliationTargetTransactionId).toBeFalsy();
  expect(preview.reconciliationCandidateCount).toBe(0);
});

test("a one-off fare three days from the statement's is matched as the same trip", async (t) => {
  const request = await openRequest(t);
  // One fare at that price in the export: the statement row posted three
  // days later is most likely the same trip.
  const preview = await previewFareAgainstCommittedFares(request, ["2025-08-11"]);

  expect(preview.previewRows[0].reconciliationTargetTransactionId).toBeTruthy();
});

test("midcycle Citi activity skips an already certified statement row with a different activity date", async (t) => {
  const request = await openRequest(t);
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "Citi Rewards");
  expect(account).toBeTruthy();

  const statementRow = {
    rowId: "citi-certified-money-send",
    rowIndex: 1,
    date: "2026-04-04",
    description: "MONEYSEND SANTOS TIMOTHY",
    amountMinor: 17350,
    entryType: "income",
    accountId: account.id,
    accountName: account.name,
    categoryName: "Other",
    ownershipType: "direct",
    ownerName: account.ownerLabel,
    splitBasisPoints: 10000,
    rawRow: {
      date: "2026-04-04",
      description: "MONEYSEND SANTOS TIMOTHY",
      income: "173.50",
      accountId: account.id,
      account: account.name,
      category: "Other",
      type: "income"
    }
  };

  const statementCommit = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Playwright Citi card April PDF",
        sourceType: "pdf",
        parserKey: "citibank_credit_card_pdf",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: statementRow });
  expect(statementCommit.ok, statementCommit.text).toBeTruthy();

  const preview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Playwright Citi card activity CSV",
    sourceType: "csv",
    rows: [{
      date: "2026-04-02",
      description: "MONEYSEND SANTOS TIMOTHY",
      income: "173.50",
      accountId: account.id,
      account: account.name,
      category: "Other",
      type: "income",
      note: "card ending: 6360"
    }],
    defaultAccountName: account.name,
    ownershipType: "direct",
    ownerName: account.ownerLabel
  });

  const [row] = preview.preview.previewRows;
  expect(row.commitStatus).toBe("skipped");
  expect(row.reconciliationMatch?.matchKind).toBe("exact");
  expect(row.reconciliationMatch?.existingBankCertificationStatus).toBe("statement_certified");
  expect(row.commitStatusReason).toBe("Official statement row is already certified in the ledger.");
});

test("certified PDF hash does not suppress a later statement row when the bank-cleared dates differ", async (t) => {
  const request = await openRequest(t);
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  const manualEntry = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/entries/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2025-04-01",
        description: "HelloRide SINGAPORE",
        accountId,
        accountName,
        categoryName: "Other - Income",
        amountMinor: 2990,
        entryType: "income",
        ownershipType: "direct",
        ownerName: "Tim"
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(manualEntry.ok, JSON.stringify(manualEntry.json)).toBeTruthy();

  const certifyCommit = await request.evaluate(async ({ accountId, accountName, entryId }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Earlier official PDF commit",
        sourceType: "pdf",
        parserKey: "uob_credit_card_pdf",
        statementCheckpoints: [],
        rows: [{
          rowId: "preview-1",
          rowIndex: 1,
          date: "2025-04-02",
          description: "HelloRide SINGAPORE",
          amountMinor: 2990,
          entryType: "income",
          accountId,
          accountName,
          categoryName: "Other - Income",
          ownershipType: "direct",
          ownerName: "Tim",
          splitBasisPoints: 10000,
          rawRow: {
            date: "2025-04-02",
            description: "HelloRide SINGAPORE",
            expense: "",
            income: "29.90",
            accountId,
            account: accountName,
            category: "Other - Income",
            type: "income"
          },
          reconciliationTargetTransactionId: entryId
        }]
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { accountId: account.id, accountName: account.name, entryId: manualEntry.json.entryId });
  expect(certifyCommit.ok, certifyCommit.text).toBeTruthy();

  const laterPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Later official PDF",
        sourceType: "pdf",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [],
        rows: [{
          date: "2025-05-19",
          description: "HelloRide SINGAPORE",
          expense: "",
          income: "29.90",
          accountId,
          account: accountName,
          category: "Other - Income",
          type: "income"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });

  expect(laterPreview.ok, JSON.stringify(laterPreview.json)).toBeTruthy();
  expect(laterPreview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(laterPreview.json.preview.previewRows[0].reconciliationMatch).toBeFalsy();
  expect(laterPreview.json.preview.previewRows[0].reconciliationMatches ?? []).toHaveLength(0);
});
