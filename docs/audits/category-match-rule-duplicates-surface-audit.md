# Category Match Rule Duplicate Surface Audit

Date: 2026-07-05

## Feature List

- Category match rules categorize future import preview rows from merchant text.
- Settings -> Category matching lets users create, edit, deactivate, and delete
  rules.
- Active rules can overlap when a broad merchant pattern and a more specific
  merchant pattern both match the same row.
- Active overlapping rules can also conflict when they point to different
  categories.

## Existing-State Findings

- Suggestions were filtered when an existing same-category rule already covered
  the pending suggestion.
- Existing rules themselves were only grouped by category, so a user could miss
  duplicate, broad, or conflicting active rules unless they manually compared
  every group.
- The existing edit and delete handlers were sufficient for the logical cleanup
  actions, but they were not surfaced next to detected duplicate pairs.

## Implemented Contract

- Settings -> Category matching now shows an explicit duplicate/overlap panel
  before suggestions.
- The panel includes active rule pairs that have exact normalized duplicates,
  same-category broad/specific overlaps, or cross-category overlaps.
- Cross-category overlaps are labelled as conflicts and sorted before
  same-category cleanup items.
- Each surfaced rule has direct edit and delete actions, so users can tighten a
  pattern, change category/priority/status, or remove a redundant rule.
- Inactive rules are ignored by duplicate detection because they do not affect
  import matching.

## Test Coverage

- `tests/settings-workflow.test.mjs` covers:
  - same-category broad/specific overlaps,
  - cross-category conflicts sorted first,
  - inactive and unrelated rules staying out of the duplicate surface.

## Residual Risks

- Detection is intentionally conservative and based on normalized pattern
  overlap. It may still surface legitimate broad/specific pairs that a user
  wants to keep. The direct edit/delete actions keep that review cheap without
  automatically changing rules.
