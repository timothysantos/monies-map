// The reminder rules' thresholds, exactly as the proposal states them
// (docs/proposals/reminders/README.md, "The rules"). They are DEFAULTS: the
// owner's decision D1 ("approve the five reminder kinds and their rules")
// is still pending, and a change to any number here is a one-line edit that
// the rule tests then pin. Nothing is configurable per person.
export const REMINDER_THRESHOLDS = Object.freeze({
  cardBill: Object.freeze({
    // A bill shows from this many days before its due date ...
    daysBeforeDue: 7,
    // ... and, once overdue, for this many days while less than its minimum
    // is paid (the same numbers as the check-in's cardBillSignal).
    daysOverdue: 30
  }),
  statementMissing: Object.freeze({
    // Statements an account needs before its closing day can be inferred,
    // and how many of the latest are used (median of their end days).
    minStatements: 2,
    closingDaySample: 3,
    // Banks publish the PDF a few days after the statement closes.
    graceDays: 5
  }),
  splits: Object.freeze({
    // An open settle-up waiting longer than this many days.
    settleUpDays: 14,
    // Otherwise a group's open balance of at least this much (home currency
    // minor units, $20) whose oldest open record is at least this old.
    groupBalanceMinMinor: 2000,
    groupBalanceDays: 28
  }),
  monthClose: Object.freeze({
    // A month's card stays this many days after the month ended (so for the
    // first half of the next month the month before it can still show).
    showDaysAfterMonthEnd: 45
  }),
  priceChange: Object.freeze({
    // Charges at one amount in a row before a change counts.
    stableMonthlyCharges: 3,
    stableYearlyCharges: 2,
    // The new amount must differ by at least this much AND this share.
    minChangeMinor: 100,
    minChangeRatio: 0.05,
    // Shown for this many days from the first new charge.
    showDays: 45,
    // How far back charges are read. Yearly subscriptions need two old
    // yearly charges plus the new one, so their window is longer than the
    // proposal's "about 13 months" (which fits monthly ones).
    monthlyLookbackMonths: 13,
    yearlyLookbackMonths: 26
  })
});

// Categories whose charges are read for price changes, and how often each
// repeats. Only these (never one-off spending), and never a foreign-currency
// charge: exchange rates move every month.
export const SUBSCRIPTION_CATEGORY_PERIODS: Readonly<Record<string, "monthly" | "yearly">> = Object.freeze({
  "Subscriptions MO": "monthly",
  "Subscriptions YR": "yearly",
  "Bills": "monthly"
});

// Categories that mean "no category yet" (the month-close "nothing left in
// Other" check): an entry with no category shows as Other everywhere.
export const UNCATEGORISED_CATEGORY_NAMES: readonly string[] = Object.freeze(["Other", "Other - Income"]);

// The most reminders one answer carries (the screen shows 2 or 3 and a "N more").
export const REMINDERS_MAX = 20;
