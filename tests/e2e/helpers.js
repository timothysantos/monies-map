import { expect } from "@playwright/test";

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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await page.request.post(path, { data: body });
      const responseText = await response.text();
      if (!response.ok()) {
        if (responseText.includes("worker restarted mid-request") && attempt === 0) {
          continue;
        }
        expect(response.ok(), responseText).toBeTruthy();
      }
      return responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      lastError = error;
      if (attempt === 0 && String(error?.message ?? error).includes("worker restarted mid-request")) {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error(`POST ${path} failed`);
}

export async function loadSplitsPage(page, { view = "person-tim", month = "2025-10" } = {}) {
  const response = await page.request.get(`/api/splits-page?view=${view}&month=${month}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function loadEntriesPage(page, { view = "person-tim", month = "2026-04" } = {}) {
  const response = await page.request.get(`/api/entries-page?view=${view}&month=${month}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function loadAppShell(page, { month = "2026-04", scope = "direct_plus_shared" } = {}) {
  const response = await page.request.get(`/api/app-shell?month=${month}&scope=${scope}`);
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

export async function loadSettingsPage(page) {
  const response = await page.request.get("/api/settings-page");
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
