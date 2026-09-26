// Statement reconciliation API contracts, part 2: post-date cut-offs,
// already certified rows, remapped and duplicate certified rows and the
// previous-checkpoint chain, through the real Worker and a real local D1.
// Moved from tests/e2e/import-ledger-flow.spec.js, where they never touched
// the page (see docs/audits/e2e-unit-audit.md); the requests and assertions
// are unchanged. The browser statement workflow stays in that spec.
import test from "node:test";
import { expect } from "@playwright/test";

import { postJson, useSeededWorkerRequest } from "./support/worker-request.mjs";

const openRequest = useSeededWorkerRequest();

test("statement preview excludes rows whose post date lands after the statement end", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright UOB Post Date ${Date.now()}`;
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

  const csvPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Post-date spillover CSV",
        sourceType: "csv",
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        rows: [{
          date: "2026-04-13",
          description: "HONG KONG ZHAI DIMI S Singapore SG",
          expense: "11.40",
          note: "txn date: 2026-04-11",
          accountId,
          account: accountName,
          category: "Other"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });
  expect(csvPreview.ok, JSON.stringify(csvPreview.json)).toBeTruthy();

  const csvCommit = await request.evaluate(async ({ previewRows }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Post-date spillover CSV commit",
        sourceType: "csv",
        parserKey: "generic_csv",
        rows: previewRows,
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { previewRows: csvPreview.json.preview.previewRows });
  expect(csvCommit.ok, csvCommit.text).toBeTruthy();

  const statementPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Post-date spillover PDF",
        sourceType: "pdf",
        rows: [{
          date: "2026-04-13",
          description: "HONG KONG ZHAI DIMI S Singapore SG",
          expense: "11.40",
          note: "txn date: 2026-04-11",
          accountId,
          account: accountName,
          category: "Other"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId,
          accountName,
          checkpointMonth: "2026-04",
          statementStartDate: "2026-03-13",
          statementEndDate: "2026-04-12",
          statementBalanceMinor: 0,
          note: "Post-date spillover statement"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  expect(statementPreview.ok, JSON.stringify(statementPreview.json)).toBeTruthy();
  expect(statementPreview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(statementPreview.json.preview.statementReconciliations[0].status).toBe("matched");
  expect(statementPreview.json.preview.statementReconciliations[0].projectedLedgerBalanceMinor).toBe(0);
  expect(statementPreview.json.preview.statementReconciliations[0].deltaMinor).toBe(0);
});

test("posted-date corrections defer legitimate ledger rows out of the current statement", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright UOB Deferred Post Date ${Date.now()}`;
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

  const subway = await postJson(request, "/api/entries/create", {
    date: "2026-06-11",
    description: "Subway-Great World Cit",
    amountMinor: 1320,
    entryType: "expense",
    accountId,
    accountName,
    categoryName: "Other",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const malaysiaBoleh = await postJson(request, "/api/entries/create", {
    date: "2026-06-11",
    description: "Malaysia Boleh - Great",
    amountMinor: 530,
    entryType: "expense",
    accountId,
    accountName,
    categoryName: "Other",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const previewStatement = async () => request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "June post-date spillover PDF",
        sourceType: "pdf",
        rows: [{
          date: "2026-06-12",
          description: "INTERESTS",
          expense: "18.37",
          accountId,
          account: accountName,
          category: "Other"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId,
          accountName,
          checkpointMonth: "2026-06",
          statementStartDate: "2026-05-13",
          statementEndDate: "2026-06-12",
          statementBalanceMinor: 1837,
          note: "June statement through interest only"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  const beforePostDateFix = await previewStatement();
  expect(beforePostDateFix.ok, JSON.stringify(beforePostDateFix.json)).toBeTruthy();
  const beforeReconciliation = beforePostDateFix.json.preview.statementReconciliations[0];
  expect(beforeReconciliation.status).toBe("mismatch");
  expect(beforeReconciliation.reconciliationBreakdown.statementPeriodExistingRowsMinor).toBe(-1850);
  expect(beforeReconciliation.reconciliationBreakdown.periodExistingLedgerRows).toHaveLength(2);

  await postJson(request, "/api/entries/update-post-date", {
    entryId: subway.entryId,
    postDate: "2026-06-15"
  });
  await postJson(request, "/api/entries/update-post-date", {
    entryId: malaysiaBoleh.entryId,
    postDate: "2026-06-13"
  });

  const afterPostDateFix = await previewStatement();
  expect(afterPostDateFix.ok, JSON.stringify(afterPostDateFix.json)).toBeTruthy();
  const afterReconciliation = afterPostDateFix.json.preview.statementReconciliations[0];
  expect(afterReconciliation.status).toBe("matched");
  expect(afterReconciliation.reconciliationBreakdown.statementPeriodExistingRowsMinor).toBe(0);
  expect(afterReconciliation.reconciliationBreakdown.periodExistingLedgerRows).toHaveLength(0);
  expect(afterReconciliation.projectedLedgerBalanceMinor).toBe(-1837);
  expect(afterReconciliation.deltaMinor).toBe(0);
});

test("already certified statement rows retain ledger comparison details", async (t) => {
  const request = await openRequest(t);
  const accountId = await request.evaluate(async () => {
    const response = await fetch("/api/accounts/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Playwright UOB Certified",
        institution: "Synthetic Test Bank",
        kind: "credit_card",
        openingBalanceMinor: 0,
        currency: "SGD",
        ownerPersonId: "",
        isJoint: false
      })
    });
    const payload = await response.json();
    return payload.accountId;
  });
  expect(accountId).toBeTruthy();

  const certifiedStatementRow = {
    rowId: "certified-seed-row",
    rowIndex: 1,
    date: "2025-08-14",
    description: "BUS MRT 687",
    amountMinor: 248,
    entryType: "expense",
    accountId,
    account: "Playwright UOB Certified",
    accountName: "Playwright UOB Certified",
    category: "Public Transport",
    categoryName: "Public Transport",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-08-14",
      description: "BUS MRT 687",
      expense: "2.48",
      accountId,
      account: "Playwright UOB Certified",
      category: "Public Transport"
    }
  };

  const commitResponse = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement seed",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: certifiedStatementRow });
  expect(commitResponse.ok, commitResponse.text).toBeTruthy();

  const preview = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement repeat",
        sourceType: "pdf",
        rows: [row.rawRow],
        defaultAccountName: row.accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { row: certifiedStatementRow });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("skipped");
  expect(preview.json.preview.previewRows[0].commitStatusReason).toContain("already certified");
  expect(preview.json.preview.previewRows[0].reconciliationMatch).toBeTruthy();
  expect(preview.json.preview.previewRows[0].reconciliationMatch.matchKind).toBe("exact");
  expect(preview.json.preview.previewRows[0].reconciliationMatches).toBeUndefined();
});

