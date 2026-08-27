import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPageViewFromRouteData,
  getAppShellAvailableViewIds,
  resolveRouteViewId
} from "../src/client/app-routing.js";

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
