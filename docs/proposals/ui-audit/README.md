# UI audit against design.md

**Audit only, no app code.** Every route and state walked on a phone (iPhone 13,
WebKit, DPR 2, touch) and on a computer (Chromium 1280×800 and 1024×768) on the
`showcase` demo data, rated against design.md: Lead · Support · Detail, the pastel
palette, the money tones, person colour, the thumb zone, tappable chips and the
mobile sheet. The branch is `ui-audit` (PR #32), merged with `origin/master`
`d8221075`, which includes Ask, the desktop Ask dock, swipe-down sheets, the new
Ask cards, the Edit split card and auto-balance. Nothing was merged, deployed or
changed in `src/` or `public/`.

## 1. UNCOVERED: nothing redesigns these yet

Everything else in section 5 has an owner branch. These need one. Listed in the
order I would assign them.

| # | Surface (phone and desktop unless noted) | Why it matters | Suggested owner |
| --- | --- | --- | --- |
| U1 | **Desktop Ask dock field and panel vs page content.** The field floats over the bottom right of every page. On Imports it covers the **Commit import to ledger** button (`shots/d1280/imports-preview` shows it half under the field; the capture could not click it: "locator.click timed out" on `imports-flow`, so there is no desktop rollback shot); on Splits it covers *Review matches*, the *Match a transfer* select and the receipt button. (Four other desktop captures timed out on the first pass while the machine was overloaded and passed on rerun; they are not counted as evidence.) Page bottom room (96 px) is not applied to sticky bars or dialogs. | High: a blocked primary action | new small branch (shell), or `desktop-chrome-lsd` |
| U2 | **Summary body under the lead**: Spending Mix donut (percent labels collide with category bubbles), the category cards row, **Wallets in view** cards and their note triggers, the Summary insights panel and its expanded list | The lead is redone; the rest of the page is not | new "summary-body" slice after `summary-month-lsd` |
| U3 | **Money insights block** (Summary, Month, Entries, Splits tops): 250 to 300 px of the first phone screen, including the "quiet" case that still shows a headline, fun fact and "See all insights" | Pushes the real content under the fold; a Support-level object styled as a Lead-sized block | new "insights-card" slice |
| U4 | **Imports except the review preview**: inbox with the 3-step stepper, upload, paste rows or set defaults, the Done card, Recent imports history, rollback confirm, the desktop layout of all of these. `ui-language-round2-mockups` plans the file card, mapping, preview rows and commit bar only | Longest page in the app | extend `ui-language-round2-mockups` or a new slice |
| U5 | **Splits dialogs and panels**: Record settlement (Settle group), Create group, Split activity history, Archived batches, Edit linked entry, the Simplified settlement panel with its *Match a transfer* select and Mark paid, the Review matches inbox (`split_mode=matches`), the group picker | Native selects and date inputs, two-column label grid, centred Cancel; none is in `dialogs-lsd` or `splits-desktop-card` | add to `dialogs-lsd` |
| U6 | **Other dialogs and prompts**: Statement checkpoint (Reconcile) which is clipped on a phone, Set up this login (Shortcut), Reload data, Restore preview row (Imports), Set diagnostic post date (Imports), "Update connected note?" prompt, the Month Actions popover, Add income source / budget bucket / planned item forms, the Ask credit "topped up" sheet is in `dialogs-lsd` | `dialogs-lsd` lists 12 dialogs; these are the rest of `Dialog.Title` in `src/client` | add to `dialogs-lsd` |
| U7 | **Settings sections not in the round 2 mockups**: Categories list, Category matching (rules), Balance trust rules, Unresolved transfers, Recent balance activity, Error diagnostics, and every section's open state on desktop | Jargon (`credit_card`, slugs, `#499DA4`), 24 px edit and delete icons | extend `ui-language-round2-mockups` |
| U8 | **FAQ page** (user guide and developer guide tabs, contents list, article body, phone and desktop) | Not in any branch | new small slice |
| U9 | **Copy and naming sweep**: "Sept 2026" on a computer against "Sep 2026" on a phone; raw enums in Settings (`credit_card`, `bank`); category `slug` and hex shown to the user; the technical "Page load failed: Page request failed with status 503" line on the error screen | Plain-words rule in AGENTS.md | new copy slice (owner approval needed for wording) |
| U10 | **Legacy stylesheets still bypass the tokens**: 23 distinct radii, 65 box-shadows, 49 font sizes, 246 rgba values and 30 raw hex colours outside `:root` (`tools/css-stats-merged.txt`). `design-tokens` migrates `lead-support-detail.css` and the Ask cards only; `#b45309` in `entries-route.css` (`.entry-chip-linked-split-base`) and `#d5f5e6` in `styles.css` (`.panel-splits .form-success`) are raw colours that the pastel rule forbids | Keeps the app-wide redesign from converging | follow-up to `design-tokens` |
| U11 | **Tap targets under 44 px that no branch owns** (see 3, items 15): period segments 68×25, date refresh buttons 26×26, table sort buttons 18 px high, "See all insights" 122×18, note triggers 620×22, icon edit and delete 24×24, Settings selects 156×27 | design.md says every tappable is at least 44 × 44 | one cross-cutting test plus fixes as each branch lands |
| U12 | **Not audited here**: a portrait tablet (768 to 1023; Month opens its phone sheet there), landscape phone, a real iPhone keyboard, the swipe-down "Discard changes?" bar (WebKit cannot synthesise the touch drag in this harness; it is covered by `tests/e2e/sheet-swipe-dismiss.spec.js`) | Gaps in this audit, not in the redesign | ask for a device pass |

## 2. How the audit was run

- Stack: `docs/proposals/ui-audit/tools/stack.mjs` (isolated Vite 5677, Wrangler
  8977, D1 `.wrangler/state-ui-audit`, `DEMO_DATASET=showcase`, seed month Oct 2026,
  reseeds on start). Walker: `tools/audit.mjs` (about 125 shots across phone and
  desktop, plus per-shot DOM metrics: tap targets under 44 px, font sizes, radii,
  shadows, saturated fills, money colours, sideways scrollers, dialog primary
  action position). `tools/css-stats.mjs` counts static CSS literals;
  `tools/compress.mjs` and `tools/shots-list.json` produce the WebP set.
- To rerun: build (`npx vite build`), copy `stack.mjs` and `audit.mjs` into
  `test-results/ui-audit/`, run the stack, then `node test-results/ui-audit/audit.mjs`
  (`--only a,b`, `--device phone`).
- Empty Entries and Month are the real responses with the lists blanked, because
  every tracked month in the showcase data has entries. Credit notices are stubbed
  responses. Both are marked in `audit.mjs`.
- Findings come from looking at each screenshot and from the metrics
  (`test-results/ui-audit/metrics.json`, not committed; numbers below are quoted from it).
- Screenshots: `docs/proposals/ui-audit/shots/<device>/<name>.webp`, phone 585 px
  wide, computer 1024 px wide, quality 60. 85 images, 2.2 MB.

## 3. Top 20 issues

Severity: H = blocks a task or breaks a design.md rule on a main flow; M = clear
miss against the design language; L = polish. Effort: S under a day, M a few days,
L a week or more.

| # | Issue | Evidence | Sev | Effort | Owner branch |
| --- | --- | --- | --- | --- | --- |
| 1 | Desktop Ask dock covers the Commit import button and other bottom-right controls | `shots/d1280/imports-preview`, `imports-flow`, `splits-overview`, `settings-overview`; `imports-flow` click timeout | H | S | **UNCOVERED (U1)** |
| 2 | Phone floating chrome stack (eye, View and scope bar, month chip and steps, + button, tab bar) takes about 230 of 664 px and sits on content, amounts and the donut | `shots/phone/summary-all-months`, `entries-list`, `hidden-entries`, `splits-scrolled` | H | M | mobile-chrome-lsd (approved) |
| 3 | Month plan tables on a phone scroll sideways (table 778 px in a 366 px box) with 24 of 34 targets under 44 px (sort buttons 18 px, category icon 30 px, "+ Add" links 22 px) | `shots/phone/month-scrolled-plan` | H | L | summary-month-lsd (plan tables), layout-fixes |
| 4 | Totals strips clip: Entries strip scrolls sideways (932 px in 366), cuts "Difference" at 390 px and "Outflow ($7,335" at 1024; Splits strip cuts "Spend JP¥360,54"; six Month cards clip at 1024 | `shots/phone/entries-list`, `shots/d1024/entries-list`, `shots/d1024/splits-overview`, `shots/d1024/month-person` | H | M | layout-fixes (WIP), desktop-chrome-lsd, ui-language-round2-mockups |
| 5 | Phone Splits: whole page is the terracotta wash, a floating group row sits over the list, the summary strip (918 px in 390) and group pills (828 in 372) scroll sideways, 8 small targets | `shots/phone/splits-overview`, `splits-scrolled` | H | L | ui-language-round2-mockups (Splits page), mobile-chrome-lsd |
| 6 | Small centred popovers instead of Lead · Support · Detail: Edit category (inline Cancel and Save, focus ring on the ✕), Delete entry?, Delete split row; they sit on top of the sheet they came from | `shots/phone/entries-category-dialog`, `entries-delete-confirm`, `splits-delete-confirm`, `settings-edit-category` | M | M | dialogs-lsd |
| 7 | Dialogs no branch lists: Record settlement (native selects and date, two-column labels, centred Cancel), Create group (native selects), Split activity history, Statement checkpoint (clipped on a phone), Set up this login, Reload data | `shots/phone/splits-settle-group`, `splits-create-group`, `splits-history`, `settings-reconcile` | M | M | **UNCOVERED (U5, U6)** |
| 8 | View and scope sheet: Done at the top right, not in the thumb zone; pills 39 and 27 px high; nested wallet picker is a second centred dialog | `shots/phone/shell-view-scope-sheet`, `entries-filter-wallet-picker` | M | S | mobile-chrome-lsd |
| 9 | Error and loading screens drop all chrome (no header, no nav, no tab bar), show a bold technical line ("Page load failed: Page request failed with status 503") and leave a blank canvas; loading is a blank page with "Loading… 82%" | `shots/phone/state-page-error`, `state-shell-error`, `state-loading` | M | M | states-lsd (copy: **UNCOVERED U9**) |
| 10 | Settings: eleven collapsed cards about 125 px high with a long description and empty space; raw enums (`credit_card`, `bank`), category slug and hex shown; 24 px edit and delete icons; native selects | `shots/phone/settings-overview`, `settings-categories`, `settings-add-account`, `shots/d1280/settings-overview` | M | L | ui-language-round2-mockups (four sections), **UNCOVERED (U7)** for the rest |
| 11 | Imports: two five-line intro paragraphs, three-box stepper, an 89-row preview in one scroll, the commit bar over the tab bar, rollback confirm as a tiny floating note | `shots/phone/imports-inbox`, `imports-preview`, `imports-rollback` | M | L | ui-language-round2-mockups (review only), **UNCOVERED (U4)** |
| 12 | Desktop Splits row still opens the old inline form (native selects, share % and amount fields) while the phone has the Edit split card | `shots/d1280/splits-edit-expense` against `shots/phone/splits-edit-expense` | M | M | splits-desktop-card |
| 13 | Summary body below the lead: Spending Mix percent labels collide with bubbles ("5.8%" under the gift), category cards cut by the chrome, Wallets in view uses a full rose card, note triggers 620×22; Intent vs Outcome table is 640 px in 366 | `shots/phone/summary-wallets`, `summary-intent-outcome`, `shots/d1280/summary-all-months` | M | M | Intent vs Outcome: summary-month-lsd; rest **UNCOVERED (U2)** |
| 14 | Money insights block takes 250 to 300 px at the top of four pages, even when it says "Nothing to look into" | `shots/phone/entries-list`, `state-empty-entries`, `hidden-entries` | M | S | **UNCOVERED (U3)** |
| 15 | Tap targets under 44 px with no owner: period segments 68×25, date refresh 26×26, "See all insights" 122×18, note triggers 620×22, Settings edit and delete 24×24 (13 of 20 on Categories), Settings selects 27 px | metrics: phone `entries-list` 10 of 23, `settings-categories` 13 of 20, `settings-add-account` 8 of 8 | M | M | **UNCOVERED (U11)** |
| 16 | Phone New entry (Ask draft) page: the composer and the chip row cover the card's Date and Category rows, the chip row clips ("Transfe…") | `shots/phone/entries-add` | M | S | ask-qa-fixes (PR 31, not in this audit's list) |
| 17 | The month and period control looks disabled on Splits and Settings on a computer (greyed "Month Sept 2026" with dimmed arrows) | `shots/d1280/splits-overview`, `settings-overview` | L | S | desktop-chrome-lsd (verify), otherwise **UNCOVERED** |
| 18 | "Sept 2026" on a computer against "Sep 2026" on a phone for the same month | `shots/d1280/month-person` against `shots/phone/month-person` | L | S | **UNCOVERED (U9)** |
| 19 | Legacy CSS bypasses the tokens: 23 radii, 65 shadows, 49 font sizes, 246 rgba, 30 raw hex; two raw hex colours break the pastel rule | `tools/css-stats-merged.txt` | M | L | design-tokens (new files only), **UNCOVERED (U10)** |
| 20 | Entries filters at 1024: search placeholder cut to "Me", the "+" new-group tile wraps to its own row, month chips run off the right edge | `shots/d1024/entries-list`, `splits-overview`, `month-person` | M | S | layout-fixes, desktop-chrome-lsd |

