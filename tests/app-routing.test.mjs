import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPageViewFromRouteData,
  getAppShellAvailableViewIds
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
