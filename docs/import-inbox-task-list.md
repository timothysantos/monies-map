# Import Inbox Task List

## Product Goal

Make manual bank importing feel like a guided bank run instead of a memory and
file-management chore. The app owns the checklist. The user logs into each bank,
downloads the listed files without renaming them, drops them into Imports, and
reviews only exceptions.

## Task List

- [x] Model active account freshness from latest statement checkpoint, latest
  import activity, and pending split cleanup.
- [x] Group expected downloads by institution so one bank login session collects
  every needed file for that bank.
- [x] Keep accounting review order separate from download order so files can be
  collected by bank but reviewed oldest-statement-first.
- [x] Treat split cleanup as a separate post-import lane, not a blocker for bank
  file collection.
- [x] Add unit coverage for Citi-only lag, two-month all-account catch-up, and
  split cleanup separation.
- [x] Render Import Inbox at the top of Imports before the existing single-file
  composer.
- [x] Add a Summary/Month stale banner that links to Imports without showing the
  full checklist on every page.
- [x] Add multi-file drop queueing so users can drop all files from one bank or
  all banks at once.
- [x] Keep the empty intake queue visible with guidance that filename format is
  not required and original files are not stored.
- [x] Classify dropped files by content rather than filename, using parser
  evidence, statement periods, account/card hints, transaction ranges, and
  parsed-content fingerprints.
- [x] Detect duplicates by normalized parsed row evidence inside the browser-only
  intake queue.
- [x] Add ambiguous-file indicators that tell the user which queued files need
  account or period confirmation during review.
- [x] Add bank portal URLs and per-institution download instructions.
- [x] Add snooze/not-available states for statements that banks have not
  published yet.
- [x] Keep HSBC image PDFs on the same private browser OCR path in both single
  file and multi-file intake.
- [x] Block oversized or statement-boilerplate descriptions before import
  preview/commit can write them to the ledger.
- [ ] Evaluate bank aggregator sync as an optional activity-source spike, not as
  the statement-certification foundation.

## UX Rules

- Do not require filename conventions.
- Do not ask users to organize local folders before importing.
- Do not persist original PDFs, CSVs, XLS files, OCR images, or raw bank files.
  Multi-file intake may keep parsed browser-memory objects only until the user
  clears the queue, reloads, or loads one file into review.
- Treat an unusually long parsed transaction description as a parser or file
  quality failure, not as a ledger row the user should manually clean later.
- Do not mix bank evidence catch-up with split allocation cleanup.
- Optimize download collection around bank login sessions.
- Optimize review order around statement chronology and trust level.
- Use plain labels: `Need`, `Optional`, `Done`, `Download`, `Drop file`,
  `Already imported`, and `Review rows`.
- Keep internal terms such as `statement checkpoint`, `import batch`, and
  `parser` out of the main guided flow.
