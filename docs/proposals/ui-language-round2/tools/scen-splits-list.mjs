import { MONTH } from "./common.mjs";
const URL_ = `/splits?view=person-ethan&month=${MONTH}`;

// Splits activity list: expense rows, settle-ups and history. Same moves as
// the Entries list: the day header becomes a quiet divider (count on the
// right), rows get a calmer 64 px rhythm, the person's balance line is the
// aligned right-hand figure in its money tone, and settle-ups read as
// a quiet "Settled" row, not a card of their own. The orange panel stays.
const CSS = `
.split-date-group { background: transparent !important; border: 0 !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
.split-date-header { display: flex !important; align-items: center; gap: 10px; padding: 16px 2px 8px !important; background: transparent !important; border: 0 !important; min-height: 0 !important; }
.split-date-header > strong { display: flex; flex: 1 1 auto; align-items: center; gap: 12px; color: rgba(255, 255, 255, 0.86) !important; font: 500 0.7rem/1.2 ui-monospace, "SF Mono", monospace !important; letter-spacing: 0.12em; text-transform: uppercase; }
.split-date-header > strong::after { content: ""; flex: 1 1 auto; height: 1px; background: rgba(255, 255, 255, 0.32); }
.split-date-actions { display: flex; align-items: center; gap: 6px; color: rgba(255, 255, 255, 0.86) !important; font-size: 0.8rem; }
.split-date-actions * { color: inherit; }
.split-date-actions .split-date-refresh-button { background: transparent !important; border: 0 !important; box-shadow: none !important; color: rgba(255, 255, 255, 0.85) !important; opacity: 0.8; transform: scale(0.85); }
.split-date-group { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
.split-date-items, .split-date-items .split-activity-card { max-width: 100%; box-sizing: border-box; }
.split-activity-card .split-activity-trailing { min-width: 0; }
.split-date-items { overflow: hidden; border-radius: 16px; background: #fff; }
.split-date-items .split-activity-card { border-radius: 0 !important; box-shadow: none !important; margin: 0 !important; min-height: 64px; }
.split-date-items .split-activity-card + .split-activity-card { border-top: 1px solid var(--line) !important; }
.split-activity-card .split-activity-copy { gap: 3px; }
.split-activity-card .split-activity-trailing { font-variant-numeric: tabular-nums; }
.split-archive-trigger { background: transparent !important; border: 1px dashed rgba(255, 255, 255, 0.45) !important; color: rgba(255, 255, 255, 0.9) !important; }
.split-archive-trigger * { color: inherit !important; }
`;

async function before(page, h, shot, phone) {
  await h.open(page, URL_);
  await h.scrollTo(page, ".split-activity-list", phone ? 90 : 160);
  await shot("before");
}
async function after(page, h, shot, phone) {
  await h.open(page, URL_);
  await h.inject(page, CSS);
  await h.scrollTo(page, ".split-activity-list", phone ? 90 : 160);
  await shot("after");
}

export const scenarios = [
  { name: "splitslist-phone", device: "phone", run: async (page, h, shot) => { await before(page, h, shot, true); } },
  { name: "splitslist-phone", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "splitslist-phone-hidden", device: "phone", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, true); } },
  { name: "splitslist-desktop", device: "desktop", run: async (page, h, shot) => { await before(page, h, shot, false); } },
  { name: "splitslist-desktop", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, false); } },
  { name: "splitslist-desktop-hidden", device: "desktop", hidden: true, run: async (page, h, shot) => { await after(page, h, shot, false); } }
];
