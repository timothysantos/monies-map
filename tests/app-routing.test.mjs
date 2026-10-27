import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPageViewFromRouteData,
  buildRoutePageRequest,
  getAppShellAvailableViewIds,
  getSelectedTabId,
  resolveRouteViewId,
  sanitizeTabParams
} from "../src/client/app-routing.js";

test("/check is the Check my books page; it has no page request of its own and takes the shell's person", () => {
  assert.equal(getSelectedTabId("/check"), "check");
  // Only the exact path: no other page is read as Check my books.
  assert.equal(getSelectedTabId("/checkout"), "summary");
  assert.equal(getSelectedTabId("/entries"), "entries");
  assert.equal(buildRoutePageRequest({ tabId: "check", viewId: "person-tim", month: "2026-05", scope: "direct" }), null);
  const shell = { household: { people: [{ id: "person-joyce", name: "Joyce" }] } };
  assert.deepEqual(buildPageViewFromRouteData("check", null, "person-joyce", shell), { id: "person-joyce", label: "Joyce" });
  assert.deepEqual(buildPageViewFromRouteData("check", null, "household", shell), { id: "household", label: "Household" });
});

test("getAppShellAvailableViewIds reads the explicit shell route list", () => {
  assert.deepEqual(getAppShellAvailableViewIds({
    availableViewIds: ["household", "person-tim"]
  }), ["household", "person-tim"]);
});

test("getAppShellAvailableViewIds falls back to household people for partial cached shells", () => {
  assert.deepEqual(getAppShellAvailableViewIds({
    household: {
      people: [
        { id: "person-tim", name: "Tim" },
        { id: "person-sam", name: "Sam" }
      ]
    }
  }), ["household", "person-tim", "person-sam"]);
});

test("resolveRouteViewId replaces stale placeholder views before a page request", () => {
  const shell = {
    selectedViewId: "household",
    availableViewIds: ["household", "person-tim"]
  };

  assert.equal(resolveRouteViewId("person-primary", shell), "household");
  assert.equal(resolveRouteViewId("person-primary", shell, "person-tim"), "person-tim");
  assert.equal(resolveRouteViewId("person-tim", shell), "person-tim");
});

test("buildPageViewFromRouteData rejects malformed route page payloads", () => {
  assert.equal(buildPageViewFromRouteData("imports", {}, "household", null), null);
  assert.equal(buildPageViewFromRouteData("settings", {}, "household", null), null);
  assert.deepEqual(
    buildPageViewFromRouteData("imports", { importsPage: { imports: [] } }, "household", null),
    {
      id: "household",
      label: "Household",
      importsPage: { imports: [] }
    }
  );
});

test("buildEntriesPageParams keeps the Entries request to view and month", async () => {
  const { buildEntriesPageParams } = await import("../src/client/app-routing.js");
  assert.equal(buildEntriesPageParams({ viewId: "person-tim", month: "2026-05" }).toString(), "view=person-tim&month=2026-05");
  assert.equal(buildEntriesPageParams({ viewId: "household", month: "2026-04" }).toString(), "view=household&month=2026-04");
});

test("sanitizeTabParams keeps the FAQ guide tab only on the FAQ route", () => {
  const faqParams = new URLSearchParams("view=household&month=2026-05&faq=developers");
  sanitizeTabParams(faqParams, "faq");
  assert.equal(faqParams.toString(), "view=household&month=2026-05&faq=developers");

  for (const tabId of ["summary", "month", "entries", "splits", "imports", "settings"]) {
    const params = new URLSearchParams("view=household&month=2026-05&faq=developers");
    sanitizeTabParams(params, tabId);
    assert.equal(params.get("faq"), null, `${tabId} drops the FAQ tab`);
    assert.equal(params.get("month"), "2026-05");
  }
});
