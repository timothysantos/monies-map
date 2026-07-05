# Category Match Suggestion Duplicate Rule Audit

Date: 2026-07-05

## Feature List

- Category match rules categorize future import preview rows from merchant text.
- Category match suggestions are created after repeated manual category
  corrections.
- Suggestions appear in Settings -> Category matching only when they still need
  review.
- Existing active rules now suppress pending suggestions that are already
  covered by that rule.

## Existing-State Findings

- `recordCategoryMatchSuggestion` already skipped new suggestions when an active
  rule categorized the edited description into the same category.
- `loadCategoryMatchRuleSuggestions` only checked pending status and source
  count, so older pending suggestions could remain visible after a matching
  rule was later created.
- The previous guard did not treat a longer same-category rule pattern as
  covering a shorter pending suggestion pattern. This allowed suggestions such
  as `MA MUM SINGAPORE` to remain pending even when `MA MUM SINGAPORE SG`
  already existed as an active Food & Drinks rule.

## Implemented Contract

- A pending suggestion is hidden when an active rule in the same category:
  - matches the suggestion pattern,
  - matches any saved sample description, or
  - has a normalized pattern that overlaps the normalized suggestion pattern.
- Inactive rules and rules for another category do not suppress suggestions.
- New manual corrections also use the same coverage check before inserting or
  reviving a pending suggestion.

## Test Coverage

- `tests/category-match-rule-suggestions.test.mjs` covers:
  - longer existing rule suppresses the shorter duplicate suggestion,
  - sample descriptions covered by an existing rule suppress the suggestion,
  - inactive and wrong-category rules do not suppress suggestions,
  - genuinely new merchant text remains visible.
- The full Settings e2e suite is run as a regression check for settings DTO/UI
  behavior.

## Residual Risks

- The stale pending row may remain in the database with status `pending` if it
  was created before the rule existed, but it no longer appears in Settings.
  A future maintenance task can physically mark hidden stale suggestions as
  accepted if the audit trail needs to distinguish them.
- Overlap matching is intentionally limited to same-category active rules to
  avoid hiding suggestions that may represent a correction away from an
  existing rule's category.
