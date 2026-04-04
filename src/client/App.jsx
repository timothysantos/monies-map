import React, { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  BusFront,
  Clapperboard,
  Dumbbell,
  Gift,
  HeartPulse,
  Lightbulb,
  Plane,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  UtensilsCrossed,
  UsersRound
} from "lucide-react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams
} from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { messages } from "./copy/en-SG";

const moneyFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD"
});

const ICON_OPTIONS = [
  { key: "utensils", label: "Food", Icon: UtensilsCrossed },
  { key: "shopping-bag", label: "Shopping", Icon: ShoppingBag },
  { key: "users", label: "Family", Icon: UsersRound },
  { key: "receipt", label: "Receipt", Icon: Receipt },
  { key: "shopping-cart", label: "Groceries", Icon: ShoppingCart },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "dumbbell", label: "Hobbies", Icon: Dumbbell },
  { key: "lightbulb", label: "Bills", Icon: Lightbulb },
  { key: "clapperboard", label: "Entertainment", Icon: Clapperboard },
  { key: "bus", label: "Transport", Icon: BusFront },
  { key: "heart-pulse", label: "Healthcare", Icon: HeartPulse },
  { key: "gift", label: "Gift", Icon: Gift }
];

const ICON_REGISTRY = Object.fromEntries(ICON_OPTIONS.map((item) => [item.key, item.Icon]));
const COLOR_OPTIONS = ["#1F7A63", "#D4B35D", "#4F8FD6", "#CC63D8", "#F08B43", "#96A95A", "#D86B73", "#56A4C9", "#6A7A73", "#C98A5A"];
const FALLBACK_THEME = { colorHex: "#6A7A73", iconKey: "receipt" };

const routeTabs = [
  { id: "summary", path: "/summary", label: messages.tabs.summary },
  { id: "month", path: "/month", label: messages.tabs.month },
  { id: "entries", path: "/entries", label: messages.tabs.entries },
  { id: "imports", path: "/imports", label: messages.tabs.imports },
  { id: "faq", path: "/faq", label: messages.tabs.faq }
];

