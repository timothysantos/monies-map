# Monies Map Log cash Shortcut

A second Apple-signed Shortcut, separate from the Apple Pay one, for logging
a cash payment without opening the app (DOMAIN.md "Cash Entry";
`docs/flows/cash-entry-flow.md`). People put it on the Lock Screen, the
Action Button, Back Tap, or run it by voice ("Log cash").

## Files

- `monies-map-log-cash.plist` is the reviewable, secret-free source.
- `releases/monies-map-log-cash-2026-11-17-v1.shortcut` is the exact
  Apple-signed release for anyone to import.
- `../../public/shortcuts/monies-map-log-cash.shortcut` is a byte-identical
  public copy served by the app (Settings, Apple Pay shortcut, "Install Log
  cash shortcut").
- `manifest.json` records the release status, action contract and SHA-256
  checksums. `tests/shortcut-artifact.test.mjs` checks them.

The source and the signed release must never contain a household key, a
private connection URL, `shortcut_token` or an authorization header value.
Installing asks for the private connection URL once (the blank Text action,
action 0); Settings copies it when the person taps the install button.

## What it does

1. Takes the text it was given, if any ("35000 coffee" from the share sheet
   or another Shortcut); otherwise asks "How much cash?" with the number pad.
2. Posts `{ text, requestId, clientVersion }` to the connection URL
   (`POST /api/shortcuts/cash/create?shortcut_token=...`, the Shortcut
   Worker, outside Access). `requestId` is `cash-` and the phone's time to
   the millisecond, one per run, so the server never saves one run twice.
3. Shows the server's `notification` ("Saved: Coffee, Rp 35,000 cash"), or
   "Not saved." and the server's `error`.

The server decides everything else with the cash pad's rules: the key's
person, their cash wallet (Settings, Payment ways), the currency (the trip
on today, else the last cash currency in 7 days, else the wallet's), today,
and the category guess. A person with no cash wallet gets "No cash wallet
for <name>. Choose one in Monies Map, Settings, Payment ways. Nothing was
saved." A currency with no exchange rate gets the Apple Pay Shortcut's
answer: "Couldn't get today's IDR to SGD exchange rate. Nothing was saved.
Run the Shortcut again in a minute."

Known limits: a number pad answer carries the amount only, so the entry is
"Cash" in Other until it is tidied in the app; words ("35000 coffee") come
through only as text handed to the Shortcut. A run whose answer never
arrives is not retried by the Shortcut itself (the cash pad in the app does
retry); running it again is a new payment.

## Release procedure

Same as the Apple Pay Shortcut (`../apple-pay-api/README.md`):

1. Change the source (it is generated from a small script kept outside the
   repository; edit the plist directly for small changes) and keep action 0's
   text blank.
2. Stage it under a temporary name ending in `.shortcut`, convert it with
   `plutil -convert binary1`, and sign it:

   ```bash
   shortcuts sign --mode anyone \
     --input /tmp/monies-map-log-cash-unsigned.shortcut \
     --output /tmp/monies-map-log-cash-signed.shortcut
   ```

3. Replace the versioned release and the byte-identical public copy with
   the signed output, and update `manifest.json` (hashes, size, action
   count, setup question index).
4. Exercise a disposable local or test install. Never put a production key
   in a committed or test artifact.
5. Run `npm run verify`, deploy, and probe the public gateway without
   creating a production entry (a POST with no key answers 401).

Do not commit an installed copy after its setup question was answered: that
copy holds the private connection.
