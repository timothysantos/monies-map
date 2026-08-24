# Monies Map Apple Pay API Shortcut

This directory is the durable source of truth for the Apple Pay Shortcut. It is
independent of the project owner's personal Shortcuts library and iCloud.

## Files

- `monies-map-apple-pay-api.plist` is the reviewable, secret-free source.
- `releases/monies-map-apple-pay-api-2026-08-22-v3.shortcut` is the exact
  Apple-signed release for anyone to import.
- `../../public/shortcuts/monies-map-apple-pay-api.shortcut` is a byte-identical
  public copy served by the app.
- `manifest.json` records the release status, action contract, and SHA-256
  checksums.

The source may temporarily be ahead of the signed release while a Mac produces
the next Apple-approved `.shortcut` file. During that window the manifest uses
`SOURCE_UPDATED_NEEDS_SIGNING`; the public download remains the last signed
release until the new file is signed, checksummed, and copied into both release
locations.

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

## Release Procedure

1. Change the secret-free plist source and keep its setup Text action blank.
2. Confirm the Shortcut still accepts a Dictionary through the explicit
   `Shortcut Input` binding, containing `value`,
   `merchant`, and `name`; posts `amount`, `description`, `date`, `name`,
   `requestId`, and `clientVersion`; and handles `openUrl`, `accountName`, and
   `error` from the response.
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