export function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  useEffect(() => {
    let active = true;

    async function load() {
      const response = await fetch("/api/bootstrap");
      const data = await response.json();
      if (!active) {
        return;
      }

      setBootstrap(data);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  const selectedViewId = searchParams.get("view") ?? "household";
  const selectedTabId = routeTabs.find((tab) => tab.path === location.pathname)?.id ?? "summary";

  const view = useMemo(
    () => bootstrap?.views.find((item) => item.id === selectedViewId) ?? null,
    [bootstrap, selectedViewId]
  );
  const categories = useMemo(
    () => bootstrap?.categories.map((category) => ({ ...category, ...(categoryOverrides[category.id] ?? {}) })) ?? [],
    [bootstrap, categoryOverrides]
  );

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    const matchesKnownView = bootstrap.views.some((item) => item.id === selectedViewId);
    if (matchesKnownView) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", bootstrap.selectedViewId);
      return next;
    }, { replace: true });
  }, [bootstrap, selectedViewId, setSearchParams]);

  if (!bootstrap || !view) {
    return (
      <main className="shell">
        <section className="panel">
          <p>{messages.common.loading}</p>
        </section>
      </main>
    );
  }

  const periodMode = selectedTabId === "month" || selectedTabId === "entries"
    ? messages.period.month
    : messages.period.year;
  const periodLabel = selectedTabId === "month" || selectedTabId === "entries"
    ? formatMonthLabel(view.monthPage.month)
    : messages.period.currentYear;

  function handleViewChange(nextViewId) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", nextViewId);
      return next;
    });
  }

  function handleCategoryAppearanceChange(categoryId, nextAppearance) {
    const normalizedAppearance = { ...nextAppearance };
    if (typeof nextAppearance.name === "string") {
      normalizedAppearance.slug = slugify(nextAppearance.name);
    }

    setCategoryOverrides((current) => ({
      ...current,
      [categoryId]: {
        ...(current[categoryId] ?? {}),
        ...normalizedAppearance
      }
    }));
  }

  return (
    <main className="shell">
      <section className="control-bar">
        <div className="context-block">
          <div className="pill-row">
            <button
              className={`pill ${selectedViewId === "household" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleViewChange("household")}
            >
              {messages.views.household}
            </button>
            {bootstrap.household.people.map((person) => (
              <button
                key={person.id}
                className={`pill ${selectedViewId === person.id ? "is-active" : ""}`}
                type="button"
                onClick={() => handleViewChange(person.id)}
              >
                {person.name}
              </button>
            ))}
          </div>
        </div>

        <div className="period-inline">
          <nav className="tab-strip" aria-label={messages.tabs.ariaLabel}>
            {routeTabs.map((tab) => (
              <NavLink
                key={tab.id}
                className={({ isActive }) => `tab ${isActive ? "is-active" : ""}`}
                to={{ pathname: tab.path, search: searchParams.toString() ? `?${searchParams.toString()}` : "" }}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <button className="period-button" type="button" aria-label={messages.period.previousAriaLabel}>‹</button>
          <div className="period-display">
            <span className="period-mode">{periodMode}</span>
            <strong>{periodLabel}</strong>
          </div>
          <button className="period-button" type="button" aria-label={messages.period.nextAriaLabel}>›</button>
        </div>
      </section>

      <section className="grid">
        <Routes>
          <Route path="/" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
          <Route
            path="/summary"
            element={(
              <SummaryPanel
                view={view}
                categories={categories}
                onCategoryAppearanceChange={handleCategoryAppearanceChange}
              />
            )}
          />
          <Route path="/month" element={<MonthPanel view={view} accounts={bootstrap.accounts} />} />
          <Route path="/entries" element={<EntriesPanel view={view} />} />
          <Route
            path="/imports"
            element={<ImportsPanel importsPage={bootstrap.importsPage} viewLabel={view.label} />}
          />
          <Route path="/faq" element={<FaqPanel viewLabel={view.label} />} />
          <Route path="*" element={<Navigate to={{ pathname: "/summary", search: location.search }} replace />} />
        </Routes>
      </section>
    </main>
  );
}

function SummaryPanel({ view, categories, onCategoryAppearanceChange }) {
  const totalSpendMinor = view.summaryPage.categoryShareChart.reduce((sum, item) => sum + item.valueMinor, 0);

  return (
    <article className="panel panel-accent">
      <div className="panel-head summary-head">
        <div>
          <h2>{messages.tabs.summary}</h2>
          <span className="panel-context">{messages.common.viewingDot(view.label)}</span>
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
            <h3>{messages.summary.spendingMix}</h3>
          </div>
          <div className="summary-mix">
            <SpendingMixChart data={view.summaryPage.categoryShareChart} categories={categories} />
            <div className="share-list">
              {view.summaryPage.categoryShareChart.map((item) => {
                const category = getCategory(categories, item);
                const percentage = (((item.valueMinor / Math.max(totalSpendMinor, 1))) * 100).toFixed(1);
                return (
                  <div key={item.key} className="share-row">
                    <div className="category-key">
                      <CategoryAppearancePopover
                        category={category}
                        onChange={onCategoryAppearanceChange}
                      />
                      <div>
                        <strong>{category?.name ?? item.label}</strong>
                        <p>{messages.common.moneyAndPercent(money(item.valueMinor), percentage)}</p>
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
            <h3>{messages.summary.intentVsOutcome}</h3>
            <p>{messages.summary.intentVsOutcomeDetail}</p>
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
                        <p>{messages.summary.incomeLabel(money(month.incomeMinor))}</p>
                      </div>
                      <span className={month.realDiffMinor >= 0 ? "positive" : "negative"}>
                        {money(month.realDiffMinor)}
                      </span>
                    </div>
                  </summary>
                  <div className="plan-row-content">
                    <BarLine
                      label={messages.month.table.planned}
                      valueMinor={month.estimatedExpensesMinor}
                      maxMinor={Math.max(month.realExpensesMinor, month.estimatedExpensesMinor)}
                      tone="planned"
                    />
                    <BarLine
                      label={messages.month.table.actual}
                      valueMinor={month.realExpensesMinor}
                      maxMinor={Math.max(month.realExpensesMinor, month.estimatedExpensesMinor)}
                      tone="actual"
                    />
                    <div className="table-wrap plan-detail-table-wrap">
                      <table className="plan-detail-table">
                        <thead>
                          <tr>
                            <th>{messages.summary.table.metric}</th>
                            <th>{messages.summary.table.estimate}</th>
                            <th>{messages.summary.table.actual}</th>
                            <th>{messages.summary.table.variance}</th>
                            <th>{messages.summary.table.note}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{messages.summary.table.expectedExpenses}</td>
                            <td>{money(month.estimatedExpensesMinor)}</td>
                            <td>{money(month.realExpensesMinor)}</td>
                            <td className={month.realDiffMinor >= 0 ? "positive" : "negative"}>
                              {money(month.realDiffMinor)}
                            </td>
                            <td>{month.note}</td>
                          </tr>
                          <tr>
                            <td>{messages.summary.table.expectedSavings}</td>
                            <td>{money(month.savingsGoalMinor)}</td>
                            <td className={month.realizedSavingsMinor >= 0 ? "positive" : "negative"}>
                              {money(month.realizedSavingsMinor)}
                            </td>
                            <td className={month.realDiffMinor >= 0 ? "positive" : "negative"}>
                              {money(month.realDiffMinor)}
                            </td>
                            <td>{month.realizedSavingsMinor >= month.savingsGoalMinor ? "Landed above target." : "Savings landed below target."}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              ))}
          </div>
        </section>
      </div>
    </article>
  );
}

function SpendingMixChart({ data, categories }) {
  const total = data.reduce((sum, item) => sum + item.valueMinor, 0);
  const chartData = data.map((item, index) => ({
    ...item,
    ...getCategoryTheme(categories, item, index)
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
          <span>{messages.summary.totalSpend}</span>
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
  const Icon = getIconComponent(payload.iconKey);

  return (
    <g>
      <path d={`M${sx},${sy} L${mx},${my} L${bx},${by}`} stroke={payload.color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.82" />
      <foreignObject x={bx - 22} y={by - 22} width="44" height="44">
        <div className="donut-callout-badge" style={{ "--category-color": payload.color }}>
          <Icon size={18} strokeWidth={2.2} />
        </div>
      </foreignObject>
      <text x={tx} y={by + 1} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" fill={payload.color} fontSize="15" fontWeight="700">
        {percentage}%
      </text>
    </g>
  );
}

function CategoryAppearancePopover({ category, onChange }) {
  if (!category) {
    return <span className="category-icon category-icon-static" />;
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="category-icon category-icon-button"
          style={{ "--category-color": category.colorHex }}
          aria-label={`Edit ${category.name} icon and color`}
        >
          <CategoryGlyph iconKey={category.iconKey} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="category-popover" sideOffset={10} align="start">
          <div className="category-popover-head">
            <strong>{category.name}</strong>
            <span>Icon and color</span>
          </div>

          <div className="category-popover-section">
            <label className="category-popover-label" htmlFor={`category-name-${category.id}`}>Name</label>
            <input
              id={`category-name-${category.id}`}
              className="category-name-input"
              type="text"
              value={category.name}
              onChange={(event) => onChange(category.id, { name: event.target.value })}
            />
          </div>

          <div className="category-popover-section">
            <span className="category-popover-label">Icon</span>
            <div className="icon-grid">
              {ICON_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`icon-choice ${category.iconKey === option.key ? "is-active" : ""}`}
                  onClick={() => onChange(category.id, { iconKey: option.key })}
                  aria-label={option.label}
                  title={option.label}
                >
                  <option.Icon size={16} strokeWidth={2.2} />
                </button>
              ))}
            </div>
          </div>

          <div className="category-popover-section">
            <span className="category-popover-label">Color</span>
            <div className="color-grid">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-choice ${category.colorHex === color ? "is-active" : ""}`}
                  style={{ "--swatch-color": color }}
                  onClick={() => onChange(category.id, { colorHex: color })}
                  aria-label={color}
                  title={color}
                />
              ))}
            </div>
          </div>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CategoryGlyph({ iconKey }) {
  const Icon = getIconComponent(iconKey);
  return <Icon size={18} strokeWidth={2.2} />;
}

