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
- [ ] Render Import Inbox at the top of Imports before the existing single-file
  composer.
- [ ] Add a Summary/Month stale banner that links to Imports without showing the
  full checklist on every page.
- [ ] Add multi-file drop queueing so users can drop all files from one bank or
  all banks at once.
- [ ] Classify dropped files by content rather than filename, using parser
  evidence, statement periods, account/card hints, transaction ranges, and file
  hashes.
- [ ] Detect duplicates by file/content hash and normalized parsed row evidence.
- [ ] Add ambiguous-file confirmation that asks the user to choose only the
  missing account/period when content cannot prove it.
- [ ] Add bank portal URLs and per-institution download instructions.
- [ ] Add snooze/not-available states for statements that banks have not
  published yet.
- [ ] Add local-private HSBC OCR confidence surfacing in the queued-file review
  path.
- [ ] Evaluate bank aggregator sync as an optional activity-source spike, not as
  the statement-certification foundation.

## UX Rules

- Do not require filename conventions.
- Do not ask users to organize local folders before importing.
- Do not mix bank evidence catch-up with split allocation cleanup.
- Optimize download collection around bank login sessions.
- Optimize review order around statement chronology and trust level.
- Use plain labels: `Need`, `Optional`, `Done`, `Download`, `Drop file`,
  `Already imported`, and `Review rows`.
- Keep internal terms such as `statement checkpoint`, `import batch`, and
  `parser` out of the main guided flow.
