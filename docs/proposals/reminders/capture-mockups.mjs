#!/usr/bin/env node
// Mockups for the in-app reminders proposal (docs/proposals/reminders/README.md).
// NOT app code: it opens the real app on a local showcase stack, takes a
// BEFORE screenshot, then injects the proposed reminder DOM and CSS (built
// only from the app's own tokens and classes) and takes the AFTER one.
//
// Two stacks, both on the showcase dataset seeded around 2026-10:
//   phone   : origin/master        (iPhone 13 profile in WebKit)
//   desktop : origin/desktop-ask-panel, the owner-approved docked Ask panel
//             that is not on master yet (1280 x 800 in Chromium)
// Start each with its own ports and D1 (see README "Regenerating"), then:
//
//   node docs/proposals/reminders/capture-mockups.mjs \
//     --phone-base http://127.0.0.1:5733 --desktop-base http://127.0.0.1:5472
//
// Output: docs/proposals/reminders/images/{phone,desktop}/*.webp
/* global window, document */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, devices, webkit } from "@playwright/test";
import sharp from "sharp";
import { getPersonColourVars } from "../../../src/client/person-colour.js";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const PHONE_BASE = argValue("--phone-base", "http://127.0.0.1:5733");
const DESKTOP_BASE = argValue("--desktop-base", "http://127.0.0.1:5472");
const ONLY = argValue("--only", "");
const OUT_DIR = path.resolve("docs/proposals/reminders/images");
const VIEW = "person-serene";

// ---------------------------------------------------------------------------
// Icons: the app's own lucide set, rendered to SVG strings.

