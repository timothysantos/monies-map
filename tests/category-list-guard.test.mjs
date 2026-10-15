// Every place a category is chosen opens the one category list (design.md
// "Category list"): a native select cannot be searched, so a `<select>` of
// categories must not come back. A select that only mentions a category in
// passing (it maps a file column, or picks a mode) is named here with its
// reason.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const CLIENT = new URL("../src/client/", import.meta.url);

const NOT_A_CATEGORY_LIST = {
  "import-mapping-stage.jsx": "chooses which file column holds the category, and what to do with unknown ones: neither lists categories"
};

function selectBlocks(source) {
  return [...source.matchAll(/<select\b[\s\S]*?<\/select>/g)].map((match) => match[0]);
}

test("no native select in the client lists categories", () => {
  const offenders = [];
  for (const name of readdirSync(CLIENT).filter((file) => file.endsWith(".jsx"))) {
    if (NOT_A_CATEGORY_LIST[name]) continue;
    for (const block of selectBlocks(readFileSync(new URL(name, CLIENT), "utf8"))) {
      if (/categor/i.test(block)) offenders.push(`${name}: ${block.split("\n")[0].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "open the category list instead (ResponsiveSelect or PickerRow with categoryPick, see design.md \"Category list\")");
});

test("the allowed exceptions still exist and still hold a select", () => {
  for (const name of Object.keys(NOT_A_CATEGORY_LIST)) {
    assert.ok(selectBlocks(readFileSync(new URL(name, CLIENT), "utf8")).length > 0, `${name} no longer has a select: remove it from the list`);
  }
});

test("the guard would catch a category select", () => {
  const sample = `<select value={categoryName}>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select>`;
  assert.equal(selectBlocks(sample).filter((block) => /categor/i.test(block)).length, 1);
});
