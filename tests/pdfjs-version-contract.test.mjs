import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The Citi and OCBC card PDF parsers read the text items pdf.js 4 produces
// (roughly one per word, so the glued layout view reads
// `TRANSACTIONSFORCITI...`). pdf.js 6 merges items into phrases and both
// parsers then reject real statements, which synthetic fixtures did not catch
// (docs/audits/real-statement-imports.md). Upgrade only together with the
// parsers and new fixtures extracted from real statements with that version.
test("pdf.js stays on the 4.x text-item format the statement parsers read", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const installed = JSON.parse(await readFile(new URL("../node_modules/pdfjs-dist/package.json", import.meta.url), "utf8"));
  assert.match(manifest.dependencies["pdfjs-dist"], /^~4\./);
  assert.equal(installed.version.split(".")[0], "4");
});
