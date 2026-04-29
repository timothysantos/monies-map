# Import And Summary Code Glossary

This note exists to make the summary and import page code easier to read.
It explains the domain terms that appear in the client code and maps them to
the UI blocks where they are used.

## Summary page terms

- `summary range`: The first and last month currently included in the summary
  page. Some cards aggregate across the whole range while other controls focus
  on one month inside the range.
- `summary focus`: The month currently selected inside the spending-mix area.
  When the focus is `overall`, the donut uses the full range instead of one
  month.
- `metric cards`: Top-level totals for the current summary page.
- `intent vs outcome`: The month-by-month comparison between plan values and
  actual values.
- `account pills`: Wallet/account balance badges shown below the charts. They
  are account health snapshots, not values recalculated by the selected summary
  range.

## Import page terms

- `raw import row`: A row exactly as the file parser produced it.
- `mapped row`: A CSV row after the user maps source columns into the app's
  expected import fields such as date, description, and amount.
- `preview row`: The normalized row returned by the server preview API after
  duplicate detection, category matching, and account resolution have run.
- `statement import`: A PDF-based bank statement import. These imports can carry
  statement balances and reconciliation checkpoints.
- `checkpoint`: A statement balance snapshot for one detected account. A
  checkpoint lets the app compare the imported statement against the ledger's
  running balance.
- `statement reconciliation`: The comparison between a statement checkpoint and
  the ledger balance implied by the rows that will be committed.
- `overlap import`: An earlier import batch that touches the same account/date
  period and may explain why the current preview is showing duplicates or
  already-covered rows.
- `certified conflict`: A preview row that collides with a ledger row already
  treated as statement-certified history. These rows require extra protection.
- `checkpoint-only commit`: A commit where no transactions are inserted, but the
  user still wants to save statement checkpoints or reconciliation data.
- `needs review`: A preview row that the system cannot safely auto-commit
  because it still needs a user decision.

## Import page block map

- File selection block: Choose the source file, ownership defaults, account
  defaults, and import note.
- Mapping block: Tell the app how CSV columns map into import fields.
- Preview review block: Read the guardrails before looking at the full table.
  This is where account mapping, unknown categories, overlap warnings, and
  statement balance checks are surfaced.
- Preview rows table: Inspect and edit row-level decisions before commit.
- Recent imports block: Review previous import batches and roll them back when
  policy allows.
