# Real Statement Import Check (2026-09-25)

Real OCBC 360, OCBC 365 card and Citibank statements (June to September 2026)
and two Citibank activity CSVs were run through the importer. The PDFs were
extracted exactly as `extractPdfText()` does in the browser; nothing original
is committed.

## Findings

| Finding | Evidence | Outcome |
| --- | --- | --- |
| pdf.js 6 broke Citi and OCBC card PDF imports | With pdf.js 6.3.289 (merged the same day in `dependency-upgrades`), all three Citi/OCBC card PDFs and both Citi PDFs failed ("Could not find the OCBC card previous balance", "Unsupported statement PDF"). With pdf.js 4.10.38 the same files parse: OCBC 365 Jun 11 rows, Jul 8, Aug 7; Citi Aug 16, Sep 75. pdf.js 6 merges the per-word text items these parsers read into phrases (`TRANSACTIONS FOR CITI` instead of `TRANSACTIONSFORCITI`). The upgrade's own PDF checks used HSBC OCR and generated PDFs only. | Rolled back to `~4.10.38` (Vite 8 and plugin-react 6 stay). `tests/pdfjs-version-contract.test.mjs` fails if pdf.js leaves 4.x. |
| OCBC 360 PDF dropped the value date | Columns are Transaction Date then Value Date. The parser booked rows on the transaction date and lost the value date (`31 MAY 02 JUN`, `28 JUN 29 JUN`, `05 JUL 06 JUL`, `01 AUG 31 JUL`), against DOMAIN.md date lanes and the OCBC 360 activity CSV. | Rows are now booked on the value date with a `transaction date:` note, which import commit reads as the event date (`extractTransactionDateHint`). Every bank-facing date now falls inside the statement period. |
| OCBC 365 card with a past-due reminder was rejected | September's reminder is printed on the same line as `OCBC 365 CREDIT CARD`; detection required the card name alone on its line. | Detection and the account-name lookup accept trailing text after the card name. |
| Citi due date format | Citi prints `September 05, 2026` (zero-padded day). | The parser's two-digit day pattern matches; no change. |
| OCBC 365 card has one date column | `TRANSACTION DATE` only, as `dd/mm`. | Unchanged: both lanes take the statement date (DOMAIN.md single-date rule). |
| Citi activity CSVs | Rewards (68 rows, 24 Aug to 25 Sep) and Miles (101 rows, 7 Jul to 22 Sep) parse with no warnings. | No change. |
| Citi PDF covers one card | The August and September PDFs list both cards in the summary but carry only Citi Rewards transactions; PremierMiles detail is not in the file. | No parser change; Miles comes from its CSV or its own statement. |

## Fixtures

Five sanitized fixtures were added to `tests/fixtures/pdf-statement-text/`
(`*-real-sanitized.pdf-text.txt`) with `tests/pdf-real-statement-fixtures.test.mjs`.
They were extracted with pdf.js 4 and masked item by item, same length, so the
raw, glued and spaced views stay aligned: names, address and postcode, account
and card numbers (card last four kept), payees, investment references, phone
numbers, and health, church, employer and insurer names. Row amounts are
scaled by an undisclosed per-file factor and rounded, then every balance,
subtotal and total is recomputed, so the statements reconcile without real
amounts; money outside the reconciled ledger is zeroed. Each fixture parses to
the same rows, dates, descriptions, types and accounts as its unscaled original,
with every row amount equal to its rounded scaled value and no real amount
left in the text.

## Open

- OCBC 360 PDF rows imported before this fix have `post_date` equal to the
  transaction date. Existing ledger rows are not rewritten; a later statement
  certification sets both lanes from the PDF.
- The OCBC Child Development Account (CDA) parser has the same inverted
  lanes (row date = transaction date, `value date:` note). There is no real CDA
  statement with activity, and its deposit/withdrawal column detection depends
  on real layout, so it is unchanged until a sample exists.
- Resolved: Citi descriptions ending in `.sg` lost it (`www.anywheel.sg` →
  `www.anywheel.`, `ROCKONLINE.SG` → `ROCKONLINE.`) because the location suffix
  was stripped twice. It is now stripped once, uppercase only. Rows imported
  with the old names still match as duplicates (`normalizeDescriptionForMatch`
  drops a trailing `sg`).
