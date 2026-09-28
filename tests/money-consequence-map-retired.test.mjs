// The Money consequence map (the cards under "See all insights": money left,
// plan position, same-season comparison, snapshot confidence and the
// one-repeat scenario) is retired from Summary, Month, Entries and Splits.
// Nothing in the app may still build, render, style or send it, and the
// links that sat under it are either a signal's own action or gone.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const RETIRED = [
  /decisionMap/,
  /DecisionMap/,
  /financial-decision/,
  /[Cc]onsequence map/,
  /[Oo]ne-repeat/,
  /after one repeat/,
  /Snapshot confidence/,
  /Review bank-record gaps/,
  /Review largest expense/,
  /See income entries/
];

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test("no app source, stylesheet or script still builds, renders, styles or sends the map", async () => {
  const files = [...await sourceFiles("src"), "public/styles.css", "scripts/money-insights-copy.mjs", "scripts/capture-guide-screenshots.mjs"];
  const hits = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const pattern of RETIRED) {
      if (pattern.test(text)) {
        hits.push(`${file}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

// The developer guide may say the map was removed; nothing else may
// describe it as if it were still there.
test("the in-app guides and the copy doc no longer describe the map", async () => {
  const hits = [];
  for (const file of ["docs/user-guide.md", "docs/developer-guide.md", "docs/money-insights-copy.md", "docs/demo-tour.md"]) {
    const paragraphs = (await readFile(file, "utf8")).split(/\n\s*\n/);
    for (const paragraph of paragraphs) {
      const allowed = file === "docs/developer-guide.md" && /\b(removed|retired)\b/.test(paragraph);
      for (const pattern of [/[Cc]onsequence map/, /[Oo]ne-repeat/, /Snapshot confidence/]) {
        if (pattern.test(paragraph) && !allowed) {
          hits.push(`${file}: ${pattern} in "${paragraph.slice(0, 60)}"`);
        }
      }
    }
  }
  assert.deepEqual(hits, []);
});
