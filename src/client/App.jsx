import React, { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

const moneyFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD"
});

const categoryThemes = {
  "Food & Drinks": { color: "#1f7a63", glyph: "🍽" },
  Shopping: { color: "#d4b35d", glyph: "🛍" },
  "Family & Personal": { color: "#4f8fd6", glyph: "👪" },
  Tax: { color: "#cc63d8", glyph: "🧾" },
  Groceries: { color: "#f08b43", glyph: "🛒" },
  Travel: { color: "#4f8fd6", glyph: "✈" },
  "Sport & Hobbies": { color: "#96a95a", glyph: "🎾" },
  Bills: { color: "#6a7a73", glyph: "💡" },
  Entertainment: { color: "#d56bdd", glyph: "🎬" },
  "Public Transport": { color: "#56a4c9", glyph: "🚌" }
};

const fallbackThemes = [
  { color: "#1f7a63", glyph: "•" },
  { color: "#d4b35d", glyph: "•" },
  { color: "#4f8fd6", glyph: "•" },
  { color: "#cc63d8", glyph: "•" },
  { color: "#f08b43", glyph: "•" },
  { color: "#96a95a", glyph: "•" }
];

const faqItems = [
  {
    question: "What is Monie's Map trying to answer?",
    answer:
      "Not only what got spent. The app is trying to answer what was intended, what happened, whether the difference was justified, whether savings were hurt, and which assumption was wrong."
  },
  {
    question: "What does over-granular mean here?",
    answer:
      "Over-granular means budgeting too many unstable or one-off purchases as separate planned rows. Based on the June to October sheets, your current split already looks reasonable: planned items on top and broader budget buckets below."
  },
  {
    question: "Why is the month view split into planned items and budget buckets?",
    answer:
      "Planned items are intentional commitments like savings, loan, tax, subscriptions, or specific one-offs. Budget buckets are flexible categories like food, groceries, shopping, and transport."
  },
  {
    question: "Should this FAQ be updated later?",
    answer:
      "Yes. The FAQ is a living product document and should be updated whenever setup, workflow, philosophy, or user-facing behavior changes."
  }
];

const tabs = [
  { id: "summary", label: "Summary" },
  { id: "month", label: "Month" },
  { id: "entries", label: "Entries" },
  { id: "imports", label: "Imports" },
  { id: "faq", label: "FAQ" }
];

