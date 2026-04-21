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
    await expect(page.getByRole("button", { name: "Oct 2025" }).first()).toBeVisible();
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

  test("statement preview can certify midcycle rows and still save the checkpoint", async ({ page }) => {
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
    expect(preview.json.preview.previewRows[0].statementCertificationTargetTransactionId).toBeTruthy();
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

    const after = await loadBootstrap(page, { month: "2025-10" });
    const afterAccount = after.accounts.find((item) => item.id === account.id);
    expect(afterAccount?.latestCheckpointMonth).toBe("2025-10");
    expect(Number.isFinite(afterAccount?.latestCheckpointDeltaMinor)).toBeTruthy();
  });

  test("statement balance can certify a near-match provisional row", async ({ page }) => {
    const bootstrap = await loadBootstrap(page, { month: "2025-08" });
    const account = bootstrap.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
    expect(account).toBeTruthy();

    const existingRow = {
      rowId: "near-match-existing",
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
      expense: "2.48",
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
    expect(mismatchedPreview.json.preview.previewRows[0].statementCertificationTargetTransactionId).toBeTruthy();
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
    expect(resolvedPreview.json.preview.previewRows[0].statementCertificationTargetTransactionId).toBeTruthy();
    expect(resolvedPreview.json.preview.previewRows[0].duplicateMatches).toBeUndefined();
    expect(resolvedPreview.json.preview.duplicateCandidateCount).toBe(0);
    expect(resolvedPreview.json.preview.statementReconciliations[0].status).toBe("matched");
  });

  test("multi-card statements reconcile while certifying growing midcycle rows", async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    const createAccount = async (name, openingBalanceMinor) => {
      const result = await page.evaluate(async ({ name, openingBalanceMinor }) => {
        const response = await fetch("/api/accounts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            institution: "Synthetic Test Bank",
            kind: "credit_card",
            currency: "SGD",
            openingBalanceMinor,
            isJoint: true
          })
        });
        return { ok: response.ok, json: await response.json() };
      }, { name, openingBalanceMinor });
      expect(result.ok, JSON.stringify(result.json)).toBeTruthy();
      return result.json.accountId;
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
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    };

    const mapDetectedAccounts = async () => {
      await page
        .locator(".statement-account-map-row")
        .filter({ hasText: `Detected: ${alphaAccount.detectedName}` })
        .getByRole("combobox")
        .selectOption(alphaAccount.id);
      await expect(page.locator(".statement-account-map-row").filter({ hasText: `Detected: ${alphaAccount.detectedName}` }).getByRole("combobox")).toHaveValue(alphaAccount.id);

      await page
        .locator(".statement-account-map-row")
        .filter({ hasText: `Detected: ${betaAccount.detectedName}` })
        .getByRole("combobox")
        .selectOption(betaAccount.id);
      await expect(page.locator(".statement-account-map-row").filter({ hasText: `Detected: ${betaAccount.detectedName}` }).getByRole("combobox")).toHaveValue(betaAccount.id);
      await expect(page.locator(".statement-reconciliation-row .pill.success")).toHaveCount(2);
    };

    const uploadPdfAndMap = async (path) => {
      await page.goto("/imports?view=person-tim&month=2026-02");
      await page.locator("input[type=\"file\"]").setInputFiles(path);
      await expect(page.getByText("Unknown accounts need mapping before commit.")).toBeVisible();
      await mapDetectedAccounts();
    };

    const commitCurrentPreview = async () => {
      await expect(page.getByRole("button", { name: /Commit import/ }).first()).toBeEnabled();
      await page.getByRole("button", { name: /Commit import/ }).first().click();
      await expect(page.getByText("No preview yet.").first()).toBeVisible();
    };

    await uploadPdfAndMap(janPdfPath);
    await expect(page.locator(".statement-reconciliation-row").filter({ hasText: alphaAccount.name }).locator(".pill.success")).toBeVisible();
    await expect(page.locator(".statement-reconciliation-row").filter({ hasText: betaAccount.name }).locator(".pill.success")).toBeVisible();
    await screenshot("01-jan-two-card-pdf-mapped-and-matched");
    await commitCurrentPreview();

    await uploadPdfAndMap(janPdfPath);
    await expect(page.getByText("4 rows already covered").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save statement checkpoints" }).first()).toBeEnabled();
    await screenshot("02-jan-two-card-pdf-all-duplicates-save-checkpoints");
    await page.getByRole("button", { name: "Save statement checkpoints" }).first().click();
    await expect(page.getByText("No preview yet.").first()).toBeVisible();

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
      await page.goto("/imports?view=person-tim&month=2026-02");
      await page.getByLabel("Source label").fill(label);
      await page.getByLabel("CSV content").fill(csvFromRows(rows));
      await page.getByRole("button", { name: "Preview import" }).click();
      await expect(page.getByText(`${expectedImportCount} row${expectedImportCount === 1 ? "" : "s"} will import`)).toBeVisible();
      if (expectedSkipCount) {
        await expect(page.getByText(`${expectedSkipCount} row${expectedSkipCount === 1 ? "" : "s"} already covered`).first()).toBeVisible();
        await page.locator("details.import-skipped-rows summary").click();
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
    await expect(page.getByText("1 row will import").first()).toBeVisible();
    await expect(page.getByText("7 existing rows will be certified by the statement").first()).toBeVisible();
    const lateStatementOnlyDescription = page.locator(`input[value="${lateStatementOnlyRow.description}"]`);
    await expect(lateStatementOnlyDescription).toBeVisible();
    const lateStatementOnlyPreviewRow = lateStatementOnlyDescription.locator("xpath=ancestor::tr[1]");
    await expect(page.locator(".statement-reconciliation-row .pill.success")).toHaveCount(2);
    await screenshot("07-feb-two-card-pdf-duplicates-plus-late-row-matched");

    await lateStatementOnlyPreviewRow.getByRole("button", { name: "Exclude row" }).click();
    await expect(page.locator(".statement-reconciliation-row").filter({ hasText: alphaAccount.name }).locator(".pill.warning")).toBeVisible();
    await expect(page.locator(".statement-reconciliation-row").filter({ hasText: betaAccount.name }).locator(".pill.success")).toBeVisible();
    await page.locator("details.import-skipped-rows summary").click();
    await expect(page.locator("details.import-skipped-rows").locator(`input[value="${lateStatementOnlyRow.description}"]`)).toBeVisible();
    await screenshot("08-user-skipped-late-row-alpha-check-fails");

    await page.locator("details.import-skipped-rows").locator(`input[value="${lateStatementOnlyRow.description}"]`).locator("xpath=ancestor::tr[1]").getByRole("button", { name: "Include row" }).click();
    await expect(page.locator(".statement-reconciliation-row .pill.success")).toHaveCount(2);
    await expect(page.locator(`input[value="${lateStatementOnlyRow.description}"]`)).toBeVisible();
    await screenshot("09-user-restored-late-row-both-checks-match");

    await commitCurrentPreview();
    const afterStatement = await loadBootstrap(page, { month: "2026-02" });
    const alphaGroceriesEntry = findView(afterStatement, "household").monthPage.entries.find((entry) => (
      entry.accountName === alphaAccount.name
      && entry.description === "ALPHA FEB GROCERIES"
    ));
    expect(alphaGroceriesEntry, JSON.stringify(findView(afterStatement, "household").monthPage.entries)).toBeTruthy();
    expect(alphaGroceriesEntry.note).toBe("user picked groceries during mid-cycle cleanup");
    await expect(page.getByRole("heading", { name: "Recent imports" })).toBeVisible();
    await page.getByRole("button", { name: /Recent imports/ }).click();
    await screenshot("10-recent-imports-after-combined-flow");
  });
});
