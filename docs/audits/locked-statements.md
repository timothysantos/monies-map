# Locked statements (password-protected PDFs)

Date: 2026-10-28
Owner decision: step 1 of the statement email intake research. The research
report itself (`docs/proposals/statement-email-intake-research.md`) stays
untracked; the findings this feature depends on are copied below.

## What happened before

A password-protected statement PDF dropped into Imports failed in the first
read. `extractPdfText` called `pdfjs.getDocument({ data })`; pdf.js rejected
it with a `PasswordException` (code 1, "No password given") and the Imports
panel showed that raw text as the error. There was no way to type a password,
and in a multi-file drop one locked file stopped the whole drop.

## Flow now

1. The first read of a PDF (`extractPdfText`, or the OCR session of an image
   statement) opens it in pdf.js. A `PasswordException` is the detection: it
   happens before any text is read, before any OCR engine loads and before
   any AI step, because those all need the opened document.
2. The lazy `src/client/pdf-unlock.js` takes over (`openLockedPdf`). It tries
   a password it already holds for this file or this batch, then asks the
   person: the app's own dialog (`locked-statement-dialog.jsx`, the shared
   `SheetDialog`, a sheet above the keyboard on a phone) titled "This
   statement is locked".
3. A wrong password (`PasswordException` code 2) is said inline ("That
   password didn't work. Try again.") and the same dialog asks again. After
   5 wrong tries the field goes and only "Skip this file" is offered. This is
   a courtesy stop, not a security control: the file can be dropped again.
4. Skip, Escape, a tap outside and the swipe down all skip the file. The
   other files of the drop carry on; the skipped file is a "Skipped: locked"
   chip in the import bar and the status line names it.
5. On success the existing pipeline runs unchanged on the opened document:
   text extraction, parser selection, preview; an image statement is OCR'd
   from the unlocked pages (the OCR session opens the document first, so a
   locked file never reaches the OCR engine locked).
6. Several locked files ask one after the other, never stacked (a second
   drop while a dialog is open waits its turn).

Owner-password-only PDFs (open to read but restricted for printing or
copying) open in pdf.js without a question and import as usual. A corrupt PDF
fails as before with its own error: only `PasswordException` takes the locked
path. The Settings statement check, which has no dialog, shows a plain
"This statement is locked with a password" message instead of pdf.js's text.

## What the app does with the password (threat model)

The password is a secret the person already typed on their own device. The
rules, each with its proof:

| Rule | How | Proof |
|---|---|---|
| Never sent | No request includes it. pdf.js receives it in the same browser (its worker is local). | `tests/e2e/locked-statement-import.spec.js` records every request (URL, headers, body) at desktop and phone and searches for the right and the wrong password; the unit test spies on `fetch`. |
| Never stored | Not in localStorage, sessionStorage, IndexedDB or the URL. | The e2e reads all storage and `location.href` after the import; the unit test replaces the storage objects and `indexedDB.open` with spies. |
| Never logged | No `console` call carries it. | Unit test spies on `console.log/info/warn/error/debug` through a wrong try, a right try, a skip and a corrupt file. |
| Not in state | The field is uncontrolled: the value is read from the input when the person answers and the input is emptied at once. The only state about the question is the file name and the try count. | `locked-statement-dialog.jsx`; no query key, no URL, no context value holds it. |
| Short life | A closure per file (`createPdfUnlocker`) keeps it only while that file is read, so the OCR passes that reopen the file do not ask twice; `release()` forgets it (also on a skip, an error and when the read ends). | Unit test: after `release()` the next read asks again. |
| Batch only on request | "Use this password for my other locked files in this import" is off by default. When ticked, `createBatchPasswordKeeper` holds it in memory until the batch ends (nothing left to review and nothing being read) or the page is left. | Unit test (batch reuse, fall back to the question when another bank's file refuses it, a failed batch password is not counted as a try). |
| Not in an error | Our errors are built from the file name and fixed words; pdf.js's `PasswordException` never contains the password. | Unit test serialises every error (message, stack, own properties). |
| Not in a report | While held, a password is registered in `memory-secrets.js`; the crash report (`client-crash-report.js`) and the import diagnostic (`import-api.js`, the `app_error_diagnostics` table) pass their text through `redactSecrets`, in raw and JSON-escaped form. | Unit tests build both payloads from text that contains the password and assert it is gone. |
| Not to AI | AI never receives a password or an undecrypted file. A locked file stops at the first read, so no text exists for the optional statement-text fallback; after unlocking, the fallback sees the same bounded extracted text as for any statement, under its existing consent setting and caps. The fallback is skipped for a locked-statement error. | `parsePdfStatementFile` rethrows `LockedStatementError` before `tryAiStatementTextFallback`. |
| Original file | The app never uploads the original file (parsed rows only go to the preview request) and never stores it; the decrypted bytes are never kept: pdf.js holds the document only while it is read. | Unchanged `docs/flows/imports-flow.md` rules. |

What this does not defend against: malware or a hostile browser extension on
the device (it could read the field), and someone watching the screen while
"Show password" is on.

## Fixtures

`scripts/make-locked-pdf-fixture.mjs` writes `tests/fixtures/locked-pdf/`.
It is dependency-free: Ghostscript (`gs`, already common on dev Macs; qpdf was
not installed and nothing was installed) encrypts the image statements, and
the script writes and encrypts the text statements itself with `node:crypto`.
The fake passwords are `TESTCARD12345678` (user password) and
`OWNERONLYSECRET99` (owner password). The content is the repo's own
sanitized fixtures: the sanitized HSBC Visa Revolution image PDFs (Sep and Aug
2026) and the sanitized UOB One savings text. Variants:

- `hsbc-visa-revolution-sep-2026.locked-rc4-128.pdf` (RC4 128-bit, image-only,
  needs OCR after unlocking)
- `hsbc-visa-revolution-aug-2026.locked-rc4-40.pdf` (RC4 40-bit)
- `uob-one-savings-apr-2026.locked-aes-128.pdf` (AES-128, PDF 1.6, revision 4)
- `uob-one-savings-apr-2026.locked-rc4-128.pdf`
- `uob-one-savings-apr-2026.owner-only.pdf` (opens without a password)
- `uob-one-savings-apr-2026.plain.pdf` (the unlocked twin the tests compare to)

Ghostscript 10.08 only writes revisions 2 and 3 (RC4), which is why the
AES-128 file comes from the script's own writer. Both pdf.js-supported
families are covered; AES-256 is not generated.

## Research findings this feature relies on (2026-10-28)

Only institutions that email an encrypted PDF matter here; the rest of the
report concluded the portal download plus this in-browser import stays the
main path.

- **HSBC Singapore credit cards** (VERIFIED on hsbc.com.sg): still emails an
  encrypted PDF statement (deposit, investment and loan emails stopped on 15
  Jun 2026). The password is the abbreviated card name (the first letter of
  each word of the product name, ignoring words in brackets) followed by the
  last 8 digits of the card number, no spaces. The format is documented as
  not using personal information such as the ID number. It embeds eight card
  digits, so the password is itself card-number data: another reason it must
  never be stored, logged or sent. The sender pattern is
  `estatementNN@hsbc.com.sg`.
- **Citibank Singapore cards**: contradictory. An older FAQ says a monthly
  encrypted PDF attachment with a password the customer sets (an
  "ePassword"; a change applies to later statements only); a newer page says
  log in to view. The owner's own inbox decides which applies.
- **OCBC**: stopped emailing statements on 30 Jun 2026. Statements emailed
  before then used the last 4 characters of the NRIC or passport followed by
  the date of birth as DDMmmYY (11 characters), so an old attachment from the
  owner's mailbox still needs this feature.
- **UOB, DBS, Standard Chartered**: portal or app only; no password rule
  published for emailed files.
- Bank emails in Singapore carry no clickable links, so nothing here follows
  a link.

The app shows no bank-specific password rule: when a file is locked nothing
about the bank is known, and the dialog's hint stays generic ("Banks usually
lock statements with part of your card number or ID").

## Strings added

All in `src/client/copy/en-SG-imports.js` (Imports chunk only):

- "This statement is locked" (title)
- "Banks usually lock statements with part of your card number or ID. The password stays on this device and is not saved." (hint)
- "Password" (field), "Show password", "Hide password"
- "Use this password for my other locked files in this import" (checkbox, off)
- "Open statement" (primary), "Opening statement" (while it is tried)
- "Skip this file", "Close and skip this file" (the close button's name)
- "That password didn't work. Try again."
- "That password didn't work after 5 tries. Skip this file, and add it again when you have the right password."
- "Skipped: locked" (chip)
- "{file} is locked, so it was skipped. Add it again when you have its password." (one file)
- "1 locked file was skipped. Add it again when you have the password." / "N locked files were skipped. Add them again when you have the password." (several; joined to "N files added to the intake queue." when others went on)
- Settings statement check (no dialog): "This statement is locked with a password. Add it on the Imports page and you will be asked for the password."

## Proof

- Before: a locked file showed "Import needs attention: No password given"
  (`before-*.png`). The new browser spec fails on that code (no dialog) and
  passes now, at desktop and 390px, in light and dark.
- First screen: the entry chunk plus Summary is 162,394 B gzip (limit
  169,680 B, budget file unchanged); the only first-screen addition is
  `memory-secrets.js` for the crash report. The dialog, its CSS, `pdf-unlock.js`
  and `pdf-statement-text.js` load with Imports.
- Screenshots: `after-{light,dark}-{desktop,phone}-*.png` (the question, a wrong
  password, out of tries, the preview after unlocking, the skipped chip).

## Not covered

- AES-256 (revision 5 or 6) PDFs: pdf.js reads them, but no fixture exists.
- The email intake itself (steps 2 and later of the research) is not built.
- Before and after screenshots are in `docs/audits/locked-statements/`.
