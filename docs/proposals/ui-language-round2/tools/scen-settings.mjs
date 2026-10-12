import { openSettingsSection } from "./common.mjs";

// Settings: the closed list becomes one grouped Detail list with a status
// value per row; an opened section unfolds in place, in the list, as
// Lead (status) · Support (chips) · Detail (rows) with its action at the
// bottom. Only facts the app already shows are used.
const CSS = `
.settings-page .settings-card { display: none !important; }
.mk-settings-list { margin: 4px 0 12px; }
.mk-settings-list .lsd-row-label { font-weight: 600; color: var(--text); white-space: nowrap; }
.mk-settings-list .lsd-row-value { color: var(--muted); font-weight: 500; }
.mk-open-block { display: grid; gap: 12px; margin: 0 0 14px; padding: 12px; border: 1px solid var(--line); border-radius: 18px; background: rgba(255,255,255,0.55); }
.mk-open-block .lsd-card { box-shadow: 0 8px 20px rgba(27,24,21,0.08); }
.mk-person-head { display: flex; align-items: center; gap: 8px; margin: 2px 2px -4px; }
.mk-open-block .mk-hint { margin: -4px 2px 0; }
.mk-open-block .lsd-row-label { color: var(--muted); font-weight: 500; }
.mk-open-block .lsd-row-value { font-weight: 600; }
.mk-full-primary { width: 100%; }
.mk-settings-list .lsd-row.is-open { background: color-mix(in srgb, var(--accent-strong) 7%, white); }
@media (min-width: 761px) { .mk-open-block { max-width: 720px; } }
`;

function buildList(page, open) {
  return page.evaluate((openTitle) => {
    const M = window.M;
    const cards = [...document.querySelectorAll(".settings-card")];
    const people = [...document.querySelectorAll(".context-block .pill")].map((p) => p.textContent.trim()).filter((t) => t !== "Household");
    const data = cards.map((card) => ({
      card,
      title: card.querySelector("h3")?.textContent.trim(),
      text: card.querySelector(".chart-head p")?.textContent.trim() ?? ""
    }));
    const countOf = { People: people.join(", "), Accounts: window.__counts?.Accounts, Categories: window.__counts?.Categories };
    const status = (t) => {
      if (countOf[t.title]) return String(countOf[t.title]);
      if (t.title === "Apple Pay shortcut") return `<span class="mk-badge-butter">Not set up</span>`;
      if (t.title === "Ask and AI") return "Basic model";
      if (t.title === "Balance trust rules") { const n = t.text.match(/^(\d+)/)?.[1]; return n ? `<span class="mk-badge-butter">${n} to check</span>` : "All clear"; }
      if (t.title === "Unresolved transfers") { const n = t.text.match(/^(\d+)/)?.[1]; return n ? `<span class="mk-badge-butter">${n} to pair</span>` : "All paired"; }
      return "";
    };
    const rowHtml = (t) => {
      const isOpen = t.title === openTitle;
      let html = M.row(t.title, isOpen ? "" : status(t));
      if (isOpen) {
        html = html.replace('class="lsd-row ', 'class="lsd-row is-open ');
        html = html.replace(/(<span class="lsd-row-chevron">)[^]*?<\/svg>/, `$1${M.icon("chevronDown", 16)}`);
      }
      return html;
    };
    const selText = (root) => [...root.querySelectorAll("select")].map((s) => ({
      label: s.closest(".table-edit-field")?.querySelector("label")?.textContent.trim(),
      value: s.selectedOptions[0]?.textContent.trim(),
      disabled: s.disabled,
      help: s.closest(".table-edit-field")?.querySelector(".field-help")?.textContent.trim()
    }));

    const contentFor = (t) => {
      const card = t.card;
      if (t.title === "Apple Pay shortcut") {
        const firstAccount = card.querySelector(".settings-shortcut-account-row strong")?.textContent.trim() ?? "";
        const selects = selText(card);
        const other = selects[selects.length - 1]?.value || "None";
        const steps = card.querySelectorAll(".settings-shortcut-steps li").length;
        return `<section class="lsd-card">${M.hero({ bubble: M.bubble(M.icon("phone", 26)), title: "Apple Pay capture", subtitle: "Not set up yet" })}
          <div class="lsd-chips">${M.chip("Apple-signed", { tone: "mint", icon: "shield" })}${M.chip("Opens the entry to edit", { icon: "receipt" })}</div></section>
          ${M.rows(M.row("Default account", firstAccount) + M.row("Other currencies go to", other) + M.row("How to set it up", `${steps} steps`) + M.row("More shortcut settings", ""), "Apple Pay shortcut")}
          <p class="mk-hint">No account in the shortcut? The entry goes to the first account in your list.</p>
          <div class="mk-card-actions"><button class="lsd-primary mk-full-primary" type="button">Install Apple Shortcut</button></div>`;
      }
      if (t.title === "Payment ways") {
        return [...card.querySelectorAll("fieldset")].map((fs) => {
          const person = fs.querySelector("legend")?.textContent.trim();
          const fields = selText(fs);
          const rows = fields.map((f) => f.disabled
            ? M.row(f.label, "No account", { state: "empty", chevron: false })
            : M.row(f.label, f.value === "None" ? "Choose an account" : f.value, { state: f.value === "None" ? "empty" : undefined })).join("");
          const help = fields.find((f) => f.help)?.help;
          return `<div class="mk-person-head">${M.chip(person, { person })}</div>${M.rows(rows, `${person} payment ways`)}${help ? `<p class="mk-hint">${help}</p>` : ""}`;
        }).join("");
      }
      if (t.title === "Ask and AI") {
        const lines = card.innerText.split("\n").map((x) => x.trim()).filter(Boolean);
        const sentence = lines.find((l) => /set up|credit|model/i.test(l) && l.length > 25 && !l.startsWith("Claude credits for") && l !== "Ask and AI");
        const checked = (lines.find((l) => l.startsWith("Last checked")) ?? "").replace("Last checked ", "").replace(" at ", ", ");
        return `<section class="lsd-card">${M.hero({ bubble: M.bubble(M.icon("sparkles", 26)), title: "Ask", subtitle: "Uses the basic model" })}
          <div class="lsd-chips">${M.chip("Claude not set up", { tone: "butter", icon: "alert" })}</div></section>
          ${M.rows(M.row("Model", "Basic model", { readOnly: true }) + M.row("Claude credits", "Not set up", { state: "action" }) + (checked ? M.row("Last checked", checked, { readOnly: true }) : ""), "Ask and AI")}
          ${sentence ? `<p class="mk-hint">${sentence}</p>` : ""}`;
      }
      return "";
    };

    const first = cards[0];
    const idx = data.findIndex((t) => t.title === openTitle);
    const host = document.createElement("div");
    if (idx < 0) {
      host.innerHTML = `<div class="mk-settings-list">${M.rows(data.map(rowHtml).join(""), "Settings")}</div>`;
    } else {
      host.innerHTML = `<div class="mk-settings-list">${M.rows(data.slice(0, idx + 1).map(rowHtml).join(""), "Settings")}</div>
        <div class="mk-open-block">${contentFor(data[idx])}</div>
        <div class="mk-settings-list">${M.rows(data.slice(idx + 1).map(rowHtml).join(""), "More settings")}</div>`;
    }
    [...host.children].forEach((n) => first.parentNode.insertBefore(n, first));
  }, open);
}

