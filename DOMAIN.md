# Domain Glossary

This file is the canonical vocabulary for Monies Map.

Its purpose is to prevent synonym debt. When adding features, schemas, DTOs,
copy, or docs:

- reuse the canonical terms in this file
- only use aliases when referring to an existing table, field, DTO, or route
- prefer extending an existing entity before inventing a near-duplicate concept
- update this file in the same change if the domain model meaningfully evolves
- consult [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md) when a
  change depends on client implementation boundaries such as the deep module
  service

## Naming Rules

- Use `household` for the top-level container for all data.
- Use `person` for a household member inside the finance model.
- Use `account` for a tracked bank, card, cash, loan, or investment container.
- Use `ledger entry` as the canonical term for a normalized money movement row.
  In UI and DTOs this is usually shortened to `entry`. In storage it currently
  lives in `transactions`.
- Use `import batch` for one import operation and `import row` for one raw row
  inside that batch.
- Use `entry reconciliation` for the app task of deciding whether multiple
  source observations belong to one existing ledger entry or should create a
  new one. In accounting terms, this is the transaction-matching part of `bank
  reconciliation`.
- Use `transfer` for money moved between tracked accounts. Do not model it as
  fake income or fake expense.
- Use `split workspace` for the separate shared-expense settle-up layer.
- Use `month plan row` for a planned line item in the monthly planning model.
- Use `savings target` for the explicit monthly amount the user intends to save.
  It is a first-class monthly planning field, not something inferred from a
  row label and not something that must match a ledger entry.
- Use `month snapshot` for a generated monthly rollup, never for editable plan
  input.
- Use `statement checkpoint` as the product term for an account balance anchor.
  The storage table is `account_balance_checkpoints`.
- Use `bank certification status` for the trust state of a ledger entry's
  bank-facing facts across manual capture, working imports, and final statement
  proof.
- Use `split currency` for the designated currency of a split group and the
  original currency of its expenses and settlements. Preserve the original
  amount; home-currency estimates are evidence only.
- Use `expense source` for the optional purchase-recording guard on a split
  group: `Cash only`, `Bank/card`, or `Mixed`. It applies to purchases, not to
  repayments, because a card-funded expense may later be repaid in cash.
- Use `payment evidence` for the method and trust state of a split payment.
  Cash may remain unlinked, while a card expense may await statement
  certification.
- Use `FX evidence` for an explicit rate used to compare different currencies.
  Never net currencies without it. For the same reason the Splits category
  donut charts each split currency on its own ("Split currency in charts" under
  Split Expense Share), never summing yen and dollars.
- Use `group settlement` for payment that closes only one split group's
  current batch. Use `simplified settlement checkpoint` for the optional
  netting of open groups in one currency; these are separate workflows.
- Use `paid confirmation` for a household's statement that a simplified
  settlement happened outside the ledger. It is not `bank match`: paid
  confirmation may hide an obligation from the active workspace, while a bank
  match still requires a distinct transfer entry as evidence.
- Use `split activity history` for the household-scoped, chronological record of
  reversible split changes. Deleted split records are archived rather than
  destroyed so users can restore the original record and relationships.
