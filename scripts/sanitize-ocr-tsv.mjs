// Removes personal details from a Tesseract TSV before it becomes a test
// fixture. Words whose top-left corner falls in one of the layout's private
// areas (scripts/statement-private-areas.mjs) are replaced in place (digits
// become 0, other words become TEST), so word positions, confidences and row
// structure stay exactly as the real OCR produced them.
//
//   node scripts/sanitize-ocr-tsv.mjs <in.tsv> <out.tsv> [--layout hsbc-visa-revolution]
//
// Set OCR_SANITIZE_CHECK_TERMS="term one,term two" to fail when any of those
// terms is still anywhere in the output (pass the real name, card digits and
// address at run time; never write them into this repo).
import { readFile, writeFile } from "node:fs/promises";

import { privateCheckTerms, statementLayout } from "./statement-private-areas.mjs";

const [inputPath, outputPath, ...flags] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/sanitize-ocr-tsv.mjs <in.tsv> <out.tsv> [--layout hsbc-visa-revolution]");
  process.exit(1);
}

const layout = statementLayout(flags);
const output = sanitizeOcrTsv(await readFile(inputPath, "utf8"), layout);
const checkTerms = privateCheckTerms();
// Only the recognized text is checked: coordinates and confidences are
// numbers that can contain any digit run.
const outputWords = output
  .split("\n")
  .map((line) => line.split("\t"))
  .filter((columns) => columns[0] === "5")
  .map((columns) => columns.slice(11).join("\t"))
  .join("\n")
  .toLowerCase();
const leaked = checkTerms.filter((term) => outputWords.includes(term.toLowerCase()));
if (leaked.length) {
  console.error(`${leaked.length} private term(s) are still in the output; not written.`);
  process.exit(1);
}
await writeFile(outputPath, output, "utf8");
console.log(`Wrote ${outputPath}${checkTerms.length ? ` (checked ${checkTerms.length} terms)` : ""}`);

function sanitizeOcrTsv(tsv, { referenceWidth, referenceHeight, page, areas }) {
  const lines = tsv.split("\n");
  const pageSizes = new Map();
  for (const line of lines) {
    const columns = line.split("\t");
    if (columns[0] === "1") {
      pageSizes.set(columns[1], { width: Number(columns[8]) || referenceWidth, height: Number(columns[9]) || referenceHeight });
    }
  }
  return lines.map((line) => {
    const columns = line.split("\t");
    if (columns[0] !== "5" || columns.length < 12 || Number(columns[1]) !== page) {
      return line;
    }
    const size = pageSizes.get(columns[1]) ?? { width: referenceWidth, height: referenceHeight };
    const left = Number(columns[6]) * referenceWidth / size.width;
    const top = Number(columns[7]) * referenceHeight / size.height;
    const isPrivate = areas.some(({ box: [areaLeft, areaTop, areaRight, areaBottom] }) => (
      left >= areaLeft && left <= areaRight && top >= areaTop && top <= areaBottom
    ));
    if (!isPrivate) {
      return line;
    }
    const text = columns.slice(11).join("\t");
    columns.splice(11, columns.length - 11, /\d/.test(text) ? text.replace(/\d/g, "0") : "TEST");
    return columns.join("\t");
  }).join("\n");
}
