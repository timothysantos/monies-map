// An Ask answer's numbers equal the Entries page it opens: the answer card
// (src/client/ask-filter-answer.js) and the Entries page (its URL read by
// entry-filter-params.js, its rows and totals by entry-selectors.js) agree
// for the same filter over the same Entries page DTO.
import assert from "node:assert/strict";
import test from "node:test";

import { summarizeFilterAnswer, pickLead } from "../src/client/ask-filter-answer.js";
import {
  buildEntriesFilterSearch,
  clearAskFilterParams,
  hasAskFilterChip,
  readAmountParam,
  readEntriesFilterParams
} from "../src/client/entry-filter-params.js";
import { readFileSync } from "node:fs";

// The Entries panel's selector (entry-selectors.js re-exports it; that
// module also loads the import helpers, which do not run under tsx).
import { getEntryDerivedData } from "../src/client/entry-filtering.js";
import { describeFilterParts } from "../src/client/copy/entry-filter-copy.js";

const SERENE = "person-serene";
const ETHAN = "person-ethan";

function entry(fields) {
  return {
    date: "2026-09-12",
    description: "",
    note: "",
    accountId: "acct-posb",
    accountName: "POSB Joint Account",
    categoryName: "Groceries",
    entryType: "expense",
    transferDirection: undefined,
    ownershipType: "direct",
    ownerName: "Serene",
    amountMinor: 0,
    totalAmountMinor: undefined,
    splits: [],
    linkedSplitExpenseId: null,
    linkedSplitShares: [],
    ...fields
  };
}

const sereneOnly = (amountMinor) => [{ personId: SERENE, personName: "Serene", amountMinor }];

