import { MONTH } from "./common.mjs";
const URL_ = `/splits?view=person-ethan&month=${MONTH}`;

const CSS = `
.panel-splits .splits-summary-strip, .splits-groups-row-floating, .split-settle-header { display: none !important; }
.panel-splits .mk-split-lead { margin: 0 0 12px; color: var(--text); }
.panel-splits .mk-split-lead .lsd-title { color: var(--text); }
.panel-splits .mk-split-lead :is(span, small) { text-shadow: none; }
.panel-splits .mk-split-lead .lsd-amount-caption { color: var(--muted); }
.panel-splits .mk-split-search { margin: 0 0 12px; }
.panel-splits .mk-split-lead .money-in { color: var(--pastel-mint-ink) !important; }
.panel-splits .mk-split-lead .money-short { color: var(--pastel-rose-ink) !important; }
.panel-splits .mk-split-lead .money-neutral, .panel-splits .mk-split-lead .private-money { color: var(--text) !important; }
@media (min-width: 761px) {
  .panel-splits .mk-split-lead { grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 24px; }
  .panel-splits .mk-split-lead .lsd-hero { grid-column: 1; }
  .panel-splits .mk-split-lead .lsd-chips { grid-column: 1; }
  .panel-splits .mk-split-lead .mk-card-actions { grid-column: 2; grid-row: 1 / span 2; flex-direction: column; align-items: stretch; margin: 0; }
}
`;

// Reads the active group from the page (the floating strip's active tile) and
// the summary strip's spend, then builds the lead card, search and the
// floating group bar.
function build({ phone }) {
  const M = window.M;
  const tiles = [...document.querySelectorAll(".splits-groups-row:not(.splits-groups-row-floating) .split-group-pill:not(.split-group-pill-create)")];
  const groups = tiles.map((t) => ({
    name: t.querySelector("strong")?.textContent.trim(),
    lines: [...t.querySelectorAll(".split-group-pill-content > span")].map((s) => s.textContent.trim()),
    icon: t.querySelector(".split-group-pill-icon")?.innerHTML ?? "",
    active: t.classList.contains("is-active")
  }));
  const active = groups.find((g) => g.active) ?? groups[0];
  const [meta, count, balance] = active.lines;
  const currency = meta.split(" · ")[0];
  const metrics = [...document.querySelectorAll(".splits-summary-strip .entries-summary-metrics > span")].map((s) => s.textContent.trim());
  const spend = (metrics.find((m) => m.startsWith("Spend")) ?? "").replace(/^Spend\s*/, "");
  // "Serene owes you JP¥26,730" -> who, direction, amount
  const m = balance.match(/^(.*?)(JP¥|\$|S\$|Rp|₩)([\d,.]+)$/);
  const words = m ? m[1].trim() : balance;
  const amount = m ? `${m[2]}${m[3]}` : "";
  const owedToYou = /owes you/.test(words);
  const other = (words.match(/(Serene|Ethan)/) ?? [])[1] ?? "Serene";
  const hidden = M.hidden();
  const lead = M.el(`<section class="lsd-card mk-split-lead" aria-label="Group balance">
    ${M.hero({
      bubble: M.bubble(active.icon),
      title: active.name,
      subtitle: `${currency} · ${count}`,
      amount: amount ? M.money(amount, owedToYou ? "in" : "short") : "Settled up",
      caption: hidden ? `Balance with ${other}` : words
    })}
    <div class="lsd-chips">
      ${M.chip(other, { person: other })}
      ${M.chip(`Group spend ${hidden ? "••••" : spend}`, { icon: "receipt" })}
    </div>
    <div class="mk-card-actions">
      <button class="lsd-quiet" type="button">${M.icon("history", 18)} History</button>
      ${phone ? "" : `<button class="mk-secondary" type="button">+ Add expense</button>`}
      <button class="lsd-primary" type="button">Settle group</button>
    </div>
  </section>`);
  const search = M.el(`<div class="mk-search mk-split-search">${M.icon("search", 18)}<span>Search ${active.name}</span></div>`);
  const strip = document.querySelector(".panel-splits .splits-summary-strip");
  strip.parentNode.insertBefore(lead, strip);
  strip.parentNode.insertBefore(search, strip);
  if (phone) {
    const others = groups.filter((g) => !g.active && g.lines[1] !== "0 entries").length;
    document.body.appendChild(M.el(`<div class="mk-float-bar" role="button" aria-label="Switch group">
      ${M.bubble(active.icon)}
      <span class="mk-float-copy"><strong>${active.name}</strong><small>${hidden ? `${groups.length} groups` : `${balance} · ${groups.length} groups`}</small></span>
      ${M.icon("chevronDown", 20)}
    </div>`));
  }
  window.__groups = groups;
}

// The group picker sheet (the existing phone picker shape): one Detail row
// per group with its balance, the current one marked, Create group last.
function buildSheet() {
  const M = window.M;
  const groups = window.__groups;
  const rowsHtml = groups.map((g) => {
    const [meta, count, balance] = g.lines;
    const bm = balance.match(/^(.*?)(JP¥|\$|S\$)([\d,.]+)$/);
    const tone = /owes you/.test(balance) ? "in" : /You owe/.test(balance) ? "short" : "neutral";
    const right = bm ? `<span class="mk-right">${M.money(`${bm[2]}${bm[3]}`, tone)}<small>${M.hidden() ? "Balance" : bm[1].trim()}</small></span>` : `<span class="mk-right"><span>${M.hidden() ? "Balance hidden" : balance}</span></span>`;
    return `<div class="lsd-row ${g.active ? "is-current" : ""}"><span class="mk-row-left"><span class="mk-group-row-icon">${g.icon}</span><span class="mk-row-text"><strong>${g.name}</strong><small>${meta} · ${count}</small></span></span>${right}</div>`;
  }).join("");
  document.body.appendChild(M.el(`<div class="mk-scrim"></div>`));
  document.body.appendChild(M.el(`<section class="mk-sheet" role="dialog" aria-label="Choose a group">
    <span class="mk-sheet-grab"></span>
    <div class="mk-sheet-head"><h3>Choose a group</h3><span class="mk-close">×</span></div>
    ${M.rows(rowsHtml + `<div class="lsd-row"><span class="lsd-row-label" style="color:var(--accent-strong);font-weight:600">+ Create group</span><span class="lsd-row-value"></span></div>`)}
    <div class="lsd-bottom is-sheet-bar"><div class="lsd-bottom-end"><button class="lsd-primary" type="button">Done</button></div></div>
  </section>`));
}

async function before(page, h, shot, phone) {
  await h.open(page, URL_);
  await shot("before-top");
  await h.scrollTo(page, ".panel-splits .splits-summary-strip", phone ? 180 : 260);
  await shot("before");
}
async function after(page, h, shot, phone, sheet) {
  await h.open(page, URL_);
  await h.inject(page, CSS, { fn: build, arg: { phone } });
  await shot("after-top");
  await h.scrollTo(page, ".mk-split-lead", phone ? 120 : 200);
  await shot("after");
  if (sheet) {
    await page.evaluate(buildSheet);
    await page.waitForTimeout(300);
    await shot("after-groups");
  }
}

export const scenarios = [
  { name: "splits-phone", device: "phone", run: async (page, h, shot) => { await before(page, h, shot, true); } },
  { name: "splits-phone", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, true, true); } },
  { name: "splits-phone-hidden", device: "phone", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, true, true); } },
  { name: "splits-desktop", device: "desktop", run: async (page, h, shot) => { await before(page, h, shot, false); } },
  { name: "splits-desktop", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, false, false); } }
];