What is good and should not be touched: the Edit entry card and New split expense
card (one lead, chips, rows, bottom bar, handle), the Ask page and its cards, the
Pick a month sheet, the Month plan-row sheet, hidden money (dots, no tone, no
sign words) on every screen checked, the pastel money tones (no hand-picked tone
found by the metrics on any phone screen), and person colours on Entries.

## 4. Ranked table by screen

| Rank | Screen | Issues | Sev | Effort | Fix | Overlap |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Shell, desktop (header, dock) | Ask dock covers the Commit button and other controls; disabled-looking month control on Splits and Settings; month chips overflow at 1024 | H | S | Reserve the dock zone in sticky bars and dialogs; give the dock a "dodge" rule; restyle the disabled period control | desktop-chrome-lsd (header only); dock **UNCOVERED** |
| 2 | Shell, phone (chrome) | Five stacked floating objects; eye on top of amounts; 39 px pills | H | M | One Support bar (already designed) | mobile-chrome-lsd |
| 3 | Month, phone | Sideways plan tables, six clipped metric cards, 24 small targets | H | L | Lead card plus plan rows as Detail rows | summary-month-lsd, layout-fixes |
| 4 | Splits page, phone | Orange wash, floating group row, sideways strip and pills | H | L | Round 2 Splits layout (group picker sheet, white lead card) | ui-language-round2-mockups, mobile-chrome-lsd |
| 5 | Entries top and strip, both | Clipped strip, search truncated, 1024 overflow | H | M | Lead plus 2×2 pills, filters as one Detail group | layout-fixes, ui-language-round2-mockups, desktop-chrome-lsd |
| 6 | Dialogs, small (category, delete, notes, transfer, match) | Centred popovers, inline actions, no bottom bar, ✕ only exit on Transfer details | M | M | Shared sheet frame with BottomActions | dialogs-lsd |
| 7 | Splits dialogs (settle, create group, history, archive, linked entry) | Native controls, centred Cancel | M | M | Same frame | **UNCOVERED** |
| 8 | States (loading, error, refresh, empty) | Chromeless error, blank loading, technical line | M | M | Lead · Support · Detail state card | states-lsd |
| 9 | Settings | Long cards, jargon, 24 px icons, native selects | M | L | Grouped Detail list with status values | ui-language-round2-mockups; sections **UNCOVERED** |
| 10 | Imports | Long copy, dense preview, desktop commit bar hidden | M | L | File lead card, compact rows, one-line commit bar | ui-language-round2-mockups; rest **UNCOVERED** |
| 11 | Summary body | Donut label collisions, wallets card, notes | M | M | Support-level cards; Wallets as Detail rows | **UNCOVERED**; Intent vs Outcome summary-month-lsd |
| 12 | Splits desktop row edit | Old inline form | M | M | Card dialog | splits-desktop-card |
| 13 | Money insights block | Height on every page | M | S | One line plus "See all" in Support style | **UNCOVERED** |
| 14 | View and scope sheet | Done at top, small pills | M | S | LSD sheet | mobile-chrome-lsd |
| 15 | Ask (phone and desktop) | New entry page overlap; otherwise on-pattern | L | S | Cover rows are scrolled clear of the composer | ask-qa-fixes |
| 16 | FAQ | Long contents list, 5 small targets | L | S | Collapse contents | **UNCOVERED** |
| 17 | Entries edit and split cards | On-pattern; Note field 24 px high (284×24) | L | S | Raise the one-line note row to 48 px | covered by shipped LSD |
| 18 | Hidden money | On-pattern everywhere checked; eye overlaps rows | L | S | Follows chrome | mobile-chrome-lsd |
| 19 | Entries and Month desktop edit rows | Inline editors use native selects and inputs | L | M | Keep (desktop density), check tokens | summary-month-lsd (Month), shipped (Entries) |
| 20 | Tokens and legacy CSS | Literals bypass tokens | M | L | Migrate stylesheet by stylesheet as each branch lands | design-tokens; legacy **UNCOVERED** |

