# Category list: search, best guess first, one component everywhere

Owner request (2026-10-15): the category list on an Entries row gets a search
field, the best guess first and every other category alphabetically; then
widened to every place a category is chosen. This note is the inventory, the
decisions and the numbers. Design: design.md "Category list". Vocabulary:
DOMAIN.md "Category Guess". Screenshots: `docs/audits/category-quick-pick/`.

## The one component

`category-picker-host.jsx` (first-screen, tiny) opens `category-pick-list.jsx`
(lazy) in a popover (`category-popover-content.jsx`, lazy) on a wide screen or
in the picker sheet (`picker-sheet.jsx`, lazy) on a phone. Order and search are
the pure `category-pick-model.js`. The native select cannot be searched, so
every place below that chose a category through one now opens this list.

## Inventory

| Place | Component | Behaviour chosen |
| --- | --- | --- |
| Entries row, category label | `EntryCategoryQuickPick` (`entry-category-quick-pick.jsx`) from `entries-list.jsx` | Popover or sheet, best guess, saves at once through `changeEntryCategory` (the Edit card's own command). New: the label was plain text. |
| Entries Edit entry card, Category row (wide inline card and phone sheet) | `PickerRow` with `categoryPick` | Same list, best guess from the entry's description. Choosing still raises the "Save this category?" prompt as before. |
| New entry form and the grid form's category (`entry-editor.jsx`) | `ResponsiveSelect` with `categoryPick` | Best guess from the typed description. |
| Entries transfer settlement ("This entry becomes", "Counterpart becomes") | `PickerRow` with `categoryPick` | Best guess from the entry's description. |
| Ask draft card, Category row | Ask's `PickerRow` with `categoryPick` | Best guess from the card's description. |
| Ask saved card, "Choose category" | `SavedCategoryPicker` | Same list under the card (popover) or sheet; best guess. The three suggested chips above it are chips, not a list, and are unchanged. |
| Month plan add a line and Edit details (also Plan Studio add a line, which uses the same sheet) | `month-plan-sheet.jsx`, `ResponsiveSelect` | Search and alphabetical only: a plan line has no entry description. |
| Month plan tables, inline Category (income rows and plan rows) | `ResponsiveSelect` | Search and alphabetical only. |
| Settings, category rule (add or edit) | `PickerRow` | Search and alphabetical only. |
| Settings, What Ask remembers (edit a category habit) | `PickerRow` | Search and alphabetical only. |
| Entries category filter (also in the phone's View and scope sheet) | `FilterMultiSelect` with `categoryPick` | Several choices stay checked, popover stays open with Clear and Done; the sheet keeps its Clear and Done bar. Search and alphabetical. |
| Imports preview, row table Category cell and the phone row sheet | `ResponsiveSelect` / `PickerRow` | Best guess from the row's description. "All categories" (the no-category choice) is pinned above the list and survives a search. |
| Splits, expense form (wide dialog, phone sheet) | `PickerRow` | Best guess from the expense's description. |
| Splits, linked entry dialog | `ResponsiveSelect` | Best guess from the entry's description. |
| Settings, statement compare (Fix direction, Add missing entry) | `ResponsiveSelect` | Best guess from the statement row's description. |

Looked at and left alone, with the reason:

- Summary and Splits "View and scope": there is no category filter there
  (Summary opens Entries filtered through a figure's menu, which uses the
  Entries filter above).
- Imports "bulk make these X" pickers: none exist.
- Settings > Categories list: names and edits categories, picks none.
- Imports column mapping ("category" column) and the unknown-category mode:
  they choose a file column or a mode, not a category.
- Plan Studio "Take from" selects: they choose plan lines, not categories.
  Those files (`plan-studio*.jsx`) are also being edited by another agent.

Where a native select was on a phone for the iOS wheel, it is now the picker
sheet the app already used for every other choice on a phone; the trigger is a
button named by its label and its value, so form accessibility is kept.

## Focus decision

A device with hover and a fine pointer focuses the search when the list opens.
A touch device does not (the keyboard would cover the list); the field is
visible at the top and a tap on it focuses it. Decided by
`(hover: hover) and (pointer: fine)`, not by width.

## Best guess: rules as built

1. The household's category rules: the first active rule that matches the
   description, by priority.
2. An Ask habit for the shop with high or suggest confidence.
3. The household's own entries at the same shop over the last 12 months: the
   most used category, at least 2 entries, the newest wins a tie.
4. The everyday-word map (`category-everyday-words.ts`).
5. Otherwise no best guess and no tag.

Other, Other - Income and Transfer are never a guess (a rule into Other is
skipped), a category the household lacks is skipped. No AI.

## Cost

- `POST /api/entries/category-guess` is read-only: one `db.batch` round trip
  of four statements (categories, active rules, the shop's habit by primary
  key, one history read on `idx_transactions_household_date` capped at 500
  rows). Asked once when a list opens, only where a description is in hand.
  `tests/category-guess.test.mjs` pins the round trip, the index and that
  nothing is written.
- No page response changed: the entries-page payload is unchanged.
- Nothing is sent but the entry's own description (at most 240 characters).

## Not covered

- Rule words in the search ("any category rule words if cheap"): the page does
  not hold the rules, and a fetch just to search is not cheap. The everyday
  words and the best guess cover it.
- "Most-used categories first" for contextless pickers: skipped.
