// Turns a real image-only statement PDF into a sanitized image-only PDF for
// browser OCR tests. Each page is rendered at 220 dpi with pdf.js in headless
// Chromium (the app's own renderer), the layout's private areas
// (scripts/statement-private-areas.mjs) are painted over with placeholder
// text, and the pages are written back as lossless grayscale images. No
// poppler or Python needed.
//
//   node scripts/create-sanitized-statement-pdf.mjs <in.pdf> <out.pdf> [--layout hsbc-visa-revolution]
//
// Set OCR_SANITIZE_CHECK_TERMS="term one,term two" (the real name, card
// digits, address) to OCR the sanitized first page with the app's vendored
// Tesseract and refuse to write the file when any term is still readable.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

import { privateCheckTerms, statementLayout } from "./statement-private-areas.mjs";

const DPI = 220;
const ORIGIN = "https://sanitizer.local";
const SERVED_FILES = {
  "/pdf.mjs": "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "/pdf.worker.mjs": "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
};

const [inputPath, outputPath, ...flags] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/create-sanitized-statement-pdf.mjs <in.pdf> <out.pdf> [--layout hsbc-visa-revolution]");
  process.exit(1);
}
const layout = statementLayout(flags);
const checkTerms = privateCheckTerms();

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><title>sanitize</title>" });
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
  const rendered = await page.evaluate(async ({ pdfBase64, layout, dpi, verify }) => {
    const pdfjs = await import("/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    const data = Uint8Array.from(atob(pdfBase64), (char) => char.charCodeAt(0));
    const document = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    let firstPageCanvas;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pdfPage = await document.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: dpi / 72 });
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport }).promise;

      if (pageNumber === layout.page) {
        const xScale = canvas.width / layout.referenceWidth;
        const yScale = canvas.height / layout.referenceHeight;
        for (const { box: [left, top, right, bottom], placeholder, size } of layout.areas) {
          context.fillStyle = "#fff";
          context.fillRect(left * xScale, top * yScale, (right - left) * xScale, (bottom - top) * yScale);
          context.fillStyle = "#000";
          context.font = `${Math.round(size * yScale)}px Helvetica, Arial, sans-serif`;
          context.textBaseline = "top";
          placeholder.split("\n").forEach((text, index) => {
            context.fillText(text, (left + 10) * xScale, (top + 6 + index * (size + 4)) * yScale);
          });
        }
        firstPageCanvas = canvas;
      }

      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < gray.length; index += 1) {
        gray[index] = Math.round(0.299 * rgba[index * 4] + 0.587 * rgba[index * 4 + 1] + 0.114 * rgba[index * 4 + 2]);
      }
      // "deflate" is a zlib stream, which is what PDF's FlateDecode reads.
      const compressed = new Uint8Array(await new Response(new Blob([gray]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
      let binary = "";
      for (let index = 0; index < compressed.length; index += 0x8000) {
        binary += String.fromCharCode(...compressed.subarray(index, index + 0x8000));
      }
      pages.push({ width: canvas.width, height: canvas.height, data: btoa(binary) });
    }

    let firstPageText = "";
    if (verify && firstPageCanvas) {
      const tesseract = await import("/vendor/tesseract/tesseract.esm.min.js");
      const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
      const worker = await createWorker("eng", 1, {
        workerPath: "/vendor/tesseract/worker.min.js",
        corePath: "/vendor/tesseract",
        langPath: "/vendor/tesseract",
        gzip: false
      });
      await worker.setParameters({ tessedit_pageseg_mode: "4" });
      firstPageText = (await worker.recognize(firstPageCanvas)).data.text ?? "";
      await worker.terminate();
    }
    return { pages, firstPageText };
  }, { pdfBase64, layout, dpi: DPI, verify: checkTerms.length > 0 });

  const leaked = checkTerms.filter((term) => rendered.firstPageText.toLowerCase().includes(term.toLowerCase()));
  if (leaked.length) {
    console.error(`${leaked.length} private term(s) are still readable on page 1; not written.`);
    process.exitCode = 1;
  } else {
    await writeFile(outputPath, buildGrayscaleImagePdf(rendered.pages.map((item) => ({ ...item, data: Buffer.from(item.data, "base64") })), DPI));
    console.log(`Wrote ${outputPath} (${rendered.pages.length} pages${checkTerms.length ? `, OCR-checked ${checkTerms.length} terms` : ""})`);
  }
} finally {
  await browser.close();
}

// A minimal PDF: one full-page 8-bit grayscale image per page, FlateDecode.
function buildGrayscaleImagePdf(pages, dpi) {
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [];
  let length = chunks[0].length;
  const addObject = (id, body) => {
    offsets[id] = length;
    const parts = [Buffer.from(`${id} 0 obj\n`), ...(Array.isArray(body) ? body : [Buffer.from(body)]), Buffer.from("\nendobj\n")];
    for (const part of parts) {
      chunks.push(part);
      length += part.length;
    }
  };

  const pageIds = pages.map((_, index) => 3 + index * 3);
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((item, index) => {
    const pageId = pageIds[index];
    const width = (item.width * 72 / dpi).toFixed(2);
    const height = (item.height * 72 / dpi).toFixed(2);
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    addObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    addObject(pageId + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    addObject(pageId + 2, [
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${item.width} /Height ${item.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${item.data.length} >>\nstream\n`),
      item.data,
      Buffer.from("\nendstream")
    ]);
  });

  const objectCount = 3 + pages.length * 3;
  const xrefOffset = length;
  const xref = [`xref\n0 ${objectCount}\n`, "0000000000 65535 f \n"];
  for (let id = 1; id < objectCount; id += 1) {
    xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  xref.push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join("")));
  return Buffer.concat(chunks);
}
