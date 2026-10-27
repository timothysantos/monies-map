import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

const SLOW_API_BUDGET_MS = 750;

const PAGE_APIS = [
  ["App shell", "/api/app-shell"],
  ["Reference data", "/api/reference-data"],
  ["Entries shell", "/api/entries-shell?view=household&month=2026-05"],
  ["Entries page", "/api/entries-page?view=person-tim&month=2026-01"],
  ["Summary page", "/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared"],
  ["Summary account pills", "/api/summary-account-pills?view=household"],
  ["Month page", "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared"],
  ["Splits page", "/api/splits-page?view=household&month=2026-05"],
  ["Imports page", "/api/imports-page"],
  ["Settings page", "/api/settings-page?view=household"],
  ["Ledger check-up", "/api/ledger-checkup?view=household"]
];

function readServerTiming(header) {
  const metric = (name) => Number(header?.match(new RegExp(`(?:^|, )${name};dur=([0-9.]+)`))?.[1] ?? NaN);
  return {
    app: metric("app"),
    init: metric("init"),
    initDesc: header?.match(/init;dur=[0-9.]+;desc="(cold|warm)"/)?.[1] ?? null,
    total: metric("total")
  };
}

// Only the handler (`app`) has a budget. `init` and `total` are recorded
// for the audit; the Worker clock only advances across I/O, so they are
// not asserted beyond being present.
test("seeded page APIs stay below the slow-log budget", async ({ page }) => {
  await reseedDemo(page);
  const measurements = [];
  for (const [label, path] of PAGE_APIS) {
    const response = await page.request.get(path);
    expect(response.ok(), await response.text()).toBeTruthy();
    const timing = readServerTiming(response.headers()["server-timing"]);
    expect(Number.isFinite(timing.app), `${label} did not report Server-Timing duration`).toBeTruthy();
    expect(timing.app, `${label} took ${timing.app}ms`).toBeLessThan(SLOW_API_BUDGET_MS);
    expect(Number.isFinite(timing.init) && Number.isFinite(timing.total), `${label} did not report init and total`).toBeTruthy();
    measurements.push({ label, ...timing });
  }
  console.log(`API timing ${JSON.stringify(measurements)}`);
});

// Response-size budget at demo scale. Page payloads grow quietly (a second
// copy of a list, another route's DTO embedded "just in case"), so each
// page API's body must stay within 10% of the checked-in size. The Imports
// page is left out: its inbox is computed from today's date and grows as
// months pass without imports. After a deliberate change, record new sizes
// with UPDATE_API_PAYLOAD_BUDGET=1 and explain why in the commit.
const PAYLOAD_BUDGET_FILE = new URL("./api-payload-budget.json", import.meta.url);
const PAYLOAD_TOLERANCE = 0.10;
const PAYLOAD_APIS = [
  ["app-shell", "/api/app-shell?view=household&month=2026-05&scope=direct_plus_shared"],
  ["reference-data", "/api/reference-data"],
  ["entries-page", "/api/entries-page?view=household&month=2026-05"],
  ["entries-page-person", "/api/entries-page?view=person-tim&month=2026-05"],
  ["summary-page", "/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared"],
  ["summary-account-pills", "/api/summary-account-pills?view=household"],
  ["month-page", "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared"],
  ["splits-page", "/api/splits-page?view=person-tim&month=2025-10"],
  ["settings-page", "/api/settings-page?view=household"],
  // The Ledger check-up (DOMAIN.md "Ledger Check-up"): one explicit read-only
  // report, at most 50 findings of each kind. On the demo household it is the
  // quiet accounts and a few unmatched transfers; a real household's size is
  // bounded by the same cap (tests/ledger-checkup-budget.test.mjs).
  ["ledger-checkup", "/api/ledger-checkup?view=household"]
];

// The Splits page once a settlement covered part of a group: the covered
// records stay on the server (their section's rows load when it opens), so
// the page is the open rows plus a summary and the group's counts. Measured
// after the others, because simplifying covers every open SGD record.
const SETTLED_SPLITS_PAYLOAD = ["splits-page-settled", "/api/splits-page?view=person-tim&month=2026-05"];

async function settleOneGroup(page) {
  const post = async (path, data) => {
    const response = await page.request.post(path, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const group = await post("/api/splits/groups/create", { name: "Okaeri budget", currency: "SGD", expenseSource: "mixed" });
  for (const [index, amountMinor] of [10_000, 20_000, 30_000, 40_000, 12_500, 8_000, 6_400, 9_900].entries()) {
    await post("/api/splits/expenses/create", {
      groupId: group.groupId, date: `2026-05-${String(index + 2).padStart(2, "0")}`, description: `Budget dinner ${index + 1}`,
      categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor, splitAmountMinor: amountMinor / 2,
      currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
    });
  }
  await post("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-05-20", currency: "SGD" });
  await post("/api/splits/expenses/create", {
    groupId: group.groupId, date: "2026-05-25", description: "Budget taxi", categoryName: "Taxi", payerPersonName: "Tim",
    amountMinor: 4_500, splitAmountMinor: 2_250, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
}

test("page API responses stay within their size budget at demo scale", async ({ page }) => {
  const { readFile, writeFile } = await import("node:fs/promises");
  await reseedDemo(page);
  const measured = {};
  for (const [name, path] of PAYLOAD_APIS) {
    const response = await page.request.get(path);
    expect(response.ok(), await response.text()).toBeTruthy();
    measured[name] = (await response.body()).length;
  }
  await settleOneGroup(page);
  const settledSplits = await page.request.get(SETTLED_SPLITS_PAYLOAD[1]);
  expect(settledSplits.ok(), await settledSplits.text()).toBeTruthy();
  const settledBody = await settledSplits.json();
  // None of the covered records travels with the page.
  expect(settledBody.splitsPage.activity.filter((item) => item.settlementCheckpointId && !item.isArchived)).toEqual([]);
  measured[SETTLED_SPLITS_PAYLOAD[0]] = (await settledSplits.body()).length;
  if (process.env.UPDATE_API_PAYLOAD_BUDGET) {
    await writeFile(PAYLOAD_BUDGET_FILE, `${JSON.stringify(measured, null, 2)}\n`);
    console.log(`API payload budget recorded: ${JSON.stringify(measured)}`);
    return;
  }
  const budget = JSON.parse(await readFile(PAYLOAD_BUDGET_FILE, "utf8"));
  const over = Object.entries(measured)
    .filter(([name, bytes]) => bytes > Math.round((budget[name] ?? 0) * (1 + PAYLOAD_TOLERANCE)))
    .map(([name, bytes]) => `${name}: ${bytes} bytes, budget ${budget[name]} (+${PAYLOAD_TOLERANCE * 100}%)`);
  expect(over, `Page responses over budget. Send only what the screen reads, or update the budget deliberately:\n${over.join("\n")}`).toEqual([]);
  expect(Object.keys(budget).sort()).toEqual([...PAYLOAD_APIS, SETTLED_SPLITS_PAYLOAD].map(([name]) => name).sort());
});
