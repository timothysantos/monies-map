import { MONTH } from "./common.mjs";
const URL_ = `/splits?view=person-ethan&month=${MONTH}`;

// Three ways to keep every group in view, instead of the single collapsed bar:
//  A  "All groups" list first (owed first, settled folded), a group opens with
//     "‹ All groups"; the floating bar names the group and opens the same list.
//  B  stay in the group; the floating bar says what the other groups add up to
//     and expands into the same list as a sheet.
//  C  a compact "Groups" card above the lead (3 rows and "Show all 4").
// The app's own floating buttons stay visible (eye, receipt, the nav island).
// No money tone on the orange panel: the group rows are white rows with plain
// words (the lead card keeps its tones, as approved).
const CSS = `
.splits-groups-row, .splits-groups-row-floating, .panel-splits .splits-summary-strip, .split-settle-header { display: none !important; }
.panel-splits .mk-split-lead { margin: 0 0 12px; color: var(--text); }
.panel-splits .mk-split-lead .lsd-title { color: var(--text); }
.panel-splits .mk-split-lead :is(span, small) { text-shadow: none; }
.panel-splits .mk-split-lead .lsd-amount-caption { color: var(--muted); }
.panel-splits .mk-split-lead .money-in { color: var(--pastel-mint-ink) !important; }
.panel-splits .mk-split-lead .money-short { color: var(--pastel-rose-ink) !important; }
.panel-splits .mk-split-lead .money-neutral, .panel-splits .mk-split-lead .private-money { color: var(--text) !important; }
.panel-splits .mk-split-search { margin: 0 0 12px; }
.mk-groups-list { margin: 0 0 12px; }
.mk-groups-list .lsd-row, .mk-groups-card .lsd-row, .mk-folded .lsd-row { min-height: 56px; background: #fff !important; }
.mk-groups-list .lsd-row.is-current, .mk-groups-card .lsd-row.is-current { background: color-mix(in srgb, var(--accent-strong) 8%, white) !important; }
.mk-groups-list .lsd-row-value { color: var(--muted); }
.mk-groups-head { display: flex; align-items: baseline; justify-content: space-between; margin: 4px 4px 8px; color: #fff; }
.mk-groups-head strong { font-size: 1.1rem; }
.mk-groups-head small { color: rgba(255,255,255,0.88); }
.mk-back { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; margin: 0 0 4px; padding: 0 12px 0 6px; border: 0; background: transparent; color: #fff; font: inherit; font-weight: 700; }
.mk-folded .lsd-row-label { color: var(--muted); font-weight: 600; }
.mk-groups-card { margin: 0 0 12px; padding: 12px 12px 4px; border-radius: 22px; background: #fff; box-shadow: 0 14px 32px rgba(27,24,21,0.16); }
.mk-groups-card .mk-section-label { margin: 0 4px 8px; }
.mk-groups-card .lsd-rows { box-shadow: none; }
.mk-groups-card .mk-show-all { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 0 14px; color: var(--accent-strong); font-weight: 700; }
.mk-float-bar { bottom: calc(96px + env(safe-area-inset-bottom, 0px)); right: 76px; }
/* D: the sideways strip kept as a deliberate exception, in the page flow. */
.mk-strip { display: flex; gap: 10px; margin: 0 -2px 14px; padding: 2px 2px 6px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.mk-strip::-webkit-scrollbar { display: none; }
.mk-tile { flex: 0 0 40%; scroll-snap-align: start; display: grid; align-content: center; gap: 2px; min-height: 64px; padding: 10px 12px; border: 1px solid rgba(255,255,255,0.34); border-radius: 16px; background: rgba(255,255,255,0.14); color: #fff; font: inherit; text-align: left; }
.mk-tile strong { font-size: 0.95rem; line-height: 1.2; }
.mk-tile small { color: rgba(255,255,255,0.92); font-size: 0.8rem; line-height: 1.25; }
.mk-tile.is-lead { flex-basis: 60%; position: relative; background: #fff; color: var(--text); border: 2px solid var(--accent-strong); box-shadow: 0 10px 24px rgba(27,24,21,0.18); }
.mk-tile.is-lead small { color: var(--muted); }
.mk-tile.is-lead .mk-tick { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent-strong); color: #fff; }
.mk-tile.is-settled { opacity: 0.72; background: rgba(255,255,255,0.08); }
.mk-tile.is-end { flex-basis: 34%; place-items: center; text-align: center; background: rgba(255,255,255,0.08); border-style: dashed; font-weight: 700; }
@media (min-width: 761px) {
  .mk-strip { flex-wrap: wrap; overflow: visible; }
  .mk-tile, .mk-tile.is-lead, .mk-tile.is-end { flex: 0 1 220px; }
  .mk-tile.is-lead { flex-basis: 280px; }
}
@media (min-width: 761px) {
  .mk-groups-wrap { max-width: 640px; }
  .mk-float-bar { left: 24px; right: auto; width: 420px; bottom: 28px; }
}
`;

