// API contract tests that moved out of the Playwright suite (see
// docs/audits/e2e-unit-audit.md). They call the real Worker routes against a
// real local D1 (tests/support/d1-workspace.mjs) instead of a browser page.
//
// `createWorkerRequest` stands in for Playwright's `page.request` and the
// helpers below keep the names and shapes of tests/e2e/helpers.js, so a moved
// test keeps its requests and its Playwright `expect` assertions verbatim:
// the only change is that nothing starts a browser, Vite or wrangler.
import test from "node:test";
import { expect } from "@playwright/test";

import { createSeededTemplate, openSeededDatabase } from "./d1-workspace.mjs";

// Call once at the top of a test file. Seeds the demo household once (what
// each Playwright test did with /api/demo/reseed) and returns
// `openRequest(t)`, which gives a test its own copy of that database.
export function useSeededWorkerRequest() {
  let template;
  test.before(async () => {
    template = await createSeededTemplate();
  });
  test.after(async () => {
    await template?.dispose();
  });
  return async (t) => createWorkerRequest(await openSeededDatabase(t, template));
}

function wrapResponse(response, text) {
  return {
    ok: () => response.ok,
    status: () => response.status,
    headers: () => Object.fromEntries(response.headers.entries()),
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

export function createWorkerRequest(workspace) {
  async function send(pathname, init) {
    const response = await workspace.fetch(pathname, init);
    return wrapResponse(response, await response.text());
  }
  return {
    get: (pathname) => send(pathname, { method: "GET" }),
    post: (pathname, { data } = {}) => send(pathname, {
      method: "POST",
      headers: data === undefined ? undefined : { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data)
    }),
    // Relative `fetch` calls inside `callback` go to the Worker, the way
    // `page.evaluate(() => fetch("/api/..."))` reached it from the page.
    // node:test runs a file's tests one at a time, so swapping the global
    // is safe; it is restored before this returns.
    async evaluate(callback, argument) {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (pathname, init) => workspace.fetch(pathname, init);
      try {
        return await callback(argument);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  };
}

export async function postJson(request, path, body) {
  const response = await request.post(path, { data: body });
  const responseText = await response.text();
  expect(response.ok(), responseText).toBeTruthy();
  return responseText ? JSON.parse(responseText) : {};
}

async function getJson(request, path) {
  const response = await request.get(path);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export function loadSplitsPage(request, { view = "person-tim", month = "2025-10" } = {}) {
  return getJson(request, `/api/splits-page?view=${view}&month=${month}`);
}

export function loadImportsPage(request) {
  return getJson(request, "/api/imports-page");
}

export function loadEntriesPage(request, { view = "person-tim", month = "2026-04" } = {}) {
  return getJson(request, `/api/entries-page?view=${view}&month=${month}`);
}

export function loadAppShell(request, { month = "2026-04", scope = "direct_plus_shared" } = {}) {
  return getJson(request, `/api/app-shell?month=${month}&scope=${scope}`);
}

export function loadReferenceData(request) {
  return getJson(request, "/api/reference-data");
}

export function loadMonthPage(request, { view = "person-tim", month = "2026-04", scope = "direct_plus_shared" } = {}) {
  return getJson(request, `/api/month-page?view=${view}&month=${month}&scope=${scope}`);
}

export function loadSummaryPage(
  request,
  { view = "person-tim", month = "2026-04", scope = "direct_plus_shared", summaryStart = "2025-06", summaryEnd = "2026-04" } = {}
) {
  return getJson(
    request,
    `/api/summary-page?view=${view}&month=${month}&scope=${scope}&summary_start=${summaryStart}&summary_end=${summaryEnd}`
  );
}

export function loadSummaryAccountPills(request, { view = "person-tim" } = {}) {
  return getJson(request, `/api/summary-account-pills?view=${view}`);
}

export function loadSettingsPage(request) {
  return getJson(request, "/api/settings-page");
}
