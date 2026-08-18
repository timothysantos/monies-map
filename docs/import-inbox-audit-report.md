# Import Inbox Audit Report

Date: 2026-08-18

## Scope

This audit covers the Import Inbox foundation and first UI slice: server-side
freshness modeling, task documentation, tests, and the top-of-Imports command
center. It does not claim that multi-file queueing or global stale banners are
complete yet.

## Findings

- Current manual flow forces users to maintain import state outside the app:
  local filenames, last imported month, bank-session order, and split cleanup
  status.
- Month-first catch-up is not ergonomic because bank sessions expire. The model
  must group download work by institution while preserving chronological review
  order internally.
- Filename conventions would create a new user chore and are explicitly out of
  scope for the intended UX. File matching should be content-first.
- HSBC remains a special technical case because image-only PDFs require OCR, but
  it should stay a normal drop-file experience with local/private OCR status.
- Split cleanup should be surfaced after bank files are current. It should not
  block stale statement collection.
- Direct bank sync is not the primary path for this app right now because it
  adds aggregator cost, consent/MFA support burden, credential/security
  exposure, and still does not replace PDF statement proof.

## Implemented Checks

- `buildImportInbox` creates institution sessions for active bank and credit-card
  accounts.
- The inbox derives required statement files from the gap between the latest
  certified statement month and the latest expected closed statement month.
- Current-activity exports are optional and only suggested for supported
  institutions when recent activity is stale.
- The review queue is sorted by statement period first, then institution/account,
  so users can collect by bank but review in accounting order.
- Pending split matches are reported in a separate cleanup object.
- The Imports page renders the Import Inbox above the existing composer.
- Selecting an expected file pre-fills the current single-file import form with
  the matching account, source label, and note.

## Test Coverage

- `tests/import-inbox.test.mjs` proves a Citi-only lag does not turn current UOB
  and OCBC accounts into required work.
- `tests/import-inbox.test.mjs` proves a two-month catch-up creates one UOB
  bank-session checklist while the review queue starts with the oldest missing
  statement month across institutions.
- `tests/import-inbox.test.mjs` proves pending split matches do not create
  required bank files.
- Browser smoke screenshots confirmed the Import Inbox renders on desktop
  (`1440x1100`) and mobile (`390x1000`) without blank or obviously broken
  layout.
- The standard e2e smoke bundle passed: `113 passed`.

## Remaining Audit Gates

- Add parser/file-classifier tests before claiming all-files-at-once drop is
  content-first.
- Add duplicate-detection tests before exposing folder-like multi-file drop.
- Add copy review for a tech-averse path once the top-of-Imports UI exists.
- Add documentation updates to FAQ and flow docs when the user-visible UI ships.

## Status

Foundation model and top-of-Imports UI: passed focused unit tests, full unit
suite, typecheck, production build, browser smoke checks, and the standard e2e
smoke bundle.

Overall Import Inbox feature: in progress.