function read() {
  const M = window.M;
  const tiles = [...document.querySelectorAll(".splits-groups-row:not(.splits-groups-row-floating) .split-group-pill:not(.split-group-pill-create)")];
  const groups = tiles.map((t) => {
    const lines = [...t.querySelectorAll(".split-group-pill-content > span")].map((s) => s.textContent.trim());
    const balance = lines[2] ?? "";
    const m = balance.match(/(JP¥|\$)([\d,.]+)$/);
    const amount = m ? Number(m[2].replace(/,/g, "")) : 0;
    const dir = /owes you/.test(balance) ? 1 : /You owe/.test(balance) ? -1 : 0;
    return { name: t.querySelector("strong")?.textContent.trim(), lines, balance, icon: t.querySelector(".split-group-pill-icon")?.innerHTML ?? "", active: t.classList.contains("is-active"), cur: m?.[1], amount, dir, settled: /^Settled/.test(balance) };
  });
  // owed to you first, then what you owe, settled last
  const rank = (g) => (g.dir === 1 ? 0 : g.dir === -1 ? 1 : 2);
  const sorted = [...groups].sort((a, b) => rank(a) - rank(b));
  const sgdNet = groups.filter((g) => g.cur === "$").reduce((n, g) => n + g.dir * g.amount, 0);
  const metrics = [...document.querySelectorAll(".splits-summary-strip .entries-summary-metrics > span")].map((s) => s.textContent.trim());
  const spend = (metrics.find((x) => x.startsWith("Spend")) ?? "").replace(/^Spend\s*/, "");
  window.__g = { groups, sorted, sgdNet, spend, hidden: M.hidden() };
}

const rowHtml = (g, current) => {
  const M = window.M;
  return `<div class="lsd-row ${current ? "is-current" : ""}"><span class="mk-row-left"><span class="mk-group-row-icon">${g.icon}</span><span class="mk-row-text"><strong>${g.name}</strong><small>${g.balance}</small></span></span><span class="lsd-row-value"><span class="lsd-row-chevron">${M.icon("chevronRight", 16)}</span></span></div>`;
};

// The list rows (A and the sheets in A and B): owed first, settled folded.
function listHtml(withCreate) {
  const M = window.M;
  const { sorted, groups } = window.__g;
  const active = groups.find((g) => g.active);
  const open = sorted.filter((g) => !g.settled);
  const settled = sorted.filter((g) => g.settled);
  const folded = settled.length ? `<div class="mk-folded">${M.rows(M.row(`${settled.length} settled group${settled.length > 1 ? "s" : ""}`, settled.map((g) => g.name).join(", "), { }), "Settled groups")}</div>` : "";
  return `${M.rows(open.map((g) => rowHtml(g, g.name === active?.name)).join(""), "Groups")}${folded}${withCreate ? M.rows(`<div class="lsd-row"><span class="lsd-row-label" style="color:var(--accent-strong);font-weight:600">+ Create group</span><span class="lsd-row-value"></span></div>`) : ""}`;
}

function leadHtml(phone, withBack) {
  const M = window.M;
  const { groups, spend, hidden } = window.__g;
  const active = groups.find((g) => g.active) ?? groups[0];
  const [meta, count, balance] = active.lines;
  const currency = meta.split(" · ")[0];
  const m = balance.match(/^(.*?)(JP¥|\$|S\$|Rp|₩)([\d,.]+)$/);
  const words = m ? m[1].trim() : balance;
  const amount = m ? `${m[2]}${m[3]}` : "";
  const owedToYou = /owes you/.test(words);
  const other = (words.match(/(Serene|Ethan)/) ?? [])[1] ?? "Serene";
  return `${withBack ? `<button class="mk-back" type="button">${M.icon("chevronRight", 18).replace("<svg", '<svg style="transform:rotate(180deg)"')} All groups</button>` : ""}
  <section class="lsd-card mk-split-lead" aria-label="Group balance">${M.hero({ bubble: M.bubble(active.icon), title: active.name, subtitle: `${currency} · ${count}`, amount: hidden ? M.money("", "neutral") : amount ? M.money(amount, owedToYou ? "in" : "short") : "Settled up", caption: hidden ? `Balance with ${other}` : words })}
    <div class="lsd-chips">${M.chip(other, { person: other })}${M.chip(`Group spend ${hidden ? "••••" : spend}`, { icon: "receipt" })}</div>
    <div class="mk-card-actions"><button class="lsd-quiet" type="button">${M.icon("history", 18)} History</button>${phone ? "" : `<button class="mk-secondary" type="button">+ Add expense</button>`}<button class="lsd-primary" type="button">Settle group</button></div></section>
  <div class="mk-search mk-split-search">${M.icon("search", 18)}<span>Search ${active.name}</span></div>`;
}

