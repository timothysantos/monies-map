# Check Flow

The "Check my books" page (`/check`): the screen of the Ledger check-up
(owner-approved 2026-10-27; DOMAIN.md "Ledger Check-up",
[`docs/proposals/ledger-checkup.md`](../proposals/ledger-checkup.md),
[`docs/audits/ledger-checkup.md`](../audits/ledger-checkup.md)). Phase 1 is the
engine and the API, phase 2 is this page, phase 3 is the correction of a
settled period.

## Route Flow

- `/check` is the page's own route (`getSelectedTabId`, `routeTabs` in
  `App.jsx`, one more secondary tab after FAQ). It is a lazy route chunk
  (`route-modules.js`, `check-panel.jsx`); the first screen carries only the
  tab's name (`messages.tabs.check`), the route registration and the tab entry.
- Reached from the page tabs on a wide screen, and from the `•••` ("More pages")
  menu on a phone and in a narrow window (`ShellRouteTabs`). No badge, no count
  on any other screen, no link from any other page except a finding's own fix
  path in the other direction.
- The page has no page request of its own (`buildRoutePageRequest` is `null`,
  like FAQ and Ask): it takes the shell's person (`buildPageViewFromRouteData`
  "check") and ignores the period (`routeUsesPeriod` is false, so the header's
  period controls stay in place, disabled).
- Three kinds of problem are fixed over the page itself, and every other fix
  button leaves a way back ("Fixing and coming back", below). A fix button that
  is a page navigates with the router to the finding's `fix.path` (an app
  path with its query: `/entries?...&editing_entry=<id>`, `/splits?...`,
  `/imports`, `/settings`, `/month?...#month-plan`). The page never calls a path
  as an API route and refuses a `fix.path` that does not start with `/`
  (`readCheckupReport`).
- Never warmed automatically (`NO_AUTOMATIC_MODULE_ROUTES`); a hover or focus on
  the link may load the route code like any tab, never its data. There is no
  `route-warmup-admissions.js` row: nothing about the check is speculative.

## State Flow

| State | Owner | Notes |
| --- | --- | --- |
| the report, the person's view it was run for, loading, failed, the row just hidden, a refused write | `check-data-owner.js` (`createCheckOwner`) | one owner; no `useState` copy of server data |
| which groups are open | `localStorage` `monies-map:check-open-groups` | per device, read and written inside `try/catch`; the page works without it |
| which groups show all their loaded rows, whether the hidden list is open | component state | reset by "Check again" for the first |
| money hidden | `useMoneyPrivacy` | the view-model masks amounts when it is off |

The view-model (`check-model.js`, pure, `tests/check-model.test.mjs`) turns the
report into the page: the summary line, three sections, one group per heading
inside a section, the rows a group shows, the notices.

- Sections: `high` "Needs fixing" (rose), `check` "Worth checking" (butter),
  `note` "Good to know" (sky).
- Groups: nine headings over the fifteen kinds (`HEADING_BY_KIND`); related
  kinds share one (the two duplicate kinds, the three plan kinds, the three
  tidy-ups, the two balance kinds). A group is keyed `<tier>:<heading>`; the same
  heading in two sections is two groups. Its total is the report's own
  `kindCounts` summed over the heading's kinds in that section; it lists at most
  the 50 rows the report sent per kind, five at first, "Show N more" for the
  rest, then "Showing 50 of 137" when more exist than were sent.
- Order: sections by tier; groups by their first row (the report's order is
  tier, money at stake, recency); a group with no row loaded goes last and says
  the rest are not listed yet.
- Open by default: only the first group of the highest section that has one. A
  person's choice (kept per device) wins; the group holding the row just hidden
  stays open.
- A run is explicit: the page opening, "Check again", the person's view
  changing, or opening the hidden list (`dismissed=1`). Nothing else reads the
  report and nothing polls it.

## Data Flow

```text
open /check ──▶ owner.run({ viewId })
                 └─ fetchRequiredQuery (fetchQueryWithLease, bypassCache)
                      └─ GET /api/ledger-checkup[?view=<person id>][&dismissed=1]
                 ◀─ report ──▶ buildCheckView ──▶ summary, sections, groups, rows

"This is fine" ──▶ owner.hide(row)         (counts and rows move at once)
                    └─ POST /api/ledger-checkup/dismiss { id, evidenceKey }
                    └─ refused: put back, "Could not hide this. Try again."
                 ──▶ runBackgroundRefresh(owner.refresh)   (silent re-read; a
                     failure keeps the page and raises the retryable notice)
"Undo" / "Show again" ──▶ POST /api/ledger-checkup/undo-dismiss { id } (same)
```

