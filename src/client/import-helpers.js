import { formatMinorInput } from "./formatters";
import { attemptParse, chooseImageStatementParse } from "./import-ocr-passes";
import { OCR_CELL_CHARACTERS } from "../lib/statement-import/ocr";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
export { inferImportMapping } from "./import-column-mapping";

export function getImportDirectOwnerForAccount(accounts, people, accountName, fallbackOwnerName, accountId) {
  const account = accounts.find((item) => (
    accountId
      ? item.id === accountId || item.accountId === accountId
      : item.name === accountName || item.accountName === accountName
  ));
  if (account && !account.isJoint && account.ownerLabel && account.ownerLabel !== "Shared") {
    return people.some((person) => person.name === account.ownerLabel)
      ? account.ownerLabel
      : fallbackOwnerName;
  }

  return fallbackOwnerName;
}


export function buildMappedImportRows(rows, columnMappings) {
  return rows
    .map((row) => {
      const mappedRow = {};

      for (const [header, target] of Object.entries(columnMappings)) {
        if (!target || target === "ignore") {
          continue;
        }

        const rawValue = row[header];
        if (rawValue == null || rawValue === "") {
          continue;
        }

        if (target === "amount" || target === "expense" || target === "income") {
          mappedRow[target] = rawValue;
          continue;
        }

        mappedRow[target] = rawValue;
      }

      return mappedRow;
    })
    .filter((row) => Object.keys(row).length > 0);
}

export function buildRawImportRowFromPreviewRow(row) {
  const isMoneyIn = row.entryType === "income" || (row.entryType === "transfer" && row.transferDirection === "in");
  return {
    date: row.date,
    description: row.description,
    expense: isMoneyIn ? "" : formatMinorInput(row.amountMinor),
    income: isMoneyIn ? formatMinorInput(row.amountMinor) : "",
    accountId: row.accountId ?? "",
    account: row.accountName ?? "",
    statementAccountName: row.statementAccountName ?? row.rawRow?.statementAccountName ?? row.rawRow?.statementAccount ?? row.rawRow?.account ?? row.accountName ?? "",
    category: row.categoryName ?? "",
    note: row.note ?? "",
    type: row.entryType,
    ...(row.reconciliationTargetTransactionId ? { previewReconciliationTargetTransactionId: row.reconciliationTargetTransactionId } : {}),
    ...(row.commitStatusExplicit && row.commitStatus ? { commitStatus: row.commitStatus } : {})
  };
}

export async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
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

// The OCR engine and renderer every image statement goes through: the PDF's
// pages rendered at 220 dpi (the parsers' reference frame) and one worker.
async function openOcrSession(file, onProgress) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const tesseractModule = await importRuntimeModule("/vendor/tesseract/tesseract.esm.min.js");
  const createWorker = resolveTesseractCreateWorker(tesseractModule);
  if (typeof createWorker !== "function") {
    throw new Error("Local OCR engine did not load. Try refreshing the app and uploading the PDF again.");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const worker = await createWorker("eng", 1, {
    workerPath: "/vendor/tesseract/worker.min.js",
    corePath: "/vendor/tesseract",
    langPath: "/vendor/tesseract",
    gzip: false,
    logger: (message) => {
      if (message?.status) {
        onProgress?.({
          status: message.status,
          progress: typeof message.progress === "number" ? message.progress : undefined
        });
      }
    }
  });
  return { document, worker };
}

async function renderPdfPageForOcr(document, pageNumber) {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 220 / 72 });
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Could not create OCR canvas.");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

