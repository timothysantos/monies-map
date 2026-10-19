# Codex commits polish review (2026-10-20)

A review of the 20 commits made on `master` between 2026-10-16 and
2026-10-19 (`ef7caf18..087b4637`, from "Show active filters and contextual
actions in the phone island" to "Add actual spending to the plan chart").
Every diff was read; the changes were seen on the demo seed at 390 px, 768 px
and 1440 px in 70s Warm light and dark, 60s Mod light and dark and Black &
White dark (isolated stack, `E2E_PORT_OFFSET` 2010).

Screenshots are before (at `087b4637`) and after (this branch), demo data only.

## Fixed

| Item | From commit | What was wrong | Fix | Screenshot |
| --- | --- | --- | --- | --- |
| Direction button icons | 04d63b93, 96e9792b | Go to top / Go to bottom drew two text glyphs (`⌃` U+2303, `⌄` U+2304; earlier `↑`/`↓`), sized by font, sitting high in the circle and drawn differently by each font | lucide chevron-up / chevron-down at the island month arrows' 19 px and 2.2 stroke (`scrollFabIcon`); guard `tests/scroll-direction-fab.test.mjs` | [01](01-direction-button-icon-surface-phone.webp), [03](03-direction-button-desktop.webp) |
| Direction button surface | 04d63b93 | Background read `--accent-soft`, which no stylesheet defines, so the button was see-through over the list (plus 0.84 opacity) | Island chrome: `--chrome-surface`, `--line`, `--chrome-shadow`, arrow colour `--accent` | [01](01-direction-button-icon-surface-phone.webp) |
| Direction button hidden on a phone | 04d63b93, ec61fe86 | At 144 px it sat behind the stacked island (context row on top), the From Ask chip and the Splits group bar (all z 58 over its 57) | Rests 16 px above each of them; e2e `phone direction button stays clear of …` | [02](02-direction-button-overlaps-phone.webp) |
| Desktop bar over the Ask field and + | 96e9792b, 5c67919d | Between 761 and 1225 px the floating bar (left, 760 px wide, Ask baseline) covered the Ask field and the + / receipt button | In that range the bar sits just above them (its first position in 96e9792b) and the direction button above the bar; beside a docked Ask it narrows; e2e `a narrow desktop window keeps …` | [04](04-narrow-desktop-bar-768.webp) |
| Duplicated desktop bar CSS | 96e9792b, 5c67919d | A second `min-width: 761px` block overrode every position of the first; `.desktop-splits-floating-label` unused | Merged into one block (1440 px Splits and the bar regions are pixel-identical before and after) | – |
| Desktop dialogs off centre (bug) | 76608b8e | `.note-dialog-content` lost `top: 50%` to the direction button's `bottom: 144px` (same edit); with `translate(-50%, -50%)` every desktop dialog sat high and a tall one ran above the window (Add to splits top at −108 px at 1280×720) | `top: 50%` restored; the Add to splits e2e checks the dialog is centred and whole | [05](05-desktop-dialog-centred.webp) |
| Undefined tokens on split choices | 0c4a02da, 500ef337 | Share and group choices read `--line-strong`, `--ink`, `--accent-ink` (none defined): no border at all, so 0% / 50% / 100% and the group cards were hard to see; desktop View and scope segments read `--accent-soft` | `--line`, `--text`, `--accent`, accent tint; `tests/colour-presets.test.mjs` now fails on any undefined token read (older reads of `--ink`, `--focus-ring`, `--line-strong`, `--muted-text` counted and may only fall) | [05](05-desktop-dialog-centred.webp), [06](06-split-choice-edges-phone.webp) |
| Reduced motion | 500ef337 | Split choices lifted 1 px and eased on hover regardless of reduce motion | Lift and transitions only with `prefers-reduced-motion: no-preference` | – (motion only) |
| Two copies of the share choices | 0c4a02da, ca9adf7b | The 0% / 50% / 100% control and its hint were written out in `entries-list.jsx` and `entry-mobile-sheet.jsx` | One `SplitShareChoices` (`split-share-choices.jsx`); same words and behaviour | – (no visible change) |
| Dead desktop group bar CSS, inline words | 04d63b93, 96e9792b | `.splits-group-bar` desktop rules never apply (the bar renders on phones only); "No open splits" and the settled batch count were inline strings | Rules removed; words moved to `splitsStripCopy` (same text) | – |
| Guide said the opposite | 04d63b93 | The user guide's phone section said the arrow goes to the top after scrolling down (the code, and the desktop paragraph, do the reverse) and called it translucent | Both paragraphs describe the same behaviour; design.md documents the button and the narrow-window bar | – |

## For the owner to decide (not changed)

| Item | From commit | What reads or looks off | Screenshot |
| --- | --- | --- | --- |
| Quick add squeezes the Splits row | ca9adf7b | On a phone the "Add Baby River · 50/50" button cuts the row's own action to "Add to s…". Options: put the quick add on its own row under Splits, or shorten it to "Add to Baby River". | [owner-quick-add](owner-quick-add-truncates-splits-row.webp) |
| Actual spending line repeats Spent | 087b4637 | In Plan the new "Actual spending" line is the Spent column's own figure (`actualMinor = realExpensesMinor`), drawn in the same rose over the bars' tops, so it adds a legend item without a new number. Options: drop it, or keep only one of Spent / Actual spending in Plan. | [owner-plan-chart](owner-plan-chart-actual-equals-spent.webp) |
| Desktop Month bar cuts the scope | 95f91554 | At 1440 px on Month, "Direct + Shared" shows as "Direct + Shar…" beside Plan / Simple and the month. | [owner-month-bar](owner-desktop-month-bar-scope-truncated.webp) |
| Wording | a2ad65c8, ca9adf7b, 0c4a02da | Naming rule: "The app will rerun all matching and coverage checks before you commit" (Citi account check) uses app words (matching, coverage, commit); the share hint "0% means Tim owes none; if they paid, they are owed the full amount" is hard to read; "Add Baby River · 50/50" uses a ratio where the rest of the app says "half"; "Copy link" and "Link copied" are hard-coded, not in a copy file. | – |
| Quiet failure of Copy link | 0c4a02da | When the browser refuses the clipboard, Copy link does nothing and says nothing. A fix needs new wording. | – |
| First-screen budget raised without a reason | 04d63b93 | `scripts/initial-bundle-budget.json` JS went 163,326 → 171,503 B gzip (and files 8 → 7, CSS 24,197 → 23,136) with no measured reason in the commit, against AGENTS.md. Measured now: see the branch report. | – |
| One-off capture scripts committed | ec61fe86, e8c517a0 | `scripts/capture-island-context.mjs` and `scripts/capture-contextual-actions.mjs` are review helpers with fixed ports; keep or remove. | – |

## Bugs noticed (reported, not changed)

| Severity | From commit | Bug |
| --- | --- | --- |
| Low | cb1cbc85 | Ask card: the wallet chip's tap is no longer gated on a draft (`onOpenField` for any status), so while a card is saving the draft wallet picker can open and change the card mid-save. Restore `isEditable \|\| isSaved` gating; needs a component test. |
| Low | 459ddc25 | `currentPerson` falls back to the payer of the saved entry in focus, so in the household view "my card" can mean the payer of the entry being discussed rather than the person asking. Worth a validator negative in `tests/ask-turn.test.mjs`. |
| Low | 7e85fa0d | The HSBC activity parser names a fallback account ("HSBC Visa Revolution") when no HSBC card is selected; a household without that account gets an unknown-account mapping step. |