export function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [selectedViewId, setSelectedViewId] = useState("household");
  const [activeTab, setActiveTab] = useState("summary");

  useEffect(() => {
    let active = true;

    async function load() {
      const response = await fetch("/api/bootstrap");
      const data = await response.json();
      if (!active) {
        return;
      }

      setBootstrap(data);
      setSelectedViewId(data.selectedViewId);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  const view = useMemo(
    () => bootstrap?.views.find((item) => item.id === selectedViewId) ?? null,
    [bootstrap, selectedViewId]
  );

  const periodMode = activeTab === "month" || activeTab === "entries" ? "Month" : "Year";
  const periodLabel = activeTab === "month" || activeTab === "entries"
    ? formatMonthLabel(view?.monthPage?.month ?? "2025-10")
    : "2025";

  if (!bootstrap || !view) {
    return <main className="shell"><section className="panel"><p>Loading...</p></section></main>;
  }

  return (
    <main className="shell">
      <section className="control-bar">
        <div className="context-block">
          <div className="pill-row">
            <button
              className={`pill ${selectedViewId === "household" ? "is-active" : ""}`}
              type="button"
              onClick={() => setSelectedViewId("household")}
            >
              Household
            </button>
            {bootstrap.household.people.map((person) => (
              <button
                key={person.id}
                className={`pill ${selectedViewId === person.id ? "is-active" : ""}`}
                type="button"
                onClick={() => setSelectedViewId(person.id)}
              >
                {person.name}
              </button>
            ))}
          </div>
        </div>

        <div className="period-inline">
          <nav className="tab-strip" aria-label="Dashboard sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? "is-active" : ""}`}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <button className="period-button" type="button" aria-label="Previous period">‹</button>
          <div className="period-display">
            <span className="period-mode">{periodMode}</span>
            <strong>{periodLabel}</strong>
          </div>
          <button className="period-button" type="button" aria-label="Next period">›</button>
        </div>
      </section>

      <section className="grid">
        {activeTab === "summary" && <SummaryPanel view={view} />}
        {activeTab === "month" && <MonthPanel view={view} accounts={bootstrap.accounts} />}
        {activeTab === "entries" && <EntriesPanel view={view} />}
        {activeTab === "imports" && <ImportsPanel importsPage={bootstrap.importsPage} viewLabel={view.label} />}
        {activeTab === "faq" && <FaqPanel viewLabel={view.label} />}
      </section>
    </main>
  );
}

function SummaryPanel({ view }) {
  return (
    <article className="panel panel-accent">
      <div className="panel-head summary-head">
        <div>
          <h2>Summary</h2>
          <span className="panel-context">Viewing • {view.label}</span>
        </div>
        <div className="metric-row metric-row-summary summary-head-metrics">
          {view.summaryPage.metricCards.map((card) => (
            <MetricCard key={card.label} card={card} />
          ))}
        </div>
      </div>

      <div className="summary-top-grid">
        <section className="chart-card">
          <div className="chart-head">
            <h3>Spending Mix</h3>
          </div>
          <div className="summary-mix">
            <SpendingMixChart data={view.summaryPage.categoryShareChart} />
            <div className="share-list">
              {view.summaryPage.categoryShareChart.map((item, index) => {
                const theme = getCategoryTheme(item.label, index);
                const total = view.summaryPage.categoryShareChart.reduce((sum, current) => sum + current.valueMinor, 0) || 1;
                const percentage = ((item.valueMinor / total) * 100).toFixed(1);
                return (
                  <div key={item.key} className="share-row">
                    <div className="category-key">
                      <span className="category-icon" style={{ "--category-color": theme.color }}>
                        <span>{theme.glyph}</span>
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{money(item.valueMinor)} • {percentage}%</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="chart-card">
          <div className="chart-head">
            <h3>Intent vs Outcome</h3>
            <p>Monthly comparison with expandable detail.</p>
          </div>
          <div className="chart-bars">
            {[...view.summaryPage.months]
              .sort((left, right) => right.month.localeCompare(left.month))
              .map((month, index) => (
                <details key={month.month} className="plan-row-card" open={index === 0}>
                  <summary className="plan-row-summary">
                    <div className="plan-row-head">
                      <div>
                        <strong>{formatMonthLabel(month.month)}</strong>
                        <p>{money(month.incomeMinor)} income</p>
                      </div>
                      <span className={month.actualVarianceMinor >= 0 ? "positive" : "negative"}>
                        {money(month.actualVarianceMinor)}
                      </span>
                    </div>
                  </summary>
                  <div className="plan-row-content">
                    <BarLine label="Planned" valueMinor={month.plannedExpenseMinor} maxMinor={month.actualExpenseMinor > month.plannedExpenseMinor ? month.actualExpenseMinor : month.plannedExpenseMinor} tone="planned" />
                    <BarLine label="Actual" valueMinor={month.actualExpenseMinor} maxMinor={month.actualExpenseMinor > month.plannedExpenseMinor ? month.actualExpenseMinor : month.plannedExpenseMinor} tone="actual" />
                    <div className="plan-row-grid">
                      <MiniStat label="Savings target" value={money(month.targetSavingsMinor)} />
                      <MiniStat label="Plan gap" value={money(month.plannedVarianceMinor)} tone={month.plannedVarianceMinor >= 0 ? "positive" : "negative"} />
                      <MiniStat label="Real gap" value={money(month.actualVarianceMinor)} tone={month.actualVarianceMinor >= 0 ? "positive" : "negative"} />
                      <MiniStat label="Realized savings" value={money(month.targetSavingsMinor + month.actualVarianceMinor)} tone={month.targetSavingsMinor + month.actualVarianceMinor >= 0 ? "positive" : "negative"} />
                    </div>
                    <p className="plan-row-note">{month.note}</p>
                  </div>
                </details>
              ))}
          </div>
        </section>
      </div>
    </article>
  );
}

function SpendingMixChart({ data }) {
  const total = data.reduce((sum, item) => sum + item.valueMinor, 0);
  const chartData = data.map((item, index) => ({
    ...item,
    ...getCategoryTheme(item.label, index)
  }));

  return (
    <div className="spending-mix-chart-shell">
      <div className="spending-mix-chart">
        <ResponsiveContainer width="100%" height={360}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="valueMinor"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={120}
              paddingAngle={0}
              isAnimationActive={false}
              labelLine={false}
              label={(props) => renderPieCallout(props, total)}
            >
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center recharts-donut-center">
          <span>Total spend</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
    </div>
  );
}

function renderPieCallout(props, total) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props;
  if (!percent || percent < 0.1) {
    return null;
  }

  const radians = (Math.PI / 180) * -midAngle;
  const sx = cx + Math.cos(radians) * (outerRadius + 6);
  const sy = cy + Math.sin(radians) * (outerRadius + 6);
  const mx = cx + Math.cos(radians) * (outerRadius + 22);
  const my = cy + Math.sin(radians) * (outerRadius + 22);
  const bx = cx + Math.cos(radians) * (outerRadius + 46);
  const by = cy + Math.sin(radians) * (outerRadius + 46);
  const isRight = Math.cos(radians) >= 0;
  const tx = bx + (isRight ? 34 : -34);
  const percentage = ((payload.valueMinor / total) * 100).toFixed(1);

  return (
    <g>
      <path d={`M${sx},${sy} L${mx},${my} L${bx},${by}`} stroke={payload.color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.82" />
      <circle cx={bx} cy={by} r="18" fill={payload.color} />
      <text x={bx} y={by + 1} textAnchor="middle" dominantBaseline="middle" fontSize="15">
        {payload.glyph}
      </text>
      <text x={tx} y={by + 1} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" fill={payload.color} fontSize="15" fontWeight="700">
        {percentage}%
      </text>
    </g>
  );
}

function MonthPanel({ view, accounts }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>Month</h2>
          <span id="month-label">{formatMonthLabel(view.monthPage.month)} • {view.label}</span>
        </div>
        <div className="scope-toggle">
          {view.monthPage.scopes.map((scope) => (
            <button key={scope.key} className={`scope-button ${scope.key === view.monthPage.selectedScope ? "is-active" : ""}`} type="button">
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      <div className="metric-row">
        {view.monthPage.metricCards.map((card) => <MetricCard key={card.label} card={card} />)}
      </div>

      <div className="panel-subgrid month-plan-grid">
        {view.monthPage.planSections.map((section) => (
          <section key={section.key}>
            <div className="panel-subhead">
              <h3>{section.label}</h3>
              <p>{section.description}</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    {section.key === "planned_items" ? <th>Day</th> : null}
                    <th>Item</th>
                    <th>Planned</th>
                    <th>Actual</th>
                    <th>Variance</th>
                    {section.key === "planned_items" ? <th>Account</th> : null}
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => {
                    const variance = row.plannedMinor - row.actualMinor;
                    return (
                      <tr key={row.id}>
                        <td>{row.categoryName}</td>
                        {section.key === "planned_items" ? <td>{row.dayLabel ? `${row.dayLabel} ${row.dayOfWeek ?? ""}`.trim() : "—"}</td> : null}
                        <td>{row.label}</td>
                        <td>{money(row.plannedMinor)}</td>
                        <td>{money(row.actualMinor)}</td>
                        <td className={variance >= 0 ? "positive" : "negative"}>{money(variance)}</td>
                        {section.key === "planned_items" ? <td>{row.accountName ?? "—"}</td> : null}
                        <td>{row.note ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      <div className="panel-subgrid">
        <section>
          <div className="panel-subhead">
            <h3>Monthly Notes</h3>
            <p>Why the month looked like this.</p>
          </div>
          <div className="note-stack">
            {view.monthPage.notes.map((note, index) => (
              <div key={index} className="note-card"><p>{note}</p></div>
            ))}
          </div>
        </section>

        <section>
          <div className="panel-subhead">
            <h3>Accounts</h3>
            <p>Tracked finance accounts.</p>
          </div>
          <div className="stack">
            {accounts.map((account) => (
              <div key={account.id} className="account">
                <div>
                  <strong>{account.name}</strong>
                  <p>{account.institution} • {account.kind}</p>
                </div>
                <span>{account.ownerLabel}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </article>
  );
}

function EntriesPanel({ view }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>Entries</h2>
          <span className="panel-context">Viewing entries for {view.label}</span>
        </div>
      </div>
      <div className="entry-list">
        {view.monthPage.entries.map((entry) => (
          <article key={entry.id} className="entry-card" id={entry.id}>
            <div className="entry-main">
              <div>
                <div className="entry-topline">
                  <span className="pill subtle">{entry.entryType}{entry.transferDirection ? `:${entry.transferDirection}` : ""}</span>
                  <span className="pill subtle">{entry.ownershipType}</span>
                </div>
                <h3>{entry.description}</h3>
                <p>{entry.date} • {entry.accountName} • {entry.categoryName}</p>
              </div>
              <strong className={entry.entryType === "income" ? "positive" : ""}>{money(entry.amountMinor)}</strong>
            </div>
            <div className="entry-meta">
              <div>
                <span>Scope</span>
                <p>{entry.ownerName ?? "Shared"}{entry.offsetsCategory ? " • offsets category" : ""}</p>
              </div>
              <div>
                <span>Split</span>
                <p>{entry.splits.map((split) => `${split.personName} ${split.ratioBasisPoints / 100}%`).join(" • ")}</p>
              </div>
              {entry.linkedTransfer ? (
                <div className="entry-link">
                  <span>Counterpart</span>
                  <a href={`#${entry.linkedTransfer.transactionId}`}>
                    {entry.linkedTransfer.accountName} • {money(entry.linkedTransfer.amountMinor)}
                  </a>
                </div>
              ) : null}
            </div>
            {entry.note ? <p className="entry-note">{entry.note}</p> : null}
          </article>
        ))}
      </div>
    </article>
  );
}

function ImportsPanel({ importsPage, viewLabel }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>Imports</h2>
          <span className="panel-context">Viewing imports for {viewLabel}</span>
        </div>
      </div>
      <p className="lede compact">{importsPage.rollbackPolicy}</p>
      <div className="stack">
        {importsPage.recentImports.map((item) => (
          <div key={item.id} className="import-card">
            <div>
              <strong>{item.sourceLabel}</strong>
              <p>{item.sourceType.toUpperCase()} • {formatDate(item.importedAt)} • {item.transactionCount} transactions</p>
            </div>
            <div className="import-meta">
              <span className={`pill ${item.status === "rolled_back" ? "warning" : "is-active"}`}>{item.status}</span>
              {item.note ? <p>{item.note}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function FaqPanel({ viewLabel }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>FAQ</h2>
          <span className="panel-context">Viewing FAQ for {viewLabel}</span>
        </div>
      </div>
      <div className="faq-list">
        {faqItems.map((item) => (
          <article key={item.question} className="faq-item">
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </article>
  );
}

function MetricCard({ card }) {
  const value = card.amountMinor == null ? card.value : money(card.amountMinor);
  return (
    <div className={`metric ${card.tone ? `metric-${card.tone}` : ""}`}>
      <span>{card.label}</span>
      <strong>{value}</strong>
      {card.detail ? <p>{card.detail}</p> : null}
    </div>
  );
}

function BarLine({ label, valueMinor, maxMinor, tone }) {
  const percent = Math.max((valueMinor / Math.max(maxMinor, 1)) * 100, 6);
  return (
    <div className="plan-bar-line">
      <span>{label}</span>
      <div className="plan-bar-track">
        <span className={`plan-bar-fill ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <strong>{money(valueMinor)}</strong>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  return (
    <div className="plan-mini-stat">
      <span>{label}</span>
      <strong className={tone ?? ""}>{value}</strong>
    </div>
  );
}

function getCategoryTheme(label, index) {
  return categoryThemes[label] ?? fallbackThemes[index % fallbackThemes.length];
}

function money(valueMinor) {
  return moneyFormatter.format(valueMinor / 100);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMonthLabel(value) {
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    year: "numeric"
  }).format(new Date(Number(year), Number(month) - 1, 1));
}
