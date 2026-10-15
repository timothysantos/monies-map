// The retired names (src/domain/retired-names.ts) must not come back in any
// string the app shows. Scans the source of the client and the domain
// projections line by line (whole-line comments skipped: identifiers and
// design notes may keep storage terms).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { findRetiredNames, RETIRED_NAMES } from "../src/domain/retired-names.ts";

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function codeLines(file) {
  let inBlock = false;
  return readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    const text = line.trim();
    if (inBlock) {
      if (text.includes("*/")) inBlock = false;
      return [];
    }
    if (text.startsWith("/*")) {
      if (!text.includes("*/")) inBlock = true;
      return [];
    }
    if (text.startsWith("//") || text.startsWith("*")) return [];
    return [[index + 1, line]];
  });
}

test("no source string uses a retired name", () => {
  const offences = [];
  for (const file of [...sourceFiles("src/client"), ...sourceFiles("src/domain")].filter((name) => !name.endsWith("retired-names.ts"))) {
    for (const [number, line] of codeLines(file)) {
      for (const problem of findRetiredNames(line)) offences.push(`${file}:${number} ${problem}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(offences, []);
});

test("each retired name is caught on its own, in any case, and its replacement is not", () => {
  for (const { pattern, retired, use } of RETIRED_NAMES) {
    assert.equal(findRetiredNames(retired.toUpperCase()).length, 1, retired);
    assert.ok(pattern.test(retired), retired);
    assert.deepEqual(findRetiredNames(use), [], use);
  }
});

test("storage terms are not visible names: budget_buckets and planned_items pass", () => {
  assert.deepEqual(findRetiredNames('section: "budget_buckets", other: "planned_items", sectionKey'), []);
});
