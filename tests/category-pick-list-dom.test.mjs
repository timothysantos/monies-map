// The category list's markup (design.md "Category list"), rendered on the
// server: the search field, the listbox and its rows in order, the current
// category checked, and no "Best guess" tag when nothing was guessed (the guess
// arrives in the browser; the browser specs cover the tag, typing and keys).
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const { default: CategoryPickList } = await import("../src/client/category-pick-list.jsx");
const { categoryPickCopy } = await import("../src/client/copy/category-pick-copy.js");
const { categoryPickOptions } = await import("../src/client/category-pick-options.js");
const { categories } = await import("../src/domain/demo-data.ts");

const h = React.createElement;
const options = categoryPickOptions(categories, { without: ["Transfer"] });
const render = (props) => renderToStaticMarkup(h(CategoryPickList, { options, onChoose() {}, focusSearch: false, ...props }));
const rowLabels = (html) => [...html.matchAll(/class="category-pick-row-label">([^<]*)</g)].map((match) => match[1].replace(/&amp;/g, "&"));

test("a search field named for assistive tech sits above a listbox of every category, alphabetically", () => {
  const html = render({ value: "Groceries" });
  assert.match(html, new RegExp(`<input[^>]*role="combobox"[^>]*aria-label="${categoryPickCopy.searchLabel}"`));
  assert.match(html, new RegExp(`role="listbox"[^>]*aria-label="${categoryPickCopy.listLabel}"`));
  const labels = rowLabels(html);
  assert.equal(labels.length, options.length);
  assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })));
  assert.ok(html.indexOf("category-pick-search") < html.indexOf('role="listbox"'));
});

test("the current category is the only selected row; no tag appears without a guess", () => {
  const html = render({ value: "Other" });
  const selected = [...html.matchAll(/aria-selected="true"[^>]*data-category-option="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(selected, ["Other"]);
  assert.equal(html.includes("category-pick-tag"), false);
  assert.equal(html.includes(categoryPickCopy.bestGuess), false);
});

test("a several-choice list marks every checked category and says it is multiselectable", () => {
  const html = render({ multiple: true, value: ["Groceries", "Taxi"] });
  assert.match(html, /aria-multiselectable="true"/);
  const selected = [...html.matchAll(/aria-selected="true"[^>]*data-category-option="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(selected.sort(), ["Groceries", "Taxi"]);
});

test("a pinned row is listed first and not twice", () => {
  const none = { value: "", label: "All categories" };
  const html = render({ options: [none, ...options], pinned: [none], value: "" });
  const labels = rowLabels(html);
  assert.equal(labels[0], "All categories");
  assert.equal(labels.filter((label) => label === "All categories").length, 1);
});

test("while a best guess is awaited the list is held back, not drawn in the wrong order", () => {
  const html = render({ description: "Zzyzx Studio" });
  assert.match(html, /aria-busy="true"/);
  assert.equal(rowLabels(html).length, 0);
});
