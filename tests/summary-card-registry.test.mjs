// Every card on Summary under the top summary is registered for Arrange
// Summary (design.md "Arrange Summary", developer guide "How to register a
// Summary card"): it has an id in SUMMARY_CARD_IDS, a body in the panel's
// `cardBody`, and a name in the editor's NAMES. This fails the moment a card
// is added in one place and not the others, or drawn in the panel outside the
// registered list (where it could be neither hidden nor moved).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SUMMARY_CARD_IDS } from "../src/client/summary-card-order.js";

const panel = readFileSync(new URL("../src/client/summary-panel.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../src/client/summary-card-editor.jsx", import.meta.url), "utf8");

// The keys of the object literal that starts at `marker`: lines indented
// exactly `indent` spaces that begin `key:`, up to the closing brace.
function keysOf(source, marker, indent) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} is in the file`);
  const keys = [];
  for (const line of source.slice(start + marker.length).split("\n").slice(1)) {
    if (new RegExp(`^ {0,${indent - 2}}\\}`).test(line)) break;
    const match = line.match(new RegExp(`^ {${indent}}([A-Za-z]+):`));
    if (match) keys.push(match[1]);
  }
  return keys;
}

const sorted = (list) => [...list].sort();

test("every registered card has a body in the Summary panel, and every body is registered", () => {
  const bodies = keysOf(panel, "const cardBody = {", 4);
  assert.ok(bodies.length >= 5, "the panel's bodies were found");
  assert.deepEqual(sorted(bodies), sorted(SUMMARY_CARD_IDS));
});

test("every registered card is named in the Arrange editor, and the editor names no other", () => {
  const names = keysOf(editor, "const NAMES = {", 2).filter((key) => key !== "planSimple");
  assert.ok(names.length >= 5, "the editor's names were found");
  assert.deepEqual(sorted(names), sorted(SUMMARY_CARD_IDS));
  assert.match(editor, /planSimple/, "the Simple view's name for the month card stays");
});

test("the panel draws no card outside the registered list", () => {
  // Past the registered block, the panel's return draws the top summary, the
  // arrange link and dialogs only. A new card component drawn here cannot be
  // hidden or moved: put it in `cardBody` and register its id.
  const start = panel.indexOf('<article className="panel panel-accent">');
  assert.ok(start > 0);
  const outside = panel.slice(start).replace(/\{summaryCards\.filter[\s\S]*?\.list\}/, "");
  const tags = [...new Set([...outside.matchAll(/<([A-Z][A-Za-z]+)/g)].map((match) => match[1]))];
  const allowed = new Set(["SummaryLead", "SummaryScopeSwitch", "Suspense", "SummaryCardEditor", "MonthNoteDialog"]);
  const surprises = tags.filter((tag) => !allowed.has(tag) && !/^(DetailRows?|PrivateMoney)$/.test(tag));
  assert.deepEqual(surprises, [], `Summary draws ${surprises.join(", ")} outside the registered cards`);
});

test("the guard fails for a card that exists but is not registered", () => {
  const unregistered = panel.replace("const cardBody = {", "const cardBody = {\n    pace: null,");
  assert.notDeepEqual(sorted(keysOf(unregistered, "const cardBody = {", 4)), sorted(SUMMARY_CARD_IDS));
  const stray = panel.replace("{arrangingCards ? (", "<PaceCard />\n      {arrangingCards ? (");
  assert.match(stray.slice(stray.indexOf("<article")).replace(/\{summaryCards\.filter[\s\S]*?\.list\}/, ""), /<PaceCard/);
});
