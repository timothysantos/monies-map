import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const currencyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const HSBC_2026_CASES = [
  {
    month: "feb",
    routeMonth: "2026-02",
    readyText: "0 rows ready for review",
    values: []
  },
  {
    month: "mar",
    routeMonth: "2026-03",
    readyText: "2 rows ready for review",
    values: [
      "2026-02-23",
      "IKEA SINGAPORE SG",
      "683.00",
      "txn date: 2026-02-20",
      "2026-03-04",
      "PAYMENT VIA UOB VISA DIRECT SG",
      "683.00",
      "txn date: 2026-03-03"
    ]
  },
  {
    month: "apr",
    routeMonth: "2026-04",
    readyText: "2 rows ready for review",
    values: [
      "2026-03-09",
      "IKEA - ONLINE SINGAPORE",
      "117.80",
      "txn date: 2026-03-06",
      "2026-04-04",
      "PAYMENT VIA UOB VISA DIRECT SG",
      "117.80",
      "txn date: 2026-04-02"
    ]
  },
  {
    month: "may",
    routeMonth: "2026-05",
    readyText: "2 rows ready for review",
    values: [
      "2026-05-04",
      "IKEA SINGAPORE SG",
      "157.20",
      "txn date: 2026-05-01",
      "2026-05-05",
      "PAYMENT VIA UOB VISA DIRECT SG",
      "157.20",
      "txn date: 2026-05-04"
    ]
  },
  {
    month: "jun",
    routeMonth: "2026-06",
    readyText: "0 rows ready for review",
    values: []
  },
  {
    month: "jul",
    routeMonth: "2026-07",
    readyText: "0 rows ready for review",
    values: []
  }
];

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