## 5. Coverage matrix

Legend: a branch name is the redesign that will change the surface; **shipped**
means already in master and checked on-pattern; **UNCOVERED** is listed in
section 1. "ask-qa-fixes" and "reminders-mockups" are outside the list the owner
named, shown for completeness. Shot names are in `shots/<device>/`.

### Routes and page tops

| Surface | Phone | Desktop | Branch |
| --- | --- | --- | --- |
| Summary top (Spent lead, Income and Saved pills) | `summary-all-months` | `summary-all-months` | **shipped** |
| Summary Intent vs Outcome | `summary-intent-outcome` | `summary-intent-outcome` | summary-month-lsd |
| Summary Spending Mix, category cards | `summary-all-months-scrolled` | `summary-all-months` | **UNCOVERED (U2)** |
| Summary Wallets in view and notes | `summary-wallets` | `summary-wallets` | **UNCOVERED (U2)** |
| Summary range picker (desktop) and month chips | n/a | `summary-range-picker` | desktop-chrome-lsd (chips); picker popover **UNCOVERED** (add to desktop-chrome-lsd) |
| Month top (metric cards) | `month-person` | `month-person` | summary-month-lsd |
| Month plan tables (income, budget buckets, planned items) | `month-scrolled-plan` | `month-person`, `month-inline-edit` | summary-month-lsd, layout-fixes |
| Month household read-only | n/a | `month-household-readonly` (not in the WebP set) | summary-month-lsd |
| Month Actions popover | n/a | `month-actions` | **UNCOVERED (U6)** |
| Entries top and totals strip | `entries-list` | `entries-list` | layout-fixes, desktop-chrome-lsd, ui-language-round2-mockups |
| Entries filters (phone sheet, desktop row) | `shell-view-scope-sheet-entries` | `entries-filters-open` | mobile-chrome-lsd (phone), ui-language-round2-mockups (desktop group) |
| Entries date groups and rows | `entries-scrolled` | `entries-list` | ui-language-round2-mockups |
| Entries household view | `entries-household` | n/a | ui-language-round2-mockups |
| Splits page (group row, strip, banners) | `splits-overview`, `splits-scrolled` | `splits-overview` | ui-language-round2-mockups, layout-fixes, mobile-chrome-lsd |
| Splits activity list | `splits-group-dinners` | `splits-overview` | ui-language-round2-mockups |
| Splits settlement panel and checkpoint | `splits-simplify-checkpoint` | `splits-simplify-checkpoint` | **UNCOVERED (U5)** |
| Splits matches inbox | `splits-matches` | `splits-matches` | **UNCOVERED (U5)** |
| Splits household (read-only) | `splits-household` | n/a | ui-language-round2-mockups |
| Imports inbox, stepper, upload | `imports-inbox`, `imports-upload` | `imports-inbox`, `imports-upload` | **UNCOVERED (U4)** |
| Imports paste rows or defaults | `imports-paste-defaults` | `imports-paste-defaults` | **UNCOVERED (U4)** |
| Imports review preview and commit bar | `imports-preview` | `imports-preview` | ui-language-round2-mockups; desktop bar also **UNCOVERED (U1)** |
| Imports Done card and Recent imports | `imports-committed` | `imports-flow` | **UNCOVERED (U4)** |
| Settings overview (collapsed list) | `settings-overview` | `settings-overview` | ui-language-round2-mockups |
| FAQ (user guide, developer guide) | `faq-user-guide` | `faq-user-guide` | **UNCOVERED (U8)** |
| Ask chat, answers, money answer | `ask-chat-empty`, `ask-answer` | `ask-desktop` | **shipped** |
| Ask draft and saved cards | `ask-add-card`, `ask-saved` | `ask-dock-docked-answer` | **shipped** (page overlap: ask-qa-fixes) |
| Ask desktop dock (field, docked panel, popup) | n/a | `ask-dock-docked-answer`, d1024 `ask-dock-popup-answer` | **shipped**; collisions **UNCOVERED (U1)** |
| Ask credit notice (low, exhausted) | `ask-credit-low` | n/a | **shipped** |
| Reminders in Ask | n/a | n/a | reminders-mockups (proposal) |

