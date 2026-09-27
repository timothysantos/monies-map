// Import preview, commit and rollback API contracts through the real Worker
// and a real local D1. Moved from tests/e2e/import-ledger-flow.spec.js, where
// they never touched the page (see docs/audits/e2e-unit-audit.md); the
// requests and assertions are unchanged. The browser import workflow stays
// in that spec.
import test from "node:test";
import { expect } from "@playwright/test";

import { postJson, useSeededWorkerRequest } from "./support/worker-request.mjs";

const openRequest = useSeededWorkerRequest();

function findSummaryMonth(view, month) {
  const item = view.summaryPage.months.find((row) => row.month === month);
  if (!item) {
    throw new Error(`Summary month not found: ${month}`);
  }
  return item;
}

async function loadEntriesPage(request, { view = "person-tim", month = "2025-10" } = {}) {
  const response = await request.get(`/api/entries-page?view=${view}&month=${month}`);
  if (!response.ok()) {
    throw new Error(`Entries page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

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

async function loadSummaryPage(request, { view = "person-tim", month = "2025-10", scope = "direct_plus_shared", summaryStart, summaryEnd } = {}) {
  const params = new URLSearchParams({ view, month, scope });
  if (summaryStart) {
    params.set("summary_start", summaryStart);
  }
  if (summaryEnd) {
    params.set("summary_end", summaryEnd);
  }
  const response = await request.get(`/api/summary-page?${params.toString()}`);
  if (!response.ok()) {
    throw new Error(`Summary page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

function money(valueMinor) {
  return (valueMinor / 100).toFixed(2);
}

function buildSyntheticPdfImportRow({
  rowId,
  date,
  description,
  amountMinor,
  entryType,
  account
}) {
  const isIncome = entryType === "income";
  return {
    rowId,
    rowIndex: 1,
    date,
    description,
    amountMinor,
    entryType,
    accountId: account.id,
    accountName: account.name,
    categoryName: "Other",
    ownershipType: "direct",
    ownerName: account.ownerLabel,
    splitBasisPoints: 10000,
    rawRow: {
      date,
      description,
      expense: isIncome ? "" : money(amountMinor),
      income: isIncome ? money(amountMinor) : "",
      accountId: account.id,
      account: account.name,
      category: "Other",
      type: entryType
    }
  };
}

function buildSyntheticPdfPreviewRow({
  date,
  description,
  amountMinor,
  entryType,
  account
}) {
  const isIncome = entryType === "income";
  return {
    date,
    description,
    expense: isIncome ? "" : money(amountMinor),
    income: isIncome ? money(amountMinor) : "",
    accountId: account.id,
    account: account.name,
    category: "Other",
    type: entryType
  };
}

function buildSyntheticStatementCheckpoint({ account, checkpointMonth, statementBalanceMinor, statementStartDate, statementEndDate }) {
  return {
    accountId: account.id,
    accountName: account.name,
    detectedAccountName: account.name,
    checkpointMonth,
    statementStartDate,
    statementEndDate,
    statementBalanceMinor,
    note: "Playwright rollback coverage"
  };
}

test("preview flags unknown accounts from the CSV input", async (t) => {
  const request = await openRequest(t);
  const payload = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Playwright unknown account",
    sourceType: "csv",
    csv: [
      "date,description,amount,account,category,note",
      "2025-10-08,Playwright unknown account,-42.00,Imaginary Wallet,Food & Drinks,Should require account mapping."
    ].join("\n"),
    ownershipType: "direct",
    ownerName: "Tim"
  });
  expect(payload.preview.importedRows).toBe(1);
  expect(payload.preview.unknownAccounts).toContain("Imaginary Wallet");
  expect(payload.preview.previewRows[0].accountName).toBe("Imaginary Wallet");
});

test("expense and income headers auto-map without manual mapping", async (t) => {
  const request = await openRequest(t);
  const payload = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Auto map headers",
    sourceType: "csv",
    csv: [
      "date,description,expense,income,account,category,note,type",
      "2026-01-02,Funds Transfer JOYCE,450.00,,UOB One,Other,,expense",
      "2026-01-03,One Bonus Interest,,20.36,UOB One,Income,,income"
    ].join("\n"),
    ownershipType: "direct",
    ownerName: "Tim"
  });

  expect(payload.preview.previewRows).toHaveLength(2);
  expect(payload.preview.previewRows[0].entryType).toBe("expense");
  expect(payload.preview.previewRows[1].entryType).toBe("income");
  expect(payload.preview.previewRows[0].accountName).toBe("UOB One");
  expect(payload.preview.previewRows[1].accountName).toBe("UOB One");
});

