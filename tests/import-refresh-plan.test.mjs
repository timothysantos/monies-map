import assert from "node:assert/strict";
import test from "node:test";

import { buildImportAccountCreationRefreshPlan } from "../src/client/import-refresh-plan.js";

test("buildImportAccountCreationRefreshPlan requests a shell refresh", () => {
  assert.deepEqual(buildImportAccountCreationRefreshPlan(), { refreshShell: true });
});
