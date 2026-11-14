# Waiting files: privacy, cost, write boundary and security review (November 2026)

"Send to Monies Map" lets the owner send bank statements and activity exports
from the Share button on a phone or Mac. The files wait in the app until
Imports pulls them into the intake queue for the normal review and commit
(DOMAIN.md "Waiting File"; flow: `docs/flows/imports-flow.md`, "Waiting
Files"; internals: `docs/developer-guide.md`, "How do files sent from a phone
reach Imports?"). Branch `send-files-intake`, built 2026-11-14 with the
owner's approval. A mailbox way in (Cloudflare Email Routing) was designed
and paused by the owner before anything was built.

## What changes

Until now the rule was absolute: original bank files are never persisted.
They are now persisted in one case, the person's own explicit send:

| | Before | Now |
|---|---|---|
| A file dropped or selected in Imports | Read in the browser, never uploaded | Unchanged |
| A file sent from the share sheet | (no such way) | Kept as opaque bytes in D1 until its import commits, it is removed, or 30 days pass; then deleted for good |

## Privacy

- **What is stored**: the bytes exactly as sent (a locked PDF stays locked),
  a sanitised file name (last path part, no control or markup characters, at
  most 120 characters), kind, content type, size, SHA-256, how it arrived
  (`shortcut`), receive and expiry times. Where: the household's D1 database
  (`waiting_files`, `waiting_file_chunks` in BLOB chunks of at most 512 KiB).
  `waiting_file_daily_counts` keeps a count per day, nothing else.
- **For how long**: deleted, row and bytes, in the import commit's own batch,
  on **Remove**, or 30 days after arrival (`WAITING_FILE_RETENTION_DAYS`).
  The 30-day sweep runs whenever the store is read or written (opening
  Imports, a send); there is no cron. An expired file is never listed or
  served even before the sweep deletes it. Demo reseed clears the tables.
- **Never**: parsed, rendered, logged or sent to AI on the server. The server
  reads only the first bytes to tell the kind of file. Log lines name no file
  and hold no key (`console.error` prints counts and error names only).
  Audit lines name the kind and size, never the file name (bank file names
  can carry part of an account number).
- **Passwords**: a locked PDF's password is typed on the device at review
  (DOMAIN.md "Locked Statement"); it is never sent with the file or stored.
- **Not R2**: R2 is not enabled on the account (`wrangler r2 bucket list`:
  "Please enable R2 through the Cloudflare Dashboard", 2026-11-14), and
  enabling it needs billing. The bytes go to D1 behind the store module.
  D1 is encrypted at rest by Cloudflare like the rest of the ledger.

## Cost

- D1 storage: at most 40 waiting files of at most 10 MiB (about 400 MiB worst
  case, a few MiB in practice: a statement is 100 KB to 2 MB), freed on commit,
  Remove or after 30 days. Free plan D1 storage is 5 GB.
- D1 writes: one batch per send (row, chunks, audit line, count); a 10 MiB file
  is 21 statements. At most 40 files a day (`WAITING_FILES_DAILY_LIMIT`).
- Worker: a send is read once through limited-body and hashed once; no AI
  call, no allowance use. The Imports page reads one small list; bytes are
  fetched only when Imports opens, one file at a time.

## Write boundary

- The send path writes only the store (and its audit and count rows). It
  never writes ledger data, imports, certificates or matches.
- Nothing is imported, certified or matched without the person's review and
  commit in Imports, through the existing commit command. The commit deletes
  its waiting file in the same batch.
- Commands are all-or-nothing (`tests/atomic-writes-waiting-files.test.mjs`).

## Security review

Method: read the route, store and client code; drove every refusal through
the real Worker against a local D1 (`tests/waiting-files-route.test.mjs`,
`tests/waiting-files.test.mjs`); a browser test sends files to a local stack
and commits them (`tests/e2e/send-files-to-monies-map.spec.js`); after the
deploy an unauthenticated POST to production was refused.

| Area | Control | Proof |
|---|---|---|
| Endpoint exemption | Only `POST /api/shortcuts/files/send` (and the Apple Pay create path) skip the Access check (`isExempt`, `access-jwt.ts`), and the Shortcut Worker answers only those two paths, POST only. Reading a file back, Remove and both key routes stay behind Access | "only the send path is open..." test: through the gateway and with `ACCESS_JWT_MODE=enforce` every other path is 401/404/405 |
| Key | Its own key, 32 random bytes; `file_intake` in `app_settings`, else the Worker secret `FILE_INTAKE_KEY`; compared with `constantTimeEqual`; header only (`X-Monies-Files-Key` or Bearer), never the address. The Apple Pay key does not open it. "Make a new key" stops the old one at once. Not set up: plain 503 | "the key: ..." and "the Worker secret is the key..." tests |
| Size caps | 25 MiB a request counted as it arrives (`readFormBody`, a chunked body with no length is cut off), 10 MiB a file, 10 files a request | flood test (30 MiB streamed: 413 before the end), 10 MiB + 1 byte, 11 files |
| Type sniffing | First bytes decide: `%PDF-` within 1 KiB; the Office signature plus an `.xls` name; plain text (no control bytes, not markup, no `<script`) plus a `.csv`/`.tsv` name. Zip (so `.xlsx`), images, HTML, Word/installer files with the Office signature, empty files: refused. Served back as `application/octet-stream`, `attachment`, `nosniff`, `no-store`, CSP `sandbox` | `tests/waiting-files.test.mjs` |
| File names | Last path part, control and bidi characters removed, everything outside letters, digits and ` ._()-+&,'#@` replaced, 120 characters with the extension kept; React escapes it on the page | sanitiser test (`../../etc/passwd`, `<img onerror>`, U+202E) |
| Household scope | Every read, list and delete has `household_id = ?`; chunk deletes go through the household's row | another household's row is never served or removed |
| Duplicates | Same SHA-256 while waiting: kept once, "Already received"; a file imported before is recognised by the import's own duplicate checks at review | repeat tests in route and browser tests |
| Abuse | 40 files a day, 40 waiting at once; a refusal is a plain message | daily and waiting limit tests |
| Retention | 30 days; swept on read and write; never listed after expiry | expiry test |
| Cross-site | Remove and new key are browser writes behind the cross-site guard | cross-site test (403) |
| Missing config | No tables, no key: Imports loads with `waitingFiles: []`, the send path answers 503, a commit naming a missing file still commits | "with the store missing..." test |
| Spoofed mail, zip and HTML attachments | No mailbox way in exists (paused); zip and HTML are refused on the send path | as above |

Residual risks, accepted:

- Whoever holds the key can fill the store up to the limits. The key lives
  in the owner's Shortcut; "Make a new key" revokes it. The files still need
  the owner's review before they touch the ledger.
- A malicious PDF reaches the owner's browser as it would if he downloaded it
  himself; pdf.js reads it in the page as for a dropped file. The server never
  renders it.
- D1 holds encrypted statements for up to 30 days; anyone with D1 access
  (the Cloudflare account) could read the bytes, as they can read the ledger.