- A read takes a generation: a read that finishes after a newer check (another
  person, "Check again") never overwrites it, and a read that was running when a
  write landed is read again (`writeEpoch`), so it cannot bring back what was just
  hidden.
- The row just hidden stays in its place as "Hidden." with "Undo" across the
  refresh that follows (the owner keeps it, flagged, where it stood); focus
  moves to that Undo.
- `check-data-owner.js` reads a cancelled request by its message instead of
  importing TanStack's `isCancelledError`: a route chunk that imports the package
  (or `refresh-notice.js`, or `query-leases.js`) splits the entry chunk and adds
  a first-screen file (`tests/client-route-chunks.test.mjs`).
- Scope: the page sends the header's person (`view=`); `household` sends none.
  The report keeps that person's problems and every problem with no person.

## Ownership Notes

| Piece | File |
| --- | --- |
| page, groups, rows | `src/client/check-panel.jsx` |
| view-model | `src/client/check-model.js` |
| the one owner of the report | `src/client/check-data-owner.js` |
| requests and the reader that drops what it cannot read | `src/client/check-api.js` |
| every word | `src/client/copy/check-copy.js` (lint: `tests/check-copy-lint.test.mjs`) |
| styles | `src/client/check-route.css` (lazy with the route; no colour written there) |
| route registration | `route-modules.js`, `App.jsx` `routeTabs`, `app-routing.js` |

Wording follows the naming rule: no "finding", "detector", "tier", "evidence",
"kind" or "dismiss" on screen, and the lint also runs the app-jargon and
retired-name lists. The sentences about each problem are the report's own,
already linted in `tests/ledger-checkup-detectors.test.mjs`.

Hidden money (the money privacy toggle off):

- no amount shows: the summary sentence, the evidence lines and notes have every
  `$12.34` or `IDR 159,000.00` replaced by `••••`, the evidence line's amount and
  the "$N involved" line are dropped;
- a sentence that says which way money went (`settled_period_error`,
  `balance_mismatch`, `plan_overspent`) is replaced by "Money is hidden. Show
  money totals to read this."; the plan's title becomes "The plan needs a look";
- the counts, group names and buttons stay.

The "$N involved" line is plain text, not an openable figure
(AGENTS.md "Openable figures"): a problem's amount is the problem's, not an
Entries total, so no View entries equality could hold.

Colour: section heads are the state-banner tones (rose, butter, sky) with their
`-ink`, the hidden list the neutral tint, the summary a plain card; no tone on
money. Contrast is pinned for every preset in both modes
(`tests/colour-contrast.test.mjs`, "Check my books reads AA"). The two buttons'
text is `--accent`, not `--accent-strong`.

## Visible User Contract

Every string the page shows (all in `check-copy.js`):

- Title and context: "Check my books", "Checking the whole household" /
  "Checking Tim and anything shared"; intro "Looks over your entries,
  statements, shared expenses and plans for things that seem wrong. It only looks:
  nothing changes unless you choose to fix it."
- Buttons: "Check again", "Checking…" (disabled, with a skeleton on the first
  run), "Try again".
- Summary: "N thing needs / things need fixing", "N worth checking", "N good to
  know" joined with " · ", "Checked <time>"; or "Everything checks out" with
  "Checked <time>. Nothing looks wrong in your entries, statements, shared
  expenses or plans."; with a check that could not run: "Nothing found in the
  checks that ran" with "...Some checks could not run, so this is not a full
  all-clear."
- Sections: "Needs fixing" (Your records show a problem here.), "Worth checking"
  (Something does not add up. It is often fine.), "Good to know" (Tidy-ups and
  heads-ups. Nothing urgent.).
- Group headings: "Purchases that may be on the wrong card", "Possible
  duplicates", "Transfers waiting for their other side", "Missing statements",
  "Estimates the bank never confirmed", "Balances that don't match", "Plan
  problems", "Settle-up mistakes", "Tidy-ups".
