// Removes personal details from a Tesseract TSV before it becomes a test
// fixture. Words whose top-left corner falls in one of the layout's private
// areas are replaced in place (digits become 0, other words become TEST), so
// word positions, confidences and row structure stay exactly as the real OCR
// produced them.
//
//   node scripts/sanitize-ocr-tsv.mjs <in.tsv> <out.tsv> [--layout hsbc-visa-revolution]
//
// Set OCR_SANITIZE_CHECK_TERMS="term one,term two" to fail when any of those
// terms is still anywhere in the output (pass the real name, card digits and
// address at run time; never write them into this repo).
import { readFile, writeFile } from "node:fs/promises";

// Areas are in the parser's reference frame (an A4 page OCR'd at 220 dpi,
// 1820 x 2572), on page 1: [left, top, right, bottom].
const LAYOUTS = {
  "hsbc-visa-revolution": {
    referenceWidth: 1820,
    referenceHeight: 2572,
    page: 1,
    areas: [
      [140, 400, 760, 470], // card holder name
      [140, 470, 760, 540], // full card number
      [140, 920, 1160, 1010], // card holder bar above the transactions
      [140, 2190, 760, 2400] // mailing address
    ]
  }
};

const [inputPath, outputPath, ...flags] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/sanitize-ocr-tsv.mjs <in.tsv> <out.tsv> [--layout hsbc-visa-revolution]");
  process.exit(1);
}
const layoutFlag = flags.indexOf("--layout");
const layoutName = layoutFlag >= 0 ? flags[layoutFlag + 1] : "hsbc-visa-revolution";
const layout = LAYOUTS[layoutName];
if (!layout) {
  console.error(`Unknown layout ${layoutName}. Known: ${Object.keys(LAYOUTS).join(", ")}`);
  process.exit(1);
}

const input = await readFile(inputPath, "utf8");
const output = sanitizeOcrTsv(input, layout);
const checkTerms = (process.env.OCR_SANITIZE_CHECK_TERMS ?? "").split(",").map((term) => term.trim()).filter(Boolean);
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
    const isPrivate = areas.some(([areaLeft, areaTop, areaRight, areaBottom]) => (
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
