import { importPreview } from "./common.mjs";

// Imports review, Lead · Support · Detail. Phone: a file card (title, account
// and owner, "89 rows will import", chips for coverage and mapping), the
// mapping as one action row, preview rows as flat 56 px rows that open a row
// edit sheet, and a one-line commit bar. Desktop: the table stays; the file
// card and a one-line commit bar are the light touch.
const CSS = `
.import-commit-bar { display: none !important; }
@media (max-width: 760px) {
  .import-workflow > * { display: none !important; }
  .import-workflow { padding: 0 !important; border: 0 !important; background: none !important; box-shadow: none !important; }
}
.mk-imp { display: grid; gap: 12px; margin: 12px 0 14px; }
.mk-imp .lsd-card { box-shadow: 0 10px 24px rgba(27,24,21,0.09); }
.mk-imp .lsd-amount-column { text-align: right; }
.mk-imp-list-head { display: flex; align-items: baseline; justify-content: space-between; margin: 6px 4px 0; }
.mk-imp-list-head strong { font-size: 1.05rem; }
.mk-imp-list-head small { color: var(--muted); }
.mk-prow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 12px; min-height: 56px; padding: 8px 14px; border-top: 1px solid var(--line); background: #fff; }
.mk-prow:first-child { border-top: 0; }
.mk-prow-main { min-width: 0; display: grid; gap: 2px; }
.mk-prow-main strong { font-weight: 600; font-size: 0.97rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-prow-main small { color: var(--muted); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-prow-amt { display: flex; align-items: center; gap: 6px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mk-prow-amt svg { color: var(--muted); }
.mk-prow.is-flag { box-shadow: inset 3px 0 0 var(--pastel-butter-line); }
.mk-prows { overflow: hidden; border: 1px solid var(--line); border-radius: 16px; }
.mk-commit-line { display: flex; align-items: center; gap: 10px; }
.mk-commit-line .lsd-primary { flex: 1 1 auto; min-height: 50px; }
.mk-commit-line .lsd-quiet { flex: 0 0 auto; min-height: 44px; }
.mk-sticky-bar.mk-commit-line { padding: 8px 10px; }
.mk-nudge { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 14px; border: 1px solid var(--pastel-sky-line); border-radius: 14px; background: var(--pastel-sky); color: var(--pastel-sky-ink); font: inherit; font-weight: 600; text-align: left; }
.mk-nudge span { flex: 1 1 auto; }
.mk-nudge b { color: var(--accent-strong); font-weight: 700; }
.mk-check { display: grid; place-items: center; width: 26px; height: 26px; border: 2px solid var(--line); border-radius: 8px; background: #fff; color: #fff; flex: 0 0 auto; }
.mk-check.is-on { background: var(--accent-strong); border-color: var(--accent-strong); }
.mk-pick-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 56px; padding: 8px 14px; border-top: 1px solid var(--line); background: #fff; }
.mk-pick-row:first-child { border-top: 0; }
@media (min-width: 761px) {
  .mk-imp { grid-template-columns: minmax(0, 1fr); }
  .mk-commit-line.mk-desktop-bar { position: sticky; bottom: 12px; z-index: 20; padding: 10px 14px; border: 1px solid var(--line); border-radius: 18px; background: rgba(255,255,255,0.97); box-shadow: 0 12px 28px rgba(27,24,21,0.12); justify-content: flex-end; margin-top: 12px; }
  .mk-commit-line.mk-desktop-bar .lsd-primary { flex: 0 0 auto; padding: 0 28px; }
  .mk-commit-line.mk-desktop-bar .mk-bar-text { margin-right: auto; color: var(--muted); }
}
`;

function readState() {
  const rows = [...document.querySelectorAll(".import-preview-table tbody tr")].filter((r) => r.querySelector("td input")).map((r) => {
    const cells = [...r.querySelectorAll("td")].map((td) => {
      const i = td.querySelector("input,select");
      return i ? (i.tagName === "SELECT" ? i.selectedOptions[0]?.textContent : i.value) : td.innerText;
    }).map((s) => (s ?? "").trim());
    const [n, , date, description, amount, type, account, category, owner, , note] = cells;
    return { n, date, description, amount, type, account, category, owner, note };
  });
  const file = document.querySelector(".import-file-chip.is-reviewing")?.textContent.replace(/·.*$/, "").trim() ?? "UOB activity";
  const mapped = ![...document.querySelectorAll(".import-workflow select")].some((x) => x.selectedOptions[0]?.textContent.trim() === "Choose account");
  const coverage = (document.querySelector(".import-summary-item")?.textContent ?? "").replace("Preview coverage", "").trim();
  const total = Number(document.querySelector(".import-commit-bar")?.innerText.match(/(\d+) rows? will import/)?.[1] ?? rows.length);
  return { rows, file, mapped, coverage, total };
}

