# Desktop dialogs fit the window (2026-10-20)

Owner report (production, desktop): opening Manage transfer on an entry showed
Transfer details with its top cut off; the title and first rows could not be
seen or reached.

## Cause

Every desktop dialog is a `.note-dialog-content`: centred with
`top: 50%` and `translate(-50%, -50%)`, capped at `min(86vh, 100dvh - 48px)`,
with `overflow-y: auto` on the whole box. `SheetDialog` put its head, body
and actions bar in that one scrolling box. Transfer details for an unmatched
transfer is taller than the cap at every window checked (capped at 516 px
at 1280 x 600, 774 px at 1440 x 900), so Convert entry and Done started below
the dialog's edge, and once scrolled down to reach them, the title and the
first rows had scrolled off the top of the dialog. That is the owner's
screenshot (02).

## Sizing rule

- `.note-dialog-content` (`public/styles.css`): `max-height:
  min(86vh, calc(100vh - 48px))` then `min(86vh, calc(100dvh - 48px))`,
  `overflow-y: auto`, `overscroll-behavior: contain`, centred. Never taller
  than the window less 24 px a side, so the centred top is never above the
  window.
- `SheetDialog` on a wide screen (`src/client/sheet-dialog.css`): the dialog
  is a flex column that does not scroll; the head and the bar keep their
  height; the body (`.sheet-dialog-body`) takes the rest, scrolls
  (`overflow-y: auto`, `overscroll-behavior: contain`) and keeps its rows at
  their own height (`grid-auto-rows: max-content`; without it the Wallets
  rows, which clip their corners, were squeezed to nothing). Its padding
  gives back its negative margins, so a dialog that fits looks as before.
- The stale `.transfer-match-dialog { max-height: min(80vh, 820px);
  overflow: auto }` (always overridden) is gone.
- Phones keep the bottom sheet (`EntryMobileSheet`, already capped and lifted
  above the keyboard); unchanged.

## Dialogs checked (`tests/e2e/dialog-fit.spec.js`)

At 1280 x 600 and 1440 x 900 (Transfer details also at 1280 x 720 and
1366 x 768): the dialog is centred and inside the window, the title and the
actions are inside it, a wheel over it scrolls it to its end without moving
the page, and the title and actions are still in place.

| Dialog | Frame | Before (1280 x 600) | After |
| --- | --- | --- | --- |
| Transfer details (Manage transfer) | SheetDialog | Convert entry and Done below the edge | pass |
| Create match rule | SheetDialog | Cancel below the edge | pass |
| Statement checkpoint | SheetDialog | Cancel below the edge | pass |
| Create account | SheetDialog | Cancel below the edge | pass |
| Match bill or dated payment (plan row) | SheetDialog | Cancel below the edge | pass |
| Add to splits | one-off | pass | pass |
| New split expense | split dialog (sticky bar) | pass | pass |
| Record settlement (Settle group) | split dialog (sticky bar) | pass | pass |
| Rollback import | one-off | pass | pass |
| Transfer details on a phone (390 x 664) | bottom sheet | pass | pass |

Edit entry has no desktop dialog (it opens inline in the list). The import
duplicate-match popover is capped at `min(78vh, 680px)` and scrolls.

## Screenshots (demo data)

- [01](01-before-1280x600-open.webp) before, opened: no actions in view.
- [02](02-before-1280x600-scrolled.webp) before, scrolled to the actions: the
  title is gone (the owner's screenshot).
- [03](03-after-1280x600-open.webp) after, opened: title and bar in place.
- [04](04-after-1280x600-scrolled.webp) after, scrolled: only the body moved.
- [05](05-after-1440x900-open.webp) after at 1440 x 900.
