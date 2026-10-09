# HSBC September 2026 Reconciliation Report

Date: 2026-10-08

## Executive finding

The HSBC PDF is internally consistent. The printed purchase total is **SGD
218.35**, and the seven visible purchase rows add up to exactly **SGD 218.35**.
The production import failed because the browser OCR/parser omitted the Etsy
purchase of **SGD 29.92**. It therefore calculated **SGD 188.43** and stopped
before preview or commit.

No September HSBC import, draft, import row, or transaction was written to
production. The failure is safe from a data-integrity perspective, but the
current error leaves the user without a way to identify or correct the missing
row.

## What was checked

- Source file: the real HSBC Visa Revolution statement for 7 Sep - 5 Oct 2026 (local file, not in the repo)
- PDF visual rendering with Poppler: two rendered pages, with the statement
  activity on page 1 and terms on page 2.
- Local Tesseract OCR at the same 220 DPI and page-segmentation mode used by
  the repository fallback helper.
- Current HSBC parser: `src/lib/statement-import/hsbc-ocr.ts`.
- Browser OCR path: `src/client/import-helpers.js`.
- Import error handling: `src/client/imports-panel.jsx`.
- Production D1, read-only, using the `monies-map` database.

## Statement facts from the PDF

The statement period is **07 Sep 2026 to 05 Oct 2026**. The account summary
shows:

| Printed fact | Amount |
| --- | ---: |
| Previous statement balance | 0.00 |
| Payments & credits | 0.00 |
| Purchases & debits | 218.35 |
| GST charges | 0.00 |
| GST reversals | 0.00 |
| Total account balance | 218.35 |

The seven visible purchase rows are:

| Post date | Transaction date | Description | Amount |
| --- | --- | --- | ---: |
| 16 Sep | 15 Sep | KINOKUNIYA-TAKASHIMAYA SINGAPORE SG | 34.95 |
| 19 Sep | 17 Sep | FAMILY-COM ELECTRONICS SINGAPORE SG | 98.00 |
| 26 Sep | 25 Sep | CREATIVE SALON LLP SINGAPORE SG | 37.00 |
| 02 Oct | 30 Sep | Buyandship Limited Hong Kong HK | 18.00 |
| 02 Oct | 02 Oct | DCC FEE | 0.18 |
| 03 Oct | 01 Oct | Etsy WWW.ETSY.COM IE | 29.92 |
| 03 Oct | 03 Oct | DCC FEE | 0.30 |
| **Total** |  |  | **218.35** |

## Reproduction and mismatch diagnosis

The production UI displayed:

> HSBC statement purchases did not reconcile. Expected 218.35, got 188.43.

The arithmetic identifies the missing row precisely:

```text
218.35 - 188.43 = 29.92
```

That is the Etsy amount printed on the statement. The production result is also
consistent with retaining every other visible row:

```text
34.95 + 98.00 + 37.00 + 18.00 + 0.18 + 0.30 = 188.43
```

The local Tesseract run found the Etsy text and amount in its raw TSV, but the
current coordinate/line parser did not promote it into a row. The same local
run also missed the first KINOKUNIYA row during row promotion and stopped at
153.00. This is a second, independent proof that the parser is vulnerable to
OCR line placement and not only to the browser's OCR output.

The browser OCR and local OCR are not identical byte-for-byte, but they share
the same failure class: the statement's merchant text is split across lines
and the parser requires the dates, description, and amount to be associated
with one sufficiently coherent OCR line group. The Etsy row is visually
present and OCR-readable, but it is not reliably attached to the transaction
record before reconciliation.

## Production database check

The production `imports` table contains the previously committed HSBC import
for the August statement with six rows. It contains no September 2026 HSBC
import. The latest imports are the two UOB September imports; there is no
failed or draft HSBC record.

The existing successful HSBC rows show another quality concern: OCR noise is
currently persisted in descriptions, for example extra character fragments in
the August statement's Shaw Theatres row. That does not cause this mismatch,
but it confirms that OCR quality needs to be visible and reviewable before
commit.

## Why the current UX is inadequate

The current flow is privacy-preserving and correctly blocks unsafe data, but
it fails too early:

1. The user sees a generic “Import needs attention” error.
2. There is no parsed-row preview because the parser throws before creating a
   reviewable result.
3. The error does not say which row or amount is missing.
4. There is no statement-total breakdown showing expected, detected, and
   unexplained amounts.
