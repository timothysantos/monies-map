import { MONTH } from "./common.mjs";

// Chat versions of three flows. Phone: the real Ask page with an exchange
// injected into its thread. Desktop: the real page on the left and a docked
// Ask panel on the right. Cards use the shared Lead · Support · Detail blocks
// and the Ask tags; a draft saves nothing until Save. Figures marked
// "illustrative" in the README are placeholders where the demo data has none.

const CSS = `
.mk-ans { display: grid; gap: 10px; align-self: stretch; }
.mk-ans .lsd-card { box-shadow: 0 8px 22px rgba(27,24,21,0.09); }
.mk-ans .mk-card-actions { gap: 10px; }
.mk-ans .mk-card-actions .lsd-primary { flex: 1 1 auto; }
.mk-saved-row { color: var(--pastel-mint-ink); font-weight: 600; }
.mk-dock {
  position: fixed; top: 16px; right: 16px; bottom: 16px; width: 400px; z-index: 40; display: flex; flex-direction: column;
  border: 1px solid var(--line); border-radius: 22px; background: var(--surface-strong, #fffdf9); box-shadow: 0 18px 44px rgba(27,24,21,0.16); overflow: hidden;
}
.mk-dock-head { display: flex; align-items: baseline; justify-content: space-between; padding: 16px 18px 8px; }
.mk-dock-head h2 { margin: 0; font-size: 1.4rem; }
.mk-dock-head span { color: var(--muted); font-size: 0.85rem; }
.mk-dock .ask-thread { overflow: auto; padding: 4px 16px 12px; flex: 1 1 auto; }
.mk-dock .ask-bottom { position: static; padding: 8px 14px 14px; border-top: 1px solid var(--line); background: rgba(240, 235, 227, 0.7); }
.mk-has-dock .shell { zoom: 0.72; margin: 0 !important; max-width: none !important; width: calc((100vw - 440px) / 0.72) !important; }
.mk-has-dock .ask-dock-field, .mk-has-dock .entries-fab-trigger { display: none !important; }
`;

const composer = (placeholder = "Ask, or paste a receipt") => `<div class="ask-bottom"><div class="ask-chips"><button class="ask-chip" type="button">Scan receipt</button><button class="ask-chip" type="button">Paste</button><button class="ask-chip" type="button">Add entry</button></div>
<div class="ask-composer"><div class="ask-field"><button class="ask-glyph ask-plus" type="button">${window.M.icon("plus", 18)}</button><span class="ask-input" style="color:var(--muted)">${placeholder}</span></div><button class="ask-send" type="button">↑</button></div></div>`;