- Use `skew candidate` for a read-only flag on unlinked entries that are most
  likely money moving inside the household (a split settlement or a move
  between one person's own accounts) yet still counted as spending or income.
  It is never a link itself; linking stays an explicit existing action.

## Core Entities

### Household

The top-level finance container. A household owns people, institutions,
accounts, categories, imports, ledger entries, split workspace records, month
plans, notes, and snapshots.

Storage:
- `households`

Relationships:
- has many `people`
- has many `institutions`
- has many `accounts`
- has many `categories`
- has many `imports`
- has many `ledger entries`
- has many `split groups`, `split batches`, `split expenses`, and `split settlements`
- has many `monthly notes`, `month plan rows`, `month snapshots`, and reconciliation records

### Person

A household member who can own accounts, own direct entries, participate in
shared splits, pay split expenses, send or receive settlements, author notes,
and import data.

Storage:
- `people`

Relationships:
- belongs to one `household`
- can own many `accounts`
- can own many direct `ledger entries`
- can participate in many `entry splits`
- can pay many `split expenses`
- can participate in many `split expense shares`
- can send or receive many `split settlements`
- can own many `month plan rows`

### Institution

A financial institution such as UOB, Citi, or OCBC. Institutions are metadata
used to group accounts and drive import parsing context.

Storage:
- `institutions`

Relationships:
- belongs to one `household`
- has many `accounts`

### Account

A tracked financial container such as a bank account, credit card, cash wallet,
loan, or investment account.

Storage:
- `accounts`

Relationships:
- belongs to one `household`
- belongs to one `institution`
- may belong to one `person` as owner
- has many `ledger entries`
- has many `statement checkpoints`
- has many statement reconciliation records
- may be referenced by many `month plan rows` and `month plan match hints`

Important distinctions:
- A card account may remember its card's last four digits (`accounts.last4`).
  The first statement commit that maps a statement section to the account
  stores them (never overwriting, never giving two accounts the same digits),
  and later statements match a section whose printed name matches no account
  by those digits. Rolling the statement back keeps them: they identify the
  card, they are not a ledger fact.

### Savings Target

An explicit monthly planning field representing how much the user intends to
save in that month.

Canonical term:
- `savings target`

Important distinctions:
- A savings target is an intent, not a ledger fact.
- A savings target does not need to match a ledger entry.
- A savings target is not the same thing as a planned savings transfer or
  planned investment movement.
- A savings target should not be inferred from a free-text row label such as
  `Savings`.
- `Realized savings` is the outcome measure calculated from actual ledger
  activity.

Recommended relationship:
- `savings target` is a first-class month-level planning input
- `realized savings` is a derived month-level outcome
- `savings variance` is `realized savings - savings target`
- the `savings bar` (Summary and Month lead) draws actual income as 100%,
  with spent, invested and kept as its parts. Money filed under the
  `Investments` category is invested and money filed under `Savings` is
  kept: both were moved, not spent, so they come out of the spend. Money
  moved into an investment account is invested too (see "Money job"). The
  lead's Spent figure and its Saved figure use the same split (see "Money
  job"); the stored realized savings still counts them as spend.
  When more went out than came in, spending past the income is shown as
  money that "came out of savings".

Optional related concept:
- a `planned savings allocation` may exist as one or more `month plan rows`
  when the user wants to track a specific savings movement, but that is not the
  same domain concept as the top-level `savings target`

### Money Job

What one line of a month plan is for, and whether it was done
(`src/domain/money-jobs.ts`, `src/domain/money-job-plan.ts`,
`src/client/money-jobs-model.js`). Each plan line has one of four jobs:

- spend within the budget: every planned row except the savings target
  rows and the Investments rows, against spending (expense entries outside
  the `Investments` and `Savings` categories);
- save the `savings target` (rows labelled `Savings`), against what was kept:
  income minus that spending minus what was invested, so money moved under
  `Savings` counts as saved;
- invest the investment goal (planned rows in the `Investments` category,
  not labelled `Savings`), against what was invested: expense entries in
  `Investments`, plus transfers into investment accounts, less transfers out
  of them back to cash accounts;
- planned income, against actual income.

Canonical term:
- `money job`

Important distinctions:
- A money job is retrospective: done, or short or over by an amount, from
  recorded entries and the household's own plan. While the month is still
  going it says "so far"; it never forecasts.
- A job exists only when its plan line is more than zero.
- Invested (owner decision d34, `src/domain/investment-moves.ts`) is money
  filed under the `Investments` category (by name, as category offsets
  are), plus transfers into an account of kind `investment`, less transfers
  out of one back to a cash account (a withdrawal). The investment
  account's own entry decides, so a linked pair counts once:
  - a transfer in on an investment account is `moved into investments`,
    and a transfer out on one is `taken out of investments`;
  - a pair between two investment accounts moves nothing;
  - a transfer in whose linked other side is an expense filed under
    `Investments` is already counted as that expense (a GIRO filed under
    Investments and linked to the investment account counts once);
  - the cash side of a pair, and transfers between cash accounts, stay
    neutral; an expense or income on an investment account (a fee, a
    dividend) is spending or income as before.
  An entry's other side is known only when the pair is linked and both are
  in the loaded range; an unlinked transfer out of a bank account says
  nothing about where the money went, so it stays neutral.
- Invested never goes below zero. A period that took more out of
  investments than it put in shows invested as zero and the difference as
  its own line, "Took out of investments $x" (the savings bar's legend, the
  invested answer on Ask). That money is not income and not kept: kept is
  still income minus spending minus invested.
- The Month and Summary page DTOs carry the period's two totals as
  `investmentMoves` (`{ intoMinor, outOfMinor }`, left out when both are
  zero) for the view's own entries; the client nets them in
  `splitMoneyUse`. The Summary range nets its months' totals.
- The Summary and Month lead are one split of the period's money
  (`splitMoneyUse`): the lead's "Spent" is the spend job's spending, its
  plan ("of $x plan", "% of plan", "under / over plan") is the spend job's
  plan, and its Saved figure is the save job's kept. So the lead never says
  "under plan" beside a spend job that is over.
- The stored `realized savings` (`income - spend`, the snapshot and month
  rollup field, and Intent vs Outcome's per-month detail) is unchanged and
  still counts money filed under `Savings` and `Investments` as spend.
- The Summary page's `Planned investments` metric card carries the range's
  investment goal; the Month page derives it from its plan rows. The only
  other fields are `investmentMoves` (above) and, on the Summary page,
  `investmentMovesByMonth` (the same totals per month, only for the months
  where something moved), so "Earned vs spent by month" splits each month
  the way its Month lead does.

### Money Figure

A figure a card shows, named by the rule that produces it, so the entries
behind it can be listed and add up to it exactly
(`src/domain/money-figures.ts`; design.md "Openable figures"). The Entries
filter `entry_figure` names one, and Entries then leads with its total.

The money jobs' figures (through `splitMoneyUse`, as the leads, the
savings bar, Simple and "Earned vs spent by month" show them):
- `spending`: expenses less paybacks, without money filed under
  `Investments` or `Savings` (the lead's "Spent");
- `invested`: the `Investments` category plus transfers into investment
  accounts, less transfers out of them, never below zero;
- `kept`: income less spending less invested (the lead's "Saved");
- `earned`: income (paybacks lower spending instead);
- `from_savings`: spending past what came in;
- `took_out`: more taken out of investments than put in;
- `spent`: every expense less paybacks at the view's amounts (the Month
  "Actual spend", Intent vs Outcome, a category's spending, a plan row's
  actual).

The Entries page's own figures (as entry-totals counts them, whole amounts
with a person's share beside):
- `expenses`: every expense less paybacks (the Entries "Spent" lead);
- `transfers`: transfers out;
- `outflow`: spent plus transfers out;
- `difference`: income less spent (the stored `realized savings`).

Canonical term:
- `money figure`

Important distinctions:
- A row belongs to a figure when it adds to it or takes from it, so leaving
  the other rows out never changes the figure; the total is worked out from
  the rows by the card's own calculation.
- A figure has a period: one month, or a Summary range, which Entries then
  lists in full (`entry_from`, `entry_to`; at most 24 months).
- A Month budget line's actual never goes below zero; when its refunds are
  more than its spending, its entries add up to less than the zero it
  shows. Daily spend is an average, not a figure with rows of its own.

### Statement Checkpoint

An explicit balance anchor for an account and statement month, optionally with
statement-period dates. This is the trusted reference point used to reconcile
ledger activity against a statement balance.

Canonical term:
- `statement checkpoint`

Aliases:
- storage table `account_balance_checkpoints`
- DTO `AccountCheckpointDto`

Relationships:
- belongs to one `household`
- belongs to one `account`

Important distinctions:
- A card statement prints its closing (statement) date but not the day the
  cycle opened. The statement period opens the day after the same date a
  month earlier (clamped to that month's length), or on the earliest printed
  row if that is older. It does not start on the first printed row, so a
  provisional entry between the cycle start and the first row is inside the
  period.
- One checkpoint per account and month, even when two imports saved the same
  statement (uploaded again and saved anyway). Rolling back one of them
  keeps the checkpoint while another completed import still has a
  certificate for that account and month; the last rollback removes it.
- A card statement checkpoint may keep what the statement asked for: its
  `payment due date` (`payment_due_date`) and `minimum payment`
  (`minimum_payment_minor`). OCBC prints "IMMEDIATE" for an account already
  past due; the due date is then the statement date. A manual Settings
  checkpoint leaves them as they were.
- A statement's `notices` (OCBC's "past due" reminder and its "penalty
  interest rate") are saved with it (`statement_notices_json`), keeping only
  the notices the app knows how to say (`src/domain/statement-notices.ts`).
  The check-in reads the latest statement's notices while it closed within
  62 days; a later statement without the notice ends it.

### Bank Charge

A card statement row the bank charges itself: a late charge, interest, an
annual (membership) fee, a currency conversion or DCC fee, or another bank
fee (over limit, cash advance). Its `reversal` is the credit the bank posts
when it waives one ("CR LATE CHARGE", "AUTOLATEFEEREVERSAL",
"ANNUALMEMBERFEEREV", "INTEREST REVERSAL").

Canonical term:
- `bank charge`, `bank charge reversal`

Aliases:
- `classifyBankCharge`, `findUnreversedBankCharges` (`src/domain/bank-charges.ts`)

Important distinctions:
- Recognised by the description's leading words with spaces and punctuation
  removed, never by a word inside a shop's name ("AMAZE*FEES", "Cabcharge").
- Statement parsers file a bank charge and its reversal under `Fees`.
  Money in that is not a reversal ("INTEREST CREDIT" on savings) stays
  income. A reversal kept in Fees is money in under a spending category, so
  it lowers Fees (`category offset`) and a waived charge nets to nothing.
- An `unreversed bank charge` is one no reversal of the same kind and amount
  on the same account, dated on or after it, has cancelled. Each reversal
  cancels one charge. Currency fees are the price of foreign purchases, so
  they are never listed as unreversed.

### Card Bill

What a card account's latest statement checkpoint asks for (amount owed, due
date, minimum) and what the ledger shows paid to the card since the
statement closed (transfers into the card dated after the statement date).

Canonical term:
- `card bill`

Aliases:
- DTO `CardBillDto` on `SummaryAccountPillDto.cardBill`
  (`src/domain/card-bill-projection.ts`)

Important distinctions:
- Only for a statement that owes money and has a due date, and only until
  45 days after the due date.
- A payment from a bank account not imported yet is not seen; the check-in
  says so instead of claiming the bill is unpaid.

### Account Routine

What a bank account does every month and what changed, read from its own
entries and statements over about seven months
(`src/domain/account-routines.ts`). The account pills carry it for the
Summary and Month check-in.

Canonical terms:
- `regular payment`: money that leaves one bank account to the same payee
  at the same amount in consecutive months (a GIRO, a standing PayNow). A
  payee is named from the description without payment-rail words and codes
  ("IBG GIRO COLL P0000192 IFAST FINANCIAL PL-" is "Ifast Financial").
- `regular income`: income of at least $500 from the same payer into one
  account in consecutive months, matched across banks by the payer's name.
- `account charge`: a bank account's own charge, either for a payment the
  bank could not make ("IBG SVC CHARGE ...") or the account's monthly fee
  ("SERVICE CHARGE", "FALL BELOW FEE"). Card charges stay `bank charges`.
- `missed payment`: a regular payment (3 months in a row) that did not leave
  the next month, where the account was charged for a failed payment to the
  same payee within 5 days of its usual day. A payment that just stops,
  with no such charge, is never called missed.
- `moved income`: regular income (3 months in a row into one account) that
  now arrives in another of the owner's accounts, while regular payments
  are still scheduled on the old one.
- `own-account transfer counted as income`: income into one of a person's
  bank accounts while the same amount left another of their bank accounts
  as an unlinked transfer within 3 days.
- `scheduled check`: the latest statement balance of a bank account (no
  older than 40 days), plus what is recorded since, against the regular
  payments still scheduled on it and the regular income still arriving in
  it, due within the next 31 days. It speaks only when a payment cannot fit.

Important distinctions:
- A regular payment is still scheduled while it came in the latest month
  the data covers for it, or the bank tried and failed to make it. One that
  was due within the data and did not come has stopped, and is not counted.
- The scheduled check is the only look ahead in Money insights. It never
  guesses spending, never gives a month-end balance or a safe-to-spend
  figure, and never says an account is fine.
- Insights are only as fresh as imports: a statement imported late moves
  the scheduled check and the missed payment late too.

### Category

The spending or income taxonomy used to classify ledger entries, split
expenses, and month planning rows.

Storage:
- `categories`

Relationships:
- belongs to one `household`
- may have one parent `category`
- has many `category match rules`
- has many `ledger entries`
- has many `split expenses`
- has many `month plan rows`
- has many `month plan match hints`

### Category Offset

Money in under a spending category corrects what was spent there: a refund, or
a friend paying back their share of a court booking or a dinner. It lowers that
category's spending everywhere (Summary, Month budget buckets and totals,
Entries totals and breakdown, check-ins and insight facts) and is not counted
as income, so net is unchanged.

The category decides, not the entry (`src/domain/category-offset.ts`). Income
categories (`Income`, `Salary`, `Extra Income`, `Other - Income`, any name
containing "Income"), money that is not spending (`Transfer`, `Savings`,
`Investments`, `Loans`) and the uncategorised `Other` never offset; money in
there is income. A gift received belongs in `Extra Income`, not `Gifts`.

A category's spending may reach zero but is never shown below zero. Totals are
not clamped, so income minus spending stays the real net.

Storage:
- derived from `transactions.entry_type` and the entry's category. The old
  per-entry `transactions.offsets_category` column is still written by some
  paths but no longer read.

### Category Match Rule

A persistent household rule that maps a description pattern to a category during
import and classification workflows. The first active rule by priority wins and
overrides the parser's own guess. Default rules live in
`src/domain/category-match-defaults.ts`; a retired default id goes in
`deprecatedDefaultCategoryMatchRuleIds` so it is removed from existing
households. No two default rules may duplicate or overlap
(`tests/category-match-defaults.test.mjs`).

A rule files new imports. Past entries still in `Other` or `Other - Income`
that a rule now matches (it is the first active rule to match them) are listed
in Settings as a `category rule backfill` and can be moved to the rule's
category in one go (`app-repository-category-rule-backfill.ts`). Entries in
any other category are never changed.

Storage:
- `category_match_rules`

Relationships:
- belongs to one `household`
- belongs to one `category`

### Category Match Rule Suggestion

A proposed category rule inferred from repeated corrections. Suggestions are
reviewable metadata, not active rules.

Storage:
- `category_match_rule_suggestions`

Relationships:
- belongs to one `household`
- points to one `category`

### Import Batch

One ingestion operation from a CSV, PDF statement, manual flow, or current
transaction export. It is the audit and rollback boundary for imported data.

Storage:
- `imports`

Relationships:
- belongs to one `household`
- may be created by one `person`
- has many `import rows`
- may create or certify many `ledger entries`
- may create many statement reconciliation records

### Import Inbox

A guided planning surface for manual bank importing. It derives stale account
work from statement checkpoints, recent import activity, and split cleanup
state, then groups expected downloads by bank login session while keeping
statement review ordered by accounting chronology.

Storage:
- no direct storage for original files
- may write local browser snooze markers for expected files that are not
  available yet

Relationships:
- belongs to one `household`
- summarizes many active bank/card `accounts`
- references expected statement or activity files
- keeps split cleanup as a separate after-bank-files lane

Rules:
- do not require filename conventions
- do not persist original PDFs, CSVs, XLS files, OCR images, or raw bank files
- multi-file intake may keep parsed rows, checkpoints, and generic CSV text in
  browser memory only until cleared, reloaded, or loaded into review

### Error Diagnostic

A bounded support record created when a browser request fails in a way the app
can still observe. It stores the previous action, failed action, route/status,
possible reason, request context summary, and saved response body so production
failures such as Cloudflare resource-limit pages can be reviewed from Settings
without exposing raw HTML in the workflow panel.

Storage:
- `app_error_diagnostics`

Relationships:
- belongs to one `household`

### Import Row

One raw source row inside an import batch. Import rows preserve traceability
from normalized ledger facts back to source data.

Storage:
- `import_rows`

Relationships:
- belongs to one `import batch`
- may be assigned to one `account`
- may map to one committed `ledger entry`

Important distinctions:
- Multiple import rows across time can refer to the same real-world card or
  bank event. Later sources should usually enrich or certify the existing
  `ledger entry`, not create a second one.
- A manual provisional entry, a mid-cycle activity row, and a final statement
  row can all be separate source observations of one underlying ledger fact.

### Entry Reconciliation

The app workflow that matches source observations against existing ledger
entries so one economic event stays represented by one ledger entry across
manual capture, mid-cycle activity imports, and final statement imports.

Canonical term:
- `entry reconciliation`

Accounting analogue:
- `bank reconciliation` at the account level
- `transaction matching` at the row level

Important distinctions:
- Entry reconciliation is broader than duplicate detection. It decides whether a
  later source should create a new ledger entry, promote an existing provisional
  one, or certify an already-matched entry.
- Entry reconciliation now starts with a stricter `exact duplicate suppression`
  lane before it evaluates the guarded `promotion and reconciliation` lane.
- Entry reconciliation is not limited to PDF statements. The same system should
  govern manual entries, CSV/XLS activity imports, and statement imports with a
  source-authority ladder.
- `Exact duplicate suppression` is a raw identity check. If the incoming row has
  the same amount, the same mapped account, and either the same normalized
  import hash or a perfect normalized description match on the same date, the
  preview auto-skips it as already covered.
- `Promotion and reconciliation` is the status-guarded lane. It handles manual
  row promotion and statement certification after duplicate suppression has
  already removed truly identical bank rows.
- The `Velocity Rule` prevents commuter false positives: a charge that
  repeats on its account (another charge of the same signed amount with
  lookalike wording within 7 days, ignoring reference numbers such as a
  BUS/MRT trip number) is matched only within `day_distance <= 2`; a one-off
  charge can use `day_distance <= 7` to tolerate delayed posting, whatever
  its amount. A file row and a ledger entry get the tight window when either
  repeats on its own side.
- Under that rule, identical recurring transactions such as BUS/MRT fares,
  coffee or same-priced top-ups are separate economic events by default
  unless they occur close together in time. Until 2026-10-03 the test was
  the amount (`abs(amount_minor) < 500`); `docs/audits/velocity-rule.md`
  measured repetition as the better test on real bank files.
- Close to a statement's closing day the rule tightens: a repeating entry
  with no posted date, dated in the period's last two days, may post on the
  next statement, so it only answers a statement row from its own purchase
  day or later (`isRowBeforeLateUnpostedEntry`). A ride recorded on 12 May is
  never taken for the statement's 11 May ride; it is offered as "next
  statement" instead. The import preview, the statement mismatch diagnosis
  and Settings "Compare statement" share this rule.
- Date evidence should stay lane-aware. Compare original transaction dates to
  other original transaction dates when both exist; otherwise compare posted
  dates, so imported commuter rows do not become false matches through a mixed
  original-versus-posted comparison.
- Bank and deposit account activity exports that provide both a transaction
  date and a value, cleared, or posted date should import the value/cleared date
  as the bank-facing ledger date and preserve the transaction date as event
  evidence. Statement checkpoint math uses the bank-facing date, not the event
  date.
- A final PDF statement is the source of truth for bank date lanes. When it
  carries both an event or transaction date and a posted date, certification
  sets `transaction_date` from the PDF event date and `post_date` from the PDF
  posted date.
- When the official statement carries only one row date, that date is the only
  bank evidence available for the event. Certification sets both
  `transaction_date` and `post_date` to the statement date.
- Statement certification preserves user annotations such as category, note,
  ownership, splits, and links; it does not preserve provisional bank facts that
  conflict with the final PDF.
- A current-activity (CSV/XLS) import that reconciles with a manual
  provisional entry promotes it in place: the entry takes the import's bank
  facts (posted date, description, amount, entry type, transfer direction) and
  joins the import batch. The promoting import row keeps a snapshot of the
  facts it replaced. Rolling the import back restores those facts and removes
  the entry from the batch, so it is `Manual provisional` again exactly as
  before the promotion; annotations made since (category, note, owner, splits,
  transfer links) are kept. A bank fact the user edited after the promotion
  is still restored, except that an entry linked as a transfer keeps the
  transfer entry type and direction its link needs. Rows the import created
  are removed as before. An entry deleted after the promotion has nothing to
  restore. When the restored amount differs (the user corrected it after the
  promotion), the entry's linked split follows it in the rollback's own
  write, by the same rule as an entry amount edit (see `split expense
  share`); if that split is in an active settlement checkpoint the rollback
  is refused as a whole instead (settlement lock under Settlement
  Checkpoint). A promoted entry's amount can only change through such a
  correction: matching requires equal amounts, and a certified entry's amount
  is locked, so a statement rollback never restores a different amount.
- If a later statement certified a promoted entry, a rollback of the
  current-activity import keeps the entry `Statement certified` with the
  statement's bank facts, and replaces the import-provisional state underneath
  it (the state a statement rollback returns to) with the manual entry.
  If a later statement superseded the promoted entry, the statement's
  snapshot is rewritten the same way, and the rows the rolled-back import
  created are dropped from it, so rolling the statement back re-creates the
  manual entry and nothing of the rolled-back import.
- Imports committed before promotion snapshots existed (before 2026-09-25)
  have none. Their rollback keeps an entry created before the import as a
  manual entry with its current bank facts rather than deleting it.
- The newest PDF statement for an account remains rollbackable even when it
  certified existing provisional rows. Rollback restores those rows to their
  prior working state and removes the statement certificate metadata; an
  entry linked as a transfer since keeps the transfer entry type and
  direction its link needs, as in the current-activity rollback above. Older PDF
  statements stay locked once a later statement certificate exists for the same
  account.
- Rows a statement superseded (deleted) are re-created by its rollback with
  their split links. Superseding unlinked the splits, so one may have been
  edited or matched meanwhile: a re-linked split goes back on the re-created
  entry's amount by the same rule as an entry amount edit (see `split expense
  share`; a settled split refuses the rollback instead, see the settlement
  lock under Settlement Checkpoint), and a split matched to another ledger row
  since keeps that link, so the entry comes back without a split.
- A confirmed statement (one with a statement reconciliation certificate) is
  the complete record for its period. A mid-cycle row (CSV, XLS or manual
  import) posted inside that period for the same account is either on the
  statement or not a charge on that card: when a certified entry with the
  same signed amount inside the velocity window (and not taken by another
  row) covers it, the row is skipped as already on the statement, however
  the export words it; when nothing covers it, the row is left out by
  default with a reason the user reads, and can still be included. This
  keeps a later activity export from unbalancing a closed statement. The
  preview row carries `certifiedStatement: { checkpointMonth, covered }`.
- A statement uploaded again for an account and month that a completed
  import already confirmed names that import on its statement
  reconciliation (`previousStatementImport`: import id, source label,
  imported at). Its rows are already certified, so it is a covered
  statement, never an empty one: an empty statement is one with no rows at
  all.
- If an official statement balance is mismatched only because one or more
  provisional CSV rows in the statement period are absent from the PDF, those
  rows may be superseded by the statement only when their signed total uniquely
  and exactly explains the statement delta.

### Ledger Entry

A normalized money movement row in the household ledger. This is the main
financial fact record used across entries, months, summaries, transfers, and
reconciliation.

Canonical term:
- `ledger entry`

Accepted shorthands:
- `entry` in product, UI, and DTO contexts

Storage alias:
- `transaction` / `transactions`

Subtypes:
- `expense`
- `income`
- `transfer`

Relationships:
- belongs to one `household`
- belongs to one `account`
- may come from one `import batch`
- may come from one `import row`
- may belong to one `category`
- may belong to one `person` as direct owner
- may participate in one `transfer group`
- may have many `entry splits`
- may link to many `month plan rows` through plan-entry links
- may link to one `split expense`
- may link to one `split settlement`
- may be referenced by reconciliation records
- may have one external request reference for idempotent direct creation

An external request reference identifies a caller's create attempt, not a bank
transaction. It is unique within a household. Repeating the same reference with
the same normalized ledger facts returns the existing entry; reusing it for
different facts is a conflict. Bank imports continue to use import-row and
reconciliation evidence rather than this API retry identity.

### Added By

Which in-app tool created a ledger entry, derived from its external request
reference: `shortcut:<request id>` is the Apple Pay Shortcut and
`ask:<card id>` is the Ask card. Anything else (a manual entry, an import)
has no recorded source.

Canonical term:
- `added by`

DTO field:
- `addedBy`: `apple_pay_shortcut` | `ask`, left out when unknown

UI labels:
- `Added by` row: `Apple Pay shortcut`, `Ask`
- bank state chip while provisional: `Apple Pay · provisional`,
  `Ask · provisional`
- Entries row glyph: `Added with Apple Pay`, `Added in Ask`

Important distinctions:
- It is derived on the server (`src/domain/entry-source.ts`); the reference
  itself (a Shortcut request id, an Ask card id) never reaches a page.
- It is provenance, not trust: a statement can still certify the entry, and
  the bank state chip then says `Statement certified` while `Added by` stays.
- It is not the `import batch` source: an imported row has none.

### Entry Draft

One typed sentence ("Koufu lunch $12.50 yesterday, Citi") read into the
fields a new ledger entry needs, for the user to confirm. It is not a ledger
entry and is never stored: it becomes one only when the user confirms and
the client posts its create body to `/api/entries/create`.

Canonical term:
- `entry draft`

Code:
- `src/domain/entry-draft.ts` (`parseEntrySentence`, deterministic and pure)
- `src/domain/entry-draft-context.ts` (read-only reference data)
- `EntryDraftDto` in `src/types/dto.ts`
- `POST /api/ai-assist/entry-draft`

Field sources. Every field carries its value and where it came from:
- `sentence`: read from the words typed (an amount, a date word, an account
  name, a person, "with Serene", "came into").
- `rule`: a category from the household's category match rules on the
  description, as the Shortcut does.
- `rule`: also the account a payment word means (see "Payment Way" below).
- `default`: filled because the sentence did not say: today's date, the
  account from Default account priority (the card for other currencies for a
  foreign amount, the first bank account for income, the payer's first
  account for a shared expense someone else paid), the account's owner, an
  even split, `Other` or `Other - Income`, `expense`, `direct`.
- `ai`: filled by the optional AI gap-filler, only for an amount or
  description the sentence left out, after validation (the amount stated in
  the sentence, the description in its words). A `sentence`, `rule` or
  `default` value always wins over AI. When AI reads the amount from number
  words ("Koufu lunch twelve fifty"), only the words that spell that amount
  leave the description ("Koufu lunch"); other words, number words that
  spell something else ("Seven Eleven") included, stay.

Important distinctions:
- `missing` lists the create fields still unknown; `questions` are
  structured follow-ups (field, reason, options) the client words. The draft
  never guesses: two amounts, an account name matching several accounts, an
  uneven split ("70/30"), "she paid" with no one named, an impossible or
  conflicting date and an amount in another currency than the account's are
  asked. A future date is kept but flagged and asked. A name that matches
  only an inactive account ("DBS Altitude") is never moved to another
  account of the same bank: the account is asked (`invalid`), offering only
  active accounts the sentence also named.
- A foreign amount ("IDR 159,000") is kept as `foreignAmount`; the account
  amount stays missing until confirmed, unlike a Shortcut `foreign currency
  estimate`, which converts at the day's rate.
- A shared hint is a suggestion of `shared ownership` with a share basis,
  not a split write: the split expense is created by the normal create route
  when the user saves.
- A transfer draft records the outgoing side on the account money left; the
  other account is `transferAccount`, for the normal transfer match later.
  With no description typed it is "Transfer to <account>" (owner-approved
  copy, 2026-10-11).

### Payment Way

How one person pays when no card or account is named: the account their
PayNow and bank transfers come from, and their cash wallet. Chosen per
person in Settings -> Payment ways; used by the entry draft when a sentence
says how it was paid ("lunch at nasi lemak bmv 7.20, paynow, mine").

Canonical term:
- `payment way` (the two kinds: `PayNow and bank transfers`, `Cash`)

Code:
- `src/domain/payment-ways.ts` (pure: which accounts count, defaults)
- `src/domain/app-repository-payment-ways.ts` (`loadPaymentWays`,
  `savePaymentWay`)
- `PaymentWayDto` in `src/types/dto.ts`; `settingsPage.paymentWays`
- `POST /api/settings/payment-ways/save` with
  `{ personId, bankTransferAccountId, cashAccountId }` ("" = none)

Rules:
- Payment words: PayNow ("paynow", "pay now"), FAST, GIRO, NETS (a debit
  card network, so the bank account) and "bank transfer" mean the PayNow and
  bank transfers account; "cash" means the cash wallet. FAST, NETS and cash
  are also ordinary words, so they count only in capitals (FAST, NETS),
  after "by", "via", "with", "using", "in" or "through", after "paid"/"pay"
  (cash), or closing a clause ("taxi 15 cash"). "Cash back" is a card name.
  The words always leave the description; two different ways in one
  sentence use neither.
- Whose payment way: the payer or owner the sentence names, "mine" or "I"
  the viewer, else the viewer, else the owner of the account Default
  account priority gives. An unclear payer ("she paid", no one named) uses
  none.
- A named account always wins. A payment way never applies to a transfer.
  Another person's payment way is never used.
- Nothing chosen for that person and that kind (or an unclear payer):
  cash is never recorded on a card or another default account; the account
  is left out and asked (`accountId`, reason `missing`), offering that
  person's active accounts with cash accounts first. PayNow, FAST, GIRO,
  NETS and a bank transfer keep the Default account priority fallback,
  unless it is a credit card: PayNow never comes from a card, so that is
  asked too, offering that person's active accounts that are not cards,
  bank accounts first. (Owner-approved, 2026-10-11.)
- PayNow and bank transfers may be any active bank account, a joint one or
  another person's included (people do pay from a shared or a partner's
  account). Cash must be an active `cash` account. A save naming anything
  else (a card, an archived or unknown account, a person outside the
  household) is refused before anything is written.
- Default: a person who has never chosen gets their own first bank account
  in Default account priority (never a joint one), else none, and no cash
  wallet. A choice is kept as made, none included. A chosen account that is
  archived or no longer of its kind counts as not chosen.
- Stored household-wide in `app_settings` under `payment_ways`
  (`{"people":{"<personId>":{"bankTransferAccountId","cashAccountId"}}}`);
  a demo reseed clears it, because it names the people and accounts the
  reseed replaces. The Shortcut settings in the same table stay.

### Transaction Date & Reconciliation
The system uses an event-first date model so planning and split workflows do
not drift when the bank clears later:

* **Event Date (`transaction_date`):** The date the economic event happened.
  This drives ledger sorting, monthly planning, summary grouping, and split
  workspace calculations. It is provisional until an official statement
  certifies the row.
* **Posted Date (`post_date`):** The bank-cleared date used for statement
  verification, balance checkpoints, and other reconciliation-only workflows.

**Why this matters:**
An April 30 expense must stay in April for budgets and split math even if the
bank posts it on May 3. Reconciliation still needs the May 3 date, but it must
not push the event into a different planning month.

Important distinctions:
- A ledger entry is not the same thing as an import row.
- A ledger entry should represent one economic event even when that event is
  observed through multiple source paths such as manual entry, current-activity
  import, and final statement import.
- During entry reconciliation, non-statement bank sources should fill or update
  `post_date` without rewriting `transaction_date`. Final PDF statements own
  both date lanes when they certify a provisional row.
- For bank and deposit activity imports with a `value date`, the imported row's
  statement/checkpoint date is the value date. The original transaction date
  remains visible as event-date context so budgeting and reconciliation can be
  checked without moving a later-cleared row into an already closed statement.
- A transfer ledger entry is still one ledger entry; a full transfer usually
  needs a matched pair of entries linked by a transfer group.
- The ledger owner is the person attached to the bank/account-side record. A
  row is shared in Entries only when it is linked to a `split expense`.

### Bank Certification Status

The trust state of a ledger entry's bank-facing facts. This status explains
whether the row is still provisional working data or has been proven by a final
statement.

Canonical term:
- `bank certification status`

UI states:
- `Manual provisional`
- `Import provisional`
- `Statement certified`

A provisional entry the Apple Pay Shortcut or Ask saved names the tool in
its bank state chip instead (`Apple Pay · provisional`, `Ask · provisional`;
see `Added By`).

Storage states:
- `provisional`
- `statement_certified`

Important distinctions:
- `Manual provisional` means the row is provisional and has no import batch.
- `Import provisional` means the row is provisional and came from a working
  import such as CSV or XLS.
- `Statement certified` means a supported final statement is the authority for
  the row's bank-facing facts, including statement-owned date lanes.
- The UI shows three states, but storage only needs two raw values because
  `Manual provisional` versus `Import provisional` is derived from whether the
  provisional row has an `import batch`.
- Entry reconciliation uses a status-based match isolation guard. No incoming
  bank row can reconcile against an existing `statement_certified` ledger entry
  in the promotion/reconciliation lane.
- Mid-cycle imports such as CSV or XLS can only reconcile against
  `Manual provisional` ledger entries.
- To prevent cross-bank false positives on high-velocity recurring charges,
  mid-cycle imports only match pending manual entries. However, official PDF
  statement imports can match against mid-cycle provisional entries to elevate
  them to certified status.
- Official PDF statements can also supersede import-provisional rows that are
  not present on the statement, but only when the statement reconciliation math
  identifies the superseded rows exactly. Manual provisional and
  statement-certified rows are not removed by this path.
- Those status guards do not block exact duplicate suppression. Repeated bank
  files should still auto-skip a row that is already present in the ledger,
  even if that ledger row is import provisional or statement certified.
- A `statement_certified` entry cannot be deleted on its own: a statement
  certificate counts it. Rolling back the statement import is the way to
  remove or restore it.
- Inside a saved statement period (a `statement checkpoint` covers its
  account and date), a `statement_certified` entry's bank facts are locked:
  account, transaction date, posted date, description, amount, and the
  direction the money moved. The lock compares the signed amount
  (`getSignedLedgerAmountMinor`): `income` and transfer `in` add to the
  balance, `expense` and transfer `out` take from it. Refiling within one
  direction (income <-> transfer in, expense <-> transfer out) changes no
  certified balance, so it is the app's reading of the row, not a bank fact,
  and stays editable like category, note, ownership and splits. A change of
  direction (expense <-> income, transfer in <-> transfer out) is refused.
  The refile leaves the certificate and the `statement_certified_previous_*`
  state underneath it unchanged, and a later copy of the same statement still
  finds the row already certified, because certified cover matches on the
  signed amount.

### Entry Share

The per-person projection used to decide which person can see a ledger entry in
their direct view. For ordinary ledger entries this is a 100% direct owner
projection.

Important distinction:

- an entry share is not the source of truth for shared-expense settlement
- new ledger rows should use direct ownership and a real owner
- direct entry projection is derived from `transactions.owner_person_id`
- new shared-expense allocation should live on `split expense shares`

Canonical term:
- `entry share`

Relationships:
- belongs to one `ledger entry`
- belongs to one `person`

### Split-Linked Ledger Entry

A ledger entry that is connected to a split expense through
`split_expenses.linked_transaction_id`.

Important distinction:

- this is the Entries-page meaning of `Shared`
- the ledger owner and bank-facing facts remain on the ledger entry
- the split allocation and group live on the split expense and its shares
- deleting or unlinking the split expense removes the shared Entries attribute
  without rewriting the ledger owner. A deleted (archived) split keeps its
  `linked_transaction_id` only so a restore can bring the link back; it does
  not count as the entry's split in any projection (Entries, Month, Summary,
  month totals), and the entry can be added to or matched with a new split
- a ledger entry has at most one active split expense (and a transfer at most
  one active settle-up). The database holds this with a partial unique index
  on `linked_transaction_id` where `deleted_at IS NULL`, so when two writes
  race (add to splits, match, restore, a Shared owner save) the later one is
  refused as a whole with the same "already linked" message the check before
  it gives
- adding an entry to splits, matching a split to it, deleting or restoring
  its split, editing the split's shares or payer in Splits, and a Shared owner
  entry save change how person views count the entry (share versus full
  amount, or which share), so each of those writes puts the entry's event
  month refresh marker in its own batch and refreshes the stored month totals
  after it. A Shared owner save writes the entry and its split in one batch
- changing the entry's amount moves the linked split expense with it in the
  same write: the split total becomes the new ledger amount and the shares are
  rebalanced by the split's stored basis (see `split expense share`). A
  cross-currency split keeps its own total and shares and only updates its home
  amount and FX rate
- every home-currency projection of a linked entry (the viewer share on
  Entries, Month actuals and charts, Summary, the stored person month totals)
  counts each person's share of the ledger amount. For a same-currency split
  that is the stored share. For a travel split it is the person's home share
  (see `split expense share`), never the split-currency share read as SGD: a
  JPY 10,000 split 50/50 on an SGD 93.01 row counts 46.50 for Tim and 46.51
  for Joyce, not 5,000.00
- a Shared owner save that rewrites the split follows the same currency rule:
  a travel split (recorded in its own currency, such as JPY, and matched to a
  home-currency card or bank row) keeps its currency and total, only its home
  amount and FX rate take the entry's amount, its group is checked against
  the split's own currency, and a new share basis divides the split's own
  total
- a split record links to one ledger row at a time: when the same split is
  matched to two rows at once, the later match is refused as a whole ("This
  split expense is unavailable or already linked.") and writes nothing, not
  even a month refresh
- the split mirrors the entry's event date (`transaction_date`, never the
  posted date), description and payer (the entry owner, else the account
  owner): these are copied when the entry is added to splits, and an entry edit
  copies a change to them in the same write while the split still holds the
  entry's previous value. A split value that already differs (edited in Splits,
  or recorded there before a bank match) is the split's own and is kept
- the split's note, category, group, share basis and travel-currency
  conversion are split-owned: an entry edit never changes them. Note and
  category are copied at creation and afterwards only through the explicit
  "update both" sync prompts

Related but separate concepts:

- `ledger entry`
- `entry share`
- `split expense`
- `split expense share`

### Entries Totals Strip

The compact metrics row at the top of the Entries page. These labels are page
summary terms and should keep stable meanings across UI copy, docs, and
scenario tests.

Canonical terms:
- `entries totals strip`
- `spend`
- `transfer-out total`
- `outflow`

Definitions:
- `spend` means the total of expense rows less any `category offset`
  (paybacks and refunds under a spending category). It excludes transfer
  entries.
- `transfer-out total` means the gross sum of ledger entries where
  `entry_type = 'transfer'` and the transfer direction is out of the current
  account.
- `outflow` means `spend + transfer-out total` for the current filtered view.
  It exists so transfer-outs are visible without mixing them into category
  spending.

Person-view rule:
- when a person view weights shared entries to that person's ownership share,
  the Entries totals strip may show both the gross ledger amount and the
  weighted visible amount in parentheses, but the definition of each metric
  stays the same.

### Summary Range And Month Choice

What the `Summary` tab shows. It is one tab for two pages: the Summary page
and the Month page.

Canonical terms:
- `summary range`
- `month choice`
- `All months`

Definitions:
- `summary range` means the run of months the header picks (route params
  `summary_start` and `summary_end`, DTO `rangeMonths`). Without both
  bounds the Worker ends it at the route's `month`.
- `month choice` means either `All months` or one month of the summary
  range. `All months` is the Summary page (`/summary`); one month is the
  Month page for that month (`/month?month=YYYY-MM`). A month choice pins
  the summary range into the URL so it stays fixed while months change.
- `All months` is the UI label for the whole summary range (it replaced
  Spending Mix's "Range overall" chip). The old `summary focus`
  (`summary_focus`) is retired.

### Lead View

How the Summary and Month lead reads a period: against the plan, or plainly
as money in and money out. A display preference, never data.

Canonical terms:
- `lead view`
- `Plan` (UI label; code `plan`)
- `Simple` (UI label; code `simple`)
- `earned`

Definitions:
- `Plan` is the lead as it was: the `money job` spend against its plan, the
  savings bar with its plan bar, the money jobs line, and the Income and
  Saved figures with their plan and target; on Summary, Intent vs Outcome.
- `Simple` is for a household that keeps no plan: `earned` (the period's
  income) and spent (the spend job's spending, the same figure as Plan's
  "Spent"), the same savings bar without its plan bar, and nothing about a
  plan; on Summary, "Earned vs spent by month" replaces Intent vs Outcome.
  Both views read one split of the period's money (`splitMoneyUse`), so
  they always agree. Month's plan tables stay in both views.
- `earned` is the UI word for the period's recorded income in the Simple
  view and the savings bar ("All you earned"). It is recorded money, never
  a forecast.
- The view is the whole page's mode on Summary and Month, not only the lead.
  In `Simple`, Summary keeps Spending Mix, Wallets in view and Money insights
  (without the insights about the plan, `plan-signals.ts`); Month keeps its
  Spending Mix, notes and accounts and shows `Money in` (what came in, one
  row per source) where the plan tables are, with "Plan this month" to go
  back to Plan. Entries, Splits and Ask do not change.
- The default is `Simple` for anyone who has never chosen, whether or not
  the period has a plan. A person's choice wins over the default and is one
  choice for both pages, set from the switch on the page or from Settings >
  Summary view (the same preference). It belongs to the signed-in
  login (the verified Cloudflare Access email): stored in `app_settings`
  under `viewer_preferences:` and a SHA-256 of the email (never the email),
  read back on the app shell (`leadView`). Without a login (the demo, local
  development) it is kept on the device (`monies-map:lead-view`), which is
  otherwise only a first-paint cache.

### Ask Page

The one page where a person adds an entry by hand, from a typed sentence or
from a receipt photo, and sees what changed since they last looked
(`/ask`; flow in `docs/flows/ask-flow.md`). Reached from the `Ask` tab (chat
mode), the Entries + button and the Splits receipt button (add mode) and the
Apple Pay Shortcut's link (a saved entry's card).

Canonical terms:
- `Ask page` (user-facing tab: `Ask`)
- `chat mode`: opened from the tab, with the `since you last looked` card
- `add mode`: opened to add one entry, with an `entry card` from the start
- `since you last looked`: the Summary check-in's headline for the view,
  read from data already loaded; never a fetch or AI call on open
- `chip row`: the one row of suggestion buttons above the composer
- `composer`: the message field, holding a `+` (take or choose a photo,
  or paste) and the mic, with the send (or Save) button beside it
- `voice input`: words spoken through the composer's mic, put in the
  message field for the person to check and send; never sent by itself.
  The browser's own speech recognition first; a `voice clip` (at most 30 s,
  written down by the transcribe route) only in a browser without one
- `conversation`: what has been said on Ask (the person's messages, the
  page's notes, answers, the entry card and the words typed but not sent),
  one per way in. Kept for the browser tab (`Ask conversation store`,
  sessionStorage, never photos or audio) until `New chat`
- `filter request`: a typed request such as "serene's shared groceries last
  month", read by the deterministic `filter reader` into an `Entries filter`
  (month, view, scope, search words, categories, wallets, entry type and an
  optional amount limit). Never a guess: what could mean two things becomes
  a `follow-up question` with chips
- `answer card`: an Ask answer to a filter request. Its total and count come
  from the Entries page DTO through the Entries page's own filtering, so
  `Open in Entries` shows the same rows and total
- `From Ask chip`: the chip on Entries naming the filters an answer set; it
  goes back to the conversation, and its ✕ clears those filters
- `money question`, `money answer` and `check before an answer`: see
  "Money Question"

### Ask Turn

One message in the Ask conversation read into exactly one `turn action`
(`POST /api/ask/turn`; `src/domain/ask-turn.ts`; `docs/flows/ask-flow.md`
"AI first"). AI understands, the app validates, rules are the offline
backup.

Canonical terms:
- `turn action`: what the model chose, one of `draft_entry`, `edit_draft`,
  `add_entry_to_splits`, `draft_split_expense`, `draft_settlement`,
  `plan_change`, `answer_question`, `search_entries`, `open_page`,
  `ask_clarification`, `cannot_help`, and Phase 2's changes to saved data:
  `edit_saved_entry`, `recategorise`, `edit_note`, `link_transfer`,
  `split_group`, `review_matches`, `set_payment_way`, `edit_category`,
  `link_plan`; and `look_up`, a read-only lookup (see "Ask Habit") the route
  runs before the real action
- `change card` (`AskChange`, `src/domain/ask-turn-actions.ts`): a Phase 2
  change as the page shows it: each row that changes before and after, the
  entries it touches (count and first rows), the existing commands it saves
  through (`ASK_CHANGE_PATHS` only) and its Undo where the command can take
  it back; a change over 10 entries needs the person's "Yes, change all N"
- `blocked`: what Ask never does (deleting entries, months or imports,
  importing or undoing an import, reconciling, accounts, people); the model
  can only name it, and Ask says why and opens the page that does it
- `turn context`: what the model reads with the message: the page, view,
  scope and month, the people in household order, wallet, category, split
  group and plan line names, and the `focus`. Names only: no account, card,
  phone or ID number and no amount from the household's records
- `focus`: what the message is about: the saved entry (the Apple Pay card,
  a card saved in this conversation; loaded by id from the household's own
  rows), the card being filled, the split group Ask was opened for, a
  Money insights line, or the Entries answer Ask showed last (its month,
  words and categories)
- `turn reply`: the validated action as the page shows it: an `Entry
  Draft`, a change to the card, a `split proposal`, a `settlement draft`, a
  `Plan Draft`, a `Money Question` (as one sentence the answer reader
  reads), an Entries filter, a page to open, a question back with at most
  4 chips, or a note
- `split proposal`: a saved expense onto Splits with its payer (the
  entry's own) and each person's share (percent, amount or all), every
  figure from the entry's amount; saved only by Add to Splits through
  `POST /api/splits/expenses/from-entry`
- `settlement draft`: a settle-up payment from one person to the other
  with the amount the person wrote; saved only by Record payment through
  `POST /api/splits/settlements/create`
- `rules backup`: AI off, over its allowance, failing or unusable: the
  page reads the message with the rule readers (plan request, money
  question, filter, entry draft), with a one-line note once per
  conversation

### Money Question

A free-form question about the household's money that is not a filter
request, answered on the Ask page from the figures the screens already
show (`POST /api/ai-assist/answer`; `docs/flows/ask-flow.md` "Money
questions"). Example: "why was August so expensive?" answers with
August's Actual spend against its plan, the change from July, the largest
categories and the biggest single costs, and chips to Entries and Month.

Canonical terms:
- `money question`: read by rules (`src/domain/ask-answer-intent.ts`) into
  one of nine `answer intents`: `spending` (why, or where the money went),
  `plan` (intent against outcome: how a month, or a period's months, went
  against the plan, "how did September go?", "did we stick to the plan in
  Q3?"), `compare` (two months),
  `biggest` (the largest expenses), `income`, `owed` (who owes whom on
  Splits), and the three `money job` answers: `invested`, `saved` (what
  was kept) and `spentVsEarned` (spending against what came in). Anything
  else is unsupported and gets the "not answered" note; a question with an
  amount, or a biggest or income question naming a category or wallet,
  stays a filter request
- `period`: a quarter ("Q3") or a range of months ("from Oct 2025 to Sep
  2026", at most 12) that the plan, spending, income and money-job answers
  add up month by month
- `money answer`: the answer card. Lead (the figure asked about, with the
  plan bar when there is a plan), Support chips (the plan, the other month,
  the largest shares), the `wording` (one to three sentences) and Detail
  lines, plus `links` to Entries (an Entries filter), Month or Splits
- `facts`: the figures behind an answer, pure reads of the Month page DTO
  (Actual spend and Planned spend cards, the summary month's income, the
  Spending Mix donut, the view's entries and plan rows) and the Splits page
  DTO seen by one person (open group balances and open settlement
  checkpoints)
- `check before an answer`: a high-confidence `skew candidate` that would
  change the facts, shown first with `Mark as settlement` (a settlement) or
  `Link as transfer` (an own-account move), and `It's real spending` (or
  income); the answer follows the person's choice
