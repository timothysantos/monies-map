import assert from "node:assert/strict";
import test from "node:test";

import { queryKeys } from "../src/client/query-keys.js";
import {
  invalidateAppShellQueries,
  invalidateImportMutationQueries,
  invalidateImportsPageQueries,
  invalidateEntriesMutationQueries,
  invalidateMonthQueries,
  invalidateSplitsPageQueries,
  invalidateSummaryAccountPillQueries,
  invalidateSummaryPageQueries
} from "../src/client/query-mutations.js";

function createFakeQueryClient() {
  const calls = [];

  return {
    calls,
    async cancelQueries({ queryKey }) {
      calls.push(["cancel", queryKey]);
    },
    async invalidateQueries({ queryKey }) {
      calls.push(["invalidate", queryKey]);
    }
  };
}

test("queryKeys.appShell normalizes its params", () => {
  assert.deepEqual(queryKeys.appShell({ selectedViewId: "household", month: "2026-04" }), [
    "app-shell",
    {
      month: "2026-04",
      selectedViewId: "household"
    }
  ]);
});

test("queryKeys.importsPage returns a stable slice key", () => {
  assert.deepEqual(queryKeys.importsPage(), ["imports-page"]);
});

test("queryKeys.settingsPage returns a stable slice key", () => {
  assert.deepEqual(queryKeys.settingsPage(), ["settings-page"]);
});

test("queryKeys.summaryAccountPills returns a stable slice key", () => {
  assert.deepEqual(queryKeys.summaryAccountPills({ viewId: "household" }), [
    "summary-account-pills",
    {
      viewId: "household"
    }
  ]);
});

test("queryKeys.splitsPage returns a stable slice key", () => {
  assert.deepEqual(queryKeys.splitsPage({ viewId: "person-tim", month: "2025-10" }), [
    "splits-page",
    {
      month: "2025-10",
      viewId: "person-tim"
    }
  ]);
});

test("queryKeys.routeRequestKey routes settings to the dedicated settings key", () => {
  assert.deepEqual(queryKeys.routeRequestKey({
    path: "/api/settings-page",
    params: new URLSearchParams([["settings_section", "categoryRules"]])
  }), ["settings-page"]);
});

test("queryKeys.routeRequestKey routes month to the dedicated month key", () => {
  assert.deepEqual(queryKeys.routeRequestKey({
    path: "/api/month-page",
    params: new URLSearchParams([["month", "2026-04"], ["viewId", "household"], ["scope", "direct_plus_shared"]])
  }), ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]);
});

test("queryKeys.routeRequestKey keeps unsupported route pages on route-page keys", () => {
  assert.deepEqual(queryKeys.routeRequestKey({
    path: "/faq",
    params: new URLSearchParams()
  }), ["route-page", { path: "/faq", params: {} }]);
});

test("invalidateAppShellQueries only targets the app shell key", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateAppShellQueries(queryClient, { selectedViewId: "household" });

  assert.deepEqual(queryClient.calls, [
    ["cancel", ["app-shell", { selectedViewId: "household" }]],
    ["invalidate", ["app-shell", { selectedViewId: "household" }]]
  ]);
});

test("invalidateImportsPageQueries only targets the imports page key", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateImportsPageQueries(queryClient);

  assert.deepEqual(queryClient.calls, [
    ["cancel", ["imports-page"]],
    ["invalidate", ["imports-page"]]
  ]);
});

test("invalidateSummaryPageQueries only targets the summary page key", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateSummaryPageQueries(queryClient, {
    viewId: "household",
    scope: "direct_plus_shared",
    startMonth: "2026-01",
    endMonth: "2026-04"
  });

  assert.deepEqual(queryClient.calls, [
    ["cancel", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
});

test("invalidateSummaryAccountPillQueries only targets the wallet pill key", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateSummaryAccountPillQueries(queryClient, { viewId: "household" });

  assert.deepEqual(queryClient.calls, [
    ["cancel", ["summary-account-pills", { viewId: "household" }]],
    ["invalidate", ["summary-account-pills", { viewId: "household" }]]
  ]);
});

test("invalidateSplitsPageQueries only targets the splits page key", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateSplitsPageQueries(queryClient, { viewId: "person-tim", month: "2025-10" });

  assert.deepEqual(queryClient.calls, [
    ["cancel", ["splits-page", { month: "2025-10", viewId: "person-tim" }]],
    ["invalidate", ["splits-page", { month: "2025-10", viewId: "person-tim" }]]
  ]);
});

test("invalidateMonthQueries targets exact month, entries, and summary keys", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateMonthQueries(queryClient, {
    entriesParams: new URLSearchParams([["view", "household"], ["month", "2026-04"]]),
    month: "2026-04",
    scope: "direct_plus_shared",
    summaryRange: { startMonth: "2026-01", endMonth: "2026-04" },
    viewId: "household"
  });

  assert.deepEqual(queryClient.calls.slice(0, 3), [
    ["cancel", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["cancel", ["entries-page", { month: "2026-04", view: "household" }]],
    ["cancel", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(3), [
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["entries-page", { month: "2026-04", view: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
});

test("invalidateEntriesMutationQueries targets exact entries, month, and summary keys", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateEntriesMutationQueries(queryClient, {
    entriesParams: new URLSearchParams([["view", "household"], ["month", "2026-04"], ["type", "expense"]]),
    monthKey: "2026-04",
    scope: "direct_plus_shared",
    summaryRange: { startMonth: "2026-01", endMonth: "2026-04" },
    viewId: "household"
  });

  assert.deepEqual(queryClient.calls.slice(0, 3), [
    ["cancel", ["entries-page", { month: "2026-04", type: "expense", view: "household" }]],
    ["cancel", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["cancel", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(3), [
    ["invalidate", ["entries-page", { month: "2026-04", type: "expense", view: "household" }]],
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
});

test("invalidateImportMutationQueries targets imports, entries, month, and summary keys", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateImportMutationQueries(queryClient, {
    entriesParams: new URLSearchParams([["view", "household"], ["month", "2026-04"]]),
    monthKeys: ["2026-04"],
    scope: "direct_plus_shared",
    summaryRange: { startMonth: "2026-01", endMonth: "2026-04" },
    viewId: "household"
  });

  assert.deepEqual(queryClient.calls.slice(0, 4), [
    ["cancel", ["imports-page"]],
    ["cancel", ["entries-page", { month: "2026-04", view: "household" }]],
    ["cancel", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["cancel", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(4), [
    ["invalidate", ["imports-page"]],
    ["invalidate", ["entries-page", { month: "2026-04", view: "household" }]],
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
});
