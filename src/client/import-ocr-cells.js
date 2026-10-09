import { openOcrSession, renderPdfPageForOcr } from "./import-helpers";

// Reads the cells a statement parser pointed at (ocrReview.cellRegions), each
// on its own as one line of text restricted to a date's or an amount's
// characters. Far more reliable than a whole-page pass for exactly the values
// the statement totals check. Word positions stay in page coordinates.
export async function extractPdfOcrCells(file, { cellRegions, referenceSize }, onProgress) {
  const { document, worker } = await openOcrSession(file, onProgress);
  const lines = [];
  try {
    const pageNumbers = [...new Set(cellRegions.map((region) => region.page))]
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= document.numPages);
    for (const pageNumber of pageNumbers) {
      onProgress?.({ status: "rendering page", pageNumber, pageCount: document.numPages });
      const canvas = await renderPdfPageForOcr(document, pageNumber);
      const xScale = canvas.width / referenceSize.width;
      const yScale = canvas.height / referenceSize.height;
      lines.push(`1\t${pageNumber}\t0\t0\t0\t0\t0\t0\t${canvas.width}\t${canvas.height}\t-1\t`);
      onProgress?.({ status: "recognizing text", pageNumber, pageCount: document.numPages });
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
    return `__OCR_TSV__ kind=cells\n${lines.join("\n")}`;
  } finally {
    await worker.terminate();
  }
}
