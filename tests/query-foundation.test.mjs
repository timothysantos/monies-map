import assert from "node:assert/strict";
import test from "node:test";

import { queryKeys } from "../src/client/query-keys.js";
import {
  invalidateAppShellQueries,
  invalidateImportMutationQueries,
  invalidateImportsPageQueries,
  invalidateEntriesMutationQueries,
  invalidateMonthQueries
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
    ["cancel", ["summary-page", { endMonth: "2026-04", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(3), [
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["entries-page", { month: "2026-04", view: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", startMonth: "2026-01", viewId: "household" }]]
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
    ["cancel", ["summary-page", { endMonth: "2026-04", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(3), [
    ["invalidate", ["entries-page", { month: "2026-04", type: "expense", view: "household" }]],
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", startMonth: "2026-01", viewId: "household" }]]
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
    ["cancel", ["summary-page", { endMonth: "2026-04", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(4), [
    ["invalidate", ["imports-page"]],
    ["invalidate", ["entries-page", { month: "2026-04", view: "household" }]],
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", startMonth: "2026-01", viewId: "household" }]]
  ]);
});
