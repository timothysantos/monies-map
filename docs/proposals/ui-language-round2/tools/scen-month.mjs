import { MONTH } from "./common.mjs";
const URL_ = `/month?view=person-ethan&month=${MONTH}`;

// Month plan tables. Phone: rows become name + "$270 of $320" + a thin plan bar
// so the Actual column is no longer cut off. Desktop: light touch, the table
// stays; the actual figure keeps its tone and gets a thin bar under the name.
const CSS = `
@media (max-width: 760px) {
  .month-plan-section .table-wrap.month-table-wrap { display: none !important; }
}
.mk-plan { overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: #fff; margin: 8px 0 12px; }
.mk-plan-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 12px; row-gap: 6px; min-height: 64px; padding: 10px 14px; border-top: 1px solid var(--line); }
.mk-plan-row:first-child { border-top: 0; }
.mk-plan-bubble { display: inline-flex; vertical-align: middle; margin-right: 10px; transform: scale(0.9); transform-origin: left center; }
.mk-actual-bar { width: 96px; margin-top: 6px; }
.mk-plan-name { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-plan-figure { display: flex; align-items: baseline; gap: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mk-plan-figure b { font-weight: 800; }
.mk-plan-figure span { color: var(--muted); font-size: 0.86rem; }
.mk-plan-row .lsd-progress { grid-column: 1 / -1; }
.mk-plan-row .lsd-bar { height: 6px; }
.mk-plan-foot { display: flex; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--line); background: var(--pastel-neutral); font-weight: 700; font-variant-numeric: tabular-nums; }
`;

// Read the budget rows from the real table (name, plan, actual) so the
// picture uses the same numbers as the page.
function build({ phone }) {
  const M = window.M;
  const section = document.querySelector(".month-plan-section-budgets");
  const parse = (t) => Math.abs(parseFloat(String(t).replace(/[^0-9.\-]/g, "")) || 0);
  const heads = [...section.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  const rows = [...section.querySelectorAll("tbody tr")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) => {
      const i = td.querySelector("input,select");
      return (i ? i.value : td.textContent).trim();
    });
    const bubble = tr.querySelector("td svg")?.closest("span,button,div")?.outerHTML ?? "";
    return { name: cells[0], cells, bubble };
  }).filter((r) => r.name);
  window.__monthRows = { heads, rows };
  const planIdx = heads.findIndex((h) => /plan/i.test(h));
  const actualIdx = heads.findIndex((h) => /actual/i.test(h));
  if (!phone) {
    // Desktop light touch: a thin plan bar under each Actual figure; the table stays.
    section.querySelectorAll("tbody tr").forEach((tr, i) => {
      const r = rows[i];
      if (!r) return;
      const p = parse(r.cells[planIdx]), a = parse(r.cells[actualIdx]);
      const over = p > 0 ? a > p : a > 0;
      const td = tr.querySelectorAll("td")[actualIdx];
      td?.appendChild(M.el(`<div class="mk-actual-bar">${M.progress(p > 0 ? (a / p) * 100 : 100, over)}</div>`));
    });
    return;
  }
  const html = rows.map((r) => {
    const plan = r.cells[planIdx] ?? "0";
    const actual = r.cells[actualIdx] ?? "0";
    const p = parse(plan), a = parse(actual);
    const over = p > 0 ? a > p : a > 0;
    const pct = p > 0 ? (a / p) * 100 : 100;
    const bar = M.progress(pct, over);
    return `<div class="mk-plan-row"><span class="mk-plan-name"><span class="mk-plan-bubble">${r.bubble}</span>${r.name}</span><span class="mk-plan-figure"><b>${M.money(actual, over ? "short" : "neutral")}</b><span>of ${M.hidden() ? "••••" : plan}</span></span>${bar}</div>`;
  }).join("");
  const host = M.el(`<div class="mk-plan">${html}</div>`);
  const wrap = section.querySelector(".month-table-wrap");
  wrap.parentNode.insertBefore(host, wrap);
}

async function before(page, h, shot, phone) {
  await h.open(page, URL_);
  await h.scrollTo(page, ".month-plan-section-budgets", phone ? 30 : 60);
  await shot("before");
}
async function after(page, h, shot, phone) {
  await h.open(page, URL_);
  await h.inject(page, CSS, { fn: build, arg: { phone } });
  await h.scrollTo(page, ".month-plan-section-budgets", phone ? 30 : 60);
  await shot("after");
  console.log("HEADS", JSON.stringify(await page.evaluate(() => window.__monthRows?.heads)));
}

export const scenarios = [
  { name: "month-phone", device: "phone", run: async (page, h, shot) => { await before(page, h, shot, true); } },
  { name: "month-phone", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "month-phone-hidden", device: "phone", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "month-desktop", device: "desktop", run: async (page, h, shot) => { await before(page, h, shot, false); } },
  { name: "month-desktop", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, false); } },
  { name: "month-desktop-hidden", device: "desktop", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, false); } }
];