async function icon(name, size = 18) {
  const { __iconNode: nodes } = await import(`lucide-react/dist/esm/icons/${name}.js`);
  const children = nodes.map(([tag, attrs]) => {
    const list = Object.entries(attrs).filter(([key]) => key !== "key").map(([key, value]) => `${key}="${value}"`).join(" ");
    return `<${tag} ${list}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

const ICONS = {};
for (const name of ["file-text", "users", "credit-card", "repeat", "calendar-check", "clock", "check", "circle-dashed", "chevron-right", "x", "calendar-x"]) {
  ICONS[name] = await icon(name, name === "chevron-right" ? 16 : 18);
}

// Ethan's person colour, the same as his Entries row edge.
const ETHAN_VARS = Object.entries(getPersonColourVars("Ethan")).map(([key, value]) => `${key}:${value}`).join(";");

// ---------------------------------------------------------------------------
// Injected styles: tokens and existing class looks only (pastel pairs, the
// Ask brief card, the chip row's pills, the Lead · Support · Detail rows and
// the mobile sheet). Prefixed rm- so nothing collides with the app.

const CSS = `
.rm-k { margin: 4px 0 -2px; color: var(--muted); font: 500 0.7rem/1.2 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.12em; text-transform: uppercase; display: flex; justify-content: space-between; }
.rm-list { display: grid; gap: 10px; }
.rm-card { display: grid; gap: 4px; padding: 12px 12px 2px 14px; border: 1px solid var(--line); border-radius: 20px; background: #fff; box-shadow: 0 10px 26px rgba(27, 24, 21, 0.08); }
.rm-head { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.rm-bubble { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--pastel-neutral); color: var(--muted); }
.rm-bubble.is-sky { background: var(--pastel-sky); color: var(--pastel-sky-ink); }
.rm-bubble.is-butter { background: var(--pastel-butter); color: var(--pastel-butter-ink); }
.rm-bubble.is-lavender { background: var(--pastel-lavender); color: var(--pastel-lavender-ink); }
.rm-bubble.is-person { background: var(--person-chip-bg); color: var(--person-ink); box-shadow: inset 0 0 0 1px var(--person-chip-border); }
.rm-copy { min-width: 0; display: grid; gap: 3px; }
.rm-copy .checkin-chip { font-size: 0.72rem; padding: 0 8px; margin-bottom: 2px; }
.rm-title { font-weight: 700; font-size: 0.98rem; line-height: 1.3; color: var(--text); }
.rm-sub { color: var(--muted); font-size: 0.86rem; line-height: 1.35; }
.rm-amount { font-weight: 700; font-size: 0.98rem; font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: 1px; }
.rm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding-left: 52px; }
.rm-btn { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 0; border: 0; border-radius: 10px; background: none; color: var(--accent-strong); font: inherit; font-size: 0.9rem; font-weight: 700; white-space: nowrap; }
.rm-btn svg { width: 16px; height: 16px; }
.rm-btn.is-quiet { color: var(--muted); font-weight: 600; padding: 0 6px; }
.rm-btn.is-quiet svg { width: 16px; height: 16px; }
.rm-btn.is-open { background: var(--pastel-neutral); box-shadow: inset 0 0 0 1px var(--line); color: var(--text); }
.rm-more { display: inline-flex; align-items: center; gap: 4px; justify-self: start; min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--accent-strong); font: inherit; font-size: 0.9rem; font-weight: 700; }

.rm-progress { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 6px 0 8px 52px; }
.rm-progress i { height: 6px; border-radius: 6px; background: color-mix(in srgb, var(--pastel-sky) 85%, white); }
.rm-progress i.is-done { background: var(--pastel-mint-ink); }
.rm-rows { overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: rgba(255, 255, 255, 0.6); }
.rm-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto 16px; align-items: center; gap: 10px; min-height: 48px; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
.rm-row:last-child { border-bottom: 0; }
.rm-row > svg:first-child { width: 20px; height: 20px; }
.rm-row.is-done > svg:first-child { color: var(--pastel-mint-ink); }
.rm-row.is-open > svg:first-child { color: var(--accent-strong); }
.rm-row-label { font-weight: 600; color: var(--text); }
.rm-row.is-done .rm-row-label { color: var(--muted); font-weight: 500; }
.rm-row-value { color: var(--muted); font-size: 0.86rem; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rm-row-value strong { font-weight: 700; }
.rm-row.is-open .rm-row-value { color: var(--text); }
.rm-row .rm-chev { color: var(--muted); }
.rm-row .rm-chev.is-none { visibility: hidden; }

/* The snooze sheet: the mobile sheet's look (backdrop, 24 px top radius,
   warm white), the Detail rows, and the BottomActions bar. */
.rm-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(18, 24, 22, 0.35); backdrop-filter: blur(4px); }
.rm-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 81; display: grid; gap: 14px; padding: 18px 16px calc(14px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(177, 94, 47, 0.14); border-radius: 24px 24px 0 0; background: linear-gradient(180deg, rgba(255, 252, 249, 0.995), rgba(255, 255, 255, 0.99) 56%, rgba(250, 239, 230, 0.96)); box-shadow: 0 -18px 42px rgba(27, 24, 21, 0.16); }
.rm-sheet-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.rm-sheet-head strong { display: block; font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.08; }
.rm-sheet-head p { margin: 4px 0 0; color: var(--muted); font-size: 0.92rem; line-height: 1.35; }
.rm-close { display: grid; place-items: center; width: 44px; height: 44px; margin: -8px -6px 0 0; border: 1px solid var(--line); border-radius: 50%; background: #fff; color: var(--text); }
.rm-pick { display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; align-items: center; gap: 10px; min-height: 52px; padding: 8px 14px; border-bottom: 1px solid var(--line); font-size: 0.95rem; }
.rm-pick:last-child { border-bottom: 0; }
.rm-pick span:first-child { font-weight: 600; }
.rm-pick small { color: var(--muted); font-size: 0.86rem; white-space: nowrap; }
.rm-pick .rm-chev { color: var(--muted); }
.rm-pick.is-skip span:first-child { color: var(--text); }
.rm-sheet-note { margin: -4px 2px 0; color: var(--muted); font-size: 0.84rem; line-height: 1.35; }
.rm-sheet-bar { display: flex; justify-content: flex-end; gap: 10px; padding-top: 4px; }
.rm-sheet-bar button { min-height: 50px; padding: 0 22px; border: 1px solid var(--line); border-radius: 14px; background: #fff; color: var(--text); font: inherit; font-weight: 700; }

/* Desktop: the same choices in a small popover above Later, like the
   "More pages" menu. */
.rm-pop { position: absolute; z-index: 90; width: 290px; padding: 6px; border: 1px solid var(--line); border-radius: 16px; background: #fff; box-shadow: 0 18px 40px rgba(27, 24, 21, 0.18); }
.rm-pop-title { margin: 6px 10px 6px; color: var(--muted); font-size: 0.8rem; font-weight: 600; }
.rm-pop .rm-pick { min-height: 44px; border-bottom: 0; border-radius: 10px; padding: 6px 10px; }
.rm-pop .rm-pick.is-hover { background: var(--pastel-neutral); }
.rm-pop hr { margin: 4px 6px; border: 0; border-top: 1px solid var(--line); }

/* The Ask cue: the shell's existing 7 px accent dot. */
.rm-field-dot { position: absolute; left: 26px; top: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent-strong); box-shadow: 0 0 0 2px #fff; }

`;


// ---------------------------------------------------------------------------
// Reminder content (Serene's view, today Mon 12 Oct 2026). Figures marked
// "showcase" come from the showcase data; "illustrative" ones are invented
// because the showcase has no such field (see README "Data used").

function card({ tone, iconName, title, sub, amount, amountTone, primary, quiet = "Later", personVars = "", open = false }) {
  const amountHtml = amount ? `<span class="rm-amount ${amountTone ?? ""}">${amount}</span>` : "<span></span>";
  return `
  <article class="rm-card" style="${personVars}">
    <div class="rm-head">
      <span class="rm-bubble ${tone}">${ICONS[iconName]}</span>
      <div class="rm-copy">
        <span class="rm-title">${title}</span>
        <span class="rm-sub">${sub}</span>
      </div>
      ${amountHtml}
    </div>
    <div class="rm-actions">
      <button type="button" class="rm-btn">${primary}${ICONS["chevron-right"]}</button>
      <button type="button" class="rm-btn is-quiet${open ? " is-open" : ""}" data-rm-later>${ICONS.clock}${quiet}</button>
    </div>
  </article>`;
}

// Card bill: the September statement balance is the showcase's; the due
// date is illustrative (showcase checkpoints carry no due date).
function cardBillCard(hidden) {
  return card({
    tone: "is-butter",
    iconName: "credit-card",
    title: "UOB PRVI Miles bill due in 6 days",
    sub: "Due Sun 18 Oct. Nothing paid to it since the statement.",
    amount: hidden ? "••••" : "$527.73",
    amountTone: "money-neutral",
    primary: "Open card"
  });
}

// Statement: showcase (OCBC 365's latest statement is August's; its
// statements close on the last day of the month).
function statementCard({ open = false } = {}) {
  return card({
    tone: "is-sky",
    iconName: "file-text",
    title: "OCBC 365 Card's September statement is ready",
    sub: "It came out about 12 days ago. Importing it checks September's card spending.",
    primary: "Import statement",
    open
  });
}

// Splits: showcase (the open 6 Sep settle-up, Serene to Ethan).
function splitsCard(hidden) {
  return card({
    tone: "is-person",
    personVars: ETHAN_VARS,
    iconName: "users",
    title: "Settle-up with Ethan waiting 5 weeks",
    sub: hidden
      ? "Agreed on 6 Sep to even out your shared costs."
      : "On 6 Sep you agreed to pay him this to even out your shared costs.",
    amount: hidden ? "••••" : "$1,047.24",
    amountTone: hidden ? "money-neutral" : "money-short",
    primary: "Open Splits"
  });
}

// Price change: illustrative (the showcase's subscriptions keep one price).
function priceCard() {
  return card({
    tone: "is-lavender",
    iconName: "repeat",
    title: "Spotify now costs $17.98 a month",
    sub: "Up from $15.98, its price for the 11 months before. First new charge on 7 Oct.",
    amount: "+$2.00",
    amountTone: "money-neutral",
    primary: "See charges",
    quiet: "Got it"
  });
}

function row({ done, label, value, chevron = true }) {
  return `
    <div class="rm-row ${done ? "is-done" : "is-open"}">
      ${done ? ICONS.check : ICONS["circle-dashed"]}
      <span class="rm-row-label">${label}</span>
      <span class="rm-row-value">${value}</span>
      <span class="rm-chev${chevron ? "" : " is-none"}">${ICONS["chevron-right"]}</span>
    </div>`;
}

// Month close: September a week on, after the OCBC 365 statement is
// imported. Other, Splits and the month note are the showcase's.
function monthCloseCard(hidden) {
  return `
  <article class="rm-card">
    <div class="rm-head">
      <span class="rm-bubble is-sky">${ICONS["calendar-check"]}</span>
      <div class="rm-copy">
        <span class="rm-title">September is ready to close</span>
        <span class="rm-sub">Every statement is in. 3 of 4 checks done.</span>
      </div>
      <span></span>
    </div>
    <div class="rm-progress" aria-hidden="true"><i class="is-done"></i><i class="is-done"></i><i></i><i class="is-done"></i></div>
    <div class="rm-rows">
      ${row({ done: true, label: "Statements imported", value: "All 6", chevron: false })}
      ${row({ done: true, label: "Left in Other (no category)", value: "None", chevron: false })}
      ${row({ done: false, label: "Splits to settle", value: hidden ? "with Ethan" : `<strong class="money-short">$1,047.24</strong> with Ethan` })}
      ${row({ done: true, label: "Month note", value: "Written" })}
    </div>
    <div class="rm-actions">
      <button type="button" class="rm-btn">Open September${ICONS["chevron-right"]}</button>
      <button type="button" class="rm-btn is-quiet" data-rm-later>${ICONS.clock}Later</button>
    </div>
  </article>`;
}

const PICKS = [
  { label: "Tomorrow", when: "Tue 13 Oct" },
  { label: "In 3 days", when: "Thu 15 Oct" },
  { label: "Next week", when: "Mon 19 Oct" }
];

function snoozeSheet() {
  return `
  <div class="rm-overlay"></div>
  <section class="rm-sheet" role="dialog" aria-label="Remind me later">
    <div class="rm-sheet-head">
      <div><strong>Remind me later</strong><p>OCBC 365 Card's September statement</p></div>
      <button type="button" class="rm-close" aria-label="Close">${ICONS.x}</button>
    </div>
    <div class="rm-rows">
      ${PICKS.map((pick) => `<div class="rm-pick"><span>${pick.label}</span><small>${pick.when}</small><span class="rm-chev">${ICONS["chevron-right"]}</span></div>`).join("")}
    </div>
    <div class="rm-rows">
      <div class="rm-pick is-skip"><span>Not for this statement</span><small>back for October's</small><span class="rm-chev">${ICONS["chevron-right"]}</span></div>
    </div>
    <p class="rm-sheet-note">This only hides it on this phone. It goes away by itself once the statement is imported.</p>
    <div class="rm-sheet-bar"><button type="button">Cancel</button></div>
  </section>`;
}

function snoozePopover() {
  return `
  <div class="rm-pop" role="menu" aria-label="Remind me later">
    <p class="rm-pop-title">Remind me later</p>
    ${PICKS.map((pick, index) => `<div class="rm-pick${index === 1 ? " is-hover" : ""}"><span>${pick.label}</span><small>${pick.when}</small><span></span></div>`).join("")}
    <hr>
    <div class="rm-pick is-skip"><span>Not for this statement</span><small>back for October's</small><span></span></div>
  </div>`;
}

function remindersBlock(cards, { count, more = 0 } = {}) {
  return `
  <div class="rm-block">
    <p class="rm-k"><span>Reminders</span><span>${count}</span></p>
    <div class="rm-list">${cards.join("")}</div>
    ${more ? `<button type="button" class="rm-more">${more} more reminder${more === 1 ? "" : "s"}${ICONS["chevron-right"]}</button>` : ""}
  </div>`;
}

// ---------------------------------------------------------------------------
// Page helpers

async function waitUsable(page) {
  await page.waitForFunction(() => Boolean(window.__MONIES_MAP_ROUTE_WORK__?.usable), null, { timeout: 45_000 });
  await page.waitForTimeout(900);
}

async function addStyles(page) {
  await page.addStyleTag({ content: `${CSS} *{caret-color:transparent !important} ::-webkit-scrollbar{display:none}` });
}

// Opens Ask from Summary so the "since you last looked" card has the
// Summary it reads, with the visit memory cleared so it shows a real
// headline rather than "All quiet since earlier today".
async function openAskFromSummary(page, { phone }) {
  await page.goto(`/summary?view=${VIEW}`, { waitUntil: "domcontentloaded" });
  await waitUsable(page);
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("monies-map:checkin:")) window.localStorage.removeItem(key);
    }
  });
  if (phone) {
    await page.locator(".tab-strip a.tab-phone-only").click();
  } else {
    await page.locator(".ask-dock-field-input").click();
  }
  await page.locator(".ask-thread .ask-k").first().waitFor({ timeout: 30_000 });
  await waitUsable(page);
  await addStyles(page);
}

async function injectReminders(page, html) {
  await page.evaluate((markup) => {
    document.querySelector(".rm-block")?.remove();
    const thread = document.querySelector(".ask-thread");
    thread.querySelector(".ask-k").insertAdjacentHTML("beforebegin", markup);
    for (let node = thread; node; node = node.parentElement) {
      if (node.scrollTop) node.scrollTop = 0;
    }
  }, html);
  await page.waitForTimeout(250);
}

async function scrollThreadTo(page, selector) {
  await page.evaluate((target) => {
    document.querySelector(target)?.scrollIntoView({ block: "start" });
  }, selector);
  await page.waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// Encoding: each picture gets a caption strip above it (never over the UI),
// dark for BEFORE (the app today) and terracotta for AFTER (the proposal).

const SIZES = { phone: { width: 780, quality: 80 }, desktop: { width: 1280, quality: 82 } };

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function save(page, kind, name, caption, { clip, zoom = 1 } = {}) {
  const buffer = await page.screenshot({ type: "png", ...(clip ? { clip } : {}) });
  const dir = path.join(OUT_DIR, kind);
  await mkdir(dir, { recursive: true });
  const size = SIZES[kind];
  const width = clip ? Math.round(clip.width * zoom) : size.width;
  const body = await sharp(buffer).resize({ width, withoutEnlargement: true }).png().toBuffer();
  const { height } = await sharp(body).metadata();
  const isAfter = caption.startsWith("AFTER");
  const fontSize = width < 500 ? 13 : 18;
  const strip = Math.round(fontSize * 2.4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${strip}">
    <rect width="100%" height="100%" fill="${isAfter ? "#934923" : "#2f2c28"}"/>
    <text x="${Math.round(fontSize * 0.9)}" y="${Math.round(strip * 0.66)}" font-family="Menlo, monospace" font-size="${fontSize}" font-weight="600" fill="#ffffff">${escapeXml(caption)}</text>
  </svg>`;
  await sharp({ create: { width, height: height + strip, channels: 3, background: "#ffffff" } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }, { input: body, top: strip, left: 0 }])
    .webp({ quality: size.quality, effort: 6 })
    .toFile(path.join(dir, `${name}.webp`));
  console.log(`${kind}/${name}.webp`);
}

// ---------------------------------------------------------------------------
// Phone (iPhone 13, WebKit, master)

async function phoneShots(browser, { hidden }) {
  const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: PHONE_BASE, locale: "en-SG", timezoneId: "Asia/Singapore" });
  await context.addInitScript((visible) => window.localStorage.setItem("monies-map:money-totals-visible", visible ? "true" : "false"), !hidden);
  const page = await context.newPage();
  try {
    if (hidden) {
      await openAskFromSummary(page, { phone: true });
      await injectReminders(page, remindersBlock([cardBillCard(true), statementCard()], { count: 3, more: 1 }));
      await save(page, "phone", "ask-reminders-hidden-after", "AFTER · money hidden: amounts masked, no sign words");
      return;
    }

    // Ask tab: no dot today vs the reminder dot, seen from Summary.
    await page.goto(`/summary?view=${VIEW}`, { waitUntil: "domcontentloaded" });
    await waitUsable(page);
    await addStyles(page);
    const tabBox = await page.locator(".tab-strip").boundingBox();
    const top = Math.max(0, tabBox.y - 10);
    const tabClip = { x: 0, y: top, width: 390, height: Math.min(664 - top, tabBox.height + 20) };
    await save(page, "phone", "tab-before", "BEFORE · Summary, Ask tab today");
    await save(page, "phone", "tab-bar-before", "BEFORE · tab bar", { clip: tabClip, zoom: 2 });
    await page.evaluate(() => {
      const label = document.querySelector(".tab-strip a.tab-phone-only .tab-label-with-badge");
      label.insertAdjacentHTML("beforeend", '<span class="tab-dot" aria-hidden="true"></span>');
      label.closest("a").setAttribute("aria-label", "Ask, 3 reminders");
    });
    await save(page, "phone", "tab-after", "AFTER · the same dot: new reminders");
    await save(page, "phone", "tab-bar-after", "AFTER · tab bar, Ask dot", { clip: tabClip, zoom: 2 });

    // Ask opening: today vs reminders above "since you last looked".
    await openAskFromSummary(page, { phone: true });
    await save(page, "phone", "ask-before", "BEFORE · Ask opens today");
    await injectReminders(page, remindersBlock([cardBillCard(false), statementCard()], { count: 3, more: 1 }));
    await save(page, "phone", "ask-reminders-after", "AFTER · 2 reminders + 1 more, then the brief");
    await injectReminders(page, remindersBlock([cardBillCard(false), statementCard(), splitsCard(false)], { count: 3 }));
    await scrollThreadTo(page, ".rm-list .rm-card:nth-child(2)");
    await save(page, "phone", "ask-reminders-expanded-after", "AFTER · 1 more opened, scrolled");

    // Snooze sheet over the statement reminder.
    await injectReminders(page, remindersBlock([cardBillCard(false), statementCard({ open: true })], { count: 3, more: 1 }));
    await page.evaluate((markup) => document.body.insertAdjacentHTML("beforeend", markup), snoozeSheet());
    await save(page, "phone", "snooze-sheet-after", "AFTER · Later opens the snooze sheet");
    await page.evaluate(() => document.querySelectorAll(".rm-overlay, .rm-sheet").forEach((node) => node.remove()));

    // Month close: a week later (statement imported, bill paid).
    await injectReminders(page, remindersBlock([monthCloseCard(false), priceCard()], { count: 2 }));
    await save(page, "phone", "month-close-after", "AFTER · month-close checklist, a week on");
    await scrollThreadTo(page, ".rm-list .rm-card:last-child");
    await save(page, "phone", "price-change-after", "AFTER · price change, below the checklist");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Desktop (1280 x 800, Chromium, desktop-ask-panel branch)

async function desktopShots(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, baseURL: DESKTOP_BASE, locale: "en-SG", timezoneId: "Asia/Singapore" });
  await context.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  const page = await context.newPage();
  try {
    // The Ask field with the dock closed: today vs the reminder dot.
    await page.goto(`/summary?view=${VIEW}`, { waitUntil: "domcontentloaded" });
    await waitUsable(page);
    await addStyles(page);
    const fieldBox = await page.locator(".ask-dock-field").boundingBox();
    const fieldClip = { x: fieldBox.x - 30, y: fieldBox.y - 24, width: fieldBox.width + 52, height: fieldBox.height + 48 };
    await save(page, "desktop", "field-before", "BEFORE · desktop, Ask field (panel closed)");
    await save(page, "desktop", "field-zoom-before", "BEFORE · Ask field", { clip: fieldClip, zoom: 2 });
    await page.evaluate(() => {
      const field = document.querySelector(".ask-dock-field");
      field.insertAdjacentHTML("beforeend", '<span class="rm-field-dot" aria-hidden="true"></span>');
      field.querySelector("input")?.setAttribute("aria-label", "Ask, 3 reminders");
    });
    await save(page, "desktop", "field-after", "AFTER · the same dot on the field's sparkle");
    await save(page, "desktop", "field-zoom-after", "AFTER · Ask field with dot", { clip: fieldClip, zoom: 2 });

    // Docked Ask: today vs reminders.
    await openAskFromSummary(page, { phone: false });
    await save(page, "desktop", "dock-before", "BEFORE · docked Ask at 1280 (desktop-ask-panel branch)");
    await injectReminders(page, remindersBlock([cardBillCard(false), statementCard(), splitsCard(false)], { count: 3 }));
    await save(page, "desktop", "dock-reminders-after", "AFTER · 3 reminders in the docked panel");

    // Snooze menu above Later.
    await injectReminders(page, remindersBlock([cardBillCard(false), statementCard({ open: true }), splitsCard(false)], { count: 3 }));
    await page.evaluate((markup) => {
      const later = document.querySelectorAll(".rm-card")[1].querySelector("[data-rm-later]");
      const rect = later.getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", markup);
      const pop = document.querySelector(".rm-pop");
      pop.style.position = "fixed";
      pop.style.left = `${Math.max(8, Math.min(rect.left - 40, window.innerWidth - 300))}px`;
      pop.style.top = `${rect.bottom + 6}px`;
    }, snoozePopover());
    await save(page, "desktop", "snooze-menu-after", "AFTER · Later opens a small menu on desktop");
    await page.evaluate(() => document.querySelector(".rm-pop")?.remove());

    // Month close in the dock.
    await injectReminders(page, remindersBlock([monthCloseCard(false), priceCard()], { count: 2 }));
    await save(page, "desktop", "month-close-after", "AFTER · month-close checklist in the dock, a week on");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------

const failures = [];
if (!ONLY || ONLY === "phone") {
  const browser = await webkit.launch();
  try {
    await phoneShots(browser, { hidden: false }).catch((error) => failures.push(`phone: ${error.message}`));
    await phoneShots(browser, { hidden: true }).catch((error) => failures.push(`phone hidden: ${error.message}`));
  } finally {
    await browser.close();
  }
}
if (!ONLY || ONLY === "desktop") {
  const browser = await chromium.launch();
  try {
    await desktopShots(browser).catch((error) => failures.push(`desktop: ${error.message}`));
  } finally {
    await browser.close();
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