test("remapped certified row is prioritized when it matches the statement mismatch", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright UOB Remap ${Date.now()}`;
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

  const certifiedStatementRow = {
    rowId: "certified-remap-seed-row",
    rowIndex: 1,
    date: "2025-08-14",
    description: "BUS MRT 687",
    amountMinor: 248,
    entryType: "expense",
    accountId,
    account: accountName,
    accountName,
    category: "Public Transport",
    categoryName: "Public Transport",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-08-14",
      description: "BUS MRT 687",
      expense: "2.48",
      accountId,
      account: accountName,
      category: "Public Transport"
    }
  };

  const commitResponse = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement remap seed",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: certifiedStatementRow });
  expect(commitResponse.ok, commitResponse.text).toBeTruthy();

  const preview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement remap preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-08-14",
          description: "BUS MRT 687",
          expense: "2.48",
          accountId,
          account: accountName,
          statementAccountName: "Synthetic Card Alpha",
          category: "Public Transport"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId,
          accountName,
          detectedAccountName: "Synthetic Card Alpha",
          checkpointMonth: "2025-08",
          statementStartDate: "2025-08-01",
          statementEndDate: "2025-08-31",
          statementBalanceMinor: 0,
          note: "Playwright remap mismatch"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.statementReconciliations[0].status).toBe("mismatch");
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("skipped");
  expect(preview.json.preview.previewRows[0].reconciliationMatch).toBeTruthy();
  expect(preview.json.preview.previewRows[0].isCertifiedConflict).toBe(true);
  expect(preview.json.preview.previewRows[0].commitStatusReason).toContain("matches the current statement mismatch difference of 2.48");
});

test("matched remapped certified row is hidden from already covered rows", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright UOB Remap Matched ${Date.now()}`;
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

  const certifiedStatementRow = {
    rowId: "certified-remap-matched-seed-row",
    rowIndex: 1,
    date: "2025-08-14",
    description: "BUS MRT 687",
    amountMinor: 248,
    entryType: "expense",
    accountId,
    account: accountName,
    accountName,
    category: "Public Transport",
    categoryName: "Public Transport",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-08-14",
      description: "BUS MRT 687",
      expense: "2.48",
      accountId,
      account: accountName,
      category: "Public Transport"
    }
  };

  const commitResponse = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement remap matched seed",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: certifiedStatementRow });
  expect(commitResponse.ok, commitResponse.text).toBeTruthy();

  const preview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement remap matched preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-08-14",
          description: "BUS MRT 687",
          expense: "2.48",
          accountId,
          account: accountName,
          statementAccountName: "Synthetic Card Alpha",
          category: "Public Transport"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId,
          accountName,
          detectedAccountName: "Synthetic Card Alpha",
          checkpointMonth: "2025-08",
          statementStartDate: "2025-08-01",
          statementEndDate: "2025-08-31",
          statementBalanceMinor: 248,
          note: "Playwright remap matched"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.statementReconciliations[0].status).toBe("matched");
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("skipped");
  expect(preview.json.preview.previewRows[0].isStatementMatchResolved).toBe(true);
});

