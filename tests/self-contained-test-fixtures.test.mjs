import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const TEST_SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".jsx", ".ts", ".tsx"]);

test("tests do not depend on files outside the project checkout", async () => {
  const forbiddenFragments = [
    "/" + "Users/",
    "Down" + "loads",
    "/var/" + "folders",
    "HSBC_" + "REAL_PDF_DIR"
  ];
  const offenders = [];

  for (const filePath of await listTestSourceFiles("tests")) {
    const source = await readFile(filePath, "utf8");
    for (const fragment of forbiddenFragments) {
      if (source.includes(fragment)) {
        offenders.push(`${filePath}: ${fragment}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

async function listTestSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTestSourceFiles(path));
      continue;
    }
    if (TEST_SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) {
      files.push(path);
    }
  }
  return files;
}
