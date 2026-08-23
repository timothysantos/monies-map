import assert from "node:assert/strict";
import test from "node:test";

import { filterRecentImportsByAccount } from "../src/client/import-history-model.js";

test("recent imports account filter matches owner-labeled dropdown values and raw account names", () => {
  const imports = [
    {
      id: "import-1",
      accountNames: ["Child Development Acc (CDA) - Tim"]
    },
    {
      id: "import-2",
      accountNames: ["UOB Lady's Card - Joyce"]
    }
  ];

  assert.deepEqual(
    filterRecentImportsByAccount(imports, "Child Development Acc (CDA) - Tim").map((item) => item.id),
    ["import-1"]
  );

  assert.deepEqual(
    filterRecentImportsByAccount(imports, "Child Development Acc (CDA)").map((item) => item.id),
    ["import-1"]
  );

  assert.deepEqual(
    filterRecentImportsByAccount(imports, "UOB Lady's Card - Joyce").map((item) => item.id),
    ["import-2"]
  );

  assert.deepEqual(
    filterRecentImportsByAccount(imports, "").map((item) => item.id),
    ["import-1", "import-2"]
  );
});