test("same-amount certified rows do not falsely prioritize an ambiguous match", async (t) => {
  const request = await openRequest(t);
  const firstAccountId = await request.evaluate(async () => {
    const response = await fetch("/api/accounts/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Playwright UOB Ambiguous A",
        institution: "Synthetic Test Bank",
        kind: "credit_card",
        openingBalanceMinor: 0,
        currency: "SGD",
        ownerPersonId: "",
        isJoint: false
      })
    });
    const payload = await response.json();
    return payload.accountId;
  });
  const secondAccountId = await request.evaluate(async () => {
    const response = await fetch("/api/accounts/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Playwright UOB Ambiguous B",
        institution: "Synthetic Test Bank",
        kind: "credit_card",
        openingBalanceMinor: 0,
        currency: "SGD",
        ownerPersonId: "",
        isJoint: false
      })
    });
    const payload = await response.json();
    return payload.accountId;
  });
  expect(firstAccountId).toBeTruthy();
  expect(secondAccountId).toBeTruthy();

  const seedRow = (rowId, accountId, accountName, description) => ({
    rowId,
    rowIndex: 1,
    date: "2025-08-14",
    description,
    amountMinor: 248,
    entryType: "expense",
    accountId,
    account: accountName,
    accountName,
    category: "Public Transport",
    categoryName: "Public Transport",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-08-14",
      description,
      expense: "2.48",
      accountId,
      account: accountName,
      category: "Public Transport"
    }
  });

  for (const row of [
    seedRow("ambiguous-seed-a", firstAccountId, "Playwright UOB Ambiguous A", "BUS MRT 687"),
    seedRow("ambiguous-seed-b", firstAccountId, "Playwright UOB Ambiguous A", "BUS MRT 688")
  ]) {
    const commitResponse = await request.evaluate(async ({ row }) => {
      const response = await fetch("/api/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLabel: "Certified statement ambiguous seed",
          sourceType: "pdf",
          parserKey: "uob_pdf",
          rows: [row],
          statementCheckpoints: []
        })
      });
      return { ok: response.ok, text: await response.text() };
    }, { row });
    expect(commitResponse.ok, commitResponse.text).toBeTruthy();
  }

  const preview = await request.evaluate(async ({ accountId }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement ambiguous preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-08-14",
          description: "BUS MRT 687",
          expense: "2.48",
          accountId,
          account: "Playwright UOB Ambiguous A",
          statementAccountName: "Synthetic Card Alpha",
          category: "Public Transport"
        }],
        defaultAccountName: "Playwright UOB Ambiguous A",
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId,
          accountName: "Playwright UOB Ambiguous A",
          detectedAccountName: "Synthetic Card Alpha",
          checkpointMonth: "2025-08",
          statementStartDate: "2025-08-01",
          statementEndDate: "2025-08-31",
          statementBalanceMinor: 248,
          note: "Playwright ambiguous mismatch"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId: firstAccountId });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.statementReconciliations[0].status).toBe("mismatch");
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("skipped");
  expect(preview.json.preview.previewRows[0].reconciliationMatch).toBeTruthy();
  expect(preview.json.preview.previewRows[0].commitStatusReason).toContain("matches the current statement mismatch difference");
});

