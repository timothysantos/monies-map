// Captures what the app's private browser OCR reads from an image-only
// statement PDF, so a statement that imports wrongly can become a test
// fixture. It runs the same steps as the app (src/client/import-helpers.js
// and import-ocr-cells.js) in headless Chromium: pdf.js renders each page at
// 220 dpi, the vendored Tesseract reads it in page layout modes 4 and 6, and
// the cells the parser points at are read one by one.
//
//   node --import tsx scripts/capture-statement-ocr.mjs <statement.pdf> <out-prefix>
//
// Writes <out-prefix>.browser.tsv, .browser-pass2.tsv and, when the parser
// asks for cells, .browser-cells.tsv. These are RAW: they hold the real name,
// card number and address. Write them outside the repo, then run each through
// scripts/sanitize-ocr-tsv.mjs to make the fixture.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

import { parseStatementText } from "../src/lib/statement-import.ts";

const DPI = 220;
const ORIGIN = "https://ocr-capture.local";
const SERVED_FILES = {
  "/pdf.mjs": "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "/pdf.worker.mjs": "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
};

const [inputPath, outputPrefix] = process.argv.slice(2);
if (!inputPath || !outputPrefix) {
  console.error("Usage: node --import tsx scripts/capture-statement-ocr.mjs <statement.pdf> <out-prefix>");
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><title>ocr capture</title>" });
      return;
    }
    const file = SERVED_FILES[pathname] ?? (pathname.startsWith("/vendor/tesseract/") ? path.join("public", pathname) : undefined);
    if (!file) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    const contentType = file.endsWith(".wasm") ? "application/wasm" : file.endsWith("js") ? "text/javascript" : "application/octet-stream";
    await route.fulfill({ contentType, body: await readFile(file) });
  });
  await page.goto(`${ORIGIN}/`);
  const pdfBase64 = (await readFile(inputPath)).toString("base64");

  const firstPass = mergeOcrTsvPages(await readPages(page, pdfBase64, { pageSegMode: "4" }));
  const secondPass = mergeOcrTsvPages(await readPages(page, pdfBase64, { pageSegMode: "6" }));
  await writeFile(`${outputPrefix}.browser.tsv`, `${firstPass}\n`, "utf8");
  await writeFile(`${outputPrefix}.browser-pass2.tsv`, `${secondPass}\n`, "utf8");
  console.log(`Wrote ${outputPrefix}.browser.tsv and .browser-pass2.tsv`);

  let review;
  try {
    review = parseStatementText(`__OCR_TSV__\n${firstPass}`, path.basename(inputPath)).ocrReview;
  } catch (error) {
    console.log(`The first pass does not parse (${error instanceof Error ? error.message : error}); no cells were read.`);
  }
  if (review?.cellRegions?.length) {
    const cells = await readPages(page, pdfBase64, { cellRegions: review.cellRegions, referenceSize: review.referenceSize });
    await writeFile(`${outputPrefix}.browser-cells.tsv`, `${cells.join("\n")}\n`, "utf8");
    console.log(`Wrote ${outputPrefix}.browser-cells.tsv (${review.cellRegions.length} cells)`);
  } else if (review) {
    console.log("The first pass was not doubtful, so the app would not read cells.");
  }
  console.log("These files are raw. Sanitize them with scripts/sanitize-ocr-tsv.mjs before they go into tests/fixtures.");
} finally {
  await browser.close();
}

// Whole pages (pageSegMode) return one TSV per page; cells return TSV lines.
function readPages(page, pdfBase64, options) {
  return page.evaluate(async ({ pdfBase64, dpi, pageSegMode, cellRegions, referenceSize }) => {
    const pdfjs = await import("/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    const tesseract = await import("/vendor/tesseract/tesseract.esm.min.js");
    const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
    const worker = await createWorker("eng", 1, {
      workerPath: "/vendor/tesseract/worker.min.js",
      corePath: "/vendor/tesseract",
      langPath: "/vendor/tesseract",
      gzip: false
    });
    const data = Uint8Array.from(atob(pdfBase64), (char) => char.charCodeAt(0));
    const document = await pdfjs.getDocument({ data }).promise;
    const render = async (pageNumber) => {
      const pdfPage = await document.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: dpi / 72 });
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport }).promise;
      return canvas;
    };
    try {
      if (!cellRegions) {
        await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
        const pages = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const result = await worker.recognize(await render(pageNumber), {}, { text: true, tsv: true });
          pages.push(result.data.tsv ?? "");
        }
        return pages;
      }
      const lines = [];
      const pageNumbers = [...new Set(cellRegions.map((region) => region.page))]
        .filter((pageNumber) => pageNumber >= 1 && pageNumber <= document.numPages);
      for (const pageNumber of pageNumbers) {
        const canvas = await render(pageNumber);
        const xScale = canvas.width / referenceSize.width;
        const yScale = canvas.height / referenceSize.height;
        lines.push(`1\t${pageNumber}\t0\t0\t0\t0\t0\t0\t${canvas.width}\t${canvas.height}\t-1\t`);
        let allowedCharacters = null;
        for (const region of cellRegions.filter((item) => item.page === pageNumber)) {
          if (region.allowedCharacters !== allowedCharacters) {
            allowedCharacters = region.allowedCharacters;
            await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: allowedCharacters });
          }
          const rectangle = {
            left: Math.max(0, Math.round(region.left * xScale)),
            top: Math.max(0, Math.round(region.top * yScale)),
            width: Math.round((region.right - region.left) * xScale),
            height: Math.round((region.bottom - region.top) * yScale)
          };
          const result = await worker.recognize(canvas, { rectangle }, { tsv: true });
          for (const line of (result.data.tsv ?? "").split(/\r?\n/)) {
            const columns = line.split("\t");
            if (columns[0] === "5" && columns.length >= 12 && columns.slice(11).join("").trim()) {
              columns[1] = String(pageNumber);
              lines.push(columns.join("\t"));
            }
          }
        }
      }
      return lines;
    } finally {
      await worker.terminate();
    }
  }, { pdfBase64, dpi: DPI, ...options });
}

// As mergeOcrTsvPages in src/client/import-helpers.js: one header, and each
// line carries its page number.
function mergeOcrTsvPages(pages) {
  const withPageNumber = (line, pageNumber) => {
    const columns = line.split("\t");
    if (columns.length > 1) {
      columns[1] = String(pageNumber);
    }
    return columns.join("\t");
  };
  return pages.map((tsv, index) => {
    const lines = tsv.trim().split(/\r?\n/);
    return (index === 0 ? lines.map((line, lineIndex) => lineIndex === 0 ? line : withPageNumber(line, 1)) : lines.slice(1).map((line) => withPageNumber(line, index + 1))).join("\n");
  }).join("\n");
}
