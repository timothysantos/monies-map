# Velocity rule audit (2026-10-03)

Question: the velocity rule (DOMAIN.md, "Velocity Rule", added 2026-05-01 in
f36c247) keeps repeated small purchases apart by giving rows under $5 a
2-day match window and everything else 7 days. Is "under $5" the right test
for "this charge repeats"? The alternative measured here keeps the same two
windows but chooses by repetition: 2 days when the same card has another
charge of the same signed amount with lookalike wording within 7 days,
otherwise 7 days.

Reproduce: `npx tsx scripts/audit-velocity-rule.mjs` (read only). It parses
every real-structure bank file in `tests/fixtures` (19 files with rows, 246
rows; most from the two UOB card exports of 6 May 2026) and uses the app's
own date lanes and wording rules (`statement-row-matching.ts`).

## Results

| Rows | Count | Today | By repetition | Examples |
| --- | --- | --- | --- | --- |
| Under $5, repeats | 9 | 2 days | 2 days | BUS/MRT at the same fare, MA MUM |
| Under $5, one-off | 26 | 2 days | 7 days | FX and service fees, interest, Cloudflare, Apple, single bus fares |
| $5 and over, repeats | 58 | 7 days | 2 days | OpenAI ($7.22, up to 15 a day), PayNow transfers, Ajummas, TORI-Q |
| $5 and over, one-off | 153 | 7 days | 7 days | Grab, Shopee, M1, airline, bookstore |

- Distinct real purchases in one file that a rule would let count as one
  purchase: 388 today, 274 by repetition. The 114 removed are lookalikes 3 to
  7 days apart (OpenAI, Ajummas at 7 days, TORI-Q at 4, a PayNow at 3).
- The 274 left are within 2 days, almost all OpenAI charges on the same or
  next day. No date window can separate identical same-day charges; the
  one-entry-one-row, closest-day pairing does.
- Posting delay where both dates are known: repeating $5+ rows post at most
  2 days late (median 1), so a 2-day window loses no observed true match.
  Repeating fares post a median 4 days late, as before; their purchase date
  is printed, so they are compared on it. One-off under-$5 rows post up to
  6 days late, so the old 2-day window could miss their true match when one
  side has no purchase date (10 such rows: fees, interest, Apple, Cloudflare).

## Limits

- 246 rows, dominated by one person's two UOB cards and OpenAI charges.
- Real-statement PDF fixtures scale amounts by a per-file factor, which
  moves rows across the $5 line; the repetition test is unaffected.
- Sanitized files do not share amounts across sources, so no end-to-end
  pairing between two files was measured: these are window decisions,
  false-pair opportunities and posting delays, not final import outcomes.

## Decision

Approved by the owner and implemented on 2026-10-03: the velocity rule
keeps its intent and its two windows, and its test is now repetition
(`createRepetitionIndex` in `src/domain/statement-row-matching.ts`), used by
the import preview, confirmed-statement coverage, the statement mismatch
diagnosis and Settings "Compare statement". Reference numbers such as a
BUS/MRT trip number are ignored when comparing wording, so a commute at one
fare counts as repeating; the first run of this audit, before that, counted
only 5 of those fares as repeats. The table above is the rerun with the
app's own test.
