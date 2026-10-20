# Settled records fold away at the end of the Splits list

Owner request (approved): "for splits there was an earlier settlement,
correct? I think it should be in archive or collapsed."

Production had one settlement checkpoint (27 Aug, matched to the bank)
covering 352 split expenses, 287 of them in Okaeri. The open period already
left them out of the balance, the chip, the donut and the entry count, but
the activity list still showed them mixed in with the open ones.

## What changed

- The activity list shows only open records. What a checkpoint covers (the
  open period's own rule, `partitionActivityBySettlement` in
  `src/domain/split-open-period.ts`: any status but `reopened` or `voided`)
  sits in one collapsed section per settlement at the end of the list:
  "Settled up on 27 Aug · 287 entries · $28,823.06". Opening it shows the
  rows, which keep the read-only settled card (reason and Undo on top).
- Rows render only while a section is open (287 rows stay out of the DOM).
- A search narrows both parts and opens every section with a match, so a
  settled record is never unfindable. The section holding an open inline
  card, and View included activity, open theirs.
- Hidden money shows the section's amount as dots and keeps the count.
- Archived batches lists each settlement above the closed batches; choosing
  it closes the sheet and opens the section in place. The trigger reads
  "1 earlier settle-up" (or "2 settled batches · 1 earlier settle-up").

## Decision: collapsed in the list, and listed in the archive

