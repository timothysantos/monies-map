# Shortcut per person: privacy and write boundaries

Date: 2026-10-14

## Why

The Apple Pay Shortcut had one household-wide connection: one key, one
Default account list, one default owner. A second phone installed from it put
its purchases on the first card of the one list and showed them as that card's
owner's (`tests/shortcut-one-key-baseline.test.mjs` pins the old behaviour).
Each person now has their own connection (DOMAIN.md "Shortcut Connection").

## What changed

- Storage: `app_settings` only. `shortcut_api` stays the first person's (the
  household owner's) connection; anyone else's is
  `shortcut_api_person_<personId>`. No table or column was added, so there was
  no migration and the installed key is unchanged: his phone needs no
  reinstall (`tests/shortcut-per-person.test.mjs`, first test).
- Auth: the request's key is compared in constant time with every connection's
  key (no early exit) and the match says whose phone it is. A missing, wrong,
  blank, revoked or replaced key is `401`; with no key anywhere it is `503`.
- Owner: an entry saved through a connection always belongs to that person.
  `ownerName` in the request or the default params is ignored, so one
  person's key cannot save an entry as another's, on any card, shared or not.
- Keys: two people cannot hold the same key (the save refuses it, also
  against the Worker secret). The key is still shown to and copyable by the
  signed-in household member in Settings, exactly as before; it is not
  logged, audited (the audit detail names the person and the count of
  accounts, never the key) or sent to AI.
- Revoke: removes the key and keeps it removed even if `SHORTCUT_INGEST_TOKEN`
  is set; regenerating a key replaces the old one at once.
- The `monies-map-shortcuts` Worker is unchanged: still public (exempt from
  Access), still only `POST /api/shortcuts/entries/create`, still `404` for
  everything else. The new Settings routes (`save`, `revoke`) are on the main
  Worker behind Access and are not reachable from the Shortcuts Worker.

## Write boundaries

- Connection save and revoke: one setting plus one audit event in one
  `db.batch()` (`tests/atomic-writes-shortcut-connections.test.mjs`).
- A Shortcut purchase: the same single `createEntryRecord` batch as before.
- Moving an entry to another card (Ask's card suggestion, only after the
  person's Yes): one account change, audit event and month markers in one
  batch; certified, Splits, transfer and other-currency entries are refused
  (`tests/atomic-writes-entry-account.test.mjs`).

## Privacy and cost

- Nothing new goes to AI; the card suggestion is a deterministic read of the
  household's own entries and works with AI off.
- The card suggestion reads at most three times (entry, accounts, one
  indexed history read limited to 500 rows) and writes nothing.
- The first-screen budgets are unchanged: the connection UI is in the lazy
  Settings route and the question is in the lazy Ask route.

## Screenshots

Phone width, demo data, in `docs/audits/shortcut-per-person/`:
`before-section-phone.png` (before) and `after-section-phone.png`,
`after-joyce-phone.png`, `after-joyce-more-phone.png` (after: the "Who is this
phone for?" row, the install button naming the person, **Stop this phone**
under More shortcut settings); `card-question-phone.png` is the Ask card
question.

## Known limits

- Ask's entry draft and the Entries composer still use the household's
  (first person's) Default account order for a typed entry; only the
  Shortcut is per person.
- A person added to the household later starts with no key until they install
  the shortcut.
