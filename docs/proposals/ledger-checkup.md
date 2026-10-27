# Ledger check-up ("Check my books")

Owner-approved (2026-10-27). Design note written before the code, phase 1 of 3:
this phase is the detectors and the API only. Phase 2 is the screen. Phase 3 is
the settled-period correction fix. DOMAIN.md "Ledger Check-up" is the canonical
definition once shipped; `docs/audits/ledger-checkup.md` holds the rules as
built, the false-positive analysis and the measured budgets.

Changes made while building, after running the rules on a copy of the owner's
real data (each is reflected below): a transfer's partner must be within a week
(a monthly $450 has a lookalike every month); an unlinked pair is one finding
and carries no money at stake; a settled-period error also covers a copy deleted
after the settle-up counted it (the real flight case); the split duplicate gate
is the Splits matcher's verdict instead of shared words; shares may differ by a
rounding cent; a broken statement join right after a missing month is the
gap's finding; `kindCounts` was added to the report.

## The idea

One explicit, read-only report. The person opens it (nothing runs in the
background, nothing is scheduled, nothing is cached) and it lists problems in
the household's own data in plain words, each with the evidence behind it, how
sure the app is, who it touches, and, where the app already has a fix, a link
to that fix.

Owner principle: airtight. A finding is shown only when its rule can be
proven from the household's records. False positives are worse than misses, so
every detector prefers silence to a guess, and a near miss is a lower tier,
never a louder one.

Hard boundaries (all enforced by tests):

- Read-only. The report changes no ledger, split, plan, statement or settings
  row. The only write in the whole feature is the person's "This is fine"
  (and its undo), described under "Dismissal".
- No AI anywhere. No model call, no allowance unit, no prompt. Deterministic
  rules over bounded reads.
- Same answer with AI on, off, failing or over its allowance.
- Reuses the matchers the app already trusts (wrong-card rules, transfer
  candidate ranking, split-open-period, statement balance functions, plan link
  reasons); it never invents a second definition of "the same purchase".

## Finding model

```ts
type FindingTier = "high" | "check" | "note";

interface CheckupFinding {
  // `${kind}:${subject}`: stable for the same subject (an entry id, a pair of
  // record ids, an account and month). It is also the dismissal key.
  id: string;
  kind: FindingKind;
  tier: FindingTier;
  // 3 to 9 words a grandparent understands: "Counted twice on two cards".
  title: string;
  // One plain sentence that says what happened to the person's money, then the
  // number: "This $7.84 purchase is on two cards. ..."
  summary: string;
  // The records behind it. Short ids are the 8 characters after the prefix.
  evidence: CheckupEvidence[];
  // The money the finding is about, in minor units, for ordering and for the
  // headline number ("$525.92 too much"). null when no amount applies.
  amountMinor: number | null;
  currency: string;
  // Newest evidence date (YYYY-MM-DD), for recency ordering.
  occurredOn: string | null;
  // Who it touches: person ids (the account owners, the people in the shares,
  // the plan row owners). Empty = the whole household or a shared account.
  personIds: string[];
  // The fix the app already has: a path the screen can open, or null.
  fix: { label: string; path: string } | null;
  // Said when fix is null: "No fix yet".
  fixNote: string | null;
  // Resurface key: a hash of the facts that make the finding true. A change in
  // the evidence changes it and brings a dismissed finding back.
  evidenceKey: string;
  dismissed: boolean;
}

interface CheckupEvidence {
  // "entry", "record" (a split expense or payment), "statement", "plan line",
  // "account", "fact": how the screen groups and icons the line.
  role: string;
  // The household's own description of it ("Singapore Airlines"), clipped.
  label: string;
  shortId?: string;
  date?: string;          // YYYY-MM-DD
  amountMinor?: number;
  currency?: string;
  accountName?: string;
  // One plain clause: "paid with the other card", "inside the 27 Aug settle-up".
  note?: string;
}
```

Tiers, as a person reads them:

| Tier | Word | Meaning |
| --- | --- | --- |
| `high` | "Needs fixing" | Every gate of its rule holds; the records themselves prove it. Same bar as an offered removal in the wrong-card review. |
| `check` | "Worth checking" | The premise holds but one soft gate fails, or the rule can only say "this does not add up", not why. Often fine. |
| `note` | "Good to know" | A tidy-up or a heads-up. Never urgent, never money at risk. |

