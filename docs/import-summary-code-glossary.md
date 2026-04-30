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
  entry reconciliation, category matching, and account resolution have run.
- `entry reconciliation`: The row-level matching workflow that decides whether
  a new source observation should create a ledger entry, promote an existing
  provisional entry, or certify an already-matched entry.
- `reconciliation match`: A preview-time candidate showing that a source row
  may belong to an existing ledger entry.
- `bank certification status`: The trust state of a ledger entry's bank-facing
  facts. The UI states are `Manual provisional`, `Import provisional`, and
  `Statement certified`.
- `statement import`: A PDF-based bank statement import. These imports can carry
  statement balances and reconciliation checkpoints.
- `checkpoint`: A statement balance snapshot for one detected account. A
  checkpoint lets the app compare the imported statement against the ledger's
  running balance.
- `statement reconciliation`: The comparison between a statement checkpoint and
  the ledger balance implied by the rows that will be committed.
- `overlap import`: An earlier import batch that touches the same account/date
  period and may explain why the current preview is showing reconciliation
  matches or
  already-covered rows.
- `certified conflict`: A preview row that collides with a ledger row already
  treated as statement-certified history. These rows require extra protection.
- `checkpoint-only commit`: A commit where no transactions are inserted, but the
  user still wants to save statement checkpoints or reconciliation data.
- `needs review`: A preview row that the system cannot safely auto-commit
  because it still needs a user decision.

## Client implementation boundary

- `moniesClient`: The deep module service exported by
  [`src/client/monies-client-service.js`](/Users/tim/22m/ai-projects/monies_map/src/client/monies-client-service.js).
  Import-page components should prefer this surface over reaching directly into
  leaf helper modules.
- `import helpers`: Low-level mapping, PDF extraction, and preview-row shaping
  helpers that stay behind `moniesClient.imports`.
- `format helpers`: Shared formatting and money/date parsing helpers that stay
  behind `moniesClient.format`.

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
