// The three views of a PDF's text the statement parsers read. Kept apart from
// pdf.js itself (import-helpers.js loads and opens the file) so the same
// reading runs on any opened document, including one that was locked.

/**
 * @param {{ numPages: number, getPage: (pageNumber: number) => Promise<any> }} document an opened pdf.js document
 * @returns {Promise<string>} the raw text items, then `__PDF_LAYOUT_TEXT__` and
 *   `__PDF_SPACED_LAYOUT_TEXT__` with each visual line (see
 *   tests/fixtures/pdf-statement-text/README.md)
 */
export async function extractTextFromPdfDocument(document) {
  const pages = [];
  const layoutPages = [];
  const spacedLayoutPages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join("\n"));
    layoutPages.push(extractPdfLayoutLines(content.items).join("\n"));
    spacedLayoutPages.push(extractPdfLayoutLines(content.items, " ").join("\n"));
  }

  return `${pages.join("\n")}\n__PDF_LAYOUT_TEXT__\n${layoutPages.join("\n")}\n__PDF_SPACED_LAYOUT_TEXT__\n${spacedLayoutPages.join("\n")}`;
}

function extractPdfLayoutLines(items, chunkSeparator = "") {
  const lines = [];
  for (const item of items) {
    const text = item.str ?? "";
    if (!text.trim()) {
      continue;
    }

    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2.5);
    if (!line) {
      line = { y, chunks: [] };
      lines.push(line);
    }
    line.chunks.push({ x, text });
  }

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => line.chunks
      .sort((left, right) => left.x - right.x)
      .map((chunk) => chunk.text)
      .join(chunkSeparator)
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}