const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
};
const cleanDate = (s) => String(s).replace(/ 2026/, "").replace(/ - /, " – ");

function buildAfter({ phone, mapped, nudge }) {
  const M = window.M;
  const st = readState.call(null);
  const account = st.rows[0]?.account ?? "UOB One Card (new) - Serene";
  const owner = account.split(" - ")[1] ?? "Serene";
  const accName = account.split(" - ")[0];
  const useMapped = mapped ?? st.mapped;
  const hostBefore = document.querySelector(".import-workflow");
  const chips = [
    M.chip(`Covers ${cleanDate(st.coverage)}`, { icon: "calendar" }),
    useMapped ? M.chip("Account mapped", { tone: "mint", icon: "check" }) : M.chip("Map 1 account", { tone: "butter", icon: "alert" }),
    M.chip(owner, { person: owner })
  ].join("");
  const lead = `<section class="lsd-card">${M.hero({
    bubble: M.bubble(M.icon("file", 26)),
    title: st.file,
    subtitle: accName,
    amount: `${st.total}`,
    caption: "rows will import"
  })}<div class="lsd-chips">${chips}</div></section>`;
  const nudgeHtml = nudge ? `<button class="mk-nudge" type="button">${M.icon("receipt", 18)}<span>5 rows look like things you usually split</span><b>Review</b>${M.icon("chevronRight", 16)}</button>` : "";
  const mapRow = M.rows(M.row("Account", useMapped ? accName : "Choose account", { state: useMapped ? undefined : "action" }), "Account for this file");
  const shown = st.rows.slice(0, phone ? 14 : 0);
  const prow = (r) => {
    const sign = r.type === "Income" ? "in" : r.type === "Expense" ? "short" : "neutral";
    return `<div class="mk-prow"><span class="mk-prow-main"><strong>${r.description}</strong><small>${shortDate(r.date)} · ${r.category}${r.type !== "Expense" ? ` · ${r.type}` : ""}</small></span><span class="mk-prow-amt">${M.money(`${r.type === "Income" ? "" : "-"}$${r.amount}`, sign)}${M.icon("chevronRight", 16)}</span></div>`;
  };
  const listHtml = phone ? `<div class="mk-imp-list-head"><strong>Preview rows</strong><small>${st.total} transactions · tap a row to edit</small></div><div class="mk-prows">${shown.map(prow).join("")}</div>` : "";
  const host = M.el(`<div class="mk-imp">${lead}${nudgeHtml}${mapRow}${listHtml}</div>`);
  const stepper = document.querySelector(".import-batch-bar");
  stepper.parentNode.insertBefore(host, hostBefore);
  if (phone) {
    document.body.appendChild(M.el(`<div class="mk-sticky-bar mk-commit-line"><button class="lsd-quiet" type="button">Start over</button><button class="lsd-primary" type="button">Commit ${st.total} rows</button></div>`));
  } else {
    // light touch: the desktop table stays; only the card, the nudge, and the bar change.
    const bar = M.el(`<div class="mk-commit-line mk-desktop-bar"><span class="mk-bar-text">${st.total} rows will import</span><button class="lsd-quiet" type="button">Start over</button><button class="lsd-primary" type="button">Commit ${st.total} rows</button></div>`);
    hostBefore.appendChild(bar);
    document.querySelector(".import-commit-bar")?.remove();
  }
  window.__imp = st;
}

function buildRowSheet(index) {
  const M = window.M;
  const r = window.__imp.rows[index];
  const [accName, owner] = [r.account.split(" - ")[0], r.account.split(" - ")[1] ?? r.owner];
  document.body.appendChild(M.el(`<div class="mk-scrim"></div>`));
  document.body.appendChild(M.el(`<section class="mk-sheet" role="dialog" aria-label="Edit row">
    <span class="mk-sheet-grab"></span>
    <div class="mk-sheet-head"><h3>Edit row</h3><span class="mk-close">×</span></div>
    <section class="lsd-card">${M.hero({ bubble: M.bubble(M.icon("tag", 26)), title: r.description, subtitle: r.category, amount: M.money(`-$${r.amount}`, "short"), caption: "" })}
      <div class="lsd-chips">${M.chip(r.type, {})}${M.chip(shortDate(r.date), { icon: "calendar" })}${M.chip(owner, { person: owner })}</div></section>
    ${M.rows(M.row("Category", r.category) + M.row("Account", accName) + M.row("Owner", owner) + M.row("Split link", "None", { state: "empty" }) + M.row("Note", r.note || "Add a note", { state: r.note ? undefined : "empty" }), "Row details")}
    <div class="lsd-bottom is-sheet-bar"><div class="lsd-bottom-start"><button class="lsd-quiet is-danger" type="button">Exclude row</button></div><div class="lsd-bottom-end"><button class="lsd-primary" type="button">Done</button></div></div>
  </section>`));
}