- Groups: "Show N more", "Show fewer", "Showing 50 of 137", "There may be more
  than shown", "N more are not listed yet. Sort out the ones above first."
- A problem: its title and sentence (from the report), its lines (label, date ·
  account · amount, "– note"), "$N involved", the fix button (the report's own
  label, for example "Open the transfer and link them"), or its quiet note
  ("Nothing to fix in the books."), and "This is fine".
- Hiding: "Hidden." with "Undo"; "Show hidden (N)" / "Hide hidden (N)"; "Hidden
  by you" ("You marked these as fine. They come back if the records behind them
  change.") with "Show again"; "Could not hide this. Try again." / "Could not
  show this again. Try again."
- Could not check: "Could not check this" (per group) with "Try again";
  "Could not check your books" ("Check your connection and try again. Nothing
  was changed.") with "Try again"; "Could not check again" ("Showing the result
  from before.") with "Try again".
- Hidden money and a plan problem: "Money is hidden. Show money totals to read
  this.", "The plan needs a look".
- Link clear pairs (all in `check-copy.js`, `clear`): "Only pairs with exactly
  one possible match on each side.", "Link these N clear pairs" ("Link this
  clear pair" for one), the dialog's title, summary, rows, "and N more", the
  sentence, "There is no undo for all of them at once.", the cap note, "Link N
  pairs", "Linking…", "Cancel", "Close", the result line, and the two failure
  lines. Listed in full under "Link clear pairs".
- Screen readers: a polite status line says "Checking your books." then "Check
  finished. <summary>."; group buttons carry `aria-expanded` and
  `aria-controls`; every button names its problem ("This is fine: <title>");
  focus moves to Undo after a hide.

Layout: one column; a Lead (the summary), the three sections as Support, the
rows as Detail; every control at least 44px; the skeleton reserves 460px (520px
on a phone) so the result lands without a layout shift; reduced motion turns the
group arrow's turn off.

## Link clear pairs

The group "Transfers waiting for their other side" (Needs fixing) can hold a
hundred pairs that are plainly the same money moving between the household's
own accounts (card payments, a monthly $450). When the report counts any
`clearTransferPairCount`, that group shows, above its rows, the line "Only pairs
with exactly one possible match on each side." and the button "Link these N
clear pairs" (owner approval, 2026-10-27). The rules for a clear pair and why
each is zero doubt are in `docs/audits/ledger-checkup.md`, "Clear pairs";
pairs that are not clear stay as ordinary rows with their own "Open the
transfer and link them".

1. The button opens one dialog (a sheet on a phone, a dialog on a wide screen:
   `SheetDialog`, hosted by `check-panel.jsx`, not the group, so it survives
   the group emptying). It reads `GET /api/ledger-checkup/clear-pairs[?view=]`
   fresh and shows: "Link N clear pairs", "N pairs, Jul 2025 to Aug 2026", the
   first ten pairs (date, amount, from account to account; no amount while
   money is hidden), "and N more", "Each pair will become one move between your
   accounts. Nothing is deleted. You can unlink a pair from its details.",
   "There is no undo for all of them at once.", and, when more than 100 are
   clear, "This links the first 100. N more pairs are still waiting
   afterwards."
2. Cancel (or Escape, or the close button) does nothing. "Link N pairs" is the
   only thing that writes: one `POST /api/ledger-checkup/clear-pairs` with the
   pairs listed (at most 100), the button reading "Linking…" and the dialog
   locked meanwhile.
3. The server recomputes the clear pairs and links only the requested pairs
   that still qualify; the rest come back as skipped ("changed"). The dialog
   ends on "Linked 92 pairs. 0 skipped." or "Linked 90 pairs. 2 changed since
   you looked and were skipped." and the page refreshes in the background
   (`runBackgroundRefresh(owner.refresh)`): the group and the counts update.
   Focus goes back to the button, or to the page title when the button is gone.
4. A failure (the whole request is one batch) says "Nothing was linked. Check
   your connection and try again." and keeps the same pairs ready; a preview
   that cannot be read says "Could not look at the pairs. Nothing was changed.
   Try again." An empty preview says "There are no clear pairs to link any
   more."

Proved by `tests/e2e/check-link-clear-pairs.spec.js` (desktop and 390px: the
group line and button, the preview, Cancel changes nothing, no layout shift,
confirm, the result line and the refreshed page, a pair that changed while the
dialog was open, hidden money, the keyboard, a failed link and its retry),
`tests/check-clear-pairs-client.test.mjs` and the server tests listed in the
audit.

## Fixing and coming back

Owner feedback (2026-10-29): after settling a transfer the person opened
Entries and had no way back to the list; the screen did not guide. Approved:
fix in place wherever the app has a dialog for it, and a way back wherever a
fix is a page. Frames and before/after shots:
[`docs/audits/check-flow-guidance/`](../audits/check-flow-guidance/README.md).

Which problems are fixed in place (`inPlaceFor` in `check-model.js`, from the
report's own id and fix path; no new report field):

| Problem | Primary button | Opens, over the page | Quiet secondary |
| --- | --- | --- | --- |
| two unlinked sides with exactly one match (`unmatched_transfer`, id names both entries) | **Link these two** | the small confirmation (`check-link-two-dialog.jsx`) | **Open in Entries** |
| a transfer with several matches, or none (same kind, other ids, series) | **Open transfer details** | the Transfer details dialog (`EntryTransferTools`, `check-transfer-dialog.jsx`, lazy) | **Open in Entries** |
| a mistake in a settled period (`settled_period_error`) | **Correct this** | the Correct a settled mistake dialog (`SplitCorrectionDialog`, lazy) | **Open in Splits** |

Every other kind keeps the report's own button as a page to open (the entry,
**Open Splits**, **Upload the missing statement in Imports**, the month's plan,
**Open Settings**): duplicates, wrong-card purchases, statement gaps and joins,
balance mismatches, stale estimates, the three plan problems and the tidy-ups.
The plan has no sheet shared with Check (the row sheets belong to the Month
page's own state), so plan problems navigate. Each row shows the primary on its
own line, then the quiet secondary and **This is fine** (all at least 44px; on
a phone the primary is full width and the other two share the next line).

In place, the data flow is one existing command each, never a write path of
Check's own:

```text
Link these two ──▶ GET /api/transfers/candidates?entryId=<a>   (fresh pair, both entries, direction)
                   confirm ──▶ owner.resolveInPlace(finding, POST /api/transfers/link)
Transfer details ─▶ GET /api/transfers/candidates; "Use match" ──▶ POST /api/transfers/link;
                    "Convert entry" / "Break connection" ──▶ POST /api/transfers/settle
Correct this ────▶ the dialog's own preview and POST /api/splits/corrections
```

- `owner.resolveInPlace` removes the row and moves the counts at once
  (`applyResolved`), asks the command, and puts the row back where it stood
  (`applyUnresolved`) with "Could not save that. Nothing was changed. Try
  again." if the command is refused or throws. A check already running when it
  lands is read again (`writeEpoch`), so it cannot bring the row back.
- On success the dialog closes, the shell's entry (and, for a correction,
  split) invalidation runs as it does after a change on Entries or Splits, the
  list is read once more quietly (`runBackgroundRefresh`), and focus goes to the
  next problem's primary button in the same group (else the one before, else
  the page title) so a person can work down the list. On cancel, Escape or
  close without a fix, focus goes back to the button that opened it.
