# Group spend counts the open period only

The Splits lead card's spend chip used to add up every expense ever recorded
in the group. It now adds up the open period: live expenses no settle-up has
covered (a closed batch, or a settlement checkpoint that is not `reopened` or
`voided`), the same set the entry count and the balance describe.

Screenshots (demo data, one group settled once, two newer expenses open, the
breakdown donut open): `before-desktop.png`, `before-phone.png`,
`after-desktop.png`, `after-phone.png`.

Strings:

- Chip, group settled before: "Spent since last settle-up" (was "Group spend").
- Chip, group never settled: "Group spend" (unchanged).
- Donut centre label, group settled before: "Since last settle-up"
  (was "Total spend" on Entries, "Spend" on Splits).
- Donut centre label, group never settled: "Group spend".

Visible change to decide: the longer chip no longer shares a row with the
person chip on a phone; it wraps to its own line.

Still open: on a person's view the donut charts that person's side of each
expense (what the other owes them, or their own share), so its centre figure
is not the chip's figure. That is the existing donut rule and was not changed.
