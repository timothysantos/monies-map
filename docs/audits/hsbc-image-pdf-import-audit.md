# HSBC Image PDF Import Audit

Date: 2026-07-07
Updated: 2026-07-08

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
- Browser OCR is noisier than local Tesseract for the same PDFs. It can split a
  transaction merchant onto the line above its dates, drop the first letter from
  `Total Account Balance`, read `01 May` as `on May`, or misread a single
  transaction amount while still reading the account-summary totals correctly.
- Production can expose stale browser bundle behavior even after parser tests
  pass locally. On 2026-07-08 the May 2026 PDF failed in production with
  `Expected 0.00, got -157.20`, which means the payment row was missing from
  the deployed browser OCR path while the current local bundle parsed the same
  PDF as one expense and one matching payment. Deploy freshness is now part of
  the validation checklist for HSBC OCR changes.
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
- When browser OCR misses the printed total-account-balance amount but reads the
  account-summary components, compute the checkpoint balance from the printed
  summary components. When there is exactly one expense or one credit row and
  its OCR amount conflicts with the printed summary total, correct that single
  row to the summary amount before reconciliation.

## Tests

- Unit parser coverage uses a sanitized near-real Tesseract TSV fixture from the HSBC statement layout.
- Unit parser coverage also includes browser-OCR TSV fixtures generated from the
  supplied February through July 2026 HSBC PDFs. These fixtures preserve the
  actual in-browser OCR failure modes without requiring tests to read local
  Downloads files.
- Unit classifier coverage routes `.hsbc-ocr.tsv` and `__OCR_TSV__` content to statement parsing.
- E2E upload coverage proves both direct image-only PDF OCR and local OCR
  packages reach the Imports statement preview, show account mapping, and
  display parsed HSBC rows.
- App-level E2E package coverage uploads the browser-OCR February through July
  2026 fixtures, including the May statement that previously failed in
  production.
- Local real-PDF E2E coverage runs when `HSBC_REAL_PDF_DIR` points at the
  supplied statements. It uploads February through July 2026 through the same
  private browser OCR path the user uses in Imports. This test is intentionally
  local-only unless sanitized PDFs are committed later; it is the regression
  check that would have caught a May-specific browser OCR drift before deploy.
- Local real-file checks confirmed the supplied February through July 2026 HSBC
  PDFs upload without sending files to a third-party OCR service. March, April,
  and May produced activity rows; February, June, and July produced valid empty
  statement checkpoints.

## Follow-Up

- Watch production Worker asset size after vendoring OCR assets. If asset upload
  size becomes a deployment concern, gzip the language data or split OCR assets
  into a separately cached private asset bundle while preserving same-origin
  loading and no third-party OCR uploads.
