# Dialogs and small sheets in Lead · Support · Detail

Before and after screenshots for PR #35 (`dialogs-lsd`), awaiting the owner's
approval of the visuals. `before/` is `origin/master` (r7, `01708b95`), `after/`
is this branch merged with it. Both are the showcase demo data, a phone (WebKit,
iPhone 13, 390 wide) and a computer (Chromium 1280 x 800). Names end in
`-phone` or `-desktop`. Shots that exist only for one layout say so below.

| Dialog | Files |
| --- | --- |
| Delete entry | `entry-delete` |
| Delete split row | `split-delete` |
| Reset month | `month-reset` |
| Month Actions (popover on a wide screen, sheet on a phone) | `month-actions` |
| Edit category, Create category | `category-editor`, `category-create` |
| Transfer details | `transfer-details` |
| Row note (wide screen only), Monthly Note, Summary note | `row-note`, `month-note`, `summary-note` |
| Match planned item | `match-planned` |
| Add income source (the plan sheet on a phone; wide screens add inline) | `add-income` (phone only) |
| Settings: account, person, match rule | `account-editor`, `person-editor`, `rule-editor` |
| Archive account | `account-archive` |
| Clear unresolved transfers | `transfers-clear` |
| Statement checkpoint | `statement-checkpoint` |
| Set up this login | `login-registration` |
| Update connected note? | `connected-note` |
| "I've topped up" | `topped-up` |
| Picker sheet (phone only) | `picker-phone` |
| Import progress (phone only) | `import-progress-phone` |
| Delete row popover (Month plan, wide screen only) | `row-delete-desktop` |

Not shot: Reload app data and Enter empty state (the Demo state section is not
on the showcase stack; they use the same typed-confirmation frame as Reset
month), Restore preview row and Set diagnostic post date (they need an import
in a particular state; the frame is the one shown above).
