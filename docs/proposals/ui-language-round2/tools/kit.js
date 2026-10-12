// Browser-side helpers for the AFTER mockups: lsd- block markup, lucide-style
// icons and the app's person colours. Injected with page.addScriptTag.
(() => {
  const P = {
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    bank: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    sparkles: '<path d="M9.94 14.06 4 20M14 4l1.5 3.5L19 9l-3.5 1.5L14 14l-1.5-3.5L9 9l3.5-1.5z"/>',
    arrows: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'
  };
  const icon = (name, size = 16) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;

  // src/client/person-colour.js, verbatim logic.
  function personColour(ownerKey) {
    const normalized = String(ownerKey ?? "").trim().toLowerCase();
    if (normalized.includes("tim")) return "#33A471";
    if (normalized.includes("joyce")) return "#DE726D";
    if (normalized === "linked-splits") return "#BF7D51";
    const palette = ["#6A7A73", "#7C8791", "#7F9B43", "#BF7D51", "#48988A", "#9385D9"];
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }
  function personVars(key) {
    const c = personColour(key);
    return `--person-colour:${c};--person-chip-bg:color-mix(in srgb, ${c} 16%, white);--person-chip-border:color-mix(in srgb, ${c} 45%, white);--person-ink:color-mix(in srgb, ${c} 55%, var(--text));--person-band:color-mix(in srgb, ${c} 10%, white)`;
  }
  const hidden = () => document.documentElement.dataset.moneyPrivacy === "hidden";
  const money = (text, tone = "neutral") => hidden()
    ? `<span class="private-money money-neutral">••••</span>`
    : `<span class="money-${tone}">${text}</span>`;

  function chip(text, { icon: ic, tone, person, tappable, lock } = {}) {
    const cls = ["lsd-chip", tone ? `is-${tone}` : "", person ? "is-person" : "", tappable ? "is-tappable" : ""].join(" ");
    const style = person ? ` style="${personVars(person)}"` : "";
    const inner = `<span class="${cls}"${style}>${ic ? icon(ic, 14) : ""}${text}${tappable ? `<span class="lsd-chip-chevron">${icon("chevronDown", 12)}</span>` : ""}${lock ? `<span class="lsd-chip-lock">${icon("lock", 12)}</span>` : ""}</span>`;
    return tappable ? `<span class="lsd-chip-hit">${inner}</span>` : inner;
  }
  function row(label, value, { state, chevron = true, readOnly, sub } = {}) {
    const vcls = ["lsd-row-value", state === "empty" ? "is-empty" : "", state === "action" ? "is-action" : "", state === "locked" ? "is-locked" : ""].join(" ");
    return `<div class="lsd-row ${readOnly ? "is-readonly" : ""}"><span class="lsd-row-label">${label}${sub ? `<small class="mk-row-sub">${sub}</small>` : ""}</span><span class="${vcls}">${value}${chevron && !readOnly ? `<span class="lsd-row-chevron">${icon(state === "locked" ? "lock" : "chevronRight", 16)}</span>` : ""}</span></div>`;
  }
  function rows(inner, label) { return `<div class="lsd-rows"${label ? ` aria-label="${label}"` : ""}>${inner}</div>`; }
  function bubble(inner, { colour = "var(--accent-strong)", size } = {}) {
    return `<span class="lsd-bubble" style="--cat:${colour}${size ? `;width:${size}px;height:${size}px` : ""}">${inner}</span>`;
  }
  function hero({ bubble: b, title, subtitle, amount, caption, accent }) {
    return `<div class="lsd-hero">${b}<div class="lsd-heading"><span class="lsd-title">${title}</span>${subtitle ? `<span class="lsd-subtitle"${accent ? ` style="color:${accent}"` : ""}>${subtitle}</span>` : ""}</div>${amount != null ? `<div class="lsd-amount-column"><span class="lsd-amount">${amount}</span>${caption ? `<span class="lsd-amount-caption">${caption}</span>` : ""}</div>` : ""}</div>`;
  }
  function progress(valuePct, overPct, start, end) {
    const fill = hidden() ? 0 : Math.min(100, valuePct);
    const over = !hidden() && overPct;
    return `<div class="lsd-progress"><span class="lsd-bar"><span class="lsd-bar-fill${over ? " money-short" : ""}" style="width:${fill}%"></span></span>${start || end ? `<div class="lsd-progress-line"><span>${start ?? ""}</span><span>${end ?? ""}</span></div>` : ""}</div>`;
  }
  // A figure-first LeadCard (no head line): eyebrow, amount with its aside, optional bar and chips.
  function lead({ eyebrow, amount, aside, progressHtml, chips, children, cls = "" }) {
    return `<section class="lsd-card ${cls}">${eyebrow ? `<span class="lsd-eyebrow">${eyebrow}</span>` : ""}<div class="lsd-figure"><span class="lsd-amount">${amount}</span>${aside ? `<span class="lsd-amount-aside">${aside}</span>` : ""}</div>${progressHtml ?? ""}${chips ? `<div class="lsd-chips">${chips}</div>` : ""}${children ?? ""}</section>`;
  }
  // A Support pill (summary-support-pill shape): soft tint only for good outcomes.
  function pill(label, value, { soft, small } = {}) {
    return `<div class="mk-pill ${soft && !hidden() ? "money-soft" : ""}"><span class="mk-pill-label">${label}</span><strong>${value}</strong>${small ? `<small>${small}</small>` : ""}</div>`;
  }
  function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function hide(selector) { document.querySelectorAll(selector).forEach((n) => { n.style.setProperty("display", "none", "important"); }); }
  window.M = { lead, pill, icon, personColour, personVars, money, chip, row, rows, bubble, hero, progress, el, hide, hidden };
})();