function mount({ variant, screen, phone }) {
  const M = window.M;
  read();
  const { groups, sorted, sgdNet, hidden } = window.__g;
  const active = groups.find((g) => g.active);
  const anchor = document.querySelector(".panel-splits .split-list-section");
  const others = groups.length - 1;
  const hideRest = () => { document.querySelectorAll(".panel-splits .split-match-inbox-callout, .panel-splits .split-list-section").forEach((n) => n.style.setProperty("display", "none", "important")); };
  const barCopy = variant === "B"
    ? (hidden ? `${others} other groups` : `${others} others · $${sgdNet.toFixed(2)} owed to you`)
    : (hidden ? `${groups.length} groups` : `${active.balance}`);
  const bar = () => document.body.appendChild(M.el(`<div class="mk-float-bar" role="button" aria-label="Choose a group">${M.bubble(active.icon)}<span class="mk-float-copy"><strong>${active.name}</strong><small>${variant === "A" ? "All groups" : barCopy}</small></span>${M.icon("chevronDown", 20)}</div>`));
  const sheet = () => {
    document.body.appendChild(M.el(`<div class="mk-scrim"></div>`));
    document.body.appendChild(M.el(`<section class="mk-sheet" role="dialog" aria-label="Choose a group"><span class="mk-sheet-grab"></span><div class="mk-sheet-head"><h3>All groups</h3><span class="mk-close">×</span></div>${listHtml(true)}<div class="lsd-bottom is-sheet-bar"><div class="lsd-bottom-end"><button class="lsd-primary" type="button">Done</button></div></div></section>`));
  };
  window.__sheet = sheet;

  if (variant === "D") {
    const order = [active, ...sorted.filter((g) => g !== active && !g.settled), ...sorted.filter((g) => g !== active && g.settled)];
    const tile = (g) => g === active
      ? `<button class="mk-tile is-lead" type="button" aria-current="true"><span class="mk-tick">${M.icon("check", 14)}</span><strong>${g.name}</strong><small>${g.balance}</small><small>${g.lines[1]}</small></button>`
      : `<button class="mk-tile ${g.settled ? "is-settled" : ""}" type="button"><strong>${g.name}</strong><small>${g.settled && !hidden ? "Settled" : g.balance}</small></button>`;
    const strip = M.el(`<div class="mk-strip" role="list" aria-label="Groups">${order.map(tile).join("")}<button class="mk-tile is-end" type="button">All groups</button><button class="mk-tile is-end" type="button">+ Create group</button></div>`);
    const head = document.querySelector(".panel-splits .panel-head");
    head.parentNode.insertBefore(strip, head);
    anchor.parentNode.insertBefore(M.el(`<div class="mk-groups-wrap">${leadHtml(phone, false)}</div>`), anchor);
    window.__bar = () => document.body.appendChild(M.el(`<div class="mk-float-bar" role="button" aria-label="Choose a group">${M.bubble(active.icon)}<span class="mk-float-copy"><strong>${active.name}</strong><small>${hidden ? `${groups.length} groups` : active.balance}</small></span>${M.icon("chevronDown", 20)}</div>`));
    return;
  }
  if (variant === "A" && screen === "list") {
    hideRest();
    document.querySelector(".panel-splits .financial-insight")?.style.setProperty("display", "none", "important");
    anchor.parentNode.insertBefore(M.el(`<div class="mk-groups-wrap"><div class="mk-groups-head"><strong>All groups</strong><small>${groups.length} groups</small></div><div class="mk-groups-list">${listHtml(true)}</div></div>`), anchor);
  } else if (variant === "C") {
    const shown = sorted.filter((g) => !g.settled).slice(0, 3);
    const card = M.el(`<section class="mk-groups-card mk-groups-wrap" aria-label="Groups"><span class="mk-section-label">Groups</span>${M.rows(shown.map((g) => rowHtml(g, g.name === active.name)).join(""))}<div class="mk-show-all"><span>Show all ${groups.length}</span>${M.icon("chevronDown", 18)}</div></section>`);
    anchor.parentNode.insertBefore(card, anchor);
    anchor.parentNode.insertBefore(M.el(`<div class="mk-groups-wrap">${leadHtml(phone, false)}</div>`), anchor);
  } else {
    // A in a group, and B
    anchor.parentNode.insertBefore(M.el(`<div class="mk-groups-wrap">${leadHtml(phone, variant === "A")}</div>`), anchor);
    if (phone) bar();
    else if (variant !== "C") bar();
  }
}