5. The user cannot correct or confirm a low-confidence OCR row in the app.
6. The long import page makes recovery harder because the next action is not
   anchored to the error or upload step.

The safety rule is right: the app must not silently invent a row or commit an
unreconciled statement. The review boundary is wrong: a recoverable OCR
discrepancy should open a diagnostic review state instead of becoming a dead
end.

## Recommended improvements

### Parser and OCR

Priority 1:

- Parse HSBC rows as a table region, not only as grouped OCR text lines.
- Detect every date pair in the post-date and transaction-date columns, then
  attach the nearest description words and amount by coordinate proximity.
- Keep rows with weak merchant text or low OCR confidence instead of dropping
  them. A row with dates and an amount should survive into review.
- Add a statement-level candidate list containing all detected amounts,
  including candidates not yet promoted to ledger rows.
- Preserve the raw OCR confidence and bounding-box evidence in an in-memory
  diagnostic object; do not persist the original PDF or image.
- Add a targeted fixture for this September PDF shape: the Etsy row, the two
  DCC rows, and the KINOKUNIYA row must all be present and reconcile to
  218.35.

Priority 2:

- Try a second OCR layout strategy for a failed reconciliation, such as a
  tighter transaction-column crop or an alternate page segmentation mode.
- Normalize obvious OCR artifacts in merchant descriptions while retaining the
  original OCR text in the review detail.
- Make the local fallback helper and the browser path share a single parser
  test harness so a parser change is proven against both OCR output shapes.
- Fix the helper entrypoint so it runs consistently from the documented command
  without requiring an implicit `tsx` invocation.

### Reconciliation model

- Return a structured reconciliation result instead of throwing away all rows:
  expected purchases, detected purchases, unexplained difference, candidate
  rows, and confidence.
- Classify this case as `missing_or_uncertain_statement_row`, not as a generic
  parse failure.
- Offer an explicit “Add missing statement row” action only when the
  statement-total delta matches exactly one unpromoted candidate amount.
- Require the user to confirm the candidate against the PDF before it can be
  committed. The app must never auto-certify a guessed merchant or amount.
- Keep the final invariant: the statement must reconcile before certification.

### Import UI/UX

- Show a compact reconciliation card immediately after OCR:

  ```text
  Statement purchases       $218.35
  Rows currently detected  $188.43
  Difference                $29.92
  Possible missing row      Etsy · 01 Oct · $29.92
  ```

- Open a reviewable “Needs one confirmation” state with the detected rows and
  the unresolved candidate, instead of clearing the preview.
- Provide “View statement evidence” beside the candidate. This can show the
  OCR crop/bounding box or a clear instruction to compare page 1 of the local
  PDF, without uploading the document.
- Add a sticky import progress/breadcrumb for long pages: **Select file → OCR
  check → Reconcile → Review → Commit**. Clicking a step should scroll to the
  relevant section and show the number of unresolved actions.
- Keep the commit button disabled until the discrepancy is resolved and the
  statement total matches.
- Explain that nothing was saved when parsing fails, so the user knows there is
  no duplicate or partial import to clean up.
- Surface OCR quality warnings on the affected row, rather than only as a
  generic batch warning.

### Test and operations

- Add a real-shape sanitized September fixture and a browser OCR fixture for
  the exact missing-Etsy failure.
- Add a negative test proving that an unmatched amount still blocks commit.
- Add a recovery test proving that a single exact delta candidate can be
  confirmed and then reaches preview/commit.
- Add telemetry-safe diagnostics: parser key, statement month, expected total,
  detected total, delta, candidate count, and OCR strategy. Never log PDFs,
  card numbers, raw OCR text, or merchant details.
- Include a production smoke check after deployment using a sanitized fixture;
  existing local parser tests alone are insufficient because browser OCR
  output can differ from local Tesseract output.

## Proposed implementation order

1. Capture the September browser-OCR TSV and add the failing fixture.
2. Refactor HSBC row extraction to retain date/amount candidates and attach
   descriptions by coordinates.
3. Return structured reconciliation diagnostics while preserving the hard
   commit block.
4. Add the candidate review UI and sticky workflow navigation.
5. Add recovery, negative, and production smoke tests.
6. Update the user and developer guides after the new review state is approved.

## Scope decision

This report does not change production data or deploy a parser fix. The failed
upload left no production record, so the next safe engineering step is a
fixture-backed parser/UX slice followed by local and production verification.