test("current-period PDF row auto-resolves when prior matched checkpoint owns the earlier certified row", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright Outside Period Conflict ${Date.now()}`;
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

  const commitResponse = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Outside period certified seed",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: [{
          rowId: "outside-period-seed-row",
          rowIndex: 1,
          date: "2025-08-11",
          description: "BUS MRT 687",
          amountMinor: 248,
          entryType: "expense",
          accountId,
          account: accountName,
          accountName,
          category: "Public Transport",
          categoryName: "Public Transport",
          ownershipType: "direct",
          ownerName: "Tim",
          splitBasisPoints: 10000,
          rawRow: {
            date: "2025-08-11",
            description: "BUS MRT 687",
            expense: "2.48",
            accountId,
            account: accountName,
            category: "Public Transport"
          }
        }],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { accountId, accountName });
  expect(commitResponse.ok, commitResponse.text).toBeTruthy();

  const priorCheckpointResponse = await request.evaluate(async ({ accountId }) => {
    const response = await fetch("/api/accounts/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        checkpointMonth: "2025-08",
        statementStartDate: "2025-07-13",
        statementEndDate: "2025-08-12",
        statementBalanceMinor: 248,
        note: "Matched prior statement"
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { accountId });
  expect(priorCheckpointResponse.ok, priorCheckpointResponse.text).toBeTruthy();

  const preview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Outside period certified preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-08-14",
          description: "BUS MRT 687",
          expense: "2.48",
          accountId,
          account: accountName,
          statementAccountName: "Synthetic Card Alpha",
          category: "Public Transport"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId,
          accountName,
          detectedAccountName: "Synthetic Card Alpha",
          checkpointMonth: "2025-09",
          statementStartDate: "2025-08-13",
          statementEndDate: "2025-09-12",
          statementBalanceMinor: 496,
          note: "Playwright outside period conflict"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.statementReconciliations[0].status).toBe("matched");
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(preview.json.preview.previewRows[0].isCertifiedConflict).not.toBe(true);
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("included");
});

test("outside-period certified match stays a conflict when the immediate previous checkpoint is not matched", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright Outside Period Conflict ${Date.now()}`;
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

  const commitResponse = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Outside period certified seed",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: [{
          rowId: "outside-period-seed-row",
          rowIndex: 1,
          date: "2025-08-11",
          description: "BUS MRT 687",
          amountMinor: 248,
          entryType: "expense",
          accountId,
          account: accountName,
          accountName,
          category: "Public Transport",
          categoryName: "Public Transport",
          ownershipType: "direct",
          ownerName: "Tim",
          splitBasisPoints: 10000,
          rawRow: {
            date: "2025-08-11",
            description: "BUS MRT 687",
            expense: "2.48",
            accountId,
            account: accountName,
            category: "Public Transport"
          }
        }],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { accountId, accountName });
  expect(commitResponse.ok, commitResponse.text).toBeTruthy();

  const previousCheckpointResponse = await request.evaluate(async ({ accountId }) => {
    const response = await fetch("/api/accounts/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        checkpointMonth: "2025-08",
        statementStartDate: "2025-07-13",
        statementEndDate: "2025-08-12",
        statementBalanceMinor: 1,
        note: "Mismatched prior statement"
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { accountId });
  expect(previousCheckpointResponse.ok, previousCheckpointResponse.text).toBeTruthy();

  const preview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Outside period certified preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-08-14",
          description: "BUS MRT 687",
          expense: "2.48",
          accountId,
          account: accountName,
          statementAccountName: "Synthetic Card Alpha",
          category: "Public Transport"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId,
          accountName,
          detectedAccountName: "Synthetic Card Alpha",
          checkpointMonth: "2025-09",
          statementStartDate: "2025-08-13",
          statementEndDate: "2025-09-12",
          statementBalanceMinor: 0,
          note: "Playwright outside period conflict"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.statementReconciliations[0].status).toBe("mismatch");
  expect(preview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(preview.json.preview.previewRows[0].isCertifiedConflict).not.toBe(true);
});

