import assert from "node:assert/strict";
import test from "node:test";

import { getAppShellAvailableViewIds } from "../src/client/app-routing.js";

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