### Shell

| Surface | Phone | Desktop | Branch |
| --- | --- | --- | --- |
| Header, view pills, tabs, period controls, eye | n/a | `shell-header-clip` | desktop-chrome-lsd |
| Tab bar and More pages popover | `shell-more-pages` | n/a (More pages at 1024 is in header) | mobile-chrome-lsd (phone), desktop-chrome-lsd (More pages popover) |
| View and scope bar and sheet | `shell-view-scope-sheet` | n/a | mobile-chrome-lsd |
| Pick a month sheet | `shell-pick-month-sheet` | `shell-period-month-picker` (popover) | mobile-chrome-lsd (tokens), desktop-chrome-lsd (popover) |
| Floating + and receipt buttons, eye button | `entries-list`, `splits-overview` | `entries-list` | mobile-chrome-lsd, desktop-chrome-lsd |
| Page titles and Support bars | all phone shots | all desktop shots | desktop-chrome-lsd, mobile-chrome-lsd |

### Sheets and dialogs

| Surface | Phone | Desktop | Branch |
| --- | --- | --- | --- |
| Edit entry card and sheet | `entries-edit-provisional`, `entries-edit-certified` | same | **shipped** |
| New entry (Ask draft) | `entries-add` | `entries-add` (not in WebP set) | **shipped**; overlap ask-qa-fixes |
| New split expense, Edit split, View split | `splits-add-expense`, `splits-edit-expense` | `splits-add-expense`, `splits-edit-expense` | splits-edit-lsd **shipped** (phone); splits-desktop-card (desktop rows) |
| Month plan-row sheet and desktop inline rows | `month-plan-sheet` | `month-inline-edit` | **shipped** (sheet); summary-month-lsd (tables) |
| Match planned item | `month-link-entries` | `month-link-entries` | dialogs-lsd |
| Row note, month note, Summary note | n/a | `month-note-dialog` | dialogs-lsd |
| Edit category (entries and settings) | `entries-category-dialog`, `settings-edit-category` | same | dialogs-lsd |
| Transfer details | `entries-transfer-details` | same | dialogs-lsd |
| Delete entry, delete split, delete split row | `entries-delete-confirm`, `splits-delete-confirm` | same | dialogs-lsd |
| Add to splits group picker | `entries-add-to-splits` | same | **UNCOVERED (U5)** |
| Month reset and delete month | n/a | n/a (not captured) | dialogs-lsd |
| Clear unresolved transfers? | n/a | n/a (not captured) | dialogs-lsd |
| Settings account, person, category, rule editors | `settings-add-account`, `settings-edit-category` | same | dialogs-lsd |
| Statement checkpoint (Reconcile) | `settings-reconcile` | `settings-reconcile` | **UNCOVERED (U6)** |
| Record settlement | `splits-settle-group` | same | **UNCOVERED (U5)** |
| Create group | `splits-create-group` | same | **UNCOVERED (U5)** |
| Split activity history, Archived batches | `splits-history` | same | **UNCOVERED (U5)** |
| Edit linked entry | n/a | n/a | **UNCOVERED (U5)** |
| Set up this login, Reload data | n/a | n/a | **UNCOVERED (U6)** |
| Restore preview row, diagnostic post date, Update connected note? | n/a | n/a | **UNCOVERED (U6)** |
| Import progress sheet | n/a | n/a | dialogs-lsd |
| Claude credit "I've topped up" sheet | `ask-credit-topped-up-sheet` | n/a | dialogs-lsd |
| ResponsiveSelect picker sheet | `entries-filter-wallet-picker` | n/a | dialogs-lsd, mobile-chrome-lsd |
| Rollback confirm (Imports) | `imports-rollback` | n/a | **UNCOVERED (U4)** |
| Swipe-down "Discard changes?" bar | not capturable here | n/a | **shipped** (`sheet-swipe-dismiss.spec.js`) |

