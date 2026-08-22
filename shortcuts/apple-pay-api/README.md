# Monies Map Apple Pay API Shortcut

This directory is the durable source of truth for the public Apple Shortcut.
It is deliberately separate from the project owner's personal Shortcuts
library and from Apple's hosted iCloud share record.

## Files

- `monies-map-apple-pay-api.plist` is the reviewable, secret-free source.
- `releases/monies-map-apple-pay-api-2026-08-22.shortcut` is the exact
  Apple-signed artifact served by the current approved iCloud share.
- `manifest.json` records the iCloud identity, release status, action contract,
  and SHA-256 checksums.

The source and signed artifact must never contain a household API key, private
connection URL, `shortcut_token`, or authorization header value. Installation
injects the private connection URL into the blank Text action on each device.

## Ownership Model

The project owner may keep a personal shortcut named `Monies Map Apple Pay API
Source` as a convenient, unmodified editing backup. That copy can sync between
the owner's Mac and iPhone through the personal Shortcuts library. It is not the
canonical source and is not what the public link reads at runtime.

The iCloud URL identifies an Apple-hosted signed snapshot. Installing or
replacing the shortcut creates a local copy on that device. Local edits,
renames, replacement, and deletion do not rewrite the published snapshot or
other users' installed copies. The owner can explicitly stop sharing the old
record, but publishing a revision otherwise creates a new reviewed release and
the app must point to its new iCloud URL.

## Release Procedure

1. Import the current signed release into Shortcuts with setup skipped, or
   duplicate the trusted personal `Monies Map Apple Pay API Source` copy.
2. Duplicate it under a working name and make the intended action changes.
3. Confirm the setup Text action is blank and no household token, connection
   URL, or authorization value is present.
4. Exercise the work copy in Shortcuts, including its Dictionary input, POST,
   notification, and `openUrl` behavior. Use a disposable test key and test
   ledger, not the production token.
5. Publish the reviewed work copy through Shortcuts to obtain a new iCloud share
   URL. Do not assume edits to a personal copy update an existing share.
6. Download and inspect Apple's hosted unsigned and signed payloads. Convert the
   unsigned payload to an XML plist for review, store the exact signed payload
   under `releases/`, and record the new record ID, checksums, signed release
   file, and action contract here.
7. Update the install URL in `src/client/settings-sections.jsx`, its browser
   test, the FAQ, and this manifest in the same change.
8. Run `npm run verify`, deploy, and probe the public shortcut gateway without
   using a real token or creating a production ledger entry.

Do not commit an installed shortcut after its setup question has been answered;
that local copy contains the private household connection.
