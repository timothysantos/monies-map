import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/client/App.jsx", import.meta.url), "utf8");
const entriesPanelSource = await readFile(new URL("../src/client/entries-panel.jsx", import.meta.url), "utf8");
const splitsPanelSource = await readFile(new URL("../src/client/splits-panel.jsx", import.meta.url), "utf8");

test("the app shell keeps Entries-only filter controls out of its initial module", async () => {
  assert.doesNotMatch(appSource, /from "\.\/entries-overview"/);
  assert.doesNotMatch(appSource, /from "\.\/monies-client-service"/);
  assert.doesNotMatch(appSource, /from "\.\/entries-filter-stack/);
  // The sheet stays outside the first-screen module. Its filter controls
  // load in that same chunk so a contextual tap can focus synchronously,
  // without a second lazy hop. The built budget is checked separately.
  assert.match(appSource, /lazy\(\(\) => import\("\.\/mobile-context-sheet\.jsx"\)/);
  const sheetSource = await readFile(new URL("../src/client/mobile-context-sheet.jsx", import.meta.url), "utf8");
  assert.match(sheetSource, /from "\.\/entries-filter-stack\.jsx"/);
  assert.doesNotMatch(sheetSource, /lazy\(\(\) => import\("\.\/entries-filter-stack/);
  // The sheet must not import modules App owns (that splits the entry chunk).
  assert.doesNotMatch(sheetSource, /from "\.\/mobile-context-chip"/);
});

test("Check my books reaches the first screen only through its lazy route, and no file of it pulls TanStack Query into that chunk", async () => {
  assert.match(appSource, /loadRouteModule\("check"\)/);
  assert.doesNotMatch(appSource, /from "\.\/check-/);
  const routeModules = await readFile(new URL("../src/client/route-modules.js", import.meta.url), "utf8");
  assert.match(routeModules, /check: \(\) => import\("\.\/check-panel\.jsx"\)/);
  // Importing the package (or a first-screen module that does) from a route
  // chunk splits the entry chunk: one more first-screen file and ~400 bytes.
  for (const file of ["check-panel.jsx", "check-data-owner.js", "check-model.js", "check-api.js"]) {
    const source = await readFile(new URL(`../src/client/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "@tanstack\/react-query"|from "\.\/query-leases|from "\.\/refresh-notice|from "\.\/App/, `${file} keeps the entry chunk whole`);
  }
});

test("Entries and Splits own their shared filter controls through the route module", () => {
  assert.match(entriesPanelSource, /from "\.\/entries-filter-stack"/);
  assert.match(splitsPanelSource, /from "\.\/entries-filter-stack"/);
});