### Lists

| Surface | Phone | Desktop | Branch |
| --- | --- | --- | --- |
| Entries rows | `entries-list` | `entries-list` | ui-language-round2-mockups |
| Splits activity rows | `splits-group-dinners` | `splits-overview` | ui-language-round2-mockups |
| Month plan rows | `month-scrolled-plan` | `month-person` | summary-month-lsd |
| Intent vs Outcome months | `summary-intent-outcome` | `summary-intent-outcome` | summary-month-lsd |
| Imports preview rows | `imports-preview` | `imports-preview` | ui-language-round2-mockups |
| Imports recent imports | `imports-committed` | n/a | **UNCOVERED (U4)** |
| Settings account, category, rule rows | `settings-categories` | `settings-categories` | **UNCOVERED (U7)** (accounts: ui-language-round2-mockups) |
| Category share cards (Summary) | `summary-all-months-scrolled` | `summary-all-months` | **UNCOVERED (U2)** |
| Wallet cards (Summary) | `summary-wallets` | `summary-wallets` | **UNCOVERED (U2)** |
| FAQ contents | `faq-user-guide` | `faq-user-guide` | **UNCOVERED (U8)** |

### Empty, loading and error states

| Surface | Phone | Desktop | Branch |
| --- | --- | --- | --- |
| Page loading (first load, route change) | `state-loading`, `state-loading-entries` | `state-loading` (not in the WebP set) | states-lsd |
| Page error, shell error | `state-page-error`, `state-shell-error` | `state-page-error` | states-lsd (copy U9) |
| Refresh failure notice | `state-refresh-failure-phone` | `state-refresh-failure` | states-lsd |
| Empty Entries, empty Month | `state-empty-entries`, `state-empty-month` | `state-empty-entries` | states-lsd |
| No filter match | `state-no-filter-match` | n/a | states-lsd |
| Environment banner, loading badge | `state-shell-error` (banner) | n/a | states-lsd |
| Hidden-money variants of every screen | `hidden-entries`, `hidden-splits`, `hidden-month`, `hidden-summary` | `hidden-entries`, `hidden-summary` | each owner branch (cross-cutting; check per branch) |
| Claude credit low and exhausted | `ask-credit-low`, `ask-credit-exhausted` | n/a | **shipped** |

