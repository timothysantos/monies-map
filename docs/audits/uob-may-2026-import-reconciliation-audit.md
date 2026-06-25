# UOB May 2026 Import Reconciliation Audit

Date: 2026-06-22
Updated: 2026-06-25

## Scope

This audit covers the May 2026 UOB credit-card PDF import mismatch reported on
the Imports page for:

- UOB One Card
- UOB Lady's Card

It also covers the import-preview reset after a background `/api/imports/preview`
failure and the UOB dual-date PDF parser behavior.

## Production Data Access

Direct production D1 inspection is available through Wrangler:

```bash
npx wrangler d1 execute monies-map --remote --command "..."
```

The deployed app HTTP APIs are still protected by Cloudflare Access and return
`302` redirects to the Access login flow from an unauthenticated shell. For this
audit, the production investigation used read-only D1 queries plus the local PDF
parser. No production writes were made during the investigation.

## PDF Parser Findings

The attached May 2026 UOB card PDF parses successfully as
`uob_credit_card_pdf`.

Parsed statement checkpoints:

| Account | Period | Statement balance |
| --- | --- | ---: |
| UOB One Card | 2026-04-13 to 2026-05-12 | 218.11 owed |
| UOB Lady's Card | 2026-04-13 to 2026-05-12 | 301.95 owed |

Parsed statement rows:

| Account | Rows | Expenses | Credits | Net statement movement |
| --- | ---: | ---: | ---: | ---: |
| UOB One Card | 93 | 1,036.14 | 1,107.10 | +70.96 |
| UOB Lady's Card | 46 | 746.25 | 621.92 | -124.33 |

The UOB dual-date behavior is correct:

- the row `date` is the PDF post date
- the event date is preserved in `note` as `txn date: YYYY-MM-DD`
- certification can later store the event date as `transaction_date` and the
  post date as `post_date`

This means the mismatch shown in the screenshot is not caused by the May PDF
parser losing UOB event/post dates.

## Screenshot Reconciliation Facts

The screenshot showed these account-level differences:

| Account | Statement owed | Ledger owed | Difference |
| --- | ---: | ---: | ---: |
| UOB One Card | 218.11 | 478.78 | 260.67 |
| UOB Lady's Card | 301.95 | 353.99 | 52.04 |

Given the parser results above, these differences are ledger projection gaps:
the preview's existing production ledger state added more owed balance than the
official statement for both accounts.

The exact row causes could be one or more of:

- existing manual ledger rows inside 2026-04-13 to 2026-05-12 that are not on
  the PDF
- rows mapped to the wrong UOB card account
- skipped or needs-review PDF rows whose signed total explains the difference
- row direction mistakes, especially payments or credits
- provisional mid-cycle import rows that the official PDF can supersede

The new reconciliation breakdown UI lists these row groups directly in previews.

## 2026-06-25 Production/PDF Follow-up

The May PDF and the production D1 rows were compared using:

- the parsed May UOB PDF rows
- production rows for Tim's UOB One Card and UOB Lady's Card where either
  `transaction_date` or `post_date` falls inside 2026-04-13 to 2026-05-12
- the app's description-normalization helper for merchant comparison

Findings:

| Result | Count |
| --- | ---: |
| Parsed PDF rows | 139 |
| Production ledger rows read | 138 |
| PDF rows with a production ledger counterpart | 137 |
| PDF rows without a production ledger counterpart | 2 |
| Production ledger rows not proven by the PDF | 1 |

UOB One Card:

- all 60 `OPENAI OPENAI.COM` PDF rows have production ledger counterparts
- the earlier diagnostic that listed repeated OpenAI rows as unmatched was a
  matching allocation bug, not a PDF absence
- two PDF rows did not have production ledger counterparts and should be added
  by the statement import:
  - `2026-05-05` transaction / `2026-05-06` post,
    `Buyandship Limited Hong Kong`, `13.13`
  - `2026-05-05` transaction / `2026-05-09` post,
    `BUS/MRT 847589739 SINGAPORE`, `3.94`

UOB Lady's Card:

- the PDF row shown by the user, `2280 SINGAPORE`, is `23.50`, transaction date
  `2026-04-14`, post date `2026-04-15`
- production already has a matching CSV provisional row for that PDF row:
  `2280 SINGAPORE SG`, `23.50`, transaction date `2026-04-14`, post date
  `2026-04-15`
- the remaining unproven production ledger row is a different manual row:
  `2280`, `30.70`, transaction date `2026-05-12`, no post date

Actionable reconciliation report:

- UOB One Card should reconcile after the repeated-row matcher fix; the OpenAI
  rows should certify existing ledger rows and the two statement-only rows above
  should import as new official PDF rows.
- UOB Lady's Card should reconcile after deleting or otherwise correcting the
  manual `2280` `30.70` row if it is not real activity for this card's May PDF.
  It is not the same row as the PDF's `2280 SINGAPORE` `23.50` charge.

Root cause:

The preview matcher ranked and truncated candidate ledger rows before removing
ledger rows already claimed by earlier PDF rows. With repeated same-merchant
same-amount rows, later PDF rows only saw the already-claimed first three
candidates and were incorrectly reported as unmatched. Exact duplicate
suppression had the same claimed-row issue. The fix makes both matching paths
claim-aware before ranking and truncation.

## Product Changes Added

The Imports page now exposes a statement mismatch diagnostic for each
reconciliation account:

- prior ledger balance
- existing ledger rows inside the statement period
- included PDF rows
- matched PDF rows that will certify existing ledger rows
- skipped or needs-review PDF rows
- superseded provisional ledger rows
- likely causes and row samples to inspect first

Background statement-preview auto-refresh is now non-destructive. If an idle
refresh fails with a transient server error, the current reviewed preview stays
visible and the user sees an error status instead of losing the workflow state.

## Tests Added

- UOB credit-card PDF parser preserves post-date and event-date lanes.
- Statement preview auto-refresh failures preserve the current preview.
- Statement mismatch preview returns balance-breakdown diagnostics from the
  preview API.
- Repeated UOB PDF card rows can certify more than three matching provisional
  ledger rows without starving later rows.
- Statement mismatch hover explanations do not move the page scroll position.
