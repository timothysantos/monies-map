# PDF statement text fixtures

These files are parser input, not PDFs. Each one has the exact shape that
`extractPdfText()` in `src/client/import-helpers.js` hands to
`parseStatementText()`:

1. the raw pdf.js text items, one per line, page by page
2. `__PDF_LAYOUT_TEXT__`, then each visual line with its items glued together
   (Citibank card parsing reads this view)
3. `__PDF_SPACED_LAYOUT_TEXT__`, then each visual line with its items joined by
   spaces (OCBC parsing reads this view)

UOB parsing reads the raw item view.

## Provenance and sanitizing

No original statement was committed. Each fixture was written by hand, one
text item per statement cell, and rendered into all three views the same way
`extractPdfText()` does. The layout follows the structure the parsers and their
history rely on: page preambles and account summaries, section headers,
previous-balance and subtotal/total rows, page footers and repeated page
headers, multiline descriptions, dual date columns, credits printed as
`CR`/parentheses, and disclosure pages. Specific real-world traits kept:

- Citibank: text is extracted per word, so the compact view glues words
  (`TRANSACTIONSFORCITIREWARDSWORLDMASTERCARD`, `M1LTD`). A payment has lost its
  opening parenthesis and has a four-digit amount glued to `ACCOUNT ENDING ####`.
  One grand total is printed on the line above its `GRAND TOTAL` label. There are
  foreign-amount continuation lines, a credit (negative) previous balance, and a
  points summary after the card sections.
- UOB card: two cards, an account summary that repeats card numbers, a page
  break inside a card section, and `CR` balances.
- UOB savings: the duty-to-check footer is split where the description cleaners
  expect real line breaks, followed by a Chinese notice and a page-2 header
  in the middle of the transaction list.
- OCBC 360: continuation lines, a disclosure and transaction-code block between
  pages, and a `Total Withdrawals/Deposits` footer.
- OCBC 365 card: glyph-cluster items, so the spaced view splits digits
  (`612 . 45`), a card-suffix prefix (`- 3333`), and a December-to-January
  statement.

Names, addresses, account and card numbers, and references are placeholders
(`REDACTED ...`, `0000...`, `4000-0000-0000-####`, `XX` masks). Public bank
contact lines are kept because the parsers recognize them.

When a real statement shows a layout these fixtures do not cover, add a new
sanitized fixture from the extracted text of that statement. Do not stretch an
existing fixture to fit it.
