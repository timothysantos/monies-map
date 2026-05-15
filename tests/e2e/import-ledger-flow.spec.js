import { expect, test } from "@playwright/test";
const currencyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

function findSummaryMonth(view, month) {
  const item = view.summaryPage.months.find((row) => row.month === month);
  if (!item) {
    throw new Error(`Summary month not found: ${month}`);
  }
  return item;
}

function findDonutMonthValue(view, month, categoryName) {
  const donutMonth = view.summaryPage.categoryShareByMonth.find((item) => item.month === month);
  if (!donutMonth) {
    throw new Error(`Donut month not found: ${month}`);
  }

  const entry = donutMonth.data.find((item) => item.label === categoryName);
  if (!entry) {
    return 0;
  }

  return entry.valueMinor;
}

async function reseedDemo(page) {
  let lastText = "";
  let lastOk = false;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await page.request.post("/api/demo/reseed");
      lastOk = response.ok();
      lastText = await response.text();
      if (lastOk) {
        return;
      }
    } catch (error) {
      lastOk = false;
      lastText = String(error?.message ?? error);
    }

    if (attempt < 9) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  throw new Error(lastText || "Failed to reseed demo data.");
}

async function postJson(page, path, body) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await page.request.post(path, { data: body });
      const text = await response.text();
      if (
        attempt < 2
        && (text.includes("worker restarted mid-request") || text.includes("socket hang up") || text.includes("Your worker"))
      ) {
        continue;
      }
      if (!response.ok()) {
        if (
          attempt < 2
          && (text.includes("worker restarted mid-request") || text.includes("UNIQUE constraint failed: households.id"))
        ) {
          continue;
        }
        expect(response.ok(), text).toBeTruthy();
      }
      return text ? JSON.parse(text) : {};
    } catch (error) {
      lastError = error;
      if (attempt < 2 && String(error?.message ?? error).includes("worker restarted mid-request")) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error(`POST ${path} failed`);
}

