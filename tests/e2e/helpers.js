import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

export async function gotoPageAfterApi(page, path, apiPath, readyLocator) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const pageReady = page.waitForResponse(
        (response) => response.url().includes(apiPath) && response.ok(),
        { timeout: 60_000 }
      );
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await pageReady;
      await readyLocator().waitFor({ state: "visible", timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`${path} did not become ready.`);
}

export async function reseedDemo(page) {
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

export async function postJson(page, path, body) {
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await page.request.post(path, { data: body });
      const responseText = await response.text();
      if (!response.ok()) {
        if ((responseText.includes("worker restarted mid-request") || responseText.includes("socket hang up")) && attempt < 7) {
          continue;
        }
        expect(response.ok(), responseText).toBeTruthy();
      }
      return responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      lastError = error;
      const errorMessage = String(error?.message ?? error);
      if (attempt < 7 && (errorMessage.includes("worker restarted mid-request") || errorMessage.includes("socket hang up"))) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error(`POST ${path} failed`);
}

export async function loadSplitsPage(page, { view = "person-tim", month = "2025-10" } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await page.request.get(`/api/splits-page?view=${view}&month=${month}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    } catch (error) {
      lastError = error;
      const errorMessage = String(error?.message ?? error);
      if (attempt < 7 && (errorMessage.includes("ECONNRESET") || errorMessage.includes("socket hang up"))) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("GET /api/splits-page failed");
}

export async function loadImportsPage(page) {
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await page.request.get("/api/imports-page");
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    } catch (error) {
      lastError = error;
      const errorMessage = String(error?.message ?? error);
      if (attempt < 7 && (
        errorMessage.includes("ECONNRESET")
        || errorMessage.includes("socket hang up")
        || errorMessage.includes("worker restarted mid-request")
      )) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("GET /api/imports-page failed");
}

export async function loadEntriesPage(page, { view = "person-tim", month = "2026-04" } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await page.request.get(`/api/entries-page?view=${view}&month=${month}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    } catch (error) {
      lastError = error;
      const errorMessage = String(error?.message ?? error);
      if (attempt < 7 && (errorMessage.includes("ECONNRESET") || errorMessage.includes("socket hang up"))) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("GET /api/entries-page failed");
}

export async function loadAppShell(page, { month = "2026-04", scope = "direct_plus_shared" } = {}) {
  const response = await page.request.get(`/api/app-shell?month=${month}&scope=${scope}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function loadReferenceData(page) {
  const response = await page.request.get("/api/reference-data");
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function loadMonthPage(page, { view = "person-tim", month = "2026-04", scope = "direct_plus_shared" } = {}) {
  const response = await page.request.get(`/api/month-page?view=${view}&month=${month}&scope=${scope}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function loadSummaryPage(
  page,
  {
    view = "person-tim",
    month = "2026-04",
    scope = "direct_plus_shared",
    summaryStart = "2025-06",
    summaryEnd = "2026-04"
  } = {}
) {
  const response = await page.request.get(
    `/api/summary-page?view=${view}&month=${month}&scope=${scope}&summary_start=${summaryStart}&summary_end=${summaryEnd}`
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function loadSummaryAccountPills(page, { view = "person-tim" } = {}) {
  const response = await page.request.get(`/api/summary-account-pills?view=${view}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function loadSettingsPage(page) {
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await page.request.get("/api/settings-page");
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    } catch (error) {
      lastError = error;
      const errorMessage = String(error?.message ?? error);
      if (attempt < 7 && (
        errorMessage.includes("ECONNRESET")
        || errorMessage.includes("socket hang up")
        || errorMessage.includes("worker restarted mid-request")
      )) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("GET /api/settings-page failed");
}

// Imports keeps pasted rows and the import defaults behind "Paste rows or
// set defaults"; these open it (when it is closed) before using a field.
export async function openPasteRowsAndDefaults(page) {
  const toggle = page.getByRole("button", { name: "Paste rows or set defaults" });
  await toggle.waitFor({ state: "visible", timeout: 60_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

export async function fillImportField(page, label, value) {
  await openPasteRowsAndDefaults(page);
  await page.getByLabel(label).fill(value);
}

export async function selectImportField(page, label, option) {
  await openPasteRowsAndDefaults(page);
  await page.getByLabel(label).selectOption(option);
}

// Recent imports starts closed on Imports; this opens it.
export async function openRecentImports(page) {
  const toggle = page.locator(".import-history-toggle");
  await toggle.waitFor({ state: "visible", timeout: 60_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

// Drops files on an element the way a browser does: dragenter, dragover,
// then drop, all carrying the same DataTransfer.
export async function dropFiles(page, selector, files, { drop = true } = {}) {
  const payload = await Promise.all(files.map(async (file) => ({
    name: file.name,
    type: file.type,
    base64: (await readFile(file.path)).toString("base64")
  })));
  const dataTransfer = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const bytes = Uint8Array.from(atob(item.base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: item.type }));
    }
    return transfer;
  }, payload);
  await page.dispatchEvent(selector, "dragenter", { dataTransfer });
  await page.dispatchEvent(selector, "dragover", { dataTransfer });
  if (drop) {
    await page.dispatchEvent(selector, "drop", { dataTransfer });
  }
}

// Once a file is in review the Bring files step says how many rows are
// ready. The import bar folds that line away while it is stuck to the top,
// so this reads the step whether or not the line is shown.
export async function expectImportRowsReady(page, text, { timeout = 60_000 } = {}) {
  await expect(page.locator(".import-stepper-step").first()).toContainText(text, { timeout });
}

// What the Summary and Month lead show, worked out from a page DTO by hand
// (DOMAIN.md "Money job"): money filed under Investments or Savings was moved,
// not spent, and the savings target and Investments plan rows are not spend
// plan. `spent` and `planned` are the lead's headline and its plan, `kept` is
// the Saved figure. Pass the Summary page (its "Planned investments" card) or
// the Month page (its plan rows).
export function leadFigures(page) {
  const summaryPage = page.summaryPage?.metricCards ? page.summaryPage : null;
  const cards = summaryPage ? summaryPage.metricCards : page.monthPage.metricCards;
  const card = (label) => cards.find((item) => item.label === label)?.amountMinor ?? 0;
  const chart = summaryPage ? summaryPage.categoryShareChart : page.monthPage.categoryShareChart;
  const slice = (label) => chart.find((item) => item.label === label)?.valueMinor ?? 0;
  const rows = summaryPage ? [] : page.monthPage.planSections.flatMap((section) => section.rows);
  const investPlan = summaryPage
    ? card("Planned investments")
    : rows.filter((row) => row.label !== "Savings" && row.categoryName === "Investments").reduce((sum, row) => sum + row.plannedMinor, 0);
  const income = summaryPage ? card("Actual income") : page.summaryPage.months[0].actualIncomeMinor;
  const invested = slice("Investments");
  const spent = Math.max(0, card("Actual spend") - invested - slice("Savings"));
  const planned = Math.max(0, card("Planned spend") - card("Savings target") - investPlan);
  return { income, invested, spent, planned, savingsTarget: card("Savings target"), kept: income - spent - invested };
}
