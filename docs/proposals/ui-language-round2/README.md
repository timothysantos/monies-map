# UI language, round 2: the whole app in Lead · Support · Detail

Mockups for owner approval. **No app code changes.** Every picture is the real
app (demo data, showcase seed) with the proposed layout injected on top, using
the app's own `lead-support-detail.css`, pastel tokens, money tones and person
colours. iPhone 13 (WebKit, DPR 2) and desktop 1280 px, normal money and hidden
money. Read it with [`design.md`](../../../design.md#lead--support--detail).

How to read the pictures

- `*-before` is the app today, `*-after` is the proposal, `*-hidden-after` is the
  proposal with money hidden (amounts are dots, bars keep only their track, no
  sign words, pills lose their tint).
- The round floating buttons (eye, add, Ask dock) are hidden in the phone
  pictures so they do not cover the rows. They stay exactly as today.
- Demo data uses Ethan and Serene, so "Serene" stands for the second person.
  Where the demo has no number (a November plan, a Travel plan), the figure in a
  chat card is **illustrative** and says so below.
- Lists (Entries rows, Splits activity, Imports table) stay flat, as design.md
  says. For lists the proposal changes only spacing, alignment, the day header
  and the quiet chips. The "shop name first / bolder merchant" variant is not
  used.

Summary

| Screen | Effort | Risk | Needs the owner's call |
| --- | --- | --- | --- |
| Splits page (lead card, group bar, sheet) | M | Medium | Everything but the single collapsed group bar is approved; pick A, B or C below |
| Entries totals strip and filters | S to M | Low | Spend is plain ink; the strip becomes a card plus pills |
| Settings (closed list, three sections) | M | Low | Status words per row |
| Imports (file card, compact rows, row sheet, one-line bar) | L | High | A row edit sheet on phone |
| Imports split nudge and picker | M to L | Medium | New banner and sheet |
| Month plan rows (phone), thin bars (desktop) | S to M | Low | Rows replace the table on phone |
| Entries list rows and day headers | S | Low | None, spacing and quiet chips |
| Splits activity list | S | Low | None |
| Chat: planning, Intent vs Outcome answer, Splits | S to L | Medium | Which flows get a chat version (below) |

## 1. Splits page

Change: a white lead card for the open group (bubble, name, "JPY · 10 entries",
the balance as the lead figure in its tone, "Serene owes you" under it); the
person chip and a "Group spend" chip as Support; History quiet and Settle group
as the one primary; search as its own field. On phone the sideways tile strip
becomes a floating group bar, shaped like the existing "View and scope" bar, that
opens a "Choose a group" sheet (one Detail row per group with its balance, the
current one marked, Create group last). Desktop keeps the tiles.

Effort M. Risk medium: touches the Splits header and floating strip, the
Splits e2e specs and the hidden-money rules. Not to change: the orange panel,
the balance and settle-up maths, the activity list contents, Review matches.

| Before | After | Hidden |
| --- | --- | --- |
| ![](splits-phone-before-top.webp) | ![](splits-phone-after-top.webp) | ![](splits-phone-hidden-after-top.webp) |
| ![](splits-phone-before.webp) | ![](splits-phone-after.webp) | ![](splits-phone-hidden-after.webp) |
| | ![](splits-phone-after-groups.webp) | ![](splits-phone-hidden-after-groups.webp) |

Desktop: ![](splits-desktop-before.webp) ![](splits-desktop-after.webp)
(also `splits-desktop-before-top.webp`, `splits-desktop-after-top.webp`).

### Splits groups: owner feedback and three alternatives

Everything in this proposal is approved except the single collapsed
"Japan trip · 4 groups" bar: it hides the other groups and loses the old
strip's quick per-group summary (who owes whom, how much). The lead card,
chips and search above stay as approved. Below are three ways to keep every
group in view. Each shows 4 groups, one of them settled, with the receipt
button, the eye and the nav island visible as in the app. Group rows are white
rows with plain words ("Serene owes you $303.15") and no money tone on the
orange; groups owed to you come first, then what you owe, settled last.
(Images: `splits-groups-<A|B|C>-<phone|desktop>[-hidden]-<screen>.webp`.)

**A (recommended): an "All groups" list first.** Splits opens on a vertical
list, one 56 px row per group (icon, name, balance in words), settled groups
folded into "1 settled group", then "+ Create group". Tapping a group opens it
(lead card and activity) with "‹ All groups" at the top; the floating bar in a
group shows the current group and opens the same list as a sheet.
Pros: every group and every balance visible at once, no sideways scroll, one
list used in two places, simplest to explain. Cons: one extra tap to reach the
activity of the usual group (remember the last group to open straight into it,
with the back link), and a new first screen. Effort M, risk low to medium.
Images: `splits-groups-A-phone-list`, `-A-phone-group`, `-A-phone-group-sheet`,
`-A-desktop-list`, `-A-desktop-group`, `-A-desktop-group-sheet`, and the
`-hidden` ones.

**B: stay in the group; the floating bar expands into the list.** The
collapsed bar keeps a summary of the others ("Japan trip · 3 others, $194.57
owed to you", the SGD net; with money hidden "3 other groups"); tapping it
opens a sheet with the same rows as A.
Pros: the smallest change to how Splits works today, always opens on the
activity. Cons: the other groups are still one tap away, the summary adds up
only groups in one currency (a JPY group is left out of the SGD total), and
the bar is the control the owner worried about. Effort S to M, risk low.
Images: `splits-groups-B-phone-bar`, `-B-phone-bar-sheet`, `-B-desktop-bar`,
`-B-desktop-bar-sheet`, and the `-hidden` ones.

**C: a compact "Groups" card above the lead.** Three rows (selected one
tinted) and "Show all 4" that unfolds the settled and the rest.
Pros: groups and balances visible on the first screen with no new screen or
bar. Cons: pushes the lead card and activity down by about three rows on a
phone, and it is a second card above the one that matters (breaks "one lead
per screen top" unless the card stays quiet). Effort M, risk low.
Images: `splits-groups-C-phone-card`, `-C-desktop-card`, and the `-hidden` ones.

**D: keep the sideways strip as a deliberate exception, restyled.** The strip
sits in the page flow under the person switcher (it no longer floats over rows).
The open group is a white Lead tile, about 60% wide, with a terracotta outline
and a tick, its balance in words and its entry count; it is scrolled into view
on load and after a refresh (the last-used group persists). The other groups
are translucent Support tiles, about 40% wide so the next one peeks to show it
scrolls (scroll-snap, 64 px tall), name and one balance line, settled groups
last and muted ("Settled"). The end holds "All groups" (opens A's vertical list
as a sheet, the non-scroll path) and "+ Create group". Scrolling down, the strip
leaves the page and the existing floating bar shows the open group; scrolling
back up restores it. With money hidden the tiles say "Balance hidden" and are
not ordered by who owes whom. On desktop the tiles wrap into a row and nothing
scrolls.
Pros: keeps the quick per-group summaries the owner values, the closest to
today's habit, always opens on the group's activity. Cons: it is the one
sideways scroller left in the app (a deliberate exception to "no sideways
scroll"), it adds about 150 px above the heading on phone, and a group past the
second tile is out of sight until you scroll or open All groups. Effort M
(the strip, its collapse into the floating bar and persisting the last group),
risk medium (scroll-driven collapse on iOS, 44 px targets, e2e).
Images: `splits-groups-D-phone-strip`, `-D-phone-hidden-strip`,
`-D-phone-scrolled` (collapsed bar), `-D-phone-hidden-scrolled`,
`-D-phone-all-sheet`, `-D-desktop-strip`, `-D-desktop-hidden-strip`.

Recommendation: A, with "open the last used group" so the list is one tap
back rather than a toll; D if the per-group summaries on the first screen
matter more than keeping the app free of sideways scrolling.

## 2. Entries totals and filters

Change: "Spent · Aug 2026" as the lead in plain ink with the person's share as
the aside, Income, Difference, Transfers and Outflow as four pills (mint soft
only when good), and on phone two Detail rows, "Spending by category" and
"Filters · All entries", that open the existing breakdown and the existing "View
and scope" sheet. This ends the phone strip that is cut off sideways. Desktop
puts the pills in a column beside the lead like Summary; the filters stay one
group.

Effort S to M. Risk low: presentation only; the lead is taller (about three
strips of height), and the inline "Add entry" in the strip goes (the floating
add button stays). Not to change: how totals are computed, the bracketed
person's share, the filter behaviour.

| Before | After | Hidden |
| --- | --- | --- |
| ![](entries-phone-before.webp) | ![](entries-phone-after.webp) | ![](entries-phone-hidden-after.webp) |
| ![](entries-desktop-before.webp) | ![](entries-desktop-after.webp) | ![](entries-desktop-hidden-after.webp) |

## 3. Settings

Change: the closed page is one grouped Detail list with a status word per row
(People "Ethan, Serene", Accounts 6, Apple Pay shortcut "Not set up", Ask and AI
"Basic model", Categories 33, Balance trust rules "1 to check", Unresolved
transfers "1 to pair"); long descriptions go. An opened section unfolds in the
list: Apple Pay shortcut as a status lead, chips (Apple-signed, opens the entry
to edit), Default account, Other currencies, "How to set it up (4 steps)" folded,
More shortcut settings folded, Install Apple Shortcut at the bottom; Payment
ways as a person chip and two rows per person; Ask and AI as a status lead and
rows.

Effort M. Risk low: the sections keep their own controls and data; the
status words need small read-only summaries. Not to change: the steps text, the
account priority list and its reordering, saving behaviour, rule editors. No
money is shown here, so there is no hidden-money variant.

| Before | After |
| --- | --- |
| ![](settings-phone-before-closed.webp) | ![](settings-phone-after-closed.webp) |
| ![](settings-phone-applepay-before.webp) | ![](settings-phone-applepay-after.webp) |
| ![](settings-phone-payways-before.webp) | ![](settings-phone-payways-after.webp) |
| ![](settings-phone-askai-before.webp) | ![](settings-phone-askai-after.webp) |

Whole opened sections: `settings-phone-applepay-after-full.webp`,
`settings-phone-payways-after-full.webp`, `settings-phone-askai-after-full.webp`.
Desktop: ![](settings-desktop-before-closed.webp) ![](settings-desktop-after-closed.webp)
![](settings-desktop-applepay-before.webp) ![](settings-desktop-applepay-after.webp)

## 4. Imports (review)

Change: a file card (file name, account and owner, "89 rows will import", chips
for coverage, mapped or "Map 1 account", the owner); the account mapping as one
action row; phone preview rows as flat 56 px rows (description, date and
category, the amount in its tone) that open a row edit sheet (Lead, Support,
Detail rows, Exclude row and Done); a one-line commit bar ("Start over" and
"Commit 89 rows"). Desktop is a light touch: the card, the nudge and the
one-line bar; the table stays.

Effort L. Risk high: the row sheet re-homes every editable field, the
blockers, duplicate matching and commit rules must behave identically, and the
phone page changes from inputs to sheets. Do it behind the lazy Imports route
(bundle budget). Not to change: parser output, blockers, duplicate detection,
commit and rollback, the stepper.

| Before | After | Hidden |
| --- | --- | --- |
| ![](imports-phone-before.webp) | ![](imports-phone-after.webp) | ![](imports-phone-hidden-after.webp) |
| ![](imports-phone-before-rows.webp) | ![](imports-phone-unmapped-after.webp) | |
| | ![](imports-phone-after-row.webp) | ![](imports-phone-hidden-after-row.webp) |

Desktop: ![](imports-desktop-before.webp) ![](imports-desktop-after.webp)
![](imports-desktop-hidden-after.webp)

### Imports split nudge

"5 rows look like things you usually split · Review" sits under the file card
(sky, one row). It opens "Rows you may split": the five rows with ticks (three
ticked), "Add to group" and "Split" rows, and "Add 3 to Splits". The chosen rows
join Splits only after the commit succeeds; "Not now" leaves everything as is.
Nothing is split by the picker itself.

Effort M to L (the suggestion source exists on master, the post-commit write
must go through the existing split link command, atomic with its audit event).
Risk medium: it must never link or split on its own. Not to change: commit
semantics, duplicate review.

![](imports-phone-after.webp) ![](imports-phone-after-picker.webp) ![](imports-phone-hidden-after-picker.webp)

## 5. Month plan rows

Change on phone: each bucket is a row with the category bubble, the name,
"$270.23 of $320.00" (the figure in plain ink, rose only over plan) and a thin
plan bar (sky track, grey fill, rose past the plan). The Actual column is no
longer cut off. Desktop keeps the table and adds the same thin bar under each
Actual figure. The Planned items table follows the same row shape.

Effort S to M. Risk low: display only, rows open the existing plan editor.
Not to change: Variance colouring, totals, the editor, read-only household view.

| Before | After | Hidden |
| --- | --- | --- |
| ![](month-phone-before.webp) | ![](month-phone-after.webp) | ![](month-phone-hidden-after.webp) |
| ![](month-desktop-before.webp) | ![](month-desktop-after.webp) | ![](month-desktop-hidden-after.webp) |

## 6. List screens

Entries rows and day headers. The person edge colour stays. The hierarchy
comes from spacing (a 68 px row, the category as a quiet line above the
merchant, the wallet as a quiet line below), amount alignment (right, tabular,
on the merchant's line), the money tones, quiet support (Matched transfer is
plain muted text, the Apple Pay glyph stays small), and the day header as a
hairline divider with the daily net at the right. Effort S, risk low (CSS and
two hidden empty lines). Not to change: the edge, row editing, merchant weight.

| Before | After | Hidden |
| --- | --- | --- |
| ![](entrieslist-phone-before.webp) | ![](entrieslist-phone-after.webp) | ![](entrieslist-phone-hidden-after.webp) |
| ![](entrieslist-desktop-before.webp) | ![](entrieslist-desktop-after.webp) | ![](entrieslist-desktop-hidden-after.webp) |

Splits activity (expense rows, settle-ups, history). Same day divider (white on
the orange panel), rows in one rounded white group, the balance words aligned
at the right in their tone. Effort S, risk low. The group tiles at the bottom
of the phone pictures are today's strip (replaced in section 1).

| Before | After | Hidden |
| --- | --- | --- |
| ![](splitslist-phone-before.webp) | ![](splitslist-phone-after.webp) | ![](splitslist-phone-hidden-after.webp) |
| ![](splitslist-desktop-before.webp) | ![](splitslist-desktop-after.webp) | ![](splitslist-desktop-hidden-after.webp) |

Imports preview rows are in section 4 (phone compact rows and the row sheet,
desktop table kept). Month plan table (desktop, light touch) is in section 5.

## 7. Chat versions of some flows

Phone: the real Ask page with the exchange. Desktop: the real page on the left
and a docked Ask panel on the right (both versions side by side). Every
write is a draft card on the shared blocks (Draft tag, Lead, Support chips,
Detail rows) with the primary at the bottom; **nothing changes until Save**.
The card's numbers come from the app's own validation, never from model prose
(AGENTS.md, Optional AI Assistance).

1. Planning by chat. "set groceries plan to $700 for November" gives a
   Groceries plan draft (sky amount, "was $650.00", Change +$50.00);
   "move $200 from Shopping to Travel this month" gives a Move draft with From
   and To rows and a chip that planned spend stays the same; after Save the card
   says Saved with "See it on Month" and "Undo this change". The November and
   Travel figures are illustrative.
2. Intent vs Outcome as an answer. "how did September go against plan?" gives
   the money answer card: spent against planned with the bar, percent of plan and
   amount under or over, an income chip, the three biggest categories as rows,
   and "Open the full September view". Figures are Ethan's September in the demo.
3. Splits by chat. "settle up with Serene" gives a Settle up draft (the balance
   as the lead in mint, "Serene pays you", group, paid with, date);
   "split dinner $120 with Serene, she paid" gives a split draft (lead $120.00,
   "You owe Serene $60.00", paid by, shares, group, category).

| Phone | | | |
| --- | --- | --- | --- |
| ![](chat-plan1-phone-after.webp) | ![](chat-plan1-phone-after-end.webp) | ![](chat-plan2-phone-after.webp) | ![](chat-plan3-phone-after.webp) |
| ![](chat-intent-phone-after.webp) | ![](chat-intent-phone-after-end.webp) | ![](chat-settle-phone-after.webp) | ![](chat-split-phone-after.webp) |
| ![](chat-plan1-phone-hidden-after.webp) | ![](chat-intent-phone-hidden-after.webp) | ![](chat-settle-phone-hidden-after.webp) | ![](chat-split-phone-after-end.webp) |

Desktop (page and docked Ask panel):
![](chat-plan-desktop-after.webp) ![](chat-intent-desktop-after.webp)
![](chat-splits-desktop-after.webp)
Hidden money: `chat-plan-desktop-hidden-after.webp`,
`chat-intent-desktop-hidden-after.webp`, `chat-splits-desktop-hidden-after.webp`.

Which flows get a chat version

| Flow | Chat version | Effort | Risk |
| --- | --- | --- | --- |
| Intent vs Outcome / plan questions | Yes, an answer card with a link to the full view | S (the money answer card exists; add the category rows and the link) | Low, read-only |
| Planning edits (set a plan, move budget) | Yes, as a draft card | M (a plan-draft reader and a save through the existing plan command) | Medium: month and person scope must be explicit, one `db.batch()` write |
| Settle up and add a split expense | Yes, as a draft card | L (group, payer and share resolution; settle-up write) | Medium to high: money moves between people; always confirm group and amounts |
| Add entry, receipts | Already in Ask | n/a | n/a |
| Import review, mapping, blockers | Page only | n/a | Many rows and decisions; keep the sheet |
| Category rules, accounts, Apple Pay setup, statement fixes | Page only | n/a | Rare, configuration, long steps |
| Month plan structure (buckets, planned items) | Page only; chat only for single-figure edits | n/a | Tables need to be seen |

## Regenerating

`docs/proposals/ui-language-round2/tools/`: `stack.mjs` (isolated stack, ports
5471/8871/9471, run with Node 22 from the checkout after `npm run build`),
`run.mjs <scenario file> [name filter]` (screenshots to `tools/out/`),
`scen-*.mjs` (one scenario file per screen), `encode.mjs` (webp into this
folder), `cmp.cjs` (contact sheets for review). Paths resolve from the checkout.
