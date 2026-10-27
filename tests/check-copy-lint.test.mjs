// Naming rule (AGENTS.md, "Every visible name must be understandable to a
// non-technical person"): the "Check my books" page's own words use none of the
// engine's terms and pass the app-jargon and retired-name lists. Walks every
// string in the copy module (calling each function with sample figures).
import assert from "node:assert/strict";
import test from "node:test";

import { checkCopy } from "../src/client/copy/check-copy.js";
import { messages } from "../src/client/copy/en-SG.js";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";
import { findRetiredNames } from "../src/domain/retired-names.ts";

const BANNED = [
  [/\bfindings?\b/i, "finding"],
  [/\bdetectors?\b/i, "detector"],
  [/\btiers?\b/i, "tier"],
  [/\bevidence\b/i, "evidence"],
  [/\bkinds?\b/i, "kind"],
  [/\bdismiss(?:ed|al|als|es)?\b/i, "dismiss"],
  [/\bDTOs?\b/, "DTO"],
  [/\bAPI\b/, "API"]
];

function visibleStrings(value, path = "checkCopy", out = []) {
  if (typeof value === "string") {
    out.push([path, value]);
  } else if (typeof value === "function") {
    for (const args of [[3, 5], ["27 Oct", "A thing"], ["$7.84"]]) {
      try {
        visibleStrings(value(...args), `${path}()`, out);
        break;
      } catch {
        // try the next sample
      }
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) visibleStrings(item, `${path}.${key}`, out);
  }
  return out;
}

const strings = visibleStrings(checkCopy);

test("the walk reaches the copy: titles, headings, buttons and notices", () => {
  const paths = strings.map(([path]) => path);
  for (const expected of ["checkCopy.title", "checkCopy.tiers.high.title", "checkCopy.headings.transfers", "checkCopy.hidden.undo", "checkCopy.group.showMore()", "checkCopy.errors.retry"]) {
    assert.ok(paths.includes(expected), expected);
  }
  assert.ok(strings.length > 60, `walked ${strings.length} strings`);
});

test("no string uses an engine term, app jargon or a retired name", () => {
  const offences = [];
  for (const [path, text] of strings) {
    for (const [pattern, name] of BANNED) {
      if (pattern.test(text)) offences.push(`${path}: "${text}" (${name})`);
    }
    for (const problem of findAppJargon(text)) offences.push(`${path}: "${text}" (${problem})`);
    for (const problem of findRetiredNames(text)) offences.push(`${path}: "${text}" (${problem})`);
  }
  assert.deepEqual(offences, []);
});

test("the guard rejects what it should", () => {
  for (const bad of ["3 findings", "Run the detector", "Good to know tier", "Show the evidence", "This kind of problem", "Dismissed items", "In the app", "Unlinked transfers"]) {
    const caught = BANNED.some(([pattern]) => pattern.test(bad)) || findAppJargon(bad).length > 0;
    assert.ok(caught, bad);
  }
  for (const good of ["Needs fixing", "Worth checking", "Good to know", "This is fine", "Show hidden (2)"]) {
    assert.ok(!BANNED.some(([pattern]) => pattern.test(good)) && findAppJargon(good).length === 0, good);
  }
});

test("the page and its three sections carry the owner's words", () => {
  assert.equal(checkCopy.title, "Check my books");
  assert.equal(messages.tabs.check, checkCopy.title);
  assert.deepEqual([checkCopy.tiers.high.title, checkCopy.tiers.check.title, checkCopy.tiers.note.title], ["Needs fixing", "Worth checking", "Good to know"]);
  assert.deepEqual(Object.values(checkCopy.headings), [
    "Purchases that may be on the wrong card",
    "Possible duplicates",
    "Transfers waiting for their other side",
    "Missing statements",
    "Estimates the bank never confirmed",
    "Balances that don't match",
    "Plan problems",
    "Settle-up mistakes",
    "Tidy-ups"
  ]);
  assert.equal(checkCopy.checking, "Checking…");
  assert.equal(checkCopy.checkAgain, "Check again");
  assert.equal(checkCopy.item.thisIsFine, "This is fine");
  assert.equal(checkCopy.hidden.toggle(4), "Show hidden (4)");
  assert.equal(checkCopy.group.showMore(7), "Show 7 more");
});
