# Split Existing Ledger Linking Audit

Date: 2026-07-07

## Scope

- Existing split expenses and settlements entered before bank imports.
- Imported CSV/XLS/PDF ledger rows that may represent the same real-world item.
- Splits page review flow on desktop and mobile.
- Quick-entry URL account fallback order used by Apple Pay shortcuts.
- Summary spending mix card layout after donut category controls were added.

## Findings

- The app already had split match endpoints and DTOs, but the user-visible path was too easy to miss. Matches appeared only through a small review-mode link.
- Split match cards showed the imported ledger row but did not clearly compare it with the existing split record. That made the decision feel less trustworthy.
- Matching criteria lived inline in repository loading code. The thresholds were usable, but not isolated enough for future scoring improvements.
- The quick-entry URL handler could apply account priority, but Entries received shortcut settings only from `settingsPage`. Normal Entries loads did not have saved shortcut priority settings, so URL drafts could ignore the Settings order.
- Summary spending mix cards could still collapse category names and money text because the text button did not own the card's available width.

## Decisions

- Keep matching review on the Splits page. This is the right workspace because the user is deciding whether an existing split record should be linked to an imported ledger row.
- Surface pending matches as an explicit callout above the split activity list, with a direct action into match review.
- Render match cards as a two-sided comparison: existing split vs imported ledger row, plus confidence and date/amount deltas.
- Move split candidate scoring into `src/domain/split-matching.ts` so the repository loads data and the matching module owns thresholds/sorting.
- Load shortcut settings in the Entries shell and pass them to quick-entry URL handling without exposing the API key in that shell.
- Make summary spending mix cards use a true icon/content/action grid so category text gets a readable column on desktop and mobile.

## Tests

- Unit tests cover split expense and settlement candidate scoring, including a negative no-merchant-overlap case.
- E2E split review covers the callout, comparison labels, match metadata, and successful link into Entries.
- E2E shortcut settings covers API fallback and quick-entry URL account priority.
- E2E summary workflow guards against compressed spending mix card text.