const runOne = (variant, device, screen, name, { sheet = false } = {}) => async (page, h, shot) => {
  const phone = device === "phone";
  await h.open(page, URL_);
  await h.inject(page, CSS);
  await page.evaluate(`window.__imp = 0; window.read = ${read.toString()}; window.rowHtml = ${rowHtml.toString()}; window.listHtml = ${listHtml.toString()}; window.leadHtml = ${leadHtml.toString()};`);
  const fn = mount.toString().replace("read();", "window.read();").replace(/\browHtml\(/g, "window.rowHtml(").replace(/\blistHtml\(/g, "window.listHtml(").replace(/\bleadHtml\(/g, "window.leadHtml(");
  await page.evaluate(`(${fn})(${JSON.stringify({ variant, screen, phone })})`);
  await page.waitForTimeout(400);
  const target = await page.evaluate(() => !!document.querySelector(".mk-groups-card, .mk-groups-head, .mk-split-lead"));
  if (target) await h.scrollTo(page, ".mk-groups-card, .mk-groups-head, .mk-back, .mk-split-lead", phone ? 150 : 140);
  await shot(name, { keepFloaters: true });
  if (sheet) {
    await page.evaluate(() => window.__sheet());
    await page.waitForTimeout(300);
    await shot(`${name}-sheet`, { keepFloaters: true });
  }
};

const runD = (device, name, { scrolled = false, sheet = false } = {}) => async (page, h, shot) => {
  const phone = device === "phone";
  await h.open(page, URL_);
  await h.inject(page, CSS);
  await page.evaluate(`window.read = ${read.toString()}; window.rowHtml = ${rowHtml.toString()}; window.listHtml = ${listHtml.toString()}; window.leadHtml = ${leadHtml.toString()};`);
  const fn = mount.toString().replace("read();", "window.read();").replace(/\browHtml\(/g, "window.rowHtml(").replace(/\blistHtml\(/g, "window.listHtml(").replace(/\bleadHtml\(/g, "window.leadHtml(");
  await page.evaluate(`(${fn})(${JSON.stringify({ variant: "D", screen: "strip", phone })})`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  await shot(name, { keepFloaters: true });
  if (scrolled) {
    // Scrolled down: the strip leaves the page and the existing floating bar shows the active group.
    await page.evaluate(() => { window.scrollTo({ top: 760, behavior: "instant" }); window.__bar(); });
    await page.waitForTimeout(400);
    await shot("scrolled", { keepFloaters: true });
  }
  if (sheet) {
    await page.evaluate(`window.read = ${read.toString()}; window.__g && (document.body.appendChild(window.M.el('<div class="mk-scrim"></div>')), document.body.appendChild(window.M.el('<section class="mk-sheet" role="dialog" aria-label="All groups"><span class="mk-sheet-grab"></span><div class="mk-sheet-head"><h3>All groups</h3><span class="mk-close">×</span></div>' + window.listHtml(true) + '<div class="lsd-bottom is-sheet-bar"><div class="lsd-bottom-end"><button class="lsd-primary" type="button">Done</button></div></div></section>')));`);
    await page.waitForTimeout(300);
    await shot("all-sheet", { keepFloaters: true });
  }
};
const SD = (device, name, opts, hidden) => ({ name: `splits-groups-D-${device}${hidden ? "-hidden" : ""}`, device, hidden, run: runD(device, name, opts) });

const S = (variant, device, screen, name, opts, hidden) => ({ name: `splits-groups-${variant}-${device}${hidden ? "-hidden" : ""}`, device, hidden, run: runOne(variant, device, screen, name, opts) });

export const scenarios = [
  SD("phone", "strip", { scrolled: true, sheet: true }), SD("phone", "strip", { scrolled: true }, true), SD("desktop", "strip"), SD("desktop", "strip", {}, true),
  
  S("A", "phone", "list", "list"), S("A", "phone", "group", "group", { sheet: true }),
  S("A", "phone", "list", "list", {}, true), S("A", "phone", "group", "group", { sheet: true }, true),
  S("B", "phone", "group", "bar", { sheet: true }), S("B", "phone", "group", "bar", { sheet: true }, true),
  S("C", "phone", "group", "card"), S("C", "phone", "group", "card", {}, true),
  S("A", "desktop", "list", "list"), S("A", "desktop", "group", "group", { sheet: true }),
  S("A", "desktop", "list", "list", {}, true),
  S("B", "desktop", "group", "bar", { sheet: true }), S("B", "desktop", "group", "bar", { sheet: true }, true),
  S("C", "desktop", "group", "card"), S("C", "desktop", "group", "card", {}, true)
];
