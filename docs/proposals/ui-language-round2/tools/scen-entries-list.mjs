import { MONTH } from "./common.mjs";
const URL_ = `/entries?view=person-ethan&month=${MONTH}`;

// Entries list rows and day headers. The person edge colour stays. No bolder
// merchant: the hierarchy comes from spacing (a 64 px row, a quiet category
// line above the merchant, the wallet line below), amount alignment (right,
// tabular, one baseline with the merchant), the money tones, quiet chips
// (Matched transfer, the Apple Pay glyph) and the day header as a divider.
// Real rows are kept (so hidden money, edit and the edge behave as today);
// only styling and a few hidden empty lines change.
const CSS = `
.entries-date-group { background: transparent !important; border: 0 !important; box-shadow: none !important; margin: 0 !important; }
.entries-date-head { display: flex !important; align-items: center; gap: 10px; min-height: 0 !important; padding: 18px 2px 8px !important; background: transparent !important; border: 0 !important; }
.entries-date-head > strong { display: flex; flex: 1 1 auto; align-items: center; gap: 12px; color: var(--muted); font: 500 0.7rem/1.2 ui-monospace, "SF Mono", monospace !important; letter-spacing: 0.12em; text-transform: uppercase; }
.entries-date-head > strong::after { content: ""; flex: 1 1 auto; height: 1px; background: var(--line); }
.entries-date-actions { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 0.8rem !important; font-weight: 500; }
.entries-date-actions .entries-date-refresh-button { opacity: 0.55; transform: scale(0.85); }
.entries-date-group .entries-rows { overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: #fff; }
.entries-date-group .entry-row { border-radius: 0 !important; border-left: 0; border-right: 0; border-bottom: 0; box-shadow: none !important; }
.entries-date-group .entry-row + .entry-row { border-top: 1px solid var(--line); }
.mk-empty-note { display: none !important; }
.entry-chip.mk-quiet { padding: 0 !important; border: 0 !important; background: none !important; color: var(--muted) !important; font-size: 0.78rem; font-weight: 500; }
@media (max-width: 760px) {
  .entries-date-group { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; }
  .entry-row-main { display: grid !important; grid-template-columns: 44px minmax(0, 1fr) auto; grid-template-areas: "icon desc amount" "icon sub sub" "icon chips chips"; column-gap: 12px; row-gap: 3px; align-items: center; padding: 12px 14px 12px 16px !important; min-height: 68px; }
  .entry-row-category { grid-area: icon; display: grid; place-items: center; }
  .entry-row-category > strong { display: none !important; }
  .entry-row-description { grid-area: desc; display: grid; gap: 1px; min-width: 0; }
  .entry-row-description .entry-row-category-label strong { color: var(--muted); font-size: 0.76rem; font-weight: 500; }
  .entry-row-description > strong { font-size: 1rem; line-height: 1.25; }
  .entry-row-transfer { grid-area: sub; display: flex !important; gap: 6px; min-width: 0; color: var(--muted); font-size: 0.8rem; }
  .entry-row-transfer strong, .entry-row-transfer p { margin: 0; font-size: 0.8rem; font-weight: 500; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .entry-row-transfer p { display: none !important; }
  .entry-row-right { display: contents !important; }
  .entry-row-amount { grid-area: amount; justify-self: end; font-variant-numeric: tabular-nums; }
  .entry-row-amount strong { font-size: 1.02rem; }
  .entry-pills { grid-area: chips; justify-self: start; display: flex; align-items: center; gap: 6px; }
}
@media (min-width: 761px) {
  .entry-row-main { padding-top: 14px !important; padding-bottom: 14px !important; }
  .entry-row-description .entry-row-category-label strong { color: var(--muted); font-size: 0.76rem; font-weight: 500; }
  .entry-row-description { display: grid; gap: 2px; }
  .entry-row-amount strong { font-size: 1.02rem; font-variant-numeric: tabular-nums; }
  .entry-row-transfer strong { font-weight: 600; }
}
`;

function mark() {
  document.querySelectorAll(".entry-row-description > p").forEach((p) => { if (p.textContent.trim() === "—") p.classList.add("mk-empty-note"); });
  document.querySelectorAll(".entry-chip").forEach((c) => { if (/^Matched transfer/.test(c.textContent.trim())) c.classList.add("mk-quiet"); });
}

async function before(page, h, shot, phone) {
  await h.open(page, URL_);
  await h.scrollTo(page, ".entries-date-groups", phone ? 70 : 120);
  await shot("before");
}
async function after(page, h, shot, phone) {
  await h.open(page, URL_);
  await h.inject(page, CSS, { fn: mark });
  await h.scrollTo(page, ".entries-date-groups", phone ? 70 : 120);
  await shot("after");
}

export const scenarios = [
  { name: "entrieslist-phone", device: "phone", run: async (page, h, shot) => { await before(page, h, shot, true); } },
  { name: "entrieslist-phone", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "entrieslist-phone-hidden", device: "phone", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "entrieslist-desktop", device: "desktop", run: async (page, h, shot) => { await before(page, h, shot, false); } },
  { name: "entrieslist-desktop", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, false); } },
  { name: "entrieslist-desktop-hidden", device: "desktop", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, false); } }
];
