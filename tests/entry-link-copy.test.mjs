// The entry editor's Copy link (entry-link-copy.jsx): a refused clipboard is
// said in the app, with the link shown to copy by hand, never silence and
// never a browser alert. The browser proof is tests/e2e/entry-link-copy.spec.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { entryLinkCopy } from "../src/client/copy/entry-link-copy.js";
import { entryLinkCopyWords, writeLinkToClipboard } from "../src/client/entry-link-copy.jsx";

const LINK = "https://example.test/entries?entry=txn-1";

test("a clipboard that takes the link reports copied, and the control says Link copied", async () => {
  const written = [];
  const state = await writeLinkToClipboard(LINK, { writeText: async (text) => { written.push(text); } });
  assert.equal(state, "copied");
  assert.deepEqual(written, [LINK]);
  assert.deepEqual(entryLinkCopyWords(state, false), { label: "Link copied", message: "" });
});

test("a refused clipboard reports failed with the phone and desktop fallback words", async () => {
  const state = await writeLinkToClipboard(LINK, { writeText: async () => { throw new DOMException("Document is not focused.", "NotAllowedError"); } });
  assert.equal(state, "failed");
  assert.deepEqual(entryLinkCopyWords(state, true), { label: "Copy link", message: "Couldn't copy. Press and hold the link to copy it instead." });
  assert.deepEqual(entryLinkCopyWords(state, false), { label: "Copy link", message: "Couldn't copy. Select the link and copy it instead." });
});

test("no clipboard at all is a failure too, not a throw", async () => {
  assert.equal(await writeLinkToClipboard(LINK, undefined), "failed");
  assert.equal(await writeLinkToClipboard(LINK, {}), "failed");
});

test("before a copy the control reads Copy link with no message", () => {
  assert.deepEqual(entryLinkCopyWords("idle", false), { label: "Copy link", message: "" });
});

test("the Copy link words live in the copy module, not in the editor", () => {
  const editor = readFileSync(new URL("../src/client/entries-list.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /"Copy link"|"Link copied"/);
  assert.equal(entryLinkCopy.copy, "Copy link");
  assert.equal(entryLinkCopy.copied, "Link copied");
});