async function loadEntriesPage(page, { view = "person-tim", month = "2025-10" } = {}) {
  const response = await page.request.get(`/api/entries-page?view=${view}&month=${month}`);
  if (!response.ok()) {
    throw new Error(`Entries page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function loadAppShell(page, { month = "2025-10", scope = "direct_plus_shared" } = {}) {
  const params = new URLSearchParams({ month, scope });
  const response = await page.request.get(`/api/app-shell?${params.toString()}`);
  if (!response.ok()) {
    throw new Error(`App shell failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function loadMonthPage(page, { view = "person-tim", month = "2025-10", scope = "direct_plus_shared" } = {}) {
  const params = new URLSearchParams({ view, month, scope });
  const response = await page.request.get(`/api/month-page?${params.toString()}`);
  if (!response.ok()) {
    throw new Error(`Month page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function loadSummaryPage(page, { view = "person-tim", month = "2025-10", scope = "direct_plus_shared", summaryStart, summaryEnd } = {}) {
  const params = new URLSearchParams({ view, month, scope });
  if (summaryStart) {
    params.set("summary_start", summaryStart);
  }
  if (summaryEnd) {
    params.set("summary_end", summaryEnd);
  }
  const response = await page.request.get(`/api/summary-page?${params.toString()}`);
  if (!response.ok()) {
    throw new Error(`Summary page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

function formatMoney(minor) {
  return currencyFormatter.format(minor / 100);
}

function money(valueMinor) {
  return (valueMinor / 100).toFixed(2);
}

function csvFromRows(rows) {
  return [
    "date,description,expense,income,account,category,note,type",
    ...rows.map((row) => [
      row.date,
      row.description,
      money(row.expenseMinor),
      "",
      row.account,
      row.category,
      row.note ?? "",
      "expense"
    ].join(","))
  ].join("\n");
}

function buildSyntheticUobCardStatement({ statementDate, sections }) {
  const lines = [
    "UOB CARD STATEMENT",
    "Statement Date",
    statementDate
  ];

  for (const section of sections) {
    lines.push(
      section.heading,
      section.cardNumber,
      "PREVIOUS BALANCE",
      money(section.previousBalanceMinor)
    );

    for (const row of section.rows) {
      lines.push(
        row.postDate,
        row.transactionDate,
        row.description,
        `Ref No. : ${row.reference}`,
        money(row.amountMinor)
      );
    }

    lines.push(
      "SUB TOTAL",
      "TOTAL BALANCE FOR " + section.heading,
      money(section.totalBalanceMinor)
    );
  }

  lines.push("End of Transaction Details");
  return lines.join("\n");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function writeTextPdf(page, path, text) {
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(`
    <html>
      <body>
        <pre style="font-family: Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.55; white-space: pre-wrap;">${escapeHtml(text)}</pre>
      </body>
    </html>
  `);
  await pdfPage.pdf({ path, format: "A4", printBackground: true });
  await pdfPage.close();
}

test.describe("import flow", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await page.goto("/api/health");
  });

  test("preview flags unknown accounts from the CSV input", async ({ page }) => {
    const payload = await postJson(page, "/api/imports/preview", {
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

  test("expense and income headers auto-map without manual mapping", async ({ page }) => {
    const payload = await postJson(page, "/api/imports/preview", {
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

  test("imported row can be edited and rolls through entries, month, and summary", async ({ page }) => {
    const beforeMonthPage = await loadMonthPage(page, { view: "person-tim", month: "2025-10" });
    const beforeSummaryPage = await loadSummaryPage(page, { view: "person-tim", month: "2025-10" });
    const beforeMonth = findSummaryMonth(beforeSummaryPage, "2025-10");
    const beforeFoodDonut = findDonutMonthValue(beforeSummaryPage, "2025-10", "Food & Drinks");

    await page.goto("/imports?view=person-tim&month=2025-10");
    await expect(page.getByRole("heading", { name: "Import and certify" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Source label")).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("Source label").fill("Playwright import");
    await page.getByLabel("CSV content").fill(
      [
        "category,account,note,amount,date,description",
        "Groceries,UOB One,Playwright import row,-111.11,2025-10-17,Playwright groceries import"
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.locator('.import-preview-table input[value="Playwright groceries import"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Commit import" }).first()).toBeEnabled();
    await page.getByRole("button", { name: "Commit import" }).first().click();

    await page.goto("/entries?view=person-tim&month=2025-10");
    const entryRow = page.locator(".entry-row").filter({ hasText: "Playwright groceries import" }).first();
    await expect(entryRow.locator(".entry-row-description strong").filter({ hasText: "Playwright groceries import" })).toBeVisible();
    await entryRow.click();
    const entryEditor = page.locator(".entry-edit-grid").first();
    await expect(entryEditor).toBeVisible();
    await entryEditor.locator("select").first().selectOption("Food & Drinks");
    await page.getByRole("button", { name: "Done editing entry" }).click();

    await expect(page.locator(".entry-row").filter({ hasText: "Playwright groceries import" }).first()).toBeVisible({ timeout: 30_000 });

    const afterMonthPage = await loadMonthPage(page, { view: "person-tim", month: "2025-10" });
    const afterSummaryPage = await loadSummaryPage(page, { view: "person-tim", month: "2025-10" });
    const afterMonth = findSummaryMonth(afterSummaryPage, "2025-10");
    const afterFoodDonut = findDonutMonthValue(afterSummaryPage, "2025-10", "Food & Drinks");
    const afterActualSpend = afterMonthPage.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor ?? 0;

    expect(afterActualSpend).toBe(
      (beforeMonthPage.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor ?? 0) + 11_111
    );
    expect(afterMonth.realExpensesMinor).toBe(beforeMonth.realExpensesMinor + 11_111);
    expect(afterFoodDonut).toBe(beforeFoodDonut + 11_111);

    await page.goto("/month?view=person-tim&month=2025-10");
    await expect(page.getByRole("heading", { name: "Month", exact: true })).toBeVisible();

    await page.goto("/summary?view=person-tim&month=2025-10");
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Oct 2025" }).first()).toBeVisible();
    await expect(page.getByText(formatMoney(afterFoodDonut)).first()).toBeVisible({ timeout: 30_000 });
  });

  test("committed import can be rolled back and disappears from entries and import history", async ({ page }) => {
    const description = `Playwright rollback import ${Date.now()}`;
    const month = "2025-10";
    const appShell = await loadAppShell(page, { month });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
    expect(account).toBeTruthy();

    const beforeEntries = await loadEntriesPage(page, { view: "person-tim", month });
    const beforeSummary = await loadSummaryPage(page, { view: "person-tim", month });
    const beforeMonth = findSummaryMonth(beforeSummary, month);
    const beforeImportsPageResponse = await page.request.get("/api/imports-page");
    const beforeImportsPage = await beforeImportsPageResponse.json();

    const previewPayload = await postJson(page, "/api/imports/preview", {
      sourceLabel: "Playwright rollback import",
      sourceType: "csv",
      csv: [
        "date,description,amount,account,category,note",
        `${month}-19,${description},-12.34,UOB One,Groceries,rollback coverage`
      ].join("\n"),
      ownershipType: "direct",
      ownerName: "Tim"
    });
    const commitPayload = await postJson(page, "/api/imports/commit", {
      sourceLabel: "Playwright rollback import",
      sourceType: "csv",
      parserKey: "generic_csv",
      rows: previewPayload.preview.previewRows
    });
    expect(commitPayload.importId).toBeTruthy();

    const rollbackPayload = await postJson(page, "/api/imports/rollback", { importId: commitPayload.importId });
    expect(rollbackPayload.importId).toBe(commitPayload.importId);
    expect(rollbackPayload.rolledBack).toBe(true);

    const afterEntries = await loadEntriesPage(page, { view: "person-tim", month });
    const afterSummary = await loadSummaryPage(page, { view: "person-tim", month });
    const afterMonth = findSummaryMonth(afterSummary, month);
    const afterImportsPageResponse = await page.request.get("/api/imports-page");
    const afterImportsPage = await afterImportsPageResponse.json();

    expect(afterEntries.monthPage.entries.some((item) => item.description === description)).toBe(false);
    expect(afterMonth.realExpensesMinor).toBe(beforeMonth.realExpensesMinor);
    expect(afterImportsPage.importsPage.recentImports.some((item) => item.id === commitPayload.importId && item.status === "rolled_back")).toBe(true);
    expect(beforeImportsPage.importsPage.recentImports.some((item) => item.status === "rolled_back")).toBe(false);
  });

  test("summary and month stay aligned across tabs after persisted changes", async ({ browser, page }) => {
    const context = page.context();
    const summaryPage = page;
    const importsPage = await context.newPage();
    const monthPage = await context.newPage();

    await summaryPage.goto("/summary?view=person-tim&month=2025-10&summary_focus=2025-10");
    await monthPage.goto("/month?view=person-tim&month=2025-10");
    await importsPage.goto("/imports?view=person-tim&month=2025-10");

    const beforeSummaryPage = await loadSummaryPage(summaryPage, { view: "person-tim", month: "2025-10" });
    const beforeMonthPage = await loadMonthPage(monthPage, { view: "person-tim", month: "2025-10" });
    const beforeMonth = findSummaryMonth(beforeSummaryPage, "2025-10");
    expect(beforeMonthPage.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor).toBe(beforeMonth.realExpensesMinor);
    const expectedAfterActual = beforeMonth.realExpensesMinor + 22_22;

    await expect(importsPage.getByRole("heading", { name: "Import and certify" })).toBeVisible({ timeout: 30_000 });
    await importsPage.getByLabel("Source label").fill("Cross-tab sync import");
    await importsPage.getByLabel("CSV content").fill(
      [
        "date,description,amount,account,category,note",
        "2025-10-18,Cross-tab sync groceries,-22.22,UOB One,Groceries,Should refresh summary and month."
      ].join("\n")
    );

    await importsPage.getByRole("button", { name: "Preview import" }).click();
    await importsPage.getByRole("button", { name: "Commit import" }).first().click();

    const expectedLabel = formatMoney(expectedAfterActual);
    await summaryPage.goto("/summary?view=person-tim&month=2025-10&summary_focus=2025-10");
    await monthPage.goto("/month?view=person-tim&month=2025-10");

    const afterSummaryPage = await loadSummaryPage(summaryPage, { view: "person-tim", month: "2025-10" });
    const afterMonthPage = await loadMonthPage(monthPage, { view: "person-tim", month: "2025-10" });
    const afterMonth = findSummaryMonth(afterSummaryPage, "2025-10");
    const monthActualCard = afterMonthPage.monthPage.metricCards.find((item) => item.label === "Actual spend");

    expect(afterMonth.realExpensesMinor).toBe(expectedAfterActual);
    expect(monthActualCard?.amountMinor).toBe(expectedAfterActual);

    await importsPage.close();
    await monthPage.close();
  });

  test("statement preview can certify midcycle rows and still save the checkpoint", async ({ page }) => {
    const appShell = await loadAppShell(page, { month: "2025-10" });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
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

    const midcycleCommit = await page.evaluate(async ({ row }) => {
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

    const previewWithMismatchedCheckpoint = await page.evaluate(async ({ row, statementCheckpoints }) => {
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

    const preview = await page.evaluate(async ({ row, statementCheckpoints }) => {
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
    expect(preview.json.preview.previewRows[0].duplicateMatches).toBeUndefined();
    expect(
      preview.json.preview.statementReconciliations[0].status,
      JSON.stringify(preview.json.preview.statementReconciliations[0])
    ).toBe("matched");

    const checkpointOnlyCommit = await page.evaluate(async ({ statementCheckpoints }) => {
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

    const afterAppShell = await loadAppShell(page, { month: "2025-10" });
    const afterAccount = afterAppShell.accounts.find((item) => item.id === account.id);
    expect(afterAccount?.latestCheckpointMonth).toBe("2025-10");
    expect(Number.isFinite(afterAccount?.latestCheckpointDeltaMinor)).toBeTruthy();
  });

  test("statement balance can certify a near-match provisional row when amount clears the velocity rule", async ({ page }) => {
    const appShell = await loadAppShell(page, { month: "2025-08" });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
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

    const existingCommit = await page.evaluate(async ({ row }) => {
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

    const mismatchedPreview = await page.evaluate(async ({ row, statementCheckpoints }) => {
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

    const resolvedPreview = await page.evaluate(async ({ row, statementCheckpoints }) => {
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

  test("low-value near matches beyond two days stay out of the reconciliation lane", async ({ page }) => {
    const appShell = await loadAppShell(page, { month: "2025-08" });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
    expect(account).toBeTruthy();

    const existingRow = {
      rowId: "velocity-lane-existing",
      rowIndex: 1,
      date: "2025-08-11",
      description: "BUS MRT 123",
      amountMinor: 248,
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
        expense: "2.48",
        accountId: account.id,
        account: account.name,
        category: "Public Transport"
      }
    };

    const existingCommit = await page.evaluate(async ({ row }) => {
      const response = await fetch("/api/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLabel: "Playwright velocity existing transit",
          sourceType: "csv",
          parserKey: "uob_current_xls",
          rows: [row],
          statementCheckpoints: []
        })
      });
      return { ok: response.ok, text: await response.text() };
    }, { row: existingRow });
    expect(existingCommit.ok, existingCommit.text).toBeTruthy();

    const preview = await page.evaluate(async ({ accountId, accountName }) => {
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
    expect(preview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeFalsy();
    expect(preview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBeFalsy();
    expect(preview.json.preview.reconciliationCandidateCount).toBe(0);
  });

  test("mid-cycle imports do not match imported provisional rows, but PDFs still can promote them", async ({ page }) => {
    const appShell = await loadAppShell(page, { month: "2025-03" });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
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

    const seedCommit = await page.evaluate(async ({ row }) => {
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

    const exactCsvPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

    const csvPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

    const pdfPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

    const csvCommit = await page.evaluate(async ({ previewRows }) => {
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

    const afterCsv = await loadEntriesPage(page, { month: "2025-03" });
    const maMumEntries = afterCsv.monthPage.entries.filter((entry) => (
      entry.accountName === account.name
      && entry.description === "MA MUM"
      && entry.amountMinor === 280
    ));
    expect(maMumEntries).toHaveLength(2);
    expect(maMumEntries.every((entry) => entry.bankCertificationStatus === "import_provisional")).toBeTruthy();
  });

  test("compact Citi PDF merchant text can still promote the spaced mid-cycle CSV row", async ({ page }) => {
    const appShell = await loadAppShell(page, { month: "2025-03" });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
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

    const seedCommit = await page.evaluate(async ({ row }) => {
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

    const pdfPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("certified PDF hash does not suppress a later statement row when the bank-cleared dates differ", async ({ page }) => {
    const appShell = await loadAppShell(page, { month: "2025-05" });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
    expect(account).toBeTruthy();

    const manualEntry = await page.evaluate(async ({ accountId, accountName }) => {
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

    const certifyCommit = await page.evaluate(async ({ accountId, accountName, entryId }) => {
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

    const laterPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("promoting a manual provisional row keeps the event date and stores the bank post date separately", async ({ page }) => {
    // The ledger should keep the user-entered event date in place while the
    // import fills in the bank-cleared postDate lane.
    const appShell = await loadAppShell(page, { month: "2025-08" });
    const account = appShell.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
    expect(account).toBeTruthy();

    const createdEntry = await page.evaluate(async ({ accountId, accountName }) => {
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

    const csvPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

    const csvCommit = await page.evaluate(async ({ previewRows }) => {
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

    const afterCsv = await loadEntriesPage(page, { month: "2025-08" });
    const csvPromotedEntry = afterCsv.monthPage.entries.find((entry) => entry.id === createdEntry.json.entryId);
    expect(csvPromotedEntry, JSON.stringify(afterCsv.monthPage.entries)).toBeTruthy();
    expect(csvPromotedEntry.date).toBe("2025-08-11");
    expect(csvPromotedEntry.postDate).toBe("2025-08-13");
    expect(csvPromotedEntry.bankCertificationStatus).toBe("import_provisional");

    const statementPreview = await page.evaluate(async ({ accountId, accountName }) => {
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
            category: "Public Transport"
          }],
          statementCheckpoints: []
        })
      });
      return { ok: response.ok, json: await response.json() };
    }, { accountId: account.id, accountName: account.name });
    expect(statementPreview.ok, JSON.stringify(statementPreview.json)).toBeTruthy();
    expect(statementPreview.json.preview.previewRows[0].reconciliationTargetTransactionId).toBe(createdEntry.json.entryId);

    const statementCommit = await page.evaluate(async ({ previewRows }) => {
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

    const afterStatement = await loadEntriesPage(page, { month: "2025-08" });
    const certifiedEntry = afterStatement.monthPage.entries.find((entry) => entry.id === createdEntry.json.entryId);
    expect(certifiedEntry, JSON.stringify(afterStatement.monthPage.entries)).toBeTruthy();
    expect(certifiedEntry.date).toBe("2025-08-11");
    expect(certifiedEntry.postDate).toBe("2025-08-15");
    expect(certifiedEntry.bankCertificationStatus).toBe("statement_certified");
  });

  test("statement preview excludes rows whose post date lands after the statement end", async ({ page }) => {
    const accountName = `Playwright UOB Post Date ${Date.now()}`;
    const createPayload = await postJson(page, "/api/accounts/create", {
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

    const csvPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

    const csvCommit = await page.evaluate(async ({ previewRows }) => {
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

    const statementPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("already certified statement rows retain ledger comparison details", async ({ page }) => {
    const accountId = await page.evaluate(async () => {
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

    const commitResponse = await page.evaluate(async ({ row }) => {
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

    const preview = await page.evaluate(async ({ row }) => {
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

  test("remapped certified row is prioritized when it matches the statement mismatch", async ({ page }) => {
    const accountName = `Playwright UOB Remap ${Date.now()}`;
    const createPayload = await postJson(page, "/api/accounts/create", {
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

    const commitResponse = await page.evaluate(async ({ row }) => {
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

    const preview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("matched remapped certified row is hidden from already covered rows", async ({ page }) => {
    const accountName = `Playwright UOB Remap Matched ${Date.now()}`;
    const createPayload = await postJson(page, "/api/accounts/create", {
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

    const commitResponse = await page.evaluate(async ({ row }) => {
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

    const preview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("same-amount certified rows do not falsely prioritize an ambiguous match", async ({ page }) => {
    const firstAccountId = await page.evaluate(async () => {
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
    const secondAccountId = await page.evaluate(async () => {
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
      const commitResponse = await page.evaluate(async ({ row }) => {
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

    const preview = await page.evaluate(async ({ accountId }) => {
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

  test("current-period PDF row auto-resolves when prior matched checkpoint owns the earlier certified row", async ({ page }) => {
    const accountName = `Playwright Outside Period Conflict ${Date.now()}`;
    const createPayload = await postJson(page, "/api/accounts/create", {
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

    const commitResponse = await page.evaluate(async ({ accountId, accountName }) => {
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

    const priorCheckpointResponse = await page.evaluate(async ({ accountId }) => {
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

    const preview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("outside-period certified match stays a conflict when the immediate previous checkpoint is not matched", async ({ page }) => {
    const accountName = `Playwright Outside Period Conflict ${Date.now()}`;
    const createPayload = await postJson(page, "/api/accounts/create", {
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

    const commitResponse = await page.evaluate(async ({ accountId, accountName }) => {
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

    const previousCheckpointResponse = await page.evaluate(async ({ accountId }) => {
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

    const preview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("user can explicitly include a certified PDF duplicate and keep it included on refresh", async ({ page }) => {
    const accountName = `Playwright Explicit Conflict Include ${Date.now()}`;
    const createPayload = await postJson(page, "/api/accounts/create", {
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

    const commitResponse = await page.evaluate(async ({ accountId, accountName }) => {
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

    const conflictPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

    const includedPreview = await page.evaluate(async ({ accountId, accountName }) => {
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

  test("wrong-card remap stays mismatched and does not resolve the certified row", async ({ page }) => {
    const createAccount = async (name) => {
      const result = await postJson(page, "/api/accounts/create", {
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

    const commitResponse = await page.evaluate(async ({ row }) => {
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

    const preview = await page.evaluate(async ({ wrongAccountId, wrongAccountName }) => {
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

  test("multi-card statements reconcile while certifying growing midcycle rows", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const importFlowPage = await page.context().newPage();

    const createAccount = async (name, openingBalanceMinor) => {
      const result = await postJson(page, "/api/accounts/create", {
        name,
        institution: "Synthetic Test Bank",
        kind: "credit_card",
        currency: "SGD",
        openingBalanceMinor,
        isJoint: true
      });
      return result.accountId;
    };

    const alphaAccount = {
      id: await createAccount("Playwright Alpha Card", 10_000),
      name: "Playwright Alpha Card",
      detectedName: "Synthetic Card Alpha",
      heading: "SYNTHETIC CARD ALPHA",
      cardNumber: "1111-2222-3333-4444"
    };
    const betaAccount = {
      id: await createAccount("Playwright Beta Card", 20_000),
      name: "Playwright Beta Card",
      detectedName: "Synthetic Card Beta",
      heading: "SYNTHETIC CARD BETA",
      cardNumber: "5555-6666-7777-8888"
    };

    const janAlphaRows = [
      { postDate: "05 JAN", transactionDate: "04 JAN", description: "ALPHA JAN COFFEE", reference: "JAN-A1", amountMinor: 1_000 },
      { postDate: "10 JAN", transactionDate: "09 JAN", description: "ALPHA JAN GROCERIES", reference: "JAN-A2", amountMinor: 2_000 }
    ];
    const janBetaRows = [
      { postDate: "06 JAN", transactionDate: "05 JAN", description: "BETA JAN DINING", reference: "JAN-B1", amountMinor: 1_500 },
      { postDate: "12 JAN", transactionDate: "11 JAN", description: "BETA JAN TAXI", reference: "JAN-B2", amountMinor: 2_500 }
    ];
    const febAlphaRows = [
      { date: "2026-02-03", postDate: "03 FEB", transactionDate: "02 FEB", description: "ALPHA FEB COFFEE", reference: "FEB-A1", expenseMinor: 500, category: "Food & Drinks" },
      { date: "2026-02-11", postDate: "11 FEB", transactionDate: "10 FEB", description: "ALPHA FEB GROCERIES", reference: "FEB-A2", expenseMinor: 700, category: "Groceries" },
      { date: "2026-02-22", postDate: "22 FEB", transactionDate: "21 FEB", description: "ALPHA FEB TAXI", reference: "FEB-A3", expenseMinor: 900, category: "Taxi" }
    ];
    const febBetaRows = [
      { date: "2026-02-04", postDate: "04 FEB", transactionDate: "03 FEB", description: "BETA FEB DINING", reference: "FEB-B1", expenseMinor: 1_100, category: "Food & Drinks" },
      { date: "2026-02-09", postDate: "09 FEB", transactionDate: "08 FEB", description: "BETA FEB GROCERIES", reference: "FEB-B2", expenseMinor: 1_300, category: "Groceries" },
      { date: "2026-02-18", postDate: "18 FEB", transactionDate: "17 FEB", description: "BETA FEB PLAYSTATION", reference: "FEB-B3", expenseMinor: 1_700, category: "Entertainment" },
      { date: "2026-02-24", postDate: "24 FEB", transactionDate: "23 FEB", description: "BETA FEB BUS", reference: "FEB-B4", expenseMinor: 1_900, category: "Public Transport" }
    ];
    const lateStatementOnlyRow = {
      date: "2026-02-27",
      postDate: "27 FEB",
      transactionDate: "26 FEB",
      description: "ALPHA FEB LATE FEE",
      reference: "FEB-A4",
      expenseMinor: 400,
      category: "Fees"
    };

    const janPdfPath = testInfo.outputPath("synthetic-uob-two-card-jan-2026.pdf");
    const febPdfPath = testInfo.outputPath("synthetic-uob-two-card-feb-2026.pdf");
    await writeTextPdf(page, janPdfPath, buildSyntheticUobCardStatement({
      statementDate: "31 JAN 2026",
      sections: [
        {
          heading: alphaAccount.heading,
          cardNumber: alphaAccount.cardNumber,
          previousBalanceMinor: 10_000,
          totalBalanceMinor: 13_000,
          rows: janAlphaRows.map((row) => ({ ...row, amountMinor: row.amountMinor }))
        },
        {
          heading: betaAccount.heading,
          cardNumber: betaAccount.cardNumber,
          previousBalanceMinor: 20_000,
          totalBalanceMinor: 24_000,
          rows: janBetaRows.map((row) => ({ ...row, amountMinor: row.amountMinor }))
        }
      ]
    }));
    await writeTextPdf(page, febPdfPath, buildSyntheticUobCardStatement({
      statementDate: "28 FEB 2026",
      sections: [
        {
          heading: alphaAccount.heading,
          cardNumber: alphaAccount.cardNumber,
          previousBalanceMinor: 13_000,
          totalBalanceMinor: 15_500,
          rows: [...febAlphaRows, lateStatementOnlyRow].map((row) => ({ ...row, amountMinor: row.expenseMinor }))
        },
        {
          heading: betaAccount.heading,
          cardNumber: betaAccount.cardNumber,
          previousBalanceMinor: 24_000,
          totalBalanceMinor: 30_000,
          rows: febBetaRows.map((row) => ({ ...row, amountMinor: row.expenseMinor }))
        }
      ]
    }));

    const screenshot = async (name) => {
      if (!process.env.CAPTURE_IMPORT_FLOW_SCREENSHOTS) {
        return;
      }
      await importFlowPage.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    };

    const mapDetectedAccounts = async () => {
      const remapAccount = async (detectedName, targetId, alternateId) => {
        const row = importFlowPage.locator(".statement-account-map-row").filter({ hasText: `Detected: ${detectedName}` });
        const combobox = row.getByRole("combobox");
        const currentValue = await combobox.inputValue();

        if (currentValue === targetId) {
          await combobox.selectOption(alternateId);
          await expect(combobox).toHaveValue(alternateId);
        }

        await expect(combobox.locator(`option[value="${targetId}"]`)).toHaveCount(1);
        await combobox.selectOption(targetId);
        await expect(combobox).toHaveValue(targetId);
      };

      await remapAccount(alphaAccount.detectedName, alphaAccount.id, betaAccount.id);
      await remapAccount(betaAccount.detectedName, betaAccount.id, alphaAccount.id);
      await expect(importFlowPage.locator(".statement-reconciliation-row .pill.success")).toHaveCount(2);
    };

    const uploadPdfAndMap = async (path) => {
      await importFlowPage.goto("/imports?view=person-tim&month=2026-02");
      await expect(importFlowPage.getByRole("heading", { name: "Import and certify" })).toBeVisible({ timeout: 30_000 });
      await expect(importFlowPage.getByLabel("Source label")).toBeVisible({ timeout: 30_000 });
      const fileInput = importFlowPage.locator("input[type=\"file\"]");
      await fileInput.setInputFiles(path);
      await expect(importFlowPage.getByText("Unknown accounts need mapping before commit.")).toBeVisible();
      await mapDetectedAccounts();
    };

    const commitCurrentPreview = async () => {
      await expect(importFlowPage.getByRole("button", { name: /Commit import/ }).first()).toBeEnabled();
      await importFlowPage.getByRole("button", { name: /Commit import/ }).first().click();
      await expect(importFlowPage.getByText("No preview yet.").first()).toBeVisible();
    };

    await uploadPdfAndMap(janPdfPath);
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: alphaAccount.name }).locator(".pill.success")).toBeVisible();
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: betaAccount.name }).locator(".pill.success")).toBeVisible();
    await screenshot("01-jan-two-card-pdf-mapped-and-matched");
    await commitCurrentPreview();

    await uploadPdfAndMap(janPdfPath);
    await expect(importFlowPage.getByText("2 statement checkpoints will refresh").first()).toBeVisible();
    await expect(importFlowPage.getByText("This statement has no transaction rows. Only the statement checkpoint will be saved.").first()).toBeVisible();
    await expect(importFlowPage.getByRole("button", { name: "Save empty statement checkpoint" }).first()).toBeEnabled();
    await screenshot("02-jan-two-card-pdf-all-duplicates-save-checkpoints");
    await importFlowPage.getByRole("button", { name: "Save empty statement checkpoint" }).first().click();
    await expect(importFlowPage.getByText("No preview yet.").first()).toBeVisible();

    const midcycleRows = [
      ...febAlphaRows.map((row) => ({ ...row, account: alphaAccount.name, note: "synthetic growing midcycle" })),
      ...febBetaRows.map((row) => ({ ...row, account: betaAccount.name, note: "synthetic growing midcycle" }))
    ];
    const provisionalAlphaGroceries = midcycleRows.find((row) => row.reference === "FEB-A2");
    provisionalAlphaGroceries.date = "2026-02-10";
    provisionalAlphaGroceries.description = "ALPHA FEB GROCERIES TEMP";
    provisionalAlphaGroceries.note = "user picked groceries during mid-cycle cleanup";
    const sortedMidcycleRows = [
      midcycleRows.find((row) => row.reference === "FEB-A1"),
      midcycleRows.find((row) => row.reference === "FEB-B1"),
      midcycleRows.find((row) => row.reference === "FEB-B2"),
      midcycleRows.find((row) => row.reference === "FEB-A2"),
      midcycleRows.find((row) => row.reference === "FEB-B3"),
      midcycleRows.find((row) => row.reference === "FEB-A3"),
      midcycleRows.find((row) => row.reference === "FEB-B4")
    ].filter(Boolean);

    const previewCsvSnapshot = async (label, rows, expectedImportCount, expectedSkipCount) => {
      await importFlowPage.goto("/imports?view=person-tim&month=2026-02");
      await expect(importFlowPage.getByRole("heading", { name: "Import and certify" })).toBeVisible({ timeout: 30_000 });
      await importFlowPage.getByLabel("Source label").fill(label);
      await importFlowPage.getByLabel("CSV content").fill(csvFromRows(rows));
      await importFlowPage.getByRole("button", { name: "Preview import" }).click();
      await expect(importFlowPage.getByText(`${expectedImportCount} row${expectedImportCount === 1 ? "" : "s"} will import`)).toBeVisible();
      if (expectedSkipCount) {
        await expect(importFlowPage.getByText(`${expectedSkipCount} row${expectedSkipCount === 1 ? "" : "s"} already covered`).first()).toBeVisible();
        await importFlowPage.locator("details.import-skipped-rows summary").click();
      }
      await screenshot(label.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    };

    await previewCsvSnapshot("03-midcycle-snapshot-1", sortedMidcycleRows.slice(0, 3), 3, 0);
    await commitCurrentPreview();

    await previewCsvSnapshot("04-midcycle-snapshot-2", sortedMidcycleRows.slice(0, 5), 2, 3);
    await commitCurrentPreview();

    await previewCsvSnapshot("05-midcycle-snapshot-3", sortedMidcycleRows, 2, 5);
    await commitCurrentPreview();

    await previewCsvSnapshot("06-final-csv-all-midcycle-duplicates", sortedMidcycleRows, 0, 7);

    await uploadPdfAndMap(febPdfPath);
    await expect(importFlowPage.getByText("1 row will import").first()).toBeVisible();
    await expect(importFlowPage.getByText("7 existing rows will be certified by the statement").first()).toBeVisible();
    const lateStatementOnlyDescription = importFlowPage.locator(`input[value="${lateStatementOnlyRow.description}"]`);
    await expect(lateStatementOnlyDescription).toBeVisible();
    const lateStatementOnlyPreviewRow = lateStatementOnlyDescription.locator("xpath=ancestor::tr[1]");
    await expect(importFlowPage.locator(".statement-reconciliation-row .pill.success")).toHaveCount(2);
    await screenshot("07-feb-two-card-pdf-duplicates-plus-late-row-matched");

    await lateStatementOnlyPreviewRow.getByRole("button", { name: "Exclude row" }).click();
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: alphaAccount.name }).locator(".pill.warning")).toBeVisible();
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: betaAccount.name }).locator(".pill.success")).toBeVisible();
    await importFlowPage.locator("details.import-skipped-rows summary").click();
    await expect(importFlowPage.locator("details.import-skipped-rows").locator(`input[value="${lateStatementOnlyRow.description}"]`)).toBeVisible();
    await screenshot("08-user-skipped-late-row-alpha-check-fails");

    await importFlowPage.getByRole("button", { name: "Refresh check" }).click();
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: alphaAccount.name }).locator(".pill.warning")).toBeVisible();
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: betaAccount.name }).locator(".pill.success")).toBeVisible();
    await expect(importFlowPage.locator("details.import-skipped-rows").locator(`input[value="${lateStatementOnlyRow.description}"]`)).toBeVisible();

    await importFlowPage.locator("details.import-skipped-rows").locator(`input[value="${lateStatementOnlyRow.description}"]`).locator("xpath=ancestor::tr[1]").getByRole("button", { name: "Include row" }).click();
    await expect(importFlowPage.locator(".statement-reconciliation-row .pill.success")).toHaveCount(2);
    await expect(importFlowPage.locator(`input[value="${lateStatementOnlyRow.description}"]`)).toBeVisible();
    await screenshot("09-user-restored-late-row-both-checks-match");

    await commitCurrentPreview();
    const afterStatement = await loadEntriesPage(page, { view: "household", month: "2026-02" });
    const alphaGroceriesEntry = afterStatement.monthPage.entries.find((entry) => (
      entry.accountName === alphaAccount.name
      && entry.description === "ALPHA FEB GROCERIES"
    ));
    expect(alphaGroceriesEntry, JSON.stringify(afterStatement.monthPage.entries)).toBeTruthy();
    expect(alphaGroceriesEntry.note).toBe("user picked groceries during mid-cycle cleanup");
    const lockedBankFactEdit = await page.evaluate(async ({ entry }) => {
      const response = await fetch("/api/entries/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: entry.id,
          date: entry.date,
          description: `${entry.description} MANUAL FIX`,
          accountId: entry.accountId,
          categoryName: entry.categoryName,
          amountMinor: entry.amountMinor,
          entryType: entry.entryType,
          transferDirection: entry.transferDirection,
          ownershipType: entry.ownershipType,
          ownerName: entry.ownerName,
          note: entry.note,
          splitBasisPoints: entry.viewerSplitRatioBasisPoints ?? 10000
        })
      });
      return { ok: response.ok, text: await response.text() };
    }, { entry: alphaGroceriesEntry });
    expect(lockedBankFactEdit.ok, lockedBankFactEdit.text).toBeFalsy();
    expect(lockedBankFactEdit.text).toContain("bank facts are locked");

    const annotationOnlyEdit = await page.evaluate(async ({ entry }) => {
      const response = await fetch("/api/entries/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: entry.id,
          date: entry.date,
          description: entry.description,
          accountId: entry.accountId,
          categoryName: entry.categoryName,
          amountMinor: entry.amountMinor,
          entryType: entry.entryType,
          transferDirection: entry.transferDirection,
          ownershipType: entry.ownershipType,
          ownerName: entry.ownerName,
          note: "post-close user annotation still editable",
          splitBasisPoints: entry.viewerSplitRatioBasisPoints ?? 10000
        })
      });
      return { ok: response.ok, text: await response.text() };
    }, { entry: alphaGroceriesEntry });
    expect(annotationOnlyEdit.ok, annotationOnlyEdit.text).toBeTruthy();
    const importsPage = await page.evaluate(async () => {
      const response = await fetch("/api/imports-page");
      return response.json();
    });
    const statementImport = importsPage.importsPage.recentImports.find((item) => item.sourceLabel === "synthetic-uob-two-card-feb-2026");
    expect(statementImport?.statementCertificateCount).toBe(2);
    expect(statementImport?.statementCertificateStatus).toBe("certified");
    await importFlowPage.goto("/imports?view=person-tim&month=2026-02");
    await expect(importFlowPage.getByRole("heading", { name: "Recent imports" })).toBeVisible();
    await importFlowPage.getByRole("button", { name: /Recent imports/ }).click();
    await screenshot("10-recent-imports-after-combined-flow");
  });
});
