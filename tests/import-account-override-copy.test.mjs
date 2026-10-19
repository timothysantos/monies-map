// The Citi activity file's account check (a2ad65c8) said "The app will rerun
// all matching and coverage checks before you commit": app words a person
// does not use. It says what happens in plain words (docs/audits/codex-polish-2).
import assert from "node:assert/strict";
import test from "node:test";

import { importMessages } from "../src/client/copy/en-SG-imports.js";

test("the account check says the import is checked again before saving, in plain words", () => {
  const text = importMessages.activityAccountOverrideDetail;
  assert.equal(text, "This file was put on the account shown below. If that is wrong, choose the card account it came from; the import is checked again before you save it.");
  assert.doesNotMatch(text, /\b(rerun|matching|coverage|commit|the app)\b/i);
});