async function after(page, h, shot, open) {
  // The real section is opened first so its own data (selects, steps, accounts) can be read.
  await openSettingsSection(page, h, open ?? undefined);
  const ref = await (await page.request.get("/api/reference-data")).json();
  await page.evaluate((c) => { window.__counts = c; }, { Accounts: ref.accounts?.length, Categories: ref.categories?.length });
  await h.inject(page, CSS);
  await buildList(page, open);
  if (open) {
    const toggle = page.locator(".mk-settings-list .lsd-row.is-open").first();
    await toggle.evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 10, behavior: "instant" }));
    await page.waitForTimeout(400);
  }
  await shot(open ? "after" : "after-closed");
}

export const scenarios = [
  { name: "settings-phone", device: "phone", run: async (page, h, shot) => { await openSettingsSection(page, h); await shot("before-closed"); } },
  { name: "settings-phone", device: "phone", run: async (page, h, shot) => { await after(page, h, shot, null); } },
  { name: "settings-desktop", device: "desktop", run: async (page, h, shot) => { await openSettingsSection(page, h); await shot("before-closed"); } },
  { name: "settings-desktop", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, null); } },
  ...[["applepay", "Apple Pay shortcut"], ["payways", "Payment ways"], ["askai", "Ask and AI"]].flatMap(([key, heading]) => [
    { name: `settings-phone-${key}`, device: "phone", run: async (page, h, shot) => { await openSettingsSection(page, h, heading); await shot("before"); } },
    { name: `settings-phone-${key}`, device: "phone", run: async (page, h, shot) => { await after(page, h, shot, heading); } }
  ]),
  { name: "settings-desktop-applepay", device: "desktop", run: async (page, h, shot) => { await openSettingsSection(page, h, "Apple Pay shortcut"); await shot("before"); } },
  { name: "settings-desktop-applepay", device: "desktop", run: async (page, h, shot) => { await after(page, h, shot, "Apple Pay shortcut"); } }
];