// The Entries page DTO for Serene, September 2026.
const page = {
  viewId: SERENE,
  label: "Serene",
  monthPage: {
    month: "2026-09",
    selectedScope: "direct_plus_shared",
    entries: [
      entry({ id: "e1", description: "FairPrice", amountMinor: 4500, splits: sereneOnly(4500) }),
      entry({
        id: "e2",
        description: "Sheng Siong",
        amountMinor: 6000,
        ownershipType: "shared",
        ownerName: "Shared",
        splits: [{ personId: SERENE, amountMinor: 3000 }, { personId: ETHAN, amountMinor: 3000 }],
        linkedSplitExpenseId: "split-1",
        linkedSplitShares: [{ personId: SERENE, amountMinor: 3000 }, { personId: ETHAN, amountMinor: 3000 }]
      }),
      entry({ id: "e3", description: "Koufu dinner", categoryName: "Food & Drinks", amountMinor: 7500, accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", splits: sereneOnly(7500) }),
      entry({ id: "e4", description: "Koufu lunch", categoryName: "Food & Drinks", amountMinor: 1200, accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", splits: sereneOnly(1200) }),
      entry({ id: "e5", description: "Salary", categoryName: "Salary", entryType: "income", amountMinor: 500000, accountId: "acct-uob-one", accountName: "UOB One Account", splits: sereneOnly(500000) }),
      entry({ id: "e6", description: "To POSB", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 20000, accountId: "acct-uob-one", accountName: "UOB One Account", splits: sereneOnly(20000) }),
      entry({ id: "e7", description: "FairPrice refund", entryType: "income", amountMinor: 800, splits: sereneOnly(800) }),
      entry({ id: "e8", description: "Ethan's groceries", amountMinor: 9900, ownerName: "Ethan", splits: [{ personId: ETHAN, amountMinor: 9900 }] })
    ]
  }
};

function filter(overrides) {
  return { month: "2026-09", viewId: SERENE, scope: "direct_plus_shared", search: "", categories: [], wallets: [], type: "", minAmountMinor: null, maxAmountMinor: null, ...overrides };
}

// What the Entries page shows at the URL the answer's "Open in Entries"
// navigates to: the panel's own reader and selector, nothing from Ask.
function entriesPageAt(searchParams) {
  const { selectedScope, entryFilters } = readEntriesFilterParams(searchParams, page.monthPage.selectedScope);
  const derived = getEntryDerivedData({ entries: page.monthPage.entries, entryFilters, selectedScope, viewId: searchParams.get("view"), pinnedEntryIds: [] });
  return { ids: derived.filteredEntries.map((item) => item.id), totals: derived.entryTotals };
}

test("the Entries page and the answer card run the one selector", () => {
  const selectors = readFileSync(new URL("../src/client/entry-selectors.js", import.meta.url), "utf8");
  assert.match(selectors, /import \{ getEntryDerivedData, getFilteredEntries \} from "\.\/entry-filtering";/);
  assert.match(selectors, /export \{ getEntryDerivedData, getFilteredEntries \};/);
  const panel = readFileSync(new URL("../src/client/entries-panel.jsx", import.meta.url), "utf8");
  assert.match(panel, /readEntriesFilterParams\(searchParams, defaultScope\)/);
});

const cases = [
  ["Serene's shared groceries", filter({ scope: "shared", categories: ["Groceries"] }), { ids: ["e2"], lead: { kind: "spend", amountMinor: 6000, shareMinor: 3000 } }],
  ["Serene's groceries, both scopes (a refund lowers spend)", filter({ categories: ["Groceries"] }), { ids: ["e1", "e2", "e7"], lead: { kind: "spend", amountMinor: 9700, shareMinor: 6700 } }],
  ["food over $50", filter({ categories: ["Food & Drinks"], minAmountMinor: 5000 }), { ids: ["e3"], lead: { kind: "spend", amountMinor: 7500, shareMinor: null } }],
  ["koufu under $20", filter({ search: "koufu", maxAmountMinor: 2000 }), { ids: ["e4"], lead: { kind: "spend", amountMinor: 1200, shareMinor: null } }],
  ["income", filter({ type: "income" }), { ids: ["e5", "e7"], lead: { kind: "income", amountMinor: 500000, shareMinor: null } }],
  ["transfers from UOB One", filter({ type: "transfer", wallets: ["acct-uob-one"] }), { ids: ["e6"], lead: { kind: "transfersOut", amountMinor: 20000, shareMinor: null } }],
  ["Serene's direct OCBC 365 spending", filter({ scope: "direct", type: "expense", wallets: ["acct-ocbc-365"] }), { ids: ["e3", "e4"], lead: { kind: "spend", amountMinor: 8700, shareMinor: null } }]
];

for (const [name, askFilter, expected] of cases) {
  test(`the answer card equals the Entries page it opens: ${name}`, () => {
    const answer = summarizeFilterAnswer(page, askFilter);
    const entriesPage = entriesPageAt(buildEntriesFilterSearch(askFilter));
    assert.deepEqual(answer.entryIds, expected.ids);
    assert.equal(answer.count, expected.ids.length);
    assert.deepEqual(answer.lead, expected.lead);
    assert.deepEqual(answer.entryIds, entriesPage.ids);
    assert.deepEqual(answer.totals, entriesPage.totals);
  });
}

test("an amount limit is part of the Entries URL, so dropping it changes both", () => {
  const withLimit = filter({ categories: ["Food & Drinks"], minAmountMinor: 5000 });
  const params = buildEntriesFilterSearch(withLimit);
  params.delete("entry_min");
  assert.deepEqual(entriesPageAt(params).ids, ["e3", "e4"]);
  assert.deepEqual(summarizeFilterAnswer(page, withLimit).entryIds, ["e3"]);
});

test("the answer's Entries URL carries exactly the filter, the view, the month and the scope", () => {
  const params = buildEntriesFilterSearch(filter({ scope: "shared", categories: ["Groceries", "Food & Drinks"], wallets: ["acct-posb"], search: "fair", type: "expense", minAmountMinor: 5000, maxAmountMinor: 12050 }));
  assert.deepEqual([...params.entries()], [
    ["view", SERENE],
    ["month", "2026-09"],
    ["scope", "shared"],
    ["entries_scope", "shared"],
    ["entry_search", "fair"],
    ["entry_wallet", "acct-posb"],
    ["entry_category", "Groceries"],
    ["entry_category", "Food & Drinks"],
    ["entry_type", "expense"],
    ["entry_min", "50.00"],
    ["entry_max", "120.50"],
    ["from_ask", "1"]
  ]);
  // The household has one scope, whatever the filter says.
  const household = buildEntriesFilterSearch(filter({ viewId: "household", scope: "shared" }));
  assert.equal(household.get("entries_scope"), "direct_plus_shared");
  assert.equal(household.get("scope"), "direct_plus_shared");
});

test("the From Ask chip shows only with from_ask and a list filter, and its clear keeps the view, month and scope", () => {
  const params = buildEntriesFilterSearch(filter({ scope: "shared", categories: ["Groceries"] }));
  assert.equal(hasAskFilterChip(params), true);
  const cleared = clearAskFilterParams(params);
  assert.deepEqual([...cleared.entries()], [["view", SERENE], ["month", "2026-09"], ["scope", "shared"], ["entries_scope", "shared"]]);
  assert.equal(hasAskFilterChip(cleared), false);
  // A filter set by hand on Entries is not "from Ask".
  assert.equal(hasAskFilterChip(new URLSearchParams("entry_category=Groceries")), false);
  // from_ask with nothing left to clear shows no chip.
  assert.equal(hasAskFilterChip(new URLSearchParams("from_ask=1&view=person-serene")), false);
});

test("amount params read dollars, and anything else reads as no limit", () => {
  assert.equal(readAmountParam("50"), 5000);
  assert.equal(readAmountParam("1,200.5"), 120050);
  assert.equal(readAmountParam("abc"), null);
  assert.equal(readAmountParam("-5"), null);
  assert.equal(readAmountParam(""), null);
});

test("the lead follows the type: spend by default, income, transfers in when nothing went out", () => {
  const totals = { incomeMinor: 100, spendMinor: 40, grossSpendMinor: 50, transferInMinor: 70, transferOutMinor: 0, grossTransferOutMinor: 0 };
  assert.deepEqual(pickLead("", totals), { kind: "spend", amountMinor: 50, shareMinor: 40 });
  assert.deepEqual(pickLead("income", totals), { kind: "income", amountMinor: 100, shareMinor: null });
  assert.deepEqual(pickLead("transfer", totals), { kind: "transfersIn", amountMinor: 70, shareMinor: null });
});

test("filter parts name the filter the same way on the answer card and the From Ask chip", () => {
  const accounts = [{ id: "acct-posb", name: "POSB Joint Account" }];
  const people = [{ id: SERENE, name: "Serene" }];
  const parts = describeFilterParts(filter({ scope: "shared", categories: ["Groceries"], wallets: ["acct-posb"], minAmountMinor: 5000, search: "fair" }), { accounts, people, withContext: true });
  assert.deepEqual(parts.map((part) => part.label), ["Sep 2026", "Serene · Shared", "Groceries", "POSB Joint Account", "over $50.00", "“fair”"]);
  assert.deepEqual(
    describeFilterParts(filter({ categories: ["Groceries", "Taxi", "Fees"], type: "income", maxAmountMinor: 2000 }), { accounts, people }).map((part) => part.label),
    ["Groceries +2", "Income", "under $20.00"]
  );
});
