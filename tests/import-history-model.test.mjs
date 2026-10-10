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

test("the commit notice lists the five completed imports before the one just committed", async () => {
  const { buildEarlierImportLines } = await import("../src/client/import-history-model.js");
  const recentImports = [
    { id: "just-committed", status: "completed", sourceLabel: "One Account_Sep 2026", accountNames: ["UOB One"], startDate: "2026-09-01", endDate: "2026-09-30" },
    { id: "a", status: "completed", sourceLabel: "One Account_Aug 2026", accountNames: ["UOB One"], startDate: "2026-08-01", endDate: "2026-08-31" },
    { id: "rolled", status: "rolled_back", sourceLabel: "Bad upload", accountNames: ["UOB One"], startDate: "2026-08-01", endDate: "2026-08-31" },
    { id: "b", status: "completed", sourceLabel: "eStatement_UOB_Cards", accountNames: ["UOB One Card", "UOB Lady's Card"], startDate: "2026-07-13", endDate: "2026-08-12" },
    { id: "c", status: "completed", sourceLabel: "Certify only", accountNames: [] },
    { id: "d", status: "completed", sourceLabel: "Single day", accountNames: ["OCBC 360"], startDate: "2026-07-04", endDate: "2026-07-04" },
    { id: "e", status: "completed", sourceLabel: "Fifth", accountNames: ["Citi"], startDate: "2026-06-01", endDate: "2026-06-30" },
    { id: "f", status: "completed", sourceLabel: "Sixth, left out", accountNames: ["Citi"], startDate: "2026-05-01", endDate: "2026-05-31" }
  ];

  const lines = buildEarlierImportLines(recentImports, "just-committed");

  assert.deepEqual(lines, [
    { id: "a", text: "UOB One · 1 Aug 2026 – 31 Aug 2026 · One Account_Aug 2026" },
    { id: "b", text: "UOB One Card and UOB Lady's Card · 13 Jul 2026 – 12 Aug 2026 · eStatement_UOB_Cards" },
    { id: "c", text: "Certify only" },
    { id: "d", text: "OCBC 360 · 4 Jul 2026 · Single day" },
    { id: "e", text: "Citi · 1 Jun 2026 – 30 Jun 2026 · Fifth" }
  ]);
  assert.deepEqual(buildEarlierImportLines([recentImports[0]], "just-committed"), []);
});
