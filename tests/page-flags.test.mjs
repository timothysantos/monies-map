import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { PAGE_FLAG, holdPageFlag, pageFlagRef } from "../src/client/page-flags.js";

// A <body> that records its attributes, so a test can prove when a flag is
// set and cleared.
function installFakeBody() {
  const attributes = new Map();
  const writes = [];
  globalThis.document = {
    body: {
      setAttribute(name, value) {
        writes.push(["set", name]);
        attributes.set(name, value);
      },
      removeAttribute(name) {
        writes.push(["remove", name]);
        attributes.delete(name);
      }
    }
  };
  return { attributes, writes };
}

test.afterEach(() => {
  delete globalThis.document;
});

test("a page flag stays on <body> while any holder keeps it and is cleared by the last release", () => {
  const { attributes, writes } = installFakeBody();

  const first = holdPageFlag(PAGE_FLAG.entryInlineEditor);
  assert.equal(attributes.get("data-entry-inline-editor"), "");
  const second = holdPageFlag(PAGE_FLAG.entryInlineEditor);
  first();
  assert.equal(attributes.has("data-entry-inline-editor"), true);
  // A second call of the same release must not release the other holder.
  first();
  assert.equal(attributes.has("data-entry-inline-editor"), true);
  second();
  assert.equal(attributes.has("data-entry-inline-editor"), false);
  // One write to set and one to clear: holders in between do not restyle.
  assert.deepEqual(writes, [["set", "data-entry-inline-editor"], ["remove", "data-entry-inline-editor"]]);
});

test("flags are independent of each other", () => {
  const { attributes } = installFakeBody();

  const split = holdPageFlag(PAGE_FLAG.splitInlineEditor);
  const panel = holdPageFlag(PAGE_FLAG.splitsPanel);
  split();
  assert.deepEqual([...attributes.keys()], ["data-splits-panel"]);
  panel();
  assert.deepEqual([...attributes.keys()], []);
});

test("an unknown flag is rejected instead of setting an attribute no rule reads", () => {
  const { attributes } = installFakeBody();

  assert.throws(() => holdPageFlag("entry-mobile-sheet"), /Unknown page flag/);
  assert.throws(() => pageFlagRef("typo"), /Unknown page flag/);
  assert.equal(attributes.size, 0);
});

test("a flag ref holds the flag while its element is attached and fills the element ref", () => {
  const { attributes } = installFakeBody();
  const elementRef = { current: null };
  const node = { tagName: "DIV" };

  const ref = pageFlagRef(PAGE_FLAG.entryInlineEditor, elementRef);
  // Stable per element ref, so React does not detach and reattach it on
  // every render.
  assert.equal(pageFlagRef(PAGE_FLAG.entryInlineEditor, elementRef), ref);
  assert.notEqual(pageFlagRef(PAGE_FLAG.entryInlineEditor, { current: null }), ref);
  assert.equal(pageFlagRef(PAGE_FLAG.splitsPanel), pageFlagRef(PAGE_FLAG.splitsPanel));

  const cleanup = ref(node);
  assert.equal(typeof cleanup, "function");
  assert.equal(elementRef.current, node);
  assert.equal(attributes.has("data-entry-inline-editor"), true);

  cleanup();
  assert.equal(elementRef.current, null);
  assert.equal(attributes.has("data-entry-inline-editor"), false);
});

// Every body flag the stylesheet reads is one the client sets, and the other
// way round, so a renamed flag cannot silently stop a rule from applying.
test("the stylesheet reads exactly the page flags the client sets", () => {
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const read = new Set([...css.matchAll(/body\[data-([a-z-]+)\]/g)].map((match) => match[1]));
  assert.deepEqual([...read].sort(), Object.values(PAGE_FLAG).sort());
});

// `body:has(> .note-dialog-overlay)` and `body:has(> .entry-mobile-sheet)`
// see a dialog or sheet only when it is a direct child of <body>. Radix
// portals each direct child of <Dialog.Portal> into <body> (no wrapper) unless
// a container is given.
test("dialog overlays and the mobile sheet are portalled straight into <body>", () => {
  const clientDir = new URL("../src/client/", import.meta.url);
  const sources = readdirSync(clientDir).filter((name) => name.endsWith(".jsx"));
  let overlays = 0;
  for (const name of sources) {
    const lines = readFileSync(new URL(name, clientDir), "utf8").split("\n");
    assert.equal(lines.some((line) => /Dialog\.Portal[^>]*container=/.test(line)), false, `${name} portals a dialog into a container`);
    lines.forEach((line, index) => {
      if (!line.includes('className="note-dialog-overlay"')) return;
      overlays += 1;
      assert.equal(lines[index - 1].trim(), "<Dialog.Portal>", `${name}:${index + 1} overlay is not a direct child of <Dialog.Portal>`);
    });
  }
  assert.ok(overlays > 20, `expected the app's dialog overlays, found ${overlays}`);

  const sheet = readFileSync(new URL("entry-mobile-sheet.jsx", clientDir), "utf8");
  // Inside the portal: the backdrop (RemoveScroll forwards its props, no
  // wrapper) and the FocusScope with asChild around Dialog.Content.
  assert.match(sheet, /<Dialog\.Portal>\s*<RemoveScroll forwardProps[^>]*>\s*<div className="entry-composer-overlay" \/>\s*<\/RemoveScroll>\s*<FocusScope\s+asChild/);
});

// Returns the argument of every :has() in a stylesheet (balanced parentheses).
function hasArguments(css) {
  const found = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let index = withoutComments.indexOf(":has(");
  while (index !== -1) {
    let depth = 1;
    let cursor = index + 5;
    while (depth > 0 && cursor < withoutComments.length) {
      if (withoutComments[cursor] === "(") depth += 1;
      if (withoutComments[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    found.push(withoutComments.slice(index + 5, cursor - 1).trim());
    index = withoutComments.indexOf(":has(", cursor);
  }
  return found;
}

// A :has() whose argument starts with a descendant (like body:has(.x)) makes
// Chromium search everything below the anchor each time an element the rule
// styles is restyled. On the 2,000-row month, rules like that cost about
// 25 ms of style work per mobile sheet open or close at CPU 4x. A child or
// sibling argument (`:has(> .x)`, `:has(+ .x)`) checks only a few elements.
test("no stylesheet uses a :has() that searches all descendants", () => {
  const files = [
    new URL("../public/styles.css", import.meta.url),
    ...readdirSync(new URL("../src/client/", import.meta.url))
      .filter((name) => name.endsWith(".css"))
      .map((name) => new URL(`../src/client/${name}`, import.meta.url))
  ];
  const offenders = files.flatMap((file) =>
    hasArguments(readFileSync(file, "utf8"))
      .filter((argument) => !/^[>+~]/.test(argument))
      .map((argument) => `${file.pathname.split("/").slice(-2).join("/")}: :has(${argument})`)
  );
  assert.deepEqual(offenders, []);
  // The scan itself finds the child-scoped rules, so it is not vacuous.
  assert.ok(hasArguments(readFileSync(files[0], "utf8")).includes("> .entry-mobile-sheet"));
});
