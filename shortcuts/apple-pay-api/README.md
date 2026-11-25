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

## Amounts in another currency (every version)

Every release posts Wallet's amount text unchanged. Wallet writes it the way
the phone writes money: on English (Singapore) `$12.34`, `IDR 159,000` and
`JP¥965` (English US `¥965`, Japanese `￥965`). The server reads the
currency from the code or sign (`src/domain/wallet-currency-config.ts`) and
saves the entry in the card's currency at the day's rate. Until 2026-11-22
the yen signs were not known, so every yen tap in Japan was refused with
"Missing or invalid shortcut fields: amount." (the Shortcut showed "Not
saved"); the fix was on the server, so no reinstall was needed. Every
release's request is replayed in `tests/shortcut-released-versions.test.mjs`
(shapes in `tests/fixtures/shortcut-released-requests.json`): add the new
release's row when one is signed. v4 and v5 send v3's `clientVersion`.

## A blank amount (`needsAmount`)

An overseas terminal that asks which currency to pay in can reach the Wallet
automation with a blank amount, and the second tap does not run the Shortcut
again. When `amount` is blank or has no figure in it and every other field is
valid, `POST /api/shortcuts/entries/create` answers HTTP 400 and saves nothing
(since 2026-11-26 only for v1 and runs with no version; v7 gets this answer
with `held: true` and the tap kept, see "The Wallet automation's wrapper,
and bare taps"):

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

## The Wallet automation's wrapper, and bare taps (2026-11-26)

The Shortcut reads its input only as a Dictionary with `value`, `merchant`
and `name` (every release from v2: action 0 is Get Dictionary from Input on
Shortcut Input; its input types are app, rich text, text and file). The
personal automation builds that Dictionary. Build it with **one Dictionary
action** holding three **Text** items (`merchant` = Shortcut Input's
Merchant, `value` = Amount, `name` = Name), then **Run Shortcut** with that
Dictionary as input. Never with **Set Dictionary Value**: on iOS 27.2,
Wallet can run the automation before it has the details, and Set
Dictionary Value then stops the automation with "No value was provided to
the Set Dictionary Value action for the key "merchant"", so this Shortcut
never runs (the owner's phone, Japan, November 2026). Passing Shortcut
Input straight to Run Shortcut does not work with v2 to v8 (not a
Dictionary with those keys).

A run that arrives with no shop, or no amount, or neither but the card's
name, is kept as a waiting tap (DOMAIN.md "Bare Tap"); a run with nothing
at all is refused as before. What each release shows (read from the signed
files, decoded with the signing certificate each one carries:
`aea decrypt -sign-pub`, then `aa extract`; replayed in
`tests/shortcut-released-versions.test.mjs`): v8 shows the reply's `notice`
("Payment on UOB One noted. Waiting for its details."); v7 asks "How much
was it?" for a tap that has its shop and otherwise shows "Not saved <shop> •
<error>"; v2 to v6 show "Not saved <shop> • <error>" with `error` saying
where it waits ("Payment on UOB One kept on Entries until its details come
in."); v1 sends no request id and keeps the old answers. None shows "Saved"
for a kept tap. Table: `docs/audits/waiting-taps.md`, "Bare taps".

## Bank alert to Monies Map (second Shortcut)

`../bank-alert/` holds a second, much smaller Shortcut (DOMAIN.md "Bank
Alert"): `monies-map-bank-alert.plist` (secret-free source, 3 actions),
`releases/monies-map-bank-alert-2026-11-17-v1.shortcut` (Apple-signed with
`shortcuts sign --mode anyone`), the byte-identical
`public/shortcuts/monies-map-bank-alert.shortcut`, and its own
`manifest.json`. Settings installs it with the same private connection URL
(the import question on action 0, the same blank Text pattern).

It runs from a personal automation the person makes on the phone (a
Notification from the bank's app, a Message from the bank's sender, or an
Email); an automation cannot be shipped in a file. Its actions: the setup
Text; Replace Text `entries/create` with `alerts/bank`; one POST of
`{ text, receivedAt, requestId, clientVersion }` (`text` is the Shortcut
Input as text, `receivedAt` the current date as `yyyy-MM-dd'T'HH:mm:ssXXX`,
`requestId` `bank-alert-` and the current date to the millisecond,
`clientVersion` `bank-alert-2026-11-17-v1`). Nothing reads the reply: no
notification, no question, no result, whatever the server answers.

- Verified (tests against a local Worker and D1,
  `tests/bank-alert-route.test.mjs`): the source's actions and keys, the
  artifact's hashes, and simulated runs (an OTP and a promotion end
  silently and change nothing; the bank's alert then finishes the waiting
  tap).
- Not verified: anything on a phone. Unknown: whether iOS passes a bank
  app's notification text to the Shortcut at all (and whether Messages and
  Mail pass the body), and each bank's exact wording (the reader's wordings
  are guesses, `verified: false` in `src/domain/bank-alerts-config.ts`).
- The phone check: install it, make a Notification automation for the
  bank's app with Run Immediately, pay a small amount, then open the
  Shortcuts app's automation log. Did it run? If a waiting tap was there,
  did it finish (`waiting_taps.completed_by = 'bank_alert'`)? If it ran and
  nothing finished, copy the alert's wording (with the card digits and
  names changed) into a new config entry and its test.

Release: change the plist, `plutil -convert binary1` it to a temporary
`.shortcut` file, sign it with `shortcuts sign --mode anyone`, copy the
signed file to `releases/` (new version in its name) and `public/shortcuts/`,
and update `manifest.json` (hashes, size, action count). Never put a key,
`shortcut_token` or connection URL in it.

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