- `computed wording` and `AI wording`: the computed wording is always built;
  AI may phrase it from the facts only, and its text is shown only when
  every number and name in it is in the facts

Rules:
- the figures always come from the facts, never from AI
- skew first: spending, plan, compare, biggest and invested answers check
  spending skew, income answers income skew, saved and spentVsEarned
  either, and who owes whom any settlement candidate, for every month the
  answer covers
- a month with no entries is answered as such, never with another month
- resolving a check runs the candidate's suggested routes in order, from the
  person's tap; It's real spending writes nothing and is kept only in the
  conversation
- nothing about a question, its facts or its answer is stored on the server
- the plan answer speaks in the spend job's figures, as the Month and
  Summary lead do: spend without money moved to Investments or Savings,
  against the plan without the Savings target and the Investments rows
  (`splitMoneyUse`, `src/domain/money-jobs.ts`); the money-job answers
  read invested, kept, spending and each job's plan from the same split,
  with the Month page's `investmentMoves`. The invested answer lists the
  transfers into investment accounts with the entries filed under
  Investments, and says "Took out of investments" as its own line in a
  period that took more out than it put in
- the plan answer also carries its `outcome`: income received, Actual
  spend, Planned spend, the Savings target, money moved to Investments and
  Savings, the Investments plan rows and the transfers into and out of
  investment accounts (when there were any), the figures the Month and
  Summary savings bar splits and draws