function buildPicker() {
  const M = window.M;
  const st = window.__imp;
  const foodish = st.rows.filter((r) => /food|dining|restaurant|grocer|drink|entertain|shopping/i.test(r.category));
  const picks = [...foodish, ...st.rows.filter((r) => !foodish.includes(r))].slice(0, 5);
  const items = picks.map((r, i) => `<div class="mk-pick-row"><span class="mk-check ${i < 3 ? "is-on" : ""}">${i < 3 ? M.icon("check", 16) : ""}</span><span class="mk-prow-main"><strong>${r.description}</strong><small>${shortDate(r.date)} · ${r.category}</small></span><span class="mk-prow-amt">${M.money(`-$${r.amount}`, "short")}</span></div>`).join("");
  document.body.appendChild(M.el(`<div class="mk-scrim"></div>`));
  document.body.appendChild(M.el(`<section class="mk-sheet" role="dialog" aria-label="Add to Splits">
    <span class="mk-sheet-grab"></span>
    <div class="mk-sheet-head"><h3>Rows you may split</h3><span class="mk-close">×</span></div>
    <p class="mk-hint">You usually split spending like these. Tick the ones to add to Splits once you commit. Nothing is split until you commit.</p>
    <div class="mk-prows">${items}</div>
    ${M.rows(M.row("Add to group", "Dinners out") + M.row("Split", "50 / 50"), "Split details")}
    <div class="lsd-bottom is-sheet-bar"><div class="lsd-bottom-start"><button class="lsd-quiet" type="button">Not now</button></div><div class="lsd-bottom-end"><button class="lsd-primary" type="button">Add 3 to Splits</button></div></div>
  </section>`));
}

async function after(page, h, shot, { phone, mapped, nudge, sheet }) {
  await importPreview(page, h, { mapAccount: mapped !== false });
  await h.inject(page, CSS);
  await page.evaluate(`window.readState = ${readState.toString()}; window.shortDate = ${shortDate.toString()}; window.cleanDate = ${cleanDate.toString()};`);
  await page.evaluate(`(${buildAfter.toString().replace("readState.call(null)", "window.readState()").replace(/shortDate\(/g, "window.shortDate(").replace(/cleanDate\(/g, "window.cleanDate(")})(${JSON.stringify({ phone, mapped, nudge })})`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  if (!phone) await h.scrollTo(page, ".mk-imp", 80);
  else await h.scrollTo(page, ".mk-imp", 70);
  await shot("after");
  if (phone && sheet) {
    await page.evaluate(`(${buildRowSheet.toString().replace(/shortDate\(/g, "window.shortDate(")})(0)`);
    await page.waitForTimeout(300);
    await shot("after-row");
    await page.evaluate(() => document.querySelectorAll(".mk-sheet,.mk-scrim").forEach((n) => n.remove()));
    await page.evaluate(`(${buildPicker.toString().replace(/shortDate\(/g, "window.shortDate(")})()`);
    await page.waitForTimeout(300);
    await shot("after-picker");
  }
}

async function before(page, h, shot, phone, mapped = true) {
  await importPreview(page, h, { mapAccount: mapped });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  await h.scrollTo(page, ".import-batch-bar", 0);
  await shot("before");
  await h.scrollTo(page, ".import-preview-table", phone ? 40 : 120);
  await shot("before-rows");
}

export const scenarios = [
  { name: "imports-phone", device: "phone", run: async (page, h, shot) => { await before(page, h, shot, true); } },
  { name: "imports-phone", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, { phone: true, nudge: true, sheet: true }); } },
  { name: "imports-phone-unmapped", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, { phone: true, mapped: false, nudge: false }); } },
  { name: "imports-phone-hidden", device: "phone", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, { phone: true, nudge: true, sheet: true }); } },
  { name: "imports-desktop", device: "desktop", run: async (page, h, shot) => { await before(page, h, shot, false); } },
  { name: "imports-desktop", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, { phone: false, nudge: true }); } },
  { name: "imports-desktop-hidden", device: "desktop", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, { phone: false, nudge: true }); } }
];
