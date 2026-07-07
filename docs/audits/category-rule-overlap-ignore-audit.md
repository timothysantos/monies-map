# Category Rule Overlap Ignore Audit

Date: 2026-07-07

## Summary

The duplicate and overlapping category match rule panel can now suppress a
specific issue pair without deleting either rule.

## Behavior

- Each issue is keyed by the sorted pair of rule IDs.
- Ignoring an issue writes to `category_match_rule_issue_ignores`.
- Settings loads ignored issue IDs and filters the generated duplicate issue
  list client-side.
- Deleting a rule deletes ignored issue rows that reference that rule.

## Tests

- `tests/settings-workflow.test.mjs` covers filtering one ignored duplicate pair
  while leaving other active issues visible.