Ordering: tier (high, check, note), then money size (`amountMinor`, largest
first, absolute), then recency (`occurredOn`, newest first), then id.

Scoping: findings are about the household's data. Optional `?view=<person id>`
keeps the findings that touch that person plus every finding with no person (a
joint account, the household plan). `household` or no param keeps all. It is
the existing view id; the scope control of the other pages is not needed
because a finding is not a sum of entries.

Caps: at most 50 findings per kind are returned (after ordering), with
`moreByKind[kind]` = how many more exist. `tierCounts` always counts every
undismissed finding, shown or not, so the headline never understates.

## Dismissal ("This is fine")

A person can mark a finding "This is fine". It never reappears for the same
evidence. If the evidence changes (another matching row appears, an amount
changes, the tier changes), the finding's `evidenceKey` differs and it comes
back.

Storage: `app_settings` rows, one per dismissal, key
`ledger_checkup:dismissed:<finding id>`, value `{ evidenceKey, kind, dismissedAt }`.
No new table, so no schema migration, no prod/demo migration ordering, and a
reader that finds nothing simply shows everything. Reasons for choosing it over
an additive table:

- the table already exists everywhere and is created on first use
  (`ensureAppSettingsTable`);
- one row per dismissal means two racing dismissals cannot lose each other (a
  single JSON list in one row would be read-modify-write);
- the keys are read with one primary-key range read
  (`key >= 'ledger_checkup:dismissed:' AND key < 'ledger_checkup:dismissed;'`),
  bounded by a cap of 500 dismissals (the command refuses past it).

Commands (`POST /api/ledger-checkup/dismiss` `{ id, evidenceKey }`,
`POST /api/ledger-checkup/undo-dismiss` `{ id }`): all-or-nothing, one
`db.batch()` of the upsert or delete plus an audit event
(`ledger_checkup_dismissed` / `ledger_checkup_dismissal_undone`). They validate
the id shape (a known kind prefix, at most 200 characters) and the evidence key
(hex, at most 32). Dismissing something that does not exist is harmless and
changes no finding.

## Performance budget

The check runs only when the person opens it. Budget on the 10k-transaction
fixture (`tests/support/large-household.mjs`):

- reads go out in at most 3 `db.batch()` round trips (independent reads, then
  the reads that depend on them, then cause reads for the few findings that
  need one), at most 25 SQL statements in all (counted by
  `tests/support/d1-counting.mjs`; a batch counts as one round trip);
- every statement is an indexed range or primary-key read (EXPLAIN checked) or
  a SQL `GROUP BY` over an indexed account or household scan that returns
  aggregates, never a whole table into the Worker; every list read has a date
  window (400 days; 180 for duplicate entries, 800 for transfers, 1,100 for
  split records) and a `LIMIT`;
- at most 250,000 rows read and 600 KB of row bytes; the detectors run over
  at most a few hundred facts each (measured on the 10k fixture: about 129,000
  rows, 51 KB, 40 ms);
- at most 400 ms median Node CPU for the whole check; payload at most 120 KB
  at 50 findings per kind in the worst case (a payload budget key
  `ledger-checkup`, 3,360 bytes at demo scale, in
  `tests/e2e/api-payload-budget.json`);
- no first-screen code: phase 1 adds no client file, so `check:bundle` is
  untouched.

A cold isolate costs nothing extra: the check does not touch the cold-start
path (`ensureDemoSchema`), and every table it reads already exists there. A
missing optional table (`ask_habits`, `import_wrong_card_duplicates`) is
tolerated, never an error.

## Detectors

Each detector is a pure function over bounded read models
(`src/domain/ledger-checkup/*.ts`), registered in one small list and run by one
runner over one shared loader, so two detectors never read the same rows twice.
A detector returns `CheckupFinding[]` and never throws on odd data: a record it
cannot read is skipped.

Common exclusions (every detector): deleted or archived records (split rows
with `deleted_at`, archived accounts), entries of an import that is not
`completed` (a draft or rolled-back import is not the ledger), and, where a
rule is about "not yet proven" entries, statement-certified entries (the bank's
own facts are never second-guessed here).