### Settings sections

| Section | Phone | Desktop | Branch |
| --- | --- | --- | --- |
| People | `settings-people` | same | ui-language-round2-mockups (list only) |
| Accounts (list, Add, Reconcile) | `settings-accounts` | same | ui-language-round2-mockups (list), dialogs-lsd (Add), **UNCOVERED (U6)** (Reconcile) |
| Apple Pay shortcut | `settings-shortcut` | same | ui-language-round2-mockups |
| Ask and AI | `settings-ask-ai`, `settings-ask-ai-low-credit` | same | ui-language-round2-mockups |
| Payment ways | `settings-payment-ways` | same | ui-language-round2-mockups |
| Categories | `settings-categories` | same | **UNCOVERED (U7)**; editor in dialogs-lsd |
| Category matching | `settings-category-rules` | same | **UNCOVERED (U7)**; editor in dialogs-lsd |
| Balance trust rules | `settings-trust` | same | **UNCOVERED (U7)** |
| Unresolved transfers | `settings-transfers` | same | **UNCOVERED (U7)** |
| Recent balance activity | `settings-activity` | same | **UNCOVERED (U7)** |
| Error diagnostics | `settings-diagnostics` | same | **UNCOVERED (U7)** |

## 6. Overlap notes for the in-flight branches