function MonthPanel({ view, accounts }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.month}</h2>
          <span id="month-label">{messages.common.contextWithView(formatMonthLabel(view.monthPage.month), view.label)}</span>
        </div>
        <div className="scope-toggle">
          {view.monthPage.scopes.map((scope) => (
            <button
              key={scope.key}
              className={`scope-button ${scope.key === view.monthPage.selectedScope ? "is-active" : ""}`}
              type="button"
            >
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
                    <th>{messages.month.table.category}</th>
                    {section.key === "planned_items" ? <th>{messages.month.table.day}</th> : null}
                    <th>{messages.month.table.item}</th>
                    <th>{messages.month.table.planned}</th>
                    <th>{messages.month.table.actual}</th>
                    <th>{messages.month.table.variance}</th>
                    {section.key === "planned_items" ? <th>{messages.month.table.account}</th> : null}
                    <th>{messages.month.table.note}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => {
                    const variance = row.plannedMinor - row.actualMinor;
                    return (
                      <tr key={row.id}>
                        <td>{row.categoryName}</td>
                        {section.key === "planned_items" ? <td>{row.dayLabel ? `${row.dayLabel} ${row.dayOfWeek ?? ""}`.trim() : messages.common.emptyValue}</td> : null}
                        <td>{row.label}</td>
                        <td>{money(row.plannedMinor)}</td>
                        <td>{money(row.actualMinor)}</td>
                        <td className={variance >= 0 ? "positive" : "negative"}>{money(variance)}</td>
                        {section.key === "planned_items" ? <td>{row.accountName ?? messages.common.emptyValue}</td> : null}
                        <td>{row.note ?? messages.common.emptyValue}</td>
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
            <h3>{messages.month.notesTitle}</h3>
            <p>{messages.month.notesDetail}</p>
          </div>
          <div className="note-stack">
            {view.monthPage.notes.map((note, index) => (
              <div key={index} className="note-card"><p>{note}</p></div>
            ))}
          </div>
        </section>

        <section>
          <div className="panel-subhead">
            <h3>{messages.month.accountsTitle}</h3>
            <p>{messages.month.accountsDetail}</p>
          </div>
          <div className="stack">
            {accounts.map((account) => (
              <div key={account.id} className="account">
                <div>
                  <strong>{account.name}</strong>
                  <p>{messages.common.contextWithView(account.institution, account.kind)}</p>
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
          <h2>{messages.tabs.entries}</h2>
          <span className="panel-context">{messages.entries.viewing(view.label)}</span>
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
                <p>{messages.common.triplet(entry.date, entry.accountName, entry.categoryName)}</p>
              </div>
              <strong className={entry.entryType === "income" ? "positive" : ""}>{money(entry.amountMinor)}</strong>
            </div>
            <div className="entry-meta">
              <div>
                <span>{messages.entries.scope}</span>
                <p>
                  {entry.ownerName ?? messages.entries.shared}
                  {entry.offsetsCategory ? messages.entries.offsetsCategory : ""}
                </p>
              </div>
              <div>
                <span>{messages.entries.split}</span>
                <p>{entry.splits.map((split) => `${split.personName} ${split.ratioBasisPoints / 100}%`).join(" • ")}</p>
              </div>
              {entry.linkedTransfer ? (
                <div className="entry-link">
                  <span>{messages.entries.counterpart}</span>
                  <a href={`#${entry.linkedTransfer.transactionId}`}>
                    {messages.common.contextWithView(
                      entry.linkedTransfer.accountName,
                      money(entry.linkedTransfer.amountMinor)
                    )}
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
          <h2>{messages.tabs.imports}</h2>
          <span className="panel-context">{messages.imports.viewing(viewLabel)}</span>
        </div>
      </div>
      <p className="lede compact">{importsPage.rollbackPolicy}</p>
      <div className="stack">
        {importsPage.recentImports.map((item) => (
          <div key={item.id} className="import-card">
            <div>
              <strong>{item.sourceLabel}</strong>
              <p>
                {messages.common.triplet(
                  item.sourceType.toUpperCase(),
                  formatDate(item.importedAt),
                  messages.imports.transactionCount(item.transactionCount)
                )}
              </p>
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
          <h2>{messages.tabs.faq}</h2>
          <span className="panel-context">{messages.faq.viewing(viewLabel)}</span>
        </div>
      </div>
      <div className="faq-list">
        {messages.faq.items.map((item) => (
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

function getCategory(categories, item) {
  if (item.categoryId) {
    const byId = categories.find((category) => category.id === item.categoryId);
    if (byId) {
      return byId;
    }
  }

  return categories.find((category) => category.name === item.label) ?? null;
}

function getCategoryTheme(categories, item, index) {
  const category = getCategory(categories, item);
  if (category) {
    return {
      color: category.colorHex,
      iconKey: category.iconKey,
      categoryId: category.id
    };
  }

  const fallback = COLOR_OPTIONS[index % COLOR_OPTIONS.length];
  return {
    color: fallback,
    iconKey: FALLBACK_THEME.iconKey,
    categoryId: `fallback-${index}`
  };
}

function getIconComponent(iconKey) {
  return ICON_REGISTRY[iconKey] ?? Receipt;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
