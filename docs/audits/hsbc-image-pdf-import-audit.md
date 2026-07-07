# HSBC Image PDF Import Audit

Date: 2026-07-07

## Scope

- HSBC Visa Revolution card statements that contain page images instead of embedded PDF text.
- Existing browser PDF.js extraction and statement import preview flow.
- Privacy and security expectations for bank statement OCR.
- Parser tests and a local conversion helper that does not upload statement images.

## Findings

- The supplied HSBC PDFs have zero extractable text through `pdfplumber`; every page is image-only.
- The current app PDF path uses browser PDF.js text extraction. That is appropriate for embedded-text statements, but it cannot OCR scanned/image statements.
- Local Tesseract OCR produces usable word-coordinate TSV for the HSBC transaction table. Normal text lines can contain OCR noise, so line-text parsing alone is too brittle.
- The HSBC layout has stable column positions for post date, transaction date, description, and amount. Coordinate parsing plus statement-balance reconciliation is reliable for the supplied January, March, and April files.
- A normal CSV conversion would import rows but lose statement checkpoint/certification semantics. The app needs an OCR statement package path so imported OCR output still uses the PDF statement preview and reconciliation flow.

## Decisions

- Do not upload HSBC PDFs or page images for OCR.
- Add a local helper, `scripts/hsbc-pdf-to-import.mjs`, that renders the PDF with Poppler, runs Tesseract locally, deletes temporary images/TSV files, and writes an uploadable `.hsbc-ocr.tsv` package.
- Treat `.hsbc-ocr.tsv` as a statement source in Imports. It uses the same `parseStatementText`, account mapping, checkpoint, reconciliation, and certification path as supported PDF statements.
- Keep the parser isolated in `src/lib/statement-import/hsbc-ocr.ts`; future browser-side OCR can reuse this parser without changing HSBC statement rules.
- Validate OCR imports by reconciling `previous balance + purchases - credits` against the printed total account balance before preview.

## Tests

- Unit parser coverage uses a sanitized near-real Tesseract TSV fixture from the HSBC statement layout.
- Unit classifier coverage routes `.hsbc-ocr.tsv` and `__OCR_TSV__` content to statement parsing.
- E2E upload coverage proves the local OCR package reaches the Imports statement preview, shows account mapping, and displays parsed HSBC rows.
- Local real-file check converted the supplied January, March, and April HSBC PDFs without uploading them.

## Follow-Up

- Full in-browser OCR remains possible with Tesseract.js, but it needs a lockfile-safe dependency update or vendored WASM/language assets. The current implementation deliberately avoids a CDN/runtime model download during import.
