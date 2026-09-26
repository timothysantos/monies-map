import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, hashKey } from "@tanstack/react-query";

import { monthPageKeyFromParams, queryKeys, summaryPageKeyFromParams } from "../src/client/query-keys.js";
import { buildAppShellParams } from "../src/client/app-shell-query.js";
import { buildPageViewFromRouteData, buildRoutePageRequest } from "../src/client/app-routing.js";
import { buildSummaryPageParams } from "../src/client/summary-query.js";
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
    },
    removeQueries({ queryKey }) {
      calls.push(["remove", queryKey]);
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

test("buildAppShellParams keeps the shell route-neutral", () => {
  const params = buildAppShellParams({
    selectedViewId: "person-tim",
    selectedMonth: "2026-06",
    selectedScope: "direct_only",
    summaryStartMonth: "2026-01",
    summaryEndMonth: "2026-06"
  });

  assert.deepEqual([...params.entries()], []);
});

test("queryKeys.referenceData returns a stable reference slice key", () => {
  assert.deepEqual(queryKeys.referenceData(), ["reference-data"]);
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

test("queryKeys.summaryPage includes selected month when range params are implicit", () => {
  assert.deepEqual(queryKeys.summaryPage({
    viewId: "household",
    month: "2026-05",
    scope: "direct_plus_shared",
    startMonth: "",
    endMonth: ""
  }), [
    "summary-page",
    {
      endMonth: "",
      month: "2026-05",
      scope: "direct_plus_shared",
      startMonth: "",
      viewId: "household"
    }
  ]);
});

test("queryKeys.summaryPage keeps different implicit summary months isolated", () => {
  assert.notDeepEqual(
    queryKeys.summaryPage({ viewId: "household", month: "2026-04", scope: "direct_plus_shared", startMonth: "", endMonth: "" }),
    queryKeys.summaryPage({ viewId: "household", month: "2026-05", scope: "direct_plus_shared", startMonth: "", endMonth: "" })
  );
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
  // The app sends `view` in the URL; the key names it `viewId`.
  assert.deepEqual(queryKeys.routeRequestKey({
    path: "/api/month-page",
    params: new URLSearchParams([["month", "2026-04"], ["view", "household"], ["scope", "direct_plus_shared"]])
  }), ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]);
});

function monthRouteKey(viewId, month = "2026-05") {
  return queryKeys.routeRequestKey(buildRoutePageRequest({ tabId: "month", viewId, month, scope: "direct_plus_shared" }));
}

test("month route keys keep each person's page separate", () => {
  assert.deepEqual(monthRouteKey("person-tim"), [
    "month-page",
    { month: "2026-05", scope: "direct_plus_shared", viewId: "person-tim" }
  ]);
  assert.notEqual(hashKey(monthRouteKey("person-tim")), hashKey(monthRouteKey("household")));
  assert.notEqual(hashKey(monthRouteKey("person-tim")), hashKey(monthRouteKey("person-joyce")));
  assert.notEqual(hashKey(monthRouteKey("person-tim", "2026-04")), hashKey(monthRouteKey("person-tim", "2026-05")));
  assert.notEqual(
    hashKey(queryKeys.routeRequestKey(buildRoutePageRequest({ tabId: "month", viewId: "person-tim", month: "2026-05", scope: "direct" }))),
    hashKey(monthRouteKey("person-tim"))
  );
});

test("a Month mutation for Tim invalidates only Tim's cached month page", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(monthRouteKey("household"), { v: 100 });
  queryClient.setQueryData(monthRouteKey("person-tim"), { v: 200 });

  await invalidateMonthQueries(queryClient, { viewId: "person-tim", month: "2026-05", scope: "direct_plus_shared" });

  assert.equal(queryClient.getQueryState(monthRouteKey("person-tim")).isInvalidated, true);
  assert.equal(queryClient.getQueryState(monthRouteKey("household")).isInvalidated, false);
  assert.deepEqual(queryClient.getQueryData(monthRouteKey("person-tim")), { v: 200 });
  assert.deepEqual(queryClient.getQueryData(monthRouteKey("household")), { v: 100 });
  queryClient.clear();
});

function summaryParams(viewId, { month = "2026-05", summaryStart, summaryEnd } = {}) {
  return buildSummaryPageParams({ viewId, month, scope: "direct_plus_shared", summaryStart, summaryEnd });
}

test("summary route keys translate view and range params like the summary query", () => {
  const timRange = summaryParams("person-tim", { summaryStart: "2025-06", summaryEnd: "2026-05" });
  const routeKey = queryKeys.routeRequestKey({ path: "/api/summary-page", params: timRange });

  assert.deepEqual(routeKey, [
    "summary-page",
    { endMonth: "2026-05", month: "2026-05", scope: "direct_plus_shared", startMonth: "2025-06", viewId: "person-tim" }
  ]);
  assert.deepEqual(routeKey, summaryPageKeyFromParams(timRange));
  assert.notEqual(
    hashKey(routeKey),
    hashKey(summaryPageKeyFromParams(summaryParams("household", { summaryStart: "2025-06", summaryEnd: "2026-05" })))
  );
  assert.notEqual(
    hashKey(routeKey),
    hashKey(summaryPageKeyFromParams(summaryParams("person-tim", { summaryStart: "2025-07", summaryEnd: "2026-05" })))
  );
});

test("implicit summary ranges stay keyed by the selected month", () => {
  assert.deepEqual(summaryPageKeyFromParams(summaryParams("household")), [
    "summary-page",
    { endMonth: "", month: "2026-05", scope: "direct_plus_shared", startMonth: "", viewId: "household" }
  ]);
  assert.notEqual(
    hashKey(queryKeys.routeRequestKey({ path: "/api/summary-page", params: summaryParams("household", { month: "2026-04" }) })),
    hashKey(queryKeys.routeRequestKey({ path: "/api/summary-page", params: summaryParams("household") }))
  );
});

test("URL-to-key helpers accept URL params and normalized records alike", () => {
  const params = new URLSearchParams({ view: "person-tim", month: "2026-05", scope: "direct_plus_shared" });
  assert.deepEqual(monthPageKeyFromParams(params), monthPageKeyFromParams(Object.fromEntries(params)));
  assert.deepEqual(monthPageKeyFromParams(new URLSearchParams()), [
    "month-page",
    { month: "", scope: "direct_plus_shared", viewId: "household" }
  ]);
});

function invalidatedKeys(calls) {
  return calls.filter(([action]) => action === "invalidate").map(([, queryKey]) => hashKey(queryKey));
}

for (const viewId of ["household", "person-tim"]) {
  test(`fetch and mutation invalidation build the same keys for ${viewId}`, async () => {
    const month = "2026-05";
    const scope = "direct_plus_shared";
    const monthKey = monthRouteKey(viewId, month);
    const entriesRequest = buildRoutePageRequest({ tabId: "entries", viewId, month, scope });
    const entriesKey = queryKeys.routeRequestKey(entriesRequest);
    const summaryKey = summaryPageKeyFromParams(summaryParams(viewId, { summaryStart: "2026-01", summaryEnd: month }));

    const monthClient = createFakeQueryClient();
    await invalidateMonthQueries(monthClient, {
      entriesParams: entriesRequest.params,
      month,
      scope,
      summaryRange: { startMonth: "2026-01", endMonth: month },
      viewId
    });
    assert.deepEqual(invalidatedKeys(monthClient.calls), [hashKey(monthKey), hashKey(entriesKey), hashKey(summaryKey)]);

    const entriesClient = createFakeQueryClient();
    await invalidateEntriesMutationQueries(entriesClient, {
      entriesParams: entriesRequest.params,
      monthKey: month,
      scope,
      summaryRange: { startMonth: "2026-01", endMonth: month },
      viewId
    });
    assert.deepEqual(invalidatedKeys(entriesClient.calls), [hashKey(entriesKey), hashKey(monthKey), hashKey(summaryKey)]);

    const importClient = createFakeQueryClient();
    await invalidateImportMutationQueries(importClient, {
      entriesParams: entriesRequest.params,
      monthKeys: [month],
      scope,
      viewId
    });
    assert.deepEqual(invalidatedKeys(importClient.calls), [hashKey(queryKeys.importsPage()), hashKey(entriesKey), hashKey(monthKey)]);
  });
}

test("Entries keys use URL param names, so domain-named params cannot invalidate them", () => {
  const fetched = queryKeys.routeRequestKey(buildRoutePageRequest({ tabId: "entries", viewId: "person-tim", month: "2026-05" }));
  assert.deepEqual(fetched, ["entries-page", { month: "2026-05", view: "person-tim" }]);
  assert.notEqual(hashKey(queryKeys.entriesPage({ viewId: "person-tim", month: "2026-05" })), hashKey(fetched));
});

test("queryKeys.routeRequestKey keeps unsupported route pages on route-page keys", () => {
  assert.deepEqual(queryKeys.routeRequestKey({
    path: "/faq",
    params: new URLSearchParams()
  }), ["route-page", { path: "/faq", params: {} }]);
});

test("FAQ route view does not require a server page payload", () => {
  assert.deepEqual(buildPageViewFromRouteData("faq", null, "person-tim", {
    household: {
      people: [
        { id: "person-tim", name: "Tim" }
      ]
    }
  }), {
    id: "person-tim",
    label: "Tim"
  });
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
    ["cancel", ["summary-page", { endMonth: "2026-04", month: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(3), [
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["entries-page", { month: "2026-04", view: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", month: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
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
    ["cancel", ["summary-page", { endMonth: "2026-04", month: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(3), [
    ["invalidate", ["entries-page", { month: "2026-04", type: "expense", view: "household" }]],
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", month: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
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
    ["cancel", ["summary-page", { endMonth: "2026-04", month: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.deepEqual(queryClient.calls.slice(4), [
    ["invalidate", ["imports-page"]],
    ["invalidate", ["entries-page", { month: "2026-04", view: "household" }]],
    ["invalidate", ["month-page", { month: "2026-04", scope: "direct_plus_shared", viewId: "household" }]],
    ["invalidate", ["summary-page", { endMonth: "2026-04", month: "2026-04", scope: "direct_plus_shared", startMonth: "2026-01", viewId: "household" }]]
  ]);
  assert.equal(queryClient.calls.some(([, queryKey]) => queryKey[0] === "app-shell"), false);
  assert.equal(queryClient.calls.some(([, queryKey]) => queryKey[0] === "splits-page"), false);
});

test("an import rollback also clears every cached Splits page, since it can unlink or move a linked split", async () => {
  const queryClient = createFakeQueryClient();

  await invalidateImportMutationQueries(queryClient, {
    invalidateSplits: true,
    scope: "direct_plus_shared",
    viewId: "person-tim"
  });

  assert.deepEqual(queryClient.calls, [
    ["cancel", ["imports-page"]],
    ["cancel", ["splits-page"]],
    ["invalidate", ["imports-page"]],
    // Removed, not only marked stale: route pages are served from any cached
    // copy, so a stale Splits page would still be shown.
    ["remove", ["splits-page"]]
  ]);
});