### Insight Question

"Ask about this" on a Money insights line: Ask is asked "Explain: <the
line>" and answers with the insight's own facts (`docs/flows/ask-flow.md`
"Insight questions"; `src/client/ask-insight-answer.js`).

Canonical terms:
- `basis` (`SignalBasis`, `src/domain/money-signals/types.ts`): what a
  signal is based on, given by its builder: `lines` (a plain label with an
  amount the signal already worked out, or a short text value such as a
  wallet, a month or a date), the `entries` behind it (their ids, or a
  month with a category, a wallet or an entry type), and the `month` or
  Splits `groupId` it is about. Every signal that can lead the check-in or
  sit under Also has one; trivia and the long view do not
- `insight question`: the line as it was shown, its think line, the
  signal's primary figure and its basis, with the view, scope and month
  the page was showing
- `insight answer`: the card built from that alone (no request): the line,
  the figure it is about, the think line, the basis lines, the entries
  (through the Entries page's own filter) and `links`: Open in Entries,
  then the kind's follow-ups
- `insight explanation`: optional AI words (`POST
  /api/ai-assist/insight-explain`), one to three sentences from the
  insight's own facts only, shown only when they pass the Ask answer check

Rules:
- a basis line is a figure the signal already computed, never a new one;
  the card never shows a figure the line's page could not
- no forecast and no safe-to-spend: the follow-ups are pages and the money
  questions Ask already answers (with their check before an answer)
- AI only on the person's tap; personal numbers (six or more digits,
  NRIC / FIN shapes) are removed before the prompt; nothing is stored but
  the allowance counter

