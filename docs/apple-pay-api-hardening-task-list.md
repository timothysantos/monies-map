# Apple Pay API Hardening Task List

Date: 2026-08-22

- [x] Compare browser quick entry, the original direct API setup, the shared
  Shortcut, and the current server contract.
- [x] Reproduce Wallet-shaped amount and local-date inputs instead of relying
  on clean synthetic values.
- [x] Centralize typed request parsing and strict date, money, currency,
  description, note, request-ID, and client-version validation.
- [x] Resolve an exact active Wallet card name before using the saved active
  account priority; reject invalid explicit accounts.
- [x] Persist the selected account currency instead of hardcoded SGD and reject
  a named Wallet currency that conflicts with it.
- [x] Make Shortcut retries idempotent through a unique external request
  reference and return whether the row was created or already existed.
- [x] Return normalized entry and account context for useful notifications and
  optional editing.
- [x] Guard `openUrl` and show the API error rather than calling Open URLs with
  an empty value.
- [x] Add a per-run request ID, ISO date, card name, and client version to the
  Apple Shortcut payload.
- [x] Sign the release for `anyone`, commit its reviewable source and exact
  binary, and serve a checksum-identical copy from the app.
- [x] Update Settings guidance, FAQ, architecture, flow documentation, release
  instructions, and integrity tests.
- [ ] Run the complete merge gate and full browser suite.
- [ ] Apply the production D1 migration, deploy both Workers and assets, and
  complete production probes.

The last two items are closed only after their commands pass; source inspection
alone is not sufficient.
