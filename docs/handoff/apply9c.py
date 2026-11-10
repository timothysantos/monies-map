base='/Users/tim/22m/ai-projects/monies_map/.claude/worktrees/agent-a166ee5a4aa7b0680/'
def rep(path, old, new, count=1):
    p=base+path
    s=open(p).read()
    assert old in s, (path, old[:80])
    s=s.replace(old,new,count)
    open(p,'w').write(s)

rep('src/client/month-panel.jsx','''import { SpendingMixSection } from "./spending-mix-section";''','''import { PaceSection, SpendingMixSection } from "./spending-mix-section";''')
rep('src/client/month-panel.jsx','''export function MonthPanel({ view, accounts, people, categories, onCategoryAppearanceChange, onRefresh, runBackgroundRefresh = runQuietly, isDemoEnvironment = false }) {''','''export function MonthPanel({ view, accounts, people, categories, onCategoryAppearanceChange, onRefresh, runBackgroundRefresh = runQuietly, isDemoEnvironment = false, cardsUsable = false, fetchRequiredQuery = undefined }) {''')
rep('src/client/month-panel.jsx','''        isRefreshing={isMonthDataRefreshing || hasPendingDerivedMonthData}
      />
''','''        isRefreshing={isMonthDataRefreshing || hasPendingDerivedMonthData}
      />

      {/* If this keeps up (DOMAIN.md "Pace"): this month only, read once the
          page is usable, the same answer Summary's card reads. */}
      {cardsUsable && fetchRequiredQuery && view.monthPage.month === checkInClock.today.slice(0, 7) ? (
        <PaceSection
          view={view}
          enabled={cardsUsable}
          fetchRequiredQuery={fetchRequiredQuery}
          spentSoFarMinor={selectedMonthSummary?.realExpensesMinor ?? null}
          planMinor={isSimple ? null : selectedMonthSummary?.estimatedExpensesMinor ?? null}
        />
      ) : null}
''')
rep('src/client/App.jsx','''  const summaryCardsUsable = renderedTabId === "summary" && routeWork.usable;''','''  const summaryCardsUsable = renderedTabId === "summary" && routeWork.usable;
  const monthCardsUsable = renderedTabId === "month" && routeWork.usable;''')
rep('src/client/App.jsx','''          runBackgroundRefresh={runBackgroundRefresh}
          isDemoEnvironment={appEnvironment === "demo"}
        />''','''          runBackgroundRefresh={runBackgroundRefresh}
          isDemoEnvironment={appEnvironment === "demo"}
          cardsUsable={monthCardsUsable}
          fetchRequiredQuery={fetchRequiredQuery}
        />''')
rep('src/client/App.jsx','''    summaryCardsUsable,
    fetchAskEntriesPage,''','''    summaryCardsUsable,
    monthCardsUsable,
    fetchAskEntriesPage,''')