test("committed import can be rolled back and disappears from entries and import history", async (t) => {
  const request = await openRequest(t);
  const description = `Playwright rollback import ${Date.now()}`;
  const month = "2025-10";
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  await loadEntriesPage(request, { view: "person-tim", month });
  const beforeSummary = await loadSummaryPage(request, { view: "person-tim", month });
  const beforeMonth = findSummaryMonth(beforeSummary, month);
  const beforeImportsPageResponse = await request.get("/api/imports-page");
  const beforeImportsPage = await beforeImportsPageResponse.json();

  const previewPayload = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Playwright rollback import",
    sourceType: "csv",
    csv: [
      "date,description,amount,account,category,note",
      `${month}-19,${description},-12.34,UOB One,Groceries,rollback coverage`
    ].join("\n"),
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const commitPayload = await postJson(request, "/api/imports/commit", {
    sourceLabel: "Playwright rollback import",
    sourceType: "csv",
    parserKey: "generic_csv",
    rows: previewPayload.preview.previewRows
  });
  expect(commitPayload.importId).toBeTruthy();

  const rollbackPayload = await postJson(request, "/api/imports/rollback", { importId: commitPayload.importId });
  expect(rollbackPayload.importId).toBe(commitPayload.importId);
  expect(rollbackPayload.rolledBack).toBe(true);

  const afterEntries = await loadEntriesPage(request, { view: "person-tim", month });
  const afterSummary = await loadSummaryPage(request, { view: "person-tim", month });
  const afterMonth = findSummaryMonth(afterSummary, month);
  const afterImportsPageResponse = await request.get("/api/imports-page");
  const afterImportsPage = await afterImportsPageResponse.json();

  expect(afterEntries.monthPage.entries.some((item) => item.description === description)).toBe(false);
  expect(afterMonth.realExpensesMinor).toBe(beforeMonth.realExpensesMinor);
  expect(afterImportsPage.importsPage.recentImports.some((item) => item.id === commitPayload.importId && item.status === "rolled_back")).toBe(true);
  expect(beforeImportsPage.importsPage.recentImports.some((item) => item.status === "rolled_back")).toBe(false);
});

