base='/Users/tim/22m/ai-projects/monies_map/.claude/worktrees/agent-a166ee5a4aa7b0680/'
def rep(path, old, new, count=1):
    p=base+path
    s=open(p).read()
    assert old in s, (path, old[:80])
    s=s.replace(old,new,count)
    open(p,'w').write(s)

# 1. The read: income of the last 4 months beside the other reads, and the pace.
rep('src/domain/pages/repeating-charges.ts','''export const REPEATING_ACCOUNTS_SQL = `''','''// Money in of the last 4 months (pace-facts.ts reads what came in and the
// regular income still due), for the view: the household's, or a person's
// own.
export const PACE_INCOME_SQL = `
  SELECT transactions.description, transactions.transaction_date AS date, transactions.amount_minor, categories.name AS category_name
  FROM transactions
  LEFT JOIN categories ON categories.id = transactions.category_id
  WHERE transactions.household_id = ?
    AND transactions.transaction_date >= ?
    AND transactions.transaction_date <= ?
    AND transactions.entry_type = 'income'
    AND transactions.transfer_group_id IS NULL
    AND (? = 'household' OR transactions.owner_person_id = ?)
`;

export const REPEATING_ACCOUNTS_SQL = `''')
rep('src/domain/pages/repeating-charges.ts','''  series: RepeatingSeriesDto[];
  mightRepeat: RepeatingSeriesDto[];
  takenOff: RepeatingSeriesDto[];
}''','''  series: RepeatingSeriesDto[];
  mightRepeat: RepeatingSeriesDto[];
  takenOff: RepeatingSeriesDto[];
  // If this keeps up (DOMAIN.md "Pace"), for today's month.
  pace?: PaceDto;
}''')
rep('src/domain/pages/repeating-charges.ts','''  const [people, grouped, accounts, choices, splitShares] = await Promise.all([''','''  const [people, grouped, accounts, choices, splitShares, income] = await Promise.all([''')
rep('src/domain/pages/repeating-charges.ts','''    selectedViewId !== "household" ? loadSplitShares(db, start, endExclusive) : Promise.resolve(null)
  ]);''','''    selectedViewId !== "household" ? loadSplitShares(db, start, endExclusive) : Promise.resolve(null),
    db.prepare(PACE_INCOME_SQL).bind(DEFAULT_HOUSEHOLD_ID, `${addMonths(today.slice(0, 7), -3)}-01`, today, selectedViewId, selectedViewId)
      .all<{ description: string; date: string; amount_minor: number; category_name: string | null }>()
  ]);''')
rep('src/domain/pages/repeating-charges.ts','''    mightRepeat: result.mightRepeat.map(toDto),
    takenOff: result.takenOff.map(toDto)
  };''','''    mightRepeat: result.mightRepeat.map(toDto),
    takenOff: result.takenOff.map(toDto),
    pace: buildPaceDto({
      today,
      rows,
      result,
      accountLatestDate,
      income: income.results.map((row) => ({ description: row.description, date: row.date, amountMinor: row.amount_minor, categoryName: row.category_name }))
    })
  };''')
rep('src/domain/pages/repeating-charges.ts','''import { addDays } from "../money-signals/format";''','''import { addDays, addMonths } from "../money-signals/format";
import { buildPaceDto, type PaceDto } from "./pace-facts";''')

# 2. The figure's name.
rep('src/client/copy/figure-copy.js','''  splits: "Splits",''','''  splits: "Splits",
  // If this keeps up (pace-line.jsx): a range, not entries.
  pace: "If this keeps up",''')

# 3. Coming up's total, under the same rule.
rep('src/client/subscriptions-section.jsx','''        <ul className="subs-list" aria-label={copy.comingUp}>''','''        {comingUp?.count && !hiddenMoney ? (
          <p className="subs-coming-total">{paceCopy.comingUpTotal(money(comingUp.total.lowMinor), money(comingUp.total.highMinor), comingUp.endDate)}</p>
        ) : null}
        <ul className="subs-list" aria-label={copy.comingUp}>''')
rep('src/client/subscriptions-section.jsx','''  const comingUp = useMemo(() => buildComingUp(answer), [answer]);''','''  const comingUp = useMemo(() => buildComingUp(answer), [answer]);
  const hiddenMoney = !useMoneyPrivacy().areTotalsVisible;''')
