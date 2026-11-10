base='/Users/tim/22m/ai-projects/monies_map/.claude/worktrees/agent-a166ee5a4aa7b0680/'
def rep(path, old, new, count=1):
    p=base+path
    s=open(p).read()
    assert old in s, (path, old[:80])
    s=s.replace(old,new,count)
    open(p,'w').write(s)

# AGENTS.md: the rule change, word for word (the design's section 5).
rep('AGENTS.md','''- Money insights are a deterministic, read-only projection. They may show
  recorded cash flow, plan variance, a same-season comparison that is
  already loaded, and explicit bank-proof gaps. They never predict
  spending, never give a safe-to-spend figure or a month-end balance, never
  set a savings target, and never come from AI.''','''- Money insights and the charts are a deterministic, read-only projection
  and never come from AI. They may show recorded cash flow, plan variance,
  a same-season comparison that is already loaded, explicit bank-proof
  gaps, and the pace (owner decision, 2026-11-10; DOMAIN.md "Pace"): where
  this month's spending, and what is left of what comes in, end up if the
  month keeps going as it has, and (Summary only) what is kept by year end.
  A pace is always a range, low to high, rounded outward, labelled "If this
  keeps up", and drawn dotted or hatched in the plan (sky) tone, never a
  new hue. It is built only from recorded entries: everyday spending at its
  pace this month and its usual pace, repeating charges and regular income
  still due on their usual days at their recorded amounts, and one-offs
  counted once, never scaled. It is quiet in the first 5 days of a month,
  with fewer than 3 complete months of history, and while imports are
  behind. A pace is never a safe-to-spend figure, an account balance, a
  savings target or a View entries figure, and its words never reassure
  ("safe", "can afford", "you'll be fine"). Subscriptions and bills'
  Coming up may total its next 30 days under the same rule.''')
rep('AGENTS.md','''- The one look ahead Money insights may make is the `scheduled check`
  (DOMAIN.md):''','''- Besides the pace, the one look ahead Money insights may make is the
  `scheduled check` (DOMAIN.md):''')

rep('DOMAIN.md','''- The scheduled check is the only look ahead in Money insights. It never''','''- The scheduled check and the pace (see "Pace") are the only looks ahead. It never''')
rep('DOMAIN.md','''### Category
''','''### Pace

"If this keeps up" (owner decision, 2026-11-10): where this month's
spending, and what is left of what comes in, end up if the month keeps
going as it has (`src/domain/pace.ts`). Shown on Summary under the
month-by-month chart and on Month under the lead (owner decision D6).

Canonical terms:
- `pace`: a range, low to high, rounded outward ($10 under $1,000, $50 under
  $10,000, then $100; the low end down, the high end up), always labelled
  "If this keeps up" and drawn in the plan (sky) tone, dotted or hatched.
- `spent so far`: the month's recorded spending, the figure the page shows.
- `lumpy parts`: charges in a repeating series and one-offs (a single entry
  of at least $300, or at least 3 times the month's middle entry, not in a
  series), counted once as recorded, never scaled up.
- `everyday pace`: what is left per day gone (this month's rate) and the
  middle of the last 3 complete months' everyday daily rates (the usual
  rate). Low and high are the days left at the lower and the higher rate;
  rates within 10% of each other widen to 10% either side of their middle
  (owner decision D8).
- `bills still to come`: each monthly series whose usual day is after today
  and still this month, at its last amount (one that changes: the lowest and
  highest of its last 3); a yearly one only when its date falls in the month.
- `money in`: what came in so far plus regular income (at least $500 from
  the same payer each of the last 2 months) still due this month on its
  usual day. Nothing else is assumed.
- `quiet`: days 1 to 5, fewer than 3 complete months with entries, a past
  month, imports behind (the busiest account's latest entry is more than 10
  days old), or money hidden (no shape either).

Important distinctions:
- A pace is never a safe-to-spend figure, an account balance, a savings
  target or a View entries figure; its words never reassure. It is a figure
  (`data-fig="pace"`) whose menu says how it is worked out and offers Ask
  about this, never View entries.
- Subscriptions and bills' Coming up may total its next 30 days under the
  same rule ("About $500 to $540 by 10 Dec, if they come as usual").

### Category
''')

# The copy doc's Tone (generated from scripts/money-insights-copy.mjs).
rep('scripts/money-insights-copy.mjs','''    "no percentage without the money amount beside it.",
    "",''','''    "no percentage without the money amount beside it.",
    "",
    "A look ahead says \\"If this keeps up\\" and gives a range (\\"about $4,700 to",
    "$5,100 by 30 Nov\\"), never one number. Words the pace lint rejects: safe,",
    "safely, can afford, you'll be fine, will have, guaranteed, forecast,",
    "projection.",
    "",''')

# The pace lint.
rep('src/domain/money-signals/tone.ts','''// Returns what breaks the tone rules in one line of copy; empty when fine.''','''// The words a look ahead never uses (DOMAIN.md "Pace"): it is a range from
// recorded entries, never a reassurance or a promise.
const PACE_AVOID = /\\b(?:safe|safely|can afford|you(?:'|\\u2019)ll be fine|will have|guaranteed|forecast|projection)\\b/i;

export function findPaceProblems(text: string): string[] {
  const match = text.match(PACE_AVOID);
  return match ? [`uses "${match[0]}"`] : [];
}

// Returns what breaks the tone rules in one line of copy; empty when fine.''')
