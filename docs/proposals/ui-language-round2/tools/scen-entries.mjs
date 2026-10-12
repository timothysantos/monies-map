import { MONTH } from "./common.mjs";
const URL_ = `/entries?view=person-ethan&month=${MONTH}`;

const CSS = `
.entries-totals-strip { display: none !important; }
.mk-entries-lead-group { display: grid; gap: 10px; margin: 6px 0 12px; }
.mk-entries-lead-group .mk-entries-lead .lsd-amount { color: var(--text); }
.mk-entries-lead-group .mk-entries-lead .lsd-amount-aside { color: var(--muted); }
.mk-entries-lead-group .mk-pills { gap: 10px; }
.mk-entries-rows { margin: 0 0 12px; }
@media (min-width: 761px) {
  .mk-entries-lead-group { grid-template-columns: minmax(0, 1.2fr) minmax(300px, 1fr); align-items: stretch; margin-top: 10px; }
  .mk-entries-lead-group .mk-entries-lead { align-content: center; }
  .mk-entries-add { position: absolute; }
  .entries-filter-bar {
    padding: 10px 14px !important; border: 1px solid var(--line) !important; border-radius: 18px !important;
    background: #fff !important; box-shadow: none !important;
  }
}
`;

// Reads the real totals strip, then builds: the lead (Spent plain ink, the
// person's share as the aside), 2x2 Support pills, and on phone the two
// Detail rows (the filters live in the existing View and scope sheet).
function build({ phone }) {
  const M = window.M;
  const items = Object.fromEntries([...document.querySelectorAll(".entries-totals-strip .entries-totals-item")].map((n) => {
    const label = n.querySelector(".entries-totals-label").textContent.trim();
    const [main, share] = [...n.querySelectorAll(".private-money")].map((s) => s.textContent.trim());
    return [label, { main, share, negative: /^-|−/.test(main) }];
  }));
  const person = document.querySelector(".panel-context")?.textContent.replace("Viewing entries for", "").trim() || "Ethan";
  const month = document.querySelector(".period-range-segment")?.textContent.trim() ?? "Aug 2026";
  const hidden = M.hidden();
  const diffGood = !items.Difference.negative;
  const leadHtml = M.lead({
    cls: "mk-entries-lead",
    eyebrow: `Spent · ${month}`,
    amount: M.money(items.Spend.main, "neutral"),
    aside: items.Spend.share ? `${person}'s share ${hidden ? "••••" : items.Spend.share}` : ""
  });
  const pills = `<div class="mk-pills">
    ${M.pill("Income", M.money(items.Income.main, "neutral"), { soft: true })}
    ${M.pill("Difference", M.money(items.Difference.main, "neutral"), { soft: diffGood })}
    ${M.pill("Transfers", M.money(items.Transfers.main, "neutral"))}
    ${M.pill("Outflow", M.money(items.Outflow.main, "neutral"), { small: items.Outflow.share ? `${person}'s ${hidden ? "••••" : items.Outflow.share}` : "" })}
  </div>`;
  const group = M.el(`<div class="mk-entries-lead-group">${leadHtml}${pills}</div>`);
  const strip = document.querySelector(".entries-totals-strip");
  strip.parentNode.insertBefore(group, strip);
  if (phone) {
    const rows = M.el(`<div class="mk-entries-rows">${M.rows(
      M.row("Spending by category", "") + M.row("Filters", "All entries"), "Entries details")}</div>`);
    strip.parentNode.insertBefore(rows, strip);
  }
}

async function before(page, h, shot, phone) {
  await h.open(page, URL_);
  await shot("before");
}
async function after(page, h, shot, phone) {
  await h.open(page, URL_);
  await h.inject(page, CSS, { fn: build, arg: { phone } });
  await shot("after");
}

export const scenarios = [
  { name: "entries-phone", device: "phone", run: async (page, h, shot) => { await before(page, h, shot, true); } },
  { name: "entries-phone", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "entries-phone-hidden", device: "phone", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "entries-desktop", device: "desktop", run: async (page, h, shot) => { await before(page, h, shot, false); } },
  { name: "entries-desktop", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, false); } },
  { name: "entries-desktop-hidden", device: "desktop", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, false); } }
];
