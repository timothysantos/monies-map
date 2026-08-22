# Apple Pay API Hardening Audit

Date: 2026-08-22

## Scope

This audit compares four contracts: browser quick entry, the original direct
API setup, the shared Apple Pay Shortcut, and the direct-create Worker route.
It covers normalization, account identity, currency, duplicate retries,
failure feedback, artifact ownership, and installation.

## Findings

1. Browser quick entry already normalized currency-formatted money, while the
   shared Shortcut/API tests mainly used clean decimal strings.
2. The original direct API setup explicitly formatted dates; the first shared
   release sent a device-formatted Current Date and relied on permissive server
   parsing.
3. The Wallet handoff includes `value`, `merchant`, and `name`, but the first
   shared release discarded `name`. Every account-less request therefore used
   the first priority account even when Wallet supplied an exact card name.
4. Entry persistence hardcoded SGD rather than the selected account currency.
5. The shared release had no request identifier, so a transport retry could
   create duplicate rows.
6. Request JSON types, text length, ambiguous currency symbols, conflicting
   amount representations, and malformed ISO-looking timestamps were not
   guarded as one explicit contract.
7. Opening a missing `openUrl` produced the observed `No URL Specified` failure
   instead of useful user feedback.
8. The iCloud link depended on a manually published personal release even
   though Apple supports signed Shortcut files that anyone can import.

## Implemented Controls

- `shortcut-entry-contract.ts` owns typed body parsing and normalization.
- Wallet amounts preserve cents, accept identified SGD formats, and reject
  ambiguous separators, signs, precision, symbols, and conflicting minor units.
- Dates accept strict ISO/date-only and legacy day-first forms without generic
  `Date.parse` fallback.
- Descriptions are compacted and capped at 500 characters; notes are capped at
  2,000; rejected requests save nothing.
- Explicit active accounts win. Otherwise a unique normalized Wallet `name`
  match wins, then the saved active priority is used.
- The selected account currency is persisted and checked against a currency
  named by Wallet.
- `requestId` is stored as `transactions.external_reference` behind a unique
  household index. Exact retries return the original entry with
  `created: false`; conflicting reuse returns `409`. Request IDs are limited to
  direct ownership so split lifecycle state cannot be mistaken for a complete
  idempotent transaction write.
- Success responses include normalized values, selected account, account
  resolution, creation status, and `openUrl`.
- The v2 Shortcut posts the token-bearing setup URL, ISO date, Wallet amount,
  merchant, card name, request ID, and client version. It guards `openUrl`,
  reports API errors, and identifies the saved account in its notification.
- The app serves an Apple-signed `anyone` file whose bytes are checked against
  the versioned release and manifest. No personal iCloud library is required.

## Evidence

- Focused contract and artifact tests cover Wallet currency text, ambiguous and
  conflicting amounts, malformed dates and body types, bounded text, account
  selection, artifact hashes, secret absence, setup index, response actions,
  and Settings install-path alignment.
- The focused browser scenario covers token setup, account priority, Wallet
  name routing, currency mismatch, invalid and oversized inputs, idempotent
  retry, conflicting request-ID reuse, raw malformed JSON, and one-row ledger
  persistence.
- A read-only production query found no duplicate non-null external references,
  so the unique index has no known data conflict.
- The complete 148-case browser suite passed. `npm run verify` also passed zero
  dependency findings, strict TypeScript, 184 unit/parser tests, the production
  build, and the full desktop/mobile smoke bundle, including all 47 import
  ledger cases.
- Wrangler 4.120.0 and 4.125.0 reproduced
  [Cloudflare workers-sdk issue 14926](https://github.com/cloudflare/workers-sdk/issues/14926)
  by dropping the local ProxyWorker during longer suites. The project pins the
  documented stable 4.113.0 workaround and overrides `sharp` and `undici` to
  patched releases; the complete suite and `npm audit` pass on that lockfile.
- The production D1 migration executed 52 statements successfully and created
  the idempotency index without a data conflict.
- The Shortcut gateway deployed as version
  `0ca2e843-f75d-49bd-b801-dcb351243ea3`; the app and signed Shortcut asset
  deployed as version `14ed7b03-5841-4fea-96fa-52f039ba406f`.
- Live gateway probes returned `404` for a non-API route and `401 Missing
  shortcut token` for an unauthenticated direct-create POST. The protected app
  returned the expected Cloudflare Access redirect to an unauthenticated
  browser session.

## Closure Status

Closed. Implementation, dependency audit, contract tests, complete browser
suite, merge gate, production migration, both deployments, and live boundary
probes pass. The task list has no open item.

## Residual Boundaries

- Apple does not package a personal Transaction automation inside a shared file;
  each iPhone still needs the one device-local Wallet automation and Dictionary
  handoff.
- The token-bearing connection URL is visible inside an installed shortcut and
  must be rotated after disclosure.
- Existing installed Shortcut copies do not update automatically. Users install
  a reviewed release and choose Replace.
- A single household key is still shared across devices. Per-device keys and
  edge rate limiting are future controls if the product becomes multi-household
  or Internet-scale.
