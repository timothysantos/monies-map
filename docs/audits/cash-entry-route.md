# Audit: cash entry routes and the Log cash Shortcut (2026-11-17)

Routes: `GET /api/cash-entries/defaults`, `POST /api/cash-entries/create`
(in the app, behind Access) and `POST /api/shortcuts/cash/create` (the
Shortcut Worker's third public path). Code: `src/server/cash-entry-route.ts`,
`src/domain/app-repository-cash-entries.ts`, `src/domain/cash-entry.ts`.

## Access and identity

- The Shortcut path is POST only (`isShortcutCreateRequestAllowed`), and the
  Shortcut Worker still answers 404 to every other path, the in-app cash
  routes included (test: "the Shortcut Worker answers the Log cash path...").
- It reuses `authenticateShortcutRequest`: the same per-person keys as the
  Apple Pay Shortcut, compared in constant time over every key, the same
  optional nonce and timestamp, scope `cash:create`. No key, or a wrong one,
  is 401 before any body is read.
- The key decides the person. Nothing in the body can name another person
  (test: a body with `personId: person-tim` sent with Joyce's key saves as
  Joyce). No new secret, no new setting: the Log cash connection is the
  Apple Pay connection on another path.
- In the app, the pad sends a `personId`; the server checks it is an active
  person of the household (400 otherwise). As with every in-app write,
  Access is the boundary; the cross-site guard applies.

## Bodies and limits

- Every body is read through `readJsonObject` with an 8 KiB cap (413 over
  it); `tests/ai-security-review-routes.test.mjs` keeps bare
  `request.json()` out of `src/server`.
- Amounts are integers of minor units, positive, at most 100,000,000,000,
  whole units in a zero-decimal currency; a currency is three letters; a
  request id is 8 to 64 letters, digits or dashes; a note at most 500
  characters; a category must be the household's own; a chosen wallet must be
  an active account of the household.

## Writes

- One write path: `createEntryRecord` (one `db.batch` with the entry, its
  audit event and month refresh markers). The cash command only reads
  first. `tests/atomic-writes-cash-entries.test.mjs` proves a failing
  statement leaves the database as it was.
- Idempotent on `cash:<requestId>` (the unique external reference index):
  an existing entry is returned without recomputing anything; a request id
  saved for another person is refused; two copies at once resolve to the
  one saved.
- The exchange rate cache (`fx_rates`) is the existing one; nothing new is
  stored. Ask's safe set runs after the save as it does for Apple Pay
  entries (best effort, logged, with Undo).
- Test-only: `x-cash-test-rate` saves one rate before the save, honoured only
  when `APP_ENVIRONMENT` is `test` and `FX_RATES_OFFLINE` is `true` (test:
  a production Worker ignores it).

## Privacy and AI

No AI call, no prompt, nothing sent to a third party except the two
currency codes to the rate sources (existing behaviour). The Shortcut's
answer carries only the saved line for its own notification. The device
keeps waiting payments (amount, currency, description, its request id) in
its own storage until the server confirms them, and the last defaults per
person without amounts; Remove deletes a waiting one.

## Reads

The defaults read is bounded: one person, the household's accounts, the
trips on today (LIMIT 20, tolerated missing), and at most 40 of the
person's cash payments since the earlier of the trip's first day and 7 days
ago, on the household-and-date index.
