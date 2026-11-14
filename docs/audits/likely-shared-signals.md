# Likely shared: signals that need no shop history (measured, not built)

Date: 2026-11-14. Outcome: **nothing built.** No rule reached the 85%
precision bar on held-out data, so the Splits page, Ask and Apple Pay are
unchanged and "Usually shared" still comes only from a shop's own habit
(DOMAIN.md "Usually Shared", "Split Suggestion").

## Question

"Usually shared" found 1 entry on the owner's data because most shared
entries are at shops with no earlier history. Could a deterministic rule that
does not need the shop's history ("likely shared") suggest those, at 85% or
better precision with useful recall, as a suggestion only?

## Data (read-only on production, counts only)

- Expense entries of the two Splits people, amount above zero, from
  2026-04-01 (the first month with any split) to the last date with a split
  (2026-10-30): 2,078 entries, 530 on Splits (25.5%).
- Label: on Splits (an active split linked to the entry) or not.
- "New shop": no entry by the same owner at the same normalised shop
  (`normalizeDescriptionForMatch`) in the 365 days before.
- Rates (category, account, account and category, owner and category) were
  learned only from entries before the test window.
- Splits are added in catch-up sessions (early July, late August, mid
  October, 13 November); the second half of October had only 4 of 41 on
  Splits against about 25% elsewhere, so some late-October "not shared"
  labels are probably still undecided. Every figure is given for two cuts:
  A = the prescribed hold-out, the last 6 weeks up to the last split
  (2026-09-18 to 2026-10-30, 341 entries, 68 shared; new shops 209, 41
  shared), and B = the last 6 weeks up to the middle of October
  (2026-09-03 to 2026-10-15, 479 entries, 125 shared).

## Hold-out precision and recall per signal

Precision = shared among the entries the signal picked; recall = picked
among all shared.

| Signal (threshold) | A: picked, precision, recall | A new shops: precision | B: precision, recall |
| --- | --- | --- | --- |
| Category's own shared rate >= 50% (8+ entries) | 38, 50%, 28% | 64% | n/a |
| Category's own rate >= 60% | 4, 100%, 6% | 100% (2 entries) | n/a |
| Owner and category rate >= 50% | 50, 46%, 34% | 55% | n/a |
| Paying account's rate >= 50% (no account reaches 60%) | 53, 36%, 28% | 46% | n/a |
| Account and category rate >= 60% (6+ entries) | 31, 61%, 28% | 83% | 70%, 26% |
| Account and category rate >= 80% | 27, 59%, 24% | 80% | 71%, 23% |
| On a trip or event whose other entries are >= 50% shared | 39, 59%, 34% | 75% | 49%, 65% |
| Same trip, >= 60% shared | 16, 0% | 0% | 0% (16 picked) |
| Same-day neighbours >= 50% shared | 37, 41%, 22% | 46% | 52%, 35% |
| Same-day neighbours >= 70% shared | 1, 0% | 0% | 0% (7 picked) |
| On any trip, travel / food / taxi / groceries only | 33, 67%, 32% | 87% | 53%, 57% |
| Account and category >= 70% and amount >= $10 | 15, 80%, 18% | 91% (11 picked) | 83%, 19% |
| Account and category >= 80% and amount >= $10 | 13, 77%, 15% | 89% (9 picked) | **88%, 17%** (24 picked) |

Shared rate by other single signals (learned window): amount under $10 8%,
$10 to $30 32%, $30 to $100 50%, $100 to $300 29%, over $300 37%;
weekday 26%, weekend 29%. Evening could not be tested: only 34 of 2,078
entries carry a time of day. No trip or event is linked to a split group,
so "follows a split group" never fires; the two trips have no currency.

## Check over time

The one rule that reached 85% (account and category >= 80%, amount >= $10)
did so only on cut B. A rolling check over four back-to-back 6-week windows,
each learning only from what came before:

| Rule | Cut B windows: precision, recall | Cut A windows: precision, recall |
| --- | --- | --- |
| Account and category >= 60%, amount >= $10 | 66%, 10% | 47%, 9% |
| Account and category >= 70%, amount >= $10 | 65%, 9% | 46%, 8% |
| Account and category >= 80%, amount >= $10 | 64%, 8% | 44%, 7% |
| Account and category >= 80%, 10+ entries, amount >= $10 | 85%, 5% (26 picked) | 47%, 3% |
| Owner and category >= 70%, amount >= $10 | 62%, 21% | 58%, 8% |

Window by window the same rule ranged from 28% to 100%. Which card the
household uses for shared spending changes over the months, so a learned
card-and-category rate does not hold up.

On the owner's 90 entries since 2026-10-16 that are not on Splits (the ones
a suggestion would be for), the best-looking rule would suggest **0**.

## Decision

Nothing passes 85% on the prescribed hold-out, and the one pass on the other
cut does not survive the rolling check and suggests nothing today. As agreed
beforehand, nothing visible was built: no new rule, list rows, wording, Ask
or Apple Pay change, and no new stored fact.

What would change the answer: a trip or event linked to its split group (the
"follow" rule already puts those entries on the trip, and a linked trip's
entries could then be suggested from the trip itself), or time of day on most
entries. Worth measuring again after a few months of linked trips.

The analysis scripts were run from a scratch folder against the production
database with SELECT only; no shop or person names, account numbers or
entries are kept in the repository.
