# Ledger check-up audit (phase 1: detectors and API)

Status: complete for phase 1 (the engine, the fifteen kinds of finding, the
read API and "This is fine") and phase 2 (the "Check my books" page, below).
Phase 3, the correction of a settled period, is not built. The design note is
[`docs/proposals/ledger-checkup.md`](../proposals/ledger-checkup.md);
DOMAIN.md "Ledger Check-up" is the vocabulary.

## What shipped

`GET /api/ledger-checkup[?view=<person id|household>][&dismissed=1]` returns

```text
{ ok, generatedAt, tierCounts, kindCounts, dismissedCount,
  findings[] (at most 50 per kind), moreByKind, incompleteKinds, unavailableKinds }
```

and `POST /api/ledger-checkup/dismiss` `{ id, evidenceKey }` /
`POST /api/ledger-checkup/undo-dismiss` `{ id }`. Nothing else writes. No AI,
no schedule, no cache: the check runs only when the person asks for it.

| Piece | File |
| --- | --- |
| finding model, tiers, kinds | `src/domain/ledger-checkup/types.ts` |
| one module per detector | `wrong-card.ts`, `split-duplicates.ts` (duplicate split expense and settled-period error), `duplicate-entries.ts`, `unmatched-transfers.ts`, `statements.ts` (gaps, joins, balance mismatch), `stale-estimates.ts`, `plan-problems.ts`, `hygiene.ts` |
| registry (one list) | `registry.ts` |
| shared loader (3 round trips) | `loader.ts` |
| runner (order, cap, dismissals, person view) | `runner.ts` |
| page builder | `src/domain/pages/ledger-checkup.ts` |
| dismissal command | `src/domain/app-repository-ledger-checkup.ts` |
| routes | `src/server/ledger-checkup-route.ts`, `src/index.ts` |

## Rules as built

Common to every detector: deleted or archived records are ignored, an import
that is not `completed` is not the ledger, a statement-certified entry is never
second-guessed where the rule is about unproven entries, and a detector that
cannot read a row skips it. A detector that throws is named in
`unavailableKinds` and never blanks the report.