// pageSegMode is Tesseract's page layout mode: "4" (one column of
// variable-size text) is the first pass; a second pass in "6" (one uniform
// block) reads some rows the first one cannot.
export async function extractPdfOcrText(file, onProgress, { pageSegMode = "4" } = {}) {
  const { document, worker } = await openOcrSession(file, onProgress);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
    const tsvPages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress?.({ status: "rendering page", pageNumber, pageCount: document.numPages });
      const canvas = await renderPdfPageForOcr(document, pageNumber);
      onProgress?.({ status: "recognizing text", pageNumber, pageCount: document.numPages });
      const result = await worker.recognize(canvas, {}, { text: true, tsv: true });
      tsvPages.push(result.data.tsv ?? "");
    }

    return `__OCR_TSV__\n${mergeOcrTsvPages(tsvPages)}`;
  } finally {
    await worker.terminate();
  }
}

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
      let characters = "";
      for (const region of cellRegions.filter((item) => item.page === pageNumber)) {
        if (region.characters !== characters) {
          characters = region.characters;
          await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: OCR_CELL_CHARACTERS[characters] });
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

// Parses an image statement from its first OCR pass. When the parser cannot
// reconcile that reading, or reports it as doubtful (an inferred amount or a
// barely legible row), the PDF is OCR'd again in a second page layout mode
// and the cells the parser points at are read one by one; all passes are
// parsed together and the statement's totals choose between the readings.
// Each pass is an "__OCR_TSV__" package, so packages joined by newlines are
// the multi-pass package.
export async function parseImageStatement({ file, firstPass, parse, onProgress }) {
  const first = attemptParse(parse, firstPass);
  if (first.parsed && !first.parsed.ocrReview?.wantsSecondPass) {
    return first.parsed;
  }
  const secondPass = await extractPdfOcrText(file, onProgress, { pageSegMode: "6" });
  const cellRegions = first.parsed?.ocrReview?.cellRegions;
  const cellPass = cellRegions?.length
    ? await extractPdfOcrCells(file, { cellRegions, referenceSize: first.parsed.ocrReview.referenceSize }, onProgress)
    : "";
  const passes = [firstPass, secondPass, cellPass].filter(Boolean).join("\n");
  return chooseImageStatementParse(first, attemptParse(parse, passes));
}

export function isExtractedPdfTextEmpty(text) {
  const rawText = text.split("__PDF_LAYOUT_TEXT__")[0] ?? text;
  return rawText.replace(/\s+/g, "").length < 20;
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

function mergeOcrTsvPages(pages) {
  return pages.map((page, index) => {
    const lines = page.trim().split(/\r?\n/);
    if (index === 0) {
      return lines.map((line, lineIndex) => lineIndex === 0 ? line : withOcrPageNumber(line, index + 1)).join("\n");
    }
    return lines.slice(1).map((line) => withOcrPageNumber(line, index + 1)).join("\n");
  }).join("\n");
}

function withOcrPageNumber(line, pageNumber) {
  const columns = line.split("\t");
  if (columns.length > 1) {
    columns[1] = String(pageNumber);
  }
  return columns.join("\t");
}

function importRuntimeModule(path) {
  return new Function("path", "return import(path)")(path);
}

function resolveTesseractCreateWorker(tesseractModule) {
  return (
    tesseractModule?.createWorker ??
    tesseractModule?.default?.createWorker ??
    globalThis.Tesseract?.createWorker
  );
}

export function selectParsedStatementForCompare(parsed, target) {
  const checkpoint = parsed.checkpoints.find((item) => item.accountName === target.accountName) ?? parsed.checkpoints[0];
  const accountNames = new Set(parsed.rows.map((row) => row.account).filter(Boolean));
  if (accountNames.size > 1 && target.accountName && !accountNames.has(target.accountName)) {
    throw new Error(`This statement does not contain rows for ${target.accountName}.`);
  }

  const rows = accountNames.size > 1
    ? parsed.rows.filter((row) => row.account === target.accountName)
    : parsed.rows;
  // The statement's other cards, so the comparison can tell an entry that
  // belongs on one of them.
  const otherSections = accountNames.size > 1
    ? parsed.checkpoints
      .filter((item) => item.accountName !== target.accountName)
      .map((item) => ({
        accountName: item.accountName,
        accountLast4: item.accountLast4,
        statementStartDate: item.statementStartDate,
        statementEndDate: item.statementEndDate,
        rows: parsed.rows.filter((row) => row.account === item.accountName)
      }))
    : [];

  return { checkpoint, rows, otherSections };
}
