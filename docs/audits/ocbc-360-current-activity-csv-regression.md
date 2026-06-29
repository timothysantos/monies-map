# OCBC 360 Current-Activity CSV Regression Audit

Date: 2026-06-29

## Problem

An OCBC 360 mid-cycle CSV export loaded into the generic CSV mapping flow instead
of the OCBC activity parser. The mapping UI then showed only preamble columns
such as `Account details for:` and the account number, so it reported missing
`date`, `description`, and `amount/expense/income` fields.

## Findings

The OCBC activity parser could parse the file once selected, but the recognizer
was too narrow. It accepted headers with spaces such as
`Withdrawals (SGD),Deposits (SGD)` and the balance-column variant, but the real
OCBC 360 browser export used compact headers:

`Transaction date,Value date,Description,Withdrawals(SGD),Deposits(SGD)`

When no OCBC default account was selected, the classifier depended on the file
text signature. That compact header failed recognition, so the upload fell back
to generic CSV mapping.

## Implemented Fix

- The OCBC activity recognizer now accepts optional whitespace before `(SGD)`.
- The balance column is optional for the OCBC 360 value-date header shape.
- `FUND TRANSFER` singular now follows the same transfer classification as the
  existing `Funds Transfer` wording.
- A sanitized near-real OCBC 360 fixture was added with:
  - account preamble rows
  - `Transaction History` marker
  - compact withdrawal/deposit headers
  - multiline quoted descriptions
  - quoted comma amounts
  - withdrawal and deposit rows
  - value dates that differ from transaction dates
- Classifier and parser contract tests now use that fixture.

## Regression Tests

- `tests/import-file-classifier.test.mjs`
  - proves the real OCBC 360 file shape routes to `ocbc-activity-csv` even
    without a selected default account.
- `tests/parser-contract.test.mjs`
  - proves the parser returns 14 normalized rows with concrete dates,
    descriptions, amounts, categories, account, type, and value-date notes.

## Standard Update

`AGENTS.md` and `docs/code-spec.md` now require near-real sanitized fixtures for
bank import parser changes. Minimal synthetic snippets are allowed only as
supplemental edge-case tests.