- **mobile-chrome-lsd** removes issues 2 and 8 and the thumb-zone rows of the tab
  bar. The audit's phone shots are *before* it. Check afterwards that the Support bar
  does not cover the primary action on Imports (commit bar), Entries (+) and Splits.
- **summary-month-lsd** owns the Month top, Intent vs Outcome and, per the
  coordinator, the plan tables on both layouts. The 24 small targets on the phone
  plan table (sort buttons, category icon, "+ Add" links) belong in its tests.
- **desktop-chrome-lsd** changes tokens and totals containers. Its bundle note
  (CSS headroom 6 B) matters for U10 and for any new desktop rule for U1.
- **dialogs-lsd** has no code yet; its inventory omits the U5 and U6 dialogs.
  Adding them now costs less than a second pass.
- **states-lsd** is a single commit (new `ui/states.css`); copy changes in U9 need
  the owner's approval first.
- **splits-desktop-card** and the shipped **splits-edit-lsd** make the desktop and
  phone Splits row edit the same card.
- **layout-fixes** is WIP (it states "Month still overflows"); issues 3, 4 and 20
  are its acceptance list.
- **design-tokens** migrates only `lead-support-detail.css` and the Ask cards; U10 is
  the rest.
- **ui-language-round2-mockups** covers Splits page, Entries strip, filters and rows,
  Settings (four sections), Imports review and Month plan tables; see U4 and U7 for
  the gaps.

## 7. Static numbers (`tools/css-stats-merged.txt`, master `d8221075`)

| Measure | Count | At the first audit pass |
| --- | --- | --- |
| Distinct border radii | 23 | 20 |
| Distinct box-shadows | 65 | 61 |
| Distinct font sizes | 49 | 49 |
| Distinct raw hex outside `:root` | 30 | 30 |
| Distinct rgb or rgba outside `:root` | 246 | not counted |

Phone metrics per screen (small targets of all interactive elements, sideways
scrollers that are not tables): Summary 2 of 12; Month 7 of 16 (24 of 34 scrolled
into the plan); Entries 10 of 23; Splits 8 of 18 (two sideways strips); Settings
Categories 13 of 20; Settings Add account 8 of 8; Imports preview 4 of 10. No phone
screen showed a hand-picked money tone, a saturated fill outside the category
palette and money tones, or page-level sideways scroll.

## 8. Screenshots

Phone: `shots/phone/` (58 images). Computer: `shots/d1280/` (22) and `shots/d1024/` (5).
The list is `tools/shots-list.json`; every other raw shot can be regenerated.
