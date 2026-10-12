# States in Lead, Support, Detail: audit

Branch `states-lsd`. Every empty, loading and error state, and the FAQ page,
follow the language of the sheets and screen tops (design.md, "Lead · Support
· Detail" and "Shared States"): one clear lead, one quiet support line, and one
primary action where the thumb is. Status: awaiting owner approval of the
visuals (the code is shippable; the screenshots are the proposal).

Before and after screenshots (desktop 1280 px in Chromium, phone on the iPhone
13 profile in WebKit, the showcase demo data) are in
[`states-lsd/before/`](states-lsd/before/) and [`states-lsd/after/`](states-lsd/after/),
one file per state and device, for example `empty-entries.phone.webp`.

The screenshots use the 70s colours. Pairs, before then after (desktop and
phone for each):

| State | Before | After |
| --- | --- | --- |
| Loading, Summary | ![](states-lsd/before/loading-summary.desktop.webp) | ![](states-lsd/after/loading-summary.desktop.webp) |
| Loading, Summary (phone) | ![](states-lsd/before/loading-summary.phone.webp) | ![](states-lsd/after/loading-summary.phone.webp) |
| Loading the next page | ![](states-lsd/before/loading-pill.phone.webp) | ![](states-lsd/after/loading-pill.phone.webp) |
| Page failed (phone) | ![](states-lsd/before/error-page.phone.webp) | ![](states-lsd/after/error-page.phone.webp) |
| Screen crashed (phone) | ![](states-lsd/before/error-boundary.phone.webp) | ![](states-lsd/after/error-boundary.phone.webp) |
| Import inbox banner | ![](states-lsd/before/banner-import.desktop.webp) | ![](states-lsd/after/banner-import.desktop.webp) |
| Refresh failed banner | ![](states-lsd/before/banner-refresh.desktop.webp) | ![](states-lsd/after/banner-refresh.desktop.webp) |
| Entries, no rows (phone) | ![](states-lsd/before/empty-entries.phone.webp) | ![](states-lsd/after/empty-entries.phone.webp) |
| Entries, filters match nothing (phone) | ![](states-lsd/before/empty-entries-filtered.phone.webp) | ![](states-lsd/after/empty-entries-filtered.phone.webp) |
| Splits, no activity (phone) | ![](states-lsd/before/empty-splits.phone.webp) | ![](states-lsd/after/empty-splits.phone.webp) |
| Splits, no groups | ![](states-lsd/before/empty-splits-no-groups.desktop.webp) | ![](states-lsd/after/empty-splits-no-groups.desktop.webp) |
| Splits, search finds nothing (phone) | ![](states-lsd/before/empty-splits-search.phone.webp) | ![](states-lsd/after/empty-splits-search.phone.webp) |
| Imports, empty queue | ![](states-lsd/before/empty-imports.desktop.webp) | ![](states-lsd/after/empty-imports.desktop.webp) |
| Ask, empty chat (phone) | ![](states-lsd/before/empty-ask.phone.webp) | ![](states-lsd/after/empty-ask.phone.webp) |
| FAQ (phone) | ![](states-lsd/before/faq.phone.webp) | ![](states-lsd/after/faq.phone.webp) |
| FAQ guide failed (phone) | ![](states-lsd/before/faq-error.phone.webp) | ![](states-lsd/after/faq-error.phone.webp) |

## What changed

| State | Before | After |
| --- | --- | --- |
| Shell loading (Summary, Entries, Splits, any page) | One short white panel with a spinner and "82% · Applying latest data... · 2s", no header, the rest of the screen blank | The header and the page's own blocks as quiet placeholders (Summary: chips, lead card, insight lines, a chart card; Entries: totals, insight lines, filters, a day of rows; Splits: group row, lead card, rows), one support line, no controls, no figures |
| Loading the next page | A white card top right with the same technical line, over the period picker on a phone | One sky pill at the top right under the header, clear of the period picker; percent, detail and seconds in its tooltip |
| Page or screen failed (first load, after navigating, boundary, Entries, FAQ guide) | A white panel, grey title, the retry as one of two button styles | A rose card centred in the viewport: title, plain detail, quiet technical line, one full-width retry (Reload app is a quiet button beside it) |
| Refresh failed notice | A cream banner with two buttons of different styles | A butter banner: title, one support line, "Refresh now" primary (48 px), "Dismiss" quiet |
| Import inbox banner | The same cream banner | A sky banner with "Open import inbox" as the one primary action |
| Entries with no rows | One grey line | A lead card: "No entries yet." with the Add entry action; with filters on, "No entries match this view." with Reset filters |
| Splits with no activity, no groups, no search results | One grey line each (no groups: a lone + button) | A lead card each, with Add expense, Create group and Clear search |
| Spending mix with no spend rows (Month, Entries) | One grey line | Lead and support lines, no card |
| Imports queue empty | A dashed box of two lines | A lead card with the "Select file" primary, which opens the file chooser |
| Ask, empty chat | One grey line | The greeting as the lead and one quiet hint |
| FAQ | A long contents list above the guide on a phone; "Loading guide..." as plain text; a plain failure line | On a phone the contents fold into one 48 px row and the tabs are two equal segments, so the guide starts on screen; loading is the shared placeholders; failure is the shared rose card |

## New strings (everything else reuses existing copy)

- Entries: "No entries yet." / "Add one here, or bring in a bank file from Imports." / "Try fewer filters, or a different month." / "Spending shows up here once entries are recorded."
- Splits: "A group keeps the costs you share, like a trip or a home." / "Add an expense to start keeping track of who owes whom." / "Try a different word, or clear the search." / "Clear search". ("No split groups yet." already existed but was never shown.)
- Ask: "Type below, or tap a shortcut."

Removed from the screen: the loading panel's percent figure (now in the pill's
tooltip only) and the old "Loading..." spinner panel.

## Proof

- `tests/e2e/states-lsd.spec.js`: per state, with the page API stubbed to fail,
  hold or come back empty: the lead and support text and order, one primary
  action, thumb reach on a phone (at least 48 px tall, nearly full width, below
  the top third), hidden money (no figures or dots in a state), the placeholders
  match the page's blocks and carry no controls, the pill sits clear of the
  header, layout shift while the first load lands stays under 0.1, and the FAQ
  contents fold, tabs and guide states.
- Existing specs that touch these states still pass (consistent-states,
  screen-error-boundary, refresh-failure-notice, entries-load-failure,
  route-data-owner, reference-data-owner, header-tab-fit,
  import-inbox-navigation, month-spending-mix, faq-guide-tabs, faq-content,
  app-shell-chrome).
- Bundle: no budget change. The shared states' stylesheet rides with the entry
  chunk (`ui/states.css`, not counted by `check:bundle`); the superseded
  `.app-loading-*`, `.import-stale-banner` and `.import-intake-empty` rules were
  removed from `public/styles.css`, so the first-screen stylesheet shrank.

## Open questions for the owner

- The refresh failure banner stays in the page flow at the top; on a phone a
  docked bar above the tab bar would be nearer the thumb, but it would compete
  with the floating Add, eye and "View and scope" controls.
- On a phone the empty cards leave the right 52 px free so the floating eye
  button never covers the primary action.