async function createHsbcVisaRevolutionAccount(page) {
  await postJson(page, "/api/accounts/create", {
    name: "HSBC Visa Revolution",
    institution: "HSBC",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
}

async function createCitiRewardsAccount(page) {
  await postJson(page, "/api/accounts/create", {
    name: "Citi Rewards",
    institution: "Citibank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
}

async function expectHsbcPreviewValues(page, expectedValues) {
  await expect(page.getByText("Unknown accounts need mapping before commit.")).toHaveCount(0);
  const previewValues = await page
    .locator(".import-preview-table input")
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(previewValues).toEqual(expectedValues);
}

async function loadEntriesPage(page, { view = "person-tim", month = "2025-10" } = {}) {
  const response = await page.request.get(`/api/entries-page?view=${view}&month=${month}`);
  if (!response.ok()) {
    throw new Error(`Entries page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function loadReferenceData(page) {
  const response = await page.request.get("/api/reference-data");
  if (!response.ok()) {
    throw new Error(`Reference data failed: ${response.status()} ${await response.text()}`);
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

async function loadImportsPage(page) {
  const response = await page.request.get("/api/imports-page");
  if (!response.ok()) {
    throw new Error(`Imports page failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function gotoImportsPage(page, month = "2025-10") {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const importsPageReady = page.waitForResponse((response) => (
        response.url().includes("/api/imports-page") && response.ok()
      ), { timeout: 30_000 });
      await page.goto(`/imports?view=person-tim&month=${month}`, { waitUntil: "domcontentloaded" });
      await importsPageReady;
      await page.getByLabel("Source label").waitFor({ state: "visible", timeout: 15_000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Imports page did not become ready.");
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

async function writeHsbcImagePdf(page, path) {
  const pdfPage = await page.context().newPage();
  await pdfPage.setViewportSize({ width: 1600, height: 2200 });
  await pdfPage.setContent(`
    <html>
      <body style="margin:0;background:white;">
        <canvas id="statement" width="1600" height="2200"></canvas>
        <script>
          const canvas = document.getElementById("statement");
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#000";
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 3;
          ctx.font = "48px Arial";
          ctx.fillText("HSBC VISA REVOLUTION", 120, 160);
          ctx.font = "26px Arial";
          ctx.fillText("HSBC Bank (Singapore) Limited", 120, 205);
          ctx.font = "36px Arial";
          ctx.fillText("CARDHOLDER SAMPLE USER", 120, 340);
          ctx.fillRect(120, 370, 1320, 52);
          ctx.fillStyle = "#fff";
          ctx.font = "30px Arial";
          ctx.fillText("4000-XXXX-XXXX-0000", 130, 405);
          ctx.fillStyle = "#000";
          ctx.font = "25px Arial";
          ctx.fillText("Statement period", 130, 470);
          ctx.font = "31px Arial";
          ctx.fillText("From 06 MAR 2026 to 05 APR 2026", 130, 515);
          ctx.font = "34px Arial";
          ctx.fillText("POST", 130, 780);
          ctx.fillText("TRAN", 260, 780);
          ctx.fillText("DESCRIPTION", 395, 780);
          ctx.fillText("AMOUNT(SGD)", 760, 780);
          ctx.beginPath();
          ctx.moveTo(120, 795);
          ctx.lineTo(980, 795);
          ctx.stroke();
          ctx.font = "26px Arial";
          ctx.fillText("Previous Statement Balance", 420, 875);
          ctx.fillText("0.00", 900, 875);
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(120, 900);
          ctx.lineTo(980, 900);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = "28px Arial";
          ctx.fillText("09 Mar", 130, 950);
          ctx.fillText("06 Mar", 265, 950);
          ctx.fillText("IKEA - ONLINE", 400, 950);
          ctx.fillText("SINGAPORE", 580, 950);
          ctx.fillText("117.80", 880, 950);
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(120, 985);
          ctx.lineTo(980, 985);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillText("04 Apr", 130, 1038);
          ctx.fillText("02 Apr", 265, 1038);
          ctx.fillText("PAYMENT VIA UOB", 400, 1038);
          ctx.fillText("VISA", 650, 1038);
          ctx.fillText("117.80CR", 850, 1038);
          ctx.fillText("DIRECT SG", 400, 1085);
          ctx.font = "38px Arial";
          ctx.fillText("Total Due", 400, 1160);
          ctx.fillText("0.00", 880, 1160);
          ctx.font = "34px Arial";
          ctx.fillText("ACCOUNT SUMMARY", 1040, 760);
          ctx.font = "27px Arial";
          ctx.fillText("SGD", 1450, 760);
          ctx.fillText("Previous Statement Balance", 1040, 805);
          ctx.fillText("0.00", 1420, 805);
          ctx.fillText("Payments & Credits", 1040, 850);
          ctx.fillText("117.80CR", 1390, 850);
          ctx.fillText("Purchases & Debits", 1040, 895);
          ctx.fillText("117.80", 1420, 895);
          ctx.fillText("GST Charges", 1040, 940);
          ctx.fillText("0.00", 1420, 940);
          ctx.fillText("GST Reversals", 1040, 985);
          ctx.fillText("0.00", 1420, 985);
          ctx.fillStyle = "#000";
          ctx.fillText("Total Account Balance", 1040, 1040);
          ctx.fillText("(incl GST)", 1040, 1070);
          ctx.fillText("0.00", 1420, 1060);
          const dataUrl = canvas.toDataURL("image/png");
          document.body.innerHTML = '<img src="' + dataUrl + '" style="width:100%;height:auto;" />';
        </script>
      </body>
    </html>
  `);
  await pdfPage.pdf({ path, width: "1600px", height: "2200px", printBackground: true });
  await pdfPage.close();
}

test.describe("import flow", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
    await gotoImportsPage(page);
  });

  test("statement mismatch UI gives action guidance and links ledger rows to entries", async ({ page }) => {
    const mockedPreviewRoute = async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? "{}");
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          ok: true,
          preview: {
            sourceLabel: body.sourceLabel ?? "Statement guidance preview",
            parserKey: "generic_csv",
            importedRows: 1,
            previewRows: [{
              rowId: "preview-statement-guidance-1",
              rowIndex: 1,
              date: "2026-04-16",
              description: "PDF STATEMENT ROW",
              amountMinor: 1000,
              entryType: "expense",
              accountId: "acct-statement-guidance",
              accountName: "Statement Guidance Card",
              statementAccountName: "Statement Guidance Card",
              categoryName: "Other",
              ownershipType: "direct",
              ownerName: "Tim",
              splitBasisPoints: 10000,
              rawRow: {
                date: "2026-04-16",
                description: "PDF STATEMENT ROW",
                expense: "10.00",
                account: "Statement Guidance Card",
                category: "Other",
                note: "txn date: 2026-04-14"
              },
              reconciliationMatch: {
                existingTransactionId: "txn-statement-guidance-existing",
                existingAccountId: "acct-statement-guidance",
                existingSourceType: "manual",
                existingBankCertificationStatus: "provisional",
                date: "2026-04-14",
                postedDate: "2026-04-16",
                description: "PDF STATEMENT ROW",
                amountMinor: 1000,
                accountName: "Statement Guidance Card",
                matchKind: "exact"
              },
              reconciliationMatchCount: 1,
              commitStatus: "included",
              commitStatusExplicit: false
            }],
            unknownAccounts: [],
            unknownCategories: [],
            reconciliationCandidateCount: 0,
            overlappingImportCount: 0,
            overlapImports: [],
            startDate: "2026-04-16",
            endDate: "2026-04-16",
            accountNames: ["Statement Guidance Card"],
            reconciliationCandidates: [],
            exceptionSummary: [],
            statementReconciliations: [{
              accountId: "acct-statement-guidance",
              accountName: "Statement Guidance Card",
              accountKind: "credit_card",
              checkpointMonth: "2026-05",
              statementStartDate: "2026-04-13",
              statementEndDate: "2026-05-12",
              statementBalanceMinor: -1000,
              ledgerBalanceMinor: -1500,
              deltaMinor: -500,
              status: "mismatch",
              reconciliationBreakdown: {
                priorLedgerBalanceMinor: 0,
                statementPeriodExistingRowsMinor: -500,
                includedStatementRowsMinor: -1000,
                matchedStatementRowsMinor: 0,
                skippedStatementRowsMinor: 0,
                supersededLedgerRowsMinor: 0,
                projectedLedgerBalanceMinor: -1500,
                statementBalanceMinor: -1000,
                deltaMinor: -500,
                periodExistingLedgerRowCount: 2,
                skippedStatementRowCount: 0,
                matchedStatementRowCount: 0,
                suspectedCauses: [
                  "Existing ledger rows inside this statement period total $5.00, matching the difference."
                ],
                periodExistingLedgerRows: [{
                  id: "txn-statement-guidance-extra",
                  accountId: "acct-statement-guidance",
                  date: "2026-04-15",
                  description: "EXTRA MIDCYCLE ROW",
                  signedAmountMinor: -300,
                  accountName: "Statement Guidance Card",
                  source: "ledger",
                  status: "manual / provisional"
                }, {
                  id: "txn-statement-guidance-extra-2",
                  accountId: "acct-statement-guidance",
                  date: "2026-04-16",
                  description: "SECOND MIDCYCLE ROW",
                  signedAmountMinor: -200,
                  accountName: "Statement Guidance Card",
                  source: "ledger",
                  status: "manual / provisional"
                }],
                skippedStatementRows: [],
                matchedStatementRows: []
              }
            }]
          }
        })
      });
    };
    const mockedDeleteRoute = async (route) => {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({ ok: true })
      });
    };

    await page.route("**/api/imports/preview", mockedPreviewRoute);
    await page.route("**/api/entries/delete", mockedDeleteRoute);
    try {
      await page.getByLabel("Source label").fill("Statement guidance preview");
      await page.getByLabel("CSV content").fill(
        [
          "date,description,expense,account,category,note",
          "2026-04-16,PDF STATEMENT ROW,10.00,Statement Guidance Card,Other,txn date: 2026-04-14"
        ].join("\n")
      );

      await page.getByRole("button", { name: "Preview import" }).click();
      await page.getByRole("button", { name: "Show money totals" }).first().click();
      const breakdown = page.locator(".statement-reconciliation-breakdown");
      await expect(breakdown).toContainText("Why this does not close");
      await expect(breakdown).toContainText("treat the PDF as the stronger bank record");
      await expect(breakdown).toContainText("What to do first");
      await expect(breakdown).toContainText("Open 'Already in ledger during this period'.");
      await expect(breakdown).toContainText("Check the card, date, amount, and direction for each row.");
      await expect(breakdown).toContainText("If a row is wrong, delete it, remap it, or change the posted date, then refresh the check.");
      await expect(breakdown).toContainText("After this preview, the ledger would show");
      await expect(breakdown).toContainText("Already in ledger during this period");
      await expect(breakdown).toContainText("adds $5.00 owed");
      await expect(breakdown).toContainText("Ledger rows not automatically matched to this PDF");
      await expect(breakdown).toContainText("Showing all 2 unresolved ledger rows. Together these rows net to -$5.00.");
      await expect(breakdown).toContainText("These unresolved ledger rows total $5.00, which matches the unexplained difference.");
      await expect(breakdown).toContainText("For credit cards, negative ledger expenses increase the owed balance");
      await expect(breakdown).toContainText("if the row is on this card's PDF, it should be matched or certified");
      await page.getByRole("button", { name: "View match" }).click();
      const matchPopover = page.locator(".duplicate-match-popover");
      await expect(matchPopover).toContainText("Ledger match");
      await expect(matchPopover).toContainText("Incoming row");
      await expect(matchPopover).toContainText("Transaction date");
      await expect(matchPopover).toContainText("14/04/2026");
      await expect(matchPopover).toContainText("Posted date");
      await expect(matchPopover).toContainText("16/04/2026");
      await page.keyboard.press("Escape");
      const beforePeriodHelp = breakdown.getByLabel("Explain Before statement period");
      await beforePeriodHelp.scrollIntoViewIfNeeded();
      const scrollBeforePopover = await page.evaluate(() => window.scrollY);
      await beforePeriodHelp.hover();
      await expect(page.getByText("For this statement, the window is 13 Apr 2026 to 12 May 2026")).toBeVisible();
      const scrollAfterPopover = await page.evaluate(() => window.scrollY);
      expect(Math.abs(scrollAfterPopover - scrollBeforePopover)).toBeLessThan(20);
      await page.mouse.move(0, 0);
      await expect(breakdown.getByRole("button", { name: "Delete 2 ledger rows" })).toBeVisible();

      const ledgerRow = breakdown.locator(".statement-reconciliation-diagnostic-row").filter({ hasText: "EXTRA MIDCYCLE ROW" });
      await expect(ledgerRow).toContainText("Date shown: transaction date from the ledger row.");
      const openLink = ledgerRow.getByRole("link", { name: "Open" });
      await expect(openLink).toHaveAttribute(
        "href",
        "/entries?view=person-tim&month=2026-04&entry_id=txn-statement-guidance-extra&entry_wallet=acct-statement-guidance"
      );
      await expect(openLink).toHaveAttribute("target", "_blank");
      await expect(openLink).toHaveAttribute("rel", "noopener noreferrer");
      await ledgerRow.getByRole("button", { name: "Set posted date" }).click();
      await expect(page.getByRole("dialog", { name: "Set posted date" })).toContainText("The transaction date stays where it is for spending history");
      await expect(page.getByRole("dialog", { name: "Set posted date" })).toContainText("If the posted date is after 12 May 2026");
      await page.getByRole("button", { name: "Cancel" }).click();
      await ledgerRow.getByRole("button", { name: "Defer" }).click();
      await expect(page.getByText("Use this when the row is legitimate")).toBeVisible();
      await expect(page.getByText("first day after this statement")).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(ledgerRow.getByRole("button", { name: "Delete" })).toBeVisible();
      await ledgerRow.getByRole("button", { name: "Delete" }).click();
      await page.locator(".delete-popover").getByRole("button", { name: "Delete" }).click();
      await expect(breakdown).not.toContainText("EXTRA MIDCYCLE ROW");
      await expect(breakdown).toContainText("SECOND MIDCYCLE ROW");
    } finally {
      await page.unroute("**/api/imports/preview", mockedPreviewRoute);
      await page.unroute("**/api/entries/delete", mockedDeleteRoute);
    }
  });

  test("statement mismatch UI flags ledger rows posted after the statement cutoff", async ({ page }) => {
    const mockedPreviewRoute = async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? "{}");
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          ok: true,
          preview: {
            sourceLabel: body.sourceLabel ?? "Statement cutoff preview",
            parserKey: "generic_csv",
            importedRows: 1,
            previewRows: [{
              rowId: "preview-statement-cutoff-1",
              rowIndex: 1,
              date: "2026-04-16",
              description: "PDF STATEMENT ROW",
              amountMinor: 1000,
              entryType: "expense",
              accountId: "acct-statement-cutoff",
              accountName: "Statement Cutoff Card",
              statementAccountName: "Statement Cutoff Card",
              categoryName: "Other",
              ownershipType: "direct",
              ownerName: "Tim",
              splitBasisPoints: 10000,
              rawRow: {
                date: "2026-04-16",
                description: "PDF STATEMENT ROW",
                expense: "10.00",
                account: "Statement Cutoff Card",
                category: "Other",
                note: "txn date: 2026-04-14"
              },
              reconciliationMatch: {
                existingTransactionId: "txn-statement-cutoff-existing",
                existingAccountId: "acct-statement-cutoff",
                existingSourceType: "manual",
                existingBankCertificationStatus: "provisional",
                date: "2026-04-14",
                postedDate: "2026-05-13",
                description: "PDF STATEMENT ROW",
                amountMinor: 1000,
                accountName: "Statement Cutoff Card",
                matchKind: "exact"
              },
              reconciliationMatchCount: 1,
              commitStatus: "included",
              commitStatusExplicit: false
            }],
            unknownAccounts: [],
            unknownCategories: [],
            reconciliationCandidateCount: 0,
            overlappingImportCount: 0,
            overlapImports: [],
            startDate: "2026-04-16",
            endDate: "2026-04-16",
            accountNames: ["Statement Cutoff Card"],
            reconciliationCandidates: [],
            exceptionSummary: [],
            statementReconciliations: [{
              accountId: "acct-statement-cutoff",
              accountName: "Statement Cutoff Card",
              accountKind: "credit_card",
              checkpointMonth: "2026-05",
              statementStartDate: "2026-04-13",
              statementEndDate: "2026-05-12",
              statementBalanceMinor: -1000,
              ledgerBalanceMinor: -1500,
              deltaMinor: -500,
              status: "mismatch",
              reconciliationBreakdown: {
                priorLedgerBalanceMinor: 0,
                statementPeriodExistingRowsMinor: -500,
                includedStatementRowsMinor: -1000,
                matchedStatementRowsMinor: 0,
                skippedStatementRowsMinor: 0,
                supersededLedgerRowsMinor: 0,
                projectedLedgerBalanceMinor: -1500,
                statementBalanceMinor: -1000,
                deltaMinor: -500,
                periodExistingLedgerRowCount: 1,
                skippedStatementRowCount: 0,
                matchedStatementRowCount: 0,
                suspectedCauses: [
                  "Existing ledger rows inside this statement period total $5.00, matching the difference."
                ],
                periodExistingLedgerRows: [{
                  id: "txn-statement-cutoff-existing",
                  accountId: "acct-statement-cutoff",
                  date: "2026-04-16",
                  postedDate: "2026-05-13",
                  dateRole: "transaction",
                  description: "CUT-OFF ROW",
                  signedAmountMinor: -500,
                  accountName: "Statement Cutoff Card",
                  source: "ledger",
                  status: "manual / provisional"
                }],
                skippedStatementRows: [],
                matchedStatementRows: []
              }
            }]
          }
        })
      });
    };

    await page.route("**/api/imports/preview", mockedPreviewRoute);
    try {
      await page.getByLabel("Source label").fill("Statement cutoff preview");
      await page.getByLabel("CSV content").fill(
        [
          "date,description,expense,account,category,note",
          "2026-04-16,PDF STATEMENT ROW,10.00,Statement Cutoff Card,Other,txn date: 2026-04-14"
        ].join("\n")
      );

      await page.getByRole("button", { name: "Preview import" }).click();
      const ledgerRow = page.locator(".statement-reconciliation-diagnostic-row").filter({ hasText: "CUT-OFF ROW" });
      await expect(ledgerRow).toContainText("Posted date saved on the ledger row: 13 May 2026");
      await expect(ledgerRow).toContainText("this row belongs to the next statement");
    } finally {
      await page.unroute("**/api/imports/preview", mockedPreviewRoute);
    }
  });

  test("matched statement breakdown uses close-ready wording", async ({ page }) => {
    const mockedPreviewRoute = async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? "{}");
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          ok: true,
          preview: {
            sourceLabel: body.sourceLabel ?? "Matched statement preview",
            parserKey: "generic_csv",
            importedRows: 1,
            previewRows: [{
              rowId: "preview-statement-matched-1",
              rowIndex: 1,
              date: "2026-04-16",
              description: "PDF STATEMENT ROW",
              amountMinor: 1000,
              entryType: "expense",
              accountId: "acct-statement-matched",
              accountName: "Statement Matched Card",
              statementAccountName: "Statement Matched Card",
              categoryName: "Other",
              ownershipType: "direct",
              ownerName: "Tim",
              splitBasisPoints: 10000,
              rawRow: {
                date: "2026-04-16",
                description: "PDF STATEMENT ROW",
                expense: "10.00",
                account: "Statement Matched Card",
                category: "Other",
                note: "txn date: 2026-04-14"
              },
              commitStatus: "included",
              commitStatusExplicit: false
            }],
            unknownAccounts: [],
            unknownCategories: [],
            reconciliationCandidateCount: 0,
            overlappingImportCount: 0,
            overlapImports: [],
            startDate: "2026-04-16",
            endDate: "2026-04-16",
            accountNames: ["Statement Matched Card"],
            reconciliationCandidates: [],
            exceptionSummary: [],
            statementReconciliations: [{
              accountId: "acct-statement-matched",
              accountName: "Statement Matched Card",
              accountKind: "credit_card",
              checkpointMonth: "2026-05",
              statementStartDate: "2026-04-13",
              statementEndDate: "2026-05-12",
              statementBalanceMinor: -1000,
              ledgerBalanceMinor: -1000,
              deltaMinor: 0,
              status: "matched",
              reconciliationBreakdown: {
                priorLedgerBalanceMinor: 0,
                statementPeriodExistingRowsMinor: 0,
                includedStatementRowsMinor: -1000,
                matchedStatementRowsMinor: -1000,
                skippedStatementRowsMinor: 0,
                supersededLedgerRowsMinor: 0,
                projectedLedgerBalanceMinor: -1000,
                statementBalanceMinor: -1000,
                deltaMinor: 0,
                periodExistingLedgerRowCount: 0,
                skippedStatementRowCount: 0,
                matchedStatementRowCount: 2,
                suspectedCauses: [
                  "The projected ledger balance now equals the statement balance."
                ],
                periodExistingLedgerRows: [],
                skippedStatementRows: [],
                matchedStatementRows: [{
                  id: "preview-statement-matched-1",
                  date: "2026-04-16",
                  eventDate: "2026-04-14",
                  description: "PDF STATEMENT ROW",
                  signedAmountMinor: -600,
                  accountName: "Statement Matched Card",
                  source: "statement",
                  status: "included"
                }, {
                  id: "preview-statement-matched-2",
                  date: "2026-04-17",
                  description: "SECOND PDF STATEMENT ROW",
                  signedAmountMinor: -400,
                  accountName: "Statement Matched Card",
                  source: "statement",
                  status: "included"
                }]
              }
            }]
          }
        })
      });
    };

    await page.route("**/api/imports/preview", mockedPreviewRoute);
    try {
      await page.getByLabel("Source label").fill("Matched statement preview");
      await page.getByLabel("CSV content").fill(
        [
          "date,description,expense,account,category,note",
          "2026-04-16,PDF STATEMENT ROW,10.00,Statement Matched Card,Other,txn date: 2026-04-14"
        ].join("\n")
      );

      await page.getByRole("button", { name: "Preview import" }).click();
      await page.getByRole("button", { name: "Show money totals" }).first().click();

      const breakdown = page.locator(".statement-reconciliation-breakdown");
      await expect(breakdown).toContainText("Why this closes");
      await expect(breakdown).toContainText("The statement is ready to close for this account.");
      await expect(breakdown).not.toContainText("Why this does not close");
      await expect(breakdown).not.toContainText("That leaves $0.00 to explain.");
      await expect(breakdown).toContainText("2 PDF rows already match ledger rows. Net statement movement: -$10.00.");
      await expect(breakdown.getByText("These PDF rows already found matching ledger rows.")).not.toBeVisible();
      await expect(breakdown.getByText("PDF STATEMENT ROW", { exact: true })).not.toBeVisible();

      await breakdown.getByText("PDF rows already matching ledger rows").click();
      await expect(breakdown.getByText("These PDF rows already found matching ledger rows.")).toBeVisible();
      await expect(breakdown).toContainText("Showing all 2 already-matched PDF rows. Their net statement movement is -$10.00. This is audit context only; the statement already closes.");
      await expect(breakdown.getByText("PDF STATEMENT ROW", { exact: true })).toBeVisible();
      await expect(breakdown).not.toContainText("this bucket");
    } finally {
      await page.unroute("**/api/imports/preview", mockedPreviewRoute);
    }
  });

  test("imported row can be edited and rolls through entries, month, and summary", async ({ page }) => {
    const beforeMonthPage = await loadMonthPage(page, { view: "person-tim", month: "2025-10" });
    const beforeSummaryPage = await loadSummaryPage(page, { view: "person-tim", month: "2025-10" });
    const beforeMonth = findSummaryMonth(beforeSummaryPage, "2025-10");
    const beforeFoodDonut = findDonutMonthValue(beforeSummaryPage, "2025-10", "Food & Drinks");

    const importsPageReady = page.waitForResponse((response) => response.url().includes("/api/imports-page") && response.ok());
    await page.goto("/imports?view=person-tim&month=2025-10");
    await importsPageReady;
    try {
      await expect(page.getByLabel("Source label")).toBeVisible({ timeout: 10_000 });
    } catch {
      await page.reload();
    }
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Source label")).toBeVisible({ timeout: 30_000 });
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
    const commitResponse = page.waitForResponse((response) => (
      response.url().includes("/api/imports/commit") && response.ok()
    ));
    await page.getByRole("button", { name: "Commit import" }).first().click();
    await commitResponse;

    const entriesPageReady = page.waitForResponse((response) => (
      response.url().includes("/api/entries-page") && response.ok()
    ));
    await page.goto("/entries?view=person-tim&month=2025-10");
    await entriesPageReady;
    const entryRow = page.locator(".entry-row").filter({ hasText: "Playwright groceries import" }).first();
    await expect(entryRow.locator(".entry-row-description strong").filter({ hasText: "Playwright groceries import" })).toBeVisible();
    await entryRow.getByText("Playwright groceries import", { exact: true }).click();
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
    await page.getByRole("button", { name: "Show money totals" }).click();
    await expect(page.getByRole("button", { name: "Oct 2025" }).first()).toBeVisible();
    await expect(page.getByText(formatMoney(afterFoodDonut)).first()).toBeVisible({ timeout: 30_000 });
  });

  test("final import shows recent-import loading and completion inline", async ({ page }) => {
    await page.goto("/imports?view=person-tim&month=2025-10");
    try {
      await expect(page.getByLabel("Source label")).toBeVisible({ timeout: 10_000 });
    } catch {
      await page.reload();
    }
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });

    const firstImportLabel = `Playwright loading import ${Date.now()}`;
    const secondImportLabel = `Playwright follow-up import ${Date.now()}`;

    await page.getByLabel("Source label").fill(firstImportLabel);
    await page.getByLabel("CSV content").fill(
      [
        "category,account,note,amount,date,description",
        "Groceries,UOB One,Playwright loading import,-9.99,2025-10-19,Playwright loading import row"
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.getByRole("button", { name: "Commit import" }).first()).toBeEnabled();

    const delayedCommitRoute = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    };

    await page.route("**/api/imports/commit", delayedCommitRoute);
    try {
      const commitButton = page.getByRole("button", { name: "Commit import" }).first();
      const importsPageRefresh = page.waitForResponse((response) => (
        response.url().includes("/api/imports-page") && response.ok()
      ));
      await commitButton.click();
      await expect(page.locator(".import-history-refreshing.is-active")).toBeVisible();
      await importsPageRefresh;
      await expect(page.locator(".import-history-refreshing.is-active")).toHaveCount(0);
      const importsPage = await loadImportsPage(page);
      expect(
        importsPage.importsPage.recentImports.some((item) => item.sourceLabel === firstImportLabel && item.status === "completed")
      ).toBe(true);

      await page.getByLabel("Source label").fill(secondImportLabel);
      await page.getByLabel("CSV content").fill(
        [
          "category,account,note,amount,date,description",
          "Groceries,UOB One,Playwright follow-up import,-8.88,2025-10-20,Playwright follow-up import row"
        ].join("\n")
      );

      await page.getByRole("button", { name: "Preview import" }).click();
      await expect(page.getByRole("button", { name: "Commit import" }).first()).toBeEnabled();
      const followUpImportsPageRefresh = page.waitForResponse((response) => (
        response.url().includes("/api/imports-page") && response.ok()
      ));
      await page.getByRole("button", { name: "Commit import" }).first().click();
      await followUpImportsPageRefresh;
      await expect(page.locator(".import-history-refreshing.is-active")).toHaveCount(0);
      await expect(page.getByText(`${secondImportLabel} committed successfully. Recent imports have been updated.`)).toBeVisible({
        timeout: 30_000
      });
      await expect(page.locator(".import-card").filter({ hasText: secondImportLabel }).first()).toContainText("completed", {
        timeout: 30_000
      });
    } finally {
      await page.unroute("**/api/imports/commit", delayedCommitRoute);
    }
  });

  test("post-import cleanup surfaces possible split links without forcing immediate review", async ({ page }) => {
    const description = `Playwright split import cleanup ${Date.now()}`;

    await postJson(page, "/api/splits/expenses/create", {
      groupId: null,
      date: "2025-10-18",
      description,
      categoryName: "Food & Drinks",
      payerPersonName: "Tim",
      amountMinor: 1234,
      note: "manual split before bank import",
      splitBasisPoints: 5000,
      splitAmountMinor: 617
    });

    await page.goto("/imports?view=person-tim&month=2025-10");
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("Source label").fill("Playwright split cleanup import");
    await page.getByLabel("CSV content").fill(
      [
        "category,account,note,amount,date,description",
        `Food & Drinks,UOB One,official bank row,-12.34,2025-10-18,${description} official`
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.getByRole("button", { name: "Commit import" }).first()).toBeEnabled();

    const commitResponse = page.waitForResponse((response) => response.url().includes("/api/imports/commit") && response.ok());
    await page.getByRole("button", { name: "Commit import" }).first().click();
    await commitResponse;

    const cleanupCard = page.locator(".import-post-cleanup-card");
    await expect(cleanupCard).toContainText("possible split link", { timeout: 60_000 });
    await expect(cleanupCard.getByRole("button", { name: "Review split matches" })).toBeVisible();
    await cleanupCard.getByRole("button", { name: "Later" }).click();
    await expect(cleanupCard).toHaveCount(0);

    await page.goto("/splits?view=person-tim&month=2025-10");
    await expect(page.locator(".split-header-toolbar .split-matches-link")).toContainText(/Review matches \([1-9]/);
  });

  test("local HSBC OCR packages upload Feb-Jul 2026 through the statement preview path", async ({ page }, testInfo) => {
    await createHsbcVisaRevolutionAccount(page);

    for (const item of HSBC_2026_CASES) {
      const tsv = await readFile(`tests/fixtures/hsbc-ocr/browser-2026/hsbc-visa-revolution-${item.month}-2026.browser.tsv`, "utf8");
      const ocrPackagePath = testInfo.outputPath(`hsbc-visa-revolution-${item.month}-2026.hsbc-ocr.tsv`);
      await writeFile(ocrPackagePath, `__OCR_TSV__\n${tsv}`, "utf8");

      await page.goto(`/imports?view=person-tim&month=${item.routeMonth}`);
      await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });

      await page.locator("input[type=\"file\"]").setInputFiles(ocrPackagePath);

      await expect(page.getByText(item.readyText)).toBeVisible({ timeout: 60_000 });
      await expectHsbcPreviewValues(page, item.values);
    }
  });

  test("sanitized HSBC image PDFs upload Feb-Jul 2026 through private browser OCR", async ({ page }) => {
    await createHsbcVisaRevolutionAccount(page);

    for (const item of HSBC_2026_CASES) {
      const pdfPath = `tests/fixtures/hsbc-ocr/image-pdf/hsbc-visa-revolution-${item.month}-2026.sanitized.pdf`;

      await page.goto(`/imports?view=person-tim&month=${item.routeMonth}`);
      await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });

      await page.locator("input[type=\"file\"]").setInputFiles(pdfPath);

      await expect(page.getByText(/Running private OCR in this browser/)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(item.readyText)).toBeVisible({ timeout: 120_000 });
      await expectHsbcPreviewValues(page, item.values);
    }
  });

  test("image-only HSBC PDF runs private browser OCR and opens statement preview", async ({ page }, testInfo) => {
    const pdfPath = testInfo.outputPath("hsbc-visa-revolution-image-only.pdf");
    await writeHsbcImagePdf(page, pdfPath);
    await createHsbcVisaRevolutionAccount(page);

    await page.goto("/imports?view=person-tim&month=2026-04");
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });

    await page.locator("input[type=\"file\"]").setInputFiles(pdfPath);

    await expect(page.getByText(/Running private OCR in this browser/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("2 rows ready for review")).toBeVisible({ timeout: 120_000 });
    const previewValues = await page
      .locator(".import-preview-table input")
      .evaluateAll((inputs) => inputs.map((input) => input.value));
    const normalizedPreviewValues = previewValues.join(" ").replace(/[^a-z0-9]+/gi, " ").toUpperCase();
    expect(normalizedPreviewValues).toMatch(/\bIKEA\b/);
    expect(normalizedPreviewValues).toMatch(/\bPAYMENT\s+VIA\s+UOB\s+VISA\b/);
  });

  test("rolling back a PDF import invalidates cached entries before returning to the entries page", async ({ page }) => {
    const month = "2025-01";
    const referenceData = await loadReferenceData(page);
    const account = referenceData.accounts.find((item) => item.name === "Citi Rewards");
    expect(account).toBeTruthy();

    const importedRow = buildSyntheticPdfImportRow({
      rowId: "jan-rollback-row",
      date: "2025-01-04",
      description: "JAN PDF ROLLBACK ROW",
      amountMinor: 17350,
      entryType: "income",
      account
    });

    await page.goto(`/entries?view=person-tim&month=${month}`);
    const beforeEntries = await loadEntriesPage(page, { view: "person-tim", month });
    expect(beforeEntries.monthPage.entries.some((item) => item.description === importedRow.description)).toBe(false);

    const commitPayload = await postJson(page, "/api/imports/commit", {
      sourceLabel: "Playwright January PDF rollback",
      sourceType: "pdf",
      parserKey: "citibank_credit_card_pdf",
      rows: [importedRow],
      statementCheckpoints: []
    });
    expect(commitPayload.importId).toBeTruthy();

    await gotoImportsPage(page, month);

    const importCard = page.locator(".import-card").filter({ hasText: "Playwright January PDF rollback" });
    await expect(importCard).toBeVisible();
    await importCard.getByRole("button", { name: "Rollback import" }).click();
    await page.getByRole("button", { name: "Confirm rollback" }).click();
    await expect(page.locator(".import-history-refreshing")).toHaveCount(0);

    await page.getByRole("link", { name: "Entries" }).click();
    await expect(page.locator(`text=${importedRow.description}`)).toHaveCount(0);

    const afterEntries = await loadEntriesPage(page, { view: "person-tim", month });
    expect(afterEntries.monthPage.entries.some((item) => item.description === importedRow.description)).toBe(false);
  });

  test("restoring an exact covered import row opens the confirmation dialog and re-includes the row", async ({ page }) => {
    await page.getByLabel("Source label").fill(`Restore import ${Date.now()}`);
    const mockedPreviewRoute = async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() ?? "{}");
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          ok: true,
          preview: {
            sourceLabel: body.sourceLabel ?? "Restore import",
            parserKey: "generic_csv",
            importedRows: 1,
            previewRows: [{
              rowId: "preview-restore-1",
              rowIndex: 1,
              date: "2025-10-17",
              description: "Playwright restore import row",
              amountMinor: 11111,
              entryType: "expense",
              accountId: "acct-uob-one",
              accountName: "UOB One",
              statementAccountName: "UOB One",
              categoryName: "Groceries",
              ownershipType: "direct",
              ownerName: "Tim",
              splitBasisPoints: 10000,
              rawRow: {
                date: "2025-10-17",
                description: "Playwright restore import row",
                amount: "-111.11",
                account: "UOB One",
                category: "Groceries",
                note: ""
              },
              reconciliationMatch: {
                existingTransactionId: "txn-restore-1",
                existingAccountId: "acct-uob-one",
                existingSourceType: "manual",
                existingBankCertificationStatus: "provisional",
                date: "2025-10-17",
                description: "Playwright restore import row",
                amountMinor: 11111,
                accountName: "UOB One",
                matchKind: "exact"
              },
              reconciliationMatchCount: 1,
              commitStatus: "skipped",
              commitStatusExplicit: false,
              commitStatusReason: "Current-activity import will promote the existing manual ledger row while preserving user edits and split links.",
              reconciliationTargetTransactionId: "txn-restore-1",
              isCertifiedConflict: true
            }],
            unknownAccounts: [],
            unknownCategories: [],
            reconciliationCandidateCount: 0,
            overlappingImportCount: 0,
            overlapImports: [],
            startDate: "2025-10-17",
            endDate: "2025-10-17",
            accountNames: ["UOB One"],
            reconciliationCandidates: [],
            statementReconciliations: [],
            exceptionSummary: []
          }
        })
      });
    };
    await page.route("**/api/imports/preview", mockedPreviewRoute);
    try {
      await page.getByLabel("CSV content").fill(
        [
          "date,description,amount,account,category,note",
          "2025-10-17,Playwright restore import row,-111.11,UOB One,Groceries,"
        ].join("\n")
      );

      await page.getByRole("button", { name: "Preview import" }).click();
      const certifiedConflicts = page.locator(".import-warning-attention").filter({ hasText: "Certified row conflict" });
      await expect(certifiedConflicts).toBeVisible();
      await certifiedConflicts.getByRole("button", { name: "Include row" }).click();

      const confirmDialog = page.locator('[role="dialog"]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText("This row is marked as an exact already-covered match");
      await confirmDialog.getByRole("button", { name: "Restore row" }).click();

      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
      await expect(page.locator(".import-warning-attention").filter({ hasText: "Certified row conflict" })).toHaveCount(0);
    } finally {
      await page.unroute("**/api/imports/preview", mockedPreviewRoute);
    }
  });

  test("summary and month stay aligned across tabs after persisted changes", async ({ browser, page }) => {
    const context = page.context();
    const summaryPage = page;
    const importsPage = await context.newPage();
    const monthPage = await context.newPage();

    await summaryPage.goto("/summary?view=person-tim&month=2025-10&summary_focus=2025-10");
    await monthPage.goto("/month?view=person-tim&month=2025-10");
    const importsPageReady = importsPage.waitForResponse((response) => response.url().includes("/api/imports-page") && response.ok());
    await importsPage.goto("/imports?view=person-tim&month=2025-10");
    await importsPageReady;

    const beforeSummaryPage = await loadSummaryPage(summaryPage, { view: "person-tim", month: "2025-10" });
    const beforeMonthPage = await loadMonthPage(monthPage, { view: "person-tim", month: "2025-10" });
    const beforeMonth = findSummaryMonth(beforeSummaryPage, "2025-10");
    expect(beforeMonthPage.monthPage.metricCards.find((item) => item.label === "Actual spend")?.amountMinor).toBe(beforeMonth.realExpensesMinor);
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

  test("current-activity exact manual matches are shown as already handled", async ({ page }) => {
    const referenceData = await loadReferenceData(page);
    const account = referenceData.accounts.find((item) => item.name === "UOB One" && item.ownerLabel === "Tim");
    expect(account).toBeTruthy();

    const createdEntry = await page.evaluate(async ({ accountId, accountName }) => {
      const response = await fetch("/api/entries/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2025-06-11",
          description: "MATCHED MANUAL CARD ROW",
          accountId,
          accountName,
          categoryName: "Food & Drinks",
          amountMinor: 530,
          entryType: "expense",
          ownershipType: "direct",
          ownerName: "Tim",
          postedDate: "2025-06-13"
        })
      });
      return { ok: response.ok, json: await response.json() };
    }, { accountId: account.id, accountName: account.name });
    expect(createdEntry.ok, JSON.stringify(createdEntry.json)).toBeTruthy();

    await page.getByLabel("Source label").fill("Matched manual card row import");
    await page.getByLabel("CSV content").fill(
      [
        "date,description,expense,account,category,note",
        `2025-06-13,MATCHED MANUAL CARD ROW,5.30,${account.name},Food & Drinks,txn date: 2025-06-11`
      ].join("\n")
    );
    await page.getByRole("button", { name: "Preview import" }).click();

    await expect(page.getByText("Matched to ledger")).toBeVisible();
    await expect(page.getByRole("button", { name: "Exclude row" })).toHaveCount(0);
    await expect(page.getByText("Current-activity import will promote the existing manual ledger row")).toBeVisible();
    await expect(page.getByText("It will keep transaction date 2025-06-11 for spending history and set posted date 2025-06-13 for statement reconciliation.")).toBeVisible();
  });

  test("official statement certifies shifted mid-cycle rows and supersedes absent provisional rows", async ({ page }) => {
    const accountName = `Playwright Citi Rewards May ${Date.now()}`;
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

    const csvRows = [
      {
        date: "2026-04-24",
        description: "AMAZON MKTPLC SG Singapore SGP",
        expense: "6.05",
        income: "",
        accountId,
        account: accountName,
        category: "Shopping",
        type: "expense"
      },
      {
        date: "2026-05-01",
        description: "SHOPEE SINGAPORE MP SINGAPORE SGP",
        expense: "2.66",
        income: "",
        accountId,
        account: accountName,
        category: "Shopping",
        type: "expense"
      },
      {
        date: "2026-05-02",
        description: "Google One SINGAPORE SGP",
        expense: "139.99",
        income: "",
        accountId,
        account: accountName,
        category: "Other",
        type: "expense"
      },
      {
        date: "2026-05-02",
        description: "PAYMENT VIA UOB SINGAPORE SGP",
        expense: "",
        income: "756.73",
        accountId,
        account: accountName,
        category: "Transfer",
        type: "transfer"
      }
    ];
    const csvPreview = await postJson(page, "/api/imports/preview", {
      sourceLabel: "Citi Rewards May mid-cycle CSV",
      sourceType: "csv",
      defaultAccountName: accountName,
      ownershipType: "direct",
      ownerName: "Tim",
      rows: csvRows
    });
    expect(csvPreview.preview.previewRows).toHaveLength(4);

    const csvCommit = await postJson(page, "/api/imports/commit", {
      sourceLabel: "Citi Rewards May mid-cycle CSV",
      sourceType: "csv",
      parserKey: "generic_csv",
      rows: csvPreview.preview.previewRows,
      statementCheckpoints: []
    });
    expect(csvCommit.importId).toBeTruthy();

    const pdfRows = [
      {
        date: "2026-04-30",
        description: "SHOPEESINGAPOREMP",
        expense: "2.66",
        income: "",
        accountId,
        account: accountName,
        category: "Shopping",
        type: "expense"
      },
      {
        date: "2026-05-03",
        description: "Google One",
        expense: "139.99",
        income: "",
        accountId,
        account: accountName,
        category: "Other",
        type: "expense"
      },
      {
        date: "2026-05-04",
        description: "MONEYSENDSANTOSTIMOTHY",
        expense: "",
        income: "756.73",
        accountId,
        account: accountName,
        category: "Transfer",
        type: "transfer"
      },
      {
        date: "2026-05-11",
        description: "ANNUALMEMBERSHIPFEE",
        expense: "180.00",
        income: "",
        accountId,
        account: accountName,
        category: "Other",
        type: "expense"
      },
      {
        date: "2026-05-11",
        description: "GSTONANNUALMEMBERSHIPFEE",
        expense: "16.20",
        income: "",
        accountId,
        account: accountName,
        category: "Other",
        type: "expense"
      }
    ];
    const statementCheckpoint = {
      accountId,
      accountName,
      detectedAccountName: accountName,
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-10",
      statementEndDate: "2026-05-11",
      statementBalanceMinor: -41788,
      note: "Synthetic Citi Rewards May statement"
    };
    const pdfPreview = await postJson(page, "/api/imports/preview", {
      sourceLabel: "Citi Rewards May PDF",
      sourceType: "pdf",
      defaultAccountName: accountName,
      ownershipType: "direct",
      ownerName: "Tim",
      rows: pdfRows,
      statementCheckpoints: [statementCheckpoint]
    });

    const previewRows = pdfPreview.preview.previewRows;
    const shopeedRow = previewRows.find((row) => row.description === "SHOPEESINGAPOREMP");
    const googleRow = previewRows.find((row) => row.description === "Google One");
    const paymentRow = previewRows.find((row) => row.description === "MONEYSENDSANTOSTIMOTHY");
    expect(shopeedRow?.commitStatus).toBe("included");
    expect(shopeedRow?.reconciliationTargetTransactionId).toBeTruthy();
    expect(googleRow?.commitStatus).toBe("included");
    expect(googleRow?.reconciliationTargetTransactionId).toBeTruthy();
    expect(paymentRow?.commitStatus).toBe("included");
    expect(paymentRow?.reconciliationTargetTransactionId).toBeTruthy();

    const reconciliation = pdfPreview.preview.statementReconciliations[0];
    expect(reconciliation.status, JSON.stringify(reconciliation)).toBe("matched");
    expect(reconciliation.projectedLedgerBalanceMinor).toBe(41788);
    expect(reconciliation.deltaMinor).toBe(0);
    expect(reconciliation.supersededLedgerRows).toHaveLength(1);
    expect(reconciliation.supersededLedgerRows[0].description).toBe("AMAZON MKTPLC SG Singapore SGP");
    expect(reconciliation.supersededLedgerRows[0].signedAmountMinor).toBe(-605);

    const pdfCommit = await postJson(page, "/api/imports/commit", {
      sourceLabel: "Citi Rewards May PDF",
      sourceType: "pdf",
      parserKey: "citibank_rewards_pdf",
      rows: previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review"),
      statementControlRows: previewRows,
      statementReconciliations: pdfPreview.preview.statementReconciliations,
      statementCheckpoints: [statementCheckpoint]
    });
    expect(pdfCommit.importId).toBeTruthy();

    const aprilEntries = await loadEntriesPage(page, { month: "2026-04" });
    const mayEntries = await loadEntriesPage(page, { month: "2026-05" });
    const certifiedShopee = aprilEntries.monthPage.entries.find((entry) => entry.description === "SHOPEESINGAPOREMP");
    const certifiedGoogle = mayEntries.monthPage.entries.find((entry) => entry.description === "Google One");
    const certifiedPayment = mayEntries.monthPage.entries.find((entry) => entry.description === "MONEYSENDSANTOSTIMOTHY");
    expect(certifiedShopee?.date).toBe("2026-04-30");
    expect(certifiedShopee?.postDate).toBe("2026-04-30");
    expect(certifiedShopee?.bankCertificationStatus).toBe("statement_certified");
    expect(certifiedGoogle?.date).toBe("2026-05-03");
    expect(certifiedGoogle?.postDate).toBe("2026-05-03");
    expect(certifiedGoogle?.bankCertificationStatus).toBe("statement_certified");
    expect(certifiedPayment?.date).toBe("2026-05-04");
    expect(certifiedPayment?.postDate).toBe("2026-05-04");
    expect(certifiedPayment?.bankCertificationStatus).toBe("statement_certified");
    expect(mayEntries.monthPage.entries.some((entry) => entry.description === "ANNUALMEMBERSHIPFEE")).toBeTruthy();
    expect(mayEntries.monthPage.entries.some((entry) => entry.description === "GSTONANNUALMEMBERSHIPFEE")).toBeTruthy();

    const aprilEntriesAfterSupersede = await loadEntriesPage(page, { month: "2026-04" });
    expect(aprilEntriesAfterSupersede.monthPage.entries.some((entry) => entry.description === "AMAZON MKTPLC SG Singapore SGP")).toBeFalsy();

    await gotoImportsPage(page, "2026-05");
    const mayPdfImportCard = page.locator(".import-card").filter({ hasText: "Citi Rewards May PDF" }).first();
    await expect(mayPdfImportCard).toBeVisible();
    await expect(mayPdfImportCard.getByRole("button", { name: "Rollback import" })).toBeVisible();
    await mayPdfImportCard.getByRole("button", { name: "Rollback import" }).click();
    await page.getByRole("button", { name: "Confirm rollback" }).click();
    await expect(page.locator(".import-history-refreshing")).toHaveCount(0);

    const aprilEntriesAfterRollback = await loadEntriesPage(page, { month: "2026-04" });
    const mayEntriesAfterRollback = await loadEntriesPage(page, { month: "2026-05" });
    const rolledBackAmazon = aprilEntriesAfterRollback.monthPage.entries.find((entry) => entry.description === "AMAZON MKTPLC SG Singapore SGP");
    const rolledBackShopee = mayEntriesAfterRollback.monthPage.entries.find((entry) => entry.description === "SHOPEE SINGAPORE MP SINGAPORE SGP");
    const rolledBackGoogle = mayEntriesAfterRollback.monthPage.entries.find((entry) => entry.description === "Google One SINGAPORE SGP");
    const rolledBackPayment = mayEntriesAfterRollback.monthPage.entries.find((entry) => entry.description === "PAYMENT VIA UOB SINGAPORE SGP");
    expect(rolledBackAmazon?.date).toBe("2026-04-24");
    expect(rolledBackAmazon?.postDate).toBe("2026-04-24");
    expect(rolledBackAmazon?.bankCertificationStatus).toBe("import_provisional");
    expect(rolledBackShopee?.date).toBe("2026-05-01");
    expect(rolledBackShopee?.postDate).toBe("2026-05-01");
    expect(rolledBackShopee?.bankCertificationStatus).toBe("import_provisional");
    expect(rolledBackGoogle?.date).toBe("2026-05-02");
    expect(rolledBackGoogle?.postDate).toBe("2026-05-02");
    expect(rolledBackGoogle?.bankCertificationStatus).toBe("import_provisional");
    expect(rolledBackPayment?.date).toBe("2026-05-02");
    expect(rolledBackPayment?.postDate).toBe("2026-05-02");
    expect(rolledBackPayment?.bankCertificationStatus).toBe("import_provisional");
  });

  test("uploaded PDF uses statement reconciliation on the first preview request", async ({ page }, testInfo) => {
    const importFlowPage = await page.context().newPage();
    const accountName = `Playwright Pdf Race ${Date.now()}`;
    const accountHeading = accountName.toUpperCase();
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

    const midcyclePreview = await postJson(page, "/api/imports/preview", {
      sourceLabel: "PDF race mid-cycle CSV",
      sourceType: "csv",
      defaultAccountName: accountName,
      ownershipType: "direct",
      ownerName: "Tim",
      rows: [{
        date: "2026-03-01",
        description: "RACE MID CYCLE",
        expense: "10.00",
        income: "",
        accountId,
        account: accountName,
        category: "Other",
        type: "expense"
      }]
    });
    expect(midcyclePreview.preview.previewRows).toHaveLength(1);

    const midcycleCommit = await postJson(page, "/api/imports/commit", {
      sourceLabel: "PDF race mid-cycle CSV",
      sourceType: "csv",
      parserKey: "generic_csv",
      rows: midcyclePreview.preview.previewRows,
      statementCheckpoints: []
    });
    expect(midcycleCommit.importId).toBeTruthy();

    const pdfPath = testInfo.outputPath("first-upload-preview-source-type.pdf");
    await writeTextPdf(page, pdfPath, buildSyntheticUobCardStatement({
      statementDate: "31 MAR 2026",
      sections: [{
        heading: accountHeading,
        cardNumber: "4111-1111-1111-1111",
        previousBalanceMinor: 0,
        totalBalanceMinor: 1_000,
        rows: [{
          postDate: "02 MAR",
          transactionDate: "01 MAR",
          description: "RACE MID CYCLE",
          reference: "RACE-1",
          amountMinor: 1_000
        }]
      }]
    }));

    const previewBodies = [];
    importFlowPage.on("request", (request) => {
      if (!request.url().includes("/api/imports/preview") || request.method() !== "POST") {
        return;
      }
      try {
        previewBodies.push(request.postDataJSON());
      } catch {
        previewBodies.push(null);
      }
    });

    await importFlowPage.goto("/imports?view=person-tim&month=2026-03");
    await expect(importFlowPage.getByLabel("Source label")).toBeVisible({ timeout: 60_000 });

    const firstPreviewResponsePromise = importFlowPage.waitForResponse((response) => (
      response.url().includes("/api/imports/preview") && response.request().method() === "POST"
    ), { timeout: 60_000 });
    await importFlowPage.locator("input[type=\"file\"]").setInputFiles(pdfPath);
    const firstPreviewResponse = await firstPreviewResponsePromise;
    if (!firstPreviewResponse.ok()) {
      throw new Error(await firstPreviewResponse.text());
    }
    const firstPreview = await firstPreviewResponse.json();

    expect(previewBodies[0]?.sourceType).toBe("pdf");
    expect(firstPreview.preview.statementReconciliations[0].status).toBe("matched");
    expect(firstPreview.preview.previewRows[0].reconciliationTargetTransactionId).toBeTruthy();
    await expect(importFlowPage.getByText("1 statement mismatch")).toHaveCount(0);
    await expect(importFlowPage.getByText("1 existing row will be certified by the statement").first()).toBeVisible();
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
      await expect(importFlowPage.locator(".statement-reconciliation-row").first()).toHaveCSS("display", "grid");
      await expect(importFlowPage.locator(".statement-reconciliation-row").first()).toHaveCSS("grid-template-columns", /px$/);
    };

    // The first statement asks for each card's account. Its commit
    // remembers the cards' last four digits, so later statements map the
    // same cards on their own.
    const uploadPdfAndMap = async (path, { expectUnknownAccounts = true } = {}) => {
      await importFlowPage.goto("/imports?view=person-tim&month=2026-02");
      await expect(importFlowPage).toHaveURL(/\/imports/);
      try {
        await expect(importFlowPage.getByLabel("Source label")).toBeVisible({ timeout: 10_000 });
      } catch {
        await importFlowPage.reload();
      }
      await expect(importFlowPage.getByLabel("Source label")).toBeVisible({ timeout: 60_000 });
      const fileInput = importFlowPage.locator("input[type=\"file\"]");
      await fileInput.setInputFiles(path);
      if (!expectUnknownAccounts) {
        await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: alphaAccount.name })).toBeVisible();
        await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: betaAccount.name })).toBeVisible();
        await expect(importFlowPage.getByText("Unknown accounts need mapping before commit.")).toHaveCount(0);
        return;
      }
      await expect(importFlowPage.getByText("Unknown accounts need mapping before commit.")).toBeVisible();
      await mapDetectedAccounts();
    };

    const commitCurrentPreview = async () => {
      await expect(importFlowPage.getByRole("button", { name: /Commit import/ }).first()).toBeEnabled();
      const commitResponse = importFlowPage.waitForResponse(
        (response) => response.url().includes("/api/imports/commit") && response.ok(),
        { timeout: 60_000 }
      );
      await importFlowPage.getByRole("button", { name: /Commit import/ }).first().click();
      await commitResponse;
      await expect(importFlowPage.getByText("No preview yet.").first()).toBeVisible({ timeout: 60_000 });
    };

    await uploadPdfAndMap(janPdfPath);
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: alphaAccount.name }).locator(".pill.success")).toBeVisible();
    await expect(importFlowPage.locator(".statement-reconciliation-row").filter({ hasText: betaAccount.name }).locator(".pill.success")).toBeVisible();
    await screenshot("01-jan-two-card-pdf-mapped-and-matched");
    await commitCurrentPreview();

    await uploadPdfAndMap(janPdfPath, { expectUnknownAccounts: false });
    await expect(importFlowPage.getByText("2 statement checkpoints will refresh").first()).toBeVisible();
    await expect(importFlowPage.getByText("This statement has no transaction rows. Only the statement checkpoint will be saved.").first()).toBeVisible();
    await expect(importFlowPage.getByRole("button", { name: "Save empty statement checkpoint" }).first()).toBeEnabled();
    await screenshot("02-jan-two-card-pdf-all-duplicates-save-checkpoints");
    const emptyCheckpointResponse = importFlowPage.waitForResponse(
      (response) => response.url().includes("/api/imports/commit") && response.ok(),
      { timeout: 60_000 }
    );
    await importFlowPage.getByRole("button", { name: "Save empty statement checkpoint" }).first().click();
    await emptyCheckpointResponse;
    await expect(importFlowPage.getByText("No preview yet.").first()).toBeVisible({ timeout: 60_000 });

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
      await expect(importFlowPage.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(importFlowPage.getByText("Source label")).toBeVisible({ timeout: 60_000 });
      await expect(importFlowPage.getByLabel("Source label")).toBeVisible({ timeout: 60_000 });
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

    await uploadPdfAndMap(febPdfPath, { expectUnknownAccounts: false });
    await expect(importFlowPage.getByText("1 row will import").first()).toBeVisible();
    await expect(importFlowPage.getByText("7 existing rows will be certified by the statement").first()).toBeVisible();
    await expect(importFlowPage.locator(`input[value="${febAlphaRows[0].description}"]`)).toHaveCount(0);
    await expect(importFlowPage.locator(`input[value="${febBetaRows[0].description}"]`)).toHaveCount(0);
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

  test("import preview resource-limit failures link to settings diagnostics", async ({ page }) => {
    await reseedDemo(page);
    await page.route("**/api/imports/preview", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "text/html",
        body: "<html><body><h1>Worker exceeded resource limits</h1><style>body{margin:0;padding:0}</style></body></html>"
      });
    });

    await gotoImportsPage(page);
    await page.getByLabel("CSV content").fill([
      "date,description,expense,account,category",
      "2026-06-02,Funds Transfer HDB mortgage,450.00,UOB One,Transfer"
    ].join("\n"));

    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.getByText("Cloudflare ended the request because the Worker exceeded resource limits")).toBeVisible();
    await expect(page.getByText("body{margin:0")).toHaveCount(0);
    await page.getByRole("link", { name: "Open error diagnostics" }).click();
    await expect(page).toHaveURL(/settings_section=errorDiagnostics/);
    await expect(page.getByRole("button", { name: /Error diagnostics/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Preview import: Imported CSV (1 rows, csv)")).toBeVisible();
    await page.getByText("Preview import: Imported CSV (1 rows, csv)").click();
    await expect(page.getByText("Previous action", { exact: true })).toBeVisible();
    const savedResponseBody = page.locator(".settings-diagnostic-block pre").filter({ hasText: "Worker exceeded resource limits" });
    await expect(savedResponseBody).toBeVisible();
    await expect(savedResponseBody).toContainText("body{margin:0");
  });

  test("import commit resource-limit failures link recent status to settings diagnostics", async ({ page }) => {
    await reseedDemo(page);
    await page.route("**/api/imports/commit", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "text/html",
        body: "<html><body><h1>Worker exceeded resource limits</h1><style>body{margin:0;padding:0}</style></body></html>"
      });
    });

    await gotoImportsPage(page);
    await page.getByLabel("CSV content").fill([
      "date,description,expense,account,category",
      "2026-06-02,Funds Transfer HDB mortgage,450.00,UOB One,Transfer"
    ].join("\n"));

    await page.getByRole("button", { name: "Preview import" }).click();
    await page.getByRole("button", { name: "Commit import to ledger" }).first().click();
    const recentStatus = page.locator(".import-history-refreshing.is-error");
    await expect(recentStatus).toContainText("Import commit failed. HTTP 503");
    await recentStatus.getByRole("link", { name: "Open error diagnostics" }).click();
    await expect(page).toHaveURL(/settings_section=errorDiagnostics/);
    await expect(page.getByRole("button", { name: /Error diagnostics/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Commit import: Imported CSV (1 rows, csv)")).toBeVisible();
  });

  test("pasted Citi activity CSV is recognized without manual column mapping", async ({ page }) => {
    await reseedDemo(page);
    const referenceData = await loadReferenceData(page);
    if (!referenceData.accounts.some((item) => item.name === "Citi Rewards")) {
      await createCitiRewardsAccount(page);
    }
    await gotoImportsPage(page, "2026-08");

    await page.getByLabel("Default account").selectOption({ label: "Citi Rewards - Joyce" });
    await page.getByLabel("CSV content").fill([
      `"23/08/2026","CLOUDFLARE             SAN FRANCISCO USA USD 3.34 USD 3.34","-4.25","","'5425503003296349'"`,
      `"22/08/2026","HBOMax help.hbomax.com SG            SGP","-18.98","","'5425503003296349'"`,
      `"20/08/2026","SHOPEE SG MP           SINGAPORE     SGP","-7.62","","'5425503003296349'"`
    ].join("\n"));

    await expect(page.getByText("3 rows ready for review.")).toBeVisible({ timeout: 30_000 });
  });
});
