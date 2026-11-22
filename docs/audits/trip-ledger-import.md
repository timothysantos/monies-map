# Trip ledger import

A one-off, owner-run tool that brings a trip ledger (a separate tool's list
of photographed receipts: trip day, shop, items, amount in the trip's
currency, an SGD figure, who paid and what the other person owes) into
Monies Map through the app's existing commands. Not part of the Worker and
not a screen: nothing user-facing changes, and there is no route.

Code:

- `src/domain/trip-ledger-match.ts`: reads the export, places trip days on
  calendar dates (`inferTripDayZero`), matches purchases to entries
  (`matchTripLedger`). Pure.
- `src/domain/trip-ledger-plan.ts`: the proposed change per purchase as
  steps of existing commands, the questions, and the totals. Pure.
- `src/domain/trip-ledger-snapshot.ts`: the household facts the plan is built
  from, plain SELECTs only.
- `src/domain/trip-ledger-apply.ts`: runs (or undoes) a reviewed plan through
  the existing commands. Only the script imports it.
- `scripts/trip-ledger-import.mjs`: `preview`, `apply`, `undo`.
- Tests: `tests/trip-ledger-import.test.mjs` (pure, invented fixtures) and
  `tests/atomic-writes-trip-ledger-import.test.mjs` (local D1, demo
  household: failure mid-run, re-run, idempotency, undo, and the Splits
  expense create's own atomicity).

## What it does

1. **Dates.** Trip day N is day 0 plus N days. Day 0 is the date most
   purchases agree on from the dates in their own ids and notes
   ("…-20310305-…", "5 Mar 2031", "(1 Mar = Day 0)"); a purchase whose date
   and day disagree is listed, never moved.
2. **Matching.** For each purchase, the entries on the payer's own wallets
   (Split Payer rule: a wallet's one owner paid) dated from a day before to
   three days after (the home clock is behind the trip's; a bank posts
   later), whose trip-currency amount is the same (kept on an estimate, as
   the Apple Pay Shortcut keeps a yen tap's, or printed on a card row) or
   whose SGD amount is at most 5% over and 2% under the ledger's (at least 10
   cents). A different trip-currency amount is another purchase. Score: the
   amount, the shop name, the time of day, the day distance. Each entry goes
   to one purchase at most.
   - The day window, the amount room and the shop test are Receipt Match's
     own (`receipt-batch-config.ts`, `shopsAgree` in `receipt-match.ts`), so
     a receipt read in Ask and a ledger line imported here agree on what is
     the same purchase. Two differences, both because a ledger line carries
     more than a photo: the SGD figure is compared directly (Receipt Match
     converts a foreign total at the saved rate), and a shop name that does
     not agree only lowers the score instead of ruling the entry out, so a
     card row that names a payment gateway rather than the shop can still be
     the purchase when nothing else fits (never `certain`). A card's cut-off
     name ("AMAZE*CORNERMART" for "Cornermart station") also counts.
   - `certain`: same amount to the yen or cent, same shop or time, within a
     day, the only candidate;
   - `likely`: one clear best candidate; also identical charges (same shop,
     day and amount) whose entries have identical bank facts, paired in order;
   - `ambiguous`: two candidates (or two purchases) fit equally: nothing is
     changed, the owner picks;
   - `none`: no entry fits.
   Entries in the trip's days that no purchase took are listed; so are
   possible bookings made in the 60 days before (booking sites, rentals,
   airline names), which the import never changes.
3. **Proposed changes**, only as existing commands:
   - matched entry: category (`updateEntryCategoryRecord`), the item lines
     added under its note (`updateEntryNoteRecord`, bounded to 280
     characters), Add to Splits with the payer and shares
     (`createSplitExpenseFromEntryRecord`), put on the trip. A
     statement-certified entry keeps its amount, date and wallet; the plan
     carries no step that could change them. When the entry's amount differs
     from the ledger's, the other person's share keeps its proportion (an even
     split stays even, all stays all);
   - paid by the owner, no entry: a new entry (`createEntryRecord`) on the
     wallet the ledger names, saved as a Foreign Currency Estimate: the SGD
     amount the ledger has (the card's activity amount when it showed one),
     the trip-currency amount in `original_amount_minor`/`original_currency`,
     the shop name as its description, no time (it is backdated), and
     `external_reference` `trip-ledger:<trip>:<purchase id>`. A shared one is
     created Shared, with its split in the same batch. A purchase the card
     took in parts (the ledger's notes list the charges and they add up
     exactly) becomes one entry per charge, the share divided by size to the
     cent;
   - paid by the other person, no entry: a Splits expense paid by them
     (`createSplitExpenseRecord`, card, `awaiting_statement`) with the owner's
     share. The model does not need a ledger entry for it: a split expense may
     stand alone, and when that person's card statement is imported the Split
     Match Suggestion can link it to their card's row. Paid by them for
     themselves (nothing owed): nothing is recorded; it arrives with their
     statement;
   - the trip: made if missing (`saveTripEvent`, with the trip currency so
     later Apple Pay taps get the dashed chip), and every entry put on it in
     one change (`setTripEventEntries`, Undo-able);
   - the Splits group: by default a new SGD group named after the trip
     (`createSplitGroupRecord`), linked to it; the owner can name an existing
     group or none instead.
4. **Held, never guessed.** A purchase is held with a question when the
   ledger has no amount or no share, marks the sharing or the payer pending,
   when its category has no place in the household's list (no category is
   invented; the owner names one), when its wallet is not one of the payer's
   wallets by name, when the match is ambiguous, or when an Apple Pay tap at
   that shop is still waiting for its amount (finish the tap first; a new
   entry would count it twice). A share the ledger itself calls provisional
   is imported as it is unless the owner says otherwise.
5. **Totals.** What the owner would owe the other person after the import
   versus the ledger's own owed figures, and what each paid and each one's
   share, both ways, with every difference listed line by line (a held line,
   a bank amount that differs).

## How the statement pairs with a new estimate (no duplicate)

The card's statement or activity export pairs a row with an open estimate on
the same wallet when the row is at most 5% over and 2% under it and the day
fits the velocity rule (`app-repository-import-preview.ts`,
`pairForeignCurrencyEstimates`), surest first: a row that prints the same
trip-currency amount ("JPY 12,500", as direct foreign charges do); a row that
names the shop ("AMAZE*NOODLEBAR" starts "Noodle Bar"), several at one shop on one
day pairing by size; a payment-app row naming no shop when it and the
estimate are each other's only fit. On commit the card's amount replaces the
estimate and the entry keeps its id, so its category, note, split and trip
stay. That is why a new entry's description is the receipt's shop name and
why a purchase charged in parts gets one entry per charge.

## A wallet the owner is not sure of

An answer can name a wallet as not certain (`{ "accountId": "…", "certain":
false }`). The entry is made on that wallet, and both the preview line and
the entry's note say "Wallet not certain: <wallet>". If it is right, the
wallet's statement pairs with it as above. If the purchase was on another
card, that card's statement does not pair with it (pairing stays on one
wallet), so the other card's row comes in as a new entry and the purchase is
counted twice, while the estimate stays open on the first wallet. The trip
page's Needs a look names that estimate once it is 40 days old with no
statement. To correct it:

- before the right card's file is imported: move the entry to that card
  (Ask's card change, `updateEntryAccountRecord`, keeps the amount, the kept
  yen amount, note, split and trip); its import then pairs with it;
- after: delete the estimate on the wrong wallet (the bank row is the
  purchase), put the bank row on the trip and give it the category, note and
  split. A PDF statement's mismatch check offers a move only when the two
  amounts are the same to the cent, which an estimate rarely is.

## Running it

```sh
# 1. Preview (read-only SELECTs through wrangler; writes preview.json,
#    preview.md and snapshot.json to --out, prints the plan hash).
node --import tsx scripts/trip-ledger-import.mjs preview \
  --export <export.json> --out <private folder> --trip-name "Hokkaido trip" \
  [--answers <answers.json>]

# 2. Answer the questions in an answers.json and preview again:
#    { "categories": { "Crafts": "Shopping" },
#      "wallets": { "Visa · contactless": "<account id>" }  (or { "accountId": "…", "certain": false }),
#      "splitGroup": { "newName": "Hokkaido trip" } | { "existingId": "…" } | { "none": true },
#      "skip": ["<purchase id>"], "acceptProvisional": ["<purchase id>"],
#      "trip": { "endDate": "2031-03-09" } }

# 3. Dry run, then apply, against the remote database as the owner's own
#    wrangler login (a remote D1 binding); --d1 local --persist-to <dir>
#    rehearses on a local copy.
node --import tsx scripts/trip-ledger-import.mjs apply --plan <folder>/preview.json --hash <hash>
node --import tsx scripts/trip-ledger-import.mjs apply --plan <folder>/preview.json --hash <hash> --apply
```

Why a local script and not a route: the deployed API needs the owner's
Cloudflare Access session, which no script should hold, and a new admin route
would be server surface for a one-off. The script reaches D1 with the owner's
own wrangler credentials and calls the same command functions the routes
call, so every write is an existing, tested command.

## Write boundaries and safety

- `apply` refuses without `--hash` equal to the hash of the exact
  preview.json, and is a dry run without `--apply`.
- Each step is one existing command, all-or-nothing in its own `db.batch()`
  with its own audit event. A failure leaves that step out entirely; earlier
  steps stay; the next run carries on (proved in
  `tests/atomic-writes-trip-ledger-import.test.mjs`). `createSplitExpenseRecord`
  (the Splits page's Add expense) was converted to one batch for this.
- Idempotent: before each step the live data is checked. An entry with the
  step's `external_reference`, a split on the entry, a Splits expense with
  the same day, shop, amount, payer and group, a category or note already in
  place, a trip or group with the name: the step is `already` and nothing is
  written. Running the same plan again changes nothing.
- Refused, not forced, when the data moved since the preview: an entry's
  category or note is no longer what the preview saw, its amount changed (the
  shares would be wrong), or an entry that could be the purchase has appeared
  on that wallet (a new entry would double it).
- Never: amounts, dates or wallets of existing entries; deleting anything;
  imports, statements or reconciliation; categories, people or wallets.

## Trail and undo

Every step the apply ran writes one `audit_events` row: `entity_type`
`trip_ledger_import`, `entity_id` the plan's import key
(`trip-ledger:<trip>:<export hash>`), `action` `trip_ledger_step`, and the
ids it made or changed (plus the value before, for a category or note). A
run that did anything ends with `trip_ledger_import_applied`. The existing
commands' own audit events are there as well.

```sh
node --import tsx scripts/trip-ledger-import.mjs undo --import-key <key>          # dry run
node --import tsx scripts/trip-ledger-import.mjs undo --import-key <key> --apply
```

Undo runs the steps backwards with existing commands: the trip change is
undone (`undoTripEventChange`), Splits expenses go to Splits activity history
(`deleteSplitExpenseRecord`, restorable there), notes and categories go back,
entries the import made are deleted with the split saved with them
(`deleteEntryRecord` with `withLinkedSplit`), a trip it made is deleted
(`deleteTripEvent`, which has its own Undo). Kept and reported: an entry a
statement has certified since (roll back that statement import instead), a
category that was empty before, and a Splits group it made (there is no
group delete; it is left empty). Each undone step writes
`trip_ledger_step_undone`; a second undo does nothing.

## Privacy

- The export, the preview and the snapshot hold the household's private
  purchases. They stay in the owner's private folder (outside the
  repository) and are never committed. Tests use invented data in the same
  shape.
- No AI, no network beyond wrangler's own calls to the household's D1.
- Nothing reads, prints or stores card numbers; a card the ledger names only
  by network ("Visa · contactless") is asked about by name, and the
  answer is an account id.
- Notes carry the receipt's item lines, bounded.