| Kind | High | Check | Note | Silent |
| --- | --- | --- | --- | --- |
| `wrong_card_duplicate` | the wrong-card rule's HIGH over the whole ledger: an earlier completed file of the entry's own card covers the day, was loaded at least the card's posting lag after it, and does not list it; one twin on another card within 2 days with a strong shop match; no same-amount row on the entry's card; no claimant; no links; not an estimate; compatible owners | | the rule's MEDIUM (one soft gate failed) | LOW: no coverage, within the lag, several twins, contested twin |
| `duplicate_split` | one typed record and one linked to a bank row, same group, day, amount, currency and payer, shares agreeing (a rounding cent allowed), and the Splits matcher (`findBestSplitExpenseMatch`) would put the typed record on that bank row | the same key with the matcher saying no, or both typed with the same words, or two same-day payments of one amount | | both linked to different rows (two real purchases), more than two with the key, different shares and different words |
| `settled_period_error` | both copies inside a settle-up, as `duplicate_split` high; or a copy deleted after the settle-up that still holds it, with exactly one live twin the same settle-up holds and agreeing shares | one copy inside and one open, a failed gate, a deleted cost with no provable twin | | nobody but the payer shares it (no balance moved), reopened or voided settle-ups |
| `duplicate_entry` | same account, day, amount, direction and words, two different completed imports, identical bank-row hash | any other pair that passes the gates | | the same import (the bank's own repeat), certified, Apple Pay or Ask entries, transfer pairs, linked entries, three or more with the key |
| `unmatched_transfer` | exactly one plausible partner within a week and it is an opposite-direction transfer (a pair is one finding, whichever side finds it) | one ordinary partner the right way round (money in for a transfer out, a purchase for a transfer in), or several | no plausible partner, one line per series | investment accounts, under a week old, dismissed in the transfer review, held by a settle-up, another currency, a purchase of a round amount next to a transfer out |
| `statement_gap` | a removed statement is on record, or one month with 5 or more entries and statements monthly elsewhere | any other month with entries between two statements | | a month with no entries, the month after the latest statement, one statement only, archived accounts |
| `statement_join` | | the first statement of the last 8 that stops matching while the one before it matched and the latest still differs, only between consecutive months | | a break after a missing month (the gap's), a healed chain |
| `balance_mismatch` | the latest proven statement no longer matches and the entries created after it was proven add up to the difference exactly | the ledger moved and no later entries explain it | | a matching statement, an unproven statement, a healed chain |
| `stale_estimate` | older than the card's posting lag plus 14 days, and a completed file or statement of that card covers the day | no file of the card covers it yet | | younger than that, matched to a bank row, linked |
| `plan_overspent` | | planned spending beyond income by more than $50 and 2% of income, this or next month | | past months, no income, small shortfalls |
| `plan_line_unpaid` | | a due dated bill with nothing linked and exactly one same-amount unlinked expense within 10 days (same category) | several fit or the payment could pay another bill | none fits |
| `plan_line_no_category` | | | a plan line with money and no category | |
| `other_category` | | | Other older than 60 days that the household's own rule, or a habit confirmed three times, files elsewhere | a guess from history or everyday words |
| `odd_entry` | | $0, or dated more than 14 days ahead | | |
| `quiet_account` | | | active bank or card account with entries, none for 90 days | cash, investment, loan, archived and never-used accounts |

Ordering is tier, then money at stake (largest first; transfer pairs carry none,
since money moving between the household's own accounts misstates no total),
then recency, then id. `tierCounts` and `kindCounts` count every finding that is
not dismissed, shown or not.

## What the rules were tested against

`tests/ledger-checkup-detectors.test.mjs` (pure detectors, 38 tests),
`tests/ledger-checkup-api.test.mjs` (real Worker and D1, 14),
`tests/ledger-checkup-budget.test.mjs` (3),
`tests/atomic-writes-ledger-checkup.test.mjs` (5).

Adversarial negatives, one test each at least: two real split dinners each
matched to its own bank row; two coffees in one bank file; the same amount on
two cards; a daily repeat; a foreign-currency estimate; certified, rolled-back,
archived and deleted records; a card with no file loaded after the day; an
account with no entries in a month between statements; quarterly statements; a
purchase of a round amount next to a monthly transfer; fourteen monthly
transfers a month apart (never rivals); a plan that fits; a past month's plan;
a habit confirmed twice; a cash, investment or archived account.

Oracles instead of hand-written expectations: the balance mismatch equals the
account's own `latestCheckpointDeltaMinor` (Settings) to the cent; every
payment `plan_line_unpaid` names is the one the Month link dialog's own scorer
ranks first (`buildPlanLinkCandidates`); the wrong-card finding is the import
review's `assessWrongCardDuplicates` unchanged; the split duplicate is the
Splits matcher's own verdict; the transfer partners come from
`selectTransferCandidates`.

Bugs the tests and the first real run caught while building (each is now a
test): the duplicate-entry self-join read 31 million rows on the 10k fixture
until its partner lookup was pinned to the account and day index; a purchase of
a round amount beside a monthly transfer was named as its other side; the
fourteen monthly $450 transfers were each a rival of the next month's; a gap
month was reported twice (a gap and a broken join); a rounding cent between two
copies of an odd total hid a real duplicate; a duplicate deleted after the
settle-up (the production shape) was invisible because both live records were
required.

## False-positive analysis

| Risk | Guard |
| --- | --- |
| Two real purchases the same day, amount and payer in one group | each bank-linked record is its own bank row; a typed record is "the same" only when the Splits matcher itself would match it to the other's row |
| A monthly $450 looks like its neighbours | partners only within a week; a purchase never counts next to a transfer out; one pair is one finding |
| Card payment transfers flagged although the books are fine | stated as "not linked, each counted on its own"; no money at stake (they sort behind findings with money) |
| A dormant or quarterly account looks like a missing statement | needs entries in the missing month; `high` needs monthly statements elsewhere and 5 entries (or a recorded removed statement) |
| A statement mismatch from a sign convention | the same functions the Settings comparison uses; only a statement proven (certified) when saved can mismatch later |
| A missing statement also breaking the next one | the join is only judged between consecutive months |
| An estimate waiting for a file that was never loaded | `high` only when a file or statement of that card covers the day |
| A deliberately overspent plan | a check, never high; the limit is the Money insights To do's own |
| A rule or habit that is only a guess | only the household's own rules or a habit confirmed three times; never history or words |
| Dismissed, then the evidence changes | the evidence key (a hash of ids, amounts, dates and tier) changes and it returns |
| A settled-period cost that is not an error | high needs exactly one live twin, held by the same settle-up, with agreeing shares; otherwise a check |

Residual risk: a monthly series of unlinked transfer pairs (card payments) is
many true findings that change no figure. They are `high` for confidence, carry
no money, and the report counts them by kind (`kindCounts`) so the screen can
set them apart.

## Measured budgets

On the 10k-transaction fixture with production's settled split history and a
problem of every kind seeded (`tests/ledger-checkup-budget.test.mjs`):

| Measure | Value | Bound in the test |
| --- | --- | --- |
| round trips (a batch is one) | 3 | 5 |
| SQL statements | 19 (at most 25: 16 + 1 in the first trip, up to 7 in the second, 1 in the third) | 26 |
| rows read | about 129,000 | 250,000 |
| row bytes read | about 51 KB | 600 KB |
| response | about 49 KB at 50 findings of a kind | 120 KB |
| median node CPU | about 40 ms | 400 ms |

On the demo household: 3 round trips, 8 ms in the handler, 3,360 bytes
(`tests/e2e/api-payload-budget.json`, key `ledger-checkup`). On a local copy of
the owner's production export (7,549 entries, 452 split records, 212
statements): 125 ms of Node CPU in process, 57.7 KB with the cap.

Every read is answered from an index (EXPLAIN asserted for all of them; the
accounts read is the one small-table scan). The entry reads are a date window
(400 days; 180 for duplicates; 800 for transfers; 1,100 for split records) with
a `LIMIT`, so rows read grow with the household's entries in the window, not
with its whole history. Two plans needed care: the duplicate-entry join is
pinned to `idx_transactions_account_date`, and the split and settle-up link
tests use the partial indexes on live records.

The cold path (`ensureDemoSchema`) is untouched; nothing here adds a statement
to it, and no table or column is added. A missing `app_settings` or `ask_habits`
table is tolerated, never an error.

## Writes and boundaries

The only writes are the person's "This is fine" and its undo. One
`app_settings` row per dismissal (`ledger_checkup:dismissed:<finding id>`,
value `{ evidenceKey, kind, dismissedAt }`), plus an audit event
(`ledger_checkup_dismissed` / `ledger_checkup_dismissal_undone`), in one
`db.batch()`; `failingStatement` tests on the write and on the audit event leave
the database identical. Up to 500 dismissals; the command validates the id (a
known kind, at most 200 safe characters) and the key (hex). No schema change,
so no prod or demo migration was needed.

Privacy and cost: no prompt, model call or allowance unit; the report carries the
household's own descriptions (clipped to 60 characters) to the household's own
screen only; nothing is logged beyond the name of a detector that failed.

## Handoff to phase 2 (the screen)

The contract is the response above. Each finding is
`{ id, kind, tier, title, summary, evidence[], amountMinor, currency, occurredOn,
personIds[], fix: { label, path } | null, fixNote, evidenceKey, dismissed }`;
`evidence[]` lines are `{ role, label, shortId?, date?, amountMinor?, currency?,
accountName?, note? }`; `fix.path` is an app path with its query (open it with the
router, never call it as an API route). "This is fine" posts the finding's `id` and
`evidenceKey`; the undo posts the `id`. `?dismissed=1` returns dismissed findings
flagged `dismissed: true` (for an undo list). `?view=<person id>` keeps that
person's findings and the household's.

What the screen must decide or write (no copy is shipped by phase 1 beyond the
finding sentences): the three tier words (suggested "Needs fixing", "Worth
checking", "Good to know"), a heading per kind, the "N more" line from
`moreByKind`, the notice for `incompleteKinds` ("There may be more than shown"),
the notice for `unavailableKinds` ("Could not check: ..."), "This is fine" and its
undo, and the empty state. Many findings of one kind (a household with years of
unlinked card payments has about a hundred) want a collapsed group with its
count from `kindCounts`, not a flat list. Finding titles and summaries are
already plain words and linted (`findAppJargon`, retired names); money in
`summary` is formatted with `$` for SGD and the currency code otherwise.

## Phase 2: the screen ("Check my books")

The page at `/check` ([`docs/flows/check-flow.md`](../flows/check-flow.md),
design.md "Check My Books Page", before and after screenshots in
[`ledger-checkup-screen/`](ledger-checkup-screen/README.md)). It shows what phase
1's API returns and adds no detector, no read and no write.

What it does, as built:

- Runs only when opened or asked again: the page opening, "Check again", a
  change of the header's person, or opening "Show hidden". Nothing else reads the
  report, nothing polls it, and no route warmup row exists for it (a measured
  admission row is needed for speculative data; there is none and none is
  wanted). Its route code is never warmed automatically.
- Groups the report: three sections (Needs fixing, Worth checking, Good to know)
  and nine headings over the fifteen kinds, with the report's `kindCounts` as the
  totals, five rows at first, "Show N more", "Showing 50 of N" when more exist than
  the 50 sent per kind, "There may be more than shown" for `incompleteKinds`, and
  "Could not check this" with a retry for `unavailableKinds`. The first group of the
  highest section starts open; open groups are remembered per device.
- "This is fine" hides a row in place with "Undo", through the existing dismiss
  and undo routes, moves the counts at once and puts the row back if the server
  refuses; the refresh that follows goes through `runBackgroundRefresh`.
- Hidden money: no amount anywhere; a sentence that says which way money went
  (`settled_period_error`, `balance_mismatch`, `plan_overspent`) is replaced, not
  just masked.
- An all-clear is never claimed when a check could not run ("Nothing found in the
  checks that ran").

Measured and proved:

| Check | Result |
| --- | --- |
| first-screen JS (`npm run check:bundle`) | 161,518 B before (7 files), 161,626 B after (7 files): +108 B (the tab's name, the route registration, the tab entry, the nav-intent id) |
| first-screen CSS | the header rules only; route CSS ships with the lazy chunk |
| the new route chunk | `check-panel` and its modules, loaded when the page opens |
| payload | unchanged (phase 1's `ledger-checkup` key) |
| new requests while another page is open | none (`tests/e2e/check-my-books.spec.js` records every `/api/ledger-checkup` request) |
| layout shift while the result lands | below 0.05 on desktop and at 390px (a skeleton reserves 460px, 520px on a phone) |
| contrast | every preset, light and dark (`tests/colour-contrast.test.mjs`, "Check my books reads AA") |

A lesson recorded: the owner imported TanStack's `isCancelledError` and, in turn,
`refresh-notice.js` and `query-leases.js` split the entry chunk the first time they
were imported from a route chunk (a first-screen file more, +440 B). The owner reads a
cancellation by its message instead; `tests/check-data-owner.test.mjs` proves it reads
a real one and `tests/client-route-chunks.test.mjs` fails if a file of the page imports
the package.

The header: seven page tabs need the tight header spacing at every width (see the
screenshots README). `tests/e2e/header-tab-fit.spec.js` pins it.

Not done on purpose: no figure on the page is openable (a problem's amount is the
problem's, not an Entries total); no badge or count on any other screen; no link to
Check my books from another page; no automatic run on a schedule or after an
import.
