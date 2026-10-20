# Summary Plan layout: full-width lead, title-row scope, stat strip

Owner request, 2026-10-20: on a desktop, Summary in Plan wasted space. The
lead card sat beside a right column holding "Viewing • Tim", the
Direct / Shared / Both switch and two tall, mostly empty cards, Income and
Saved, that repeated the lead's figures. Approved to implement with
before/after screenshots; the owner can veto afterwards.

## What changed

| Before | After |
| --- | --- |
| "Summary" title in a left column, the lead in the middle, a right column with the viewer, the scope switch and the Income and Saved cards | The title row holds "Summary", "Viewing • Tim" and the scope switch; the lead card takes the full Summary width under it |
| Income and Saved as two tall tinted cards beside the lead | Income and Saved as the lead's stat strip (the Month lead's `LeadColumn` pattern): label, figure in its money tone as text, "plan $x" / "target $x" |
| Money jobs under the sentence, the card one tall column | From a 960 px wide card: two columns. Left: eyebrow, headline, progress line, bar, legend, sentence. Right, after a hairline: the money jobs line level with the eyebrow (Plan / Simple switch at its end), the jobs as the person left them, then the strip |
| Simple: title and scope in a left column beside the lead | Simple: the same title row and a full-width card; the Simple lead itself is unchanged |
| Phone | Unchanged: stacked lead, Income and Saved pills under it, floating View and scope bar |

Every figure the old cards had is in the strip, with the same openable
menu (`data-fig="earned"` with the income plan, `data-fig="kept"` with the
whole plan): View entries, Open plan, Ask about this. Hidden money shows
dots in plain ink and no tint, as before.

Why 960 px of card and not 1,200: the page is capped at 1,164 px, so the
Summary card is 1,122 px wide at 1,280, 1,440 and 1,920 px windows and
never reaches 1,200. 960 px of card is about a 1,200 px window; below it
(a narrow window, or the Ask panel docked beside the page) the card stacks
with the strip under the money jobs.

## Lead card height (1,440 px)

| Data | Before | After | Change |
| --- | --- | --- | --- |
| Showcase demo, Ethan, Sep 2025 – Aug 2026 (these screenshots) | 383 px | 276 px | −28% |
| Test seed, Tim, Jun 2025 – May 2026 (`tests/e2e/summary-plan-layout.spec.js`) | 331 px | 243 px | −27% |

The same at 1,280 and 1,920 (the card is the same width). The whole header
(title row plus lead) is shorter too: 383 → 335 px on the showcase. Simple
is 59 px taller in total than before (the title row is now above the card
instead of beside it), with the same card height (207 px).

## Screenshots

Showcase demo data (`DEMO_DATASET=showcase`, seed month 2026-09), range
Sep 2025 – Aug 2026, Plan unless named. `before-*` is origin/master
1afff395, `after-*` this change.

- `*-1280-light`, `*-1440-light`, `*-1920-light`: Household
- `*-1280-person-light`, `*-1440-person-light`, `*-1920-person-light`: Ethan (with the scope switch)
- `*-1440-dark`: Ethan, 70s Warm dark
- `*-1440-modern-light`: Ethan, the Modern preset
- `*-1440-hidden`: Ethan, money hidden
- `*-1440-simple`: Ethan, Simple
- `*-phone-light`, `*-phone-dark`: Ethan on an iPhone 13 (unchanged)

## Proof

- `tests/e2e/summary-plan-layout.spec.js`: at 1,280, 1,440 and 1,920 no
  Income or Saved cards, the strip's figures equal the old cards' (worked
  out from the page DTO), the scope switch in the title row and not cut,
  the two columns, the card at most 75% of its old height at 1,440; the
  strip's menus and View entries totals; the money jobs keep their folded
  state; layout shift at most 0.05 on load; the phone unchanged.
- Updated: `lead-support-detail`, `lead-simple-view`, `money-tones`,
  `savings-bar` (rhythm in the two-column card) and `summary-workflow`
  (scope switch in the title row).
