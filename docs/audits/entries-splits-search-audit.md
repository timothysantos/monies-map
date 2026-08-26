# Entries And Splits Search Audit

Date: 2026-08-26

## Decision

Ship lightweight URL-backed lexical search for Entries and Splits first.

D1 remains the system of record and supports normal SQLite-style SQL, `LIKE`,
JSON querying, generated columns, and indexes. It does not provide native LLM
search inside D1. Cloudflare's current AI search path is Workers AI embeddings
plus Vectorize, or AI Search on top of indexed content. Those are valid later
options for cross-month semantic search, but they are too heavy for the first
Entries/Splits search surface because both pages already load bounded current
month DTOs.

Sources checked:

- Cloudflare D1 SQL statements: `LIKE` search is supported.
  https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Cloudflare D1 index guidance: indexes reduce rows read for predicate-heavy
  queries and should be verified with `EXPLAIN QUERY PLAN`.
  https://developers.cloudflare.com/d1/best-practices/use-indexes/
- Cloudflare Vectorize: vector search stores/query embeddings for semantic
  search and retrieval workflows.
  https://developers.cloudflare.com/vectorize/
- Cloudflare AI Search: vector search is backed by Vectorize and Workers AI.
  https://developers.cloudflare.com/ai-search/configuration/indexing/vector-search/

## Current App Shape

- Entries route: `/api/entries-page` loads one effective month and the client
  already applies scope, wallet, category, type, and entry-id filters.
- Splits route: `/api/splits-page` loads one effective month and the client
  derives selected group activity, match review rows, balances, and date groups.
- Existing interaction guidance already says desktop Entries search belongs in
  the filter bar, mobile Entries search belongs in the filter sheet, and search
  must not be conflated with a sheet dismiss action.

## UX Contract

Mobile first:

- Entries search lives at the top of the mobile filter sheet.
- Splits search lives directly below the page header because group selection is
  already a separate high-frequency control.
- Inputs use native search keyboard behavior via `enterKeyHint="search"`.
- Clearing search is a one-tap icon button inside the field.
- Closing a mobile filter sheet remains `Close`; search is live and does not
  need an apply action.

Desktop:

- Entries search sits in the existing filter bar before wallet/category/type.
- Splits search is a slim row below the header and above group/activity
  content, so it does not compete with `Review matches`, `Settle up`, or group
  navigation.
- Search state is stored in URL params: `entry_search` and `split_search`.
  Back/forward, refresh, and shared URLs preserve the search.

Suggestions:

- Use native `datalist` suggestions from already loaded rows.
- Suggestions are deduplicated case-insensitively and filtered by the typed
  query.
- No network request is needed for suggestions in v1.

## Search Semantics

Entries search matches all query tokens against:

- description
- note
- wallet/account
- category
- owner and split people
- entry type and transfer direction
- date/posted date
- normalized amount text with and without thousand separators

Splits search matches all query tokens against:

- split activity description, note, group, category
- payer, settlement sender/receiver, share people
- linked ledger description/note/category
- manual/linked status
- date and normalized amount text
- match-review split side and imported-ledger side

Filtering is conjunctive across tokens. Example: `fairprice 42.80` matches a row
only when both tokens are present in its searchable text.

## Backend Growth Path

Keep v1 client-side while route payloads stay month-bounded. Move search to the
Worker/D1 only when any of these become true:

- the page needs cross-month or all-history search
- a month payload regularly exceeds the query budget in `docs/code-spec.md`
- search must page results independently from the month page

Backend v2 should add a dedicated `/api/search` route with D1 predicates and
indexes over canonical searchable columns. Use generated columns where the
searchable text is derived from JSON or frequently queried structured fields.

Semantic v3 should be opt-in, not the default:

- store canonical row references in D1
- write embeddings to Vectorize through Workers AI
- query Vectorize only for natural-language intent such as "kids medical
  receipts" when exact lexical search is insufficient
- merge semantic results back to D1 rows before rendering

## Tests Added

- Entries selector tests assert URL-filter-compatible search over merchant,
  account, type, and amount text.
- Entries suggestion tests assert deduped local suggestions.
- Splits selector tests assert activity search over descriptions, people, notes,
  and amounts.
- Splits model tests assert the same query filters group activity and match
  review candidates.
- Splits suggestion tests assert deduped suggestions across activity and
  matches.
