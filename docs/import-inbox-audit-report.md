# Import Inbox Audit Report

Date: 2026-08-18

## Scope

This audit covers the Import Inbox implementation: server-side freshness
modeling, top-of-Imports command center, Summary/Month stale banner,
browser-only multi-file intake, duplicate/ambiguous indicators, portal
instructions, snooze/not-available handling, documentation, and tests.

## Findings

- Current manual flow forces users to maintain import state outside the app:
  local filenames, last imported month, bank-session order, and split cleanup
  status.
- Month-first catch-up is not ergonomic because bank sessions expire. The model
  must group download work by institution while preserving chronological review
  order internally.
- Filename conventions would create a new user chore and are explicitly out of
  scope for the intended UX. File matching should be content-first.
- Original-file storage would create privacy, security, and retention concerns
  that conflict with the app's current browser-private parsing model.
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
- Summary and Month can show a compact stale banner that links to Imports,
  without putting the full checklist in the shell payload.
- Multi-file selection/drop parses files in the browser and creates an intake
  queue. Queue items keep parsed rows/checkpoints or pasted CSV text in browser
  memory only; they do not retain `File` objects or persist original PDFs,
  CSVs, XLS files, OCR images, or raw bank files.
- Intake matching compares parsed account/month/source evidence against expected
  files and reports matched, ambiguous, unexpected, unknown, and duplicate
  states.
- Bank-session cards include portal links and short download instructions.
- Expected files can be marked not available, which writes only a local
  browser snooze marker for the expected-file id.
- HSBC image PDFs continue through private browser OCR. Multi-file intake uses
  the same parser path as single-file import.

## Test Coverage

- `tests/import-inbox.test.mjs` proves a Citi-only lag does not turn current UOB
  and OCBC accounts into required work.
- `tests/import-inbox.test.mjs` proves a two-month catch-up creates one UOB
  bank-session checklist while the review queue starts with the oldest missing
  statement month across institutions.
- `tests/import-inbox.test.mjs` proves pending split matches do not create
  required bank files.
- `npm run typecheck` passed after the final intake/banner changes.
- `npm run test:unit` passed: `161` tests, including browser-private HSBC OCR
  fixtures and no-original-file intake coverage.
- `npm run build` passed.
- Focused Playwright screenshots passed for Summary stale-banner route,
  desktop Imports, and mobile Imports:
  `/tmp/import-banner-summary-desktop.png`,
  `/tmp/import-inbox-finished-desktop.png`, and
  `/tmp/import-inbox-finished-mobile.png`.
- The focused browser check confirmed the Import Inbox renders, the File Intake
  Queue guidance is visible before files are dropped, and the visible copy says
  original files are not stored.
- The standard e2e smoke bundle passed after the intake/banner implementation:
  `113 passed (4.9m)`.

## Remaining Audit Gates

- Bank aggregator sync remains a separate feasibility spike. It must not replace
  PDF statement certification unless operational, security, consent/MFA, and
  statement-proof risks are resolved.

## Status

Implementation: passed final verification for the non-sync Import Inbox path.

Overall Import Inbox feature: implemented and audit-checked. The only remaining
item is the separate bank aggregator sync feasibility spike.
