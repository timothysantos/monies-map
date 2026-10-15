# Month and Summary lead: vertical rhythm and legend shares

Owner report (15 October 2026, Month, Plan, October 2026): "I think we need to
rethink the spacings here? like line spacing?" The card's lines were packed
2 to 4 px apart (the legend glued to the bar, the sentence to the legend, the
toggle to the sentence, the stat labels to their figures) while the money jobs
rows were airy. The same screenshot showed legend shares of "26347%".

## Changes

- Rhythm (`src/client/summary-lead.css`, "The lead's vertical rhythm"; Month
  padding in `month-route.css`): one scale shared by the Summary lead, the
  Month lead and the Ask bar, 4 px between lines of a group, 8 px from the bar
  to its legend, 12 px between groups (16 px from 761 px), a line-height on
  every text role. design.md "Lead rhythm".
- Shares (`src/client/savings-bar-model.js`): a legend share of income shows
  only when spent plus invested fit inside the income; with no income or more
  out than in, none shows (hidden money follows the same rule).
- Phone height: the Month card is at most 270 px (was 215). The old cap came
  from 2 px gaps. This is the one trade the rhythm costs; the caps in the
  Month and Summary specs moved with it.
- No wording, colour or behaviour changed. No new control. `public/styles.css`
  is untouched (the first-screen CSS budget is unchanged).

## Proof

- `tests/savings-bar-model.test.mjs`: shares rule (earned $10.12 against
  $2,666 spent: none; earned $6,000: shown and adding to 100; no income;
  exactly equal; one cent over; hidden money). Fails on the old model.
- `tests/e2e/savings-bar.spec.js` `expectLeadRhythm`: measured gaps between
  the rendered boxes (4, 8, 12 or 16), the legend never closer than 8 px to the
  bar, line-height ratios, legend rows inside the card. Month at 390 and 1440
  px, Summary at 1440 px. Fails on the old CSS.

## Screenshots

`before-*` and `after-*` in this folder, named
`<label>-<page>-<over|fits>-<device>-<plan|simple>-<palette>-<mode>.webp`.
`over` is the owner's case (salary not landed: $10.12 earned, $2,571.67
spent); `fits` is a month that saved. Palettes: 70s (light, dark) and Black &
White (light).