test("February PDF preview matches cleanly after the January rollback", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright blank rollback card ${Date.now()}`;
  const createPayload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const account = {
    id: createPayload.accountId,
    name: accountName,
    kind: "credit_card",
    ownerLabel: "Tim"
  };
  expect(account.id).toBeTruthy();

  const januaryRow = buildSyntheticPdfImportRow({
    rowId: "jan-seed-row",
    date: "2025-01-10",
    description: "JAN SEED ROW",
    amountMinor: 12345,
    entryType: "expense",
    account
  });
  const januaryStatementCheckpoints = [buildSyntheticStatementCheckpoint({
    account,
    checkpointMonth: "2025-01",
    statementBalanceMinor: januaryRow.amountMinor,
    statementStartDate: "2025-01-01",
    statementEndDate: "2025-01-31"
  })];
  const januaryPreview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Playwright January PDF seed",
    sourceType: "pdf",
    rows: [buildSyntheticPdfPreviewRow({
      date: januaryRow.date,
      description: januaryRow.description,
      amountMinor: januaryRow.amountMinor,
      entryType: januaryRow.entryType,
      account
    })],
    defaultAccountName: account.name,
    ownershipType: "direct",
    ownerName: account.ownerLabel,
    statementCheckpoints: januaryStatementCheckpoints
  });
  expect(januaryPreview.preview.statementReconciliations[0].status).toBe("matched");

  const januaryCommit = await postJson(request, "/api/imports/commit", {
    sourceLabel: "Playwright January PDF seed",
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    rows: [januaryRow],
    statementCheckpoints: januaryStatementCheckpoints,
    statementControlRows: januaryPreview.preview.previewRows,
    statementReconciliations: januaryPreview.preview.statementReconciliations
  });
  expect(januaryCommit.importId).toBeTruthy();

  const januaryRollback = await postJson(request, "/api/imports/rollback", { importId: januaryCommit.importId });
  expect(januaryRollback.rolledBack).toBe(true);

  const februaryRow = buildSyntheticPdfImportRow({
    rowId: "feb-preview-row",
    date: "2025-02-07",
    description: "FEB CLEAN ROW",
    amountMinor: 54321,
    entryType: "expense",
    account
  });
  const februaryPreview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Playwright February PDF preview",
    sourceType: "pdf",
    rows: [buildSyntheticPdfPreviewRow({
      date: februaryRow.date,
      description: februaryRow.description,
      amountMinor: februaryRow.amountMinor,
      entryType: februaryRow.entryType,
      account
    })],
    defaultAccountName: account.name,
    ownershipType: "direct",
    ownerName: account.ownerLabel,
    statementCheckpoints: [buildSyntheticStatementCheckpoint({
      account,
      checkpointMonth: "2025-02",
      statementBalanceMinor: 54321,
      statementStartDate: "2025-02-01",
      statementEndDate: "2025-02-28"
    })]
  });

  expect(februaryPreview.preview.statementReconciliations[0].status).toBe("matched");
  expect(februaryPreview.preview.previewRows[0].commitStatus).toBe("included");
});

test("re-importing the same January PDF after rollback does not hit the import id uniqueness guard", async (t) => {
  const request = await openRequest(t);
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "Citi Rewards");
  expect(account).toBeTruthy();

  const januaryRow = buildSyntheticPdfImportRow({
    rowId: "jan-reimport-row",
    date: "2025-01-10",
    description: "JAN REIMPORT ROW",
    amountMinor: 12345,
    entryType: "expense",
    account
  });

  const firstCommit = await postJson(request, "/api/imports/commit", {
    sourceLabel: "Playwright January PDF reimport",
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    rows: [januaryRow],
    statementCheckpoints: []
  });
  expect(firstCommit.importId).toBeTruthy();

  const rollback = await postJson(request, "/api/imports/rollback", { importId: firstCommit.importId });
  expect(rollback.rolledBack).toBe(true);

  const secondCommit = await postJson(request, "/api/imports/commit", {
    sourceLabel: "Playwright January PDF reimport",
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    rows: [januaryRow],
    statementCheckpoints: []
  });
  expect(secondCommit.importId).toBeTruthy();
  expect(secondCommit.created).toBe(true);
});

test("rolling back a middle statement blocks later statements until the missing month is restored", async (t) => {
  const request = await openRequest(t);
  const settingsPage = await loadSettingsPage(request);
  const account = settingsPage.settingsPage.accounts.find((item) => item.openingBalanceMinor === 0 && !item.latestTransactionDate);
  expect(account).toBeTruthy();

  const novCheckpoint = await postJson(request, "/api/accounts/reconcile", {
    accountId: account.id,
    checkpointMonth: "2025-11",
    statementStartDate: "2025-11-01",
    statementEndDate: "2025-11-30",
    statementBalanceMinor: 0,
    note: "Playwright chain baseline"
  });
  expect(novCheckpoint.saved).toBe(true);

  const decCheckpoint = await postJson(request, "/api/accounts/reconcile", {
    accountId: account.id,
    checkpointMonth: "2025-12",
    statementStartDate: "2025-12-01",
    statementEndDate: "2025-12-31",
    statementBalanceMinor: 0,
    note: "Playwright chain baseline"
  });
  expect(decCheckpoint.saved).toBe(true);

  const januaryStatementCheckpoints = [{
    accountId: account.id,
    accountName: account.name,
    detectedAccountName: account.name,
    checkpointMonth: "2026-01",
    statementStartDate: "2026-01-01",
    statementEndDate: "2026-01-31",
    statementBalanceMinor: 0,
    note: "Playwright chained January statement"
  }];

  const janPreview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Playwright chained January statement",
    sourceType: "pdf",
    rows: [],
    ownershipType: "direct",
    ownerName: account.ownerLabel,
    statementCheckpoints: januaryStatementCheckpoints
  });
  expect(janPreview.preview.statementReconciliations[0].status).toBe("matched");

  const janCommit = await postJson(request, "/api/imports/commit", {
    sourceLabel: "Playwright chained January statement",
    sourceType: "pdf",
    parserKey: "synthetic_pdf",
    rows: [],
    statementCheckpoints: januaryStatementCheckpoints,
    statementControlRows: [],
    statementReconciliations: janPreview.preview.statementReconciliations
  });
  expect(janCommit.importId).toBeTruthy();

  const rolledBackJan = await postJson(request, "/api/imports/rollback", { importId: janCommit.importId });
  expect(rolledBackJan.rolledBack).toBe(true);

  const febPreview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Playwright chained February statement",
    sourceType: "pdf",
    rows: [],
    ownershipType: "direct",
    ownerName: account.ownerLabel,
    statementCheckpoints: [{
      accountId: account.id,
      accountName: account.name,
      detectedAccountName: account.name,
      checkpointMonth: "2026-02",
      statementStartDate: "2026-02-01",
      statementEndDate: "2026-02-28",
      statementBalanceMinor: 0,
      note: "Playwright chained February statement"
    }]
  });

  expect(febPreview.preview.statementReconciliations[0].status).toBe("missing_prior_statement");
  expect(febPreview.preview.exceptionSummary.some((item) => item.kind === "statement_chain_gap")).toBe(true);
});

test("OCBC 360 activity after a statement uses value dates and preserves the matched statement checkpoint", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright OCBC 360 ${Date.now()}`;
  const createPayload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "OCBC",
    kind: "bank",
    openingBalanceMinor: 100000,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const accountId = createPayload.accountId;
  expect(accountId).toBeTruthy();

  const statementCheckpoint = {
    accountId,
    accountName,
    detectedAccountName: accountName,
    checkpointMonth: "2026-05",
    statementStartDate: "2026-05-01",
    statementEndDate: "2026-05-31",
    statementBalanceMinor: 54302,
    note: "Synthetic OCBC 360 May statement"
  };
  const statementPreview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Synthetic OCBC 360 May PDF",
    sourceType: "pdf",
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    rows: [
      {
        date: "2026-05-29",
        description: "BILL PAYMENT INB 4524192012247528 INTERNET BANKING SINGAPORE",
        expense: "459.12",
        income: "",
        accountId,
        account: accountName,
        category: "Transfer",
        type: "transfer"
      },
      {
        date: "2026-05-30",
        description: "INTEREST CREDIT",
        expense: "",
        income: "2.14",
        accountId,
        account: accountName,
        category: "Other - Income",
        type: "income"
      }
    ],
    statementCheckpoints: [statementCheckpoint]
  });
  const statementReconciliation = statementPreview.preview.statementReconciliations[0];
  expect(statementReconciliation.status, JSON.stringify(statementReconciliation)).toBe("matched");

  const statementCommit = await postJson(request, "/api/imports/commit", {
    sourceLabel: "Synthetic OCBC 360 May PDF",
    sourceType: "pdf",
    parserKey: "ocbc_360_pdf",
    rows: statementPreview.preview.previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review"),
    statementControlRows: statementPreview.preview.previewRows,
    statementReconciliations: statementPreview.preview.statementReconciliations,
    statementCheckpoints: [statementCheckpoint]
  });
  expect(statementCommit.importId).toBeTruthy();

  const activityPreview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Synthetic OCBC 360 current activity CSV",
    sourceType: "csv",
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    rows: [
      {
        date: "2026-05-29",
        description: "BILL PAYMENT INB INTERNET BANKING SINGAPORE4524192012247528",
        expense: "459.12",
        income: "",
        accountId,
        account: accountName,
        category: "Transfer",
        type: "transfer"
      },
      {
        date: "2026-06-02",
        description: "FUND TRANSFER OTHR - 90991884 Joyce Li to NEW CREATION CHUvia PayNow-UEN",
        expense: "1000.00",
        income: "",
        accountId,
        account: accountName,
        category: "Transfer",
        type: "transfer",
        note: "transaction date: 2026-05-31"
      }
    ],
    statementCheckpoints: []
  });
  const billPaymentRow = activityPreview.preview.previewRows.find((row) => row.description.startsWith("BILL PAYMENT"));
  const juneValueDateRow = activityPreview.preview.previewRows.find((row) => row.description.startsWith("FUND TRANSFER"));
  expect(billPaymentRow?.commitStatus).toBe("skipped");
  expect(billPaymentRow?.reconciliationMatch?.existingBankCertificationStatus).toBe("statement_certified");
  expect(juneValueDateRow?.commitStatus).toBe("included");
  expect(juneValueDateRow?.date).toBe("2026-06-02");

  const activityCommit = await postJson(request, "/api/imports/commit", {
    sourceLabel: "Synthetic OCBC 360 current activity CSV",
    sourceType: "csv",
    parserKey: "ocbc_360_activity_csv",
    rows: activityPreview.preview.previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review"),
    statementCheckpoints: []
  });
  expect(activityCommit.importId).toBeTruthy();

  const afterSettingsPage = await loadSettingsPage(request);
  const afterAccount = afterSettingsPage.settingsPage.accounts.find((item) => item.id === accountId);
  expect(afterAccount?.latestCheckpointMonth).toBe("2026-05");
  expect(afterAccount?.latestCheckpointDeltaMinor).toBe(0);
});

