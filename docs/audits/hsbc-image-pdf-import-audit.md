# HSBC Image PDF Import Audit

Date: 2026-07-07
Updated: 2026-10-07

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
- 2026-10-07, real Aug-Oct 2026 statements. September certified MOTHERCARE at
  523.70 (it is 459.00) because OCR could not read IKEA's 64.70 and the lone
  purchase rule moved the whole total onto the one row it had read. October
  failed to reconcile because the transaction date "01 Oct" was read as
  `010ct` and the Etsy row was dropped. August kept a dotted rule's OCR noise
  in a description and wrote `txn date: 2026-undefined-25` for a month read
  as `Jui`. Running OCR again with Tesseract page layout mode 6 reads what
  mode 4 misses on these statements (IKEA's 64.70, `CEBU PAC`), while mode 4
  reads what mode 6 misses (the payment and the purchases total). 300 dpi and
  grayscale contrast stretching did not help.
- The committed Feb-Jul browser OCR fixtures still contained the card holder's
  name, street and postal code, and tests named files after the full card
  number. The current files are scrubbed (2026-10-07); the values remain in git
  history.
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
  summary components.
- Bank-independent OCR helpers live in `src/lib/statement-import/ocr.ts`
  (TSV words with confidence, line grouping, noise filtering, tolerant amounts,
  dates resolved against the statement period, and the totals-as-checksum
  resolver). A bank parser only decides where its columns and summary are.
- Amounts: a read amount is kept. A row no OCR pass could read takes its
  total's remaining amount only when it is that total's single unknown. A read
  amount is replaced by its total only when it is the lone row of its kind
  (purchases or credits) and the summary balances (the May 2026 IKEA 157.20 was
  read as 187.20). Two unknowns, or two rows that could each be the misread
  one, fail reconciliation instead of guessing. The parse reports inferred
  amounts in `ocrReview.inferredAmounts`.
- Dates: OCR month damage (`0ct`, `Jui`, `Ju`, a stray letter) is resolved
  against the statement period; a two-digit day wins over a one-digit one, and
  a date the text cannot support is left unread rather than guessed.
- Noise: words under 6 px tall (dotted rules), and low-confidence words that look
  like rules (runs of round letters, very wide boxes), are dropped; a real
  all-caps word at 0% confidence is kept.
- Two passes: Imports OCRs once (mode 4). When the parse cannot reconcile, infers
  an amount, or has a row with a description word under 60% confidence, it OCRs
  again (mode 6) and parses both passes together: rows are lined up by position,
  the most legible description wins, and the printed totals choose between amount
  readings. Package format: each pass is `__OCR_TSV__` plus its TSV, in order.
- 2026-10-09, recovery instead of a dead end (Codex's report in
  `hsbc-september-2026-reconciliation-report.md`): a statement whose rows do
  not add up opens for review with a live totals check that hard-blocks the
  commit (no Commit anyway) until the current rows add up. Missing rows are
  offered only from evidence: an amount read on a line no row claimed, offered
  while it equals the difference exactly, or a dated row whose amount the user
  types from the PDF. An unclaimed amount on the page stops inference for its
  kind, so one unread row cannot absorb a whole missing row's amount. Codex's
  first cut cleared the block on the Add click and offered the difference
  itself as an amount; both were replaced before shipping.
- Merchant-specific corrections from earlier OCR runs stay in one labelled table
  (`HSBC_KNOWN_MISREADS`) and only rewrite text that can only be those merchants.

## Tests

- Unit parser coverage uses a sanitized near-real Tesseract TSV fixture from the HSBC statement layout.
- Unit parser coverage also includes browser-OCR TSV fixtures generated from the
  supplied February through July 2026 HSBC PDFs. These fixtures preserve the
  actual in-browser OCR failure modes without requiring tests to read local
  machine files. Header/footer cardholder details and card numbers are
  sanitized in the committed fixtures.
- Unit classifier coverage routes `.hsbc-ocr.tsv` and `__OCR_TSV__` content to statement parsing.
- E2E upload coverage proves both direct image-only PDF OCR and local OCR
  packages reach the Imports statement preview, show account mapping, and
  display parsed HSBC rows.
- App-level E2E coverage uploads sanitized, image-only HSBC PDFs for February
  through July 2026 through the same private browser OCR path used by drag/drop
  imports. This includes the May statement that previously failed in production.
- App-level E2E package coverage also uploads the matching browser-OCR February
  through July 2026 TSV fixtures so parser behavior remains debuggable without
  rerunning OCR.
- A self-contained test guard scans the test tree for hard-coded local paths so
  tests cannot silently depend on files outside the repository checkout.
- Aug-Oct 2026: unit fixtures hold both OCR passes of the real statements
  (sanitized with `scripts/sanitize-ocr-tsv.mjs`), plus the OCR of the
  sanitized May image PDF whose dotted rule exposed the 1 px noise case.
  `tests/ocr-statement-helpers.test.mjs` covers the general helpers, including
  the refused paths. Both e2e HSBC tests now cover February through October;
  the Aug-Oct image PDFs need the second pass.
- Local real-file check 2026-10-07: the real Jul-Oct PDFs uploaded through
  Imports with every row matching the statement, "The card balances", and a
  successful commit (9-32 s each, including the second pass).
- Local real-file checks confirmed the supplied February through July 2026 HSBC
  PDFs upload without sending files to a third-party OCR service. March, April,
  and May produced activity rows; February, June, and July produced valid empty
  statement checkpoints.

## Follow-Up

- Watch production Worker asset size after vendoring OCR assets. If asset upload
  size becomes a deployment concern, gzip the language data or split OCR assets
  into a separately cached private asset bundle while preserving same-origin
  loading and no third-party OCR uploads.
