# Splits donut modes: Your share | Whole group

Owner decision (2026-10-22): the Splits donut gets a two-option switch.

- **Your share** (default, as before): the person's own share of each open
  expense. Centre: "Your share since last settle-up" / "Your share".
- **Whole group**: each category's full amount of the same open expenses (the
  chip's set, `summariseOpenPeriod`). Centre: the chip's words, "Since last
  settle-up" / "Group spend", and its figure equals the chip to the cent.

Screenshots (demo data, Okaeri settled once, two newer expenses open):
`before-desktop.png`, `before-phone.png` (the donut before, no switch),
`after-desktop-your-share.png`, `after-phone-your-share.png`,
`after-desktop-whole-group.png`, `after-phone-whole-group.png`.

## Rules

- Per-category invariant: your share + the other person's share = Whole group
  (`tests/splits-figures-agree.test.mjs`, uneven splits whoever paid).
- The choice is kept in `localStorage` (`monies.splits.donutMode`), per device,
  and stays when the group changes. Blocked storage falls back to Your share.
- The switch is a radio group labelled "What the chart adds up" in the
  `lead-view-switch` look (44 px targets, arrow keys from the browser).
- The everyone reading has one chart and renders no switch. On Splits the
  Household pill is disabled, so a person always sees the switch; the guard is
  unit-tested.
- Hidden money: both centres show dots and keep their label; no amount appears.
- Motion: the ring sweeps once per mount when it scrolls into view (never for
  reduced motion). Switching modes does not replay it.
- Slices are not openable figures (no `data-fig`) in either mode, as before.
- No server or payload change; no first-screen code (all in the lazy Splits
  chunk).

## Strings

"Your share" (switch option, existing words), "Whole group" (switch option),
"What the chart adds up" (switch accessible name). The centre labels are the
existing "Your share since last settle-up", "Your share", "Since last
settle-up", "Group spend".