### Plan Draft

A typed change to one month's plan, made on the Ask page and not saved
until the person taps Save plan (`POST /api/ai-assist/plan-draft`, saved
through `POST /api/month-plan/apply-changes`; `docs/flows/ask-flow.md`
"Planning by chat"). Example: "move $50 from Shopping to Groceries in
October" drafts both month plan rows before and after and the view's plan
totals.

Canonical terms:
- `plan request`: the typed text read by rules
  (`src/domain/plan-draft-reader.ts`) into a month, an optional month to
  copy, and operations: `set` a line, `change` a line by an amount, `move`
  an amount between two lines, `add` a line. A plan request the rules
  cannot read may be read by the optional AI into the same structure,
  kept only when its names, amounts and months are the request's own
- `plan line`: a `month plan row` the view can change (the rows Month
  shows for the view), named by its label; the user-facing word for one
  row of a month's plan
- `plan draft`: the request resolved against the month's rows
  (`src/domain/plan-draft.ts`): each changed line before and after, the
  view's `plan totals` (Planned income, Planned spend, Remaining budget, as
  the Month cards add them) before and after, the plan-balance warning, and
  the `plan changes` Save posts
- `plan changes`: updates (with the amount the line held when drafted),
  new lines and deletes for one month, written all or nothing
  (`applyMonthPlanChanges`); the save returns the changes that undo it
- `plan question`: which month, which line (a name that fits two lines) or
  whose new line; asked with chips, answered by sending the same request
  again with the answer

Rules:
- nothing is written until Save plan; Discard writes nothing; AI never
  writes and never supplies a figure
- a plan draft is saved with the Month editor's own row and split
  statements, all its lines in one batch; a line changed since the draft
  refuses the whole save
- no month named means a question, never a guess; a line never goes below
  zero
- copying a month copies the view's lines; a line the target month already
  has takes the copied amount, the target month's other lines stay
- nothing about a plan request or draft is stored on the server

### Entry Card

One new ledger entry being put together on the Ask page before it is saved
(`src/client/ask-card-model.js`). It is not a ledger entry until the person
taps Save, which posts it through the same create path as the Entries
composer; an `entry draft` read from a sentence and a `receipt read` from a
photo only fill it in.

Canonical terms:
- `entry card`, with a `variant`: `expense`, `income` or `transfer`
- `filled in`: a field the sentence, a category rule, AI or the receipt
  supplied (marked with a dot until edited by hand)
- `question`: a structured follow-up a reader asked (which card, which day,
  how much in the card's currency); the client words it as chips
- `Splits switch`: share an expense with the other person on Splits, the
  composer's `Add to Splits` step
- `saved card`: the card after Save, with `Undo` (the existing delete
  routes)
- `client id`: the card's stable id, sent as the entry's external
  reference (`ask:<id>`), so saving the same card twice makes one entry

Rules:
- A transfer card posts one transfer entry (its From side, or its To side
  when turned round); the other wallet is shown for the later transfer
  match, not posted.
- Nothing about the conversation, sentence, photo, voice clip or spoken
  words is stored.
- A card saved again with the same client id (after a reload during its
  save) resolves to the entry already made; a new card, and the card Undo
  gives back, get a new id.

### Money Tone

How a displayed amount reads by its direction or outcome, decided in
`src/domain/money-tone.ts` and carried as `tone` on metric cards,
`balanceTone` on split group pills and `viewerTone` on split activity.

Canonical terms:
- `money tone`: one of `in`, `short`, `plan`, `caution`, `out`, `neutral`

Definitions:
- `in` means money in or a good outcome (income, a refund, received, owed to
  you, on or under plan, savings made, a matched statement).
- `short` means a deficit, over plan, income still to come, a debt you owe,
  or a statement that is off.
- `plan` means an intention: planned income, planned spend, a savings target.
- `caution` means something needs a check.
- `out` means an ordinary outflow; spending is not `short` by itself.
- `neutral` means transfers, zero and counts.

A money tone is presentation of a figure, never a figure itself: it does not
change totals, and hidden money shows every tone as `neutral`.

A category's `colorHex` is shown through the category palette
(`src/domain/category-palette.ts`): a stored former colour appears as its
calm counterpart; the stored value is not rewritten.

### Transfer Group

A linkage record that pairs related transfer ledger entries across accounts.
The group models the relationship; the money movement facts still live on the
entries themselves.

Storage:
- `transfer_groups`

Relationships:
- belongs to one `household`
- has many `ledger entries`, usually two matched transfer entries

### Split Workspace

The shared-expense settle-up subsystem. It is intentionally separate from the
household ledger so collaborative expense tracking does not distort imported
bank facts.

This is a conceptual subsystem, not a single table.

Core records:
- `split groups`
- `split batches`
- `split expenses`
- `split settlements`

Record ids: new split workspace records (groups, batches, expenses,
settle-ups, settlement checkpoints, history events) get
`<kind>-<creation time in ms>-<uuid>`, so two made in the same millisecond
never collide and ids of one kind still sort by creation time. Older
`<kind>-<ms>` ids and seeded names stay valid.

### Split Group

A named shared-expense context such as a trip, event, or household bucket.

Storage:
- `split_groups`

Relationships:
- belongs to one `household`
- has many `split batches`
- has many `split expenses`
- has many `split settlements`

### Split Batch

An optional archival or time-boxing container inside a split group. It allows
split activity to be grouped into open and closed periods.

Storage:
- `split_batches`

Relationships:
- belongs to one `household`
- may belong to one `split group`
- has many `split expenses`
- has many `split settlements`

A group settlement closes only the selected group's current batch. It does not
create a simplified settlement checkpoint or change another group's balance.

Rules:
- a closed batch is settled group activity: its expenses and settle-ups, the
  closing settle-up included, left the group balance because the settle-up
  paid them off. The settlement lock (under Settlement Checkpoint) applies to
  them while the batch stays closed, the same way as to a record in an active
  simplified settlement: amount, currency, shares, payer, date and group are
  kept, and the record cannot be deleted. A refusal names the batch
  (`split_settlement_locked` with `batchId`, HTTP 409)
- `Undo settle-up` (reopen the batch) is the one way to release them, offered
  next to the refusal and in the archived batch view. It keeps the settle-up
  (a real payment, maybe bank linked) as open activity and records a history
  event on it; the batch's records count in the group balance again. A group
  keeps one open batch, so when a newer batch is already open the reopened
  records join it and the next settle-up closes them together. Deleting the
  settle-up, or correcting it, is then an ordinary edit: editing a settle-up
  that stays in its group never closes its batch again; only moving it to
  another group settles that group's current batch
- a shared entry save that the lock allows keeps its linked split in its
  batch; it never moves a settled split back into the open balance

### Split Expense

A shared-expense record in the split workspace. It represents who paid, what
was paid, and how the cost should be shared. It may optionally link back to a
ledger entry, but it is not itself a ledger entry.

Storage:
- `split_expenses`

Relationships:
- belongs to one `household`
- may belong to one `split group`
- may belong to one `split batch`
- belongs to one `person` as payer
- may belong to one `category`
- has many `split expense shares`
- may link to one `ledger entry`

### Split Expense Share

An allocation of a split expense across participating people. This is the split
workspace equivalent of an entry split.

Storage:
- `split_expense_shares`

Rounding rule:
- percentage-based shares are stored as exact minor-unit amounts
- when the ideal split contains a half-cent, the app uses a deterministic
  balancing remainder by default, and the split editor can explicitly assign the
  odd cent to either person when matching an external split record
- the stored share amounts must always add exactly to the split expense total
- when the linked ledger entry's amount changes, the shares follow the new
  total by their stored `ratio_basis_points` with the same floor and balancing
  remainder. The split does not store whether a share was entered as a
  percentage or an exact amount, so an exact-amount share becomes the same
  proportion of the new total. An even split whose odd cent was assigned to one
  person (a stored 4999/5001 ratio) stays an even 5000/5000 split. An edit that
  keeps the amount leaves the shares, including an assigned odd cent, alone.
  When the split is settled (an active settlement checkpoint or a closed
  group batch) the amount edit is refused instead (see the settlement lock
  under Settlement Checkpoint)
- a shared entry save sends the split's stored first-share ratio back as its
  basis. That ratio is rounded (a 10.01 split 5.00/5.01 is stored as 4995,
  which floors back to 4.99), so a shared save that keeps the amount,
  currency and stored basis keeps the stored shares to the cent; only a
  different basis (or amount) rebuilds them. The settlement lock compares the
  same plan, so an unchanged shared save of a settled split is allowed and a
  real share change is still refused. For a travel split the plan is in the
  split's own currency and total, so an unchanged shared save of a settled
  travel split is allowed too

Home share of a travel split:
- a travel split's shares are in its own currency; its linked ledger entry is
  in the home currency (SGD). A person's `home share` is what that person's
  share would be if the split's total followed the ledger amount, exactly as a
  same-currency split's shares do: the stored basis applied to the ledger
  amount with the same floor and balancing remainder, in split-share people
  order (`homeCurrencyShareAmounts`, built on `rebalanceSplitSharesForTotal`).
  An even split stays even and the home shares always add up to the ledger
  amount
- the ledger amount, not the stored FX rate, is the source: the rate is
  rounded to basis points and would not add back up to the ledger row, while
  the ledger amount is the bank fact the home amount already follows
- the home share is a projection only. It is computed when the entry is
  read (`app-repository-entries.ts`), shared by every projection through the
  entry's `linkedSplitShares`, and never stored. The split keeps its own
  currency, total and shares, and its balances and settlements stay in the
  split currency
- an unlinked travel split has no ledger amount and no home share; it counts
  only in Splits, in its own currency

Split currency in charts:
- the Splits category donut sums open expenses per split currency. The SGD
  chart holds SGD expenses only, and each other currency with open expenses
  has its own chart in that currency (`donutChartsByCurrency`); the panel
  shows the chart for the active group's currency. Converting per group to
  SGD is not possible, because a cash travel expense has no FX evidence

Relationships:
- belongs to one `split expense`
- belongs to one `person`

### Split Settlement

A record that one person settled an amount with another person inside the split
workspace. It may optionally link to a ledger entry that carried the payment.

Storage:
- `split_settlements`

Relationships:
- belongs to one `household`
- may belong to one `split group`
- may belong to one `split batch`
- has one `from person`
- has one `to person`
- may link to one `ledger entry`

### Settlement Checkpoint

A person-level snapshot that simplifies open balances across multiple split
groups. It records the exact split records included in the simplification and
can be internally offset, matched to one real transfer, partially matched, or
reopened. A paid confirmation records that the people completed the repayment,
but it does not create, certify, or match a ledger transfer. Its membership is
record-based, not date-based, so a late or backdated split remains part of the
next open batch.

Storage:
- `split_settlement_checkpoints`
- `split_settlement_checkpoint_items`

Rules:
- a `settlement payment candidate` is the recorded payment between the two
  people for exactly what an open checkpoint still needs, within 14 days
  after it and not yet matched (the payer's entry, then the receiver's).
  The Splits check-in offers it as a To do; matching it is still the user's
  step (`paymentCandidate` on the checkpoint DTO)
- a paid confirmation moves an unmatched checkpoint to follow-up, not to a
  bank-matched state
- a later bank match remains required before the payment has ledger evidence
- undoing paid confirmation returns the same checkpoint to the active workspace
  without releasing its included rows
- settlement lock: while a checkpoint is active (any status except `reopened`
  or `voided`, paid or not), each included expense or settle-up keeps the
  facts the settled amount was computed from: amount, currency, shares, payer
  (from and to for a settle-up), date and group, and it cannot be deleted. A
  command that would change one is refused before its first write, as a
  whole, with `split_settlement_locked` (HTTP 409) naming the checkpoint:
  Splits edit and delete, and a ledger entry save whose linked split would
  follow (the amount follow-up, or a shared save that rewrites the split).
  Description, category, note, payment method and bank links stay editable.
  The same lock holds the records of a closed group batch (see Split Batch),
  released by `Undo settle-up`; a record in both is named by its checkpoint,
  the later step
- the only way to release locked rows is an explicit `Undo simplification`
  (reopen), offered next to the refusal. An edit never reopens a checkpoint by
  itself and a checkpoint is never left out of step with its rows: reopening
  releases every included row and may undo a paid or bank-matched
  settlement, which is too consequential to happen as a side effect of
  editing one row (the same reason paid confirmation and bank matching are
  explicit steps, and undoing paid refuses while a bank match exists)
- import rollback does not change a locked row's facts (checkpoint or closed
  batch): removing a linked entry only clears the split's ledger link, and a
  rollback that would restore a linked entry to a different amount (so its
  split would follow) is refused as a whole with `split_settlement_locked`
  until the simplification (or settle-up) is undone. A rollback that leaves
  the linked entry's amount alone is never blocked. The same holds for a
  statement rollback that re-creates an entry the statement superseded and
  re-links its split: a split whose amount was changed while it was unlinked
  would follow the entry, so a settled one refuses the rollback

