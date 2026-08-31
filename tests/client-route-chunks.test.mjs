import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/client/App.jsx", import.meta.url), "utf8");
const entriesPanelSource = await readFile(new URL("../src/client/entries-panel.jsx", import.meta.url), "utf8");
const splitsPanelSource = await readFile(new URL("../src/client/splits-panel.jsx", import.meta.url), "utf8");

test("the app shell keeps Entries-only filter controls out of its initial module", () => {
  assert.doesNotMatch(appSource, /from "\.\/entries-overview"/);
  assert.doesNotMatch(appSource, /from "\.\/monies-client-service"/);
  assert.match(appSource, /lazy\(\(\) => import\("\.\/entries-filter-stack\.jsx"\)/);
});

test("Entries and Splits own their shared filter controls through the route module", () => {
  assert.match(entriesPanelSource, /from "\.\/entries-filter-stack"/);
  assert.match(splitsPanelSource, /from "\.\/entries-filter-stack"/);
});
