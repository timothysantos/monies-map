# Import Quality and Transfer Review Task List

Updated: 2026-08-21

## Goal

Stop statement-layout contamination before it enters the ledger and make large
unresolved-transfer backlogs reviewable in small accounting batches.

## Task List

- [x] Reproduce the likely OCBC 360 failure shape where statement footer text is
  merged inline with a transaction description.
- [x] Harden OCBC description cleanup for inline disclosure, page header,
  contact, and statement-account boilerplate.
- [x] Add an import-boundary description quality check that blocks oversized or
  statement-boilerplate descriptions during preview.
- [x] Add the same import-boundary check during commit so crafted or stale
  previews cannot write contaminated rows.
- [x] Keep the quality check text-only and in memory. Do not persist original
  PDFs, CSVs, XLS files, OCR images, or raw bank files.
- [x] Mark already-stored oversized transfer descriptions as shortened in the
  Settings review payload without returning the full stored text.
- [x] Convert unresolved transfer review from one global list into a month
  queue with small pages inside the selected month.
- [x] Add focused parser, import-quality, and transfer-queue model tests.
- [x] Update FAQ and review audit documentation.

## UX Rules

- Block suspicious import rows before commit rather than asking the user to
  clean a 4,500-character ledger row later.
- Show the warning where the user can still act: import preview for new files,
  Settings transfer review for old rows already in the ledger.
- Keep transfer review scoped to one month at a time. The total backlog can be
  large, but the visible work unit should be small.
- Keep `Clear all` available as an explicit maintenance action, but do not make
  it the primary way to cope with a backlog.
- Never require filename conventions and never store original bank files.