### Split Activity History

A chronological audit trail for consequential split changes. Deleting a split
expense or settlement archives it and records an event; restoring it reactivates
the same record ID, shares, currency, group, and ledger link when present.

Storage:
- `split_activity_history`
- `split_expenses.deleted_at`
- `split_settlements.deleted_at`

Rules:
- active split projections exclude archived records
- history is household-scoped and ordered newest first
- restore is allowed only for an archived record and never creates a duplicate
- a delete or restore takes effect once: when two requests for the same
  record pass their checks together, the later one is refused as a whole
  ("This split is already in activity history." / "This split is already
  active.") and records no second history event
- an archived record does not hold its ledger row; restoring it is refused
  while another active split record (or a settlement checkpoint match) holds
  that row
- checkpoint snapshots remain unchanged when a record is deleted or restored;
  a record in an active checkpoint or a closed group batch cannot be deleted
  (settlement lock above)
- `Undo settle-up` records an `updated` event on each settle-up of the
  reopened batch
- a record archived before its batch was settled was not paid by that
  settle-up: restoring it brings it back into the group's open batch

### Skew Candidate

A read-only flag on ledger entries that are most likely money moving inside
the household, yet are still counted as spending or income, so a month's
figures are off by that amount until someone links them. Example: a
simplified settlement says Ethan pays Serene $182.45; days later that PayNow
is imported as an expense in `Other` on Ethan's account and as income in
`Other - Income` on Serene's, and the month's spending and income are both
$182.45 too high until the pair is linked as a transfer and matched to the
checkpoint.

Skew candidates are found deterministically (`src/domain/skew-candidates.ts`),
never by AI, and nothing is written: resolving one is always an existing,
explicit action. Anything that explains a month's figures (such as a future
chat) should check them first, so it does not explain skewed data.

Canonical term:
- `skew candidate`

Kinds:
- `settlement`: an unlinked outflow from the payer's own account and/or an
  unlinked inflow into the payee's own account for exactly the remaining
  amount of an open `settlement checkpoint` (status open or partially
  matched), dated within 5 days of its settlement date; or for exactly an
  open split group balance, dated on or after the group's last open activity
  and within 14 days of it. Payer and payee come from the checkpoint or the
  balance (as the Splits page computes it). Checkpoints are tried before
  group balances. One side alone is still a candidate (the other person's
  account may not be tracked or imported yet)
- `own_transfer`: an unlinked outflow and an unlinked inflow of the same
  amount between two different accounts owned by the same person, at most
  3 days apart

Rules:
- exact amount and the same account currency, with no minimum amount (the
  same as linking a transfer pair and matching a checkpoint)
- only accounts owned by one person take part; a joint account never does
- an entry in a `transfer group`, linked to a split expense or a split
  settlement, or matched to a settlement checkpoint is never a candidate
- each entry is in at most one candidate, paired by nearest date then id, so
  the same data always gives the same candidates
- the candidate's `skew` is what its entries dated in the month add to the
  view's spending and income now, by the category offset rules (a person
  view counts that person's entries in the scope, as Summary does). A
  candidate that skews nothing in that view and month is left out: two
  unlinked transfer entries count nowhere and stay with the Settings
  transfer review, and a settlement filed under the same spending category
  on both sides nets to zero for the household while still skewing each
  person's view
- `confidence` is `high` when both sides are found or the one side's
  description names the other person, otherwise `medium`; an own transfer
  with two equally close receiving entries is `medium`. A `medium`
  settlement (one side, naming nobody) is left out of the response and its
  totals unless the caller asks with `include=medium` (for a later review
  screen); it still holds its entry, so pairing is the same either way
- each candidate lists its reasons (same amount, days from the settlement or
  apart, whose accounts, names in the description, how each entry is
  counted) and the existing routes that resolve it, in order: link as a
  transfer (`/api/transfers/link`) or refile a single side as a transfer
  (`/api/entries/update-classification`), then match the checkpoint
  (`/api/splits/checkpoints/match`) or record the group settle-up
  (`/api/splits/settlements/create`, then link it with
  `/api/splits/matches/link-settlement`)

Storage:
- none: a projection served by
  `GET /api/skew-candidates?view=&month=&scope=&include=medium`
  (`SkewCandidatesDto`, `include` optional), never part of a page DTO

### Monthly Note

A note attached either to a summary scope or a specific month. Notes preserve
human context for later review and analysis.

Storage:
- `monthly_notes`

Relationships:
- belongs to one `household`
- may belong to one `person` as author

### Month Plan Row

An editable planning row for a specific month. This is the canonical planning
entity for incomes, planned items, and budget buckets.

Canonical term:
- `month plan row`

Storage:
- `monthly_plan_rows`

Sections:
- `income`
- `planned_items`
- `budget_buckets`

Relationships:
- belongs to one `household`
- may belong to one `person`
- may belong to one `category`
- may belong to one `account`
- has many `month plan row splits`
- may link to many `ledger entries`
- may have many `month plan match hints`

Important distinctions:
- A month plan row is an input or planning record, not a derived rollup.
- `planned item` and `budget bucket` are section types, not separate top-level
  entities.

### Month Plan Row Split

An allocation of a shared month plan row across people.

Canonical term:
- `month plan row split`

Storage:
- `monthly_plan_row_splits`

Relationships:
- belongs to one `month plan row`
- belongs to one `person`
- Shared month plan allocation still exists internally in storage and
  calculations, but it is not currently an actively supported first-class
  user-controlled Month UI feature.
- If this model was introduced earlier, the current product no longer exposes a
  clear dedicated control for users to manage those split ratios directly.
- Treat shared month plan allocation as retained internal behavior for now, not
  as a prominent product-facing workflow.

### Plan-Entry Link

An explicit link between a month plan row and one ledger entry. These links are
how planned-item actuals are resolved against real activity.

Canonical term:
- `plan-entry link`

Storage:
- `monthly_plan_entry_links`

Relationships:
- belongs to one `month plan row`
- belongs to one `ledger entry`

### Month Plan Match Hint

A reusable matching hint for connecting similar future ledger entries to a
month plan row pattern.

Storage:
- `monthly_plan_match_hints`

Relationships:
- belongs to one `household`
- may point to one `person`
- may point to one `category`
- may point to one `account`

### Month Snapshot

A generated monthly rollup used by dashboards and summaries. Snapshots are
derived state, not user-authored planning state.

Storage:
- `monthly_snapshots`

Relationships:
- belongs to one `household`
- keyed by `year`, `month`, and `person_scope`

