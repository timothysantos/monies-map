# Import Quality and Transfer Review Audit

Updated: 2026-08-21

## Scope

- Oversized imported bank descriptions, including rows up to thousands of
  characters.
- OCBC 360 statement footer/header text leaking into transaction descriptions.
- Import-stage prevention for future contaminated rows.
- Settings unresolved-transfer review backlog ergonomics.

## Root Cause

The existing OCBC parser already stopped when disclosure and page-header text
appeared as separate lines. The missing case was PDF extraction or OCR merging
statement furniture into the same logical line as a transaction continuation.
That allowed text such as bank disclosure, statement account labels, contact
copy, and transaction-code headers to survive as part of the transaction
description.

The previous import pipeline trusted the parser-normalized description after
basic row normalization. It did not have a second quality gate for descriptions
that were implausibly long or contained statement boilerplate.

The unresolved-transfer review UI had server-side payload bounds and six-row
pagination, but still presented the backlog as one global queue. At hundreds of
rows, that is not a usable accounting workflow.

## Changes

- OCBC description cleanup now strips inline bank disclosure, contact, page,
  account, and transaction-code boilerplate before compacting the description.
- Import preview now blocks rows with unusually long descriptions or known
  statement-boilerplate markers.
- Import commit repeats the same description quality check before any ledger
  insert or promotion.
- Settings unresolved-transfer rows now include a bounded
  `descriptionTruncated` signal when the backend shortened an old oversized
  description for display.
- Settings unresolved transfers are grouped by month. The selected month has
  its own six-row pages, so the user reviews a concrete period rather than an
  unbounded global backlog.
- Settings shows a compact warning when old transfer-review rows were shortened
  for display and explains that future imports are now blocked before ledger
  write.

## Non-Goals

- No original bank-file storage was added.
- No bank-sync or aggregator integration was added.
- No destructive cleanup of existing contaminated ledger rows was performed.
  Existing rows are surfaced safely for review and can be corrected through the
  normal ledger workflows.

## Proof

- `tests/parser-contract.test.mjs` covers separate-line and inline OCBC 360
  disclosure contamination.
- `tests/import-description-quality.test.mjs` covers normal descriptions,
  oversized descriptions, and statement-boilerplate blocking.
- `tests/settings-transfer-review-model.test.mjs` covers newest-month default,
  month grouping, pagination, selected month behavior, and shortened-description
  counts.
