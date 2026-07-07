import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import { parseStatementText, statementRowsToCsv } from "../src/lib/statement-import.ts";

const execFileAsync = promisify(execFile);

const [inputPdf, outputCsv] = process.argv.slice(2);

if (!inputPdf) {
  console.error("Usage: tsx scripts/hsbc-pdf-to-import.mjs /path/to/HSBC.pdf [output.hsbc-ocr.tsv|output.csv]");
  process.exit(1);
}

const resolvedInput = resolve(inputPdf);
const resolvedOutput = outputCsv
  ? resolve(outputCsv)
  : resolve(process.cwd(), `${basename(inputPdf).replace(/\.pdf$/i, "")}.hsbc-ocr.tsv`);
const workingDir = await mkdtemp(join(tmpdir(), "monies-map-hsbc-ocr-"));

try {
  await requireCommand("pdftoppm");
  await requireCommand("tesseract");

  const pagePrefix = join(workingDir, "page");
  await execFileAsync("pdftoppm", ["-png", "-r", "220", resolvedInput, pagePrefix]);

  const renderedPages = (await readdir(workingDir))
    .filter((file) => /^page-\d+\.png$/.test(file))
    .sort((left, right) => naturalPageNumber(left) - naturalPageNumber(right));
  const tsvPages = [];
  for (const pageFile of renderedPages) {
    const pagePath = join(workingDir, pageFile);
    const outputPrefix = pagePath.replace(/\.png$/i, "");
    await execFileAsync("tesseract", [pagePath, outputPrefix, "--psm", "4", "-l", "eng", "tsv"]);
    tsvPages.push(await readFile(`${outputPrefix}.tsv`, "utf8"));
  }

  const combinedTsv = mergeTsvPages(tsvPages);
  const parsed = parseStatementText(`__OCR_TSV__\n${combinedTsv}`, basename(inputPdf));
  const outputContent = /\.csv$/i.test(resolvedOutput)
    ? statementRowsToCsv(parsed.rows)
    : `__OCR_TSV__\n${combinedTsv}`;
  await writeFile(resolvedOutput, outputContent, "utf8");

  console.log(`Wrote ${parsed.rows.length} HSBC import row${parsed.rows.length === 1 ? "" : "s"} to ${resolvedOutput}`);
  if (!/\.csv$/i.test(resolvedOutput)) {
    console.log("Upload this .hsbc-ocr.tsv file in Imports to preserve statement checkpoint and certification review.");
  }
  console.log(`Statement checkpoint: ${parsed.checkpoints[0]?.statementEndDate ?? "unknown"} ${parsed.checkpoints[0]?.accountName ?? ""}`);
  console.log("Privacy: OCR ran locally with pdftoppm and tesseract. No PDF or image was uploaded.");
  if (parsed.warnings.length) {
    console.log(`Warning: ${parsed.warnings.join(" ")}`);
  }
} finally {
  await rm(workingDir, { recursive: true, force: true });
}

async function requireCommand(command) {
  try {
    await execFileAsync("which", [command]);
  } catch {
    throw new Error(`Missing required command: ${command}. Install Poppler for pdftoppm and Tesseract OCR before running this helper.`);
  }
}

function naturalPageNumber(fileName) {
  return Number(fileName.match(/-(\d+)\.png$/)?.[1] ?? "0");
}

function mergeTsvPages(pages) {
  return pages.map((page, index) => {
    const lines = page.trim().split(/\r?\n/);
    if (index === 0) {
      return lines.map((line, lineIndex) => lineIndex === 0 ? line : withPageNumber(line, index + 1)).join("\n");
    }
    return lines.slice(1).map((line) => withPageNumber(line, index + 1)).join("\n");
  }).join("\n");
}

function withPageNumber(line, pageNumber) {
  const columns = line.split("\t");
  if (columns.length > 1) {
    columns[1] = String(pageNumber);
  }
  return columns.join("\t");
}
