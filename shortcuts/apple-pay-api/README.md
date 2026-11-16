# Monies Map Apple Pay API Shortcut

This directory is the durable source of truth for the Apple Pay Shortcut. It is
independent of the project owner's personal Shortcuts library and iCloud.

## Files

- `monies-map-apple-pay-api.plist` is the reviewable, secret-free source.
- `releases/monies-map-apple-pay-api-2026-11-17-v8.shortcut` is the exact
  Apple-signed release for anyone to import.
- `../../public/shortcuts/monies-map-apple-pay-api.shortcut` is a byte-identical
  public copy served by the app.
- `manifest.json` records the release status, action contract, and SHA-256
  checksums.

The source and signed release are kept in lockstep. When the source changes,
convert it to Apple's binary property-list format before signing with the macOS
`shortcuts sign --mode anyone` command. The signed output is copied into both
the versioned release and `public/shortcuts/` before deployment.

The source and signed artifact must never contain a household API key, private
connection URL, `shortcut_token`, or authorization header value. Installation
injects the private connection URL into the blank Text action on each device.

## Ownership Model

The project owner may keep a personal shortcut named `Monies Map Apple Pay API
Source` as an editing convenience. It is not canonical and the app does not
read it. The committed plist is the source; the committed signed file is the
release.

Installing creates a local copy in that device's Shortcuts library. Local edits,
renames, replacement, and deletion do not change the committed source, the
deployed download, or another device's installed copy. Deploying a newer signed
file changes what future installations receive; existing devices must reinstall
and choose Replace.

The older iCloud share remains a superseded v1 snapshot. The current Settings
button does not use it.

## Entry time

The Shortcut sends only `date` (`yyyy-MM-dd`), so the entry's time of day is
the moment the server received the request, converted to Singapore time and
saved as `transaction_time` ("HH:MM"), but only when `date` is today in
Singapore (a purchase dated another day has no time). The response adds
`time` for a new entry. The Shortcut runs when the Wallet transaction happens,
so that moment is the purchase time to the minute. A reinstall is not needed:
the contract has no new field. (`requestId` carries the phone's own
timestamp, but in the phone's time zone, so the server's receive time is used
instead.)

## A blank amount (`needsAmount`)

An overseas terminal that asks which currency to pay in can reach the Wallet
automation with a blank amount, and the second tap does not run the Shortcut
again. When `amount` is blank or has no figure in it and every other field is
valid, `POST /api/shortcuts/entries/create` answers HTTP 400 and saves nothing:

```json
{ "ok": false, "needsAmount": true, "merchant": "Periplus", "accountName": "Amaze", "error": "Missing or invalid shortcut fields: amount." }
```

Any other problem (including a refused figure such as a refund or `12,34`)
keeps the plain `{ ok: false, error }` answer, without `needsAmount`.

From v7 the Shortcut reads `needsAmount` in the not-saved branch and shows
Ask for Input (Text):

> How much was it?
> MERCHANT on card. The amount didn't come through. Type it in SGD, or add the
> currency, like IDR 150000.

The answer becomes `TransactionAmount` and the same request is posted again
with the same `requestId` (kept per tap in the `TapRequestId` variable), then
the usual Saved or Not saved notification shows. Cancel stops the Shortcut and
saves nothing. A tap that has an amount never sees the prompt. The amount
reader accepts a dot as the thousands mark (`Rp150.000`, `IDR 150.000`,
`1.234.567`) only for groups of exactly three figures with no comma; a lone
group needs a Rupiah sign, and `19.82`, `150.00` and `SGD 12.345` read as
before. Installed copies do not update themselves: reinstall and choose Replace.

## A held tap (v8, `held`)

From v8 (`apple-pay-api-2026-11-17-v8`, 69 actions) a blank amount is not a
question in the middle of paying. The server keeps it as a waiting tap
(DOMAIN.md "Waiting Tap") and answers 202:

