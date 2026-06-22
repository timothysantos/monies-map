# UOB May 2026 Import Reconciliation Audit

Date: 2026-06-22

## Scope

This audit covers the May 2026 UOB credit-card PDF import mismatch reported on
the Imports page for:

- UOB One Card
- UOB Lady's Card

It also covers the import-preview reset after a background `/api/imports/preview`
failure and the UOB dual-date PDF parser behavior.

## Production Data Access

Direct production D1 inspection was attempted with:

```bash
npx wrangler d1 execute monies-map --remote --command "..."
```

Cloudflare returned API error `7403`:

```text
The given account is not valid or is not authorized to access this service
```

The deployed app APIs were also checked directly, but Cloudflare Access returned
`302` redirects to the Access login flow. Because of that, this audit does not
claim exact production transaction IDs or exact production ledger row
descriptions for the mismatch. Those require refreshed Cloudflare/D1 access or
an authenticated Access service token.

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

The new reconciliation breakdown UI is designed to list these row groups
directly in future previews.

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