rep('src/client/subscriptions-section.jsx','''import { subscriptionsCopy as copy } from "./copy/subscriptions-copy";''','''import { subscriptionsCopy as copy } from "./copy/subscriptions-copy";
import { paceCopy } from "./copy/pace-copy";
import { PaceLine } from "./pace-line";''')
rep('src/client/subscriptions-model.js','''  return { endDate: addDays(today, days), count: upcoming.length, groups: groups.filter((group) => group.items.length) };''','''  // The 30 days' total, rounded outward (If this keeps up, DOMAIN.md "Pace").
  const total = roundOutward(upcoming.reduce((sum, item) => sum + item.lowMinor, 0), upcoming.reduce((sum, item) => sum + item.highMinor, 0));
  return { endDate: addDays(today, days), count: upcoming.length, total, groups: groups.filter((group) => group.items.length) };''')
rep('src/client/subscriptions-model.js','''import { COMING_UP_DAYS, upcomingCharges } from "../domain/repeating-charges";''','''import { COMING_UP_DAYS, upcomingCharges } from "../domain/repeating-charges";
import { roundOutward } from "../domain/pace";''')
rep('src/client/subscriptions-section.css','''.subs-empty {''','''.subs-coming-total {
  margin: 0 0 8px;
  color: var(--pastel-sky-ink);
  font-size: 0.86rem;
  font-weight: 600;
}

.subs-empty {''')

# 4. The pace on Summary (under the month-by-month chart) and Month (under
#    the lead): one component that reads the same answer as the card.
s=open(base+'src/client/subscriptions-section.jsx').read()
s+='''
/**
 * If this keeps up for today's month, from the same answer as the card (one
 * request for both). Summary shows it under its month-by-month chart, Month
 * under its lead (owner decision D6).
 * @param {{ view: any, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, spentSoFarMinor?: number | null, planMinor?: number | null, showLeft?: boolean }} props
 */
export function PaceSection({ view, enabled, fetchRequiredQuery, spentSoFarMinor = null, planMinor = null, showLeft = false }) {
  const queryClient = useQueryClient();
  const { areTotalsVisible } = useMoneyPrivacy();
  const { answer } = useRepeatingCharges({ queryClient, viewId: view.id, scope: view.selectedScope, enabled, fetchRequiredQuery });
  if (!answer?.pace?.range || !areTotalsVisible) {
    return null;
  }
  return (
    <>
      <PaceLine pace={answer.pace} spentSoFarMinor={spentSoFarMinor} planMinor={planMinor} money={money} hidden={!areTotalsVisible} showLeft={showLeft} />
    </>
  );
}
'''
open(base+'src/client/subscriptions-section.jsx','w').write(s)
rep('src/client/spending-mix-section.jsx','''export { SubscriptionsSection } from "./subscriptions-section";''','''export { PaceSection, SubscriptionsSection } from "./subscriptions-section";''')
rep('src/client/repeating-charges-api.js','''    takenOff: readList(body.takenOff)
  };''','''    takenOff: readList(body.takenOff),
    pace: body.pace && typeof body.pace === "object" && typeof body.pace.month === "string" ? body.pace : null
  };''')

# Summary: under the chart, for the current month.
rep('src/client/summary-panel.jsx','''const SubscriptionsSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.SubscriptionsSection })));''','''const SubscriptionsSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.SubscriptionsSection })));
const PaceSection = lazy(() => import("./spending-mix-section").then((module) => ({ default: module.PaceSection })));''')
rep('src/client/summary-panel.jsx','''  const monthChart = safeSummaryPage.months.length > 1 && isMoneyShown ? (
    <Suspense fallback={<div className="earned-spent-chart-reserve" aria-hidden="true" />}>
      <EarnedSpentChart key={leadView} mode={leadView} page={safeSummaryPage} />
    </Suspense>
  ) : null;''','''  // If this keeps up (DOMAIN.md "Pace"), under the chart when the range
  // ends in this month: read once the top summary is usable.
  const thisMonth = useCheckInClock().today.slice(0, 7);
  const currentMonthRow = safeSummaryPage.months.find((month) => month.month === thisMonth);
  const paceUnderChart = cardsUsable && fetchRequiredQuery && currentMonthRow && safeSummaryPage.rangeEndMonth === thisMonth ? (
    <Suspense fallback={null}>
      <PaceSection
        view={view}
        enabled={cardsUsable}
        fetchRequiredQuery={fetchRequiredQuery}
        spentSoFarMinor={currentMonthRow.realExpensesMinor ?? null}
        planMinor={leadView === "plan" ? currentMonthRow.estimatedExpensesMinor ?? null : null}
        showLeft
      />
    </Suspense>
  ) : null;
  const monthChart = safeSummaryPage.months.length > 1 && isMoneyShown ? (
    <>
      <Suspense fallback={<div className="earned-spent-chart-reserve" aria-hidden="true" />}>
        <EarnedSpentChart key={leadView} mode={leadView} page={safeSummaryPage} />
      </Suspense>
      {paceUnderChart}
    </>
  ) : null;''')