```json
{ "ok": true, "held": true, "requestId": "apple-pay-…", "merchant": "Periplus Bali", "accountName": "UOB One", "notice": "Periplus Bali noted. Waiting for the amount.", "openUrl": "https://…/entries?waiting_tap=tap-…" }
```

The Shortcut reads `held` first. When it is there it shows `notice` as a
silent notification and ends; the person finishes the payment at a calm
moment on the card at the top of Entries (or Ask's reminder). Only when the
reply also carries `askAfterSeconds` (off by default; the server's
`WAITING_TAP_ASK_AFTER_SECONDS` or `ASK_AFTER_SECONDS` in
`src/domain/waiting-taps-config.ts` turns it on, no reinstall) does the
Shortcut wait that long, replace `entries/create` with `taps/status` in its
connection URL, post `{ requestId }` there, and, if the answer has `ask`, show
Ask for Input (Text): "How much was MERCHANT? Paid on CARD. The amount didn't
come through. Type it in SGD, or add the currency, like IDR 150000." The
answer is posted with the same `requestId` and completes the tap; Cancel
leaves it waiting. Any other status answer shows its `notice` (for example
"Saved Periplus Bali • SGD 22.94 • UOB One" when a second tap finished it).
Without `held` the Shortcut runs exactly as v7 (including v7's `needsAmount`
question, which only happens if the server's table is missing).

What is verified and what is not:

- Verified (tests against a local Worker and D1,
  `tests/shortcut-v8-paths.test.mjs`): the source's branches and keys, and
  each path the actions take: held and ended; held, then finished by a
  second run before the status read; held, asked after the wait, answered;
  held, asked, Cancel. The signed file was produced with
  `shortcuts sign --mode anyone`.
- Not verified: anything on a real two-tap terminal (none in Singapore asks
  an SG card which currency to pay in). Unknown: whether the Wallet
  automation runs again for the second tap at all (the owner's Bali trip: 4
  of 4 did not, with v6, which ended at once), and whether a run that is
  still open (a Wait or Ask for Input) stops the next one. That is why the
  default never waits. Not tested on a device: the Wait action reading its
  seconds from the reply, and the status URL built by Replace Text (both only
  run when `askAfterSeconds` is turned on).
- The device test that would settle it: on a terminal that asks the
  currency, tap, choose, tap again a few seconds apart; then compare Wallet's
  card history (one payment or two) with the Shortcuts app's automation run
  log (one run or two, and whether the second had an amount), and check the
  tap's `second_run_seconds` in `waiting_taps`.

## Release Procedure

1. Change the secret-free plist source and keep its setup Text action blank.
2. Confirm the Shortcut still accepts a Dictionary through the explicit
   `Shortcut Input` binding, containing `value`,
   `merchant`, and `name`; posts `amount`, `description`, `date`, `name`,
   `requestId`, and `clientVersion`; and handles `held`, `notice`,
   `askAfterSeconds`, `openUrl`, `accountName`, `needsAmount`, and `error`
   from the response, and `ask` and `notice` from the tap status read.
3. Stage the plist under a temporary filename ending in `.shortcut`. Apple's
   CLI rejects the same unsigned contents when the input filename ends in
   `.plist`.
4. Sign it for public import:

   ```bash
   shortcuts sign --mode anyone \
     --input /tmp/monies-map-apple-pay-api-unsigned.shortcut \
     --output /tmp/monies-map-apple-pay-api-signed.shortcut
   ```

5. Replace the versioned release and the byte-identical file under
   `public/shortcuts/` with that signed output.
6. Update `manifest.json` with the source hash, signed hash, size, action count,
   and setup question index.
7. Exercise a disposable local/test installation through the Wallet Dictionary,
   POST, notification, retry, and `openUrl` paths. Never put a production token
   in a committed or test artifact.
8. Run `npm run verify`, migrate D1, deploy, and probe the public gateway without
   creating a production ledger entry.

Do not commit an installed shortcut after its setup question has been answered;
that local copy contains the private household connection.