test("user can explicitly include a certified PDF duplicate and keep it included on refresh", async (t) => {
  const request = await openRequest(t);
  const accountName = `Playwright Explicit Conflict Include ${Date.now()}`;
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

  const commitResponse = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Explicit conflict include seed",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: [{
          rowId: "explicit-conflict-seed-row",
          rowIndex: 1,
          date: "2025-04-01",
          description: "HelloRide SINGAPORE",
          amountMinor: 2990,
          entryType: "income",
          accountId,
          account: accountName,
          accountName,
          category: "Other - Income",
          categoryName: "Other - Income",
          ownershipType: "direct",
          ownerName: "Tim",
          splitBasisPoints: 10000,
          rawRow: {
            date: "2025-04-01",
            description: "HelloRide SINGAPORE",
            expense: "",
            income: "29.90",
            accountId,
            account: accountName,
            category: "Other - Income"
          }
        }],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { accountId, accountName });
  expect(commitResponse.ok, commitResponse.text).toBeTruthy();

  const conflictPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Explicit conflict include preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-04-01",
          description: "HelloRide SINGAPORE",
          expense: "",
          income: "29.90",
          accountId,
          account: accountName,
          statementAccountName: accountName,
          category: "Other - Income"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  expect(conflictPreview.ok, JSON.stringify(conflictPreview.json)).toBeTruthy();
  expect(conflictPreview.json.preview.previewRows[0].commitStatus).toBe("skipped");
  expect(conflictPreview.json.preview.previewRows[0].reconciliationMatch?.existingTransactionId).toBeTruthy();

  const includedPreview = await request.evaluate(async ({ accountId, accountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Explicit conflict include preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-04-01",
          description: "HelloRide SINGAPORE",
          expense: "",
          income: "29.90",
          accountId,
          account: accountName,
          statementAccountName: accountName,
          category: "Other - Income",
          commitStatus: "included"
        }],
        defaultAccountName: accountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { accountId, accountName });

  expect(includedPreview.ok, JSON.stringify(includedPreview.json)).toBeTruthy();
  expect(includedPreview.json.preview.previewRows[0].commitStatus).toBe("included");
  expect(includedPreview.json.preview.previewRows[0].isCertifiedConflict).not.toBe(true);
  expect(includedPreview.json.preview.previewRows[0].commitStatusExplicit).toBe(true);
});

test("wrong-card remap stays mismatched and does not resolve the certified row", async (t) => {
  const request = await openRequest(t);
  const createAccount = async (name) => {
    const result = await postJson(request, "/api/accounts/create", {
      name,
      institution: "Synthetic Test Bank",
      kind: "credit_card",
      openingBalanceMinor: 0,
      currency: "SGD",
      ownerPersonId: "",
      isJoint: false
    });
    expect(result.accountId).toBeTruthy();
    return result.accountId;
  };

  const correctAccountName = `Playwright Wrong Remap Correct ${Date.now()}`;
  const wrongAccountName = `Playwright Wrong Remap Wrong ${Date.now()}`;
  const correctAccountId = await createAccount(correctAccountName);
  const wrongAccountId = await createAccount(wrongAccountName);

  const seedRow = {
    rowId: "wrong-remap-seed-row",
    rowIndex: 1,
    date: "2025-08-14",
    description: "BUS MRT 687",
    amountMinor: 248,
    entryType: "expense",
    accountId: correctAccountId,
    account: correctAccountName,
    accountName: correctAccountName,
    category: "Public Transport",
    categoryName: "Public Transport",
    ownershipType: "direct",
    ownerName: "Tim",
    splitBasisPoints: 10000,
    rawRow: {
      date: "2025-08-14",
      description: "BUS MRT 687",
      expense: "2.48",
      accountId: correctAccountId,
      account: correctAccountName,
      category: "Public Transport"
    }
  };

  const commitResponse = await request.evaluate(async ({ row }) => {
    const response = await fetch("/api/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement wrong remap seed",
        sourceType: "pdf",
        parserKey: "uob_pdf",
        rows: [row],
        statementCheckpoints: []
      })
    });
    return { ok: response.ok, text: await response.text() };
  }, { row: seedRow });
  expect(commitResponse.ok, commitResponse.text).toBeTruthy();

  const preview = await request.evaluate(async ({ wrongAccountId, wrongAccountName }) => {
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "Certified statement wrong remap preview",
        sourceType: "pdf",
        rows: [{
          date: "2025-08-14",
          description: "BUS MRT 687",
          expense: "2.48",
          accountId: wrongAccountId,
          account: wrongAccountName,
          statementAccountName: "Synthetic Card Wrong",
          category: "Public Transport"
        }],
        defaultAccountName: wrongAccountName,
        ownershipType: "direct",
        ownerName: "Tim",
        statementCheckpoints: [{
          accountId: wrongAccountId,
          accountName: wrongAccountName,
          detectedAccountName: "Synthetic Card Wrong",
          checkpointMonth: "2025-08",
          statementStartDate: "2025-08-01",
          statementEndDate: "2025-08-31",
          statementBalanceMinor: 248,
          note: "Playwright wrong remap mismatch"
        }]
      })
    });
    return { ok: response.ok, json: await response.json() };
  }, { wrongAccountId, wrongAccountName });

  expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
  expect(preview.json.preview.statementReconciliations[0].status).not.toBe("matched");
  expect(preview.json.preview.previewRows[0].comparisonMatch).toBeUndefined();
  expect(preview.json.preview.previewRows[0].isCertifiedConflict).not.toBe(true);
  expect(preview.json.preview.previewRows[0].isStatementMatchResolved).not.toBe(true);
});
