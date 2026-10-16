// The island's contextual line: markup, accessible names and the one-call
// Clear. The line is a plain function component, so its buttons' handlers
// are found in the element tree and called without a browser.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const { MobileContextLine, IslandContextLineBody: IslandContextLine } = await import("../src/client/mobile-context-line.jsx");
const { MobileContextStatus } = await import("../src/client/mobile-context-status.jsx");
const { islandContextCopy } = await import("../src/client/copy/island-context-copy.js");

const h = React.createElement;

function findButtons(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) { node.forEach((child) => findButtons(child, found)); return found; }
  if (node.type === "button") found.push(node.props);
  if (node.props?.children) findButtons(node.props.children, found);
  if (typeof node.type === "function") findButtons(node.type(node.props), found);
  return found;
}

const base = { text: "Food & Drinks · 12 entries", actionLabel: islandContextCopy.clear, actionName: islandContextCopy.clearName };

test("the line names the filters and has a Clear button named for assistive tech", () => {
  const html = renderToStaticMarkup(h(MobileContextLine, { ...base, onAction() {}, onOpen() {} }));
  assert.match(html, /Food &amp; Drinks · 12 entries/);
  assert.match(html, /aria-label="Clear all filters"[^>]*>Clear</);
  assert.match(html, /aria-label="Food &amp; Drinks · 12 entries, change filters"/);
});

test("Clear calls the reset once and the summary opens the filters without clearing", () => {
  let cleared = 0;
  let opened = 0;
  const buttons = findButtons(MobileContextLine({ ...base, onAction: () => { cleared += 1; }, onOpen: () => { opened += 1; } }));
  assert.equal(buttons.length, 2);
  buttons.find((button) => button["aria-label"] === "Clear all filters").onClick();
  assert.deepEqual([cleared, opened], [1, 0]);
  buttons.find((button) => /change filters/.test(button["aria-label"])).onClick();
  assert.deepEqual([cleared, opened], [1, 1]);
});

test("a month line with no text has only its button", () => {
  const html = renderToStaticMarkup(h(MobileContextLine, { text: "", actionLabel: islandContextCopy.backToMonth, actionName: islandContextCopy.backToMonth, onAction() {} }));
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, />Back to this month</);
});

test("a stacked month line says which month is shown, as text, not a button", () => {
  const html = renderToStaticMarkup(h(MobileContextLine, { text: "Viewing Sep 2026", textIsStatic: true, actionLabel: islandContextCopy.backToMonth, actionName: islandContextCopy.backToMonth, onAction() {} }));
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /Viewing Sep 2026/);
});

test("the status region is polite, and empty when nothing is applied", () => {
  const empty = renderToStaticMarkup(h(MobileContextStatus, { message: "" }));
  assert.match(empty, /role="status"/);
  assert.match(empty, /aria-live="polite"/);
  assert.match(empty, /><\/p>$/);
  assert.match(renderToStaticMarkup(h(MobileContextStatus, { message: "Filtered by Taxi, 3 entries" })), />Filtered by Taxi, 3 entries</);
});

test("the wrapper: filters get Clear; a month gets Back to this month, named only on a second row", () => {
  const filters = renderToStaticMarkup(h(IslandContextLine, { kind: "filters", text: "Taxi · 3 entries", inline: true, onClear() {}, onOpen() {} }));
  assert.match(filters, /aria-label="Clear all filters"/);
  const inline = renderToStaticMarkup(h(IslandContextLine, { kind: "month", text: "Sep 2026", inline: true, onBack() {} }));
  assert.doesNotMatch(inline, /Viewing/);
  assert.match(inline, />Back to this month</);
  const stacked = renderToStaticMarkup(h(IslandContextLine, { kind: "month", text: "Sep 2026", inline: false, onBack() {} }));
  assert.match(stacked, /Viewing Sep 2026/);
});