Person month total and person views:
- a person's stored month total (`total_expense_minor` for `person_scope` =
  the person) is that person's own spend: every expense they own that is not
  linked to a split, at its full amount, plus their share of every
  split-linked expense (a travel split's home share, see `split expense
  share`). An entry that is someone else's direct expense never counts
- a person view counts entries by the same rule
  (`personEntryAmountMinor`, `person-entry-amount.ts`) in Summary months,
  metric cards and category charts, in the Month lead's spent figure,
  plan actuals and category chart, and in the Summary and Month Money
  check-ins (`filterEntriesForView`, `person-view-scope.ts`). The view's
  scope narrows it:
  `Direct ownership` (`direct`) keeps entries not linked to a split,
  `Shared` (`shared`) keeps split shares, `Direct + Shared`
  (`direct_plus_shared`) keeps both. Direct plus Shared always adds up to
  Direct + Shared, and a person's Direct + Shared actual spend equals their
  stored month total
- the household view counts every entry at its full amount whatever scope
  the route carries; it has one `Combined` scope
- a person has a stored month total for a month when they have a plan row,
  an income row, a month note, or an entry of their own there, a share of a
  split-linked entry included. The refresh removes the row once none is left

### Month Snapshot Refresh

A pending recalculation of one month's `month snapshots`. A write records it
in the same transaction as its ledger change, and the refresh that rewrites
the month's snapshots removes it in that same transaction. A refresh left
pending (for example after an interrupted request) is completed before the
next Summary or Month read. It carries no user data.

Storage:
- `monthly_snapshot_refreshes`

Relationships:
- belongs to one `household`
- keyed by `month_key` (`YYYY-MM`)

### Monthly Budget Record

A compatibility-level planning table that still exists in storage but is not
the preferred planning abstraction for new work. New product features should
anchor on `month plan rows` unless there is a deliberate migration or cleanup
reason to touch this older shape.

Storage:
- `monthly_budgets`

Relationships:
- belongs to one `household`
- may point to one `person`
- may point to one `category`

### Statement Reconciliation Certificate

A proof record that a statement import reconciled a specific account and period.
Certificates are evidence of successful certification, not the ledger facts
themselves.

Storage:
- `statement_reconciliation_certificates`
- `statement_chain_breaks` records a missing certified month after a middle
  statement rollback so later statements cannot silently skip the gap.

Relationships:
- belongs to one `household`
- belongs to one `import batch`
- belongs to one `account`

### Statement Mismatch Diagnosis

The deterministic explanation of a statement card's difference in the import
preview, with the actual rows behind it. It never writes and never uses AI.

Canonical term:
- `statement mismatch diagnosis`

Code:
- `src/domain/statement-mismatch-diagnosis.ts` (pure)
- DTO `StatementDiagnosisDto` on `ImportPreviewDto.statementDiagnosis`

Important distinctions:
- A statement gives the complete row list, so a card's difference is fully
  accounted for: `difference = opening gap + ledger entries in the period no
  statement row matched - statement rows in the period left out`. Each
  finding explains one part, and its `effectMinor` is the change to the
  difference once it is resolved.
- Finding kinds: `wrong_account` (a provisional entry on another account is
  the same purchase as a row in this section), `next_statement` (an entry
  with no posted date, dated in the last week of the period, not on the
  statement), `duplicate_entry`, `amount_differs`, `excluded_statement_row`,
  `opening_balance_gap` and `not_on_statement`.
- An `opening_balance_gap` carries a `missing_statements` fact when no
  statement is saved for the months between the account's last saved
  statement and this one. The fact names those months, the last saved
  statement's end date and balance, and this statement's previous balance,
  so the review says which statements to import first instead of "an earlier
  statement may be missing". It is only a fact: the gap stays the same
  finding, with the same effect and no fix.
- The search for a wrong-account entry covers the other cards on the same
  statement and the same owner's accounts at the same institution. It uses
  the preview's own matching rules (date lanes, the velocity rule, merchant
  similarity), so a moved entry is certified by the row that found it.
- Confidence is fixed by rules. `high`: strong evidence on one clear
  candidate, owners match, and the fixes together close every card they
  touch. `medium`: a near match, several candidates, an owner difference, or
  fixes that improve but do not close the card. `low`: weak evidence, or the
  entry is protected (statement certified, inside a saved statement on its
  current account, or linked as a transfer); never offered as a fix.
- A card's outcome is `resolved`, `partially_resolved`, `still_mismatched` or
  `needs_manual_review`, read from its difference after the suggested fixes.
- Entries dated after the statement closes stay provisional for a later
  statement. They are listed with the card, never counted in its difference.
- A mid-cycle (CSV/XLS) import gets findings without fixes: it has no
  statement balance to prove a fix against.
- After commit (Settings, "Compare statement") the same diagnosis runs in
  `committed` mode against saved statements: every card section of the
  uploaded statement is matched to that card's ledger, a move closes both
  cards' saved statements (`relatedEffectMinor` is the change on the
  destination), and a provisional second copy of a purchase the statement
  matched to another entry gets a `remove_duplicate_entry` fix. A fix that
  would unbalance a saved statement that matches now is dropped, with the
  fact `unbalances_saved_statement`.

### Statement Fix

A correction the statement mismatch diagnosis proposes and the user
approves. Approving it applies it to the preview at once; the import commit
writes it in its own batch; rolling the import back undoes it.

Canonical term:
- `statement fix`

Storage:
- `import_statement_fixes` (one row per applied fix, for the rollback)
- audit events `entry_moved_by_statement`, `entry_deferred_by_statement` and
  `entry_moved_back_by_rollback`

Kinds:
- `move_to_statement_account`: the commit moves the entry to the statement
  card that lists it, and that card's statement row certifies it. A move the
  statement would not certify is refused.
- `defer_to_next_statement`: the commit sets the entry's posted date to the
  day after the statement closes.

Important distinctions:
- Only an official statement (PDF) can apply fixes, and only to provisional
  entries that are not linked as transfers. The preview and the commit both
  check every fix against the ledger as it is then; a fix that no longer
  holds is refused, never forced.
- Rolling back a statement that moved entries off an account is refused
  while that account has a later statement, because moving them back would
  change it.

### Foreign Currency Estimate

An entry saved from an Apple Pay Wallet amount in another currency than its
account's, for example IDR 159,000 paid in Bali with an Amaze card that
charges a linked SGD card. Its `amount_minor` is an estimate in the account's
currency at the day's exchange rate; the Wallet amount is kept.

Canonical term:
- `foreign currency estimate`

Code and storage:
- `src/domain/foreign-currency.ts`
- `transactions.original_amount_minor`, `transactions.original_currency`
- `fx_rates` (the last rate per currency pair, a cache, not household data)

Important distinctions:
- The account's currency stays the ledger's currency; an entry is never saved
  in a currency its account does not use.
- The estimate is provisional like any manual entry. The card's statement
  carries the exact amount: a statement or activity-export row on the same
  account can be the estimate's purchase when its amount is at most 5% over
  it and at most 2% under it (at least 10 cents either way; the card's fees
  only add, and once an export has set the card's amount the next may move
  it 5% either way), and the day fits the velocity rule. A row that prints a
  different amount in the purchase's currency is never that purchase. The
  whole file is paired at once, surest first: a row that prints the
  purchase's own foreign amount ("Grab* ... IDR 166,600"); a row whose
  wording matches or whose cut-off shop name starts the Wallet name (Citi
  prints "AMAZE*E-MARTYONGS" for "E-MART Yongsan"; a payment gateway such
  as "AMAZE*EXIMBAYCO.," never counts as a shop), several purchases at one
  shop on one day pairing by size; then a payment-app row naming no shop
  ("AMAZE* GOPAYID") when it and the estimate are each other's only fit
  among the rows and estimates left. An ordinary card row ("SHOPEESGMP")
  near an estimate's amount is never taken for it without the shop's name.
- An estimate stays open until its statement: each activity export may
  update it to the card's latest interim amount (the same amount again is
  skipped as the same row), keeping the earlier link and amount for the
  rollback. Exports roll back latest first: an export whose estimate a later
  export updated is refused until the later one is rolled back. Entries an
  export brought in that are not estimates keep the mid-cycle isolation. Similarly priced estimates pair one to
  one, each with the closest amount; two estimates that both fit a row whose
  wording names neither are left for review. On commit the card's amount
  replaces the estimate (the statement keeps the estimate for rollback);
  the Wallet amount stays.
- No rate, no entry: when no usable rate exists the Shortcut is told to run
  again and nothing is saved.

### Receipt Read

The validated draft of what one shop receipt says: merchant, purchase date,
total and currency, the printed card's last four digits, bounded line items,
a confidence per field, and questions for the fields the user should check.
It is read either by the optional AI provider from an image the user
explicitly pasted, dropped, scanned or shared, or by in-browser OCR when AI
is off. It is never saved: it only pre-fills the normal entry editor.

Canonical term:
- `receipt read`

Code:
- `src/domain/receipt-read.ts` (validation, `receiptReadToDraftFields`)
- `src/domain/receipt-ocr-text.ts` (the no-AI reader of OCR text)
- `ReceiptReadDto` in `src/types/dto.ts`
- `POST /api/ai-assist/receipt-read` (`src/server/receipt-read-route.ts`)

Important distinctions:
- The app, never the model, decides what is a valid date (not more than a
  day in the future), a positive total, an allowed currency code and a card
  ending (only ever four digits). A question carries a reason and validated
  candidates; the model writes no wording.
- The image is discarded after reading: not stored, logged or cached
  anywhere, and the AI provider is called with gateway logging and caching
  off.
- A card ending pre-selects an account only when exactly one active account
  has that `last4`; otherwise Default account priority applies. A total in
  another currency than that account's is a currency hint, not an amount.

### Ask Habit

A small structured fact about what the household actually does and confirms,
kept so Ask can suggest, and for the safe set apply, the same thing next time
(`ask_habits`; `src/domain/ask-habits.ts`; `docs/flows/ask-flow.md`
"Hands-off"). Never learned from chat text: only from commands the person ran
(a category change, a new entry's category, Add to Splits) and confirmed
clarifications. Deterministic: no AI call.

Canonical terms:
- `habit`: kind `category` (shop to category), `split` (shop to the usual
  split: payer, the payer's share, group) or `alias` (a nickname to a
  person); keyed by the shop's normalised name with long digit runs removed
- `confidence`: counted since the last override. 3 or more consistent
  confirmations is `high` (Ask may apply a safe action), 2 `suggest` (a quiet
  row only), fewer or idle for a year `none`. An override (the person did
  something different, declined the suggestion, or undid what Ask did) resets
  the count to 0
- `safe set`: set a new entry's category, add a note the person asked for,
  add a new entry to Splits with the habitual split. Nothing else is ever
  applied without a Save
- `Let Ask handle safe things`: the Settings switch (default on)
- `suggestion row`: the one quiet line under a saved entry in Ask, "Food &
  Drinks · Add to splits 50/50 with Joyce, as you usually do", with a tick
  and a cross
- `nickname`: an `alias` habit; reaches the model as a fact

Code:
- `src/domain/ask-habits.ts` (rules, `autoApplyRefusal`), `ask-habit-plan.ts`
- `src/domain/app-repository-ask-habits.ts` (storage, all-or-nothing commands)
- `src/server/ask-habits-routes.ts`, `ask-auto-apply.ts`
- `src/client/use-ask-habits.js`, `ask-habits-ui.jsx`,
  `settings-ask-remembers-section.jsx`

### Done for you

The log of what Ask did by itself (the safe set), last 30 days, listed at the
end of the Ask conversation: what, which entry, when, Undo, and Stop doing
this for the habit behind it. Each line is an audit event (entity `ask_auto`)
written after the command; Undo uses the existing commands and counts as an
override. An entry changed since cannot be undone from here.

### Split Suggestion

The group and share Ask offers for a new expense that looks like the ones its
payer usually puts on Splits, asked as "You usually split this with {name}.
Add it to {group}?". Deterministic and read-only: a pure rule over the
owner's own expenses of the last 12 months, no AI, and it never writes; the
person answers it and the ordinary Splits switch (or Add to Splits on the
Apple Pay card) does the writing.

Canonical term:
- `split suggestion`

Code:
- `src/domain/split-suggestion.ts` (the rule, `SPLIT_SUGGESTION_POLICY`)
- `src/domain/pages/split-suggestion.ts` (loads the history)
- `SplitSuggestionDto` in `src/types/dto.ts`
- `POST /api/splits/suggestion` (src/index.ts)
- `src/client/ask-split-suggestion.js` (the card's side)

Important distinctions:
- The shop's own history decides (same normalised description, at least 2
  matching entries and 60% of them split in one group at one share). Only a
  shop with fewer than 2 entries falls back to the same category (at least 4
  entries, 75%), never Other or the income and transfer categories.
- A habit counts only when the owner paid and the split was shared between
  the owner and the other person only; mixed groups, tied habits, income,
  transfers, an entry already on Splits and other people's purchases give no
  suggestion.
- Ask offers only an even share, since the Splits switch saves 50/50.
- "Not this time" is kept on the card only; nothing is learned from it.

### AI Provider Status

One aggregate row about the optional Claude provider, kept so the app can
tell the household when Claude credits are running low or used up and ask
for a top-up in the Claude Console. The app cannot buy credits. Who sees it
is `AI_ALERT_EMAILS`: a list of Access emails, or `"*"` for everyone (what
`wrangler.jsonc` ships).

Canonical term:
- `AI provider status` (the row); `credit state` (its derived `ok`, `low`,
  `exhausted`, `capped` or `unknown`)
- `auto-balance` (the monthly pacing that orders the providers); `spend mode`
  (`claude_all`, `ask_only` or `basic_first`); `ask tier` (receipt read,
  entry draft, Ask answer wording) and `background tier` (monthly note, import
  explanation, category rules, statement fallback)

Code and storage:
- `src/domain/ai-provider-status.ts` (failure categories, spend estimate,
  state, viewer check, the three single-statement writes)
- `ai_provider_status` (one row, `provider = 'claude'`): last failure
  category (`credit_exhausted`, `spend_capped`, `auth`, `other`) and time,
  last success time, `estimated_spend_micro_usd` since the last top-up mark,
  and that mark's time and credit (`topped_up_credit_micro_usd`), plus
  `spend_month` (`YYYY-MM`, Asia/Singapore) and `month_spend_micro_usd`, the
  estimated Claude spend in that month, replaced by the next success of a
  new month (aggregates only)
- `GET /api/ai-assist/provider-status`,
  `POST /api/ai-assist/provider-status/topped-up`
  (`src/server/ai-provider-status-route.ts`); `AiProviderStatusResponseDto`

Important distinctions:
- Estimated spend is token counts from Claude's responses times configured
  prices (`AI_CLAUDE_PRICE_IN_PER_MTOK`, `AI_CLAUDE_PRICE_OUT_PER_MTOK`), not
  the Console balance. `low` means the estimate reached the warn amount;
  `exhausted` and `capped` come only from Claude's or the gateway's actual
  refusal (`credit balance is too low` / 402, or the gateway's 429), and a
  later Claude success returns the state to `ok`.
- A top-up mark is the owner saying how much credit they bought; it restarts
  the estimate and clears a `credit_exhausted` failure, not a gateway spend
  cap.
- Auto-balance is deterministic and uses no AI. The month's spend is
  compared with a pace line (`AI_CLAUDE_MONTHLY_TARGET_USD`, default 8,
  times day over days in the month): at or under it `claude_all` asks Claude
  first for everything; over it `ask_only` asks the basic model (Workers AI)
  first for background features and still Claude first for ask features; at
  90% of the target `basic_first` asks the basic model first for everything.
  The other provider is always the fallback, so a mode only changes the
  order. It also shows as `monthSpendUsd`, `monthTargetUsd` and `mode` on the
  status route and as one Settings line.
- Only owners listed in `AI_ALERT_EMAILS` (Cloudflare Access emails) see it.
  It is not household data: no prompt, image, response, error text or
  request id is stored, and it is not part of any page DTO.
- Shown in the app as the Claude credit notice on Ask (`low`, `exhausted`,
  `capped`) and the Ask and AI section in Settings
  (`src/client/claude-credit-model.js`, `claude-credit-status.js`,
  `claude-credit-notice.jsx`); "I've topped up" there is the top-up mark.

### No Longer Listed Entry

An entry an earlier activity export created that a later export of the same
account no longer lists, although the later export covers its date. An
activity export lists every charge the bank holds over its dates, pending
ones included, so the bank dropped it: usually a pending hold it released
(a Grab order held at IDR 502,200 before its discount, posted at IDR
375,500), or a charge it posted again at another amount, which then comes in
as the later export's own row.

Canonical term:
- `no longer listed entry`

Code and storage:
- `src/domain/import-no-longer-listed-entries.ts` (find, remove, restore)
- `ImportPreviewDto.noLongerListedEntries`; the commit takes the ones to
  remove as `noLongerListedEntries`
- `import_no_longer_listed_entries` (one row per removed entry, with the
  whole entry and its split links in `entry_snapshot_json`)

Important distinctions:
- The dates a file covers are, per account, its first to its last row's
  date. An entry dated before a later export's first row is not in question.
- Only an entry an export created and nothing else vouches for: provisional,
  not a foreign currency estimate, not a manual entry an export promoted,
  not a transfer. A purchase the user saved stays even when the bank row
  that updated it is gone.
- A foreign currency estimate an export updated from a row a later export
  no longer lists (Apple Pay saved a hold's amount, IDR 502,200; the card
  then charged IDR 375,500) is an unlisted estimate
  (`ImportPreviewDto.unlistedEstimates`). Its final charge prints another
  foreign amount, so it never pairs by itself: the preview offers the new
  rows of the same card within three days that print an amount in that
  currency, come from a payment app or name the shop. A row the user links
  updates the estimate as any export row does; left unlinked, the commit
  puts the estimate back on the bank facts it had before that export
  (usually its own saved amount; `kind = 'estimate_reopened'`, undone by
  the export's rollback).
- An entry any row of the file matched, skipped as a duplicate or left for
  review is still listed.
- The commit removes them unless the user keeps them (one choice for all),
  in the import's own batch. Rolling the import back re-creates them with
  their split links. An earlier export whose entry a later export removed is
  rolled back only after the later one.
- An official statement does the same at statement time through the
  statement reconciliation (superseded rows): a provisional export row the
  PDF does not contain is removed when the rows' total exactly explains the
  statement's difference. The export check catches it weeks earlier and
  does not depend on the totals.

### Statement Correction

A statement fix for data that is already saved, applied from the Settings
statement comparison. It is written at once, never automatically, and can
be undone. Not part of any import, so an import rollback never undoes it.

Canonical term:
- `statement correction`

Code and storage:
- `src/domain/statement-compare-projection.ts` (the diagnosis after commit,
  read only) and `src/domain/app-repository-statement-corrections.ts`
  (apply and undo)
- `statement_corrections` (one row per correction; a removed entry keeps its
  whole row in `entry_snapshot_json` for the undo)
- audit events `entry_moved_by_statement_compare`,
  `entry_removed_as_statement_duplicate` and `statement_correction_undone`

Kinds:
- `move_to_statement_account`: the entry moves to the card the statement
  lists it under. That card needs a saved statement for the month.
- `remove_duplicate_entry`: a provisional second copy of a purchase is
  removed because the statement matched the purchase to another entry with
  the same signed amount.

Important distinctions:
- Only provisional entries that are not linked as transfers; a removal is
  also refused for an entry linked to a plan, a split or a settlement.
- All corrections in one request together must not unbalance a saved
  statement that matches now.
- Undo moves an entry back only if it is still where the correction put it,
  and restores a removed entry only if its import is still in place.
- Rolling back an import is refused while a removal it covers is in place:
  both copies would be gone.

### Reconciliation Exception

A persisted balance-trust issue that remains open or resolved outside a single
import preview. It records problems that block or weaken confidence in a fully
trusted account balance.

Storage:
- `reconciliation_exceptions`

Relationships:
- belongs to one `household`
- may point to one `account`
- may point to one `ledger entry`

## Relationship Map

At a high level:

- a `household` contains the full graph
- `people`, `institutions`, `accounts`, `categories`, and rules are reference data
- `import batches` and `import rows` capture source traceability
- `ledger entries` are the normalized financial facts
- `entry splits` and `transfer groups` refine ledger-entry meaning
- the `split workspace` is a separate shared-expense workflow that can link back
  to ledger entries without replacing them
- `month plan rows` capture intent
- `plan-entry links` connect intent to actual ledger facts
- `month snapshots` summarize derived results
- `statement checkpoints`, `reconciliation certificates`, and
  `reconciliation exceptions` model balance trust and proof

## Synonym Guardrails

Use these terms consistently in future work:

- Say `ledger entry` or `entry`, not `transaction`, unless you are explicitly
  talking about the `transactions` table or compatibility code.
- Say `statement checkpoint`, not `balance snapshot`, for
  `account_balance_checkpoints`.
- Say `import batch`, not just `import`, when the batch boundary matters.
- Say `import row`, not `raw transaction`, for source rows before normalization.
- Say `entry reconciliation`, not only `duplicate detection`, when the task is
  to decide whether two source rows refer to the same economic event.
- Say `transfer group` for the link record and `transfer entry` for each ledger
  row inside the pair.
- Say `split expense` for the Splitwise-style record and `shared ledger entry`
  for a shared row in the ledger. They are related but not interchangeable.
- Say `shared ownership` when you mean the ledger-entry ownership state.
- Do not describe `shared` as a person or virtual household user.
- Say `month plan row`, not `budget row`, unless you specifically mean the
  `budget_buckets` section. `plan line` is the user-facing word for one in
  Ask's plan drafts, not a separate entity.
- Say `month snapshot`, not `monthly plan summary`, for generated dashboard
  rollups.
- Say `statement fix` for an approved correction from the statement check,
  not `auto-fix` or `auto-correction`: nothing is applied without approval.

## Current Canonical Boundaries

These boundaries are important enough to preserve explicitly:

- Source data vs normalized data:
  `import row` -> `ledger entry`
- Matching workflow vs proof workflow:
  `entry reconciliation` != `statement reconciliation certificate`
- Ledger ownership vs split workspace:
  `entry split` != `split expense share`
- Ownership type vs person identity:
  `shared ownership` != a third `person`
- Transfer linkage vs transfer facts:
  `transfer group` links transfer entries but does not replace them
- Skew candidate vs transfer group:
  a `skew candidate` only flags entries that look like an unlinked transfer
  or settlement; it never links, refiles or matches anything itself
- Planning vs actuals:
  `month plan row` != `ledger entry`
- Proof vs balance anchor:
  `statement reconciliation certificate` != `statement checkpoint`
- AI assistance vs financial fact:
  an `AI suggestion` is an optional, non-authoritative draft or ranking. It is
  never a ledger entry, category rule, statement checkpoint, reconciliation
  certificate, or transfer group until the user completes the existing review
  workflow.
- Entry draft vs ledger entry:
  an `entry draft` is a transient reading of a typed sentence with a source
  per field. It is never stored, and only the user's confirmation, through
  `/api/entries/create`, makes it a `ledger entry`.
- Money answer vs financial fact:
  a `money answer` restates figures the screens already show; its wording
  may be AI-phrased, but it never computes, certifies or changes a figure,
  and a `check before an answer` changes nothing until the person taps
  Mark as settlement or Link as transfer.
- Entry card vs ledger entry:
  an `entry card` (Ask page) is a draft on screen. It becomes a ledger entry
  only when the person saves it through the normal create route; a typed
  sentence, a receipt or AI only fill it in.
- Financial insight vs monthly note:
  a `Financial insight` is a transient explanation of the already-visible
  Summary, Month, Entries, or Splits figures. It updates with that view's
  filters and uses computed wording only (no AI rewording: the headline is
  the bold fact and its think line as written). It is not saved as a Monthly
  Note, does not recalculate totals, and never changes the ledger or plan. A
  financial insight speaks only of what its page counts: full cash flow on
  Summary and Month, the month's whole list on Entries (whatever filter is
  on), and settlement obligations on Splits. It never predicts spending and
  is never a safe-to-spend figure, a month-end balance or a savings target;
  its one look ahead is the `scheduled check` (see "Account Routine"). Its
  user-facing name
  is `Money insights` ("Household money insights", "Ethan's money
  insights"); code calls it the check-in (`money-signals/checkin.ts`,
  `FinancialInsight`).
- Money insights, check-in signal and signal kind:
  `Money insights` show one `check-in signal` as its headline: a small,
  deterministic rule over data the page already loaded that either fires
  with its numbers or stays silent (`src/domain/money-signals/`). Each
  signal has a `signal kind` (code name in brackets), shown as a chip in
  plain words: `To do` (`quick_fix`: makes the numbers right or settles an
  obligation: a statement gap, a card bill due within a week or overdue
  with no payment yet, a planned bill with no payment linked, a month's
  plan that spends more than its planned income (savings rows are part of
  its planned spend, never added again; month in progress or ahead only), a split
  balance, entries in Other, a trip still in Other, a settlement payment
  waiting to be matched, and the account routine's moved income, missed
  payment, own-account transfer counted as income and scheduled check),
  `Something to think about`
  (`bigger_question`: a pattern worth a decision; at most one at a time),
  `Worth knowing` (`worth_a_look`: may be fine but easy to miss, such as a
  card's bank charge with no reversal or a bank account's charges), `Going well` (`going_well`), `Fun fact`
  (`just_for_fun`: trivia from the user's own data, shown only when the
  headline is not a `bigger_question`) and `Big picture` (`long_view`: a
  quieter zoomed-out line: keep rate,
  cushion, fixed costs, same season, share of costs). A signal carries 3 to
  5 approved phrasings with the same numbers and one or more `ways to think
  about it` (think lines); each phrasing with each think line it may pair
  with is a `wording`. `Headline order` is kind, then money involved, then
  not recently seen; a `moment` (payday, a bonus, bills coming up, pace)
  comes right after the bigger question.
- Notability, steady signal and turn:
  a signal that is true almost every month (the five largest entries'
  share, the subscriptions total, months under plan, plan left, savings on
  plan) has a `notability` test for when its numbers are unusual. When they
  are not, it is a `steady signal`: it never leads, and is listed under
  "Also" only beside something notable. A steady signal may have a `turn`,
  one month of each quarter by the period, in which it may still lead. A
  period with nothing notable leads with a Going well that fires, otherwise
  the calm line.
- Period, year rule and trivia type:
  the `period` is the month a check-in is about: Month's and Entries'
  month, the last month of Summary's range, the current month on Splits.
  The `year rule`: for one page and view, nothing that rotates (the Just
  for fun line, a recurring signal's wording, which long view leads, the
  quote, the calm line) is shown for a period and again in the eleven
  periods before or after it. It is chosen from the period itself
  (`money-signals/rotation.ts`), never from visit time or browser memory.
  A `trivia type` is one kind of Just for fun line (`smallest`,
  `longest-run`, `payer`); each page places its types in twelve month
  columns, and a period reads only its own column (the type whose turn it
  is, then its reserves). Month and Entries share no trivia type.
- Cushion:
  the `cushion` is the Summary long view "bank balances would cover about N
  months of your usual spending": bank accounts only (never cards), against
  the range's average monthly actual spend. It is perspective, not a target.
- Visit memory, rest, quiet visit and sorted:
  `visit memory` is what one browser remembers about a page and view (and
  group on Splits): which signals were present and shown, when, and the
  numbers last seen. It only adds to the year rule (rests, what changed,
  sorted, quiet visits) and is never needed for it. It lives only in localStorage and is
  never sent to the server or AI. A shown headline `rests` for three days
  unless its numbers move by 10% or $50 (then it leads with the change); a
  `quiet visit` is a visit soon after the last one with nothing new, shown
  as one short line; `sorted` is the one-time Going well line when a quick
  fix clears.
- Money consequence map (retired):
  the `Money consequence map` was a row of cards under "See all insights"
  (money left so far, plan position, a same-season comparison, snapshot
  confidence and a one-repeat scenario). It was removed from every page in
  September 2026 because it repeated what the check-in signals already say;
  the one-repeat scenario went with it because it bordered on a forecast.
  Plan variance, the same-season comparison and bank-proof gaps are now
  only check-in signals (a Worth a look or Bigger question about the plan,
  the same-season Long view, the statement-gap Quick fix). Do not reuse the
  name.
