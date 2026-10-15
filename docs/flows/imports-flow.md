# Imports Flow

This doc describes the Imports page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/imports`

The route state carries the active view, month, and any import-context
parameters. The browser URL is the source of truth.

## State Flow

Imports state is split between:

- route state for the current view and month
- server state for the imports page DTO
- workflow state for upload, preview, mapping, certification, and rollback
- transient UI state for the staged import UI

The page should preserve preview and mapping state while the user is in the
workflow, and it should not rely on decorative chrome as a readiness contract.

## Data Flow

Imports data comes from:

- `GET /api/imports-page`

Import mutations may also refresh:

- `entries`
- `month`
- `summary`
- `summary-account-pills`

when the import changes shared ledger evidence or reference data.

## Ownership Notes

Imports owns:

- the owner a preview names. A direct account's rows carry that account's
  owner (the server sets it from the account the rows land on, whoever the
  form's default owner is); a joint or unknown account keeps the form's owner
  and a person's own pick on a row wins. The file card's owner chip reads the
  previewed rows (`getImportRowsOwnerName`): one owner when every added row
  has the same one, no chip when they differ.
- the three import steps (Bring files, Review, Done; design.md, "Import Page
  Stages"). A statement is reviewed card by card under one header (a card
  whose account and month a completed import already confirmed reads
  "Already imported on {date} from {file}"); the
  commit bar stays in view. While another file waits the commit reads
  "Commit and open next" ("Save statement balance and open next" for a
  statement whose rows are all covered and never saved; "Save it again
  anyway", which asks first, keeps its own words for one saved before; "Certify and open next" for one
  whose rows all match uncertified ledger entries; "Save empty statement
  checkpoint", only for a statement with no rows at all, keeps its own
  words): a successful commit opens that file and keeps a
  compact Done card (what changed, with rollback) above its review; rolling
  back from it leaves that review as it is and takes the rolled-back file
  off the file chips ("File i of n" follows). The last file commits with its
  own words and shows the full Done card (what changed per card, with
  rollback). A plain CSV, opened from the queue or dropped on its own, is
  named by its file name (its summary reads "{file} saved"), unless the user
  typed a source label or took one from the inbox. A failed commit opens nothing; the refresh after a commit runs
  through `runBackgroundRefresh`, so a failure keeps the commit and raises the
  refresh notice. "Skip for now" (shown while another file waits) sends the
  file in review to the end of the queue, still parsed, and opens the next;
  it asks first when the review has changes it would drop. The intake queue keeps
  the rest of a multi-file drop, reviews statements before activity (older
  months first) and says how many activity rows a queued statement covers.
  A mid-cycle row posted inside an already confirmed statement period is
  skipped when that statement covers it and left out with a reason when it
  does not (DOMAIN.md, Entry Reconciliation)
- the Bring files layout: the drop zone first, then the intake queue, then
  the import inbox. Once a file is queued (or Bring files is opened again
  over a file in review) the Select file card shrinks to one line, "Drop
  more files, or Select file", with the upload status on one line beside it
  and the AI fallback consent under it; the OCR/XLS note, the trust hint and
  the rollback note move behind "Paste rows or set defaults". At 1280x800
  after a three-file drop the queue's first Review button is on the first
  screen. Files added to the queue are not done: the status box says
  "Waiting for review" in the pending (butter) tone and is a button that
  scrolls to the queue (below the pinned bar) and focuses the first Review
  button; with nothing left waiting it is not shown. Reading, a file ready
  to map or preview and an error keep their tones
  (`describeUploadStatus`, `import-upload-status.js`). A file dropped on
  its own opens straight away and frees the
  queued file that was in review (it waits again). No preview card shows
  until a preview exists. The inbox folds to one line, "Still missing: N of M"
  (`buildInboxChecklistProgress`, `import-inbox-model.js`), open by default
  only while the queue is empty and no file is in review (a plain CSV in
  column mapping counts as in review); the user's Show/Hide holds until that
  default changes. Expanded, each bank session is its own collapsible row. A
  queued file the intake model matched (`buildIntakeMatch`, status
  "matched", not a duplicate) ticks off its checklist line and lowers the
  count; there is no second matcher. A line's actions ("Use with import
  form" fills the import defaults from that expected file and opens them;
  "Not available" snoozes it for three days in browser storage) show on
  hover or focus, and a tap focuses the line on touch screens. Pasted rows
  and the defaults (source label, default account, default owner, batch
  note) sit behind "Paste rows or set defaults", closed by default and
  opened when a plain CSV needs mapping or by "Use with import form"; it
  never closes by itself while open, and Start over closes it. The upload
  status and the AI fallback consent stay outside it. Any file in review
  folds Bring files (the stepper's Change/Hide files toggles it); a plain
  CSV keeps its column mapping visible beside the preview. Recent imports
  starts closed (not remembered); its commit and refresh status shows
  whether or not it is open. Driven in `import-bring-files.spec.js`
- page-wide file drop: while Imports is mounted, a file dropped anywhere on
  the page goes to the drop zone's handler (`usePageFileDrop`,
  `import-page-drop.js`) and a fixed highlight says so while dragging. A
  file dropped on the file in review (`data-page-drop="off"` on the preview
  card), a dialog or a popover is refused: no intake, and the browser does
  not open the file. Non-file drags (text, elements) are left alone
- the import bar (`ImportBatchBar`): the steps, a "Your files:" row with
  one chip per file of this session's batch, and "Before you can commit:"
  chips for the file in review. A finished step and a done file are mint
  with a tick; the file in review is outlined, bold, with a file icon and
  "· reviewing"; a waiting file has a neutral outline, a clock and
  "· waiting". It is sticky on desktop and tablet while a batch is in progress,
  not on a phone. The blocker list (`import-blockers-model.js`) is the one
  source for the chips, the commit bar's "{n} things left · Jump to
  next", whether the commit is disabled and whether it asks first; a chip
  scrolls to and focuses the control that fixes it. A card with no account
  yet is named once, by "Map {n} accounts", not also "{card} doesn't
  match"; the commit question still names it. A statement whose parsed
  rows don't add up to its printed totals (`ParsedStatementImport.reconciliation`,
  today from HSBC OCR) adds a "Make the rows add up to the statement" chip
  that disables the commit with no "Commit anyway" question; the recovery
  card (`import-statement-recovery.jsx`) and the chip read the live check in
  `import-statement-recovery-model.js`, so they clear only when the current
  rows add up. Opening a waiting file from
  its chip or from the queue's Review button asks first (`ImportAskFirst`)
  when the file in review has changes it would drop; the Done card's Review
  next does not ask (the Done card has nothing in review). Stuck to the top
  (an IntersectionObserver on a sentinel above the bar), the bar's solid
  surface spreads to the window's edges, a soft shadow fades in and the
  step descriptions fold away (Change stays on the Bring files step's first
  line; an upload or check-refresh error on that line stays in view), over
  200 ms and without animation under reduced motion. The bar
  keeps its height in the page while stuck, so nothing below moves, and jump
  targets land below the stuck height. J and K step to the next
  and previous blocker (not while typing, with a modifier, under a popover,
  dialog or sheet, or without a preview); "Jump to next" names them in its
  title. Below 768 px the commit bar's "{n} things left" opens the import
  progress sheet (the shared mobile sheet) with the file chips and blocker
  chips; a chip closes it and then acts. On a phone the statement header and
  the commit bar wrap inside the review card (the commit button on its own
  line), never past the right edge. Driven in `import-stepper.spec.js`
  and `import-commit-next.spec.js`
- import inbox planning. The inbox groups expected
  downloads by bank session so a user can log into one bank and collect every
  missing statement/activity file for that institution, and inside a bank by
  owner, then account (one box per account listing its missing months), while the review queue
  remains ordered by statement chronology and trust level. This planning must
  not depend on local filename conventions, and split cleanup remains a separate
  post-bank-files lane. Multi-file intake is browser-only: it may keep parsed
  rows, checkpoints, and generic CSV text in transient UI state, but it must not
  persist original PDFs, CSVs, XLS files, OCR images, or raw bank files
- investment statements (an iFAST "Wrap" PDF, `parserKey` `ifast_wrap_pdf`, or
  a StashAway "Statement of Account" PDF, `parserKey` `stashaway_pdf`):
  read by the same browser pipeline as a bank PDF, but its checkpoint carries
  an `investmentValue`, so the preview keeps it out of the statement balance
  check (no reconciliation card, no certificate) and shows an "Investment
  statement" box instead: what the account was worth on its last day (a
  statement figure, never a balance), the value it replaces when the month
  was saved before, and for each contribution whether it is the same money as
  a bank payment already in the ledger. Each contribution row lands on the
  investment account as a transfer in (`transferMatch` names the bank entry,
  chosen by `pickReferencedTransferCandidate` with the statement's account
  number as the strong signal); the commit links the pair as one transfer in
  its own batch and the rollback restores the bank entry. The account is
  mapped or created exactly as a bank statement's is (kind Investment, no
  opening balance). With nothing new to add the commit reads "Save statement
  value" ("and open next" while another file waits). A StashAway statement
  is the same flow with its closing balance as the value, its deposits and
  withdrawals as the rows (none in most months, so any import order works and
  no bank file is needed first), and, when its opening balance differs from
  the saved statement of the month before by more than a cent, one plain
  notice in the box ("A statement may be missing in between"; never a
  blocker). Driven in `ifast-statement-import.spec.js` and
  `stashaway-statement-import.spec.js`. An investment statement often saves
  only a value, so no transaction names its account: `loadImportBatches`
  also reads `investment_statement_values` (by `import_id`) at read time, so
  the batch's `accountNames` carry the account ("Account - Owner"), its
  `startDate`/`endDate` fall back to the value's as-of date when the batch has
  no rows, and `investmentValueCount` says how many values it saved. Older
  imports need no backfill and no migration; overlap checks keep to ledger
  rows. The Done card then reads "Saved <account>'s value: <amount> on <date>"
  (amount hidden with money) plus "N payments added and paired with bank
  transfers" when it has rows; Recent imports shows "1 statement value saved"
  for a batch with no rows; the commit notice and "Imported before it" lines
  name the account and date as for any import. Driven in
  `investment-import-labels.spec.js`; rollback removes the value and the
  payments as before (`tests/investment-import-labels.test.mjs`)
- file upload and preview
- account mapping
- commit and rollback
- certification and duplicate review
- statement fixes: each card of the statement check shows the deterministic
  statement mismatch diagnosis (DOMAIN.md, "Statement Mismatch Diagnosis")
  with the rows and amounts behind it. Approving a fix (a move to the card
  the statement lists the entry under, or a deferral to the next statement)
  re-runs the preview with `statementFixes`; Undo removes it; Keep as is
  hides it for this preview. The commit sends the preview's `appliedFixes`
  and writes them in its batch; nothing is written before the commit.
  Committing while a card is not Matched, or after a row edit the check has
  not seen, asks first in a popover on the commit button
- statement mismatch diagnostics, including balance breakdown rows that explain
  likely account, row direction, skipped-row, or unmatched-ledger causes and
  expose hover/focus explanations with the exact statement date window; ledger
  diagnostic rows link back to Entries in a new tab with row-specific month and
  wallet filters and can be deleted inline after confirmation. Ledger diagnostic
  lists with multiple rows also expose a confirmed "Delete all" action for cases
  where the whole unresolved set is known to be absent, duplicated, or on another
  account. Unmatched ledger rows mean the preview did not certify a unique PDF
  match, not that the rows are definitely absent from the PDF. Diagnostic lists
  return the full row list, and row date labels distinguish ledger transaction
  dates from PDF posted dates and event dates. When an unresolved list exactly
  matches the statement difference, the preview says whether correcting those
  ledger matches or including skipped PDF rows should reconcile the statement.
  Already-matched PDF rows are collapsed by default when a statement closes
  because they are audit context, not required user action. UOB card PDF
  matching normalizes foreign-currency description suffixes such as `USD 5.58`,
  so a ledger row like `OPENAI OPENAI.COM US` can certify against
  `OPENAI OPENAI.COM USD 5.58` when the account, amount, and
  date evidence align. When a real ledger row falls inside the transaction-date
  period but the bank PDF omits it because it posted after the statement cutoff,
  diagnostics expose two non-delete corrections: set the exact posted date when
  the bank app shows it, or defer the row to the next statement by setting a
  provisional posted date to the day after the current statement end. The
  diagnostic list shows the exact ledger rows, highlights rows whose posted date
  is after the statement end, and gives direct links back to Entries so the user
  can inspect and fix only the rows that matter. Both actions keep the event
  transaction date intact for spending history while moving statement
  reconciliation to the cleared/post date. Deferral is provisional only: a
  later official PDF remains the source of truth and can certify the row in
  place, replacing both event and posted dates with the statement dates while
  preserving user-owned annotations
- preview API failures preserve server detail. JSON errors are shown verbatim,
  while non-JSON failures such as edge 503s include HTTP status and a short
  cleaned response snippet instead of only a generic fallback
- non-destructive statement preview auto-refresh; transient refresh failures
  must keep the current reviewed preview visible. It runs when the tab
  regains focus, only for a statement (PDF or OCR) preview that has settled
  for 2 s and has no unsaved row edits; the page run is driven in
  `imports-statement-auto-refresh.spec.js`
- the post-commit split clean-up card. A commit shows it again for its own
  possible split links once the commit's refresh settles, but a "Later"
  clicked after the commit was saved is never undone by that refresh, which
  can take several attempts while the refreshed page is already on screen
  (`import-split-cleanup-model.js`; the race is driven in
  `import-ledger-flow.spec.js` by holding the new import out of the refreshed
  page until after the click)

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep readiness checks tied to actual page controls and API response state

## Known Exceptions / Watch Areas

- explicit shell refresh remains a named exception when imports create shared
  reference data such as a new account
- imports readiness should stay tied to actual controls, not decorative chrome