test("mid-cycle imports do not match imported provisional rows, but PDFs still can promote them", async (t) => {
  const request = await openRequest(t);
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  const existingImportedRow = {
    rowId: "mid-cycle-seed-row",
    rowIndex: 1,
    date: "2025-03-12",
    description: "MA MUM",
    amountMinor: 280,
    entryType: "expense",
    accountId: account.id,
    accountName: account.name,
    categoryName: "Food & Drinks",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-03-12",
      description: "MA MUM",
      expense: "2.80",
      accountId: account.id,
      account: account.name,
      category: "Food & Drinks"
    }
  };

  const seedCommit = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Mid-cycle seed CSV",
        sourceType: "csv",
        parserKey: "generic_csv",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: existingImportedRow });
  expect(seedCommit.ok, seedCommit.text).toBeTruthy();

  const exactCsvPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Exact overlapping mid-cycle CSV",
        sourceType: "csv",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        rows: [{
          date: "2025-03-12",
          description: "MA MUM",
          expense: "2.80",
          accountId,
          account: accountName,
          category: "Food & Drinks"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(exactCsvPreview.ok, JSON.stringify(exactCsvPreview.json)).toBeTruthy();
  expect(exactCsvPreview.json.preview.previewRows[0].commitStatus).toBe("skipped");
  expect(exactCsvPreview.json.preview.previewRows[0].commitStatusReason).toContain("exact");
  expect(exactCsvPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeFalsy();
  expect(exactCsvPreview.json.preview.previewRows[0].reconciliationMatch?.matchKind).toBe("exact");
  expect(exactCsvPreview.json.preview.previewRows[0].reconciliationMatches).toBeUndefined();

  const csvPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Later mid-cycle CSV",
        sourceType: "csv",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        rows: [{
          date: "2025-03-14",
          description: "MA MUM",
          expense: "2.80",
          accountId,
          account: accountName,
          category: "Food & Drinks"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(csvPreview.ok, JSON.stringify(csvPreview.json)).toBeTruthy();
  expect(csvPreview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(csvPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeFalsy();
  expect(csvPreview.json.preview.previewRows[0].reconciliationMatches ?? []).toHaveLength(0);

  const pdfPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Month-end PDF",
        sourceType: "pdf",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        rows: [{
          date: "2025-03-14",
          description: "MA MUM",
          expense: "2.80",
          accountId,
          account: accountName,
          category: "Food & Drinks"
        }],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(pdfPreview.ok, JSON.stringify(pdfPreview.json)).toBeTruthy();
  expect(pdfPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeTruthy();
  expect(pdfPreview.json.preview.previewRows[0].commitStatus).toBe("included");

  const csvCommit = await request.evaluate(async ({ previewRows }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Later mid-cycle CSV commit",
        sourceType: "csv",
        parserKey: "generic_csv",
        rows: previewRows,
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { previewRows: csvPreview.json.preview.previewRows });
  expect(csvCommit.ok, csvCommit.text).toBeTruthy();

  const afterCsv = await loadEntriesPage(request, { month: "2025-03" });
  const maMumEntries = afterCsv.monthPage.entries.filter((entry) => (
    entry.accountName === account.name
    && entry.description === "MA MUM"
    && entry.amountMinor === 280
  ));
  expect(maMumEntries).toHaveLength(2);
  expect(maMumEntries.every((entry) => entry.bankCertificationStatus === "import_provisional")).toBeTruthy();
});

test("current-activity import promotes shortcut rows with compact merchant aliases", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright Zero Coffee ${Date.now()}`;
  const accountPayload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  expect(accountPayload.accountId).toBeTruthy();

  const created = await postJson(request, "/api/entries/create", {
    date: "2026-06-27",
    description: "Zerocoffeellp",
    amountMinor: 8150,
    entryType: "expense",
    accountId: accountPayload.accountId,
    accountName,
    categoryName: "Food & Drinks",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "applepay"
  });
  expect(created.entryId).toBeTruthy();

  const preview = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Zero Coffee current activity CSV",
    sourceType: "csv",
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    rows: [{
      date: "2026-06-27",
      description: "ZERO COFFE* ZEROCOFFEE SINGAPORE SG",
      expense: "81.50",
      accountId: accountPayload.accountId,
      account: accountName,
      category: "Food & Drinks",
      note: "txn date: 2026-06-27"
    }]
  });

  const previewRow = preview.preview.previewRows[0];
  expect(previewRow.reconciliationTargetTransactionId).toBe(created.entryId);
  expect(previewRow.reconciliationMatch?.existingSourceType).toBe("manual");
  expect(previewRow.reconciliationMatch?.matchKind).toBe("probable");
  expect(previewRow.commitStatus).toBe("included");
  expect(previewRow.commitStatusReason).toContain("Current-activity import will promote the existing manual ledger row");
});

test("compact Citi PDF merchant text can still promote the spaced mid-cycle CSV row", async (t) => {
  const request = await openRequest(t);
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  const existingImportedRow = {
    rowId: "compact-citi-seed-row",
    rowIndex: 1,
    date: "2025-03-31",
    description: "SHOPEE SINGAPORE MP",
    amountMinor: 690,
    entryType: "expense",
    accountId: account.id,
    accountName: account.name,
    categoryName: "Shopping",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-03-31",
      description: "SHOPEE SINGAPORE MP",
      expense: "6.90",
      accountId: account.id,
      account: account.name,
      category: "Shopping"
    }
  };

  const seedCommit = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Compact Citi seed CSV",
        sourceType: "csv",
        parserKey: "generic_csv",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: existingImportedRow });
  expect(seedCommit.ok, seedCommit.text).toBeTruthy();

  const pdfPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Compact Citi PDF",
        sourceType: "pdf",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        rows: [{
          date: "2025-03-31",
          description: "SHOPEESINGAPOREMP",
          expense: "6.90",
          accountId,
          account: accountName,
          category: "Shopping"
        }],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });

  expect(pdfPreview.ok, JSON.stringify(pdfPreview.json)).toBeTruthy();
  expect(pdfPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeTruthy();
  expect(pdfPreview.json.preview.previewRows[0].commitStatus).toBe("included");
});

test("promoting a manual provisional row applies both official statement date lanes", async (t) => {
  const request = await openRequest(t);
  // The final statement is the source of truth for bank facts. User-owned
  // annotations are preserved, but transaction and posted dates come from the
  // official statement when the parser provides both lanes.
  const referenceData = await loadReferenceData(request);
  const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
  expect(account).toBeTruthy();

  const createdEntry = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/entries/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2025-08-11",
        description: "DATE ALIGNMENT TEST",
        accountId,
        accountName,
        categoryName: "Public Transport",
        amountMinor: 248,
        entryType: "expense",
        ownershipType: "direct",
        ownerName: "Tim"
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(createdEntry.ok, JSON.stringify(createdEntry.json)).toBeTruthy();

  const csvPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Date alignment CSV preview",
        sourceType: "csv",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        rows: [{
          date: "2025-08-13",
          description: "DATE ALIGNMENT TEST",
          expense: "2.48",
          accountId,
          account: accountName,
          category: "Public Transport"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(csvPreview.ok, JSON.stringify(csvPreview.json)).toBeTruthy();
  expect(csvPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBe(createdEntry.json.entryId);

  const csvCommit = await request.evaluate(async ({ previewRows }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Date alignment CSV commit",
        sourceType: "csv",
        parserKey: "generic_csv",
        rows: previewRows,
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { previewRows: csvPreview.json.preview.previewRows });
  expect(csvCommit.ok, csvCommit.text).toBeTruthy();

  const afterCsv = await loadEntriesPage(request, { month: "2025-08" });
  const csvPromotedEntry = afterCsv.monthPage.entries.find((entry) => entry.id === createdEntry.json.entryId);
  expect(csvPromotedEntry, JSON.stringify(afterCsv.monthPage.entries)).toBeTruthy();
  expect(csvPromotedEntry.date).toBe("2025-08-11");
  expect(csvPromotedEntry.postDate).toBe("2025-08-13");
  expect(csvPromotedEntry.bankCertificationStatus).toBe("import_provisional");

  const statementPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Date alignment PDF preview",
        sourceType: "pdf",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        rows: [{
          date: "2025-08-15",
          description: "DATE ALIGNMENT TEST",
          expense: "2.48",
          accountId,
          account: accountName,
          category: "Public Transport",
          note: "txn date: 2025-08-13"
        }],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: account.id, accountName: account.name });
  expect(statementPreview.ok, JSON.stringify(statementPreview.json)).toBeTruthy();
  expect(statementPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBe(createdEntry.json.entryId);

  const statementCommit = await request.evaluate(async ({ previewRows }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Date alignment PDF commit",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: previewRows,
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { previewRows: statementPreview.json.preview.previewRows });
  expect(statementCommit.ok, statementCommit.text).toBeTruthy();

  const afterStatement = await loadEntriesPage(request, { month: "2025-08" });
  const certifiedEntry = afterStatement.monthPage.entries.find((entry) => entry.id === createdEntry.json.entryId);
  expect(certifiedEntry, JSON.stringify(afterStatement.monthPage.entries)).toBeTruthy();
  expect(certifiedEntry.date).toBe("2025-08-13");
  expect(certifiedEntry.postDate).toBe("2025-08-15");
  expect(certifiedEntry.bankCertificationStatus).toBe("statement_certified");
});
