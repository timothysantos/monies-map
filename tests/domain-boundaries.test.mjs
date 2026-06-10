import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const routeContextPath = path.join(repoRoot, "src/domain/route-context.ts");
const pageLabelsPath = path.join(repoRoot, "src/domain/page-labels.ts");
const allowedExports = [
  "loadRoutePageContext",
  "resolveEffectiveMonth",
  "resolvePageViewId"
];
const allowedLabelExports = [
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

test("route-context imports only shell/context helpers", async () => {
  const source = await readFile(routeContextPath, "utf8");
  const imports = extractImportSources(source);

  assert.deepEqual(imports, ["./app-shell"]);
});

test("route-context stays out of finance/business modules", async () => {
  const source = await readFile(routeContextPath, "utf8");
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
      `route-context.ts must not import ${token}`
    );
  }
});

test("route-context only exposes route interpretation helpers", async () => {
  const source = await readFile(routeContextPath, "utf8");
  const exportedNames = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);

  assert.deepEqual(exportedNames.sort(), allowedExports.slice().sort());
});

test("page-labels stays label-only", async () => {
  const source = await readFile(pageLabelsPath, "utf8");
  const imports = extractImportSources(source);
  const exportedNames = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);

  assert.deepEqual(imports, []);
  assert.deepEqual(exportedNames.sort(), allowedLabelExports.slice().sort());
});
