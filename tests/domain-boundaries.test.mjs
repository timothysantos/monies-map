import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const pageSharedPath = path.join(repoRoot, "src/domain/page-shared.ts");
const allowedExports = [
  "loadRoutePageContext",
  "resolveEffectiveMonth",
  "resolvePageViewId",
  "resolvePageLabel"
];

function extractImportSources(source) {
  const sources = [];
  const importPattern = /^\s*import\s+(?:type\s+)?(?:[\s\S]+?\s+from\s+)?["']([^"']+)["'];?/gm;
  for (const match of source.matchAll(importPattern)) {
    sources.push(match[1]);
  }
  return sources;
}

test("page-shared imports only shell/context helpers", async () => {
  const source = await readFile(pageSharedPath, "utf8");
  const imports = extractImportSources(source);

  assert.deepEqual(imports, ["./app-shell"]);
});

test("page-shared stays out of finance/business modules", async () => {
  const source = await readFile(pageSharedPath, "utf8");
  const imports = extractImportSources(source);
  const forbidden = [
    /^\.\/.*split/i,
    /^\.\/.*budget/i,
    /^\.\/.*reconciliation/i,
    /^\.\/.*category-match/i,
    /^\.\/.*settings/i,
    /^\.\.\/.*split/i,
    /^\.\.\/.*budget/i,
    /^\.\.\/.*reconciliation/i
  ];

  for (const token of forbidden) {
    assert.equal(
      imports.some((importSource) => token.test(importSource)),
      false,
      `page-shared.ts must not import ${token}`
    );
  }
});

test("page-shared only exposes route interpretation helpers", async () => {
  const source = await readFile(pageSharedPath, "utf8");
  const exportedNames = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);

  assert.deepEqual(exportedNames.sort(), allowedExports.slice().sort());
});
