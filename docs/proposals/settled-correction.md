# Correct a settled mistake (Split Correction)

Status: built (phase 3 of the Ledger check-up). Vocabulary: DOMAIN.md "Split
Correction". Flow: `docs/flows/splits-flow.md`, "Correct a settled mistake".
The check-up side: `docs/proposals/ledger-checkup.md` detector 8 and
`docs/audits/ledger-checkup.md`.

## The problem

A shared cost (a flight) was entered twice in one group. Both copies were
covered by one settle-up (a simplified settlement, matched to the bank).
Afterwards the extra copy was archived. The settle-up still holds both, so the
second person paid her share of the extra copy: $525.93 too much.

Nothing in the app corrects it:

- a settled record is locked: an edit or delete is refused ("undo the settle-up
  first");
- undoing the settle-up is heavy (it may be paid and matched to a bank
  transfer) and the mistake is one record;
- the balance reads only the open period, which does not hold the settled
  records, so the overpayment is in nobody's balance.

## Decision

A **Split Correction** is a record in the group's current (open) period that
carries the exact amount the settled period over- or under-charged. It moves
the balance (who owes whom) and nothing else: it is not spending. The
settle-up is never touched.

### The model: a flagged payment record, not a new table

Considered:

1. A new `split_corrections` table read by the balance and the activity list.
   Rejected: every balance reader would need a second source (the Splits page,
   Ask's balances, the skew check, the next simplification, Settle group), the
   settlement lock and the simplification's list of records
   (`split_settlement_checkpoint_items.record_kind` is `CHECK (... IN
   ('expense', 'settlement'))`, which SQLite cannot widen without rebuilding the
   table) would not know it, and Undo settle-up would not move it.
2. A flagged **expense**. Rejected: it would have to be excluded from the chip,
   the donut, the fun facts, the "You paid for N%" insight and the Entries
   figure rules, each a place to forget.
3. **A flagged payment (`split_settlements` row).** Chosen. A payment already
   is "a record that moves a balance between two people without being
   spending", and every projection that matters already reads payments the
   right way:
   - the balance (`buildSplitsPage`) and Ask's `get_split_balances` count open
     payments, so the correction is in who owes whom;
   - the next simplification (`planSplitSettlementCheckpoint`) and Settle group
     take every open record of the group, so the correction is in the next
     settle-up and is locked by it (the settlement lock reads payment facts
     already);
   - the chip, donut, "Spent since last settle-up", the fun facts that add up
     costs and the insight read only expenses, so a payment is never spending;
   - history (`split_activity_history`) and `deleted_at` archiving exist.

   What a payment also does that a correction must not: be offered a bank row,
   be edited as a payment, be counted among "settle-ups" in the fun facts, be
   read as a duplicate payment by the check-up, or name the archived batch's
   settle-up. Each of those is one filter, listed under "Projections touched".

A correction runs **from the person who was charged too much to the person who
was paid too much**. In the owner's case: Joyce (charged too much) to Tim.
That is the sign a payment already has in the balance: a payment from X to Y
raises X's credit, so Tim now owes Joyce her share.

### Storage and migration

Two nullable columns on `split_settlements`, additive, no foreign key:

| Column | Meaning |
| --- | --- |
| `correction_source_id` | the split expense whose settled effect the row corrects; NULL on every ordinary payment |
| `correction_reason` | the plain-words label shown in the activity list ("Correction: ...") |

`schema.sql` has them in `CREATE TABLE`; `ensureDemoSchema` adds them to a
database that predates them from the `PRAGMA table_info(split_settlements)` it
already reads (no extra round trip; `SPLIT_CORRECTION_COLUMN_STATEMENTS`).
Process (AGENTS.md): export the production D1 to the scratchpad (never
committed, deleted afterwards), run the two `ALTER TABLE` statements on
production and on demo **before** the code is deployed, then deploy. Existing
rows keep NULL, so every figure is unchanged (persisted-state snapshot
identical). No index: the check reads the few live corrections with one
`correction_source_id IS NOT NULL` filter on a table of a few hundred rows.

## What it records

The amount and the people are **never typed**. The server works them out from
the same facts the check-up's settled-period detector reads
(`planSettledCorrections`, `src/domain/ledger-checkup/split-duplicates.ts`), so
a correction is only ever offered for a finding the detector reports:

- the source is the extra expense: the deleted copy the settle-up still holds
  (`deleted:` finding), or the hand-typed copy of a pair the settle-up counted
  (a live extra);
- the settle-up holds the source (a simplified settlement not reopened or
  voided, or a closed group batch);
- exactly one other person was charged (the balance is between two people):
  the amount is that person's stored share of the extra copy, in the group's
  own currency, to the cent (a rounding cent between the copies is what the
  stored shares say, whichever way round);
- no live correction already names the source.

Two payments counted twice, a cost nobody else owes, three people charged, and
a pair whose extra copy the settle-up did not hold (deleting it in Splits is
the fix) get no correction (`fix` stays null, "No fix yet").

## The action

Entry points (both open the same dialog):

- the finding's fix: `Correct this settled mistake`, a link to
  `/splits?view=household&month=<this month>&split_group=<id>&correct_settled=<expense id>`;
- the read-only card of a settled shared cost (its lock notice, next to Undo
  simplification / Undo settle-up), only when the check-up flags that cost: one
  `GET /api/splits/corrections/preview` when the card opens.

The dialog (`src/client/split-correction-dialog.jsx`) says what happens in
plain words with the amount the server worked out, offers an optional reason
and, when the extra copy is still in the list, "Also remove the duplicate":

> This adds a $525.93 correction in Joyce's favour to the current period. The
> 27 Aug settle-up stays as it is.

`Add correction` / `Cancel`. Undo is on the correction's row in the open
period (`Undo correction`).

### API

| Route | Does |
| --- | --- |
| `GET /api/splits/corrections/preview?sourceRecordId=` | what a correction would record, or why none can be (`eligible`, `reason`, `code`) |
| `POST /api/splits/corrections` `{ sourceRecordId, alsoRemoveDuplicate?, reason? }` | adds it; 400 `correction_not_found` (404), `correction_not_flagged`, `correction_not_settled`, `correction_exists` |
| `POST /api/splits/corrections/undo` `{ correctionId }` | archives it while open; 409 `split_settlement_locked` once a settle-up covers it |

All-or-nothing (`app-repository-split-corrections.ts`): the plan is read and
checked first; then the correction row (in the group's open batch, planned with
the batch insert if there is none), the optional archive of the extra copy, the
history events, the audit event (`split_correction_created` /
`split_correction_undone`) and the linked-entry month refresh markers (only
when the removed copy is linked to an entry) commit in one `db.batch()`, behind
a guard that fails the whole batch when a live correction for the same source
exists. A guard failure answers `correction_exists`.

The extra copy stays in the settle-up's list of records (it is a fixed
manifest); only `deleted_at` is set, as the owner's own archive did.

## Integration

| Place | Behaviour |
| --- | --- |
| Open period / lock | The correction joins the group's open batch. It is editable only by Undo while open; once a simplification or Settle group covers it, the settlement lock refuses Undo (`split_settlement_locked`, naming the settle-up). |
| Splits balance, Ask balances, skew check | Counted (they read open payments). |
| Next simplification / Settle group | Included: who pays whom includes it (`tests/settled-correction.test.mjs`). `planSplitSettlementCheckpoint` counted a payment **to** the viewer with the wrong sign (as if it added to what the other owes); it is fixed to match the balance, and has its own regression test. |
| Chip, donut, entry figures, insight, fun facts | Not counted: a payment is not an expense; the "settle-ups" fun-fact count skips corrections (`split-group-facts.ts`, `split-settled-history.ts`). |
| Activity list | A row with the label, "In Joyce's favour", the amount and "Undo correction"; not openable, never "Linked"/"Manual split". |
| Match review | Never offered a bank row (`buildSplitMatchCandidates`, the awaiting-match scope). |
| Edit, note, link, delete, restore | Refused with a plain message (a correction is undone, not edited; an undone one is added again from the check-up). |
| History | "Correction added" / "Correction undone"; never offered Restore. |
| Hidden money | The amount in the dialog, the row and the balance follow the money-privacy formatters. |
| Check-up | The finding is silent while a live correction names its source, and is reported again if the correction is undone (`correctedSourceIds`). The duplicate-payment detector skips corrections. |

## Budgets

- First-screen JS: unchanged. Everything is in the lazy Splits route
  (`use-split-correction.jsx`, `split-correction-dialog.jsx`, copy in
  `copy/en-SG-splits.js`); `scripts/initial-bundle-budget.json` not raised.
- Page payload: a correction row appears only when one exists; the demo
  payloads are unchanged (`tests/e2e/api-payload-budget.json`).
- Splits page reads: the balance read gained two selected columns; no new
  statement (`tests/page-load-scale-guard.test.mjs`).
- Cold start: no new round trip (the column repair reads the existing
  `PRAGMA table_info(split_settlements)`).
- Check-up: one more statement in its first round trip (the live corrections),
  inside `tests/ledger-checkup-budget.test.mjs`. The correction's own plan and
  command read the split facts in one batch of five statements
  (`loadSplitPairFacts`), only when a person opens or adds a correction.

## Strings

See the "Strings" list in the change's report; all live in
`src/client/copy/en-SG-splits.js` under `correction`, plus the server's
refusal messages (`app-repository-split-corrections.ts`) and the labels
`Correction: <what> on <date> counted twice in the <date> settle-up` /
`... removed after the <date> settle-up`.

## Not built

- A correction for three or more people charged (the balance is between two).
- A correction for two payments counted twice (no cost to correct).
- Editing a correction (undo and add again).
- Restoring an undone correction from History (add it again from the check-up).
