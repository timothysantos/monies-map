import { expect, test } from "@playwright/test";
const currencyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

function findView(data, id) {
  const view = data.views.find((item) => item.id === id);
  if (!view) {
    throw new Error(`View not found: ${id}`);
  }
  return view;
}

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
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/demo/reseed", { method: "POST" });
    return { ok: response.ok, status: response.status, text: await response.text() };
  });
  expect(result.ok, result.text).toBeTruthy();
}

async function loadBootstrap(page, { month = "2025-10", scope = "direct_plus_shared" } = {}) {
  return page.evaluate(async ({ month, scope }) => {
    const response = await fetch(`/api/bootstrap?month=${month}&scope=${scope}`);
    if (!response.ok) {
      throw new Error(`Bootstrap failed: ${response.status}`);
    }
    return response.json();
  }, { month, scope });
}

function formatMoney(minor) {
  return currencyFormatter.format(minor / 100);
}

test.describe("import flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("preview flags unknown accounts from the CSV input", async ({ page }) => {
    await page.goto("/imports?view=person-tim&month=2025-10");

    await page.getByLabel("CSV content").fill(
      [
        "date,description,amount,account,category,note",
        "2025-10-08,Playwright unknown account,-42.00,Imaginary Wallet,Food & Drinks,Should require account mapping."
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview import" }).click();

    await expect(page.getByText("Unknown accounts need mapping before commit.")).toBeVisible();
    await expect(page.getByText("Detected: Imaginary Wallet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Commit import" }).first()).toBeDisabled();
  });

  test("expense and income headers auto-map without manual mapping", async ({ page }) => {
    await page.goto("/imports?view=person-tim&month=2025-10");

    await page.getByLabel("CSV content").fill(
      [
        "date,description,expense,income,account,category,note,type",
        "2026-01-02,Funds Transfer JOYCE,450.00,,UOB One,Other,,expense",
        "2026-01-03,One Bonus Interest,,20.36,UOB One,Income,,income"
      ].join("\n")
    );

    await expect(page.getByText("Missing required fields: amount/expense/income")).toHaveCount(0);
    await expect(page.locator("article").filter({ hasText: /^expenseSample rows/ }).getByRole("combobox")).toHaveValue("expense");
    await expect(page.locator("article").filter({ hasText: /^incomeSample rows/ }).getByRole("combobox")).toHaveValue("income");
    await expect(page.getByRole("button", { name: "Preview import" })).toBeEnabled();
  });

  test("imported row can be edited and rolls through entries, month, and summary", async ({ page }) => {
    const before = await loadBootstrap(page);
    const beforeView = findView(before, "person-tim");
    const beforeMonth = findSummaryMonth(beforeView, "2025-10");
    const beforeFoodDonut = findDonutMonthValue(beforeView, "2025-10", "Food & Drinks");

    await page.goto("/imports?view=person-tim&month=2025-10");

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

    await expect(entryRow.locator(".entry-row-description strong").filter({ hasText: "Playwright groceries import" })).toBeVisible();

    const after = await loadBootstrap(page);
    const afterView = findView(after, "person-tim");
    const afterMonth = findSummaryMonth(afterView, "2025-10");
    const afterFoodDonut = findDonutMonthValue(afterView, "2025-10", "Food & Drinks");
    const afterActualSpend = afterView.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor ?? 0;

    expect(afterActualSpend).toBe(
      (beforeView.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor ?? 0) + 11_111
    );
    expect(afterMonth.realExpensesMinor).toBe(beforeMonth.realExpensesMinor + 11_111);
    expect(afterFoodDonut).toBe(beforeFoodDonut + 11_111);

    await page.goto("/month?view=person-tim&month=2025-10");
    await expect(page.locator("strong").filter({ hasText: formatMoney(afterActualSpend) }).first()).toBeVisible();

    await page.goto("/summary?view=person-tim&month=2025-10");
    await expect(page.getByRole("button", { name: "Oct 2025" })).toBeVisible();
    await expect(page.locator("strong").filter({ hasText: formatMoney(afterMonth.realExpensesMinor) }).first()).toBeVisible();
  });

  test("summary and month stay aligned across tabs after persisted changes", async ({ browser, page }) => {
    const context = page.context();
    const summaryPage = page;
    const importsPage = await context.newPage();
    const monthPage = await context.newPage();

    await summaryPage.goto("/summary?view=person-tim&month=2025-10&summary_focus=2025-10");
    await monthPage.goto("/month?view=person-tim&month=2025-10");
    await importsPage.goto("/imports?view=person-tim&month=2025-10");

    const before = await loadBootstrap(summaryPage);
    const beforeView = findView(before, "person-tim");
    const beforeMonth = findSummaryMonth(beforeView, "2025-10");
    const expectedAfterActual = beforeMonth.realExpensesMinor + 22_22;

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
    await expect(summaryPage.locator("strong").filter({ hasText: expectedLabel }).first()).toBeVisible({ timeout: 10000 });
    await expect(monthPage.locator("strong").filter({ hasText: expectedLabel }).first()).toBeVisible({ timeout: 10000 });

    const after = await loadBootstrap(summaryPage);
    const afterView = findView(after, "person-tim");
    const afterMonth = findSummaryMonth(afterView, "2025-10");
    const monthActualCard = afterView.monthPage.metricCards.find((item) => item.label === "Actual spend");

    expect(afterMonth.realExpensesMinor).toBe(expectedAfterActual);
    expect(monthActualCard?.amountMinor).toBe(expectedAfterActual);

    await importsPage.close();
    await monthPage.close();
  });

  test("statement preview can skip midcycle duplicates and still save the checkpoint", async ({ page }) => {
    const bootstrap = await loadBootstrap(page, { month: "2025-10" });
    const account = bootstrap.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
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
    expect(preview.json.preview.previewRows[0].commitStatus).toBe("skipped");
    expect(preview.json.preview.previewRows[0].duplicateMatches[0].matchKind).toBe("exact");
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

    const after = await loadBootstrap(page, { month: "2025-10" });
    const afterAccount = after.accounts.find((item) => item.id === account.id);
    expect(afterAccount?.latestCheckpointMonth).toBe("2025-10");
    expect(Number.isFinite(afterAccount?.latestCheckpointDeltaMinor)).toBeTruthy();
  });

  test("growing midcycle exports only commit new rows before final statement checkpoint", async ({ page }) => {
    const bootstrap = await loadBootstrap(page, { month: "2025-11" });
    const account = bootstrap.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
    expect(account).toBeTruthy();

    const statementRows = [
      {
        date: "2025-11-03",
        description: "Playwright growing export coffee",
        expense: "6.10",
        accountId: account.id,
        account: account.name,
        category: "Food & Drinks"
      },
      {
        date: "2025-11-08",
        description: "Playwright growing export groceries",
        expense: "42.35",
        accountId: account.id,
        account: account.name,
        category: "Groceries"
      },
      {
        date: "2025-11-18",
        description: "Playwright growing export taxi",
        expense: "18.90",
        accountId: account.id,
        account: account.name,
        category: "Taxi"
      }
    ];

    const previewAndCommitNewRows = async (snapshotRows, snapshotLabel, expectedSkippedCount, expectedIncludedCount) => {
      const preview = await page.evaluate(async ({ rows, accountName }) => {
        const response = await fetch("/api/imports/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceLabel: "Playwright growing midcycle XLS",
            rows,
            defaultAccountName: accountName,
            ownershipType: "direct",
            ownerName: "Tim",
            statementCheckpoints: []
          })
        });
        return { ok: response.ok, json: await response.json() };
      }, { rows: snapshotRows, accountName: account.name });

      expect(preview.ok, JSON.stringify(preview.json)).toBeTruthy();
      const previewRows = preview.json.preview.previewRows;
      const skippedRows = previewRows.filter((row) => row.commitStatus === "skipped");
      const includedRows = previewRows.filter((row) => row.commitStatus === "included" || !row.commitStatus);

      expect(skippedRows).toHaveLength(expectedSkippedCount);
      expect(includedRows).toHaveLength(expectedIncludedCount);
      for (const row of skippedRows) {
        expect(row.duplicateMatches?.[0]?.matchKind).toBe("exact");
      }

      if (!includedRows.length) {
        return;
      }

      const commit = await page.evaluate(async ({ label, rows }) => {
        const response = await fetch("/api/imports/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceLabel: label,
            sourceType: "csv",
            parserKey: "uob_current_xls",
            rows,
            statementCheckpoints: []
          })
        });
        return { ok: response.ok, text: await response.text() };
      }, { label: snapshotLabel, rows: includedRows });
      expect(commit.ok, commit.text).toBeTruthy();
    };

    await previewAndCommitNewRows(statementRows.slice(0, 1), "Playwright midcycle snapshot 1", 0, 1);
    await previewAndCommitNewRows(statementRows.slice(0, 2), "Playwright midcycle snapshot 2", 1, 1);
    await previewAndCommitNewRows(statementRows.slice(0, 3), "Playwright midcycle snapshot 3", 2, 1);

    const statementCheckpoints = [{
      accountId: account.id,
      accountName: account.name,
      detectedAccountName: account.name,
      checkpointMonth: "2025-11",
      statementStartDate: "2025-11-01",
      statementEndDate: "2025-11-30",
      statementBalanceMinor: 0,
      note: "Playwright growing export statement checkpoint"
    }];

    const finalPreviewWithMismatchedCheckpoint = await page.evaluate(async ({ rows, accountName, statementCheckpoints }) => {
      const response = await fetch("/api/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLabel: "Playwright final monthly PDF",
          rows,
          defaultAccountName: accountName,
          ownershipType: "direct",
          ownerName: "Tim",
          statementCheckpoints
        })
      });
      return { ok: response.ok, json: await response.json() };
    }, { rows: statementRows, accountName: account.name, statementCheckpoints });

    expect(finalPreviewWithMismatchedCheckpoint.ok, JSON.stringify(finalPreviewWithMismatchedCheckpoint.json)).toBeTruthy();
    const projectedBalanceMinor = finalPreviewWithMismatchedCheckpoint.json.preview.statementReconciliations[0].projectedLedgerBalanceMinor;
    expect(Number.isFinite(projectedBalanceMinor)).toBeTruthy();
    const matchingStatementCheckpoints = [{
      ...statementCheckpoints[0],
      statementBalanceMinor: account.kind === "credit_card" ? -projectedBalanceMinor : projectedBalanceMinor
    }];

    const finalPreview = await page.evaluate(async ({ rows, accountName, statementCheckpoints }) => {
      const response = await fetch("/api/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLabel: "Playwright final monthly PDF",
          rows,
          defaultAccountName: accountName,
          ownershipType: "direct",
          ownerName: "Tim",
          statementCheckpoints
        })
      });
      return { ok: response.ok, json: await response.json() };
    }, { rows: statementRows, accountName: account.name, statementCheckpoints: matchingStatementCheckpoints });

    expect(finalPreview.ok, JSON.stringify(finalPreview.json)).toBeTruthy();
    expect(finalPreview.json.preview.previewRows).toHaveLength(3);
    expect(finalPreview.json.preview.previewRows.every((row) => row.commitStatus === "skipped")).toBeTruthy();
    expect(finalPreview.json.preview.previewRows.every((row) => row.duplicateMatches?.[0]?.matchKind === "exact")).toBeTruthy();
    expect(
      finalPreview.json.preview.statementReconciliations[0].status,
      JSON.stringify(finalPreview.json.preview.statementReconciliations[0])
    ).toBe("matched");

    const checkpointOnlyCommit = await page.evaluate(async ({ statementCheckpoints }) => {
      const response = await fetch("/api/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLabel: "Playwright final monthly PDF checkpoint",
          sourceType: "pdf",
          parserKey: "uob_credit_card_pdf",
          rows: [],
          statementCheckpoints
        })
      });
      return { ok: response.ok, text: await response.text() };
    }, { statementCheckpoints: matchingStatementCheckpoints });
    expect(checkpointOnlyCommit.ok, checkpointOnlyCommit.text).toBeTruthy();
  });
});
