// An even split is "half each" wherever the app names it (owner decision,
// 2026-10-20, docs/audits/codex-polish-2): the Entries quick add, Ask's
// share question and split suggestion, and what Ask remembers. A ratio such
// as "70/30" stays a ratio. People may still type "50/50": the readers that
// understand it are the only source lines allowed to hold it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { shareLabel, suggestionLine } from "../src/domain/ask-habit-plan.ts";
import { formatSuggestedShare } from "../src/client/ask-split-suggestion.js";
import { splitShareCopy } from "../src/client/copy/split-share-copy.js";

test("an even share reads half each; any other share stays the payer's ratio", () => {
  assert.equal(shareLabel(5000), "half each");
  assert.equal(shareLabel(7000), "70/30");
  assert.equal(formatSuggestedShare(5000), "Half each");
  assert.equal(formatSuggestedShare(3000), "30/70");
});

test("the habit line says half each for an even split", () => {
  const line = suggestionLine({ split: { payerShareBasisPoints: 5000, otherPersonName: "Joyce", groupName: "Home" } });
  assert.equal(line, "Add to splits half each with Joyce in Home, as you usually do");
});

test("the quick add names the group and half each", () => {
  assert.equal(splitShareCopy.quickAdd("Baby River"), "Add to Baby River · Half each");
  assert.equal(splitShareCopy.quickAddTitle("Baby River"), "Add this expense to Baby River, half each");
});

test("the share hint says who owes whom in plain words", () => {
  assert.equal(
    splitShareCopy.shareHint("Tim", "Joyce"),
    "0% means none of it is Tim's: if Tim paid, Joyce owes Tim all of it. 100% means it is all Tim's."
  );
});

// Lines that read what a person typed, or seed a demo note a person wrote.
const READERS = new Set([
  "src/domain/ask-turn-names.ts",
  "src/domain/ask-turn-shares.ts",
  "src/domain/demo-showcase-data.ts"
]);

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test("no visible split label in the client or domain says 50/50", () => {
  const offences = [];
  for (const file of [...sourceFiles("src/client"), ...sourceFiles("src/domain"), ...sourceFiles("src/server")]) {
    if (READERS.has(file)) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*")) return;
      if (/["'`][^"'`]*50\/50/.test(code)) offences.push(`${file}:${index + 1} ${code.slice(0, 120)}`);
    });
  }
  assert.deepEqual(offences, []);
});