### 1. Wrong-card Apple Pay duplicate (`wrong_card_duplicate`)

The whole-ledger form of the import review's wrong-card rule
(`assessWrongCardDuplicates`, unchanged).

Candidate: provisional Apple Pay entry (Shortcut reference), never matched to a
bank row, expense, not a transfer, dated in the last 120 days (at most 60 are
weighed). Twin: a loose bank row on another card, same amount and currency,
within 3 days, sharing a shop word. Coverage: an earlier completed CSV import of
the entry's own card whose rows span the entry's date, imported at least the
card's posting lag after it. No file rows and no "listed" ids exist outside an
import, so the "this file" gates fall away and the earlier import's coverage is
the proof the card's own file should have listed it.

- `high`: the rule's HIGH (every gate: covered and old enough, no same-amount
  row on its own card, exactly one twin, twin not contested, dates within 2 days,
  strong shop match, no links, not an estimate, compatible owners).
- `note`: the rule's MEDIUM (the premise holds but a soft gate fails).
- silent: LOW.

Fix: none here. The fix lives in the Imports review, so the finding says "Load
that card's file again in Imports and it offers to remove it" with a link to
Imports. No removal button.

False positives: inherits every guard of docs/audits/wrong-card-apple-pay-
duplicate.md (daily repeats, two claimants, genuine same-amount purchases on
both cards, entries the file lists, linked entries, estimates, someone else's
card). The only new risk is the earlier import being an incomplete file for the
card; the window is read only around the entries, so it can only come out
narrower, and a card with no earlier import gives no coverage and no finding.

### 2a. Duplicate split expense (`duplicate_split`)

Two live split expenses (not deleted) with the same group (or both none), date,
total, currency and payer, neither covered by a settle-up (covered pairs belong
to detector 8).

