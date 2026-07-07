# HSBC Image PDF Import Audit

Date: 2026-07-07

## Scope

- HSBC Visa Revolution card statements that contain page images instead of embedded PDF text.
- Existing browser PDF.js extraction and statement import preview flow.
- Privacy and security expectations for bank statement OCR.
- Parser tests, direct browser OCR, and a local fallback conversion helper that
  does not upload statement images.

## Findings

- The supplied HSBC PDFs have zero extractable text through `pdfplumber`; every page is image-only.
- The current app PDF path uses browser PDF.js text extraction. That is appropriate for embedded-text statements, but it cannot OCR scanned/image statements.
- Local Tesseract OCR produces usable word-coordinate TSV for the HSBC transaction table. Normal text lines can contain OCR noise, so line-text parsing alone is too brittle.
- Browser Tesseract OCR can run entirely from vendored app assets. It keeps the
  PDF and rendered page images on the user's device and avoids third-party OCR
  uploads.
- The HSBC layout has stable column positions for post date, transaction date,
  description, amount, and account summary values. Coordinate parsing plus
  statement-balance reconciliation is reliable across different render scales.
- A normal CSV conversion would import rows but lose statement checkpoint/certification semantics. OCR output must continue through the PDF statement preview and reconciliation flow.

## Decisions

- Do not upload HSBC PDFs or page images for OCR.
- Make drag/drop PDF upload the primary UX. When PDF.js finds no embedded text,
  Imports runs private in-browser OCR automatically and then opens the normal
  statement preview.
- Vendor the browser OCR engine, worker, WASM, and English language data under
  `public/vendor/tesseract/` so imports do not depend on CDN model downloads.
- Keep `scripts/hsbc-pdf-to-import.mjs` as a fallback that renders the PDF with
  Poppler, runs Tesseract locally, deletes temporary images/TSV files, and
  writes an uploadable `.hsbc-ocr.tsv` package.
- Treat direct browser OCR and `.hsbc-ocr.tsv` as statement sources in Imports.
  They use the same `parseStatementText`, account mapping, checkpoint,
  reconciliation, and certification path as supported PDF statements.
- Keep the parser isolated in `src/lib/statement-import/hsbc-ocr.ts` so OCR
  source transport stays separate from HSBC statement rules.
- Validate OCR imports by reconciling `previous balance + purchases - credits` against the printed total account balance before preview.

## Tests

- Unit parser coverage uses a sanitized near-real Tesseract TSV fixture from the HSBC statement layout.
- Unit classifier coverage routes `.hsbc-ocr.tsv` and `__OCR_TSV__` content to statement parsing.
- E2E upload coverage proves both direct image-only PDF OCR and the local OCR
  package reach the Imports statement preview, show account mapping, and display
  parsed HSBC rows.
- Local real-file check converted the supplied February through July 2026 HSBC
  PDFs without uploading them. March, April, and May produced activity rows;
  February, June, and July produced valid empty statement checkpoints.

## Follow-Up

- Watch production Worker asset size after vendoring OCR assets. If asset upload
  size becomes a deployment concern, gzip the language data or split OCR assets
  into a separately cached private asset bundle while preserving same-origin
  loading and no third-party OCR uploads.