- The line "Fixed. N things left." (or "Fixed. Nothing left.", "Nothing
  changed.") comes from the problem count before and after
  (`describeCheckChange`, `reportTotal`) and takes the place of the "Checking
  ..." line under the title for six seconds, so nothing moves; the polite
  status line announces it; there is no animation, so reduced motion needs no
  rule.
- Hidden money: the confirmation shows no amount. The Transfer details and
  correction dialogs are the existing components with their existing wording.

When a fix is a page, `openFix` writes the return marker
(`return-to-check.js`, `design.md` "Check origin") and navigates:

- the shell shows **‹ Check my books** (44px, keyboard focusable, top left above
  the page, on a phone and on a wide screen) on the destination page and on
  that page only: not when Entries is opened normally, not after the person
  goes to another page, and not in another browser tab. While an entry's own
  sheet is open (Entries `editing_entry`) it covers the page, and closing it
  leaves the link; the marker lives in sessionStorage because the pages rewrite
  their own address while they open an entry or split, which drops history
  state;
- the link, like the phone's back gesture, lands on `/check` with the person's
  view (the address kept in the marker), the groups the person opened, the rows
  shown with "Show more" and the scroll position; Check reads the list again
  (one request), the fixed problem is gone, and the line says "Fixed. N things
  left." or "Nothing changed.";
- if the person goes back before the other page was shown, Check is still
  mounted: it notices the arrival (`location.key`), reads again and puts itself
  back the same way.

Strings added (all in `copy/check-copy.js` except the link, in `copy/en-SG.js`
`returnToCheck`; linted by `tests/check-copy-lint.test.mjs`):
"Link these two", "Open transfer details", "Correct this", "Open in Entries",
"Open in Splits", "Could not save that. Nothing was changed. Try again.", the
confirmation ("Link these two?", "Looking at the two entries…", "They are the
same money moving between your accounts, so they will become one move. Nothing
is deleted. You can unlink them from their details.", "Money out", "Money in",
"Link these two", "Linking…", "Cancel", "Close", "Could not look at the two
entries. Nothing was changed. Try again.", "These two cannot be linked from
here any more. Open the transfer to choose.", "Nothing was linked. Check your
connection and try again."), the transfer shell ("Transfer details", "Looking
at this transfer…", "Could not look at this transfer. Nothing was changed. Try
again.", "This is no longer a transfer, so there is nothing to match."), the
line ("Fixed. N thing(s) left.", "Fixed. Nothing left.", "Nothing changed."),
and the link ("‹ Check my books", label "Back to Check my books").

Proved by `tests/check-guidance.test.mjs` (in-place choice per kind, optimistic
removal and rollback, the line, the next row, the marker),
`tests/e2e/check-flow-guidance.spec.js` (desktop and 390px: link in place with
focus and counts, refused link rolled back, Transfer details over the page,
the settled correction in place, the link and the browser's back with scroll,
open rows and view kept and one re-read, a fix made on Entries gone on return,
the link absent for everyone else and after leaving, Imports and Month
marker, hidden money, the keyboard path, no layout shift) and the updated
`check-my-books.spec.js`.

## Persisted And Query Contract

- Reads: `GET /api/ledger-checkup[?view=<id>][&dismissed=1]`, query key
  `["ledger-checkup", viewId, "visible" | "hidden"]`, always fetched fresh
  (`bypassCache`). The payload budget key `ledger-checkup` (3,360 bytes at demo
  scale; at most about 49 KB with 50 findings of a kind) is the audit's.
  The report carries one more number, `clearTransferPairCount`, worked out
  from the facts it already loaded (no further statement).
- `GET /api/ledger-checkup/clear-pairs[?view=]`: the preview, read when the
  dialog opens, never kept: two round trips, three statements.
- Writes: `POST /api/ledger-checkup/dismiss` and `undo-dismiss`, each
  all-or-nothing with its audit event (`docs/audits/ledger-checkup.md`), and
  `POST /api/ledger-checkup/clear-pairs` (the bulk link, one batch for the
  whole request, one audit event per pair, one marker per month).
- Browser storage: only `monies-map:check-open-groups`.
- No AI, no schedule, no speculative read, no new table.

## Audit Status

Link clear pairs built and proved (2026-10-27): see "Link clear pairs" and the
audit's "Clear pairs".

Phase 2 built and proved: `tests/check-model.test.mjs`,
`tests/check-data-owner.test.mjs`, `tests/check-copy-lint.test.mjs`,
`tests/e2e/check-my-books.spec.js` (desktop and 390px, plus every state), the
contrast test for every preset, `tests/client-route-chunks.test.mjs` and the
first-screen bundle budget. The header carries a seventh tab; its spacing is the
old 1,100 to 1,199px spacing at every width (`docs/audits/ledger-checkup.md`,
"Phase 2: the screen").

## Known Exceptions / Watch Areas

- A kind with more than 50 problems of a higher section leaves a lower section's
  group with a count and no rows ("not listed yet"); the report caps per kind,
  not per section.
- "Show hidden" runs the check again with `dismissed=1`; hidden problems count
  against the same 50-per-kind cap while the list is open.
- The wide header needs its tight spacing at every width now (see the audit);
  an eighth page tab would need a menu.
- Money at stake is not an openable figure (see Ownership Notes).
- Phase 3 will add a fix for a settled-period error; until then that group says
  "No fix yet" (the report's `fixNote`).