- `high`: exactly one such pair in that key (no third record with the same key),
  one is manual (no ledger link) and the other is linked to a ledger entry,
  their shares are the same per person (a rounding cent allowed), and the
  Splits matcher (`findBestSplitExpenseMatch`: the exact amount and day on the
  payer's own or a shared account, or shared words) would put the manual record
  on the very bank row the other holds. The wording need not match: "Flights to
  Okaeri" and "SINGAPORE AIRLINES" is the real case.
- `check`: the same key with the matcher saying no, both unlinked with the same
  normalized description (a double entry), or two payments the same day for the
  same amount.
- silent: both linked to different ledger entries (two real bank rows: two real
  purchases), more than two with the key (a series), different shares with
  different words.

Evidence: both records (description, date, amount, payer, link state). Fix:
Splits, the group (delete the extra record). Person scope: the people in the
shares.

Why this is airtight: two bank-linked records cannot be a double entry because
each is a different bank row; a manual record plus a bank-linked record of the
same amount, day, payer and group with a shared word is the same purchase
entered twice, and the bank-linked one is the one with proof behind it.

### 2b. Duplicate ledger entry (`duplicate_entry`)

Two entries on the same account, the same transaction date, amount, currency,
entry type and direction, and the same normalized description
(`normalizeDescriptionForMatch`), neither statement-certified, neither an Apple
Pay or Ask entry (those pair through their own flow), neither in a transfer
group, neither linked to a split or plan row, not both from one import (a bank
file listing the same charge twice is the bank's own repeat), and exactly two in
the key.

- `high`: each came from a different completed import and their import rows have
  the same row hash (the same bank row imported twice; the importer normally
  skips this).
- `check`: anything else that passes the gates (for example a typed entry and an
  imported one). Two coffees on one day can be real.

Fix: open the entry in Entries (it can be deleted there; a certified one cannot).
Person scope: the account owner.

### 3. Unmatched transfer (`unmatched_transfer`)

A transfer entry dated more than 7 days ago with no transfer group, not dismissed
in the transfer review (`transfer_review_dismissed_at`), not linked to a split
settle-up or settlement check, on an account that is not an investment account
(those pair only through a statement import).

Counterpart search: the ranking the Entries transfer dialog uses
(`selectTransferCandidates`: same amount, another account, opposite direction
first, closest date), kept to 7 days either side (banks post a transfer within
days, and a monthly $450 has a lookalike every month), over entries not already
in a transfer group or held by a split. Only a plausible partner counts: an
opposite-direction transfer, or the same money filed the right way round as an
ordinary entry (money in for a transfer out, a purchase for a transfer in). A
purchase of a round amount next to a transfer out is a coincidence.

- `high`: exactly one plausible partner and it is an opposite-direction
  transfer. A pair is one finding whichever side finds it (its id is the two
  entry ids), and carries no money at stake: money between the household's own
  accounts misstates no total.
- `check`: exactly one ordinary partner (money that moved between accounts was
  filed as spending or income), or several plausible partners (listed, up to 3).
- `note`: no plausible partner. One finding per series (same account, direction
  and amount), counting the entries, so fourteen monthly transfers are one line.

Fix: the transfer dialog (`/entries?...&editing_entry=<id>`). Person scope: the
account owner (and the candidate's owner).

### 4. Statement gaps (`statement_gap`, `statement_join`)

Statements are certified statement checkpoints: an `account_balance_checkpoints`
row with a certificate from a completed import.

- `statement_gap`: for an account, two certified statements with whole months
  between them, where the ledger has entries on that account in a month with no
  statement (a calendar month strictly between the two statements' months), so
  that month's statement is missing (the Sep OCBC case). `high` when a recorded
  chain break (`statement_chain_breaks`) names the month, or the gap is exactly
  one month with at least 5 entries and the account's statements run monthly
  elsewhere (the two neighbours are consecutive months of at least 3 other
  statements). Otherwise `check`. A month with no entries is silent (a dormant
  account is not a gap).
- `statement_join`: for an account's last 8 proven statements, the ledger balance
  matched the earlier statement and does not match the next one although that
  one is not the latest (the balance chain broke at that statement and the
  ledger has not been fixed), only between consecutive months (a break after a
  missing month is the gap's finding). One finding per account, at the first
  month that differs, with the amount; `check` tier (the rule can say the
  opening does not continue the previous closing, not why). The latest
  statement's own difference is detector 6 (never both for the same statement).

False positives: quarterly or on-request statements (needs the monthly cadence
for `high`), an account that was empty for a month (needs entries), a statement
deleted on purpose (a rollback records a chain break and the finding says so).

Fix: Imports (upload the missing statement). Person scope: the account owner.

### 5. Stale estimate (`stale_estimate`)

A provisional foreign-currency estimate (`original_currency` set, expense, never
matched to a bank row: no import, not certified, no split or plan link) older
than the card's posting lag plus 14 days (lag: `derivePostingLagDays` from the
card's own Apple Pay history, 3 to 7 days).

- `high`: a completed import or certified statement of the same card covers the
  estimate's date (the bank listed that day and the estimate was not paired with
  any row: it may be counted twice, once here and once as a different row).
- `check`: no file of that card covers the date yet (the card's file may simply
  not have been loaded).

Fix: open the entry in Entries. Person scope: the entry owner or the account
owner.

### 6. Balance mismatch (`balance_mismatch`)

For each account, its latest certified statement: the ledger balance at the
statement's end date (opening balance plus signed entries cleared up to that
date, completed imports only: the same maths as `buildAccountHealth` and
`normalizeStoredStatementBalanceMinor`) against the statement balance. Reported
only when the statement was certified (a certificate with status `certified`,
so the ledger matched when it was proven) and the ledger no longer matches. An
account whose first difference is an earlier statement is detector 4's
`statement_join`.

- `high`: the difference is exactly the sum of entries created after the
  certificate (more than a minute later) and dated inside the period: the
  entries added since are named.
- `check`: the ledger moved since the proof but no set of later entries explains
  the amount exactly (an edit or a removal). The summary says so and points to
  the statement comparison.

Amount: the difference. Fix: Settings statement comparison. Person scope: the
account owner.

### 7. Plan problems (`plan_overspent`, `plan_line_unpaid`, `plan_line_no_category`)

For the current month and the next:

- `plan_overspent`: planned spending (bills, dated payments and the monthly
  budget lines, savings included) exceeds the income the plan expects by more
  than `max(PLAN_SHORTFALL_MINOR, 2% of income)` (the Money insights To do's own
  constants), with income above zero. `check`. The amount is the shortfall.
- `plan_line_unpaid`: a dated bill whose date has passed, planned amount above
  zero, no entry linked and no actual, with exactly one unlinked expense of the
  same amount within 10 days of the date (same category when the line has one)
  not already linked to another plan line: `check`, naming the entry. With
  several such entries: `note`, naming how many. With none: silent (the
  payment may simply not have happened; Money insights already says so).
- `plan_line_no_category`: a plan line with money in it and no category: `note`.

Fix: Month (`/month?view=household&month=YYYY-MM#month-plan`). Person scope: the
line's owner for the per-line findings; the whole household for overspent.

False positives: a deliberately overspent plan is a `check`, never `high`; the
payment candidate rule is a strict subset of the Month link dialog's own reasons
(same amount, near the planned date, same category), proved by a test that runs
the dialog's scorer over the same rows.

### 8. Settled-period error (`settled_period_error`)

The detector 2a pair rule applied where at least one record sits inside a
settle-up (an active settlement checkpoint or a closed group batch), and the
settle-up itself is wrong because of it.

- `high`: both records are settled-covered and the pair passes detector 2a's
  `high` gate (exactly one pair for the key, one manual and one bank-linked,
  the Splits matcher agrees, shares agree): the settled balance counted the
  purchase twice. The effect names each person (their share of the extra copy,
  for the non-payers): "Joyce was charged $525.93 too much".
- Also `high` (the production shape): a copy deleted after the settle-up
  counted it. An active settle-up (not reopened or voided) still lists a
  deleted record, exactly one live record has the same group, day, amount,
  currency and payer, the same settle-up holds that one too, and the shares
  agree: the purchase was in twice and one copy was removed afterwards, so the
  settled balance still holds both. Without a provable twin it is a `check`.
  (The app refuses to delete a record a settle-up holds, so this only comes
  from a data fix after the fact.)
- `check`: one record covered and the other open, or a covered pair that fails a
  `high` gate. Its effect is stated the same way.
- silent: as detector 2a, and a shared cost nobody but the payer shares (no
  balance moved).

Fix (phase 3, built): `Correct this settled mistake`, a Split Correction in the
open period (docs/proposals/settled-correction.md), for an extra expense the
settle-up held where exactly one other person was charged. A live correction
resolves the finding (it is silent) and it is reported again if the correction
is undone. Otherwise (two payments counted twice, three people charged, an
extra copy the settle-up did not hold) the finding still says "No fix yet".
Person scope: the people in the shares.

### 9. Data hygiene (`other_category`, `odd_entry`, `quiet_account`)

- `other_category` (`note`): an expense in the catch-all `Other` category older
  than 60 days for which the household's own category rules, or an Ask habit
  with high confidence, name another category. Never a words or history guess.
  Fix: open the entry.
- `odd_entry` (`check`): an entry whose amount is 0, or whose date is more than
  14 days ahead of today. Fix: open the entry.
- `quiet_account` (`note`): an active bank or card account that has had entries
  but none for 90 days or more. Fix: Settings (the account), or none.

## API

`GET /api/ledger-checkup[?view=<person id|household>][&dismissed=1]`
`{ ok, generatedAt, tierCounts: {high, check, note}, kindCounts, dismissedCount, findings[], moreByKind, incompleteKinds, unavailableKinds }`

`kindCounts` is the same count for each kind. `incompleteKinds` names kinds whose
read hit its limit (there may be more than counted). `unavailableKinds` names
kinds a detector could not be run for (a bug, never data).

`POST /api/ledger-checkup/dismiss` `{ id, evidenceKey }` and
`POST /api/ledger-checkup/undo-dismiss` `{ id }` return `{ ok, id }`.

Both use the cross-site guard, `readJsonObject`, and sit behind Access like the
rest. Nothing else writes.

## Plain-words rules for phase 2's copy

Titles and summaries are written by the detectors in the grandparent wording
rules of AGENTS.md ("say what happened to the person's money, then the number";
no "unlinked", "provisional", "certified", "checkpoint", "settlement check"):
statement for a checkpoint, "settle-up" for a settlement, "waiting for the
bank's record" for provisional. A lint test runs every sentence through the
retired-names and app-jargon lists.