A collapsed row at the end of the list keeps the records where people look
for them (a grandparent does not have to know what a "batch" is to find last
month's dinner), and the archive entry gives "everything settled" one place.
The archive row opens the section instead of showing a second copy of the
rows, so there is one place the rows live and one read-only behaviour. A
closed batch (Settle group) is unchanged: its rows stay in the archive
sheet, because Settle group already moves them out of the list.

A checkpoint still waiting for its payment (`open` or `partially_matched`, not
marked paid) is headed "Simplified on 20 May", the lock notice's own word, so
the list never says "Settled up" before anyone paid.

The section total is not openable: it adds split expense totals, which no
Entries list totals to the cent (cash splits have no ledger entry, a linked
one can differ in currency), so a View entries menu would break the
openable-figures rule.

## Strings

New:

- "Settled up on 27 Aug · 287 entries · $28,823.06" (section heading; "27 Aug
  2025" when not this year; amount "••••" when money is hidden)
- "Simplified on 20 May · 4 entries · $1,000.00" (payment not made yet)
- Archive row title "Settled up" / "Simplified, not paid yet"
- Archive row line "You paid Joyce $7,082.17 for every group", "Tim paid you
  …", "Tim pays Joyce … for every group" (not paid yet), "Nothing to pay: the
  groups evened out" (internally offset)
- Archive trigger "1 earlier settle-up" / "N earlier settle-ups", joined with
  " · " after "N settled batches"

Changed:

- Archive sheet description "Closed settle-up batches stay here as muted
  history." -> "Settled batches and earlier settle-ups stay here."
- Simplified settlement hint "Included rows are marked in the timeline
  below." -> "Included rows are tucked away at the end of the list below."

## Payload (first slice, superseded below)

The page payload did not change in the first slice (no server change):
`/api/splits-page?view=person-tim&month=2025-10` on the demo seed is 8,049 B
raw (budget 8,175), 1,695 B gzip. With an 8-expense matched settlement added
it is 21,517 B raw / 2,863 B gzip, of which the 12 checkpoint-covered items
are 13,317 B raw (61.9%): about 1.1 kB raw per covered item, so production's
352 covered items are roughly 390 kB raw (far less gzipped).

Sending only open rows plus a per-settlement summary would cut that, but the
page reads the settled rows for three things: the Just for fun lines, which
deliberately describe the whole group ("settled or not"), the search that
must find settled records, and the read-only card's lock. Moving those to the
server is a separate change, so it is not in this slice; it is the natural
follow-up if the Splits page load is measured as slow.

## Settled rows load on demand (2026-10-20, owner approved)

The follow-up above, done. The Splits page now sends the open records, one
summary per settlement and group (the heading's count, total, date and paid
state), and for a group with a settled section its whole-group facts (the
counts the Just for fun lines read), both grouped in SQL. A section's rows
load when it is opened; a search asks the server for the group's settled
matches; a deep link to a settled expense reads its section first. Flow,
endpoints and caching: `docs/flows/splits-flow.md`, "Settled sections load
on demand".

### Numbers

Same requests before (origin/master c691ff75) and after, local Worker and D1:

| Fixture | Before | After |
| --- | ---: | ---: |
| Demo, nothing settled (`view=person-tim&month=2025-10`, the payload budget's `splits-page`) | 8,049 B | 8,049 B (no new keys while nothing is settled) |
| Demo plus an 8-expense settlement (`splits-page-settled`, new budget key) | 20,914 B | 10,529 B |
| Production-shaped: 352 settled records (287 in one group, half linked to a bank row), 10 open, on the demo seed | 342,545 B raw / 19,538 B gzip | 19,515 B raw / 3,219 B gzip |
| Same, on the 10k-transaction scale fixture | 391,553 B raw / 19,825 B gzip, 20 round trips | 20,873 B raw / 3,315 B gzip, 22 round trips |

The settled part of the production-shaped page is now 333 B of summaries
and 2,082 B of facts for its two groups, plus 289 B of checkpoints (their
352 record ids, 8 kB, stay on the server). The synthetic rows repeat a lot,
so the gzip "before" understates production's.

On demand, production-shaped, 10k fixture: the 287-row section is 297,337 B
raw / 13,579 B gzip in 8 round trips, 69 ms median handler; a search
("sushi", 12 matches) 12,607 B raw in 8 round trips, 67 ms.

The Splits page handler took 2.4 s before and 2.3 s after on the 10k fixture.
Both are almost all the bank-match suggestion scan (`loadSplitMatchCandidates`
~2.1 s alone: every unlinked split record, settled or not, against every
imported row in their date windows). That scan is unchanged here and is the
next thing to look at if the Splits page is still slow on the server.

### How the numbers stay the same

`tests/splits-settled-lazy.test.mjs` builds the old page (the full
projection over every record, as the page was built before) beside the new
one on the demo seed plus the production-shaped history, a closed batch and
an unpaid JPY simplification, for the household and both people, and checks:
the page's rows are the old page's minus the settled ones; tiles, balances,
counts and match suggestions are equal; each section summary equals the old
section's count, total, date, paid state and currency; each section's lazy
rows equal the rows the old page sent (lock and Undo data included); the
chip, its label and the donut are equal; the facts equal the old activity's;
and every check-in line (balance, share of costs and all Just for fun lines)
equals the old code's word for word (`tests/support/splits-signals-before.ts`
is the old module, frozen). A random test compares the old and new check-in
lines on 300 random groups (ties, mixed currencies, zero amounts, unreadable
names, settled records).

### Strings

None new. Loading uses "Loading..." with the app spinner; a failed read
uses "We couldn't reach your data just now." and "Try again" (existing
strings). Screenshots: `after-lazy-loading-desktop.png`,
`after-lazy-loading-phone.png`, `after-lazy-error-desktop.png`,
`after-lazy-error-phone.png`.

## Screenshots

Demo data plus a group mirroring production: 8 older expenses covered by a
bank-matched settlement on 27 Aug, 2 newer open ones.

- `before-desktop.png`, `before-phone.png`: settled rows mixed into the list.
- `after-desktop.png`, `after-phone.png`: open rows, then "Settled up on
  27 Aug · 8 entries · $1,221.20".
- `after-desktop-expanded.png`, `after-phone-expanded.png`: the section open.
- `after-desktop-archive.png`, `after-phone-archive.png`: Archived batches
  listing the settlement.

## Not affected

Splits History (deleted and restored records) and Ask's answers read their
own data and did not change; the chip, balance, donut and entry count already
read the open period.