// Thread builders run in the page (window.M, window.__d from the scenario).
function threads(kind) {
  const M = window.M;
  const d = window.__d;
  const fmt = (n) => `$${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const m = (n, tone = "neutral") => M.money(fmt(n), tone);
  const tag = (text, cls) => `<span class="ask-card-tag ${cls}">${text}</span>`;
  const actions = (primary, quiet = "Discard") => `<div class="mk-card-actions"><button class="lsd-quiet" type="button">${quiet}</button><button class="lsd-primary" type="button">${primary}</button></div>`;
  const me = (t) => `<p class="ask-me">${t}</p>`;
  const note = (t) => `<p class="ask-note ask-question">${t}</p>`;
  const cat = (name) => d.cats[name] ?? "#7C8791";
  const hidden = M.hidden();
  const T = {};

  // 1. Planning by chat
  T.plan1 = [me("set groceries plan to $700 for November"),
    note("Here is the change. Nothing is saved until you tap Save."),
    `<div class="mk-ans"><section class="lsd-card">${tag("Draft", "is-filled")}
      ${M.hero({ bubble: M.bubble(M.icon("tag", 26), { colour: cat("Groceries") }), title: "Groceries plan", subtitle: "November 2026", accent: cat("Groceries"), amount: m(700, "plan"), caption: hidden ? "" : "was $650.00" })}
      <div class="lsd-chips">${M.chip("Ethan", { person: "Ethan" })}${M.chip("Nov 2026", { icon: "calendar" })}</div></section>
      ${M.rows(M.row("Category", "Groceries") + M.row("Month", "November 2026") + M.row("Planned", hidden ? "••••" : "$700.00") + M.row("Change", hidden ? "••••" : "+$50.00", { readOnly: true }), "Plan change")}
      ${actions("Save plan")}</div>`];
  T.plan2 = [me("move $200 from Shopping to Travel this month"),
    note("Moving $200.00 keeps the month's planned spend the same. Nothing is saved until you tap Save."),
    `<div class="mk-ans"><section class="lsd-card">${tag("Draft", "is-filled")}
      ${M.hero({ bubble: M.bubble(M.icon("arrows", 26)), title: "Move $200.00", subtitle: "Shopping to Travel", amount: m(200, "plan"), caption: "Aug 2026" })}
      <div class="lsd-chips">${M.chip("Ethan", { person: "Ethan" })}${M.chip("Planned spend stays the same", { tone: "sky" })}</div></section>
      ${M.rows(M.row("From", hidden ? "Shopping, ••••" : "Shopping, $480.00 to $280.00") + M.row("To", hidden ? "Travel, ••••" : "Travel, $150.00 to $350.00") + M.row("Month", "August 2026"), "Plan move")}
      ${actions("Save plan")}</div>`];
  T.plan3 = [T.plan1[0], `<div class="mk-ans"><section class="lsd-card">${tag("Saved", "is-saved")}
      ${M.hero({ bubble: M.bubble(M.icon("tag", 26), { colour: cat("Groceries") }), title: "Groceries plan", subtitle: "November 2026", accent: cat("Groceries"), amount: m(700, "plan"), caption: "planned" })}</section>
      ${M.rows(M.row("See it on Month", "", { state: "action" }) + M.row("Undo this change", "", { state: "empty" }), "After saving")}</div>`];

  // 2. Intent vs Outcome as an answer
  const s = d.sep;
  const over = s.actual > s.planned;
  T.intent = [me("how did September go against plan?"),
    note(hidden ? "Reveal money totals to read this answer." : over ? `September ended over plan: ${fmt(s.actual)} spent against ${fmt(s.planned)} planned.` : `September ended under plan: ${fmt(s.actual)} spent against ${fmt(s.planned)} planned.`),
    `<div class="mk-ans"><section class="lsd-card ask-answer ask-money-answer">
      <span class="lsd-eyebrow">September 2026 · Ethan</span>
      <div class="lsd-figure"><span class="lsd-amount">${m(s.actual)}</span><span class="lsd-amount-aside"><span class="money-plan">of ${hidden ? "••••" : fmt(s.planned)} planned</span></span></div>
      ${M.progress(s.planned ? (s.actual / s.planned) * 100 : 100, over, hidden ? "" : `${Math.round((s.actual / s.planned) * 100)}% of plan`, hidden ? "" : `${fmt(Math.abs(s.planned - s.actual))} ${over ? "over plan" : "under plan"}`)}
      <div class="lsd-chips">${M.chip(hidden ? "Income, ••••" : `Income ${fmt(s.income)}`, { tone: hidden ? undefined : "mint" })}${M.chip("Ethan", { person: "Ethan" })}</div></section>
      ${M.rows(s.rows.map((r) => M.row(r.name, `<span class="${r.over && !hidden ? "money-short" : ""}">${hidden ? "••••" : `${fmt(r.actual)} of ${fmt(r.planned)}`}</span>`)).join("") + M.row("Open the full September view", "", { state: "action" }), "Plan and actual by category")}</div>`];

  // 3. Splits by chat
  T.settle = [me("settle up with Serene"),
    note("Serene owes you for the Japan trip. Nothing is recorded until you tap Save."),
    `<div class="mk-ans"><section class="lsd-card">${tag("Draft", "is-filled")}
      ${M.hero({ bubble: M.bubble(M.icon("users", 26), { colour: "#BF7D51" }), title: "Settle up", subtitle: "Japan trip", accent: "#BF7D51", amount: hidden ? M.money("", "neutral") : M.money("JP¥26,730", "in"), caption: hidden ? "" : "Serene pays you" })}
      <div class="lsd-chips">${M.chip("Serene", { person: "Serene" })}${M.chip("Today", { icon: "calendar" })}</div></section>
      ${M.rows(M.row("Group", "Japan trip") + M.row("Paid with", "PayNow") + M.row("Date", "Today"), "Settle up")}
      ${actions("Record settle up")}</div>`];
  T.split = [me("split dinner $120 with Serene, she paid"),
    note("Split 50 / 50. Nothing is added until you tap Save."),
    `<div class="mk-ans"><section class="lsd-card">${tag("Draft", "is-filled")}
      ${M.hero({ bubble: M.bubble(M.icon("tag", 26), { colour: cat("Food & Drinks") }), title: "Dinner", subtitle: "Dinners out", accent: cat("Food & Drinks"), amount: m(120), caption: hidden ? "" : "You owe Serene $60.00" })}
      <div class="lsd-chips">${M.chip("Serene paid", { person: "Serene" })}${M.chip("50 / 50", { icon: "pie" })}${M.chip("Today", { icon: "calendar" })}</div></section>
      ${M.rows(M.row("Paid by", "Serene") + M.row("Shares", "50 / 50") + M.row("Group", "Dinners out") + M.row("Category", "Food & Drinks"), "Split details")}
      ${actions("Add to Splits")}</div>`];
  return T[kind];
}

function mountPhone({ kind }) {
  const items = window.__threads(kind);
  const thread = document.querySelector(".ask-thread");
  thread.innerHTML = items.join("");
  document.querySelector(".ask-note")?.remove?.();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function mountDock({ kinds, composerHtml }) {
  const M = window.M;
  document.documentElement.classList.add("mk-has-dock");
  const items = kinds.flatMap((k) => window.__threads(k));
  document.body.appendChild(M.el(`<aside class="mk-dock" aria-label="Ask"><div class="mk-dock-head"><h2>Ask</h2><span>Ethan · Direct + Shared</span></div><div class="ask-thread">${items.join("")}</div>${composerHtml}</aside>`));
}

async function loadData(page, h) {
  // Real numbers for the Intent vs Outcome answer: the September Month page, Ethan.
  await h.open(page, "/month?view=person-ethan&month=2026-09");
  const sep = await page.evaluate(() => {
    const parse = (t) => Math.abs(parseFloat(String(t).replace(/[^0-9.\-]/g, "")) || 0);
    const metrics = Object.fromEntries([...document.querySelectorAll(".metric-row-month .metric")].map((m) => [m.querySelector("span")?.textContent.trim(), parse(m.querySelector("strong")?.textContent)]));
    const section = document.querySelector(".month-plan-section-budgets");
    const heads = [...section.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const pi = heads.findIndex((x) => /plan/i.test(x)); const ai = heads.findIndex((x) => /actual/i.test(x));
    const rows = [...section.querySelectorAll("tbody tr")].map((tr) => {
      const c = [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
      return { name: c[0], planned: parse(c[pi]), actual: parse(c[ai]) };
    }).filter((r) => r.name).map((r) => ({ ...r, over: r.actual > r.planned, gap: Math.abs(r.actual - r.planned) }));
    rows.sort((a, b) => b.gap - a.gap);
    const incomeRow = parse([...document.querySelectorAll(".month-plan-section-income tbody tr")].map((tr) => tr.textContent).join(" ").match(/\$[\d,]+\.\d\d/)?.[0]);
    return { planned: metrics["Planned spend"] ?? 0, actual: metrics["Actual spend"] ?? 0, income: metrics["Planned income"] ?? incomeRow, rows: rows.slice(0, 3) };
  });
  const ref = await (await page.request.get("/api/reference-data")).json();
  const cats = Object.fromEntries((ref.categories ?? []).map((c) => [c.name, c.colorHex]));
  return { sep, cats };
}

async function phone(page, h, shot, kind, name) {
  const d = await loadData(page, h);
  await h.open(page, `/ask?view=person-ethan&month=${MONTH}`);
  await h.inject(page, CSS);
  await page.evaluate(`window.__d = ${JSON.stringify(d)}; window.__threads = ${threads.toString()};`);
  await page.evaluate(mountPhone, { kind });
  await page.waitForTimeout(300);
  await shot(name);
  await page.evaluate(() => { document.querySelector(".mk-card-actions, .mk-ans")?.scrollIntoView({ block: "end" }); });
  await page.waitForTimeout(300);
  await shot(`${name}-end`);
}

async function desktop(page, h, shot, url, kinds, name) {
  const d = await loadData(page, h);
  await h.open(page, url);
  await h.inject(page, CSS);
  await page.evaluate(`window.__d = ${JSON.stringify(d)}; window.__threads = ${threads.toString()};`);
  await page.evaluate(mountDock, { kinds, composerHtml: composer.toString().includes("window.M") ? await page.evaluate(`(${composer.toString()})()`) : "" });
  await page.waitForTimeout(300);
  await shot(name);
}

const P = (name, kind, hidden) => ({ name: `chat-${name}-phone${hidden ? "-hidden" : ""}`, device: "phone", hidden, run: async (page, h, shot) => { await phone(page, h, shot, kind, "after"); } });
const D = (name, url, kinds, hidden) => ({ name: `chat-${name}-desktop${hidden ? "-hidden" : ""}`, device: "desktop", hidden, run: async (page, h, shot) => { await desktop(page, h, shot, url, kinds, "after"); } });

export const scenarios = [
  P("plan1", "plan1"), P("plan2", "plan2"), P("plan3", "plan3"), P("plan1", "plan1", true),
  P("intent", "intent"), P("intent", "intent", true),
  P("settle", "settle"), P("split", "split"), P("settle", "settle", true),
  D("plan", `/month?view=person-ethan&month=${MONTH}`, ["plan1", "plan2"]),
  D("plan", `/month?view=person-ethan&month=${MONTH}`, ["plan1", "plan2"], true),
  D("intent", `/month?view=person-ethan&month=2026-09`, ["intent"]),
  D("intent", `/month?view=person-ethan&month=2026-09`, ["intent"], true),
  D("splits", `/splits?view=person-ethan&month=${MONTH}`, ["settle", "split"]),
  D("splits", `/splits?view=person-ethan&month=${MONTH}`, ["settle", "split"], true)
];
