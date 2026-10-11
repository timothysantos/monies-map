import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTRY_DRAFT_TEXT_MAX_LENGTH,
  entryDraftWantsAi,
  parseEntryDraftAiSuggestion,
  parseEntrySentence
} from "../src/domain/entry-draft.ts";
import { defaultCategoryMatchRules } from "../src/domain/category-match-defaults.ts";

// Entry draft: a typed sentence turned into a draft for the future "Add or
// ask" card to show for confirmation. Pure and deterministic: no AI, no
// database, no clock (today is an input). Demo household names only.

const TODAY = "2026-10-11"; // a Sunday in Asia/Singapore

function account(id, institution, name, kind, ownerLabel, extra = {}) {
  return {
    id,
    institutionId: `inst-${institution.toLowerCase()}`,
    ownerPersonId: ownerLabel === "Shared" ? undefined : `person-${ownerLabel.toLowerCase()}`,
    name,
    institution,
    kind,
    ownerLabel,
    currency: "SGD",
    isJoint: ownerLabel === "Shared",
    isActive: true,
    ...extra
  };
}

const ACCOUNTS = [
  account("acct-ocbc-360", "OCBC", "OCBC 360 Account", "bank", "Ethan"),
  account("acct-uob-one", "UOB", "UOB One Account", "bank", "Serene"),
  account("acct-posb-joint", "DBS", "POSB Joint Account", "bank", "Shared"),
  account("acct-citi-cash-back", "Citibank", "Citi Cash Back Card", "credit_card", "Ethan"),
  account("acct-uob-prvi", "UOB", "UOB PRVI Miles Card", "credit_card", "Serene"),
  account("acct-ocbc-365", "OCBC", "OCBC 365 Card", "credit_card", "Serene"),
  account("acct-old-dbs", "DBS", "DBS Altitude Card", "credit_card", "Ethan", { isActive: false })
];

const CATEGORY_NAMES = [
  "Income", "Transfer", "Savings", "Salary", "Extra Income", "Other - Income", "Food & Drinks",
  "Shopping", "Groceries", "Travel", "Bills", "Taxi", "Public Transport", "Other", "Freelance Income"
];

const RULES = defaultCategoryMatchRules
  .slice()
  .sort((left, right) => left.priority - right.priority || left.pattern.localeCompare(right.pattern))
  .map((rule) => ({
    id: rule.id,
    pattern: rule.pattern,
    categoryId: `cat-${rule.categoryName}`,
    categoryName: rule.categoryName,
    priority: rule.priority,
    isActive: true
  }));

const CONTEXT = {
  today: TODAY,
  accounts: ACCOUNTS,
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  categoryNames: CATEGORY_NAMES,
  categoryMatchRules: RULES,
  defaultAccountPriorityIds: [
    "acct-citi-cash-back", "acct-ocbc-365", "acct-uob-prvi", "acct-posb-joint", "acct-ocbc-360", "acct-uob-one"
  ],
  foreignCurrencyAccountId: ""
};

const s = (value) => ({ value, source: "sentence" });
const d = (value) => ({ value, source: "default" });
const r = (value) => ({ value, source: "rule" });

test("Koufu lunch $12.50 yesterday, Citi: every field read from the sentence or a rule, ready to post", () => {
  const draft = parseEntrySentence("Koufu lunch $12.50 yesterday, Citi", CONTEXT);
  assert.deepEqual(draft, {
    fields: {
      date: s("2026-10-10"),
      description: s("Koufu lunch"),
      accountId: s("acct-citi-cash-back"),
      accountName: s("Citi Cash Back Card"),
      categoryName: r("Food & Drinks"),
      amountMinor: s(1250),
      entryType: d("expense"),
      ownershipType: d("direct"),
      ownerName: d("Ethan")
    },
    missing: [],
    questions: [],
    flags: [],
    createBody: {
      date: "2026-10-10",
      description: "Koufu lunch",
      accountId: "acct-citi-cash-back",
      accountName: "Citi Cash Back Card",
      categoryName: "Food & Drinks",
      amountMinor: 1250,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Ethan"
    }
  });
});

test("Dinner $120 at Burnt Ends with Serene, she paid: a shared suggestion paid from Serene's first priority card", () => {
  const draft = parseEntrySentence("Dinner $120 at Burnt Ends with Serene, she paid", CONTEXT);
  assert.deepEqual(draft.fields, {
    date: d(TODAY),
    description: s("Dinner at Burnt Ends"),
    accountId: d("acct-ocbc-365"),
    accountName: d("OCBC 365 Card"),
    categoryName: d("Other"),
    amountMinor: s(12_000),
    entryType: d("expense"),
    ownershipType: s("shared"),
    ownerName: s("Serene"),
    splitBasisPoints: d(5000)
  });
  assert.deepEqual(draft.missing, []);
  assert.deepEqual(draft.questions, []);
  assert.deepEqual(draft.createBody, {
    date: TODAY,
    description: "Dinner at Burnt Ends",
    accountId: "acct-ocbc-365",
    accountName: "OCBC 365 Card",
    categoryName: "Other",
    amountMinor: 12_000,
    entryType: "expense",
    ownershipType: "shared",
    ownerName: "Serene",
    splitBasisPoints: 5000
  });
});

test("Moved $1,500 from OCBC 360 to POSB joint: an outgoing transfer on OCBC 360 naming the other account", () => {
  const draft = parseEntrySentence("Moved $1,500 from OCBC 360 to POSB joint", CONTEXT);
  assert.deepEqual(draft.fields, {
    date: d(TODAY),
    description: d("Transfer to POSB Joint Account"),
    accountId: s("acct-ocbc-360"),
    accountName: s("OCBC 360 Account"),
    categoryName: s("Transfer"),
    amountMinor: s(150_000),
    entryType: s("transfer"),
    transferDirection: s("out"),
    ownershipType: d("direct"),
    ownerName: d("Ethan")
  });
  assert.deepEqual(draft.transferAccount, s({ accountId: "acct-posb-joint", accountName: "POSB Joint Account" }));
  assert.deepEqual(draft.missing, []);
  assert.equal(draft.createBody.transferDirection, "out");
  assert.equal(draft.createBody.entryType, "transfer");
  assert.equal(draft.createBody.categoryName, "Transfer");
});

test("Freelance payment $650 came into OCBC 360 today: income on the named account", () => {
  const draft = parseEntrySentence("Freelance payment $650 came into OCBC 360 today", CONTEXT);
  assert.deepEqual(draft.fields, {
    date: s(TODAY),
    description: s("Freelance payment"),
    accountId: s("acct-ocbc-360"),
    accountName: s("OCBC 360 Account"),
    categoryName: d("Other - Income"),
    amountMinor: s(65_000),
    entryType: s("income"),
    ownershipType: d("direct"),
    ownerName: d("Ethan")
  });
  assert.deepEqual(draft.missing, []);
});

test("Warung babi guling IDR 159,000: the foreign amount is kept and the account amount is asked, on the other-currency card", () => {
  const draft = parseEntrySentence("Warung babi guling IDR 159,000", { ...CONTEXT, foreignCurrencyAccountId: "acct-uob-prvi" });
  assert.deepEqual(draft.fields, {
    date: d(TODAY),
    description: s("Warung babi guling"),
    accountId: d("acct-uob-prvi"),
    accountName: d("UOB PRVI Miles Card"),
    categoryName: d("Other"),
    entryType: d("expense"),
    ownershipType: d("direct"),
    ownerName: d("Serene")
  });
  assert.deepEqual(draft.foreignAmount, { amountMinor: 15_900_000, currency: "IDR", source: "sentence" });
  assert.deepEqual(draft.missing, ["amountMinor"]);
  assert.deepEqual(draft.flags, ["foreign_currency"]);
  assert.deepEqual(draft.questions, [{
    field: "amountMinor",
    reason: "foreign_currency",
    options: [{ amountMinor: 15_900_000, currency: "IDR" }]
  }]);
  assert.equal(draft.createBody, undefined);
});

test("without an other-currency card, a foreign amount follows Default account priority like the Shortcut", () => {
  const draft = parseEntrySentence("Warung babi guling IDR 159k", CONTEXT);
  assert.deepEqual(draft.fields.accountId, d("acct-citi-cash-back"));
  assert.deepEqual(draft.foreignAmount, { amountMinor: 15_900_000, currency: "IDR", source: "sentence" });
});

test("grab 14.20 mon: the most recent past Monday, Taxi by rule, the first priority card by default", () => {
  const draft = parseEntrySentence("grab 14.20 mon", CONTEXT);
  assert.deepEqual(draft.fields, {
    date: s("2026-10-05"),
    description: s("grab"),
    accountId: d("acct-citi-cash-back"),
    accountName: d("Citi Cash Back Card"),
    categoryName: r("Taxi"),
    amountMinor: s(1420),
    entryType: d("expense"),
    ownershipType: d("direct"),
    ownerName: d("Ethan")
  });
});

test("amount and currency forms", () => {
  const cases = [
    ["Cold Storage S$38.60", 3860, "Cold Storage"],
    ["kopi SGD 12.5", 1250, "kopi"],
    ["cab 12 dollars", 1200, "cab"],
    ["Sushi 12.50", 1250, "Sushi"],
    ["2 pax lunch $24", 2400, "2 pax lunch"],
    ["Paid $8 for laksa", 800, "laksa"]
  ];
  for (const [text, amountMinor, description] of cases) {
    const draft = parseEntrySentence(text, CONTEXT);
    assert.deepEqual(draft.fields.amountMinor, s(amountMinor), text);
    assert.deepEqual(draft.fields.description, s(description), text);
    assert.equal(draft.foreignAmount, undefined, text);
  }
});

test("date forms: weekday names are the most recent past one, day-month dates read day first", () => {
  const cases = [
    ["Lunch $5 today", TODAY],
    ["Lunch $5 yesterday", "2026-10-10"],
    ["Lunch $5 sunday", "2026-10-04"],
    ["Lunch $5 on Friday", "2026-10-09"],
    ["Lunch $5 28 Sep", "2026-09-28"],
    ["Lunch $5 Sep 28", "2026-09-28"],
    ["Lunch $5 28/9", "2026-09-28"],
    ["Lunch $5 29/09/26", "2026-09-29"],
    ["Lunch $5 2026-09-30", "2026-09-30"]
  ];
  for (const [text, date] of cases) {
    const draft = parseEntrySentence(text, CONTEXT);
    assert.deepEqual(draft.fields.date, s(date), text);
    assert.deepEqual(draft.fields.amountMinor, s(500), text);
    assert.deepEqual(draft.fields.description, s("Lunch"), text);
    assert.deepEqual(draft.flags, [], text);
  }
});

test("negative: a short weekday form inside a shop name is not a date", () => {
  const draft = parseEntrySentence("Sun Plaza lunch $9", CONTEXT);
  assert.deepEqual(draft.fields.date, d(TODAY));
  assert.deepEqual(draft.fields.description, s("Sun Plaza lunch"));
  const lastFri = parseEntrySentence("Grab to airport $32.40 last fri", CONTEXT);
  assert.deepEqual(lastFri.fields.date, s("2026-10-09"));
  assert.deepEqual(lastFri.fields.description, s("Grab to airport"));
});

test("a future date is kept but flagged and asked about", () => {
  const draft = parseEntrySentence("Taxi $20 on 28 Dec", CONTEXT);
  assert.deepEqual(draft.fields.date, s("2026-12-28"));
  assert.deepEqual(draft.flags, ["future_date"]);
  assert.deepEqual(draft.questions, [{ field: "date", reason: "future", options: [{ date: "2026-12-28" }] }]);
});

test("an impossible date is not guessed: the date is asked", () => {
  const draft = parseEntrySentence("Taxi $20 on 31/2", CONTEXT);
  assert.equal(draft.fields.date, undefined);
  assert.deepEqual(draft.missing, ["date"]);
  assert.deepEqual(draft.flags, ["invalid_date"]);
  assert.deepEqual(draft.questions, [{ field: "date", reason: "invalid", options: [] }]);
  assert.equal(draft.createBody, undefined);
});

test("two different dates are not guessed: both are offered", () => {
  const draft = parseEntrySentence("Taxi $20 yesterday 28/9", CONTEXT);
  assert.equal(draft.fields.date, undefined);
  assert.deepEqual(draft.missing, ["date"]);
  assert.deepEqual(draft.questions, [{ field: "date", reason: "conflicting", options: [{ date: "2026-10-10" }, { date: "2026-09-28" }] }]);
});

test("Salary $5,000 got paid into UOB One: income, owner from the account", () => {
  const draft = parseEntrySentence("Salary $5,000 got paid into UOB One", CONTEXT);
  assert.deepEqual(draft.fields.entryType, s("income"));
  assert.deepEqual(draft.fields.description, s("Salary"));
  assert.deepEqual(draft.fields.accountId, s("acct-uob-one"));
  assert.deepEqual(draft.fields.ownerName, d("Serene"));
  assert.deepEqual(draft.fields.amountMinor, s(500_000));
});

test("income with no account named goes to the first bank account in Default account priority", () => {
  const draft = parseEntrySentence("Bonus $800 came in", CONTEXT);
  assert.deepEqual(draft.fields.entryType, s("income"));
  assert.deepEqual(draft.fields.accountId, d("acct-posb-joint"));
  assert.deepEqual(draft.fields.description, s("Bonus"));
});

test("owner words: mine is the viewer, a person's name is the owner", () => {
  const mine = parseEntrySentence("Haircut $25 mine", { ...CONTEXT, viewerName: "Serene" });
  assert.deepEqual(mine.fields.ownerName, s("Serene"));
  assert.deepEqual(mine.fields.description, s("Haircut"));
  assert.deepEqual(mine.fields.ownershipType, d("direct"));

  const forSerene = parseEntrySentence("Haircut $25 for Serene", CONTEXT);
  assert.deepEqual(forSerene.fields.ownerName, s("Serene"));
  assert.deepEqual(forSerene.fields.description, s("Haircut"));
});

test("an even split in words is read from the sentence", () => {
  const draft = parseEntrySentence("Groceries $80 split 50/50 with Serene", CONTEXT);
  assert.deepEqual(draft.fields.ownershipType, s("shared"));
  assert.deepEqual(draft.fields.splitBasisPoints, s(5000));
  assert.deepEqual(draft.fields.ownerName, d("Ethan"));
  assert.deepEqual(draft.fields.description, s("Groceries"));
});

test("an uneven split is not guessed: who takes the larger share is asked", () => {
  const draft = parseEntrySentence("Groceries $80 split 70/30 with Serene", CONTEXT);
  assert.deepEqual(draft.fields.ownershipType, s("shared"));
  assert.equal(draft.fields.splitBasisPoints, undefined);
  assert.deepEqual(draft.missing, ["splitBasisPoints"]);
  assert.deepEqual(draft.questions, [{
    field: "splitBasisPoints",
    reason: "uneven_split",
    options: [{ personName: "Ethan", splitBasisPoints: 7000 }, { personName: "Serene", splitBasisPoints: 3000 }]
  }]);
  assert.equal(draft.createBody, undefined);
});

test("she paid with no one named is not guessed: the payer is asked", () => {
  const draft = parseEntrySentence("Lunch $30 split, she paid", CONTEXT);
  assert.deepEqual(draft.fields.ownershipType, s("shared"));
  assert.equal(draft.fields.ownerName, undefined);
  assert.deepEqual(draft.missing, ["ownerName"]);
  assert.deepEqual(draft.questions, [{
    field: "ownerName",
    reason: "unclear_payer",
    options: [{ personName: "Ethan" }, { personName: "Serene" }]
  }]);
});

test("negative: no amount leaves the amount missing and asks for it", () => {
  const draft = parseEntrySentence("Lunch at Koufu", CONTEXT);
  assert.equal(draft.fields.amountMinor, undefined);
  assert.deepEqual(draft.fields.description, s("Lunch at Koufu"));
  assert.deepEqual(draft.fields.categoryName, r("Food & Drinks"));
  assert.deepEqual(draft.missing, ["amountMinor"]);
  assert.deepEqual(draft.questions, [{ field: "amountMinor", reason: "missing", options: [] }]);
  assert.deepEqual(draft.flags, []);
  assert.equal(draft.createBody, undefined);
  assert.equal(entryDraftWantsAi(draft), true);
});

test("negative: two different amounts are flagged and both offered, never one picked", () => {
  const draft = parseEntrySentence("Lunch $12 or $15", CONTEXT);
  assert.equal(draft.fields.amountMinor, undefined);
  assert.deepEqual(draft.fields.description, s("Lunch"));
  assert.deepEqual(draft.flags, ["conflicting_amounts"]);
  assert.deepEqual(draft.questions, [{
    field: "amountMinor",
    reason: "conflicting",
    options: [{ amountMinor: 1200 }, { amountMinor: 1500 }]
  }]);
  assert.equal(entryDraftWantsAi(draft), false, "AI must not settle a conflict the sentence created");
});

test("negative: an ambiguous wallet is not guessed: the candidates are listed", () => {
  const draft = parseEntrySentence("Lunch $10 on UOB", CONTEXT);
  assert.equal(draft.fields.accountId, undefined);
  assert.equal(draft.fields.accountName, undefined);
  assert.deepEqual(draft.fields.description, s("Lunch"));
  assert.deepEqual(draft.missing, ["accountId"]);
  assert.deepEqual(draft.flags, ["ambiguous_account"]);
  assert.deepEqual(draft.questions, [{
    field: "accountId",
    reason: "ambiguous",
    options: [
      { accountId: "acct-uob-one", accountName: "UOB One Account" },
      { accountId: "acct-uob-prvi", accountName: "UOB PRVI Miles Card" }
    ]
  }]);
});

test("negative: an inactive account is never matched", () => {
  const draft = parseEntrySentence("Lunch $10 on DBS Altitude", CONTEXT);
  assert.notEqual(draft.fields.accountId?.value, "acct-old-dbs");
});

test("negative: naming an inactive card does not fall through to another account of the same bank", () => {
  // DBS Altitude is inactive; POSB Joint shares the DBS bank family but is not what was named.
  const draft = parseEntrySentence("Lunch $10 on DBS Altitude", CONTEXT);
  assert.equal(draft.fields.accountId, undefined);
  assert.equal(draft.fields.accountName, undefined);
  assert.deepEqual(draft.fields.description, s("Lunch"));
  assert.deepEqual(draft.missing, ["accountId"]);
  assert.deepEqual(draft.questions, [{ field: "accountId", reason: "invalid", options: [] }]);
  assert.deepEqual(draft.flags, []);
  assert.equal(draft.createBody, undefined);

  // Leaving from an inactive card: the source is asked, never POSB Joint.
  const transfer = parseEntrySentence("Moved $100 from DBS Altitude to OCBC 360", CONTEXT);
  assert.deepEqual(transfer.fields.entryType, s("transfer"));
  assert.equal(transfer.fields.accountId, undefined);
  assert.deepEqual(transfer.transferAccount, s({ accountId: "acct-ocbc-360", accountName: "OCBC 360 Account" }));
  assert.deepEqual(transfer.questions, [{ field: "accountId", reason: "invalid", options: [] }]);

  // Going to an inactive card: no destination is guessed.
  const toInactive = parseEntrySentence("Moved $100 from OCBC 360 to DBS Altitude", CONTEXT);
  assert.deepEqual(toInactive.fields.accountId, s("acct-ocbc-360"));
  assert.equal(toInactive.transferAccount, undefined);
  assert.deepEqual(toInactive.fields.description, d("Transfer"));

  // An inactive card beside an active one: the active one is offered, not picked, and POSB Joint is not.
  const bill = parseEntrySentence("Paid DBS Altitude bill $500 from OCBC 360", CONTEXT);
  assert.equal(bill.fields.accountId, undefined);
  assert.deepEqual(bill.questions, [{
    field: "accountId",
    reason: "invalid",
    options: [{ accountId: "acct-ocbc-360", accountName: "OCBC 360 Account" }]
  }]);
});

test("the bank alone still finds its one active account, and two named cards are still asked", () => {
  const dbs = parseEntrySentence("Lunch $10 on DBS", CONTEXT);
  assert.deepEqual(dbs.fields.accountId, s("acct-posb-joint"));
  assert.deepEqual(dbs.questions, []);

  const bill = parseEntrySentence("Paid OCBC 365 bill $500 from OCBC 360", CONTEXT);
  assert.equal(bill.fields.accountId, undefined);
  assert.deepEqual(bill.flags, ["ambiguous_account"]);
  assert.deepEqual(bill.questions, [{
    field: "accountId",
    reason: "ambiguous",
    options: [
      { accountId: "acct-ocbc-360", accountName: "OCBC 360 Account" },
      { accountId: "acct-ocbc-365", accountName: "OCBC 365 Card" }
    ]
  }]);
});

test("negative: an unknown currency symbol is flagged, not read as dollars", () => {
  const draft = parseEntrySentence("Lunch ₹500", CONTEXT);
  assert.equal(draft.fields.amountMinor, undefined);
  assert.equal(draft.foreignAmount, undefined);
  assert.deepEqual(draft.flags, ["unknown_currency"]);
  assert.deepEqual(draft.questions, [{ field: "amountMinor", reason: "unknown_currency", options: [] }]);
});

test("negative: empty text gives an empty draft that asks for an amount and a description", () => {
  for (const text of ["", "   ", null, undefined, 42]) {
    const draft = parseEntrySentence(text, CONTEXT);
    assert.deepEqual(draft.flags, ["empty_text"]);
    assert.deepEqual(draft.missing, ["description", "amountMinor"]);
    assert.equal(draft.createBody, undefined);
    assert.equal(entryDraftWantsAi(draft), false, "nothing to send to AI");
  }
});

test("negative: very long text is truncated before parsing", () => {
  const draft = parseEntrySentence(`Koufu lunch $12.50 ${"very ".repeat(300)}long`, CONTEXT);
  assert.ok(draft.flags.includes("truncated"));
  assert.deepEqual(draft.fields.amountMinor, s(1250));
  assert.ok(draft.fields.description.value.length <= ENTRY_DRAFT_TEXT_MAX_LENGTH);
  assert.ok(draft.fields.description.value.startsWith("Koufu lunch"));
});

test("a transfer with only a destination asks which account the money left", () => {
  const draft = parseEntrySentence("Transferred $200 to POSB joint", CONTEXT);
  assert.deepEqual(draft.fields.entryType, s("transfer"));
  assert.equal(draft.fields.accountId, undefined);
  assert.deepEqual(draft.missing, ["accountId"]);
  assert.equal(draft.questions[0].field, "accountId");
  assert.equal(draft.questions[0].reason, "transfer_from");
  assert.equal(draft.questions[0].options.some((option) => option.accountId === "acct-posb-joint"), false);
});

test("the create body uses only fields the create route accepts and only when nothing is missing", () => {
  const accepted = new Set([
    "date", "postDate", "description", "accountId", "accountName", "categoryName", "amountMinor",
    "entryType", "transferDirection", "ownershipType", "ownerName", "offsetsCategory", "note", "splitBasisPoints"
  ]);
  for (const text of ["Koufu lunch $12.50 yesterday, Citi", "Dinner $120 at Burnt Ends with Serene, she paid", "Moved $1,500 from OCBC 360 to POSB joint"]) {
    const body = parseEntrySentence(text, CONTEXT).createBody;
    assert.ok(body, text);
    for (const key of Object.keys(body)) {
      assert.ok(accepted.has(key), `${text}: ${key}`);
    }
    for (const key of ["date", "description", "accountId", "categoryName", "amountMinor", "entryType", "ownershipType"]) {
      assert.notEqual(body[key], undefined, `${text}: ${key}`);
    }
  }
});

test("AI suggestion: deterministic values always win; AI fills only what is missing and is marked ai", () => {
  const kept = parseEntrySentence("Koufu lunch $12.50", CONTEXT, { amountMinor: 9_999, description: "Something else" });
  assert.deepEqual(kept.fields.amountMinor, s(1250));
  assert.deepEqual(kept.fields.description, s("Koufu lunch"));

  const filled = parseEntrySentence("Koufu lunch twelve fifty", CONTEXT, { amountMinor: 1250 });
  assert.deepEqual(filled.fields.amountMinor, { value: 1250, source: "ai" });
  assert.deepEqual(filled.missing, []);
  assert.equal(filled.createBody.amountMinor, 1250);

  const conflict = parseEntrySentence("Lunch $12 or $15", CONTEXT, { amountMinor: 1200 });
  assert.equal(conflict.fields.amountMinor, undefined, "AI never settles a conflicting amount");
});

test("AI amount from number words: the words that made up the amount leave the description, other words stay", () => {
  const filled = parseEntrySentence("Koufu lunch twelve fifty", CONTEXT, { amountMinor: 1250 });
  assert.deepEqual(filled.fields.description, s("Koufu lunch"));
  assert.equal(filled.createBody.description, "Koufu lunch");
  assert.deepEqual(filled.fields.categoryName, r("Food & Drinks"));

  const cases = [
    ["Grab twenty dollars yesterday", 2000, "Grab"],
    ["kopi two fifty at Tiong Bahru", 250, "kopi at Tiong Bahru"],
    ["one hundred and twenty for aircon servicing", 12_000, "aircon servicing"],
    ["Seven Eleven snacks three twenty", 320, "Seven Eleven snacks"]
  ];
  for (const [text, amountMinor, description] of cases) {
    const draft = parseEntrySentence(text, CONTEXT, { amountMinor });
    assert.deepEqual(draft.fields.amountMinor, { value: amountMinor, source: "ai" }, text);
    assert.deepEqual(draft.fields.description, s(description), text);
  }
});

test("negative: number words that are not the AI amount stay in the description", () => {
  // "Seven Eleven" names the shop; the amount "$3.20" was AI's reading of other words.
  const kept = parseEntrySentence("Seven Eleven snacks three twenty", CONTEXT, { amountMinor: 320 });
  assert.ok(kept.fields.description.value.startsWith("Seven Eleven"));
  // Without an AI amount nothing is removed: the words are the description.
  const noAi = parseEntrySentence("Koufu lunch twelve fifty", CONTEXT);
  assert.deepEqual(noAi.fields.description, s("Koufu lunch twelve fifty"));
  // An AI amount the number words do not spell leaves them in place.
  const mismatch = parseEntrySentence("Koufu lunch twelve fifty", CONTEXT, { amountMinor: 999 });
  assert.deepEqual(mismatch.fields.description, s("Koufu lunch twelve fifty"));
});

test("AI suggestion validation: amounts and words must come from the sentence", () => {
  assert.deepEqual(parseEntryDraftAiSuggestion({ amount: "12.50", description: "lunch" }, "lunch twelve fifty"), { amountMinor: 1250, description: "lunch" });
  assert.deepEqual(parseEntryDraftAiSuggestion({ amount: 7, description: null }, "kopi 7"), { amountMinor: 700 });
  // An amount the sentence never states (no matching digits, no number words) is refused.
  assert.equal(parseEntryDraftAiSuggestion({ amount: "45.00", description: null }, "kopi 7"), null);
  // A description with words that are not in the sentence is refused.
  assert.equal(parseEntryDraftAiSuggestion({ amount: null, description: "Starbucks coffee" }, "kopi twelve fifty"), null);
  // Malformed shapes are refused.
  for (const value of [null, "12.50", [], { amount: -5 }, { amount: "1.234" }, { amount: "abc" }, { description: 12 }]) {
    assert.equal(parseEntryDraftAiSuggestion(value, "kopi twelve"), null, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// Payment ways (DOMAIN.md "Payment Way"): a payment word ("paynow", "NETS",
// "cash") with no account named picks the owner's account from Settings ->
// Payment ways, marked "rule". With no setting for that person and that way,
// the draft keeps today's Default account priority; it never borrows another
// person's payment way.

const CASH_WALLET = account("acct-ethan-cash", "Cash", "Ethan's Wallet", "cash", "Ethan");
const PAYMENT_WAYS = [
  { personId: "person-ethan", bankTransferAccountId: "acct-ocbc-360", cashAccountId: "acct-ethan-cash" },
  { personId: "person-serene", bankTransferAccountId: "acct-uob-one", cashAccountId: "" }
];
const PAY_CONTEXT = { ...CONTEXT, accounts: [...ACCOUNTS, CASH_WALLET], paymentWays: PAYMENT_WAYS, viewerName: "Ethan" };

test("lunch at nasi lemak bmv 7.20, paynow, mine: the viewer's PayNow account by rule, the payment word left out", () => {
  const draft = parseEntrySentence("lunch at nasi lemak bmv 7.20, paynow, mine", PAY_CONTEXT);
  assert.deepEqual(draft.fields, {
    date: d(TODAY),
    description: s("lunch at nasi lemak bmv"),
    accountId: r("acct-ocbc-360"),
    accountName: r("OCBC 360 Account"),
    categoryName: r("Food & Drinks"),
    amountMinor: s(720),
    entryType: d("expense"),
    ownershipType: d("direct"),
    ownerName: s("Ethan")
  });
  assert.deepEqual(draft.missing, []);
  assert.deepEqual(draft.questions, []);
  assert.deepEqual(draft.flags, []);
  assert.deepEqual(draft.createBody, {
    date: TODAY,
    description: "lunch at nasi lemak bmv",
    accountId: "acct-ocbc-360",
    accountName: "OCBC 360 Account",
    categoryName: "Food & Drinks",
    amountMinor: 720,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Ethan"
  });

  // The same sentence in Serene's view is Serene's PayNow account.
  const serene = parseEntrySentence("lunch at nasi lemak bmv 7.20, paynow, mine", { ...PAY_CONTEXT, viewerName: "Serene" });
  assert.deepEqual(serene.fields.accountId, r("acct-uob-one"));
  assert.deepEqual(serene.fields.ownerName, s("Serene"));
});

test("PayNow spellings and bank words all mean the PayNow and bank transfers account", () => {
  for (const text of [
    "kopi 2.40 PayNow",
    "kopi 2.40 pay now",
    "kopi 2.40 paid by paynow",
    "kopi 2.40 via FAST",
    "kopi 2.40 bank transfer",
    "kopi 2.40 GIRO",
    "kopi 2.40 NETS",
    "kopi 2.40 paid with nets"
  ]) {
    const draft = parseEntrySentence(text, PAY_CONTEXT);
    assert.deepEqual(draft.fields.accountId, r("acct-ocbc-360"), text);
    assert.deepEqual(draft.fields.description, s("kopi"), text);
    assert.deepEqual(draft.fields.entryType, d("expense"), `${text}: a bank transfer word is how it was paid, not a transfer`);
    assert.deepEqual(draft.fields.ownerName, d("Ethan"), text);
  }
});

test("taxi 15 cash: the cash wallet when one is set, else Default account priority, and cash leaves the description", () => {
  const withWallet = parseEntrySentence("taxi 15 cash", PAY_CONTEXT);
  assert.deepEqual(withWallet.fields, {
    date: d(TODAY),
    description: s("taxi"),
    accountId: r("acct-ethan-cash"),
    accountName: r("Ethan's Wallet"),
    categoryName: d("Other"),
    amountMinor: s(1500),
    entryType: d("expense"),
    ownershipType: d("direct"),
    ownerName: d("Ethan")
  });
  assert.equal(withWallet.createBody.accountId, "acct-ethan-cash");

  const withoutWallet = parseEntrySentence("taxi 15 cash", { ...PAY_CONTEXT, viewerName: "Serene" });
  assert.deepEqual(withoutWallet.fields.accountId, d("acct-citi-cash-back"));
  assert.deepEqual(withoutWallet.fields.description, s("taxi"));
  assert.deepEqual(withoutWallet.fields.amountMinor, s(1500));

  const paidInCash = parseEntrySentence("paid in cash for taxi $15", PAY_CONTEXT);
  assert.deepEqual(paidInCash.fields.accountId, r("acct-ethan-cash"));
  assert.deepEqual(paidInCash.fields.description, s("taxi"));
});

test("Serene paid by paynow: Serene's PayNow account, for a direct and a shared entry", () => {
  const direct = parseEntrySentence("chicken rice 6.50 Serene paid by paynow", PAY_CONTEXT);
  assert.deepEqual(direct.fields.accountId, r("acct-uob-one"));
  assert.deepEqual(direct.fields.accountName, r("UOB One Account"));
  assert.deepEqual(direct.fields.ownerName, s("Serene"));
  assert.deepEqual(direct.fields.description, s("chicken rice"));
  assert.deepEqual(direct.fields.ownershipType, d("direct"));

  const shared = parseEntrySentence("Dinner $120 at Burnt Ends with Serene, she paid by paynow", PAY_CONTEXT);
  assert.deepEqual(shared.fields.accountId, r("acct-uob-one"));
  assert.deepEqual(shared.fields.ownerName, s("Serene"));
  assert.deepEqual(shared.fields.ownershipType, s("shared"));
  assert.deepEqual(shared.fields.splitBasisPoints, d(5000));
  assert.deepEqual(shared.fields.description, s("Dinner at Burnt Ends"));
  assert.deepEqual(shared.missing, []);
});

test("with no viewer the owner of the default account is whose payment way applies", () => {
  const draft = parseEntrySentence("kopi 2.40 paynow", { ...PAY_CONTEXT, viewerName: undefined });
  // Default account priority starts on Ethan's Citi card, so it is Ethan's PayNow.
  assert.deepEqual(draft.fields.accountId, r("acct-ocbc-360"));
  assert.deepEqual(draft.fields.ownerName, d("Ethan"));
});

test("negative: an empty payment way falls back to Default account priority and never borrows another person's", () => {
  const emptyWay = parseEntrySentence("lunch 7.20 paynow mine", {
    ...PAY_CONTEXT,
    paymentWays: [{ personId: "person-ethan", bankTransferAccountId: "", cashAccountId: "" }, PAYMENT_WAYS[1]]
  });
  assert.deepEqual(emptyWay.fields.accountId, d("acct-citi-cash-back"));
  assert.deepEqual(emptyWay.fields.description, s("lunch"));
  assert.deepEqual(emptyWay.fields.ownerName, s("Ethan"));

  const noSetting = parseEntrySentence("lunch 7.20 paynow mine", { ...CONTEXT, viewerName: "Ethan" });
  assert.deepEqual(noSetting.fields.accountId, d("acct-citi-cash-back"));
  assert.deepEqual(noSetting.fields.description, s("lunch"));

  // Only Ethan has a payment way: Serene's PayNow is not guessed as his.
  const onlyEthan = parseEntrySentence("chicken rice 6.50 Serene paid by paynow", { ...PAY_CONTEXT, paymentWays: [PAYMENT_WAYS[0]] });
  assert.notEqual(onlyEthan.fields.accountId.value, "acct-ocbc-360");
  assert.deepEqual(onlyEthan.fields.accountId, d("acct-citi-cash-back"));
  assert.deepEqual(onlyEthan.fields.ownerName, s("Serene"));
});

test("negative: a named account wins over the payment way, and two payment ways are not guessed", () => {
  const named = parseEntrySentence("kopi 2.40 paynow from POSB joint", PAY_CONTEXT);
  assert.deepEqual(named.fields.accountId, s("acct-posb-joint"));
  assert.deepEqual(named.fields.description, s("kopi"));

  const both = parseEntrySentence("kopi 2.40 paid in cash and by paynow", PAY_CONTEXT);
  assert.deepEqual(both.fields.description, s("kopi"));
  assert.deepEqual(both.fields.accountId, d("acct-citi-cash-back"));

  const transfer = parseEntrySentence("Moved $500 from OCBC 360 to POSB joint via FAST", PAY_CONTEXT);
  assert.deepEqual(transfer.fields.entryType, s("transfer"));
  assert.deepEqual(transfer.fields.accountId, s("acct-ocbc-360"));
  assert.deepEqual(transfer.fields.description, d("Transfer to POSB Joint Account"));
});

test("negative: ordinary words that look like payment words stay in the description", () => {
  const fastFood = parseEntrySentence("fast food 8", PAY_CONTEXT);
  assert.deepEqual(fastFood.fields.description, s("fast food"));
  assert.deepEqual(fastFood.fields.accountId, d("acct-citi-cash-back"));

  const nets = parseEntrySentence("badminton nets $20", PAY_CONTEXT);
  assert.deepEqual(nets.fields.description, s("badminton nets"));
  assert.deepEqual(nets.fields.accountId, d("acct-citi-cash-back"));

  const cashBack = parseEntrySentence("lunch 12 citi cash back", PAY_CONTEXT);
  assert.deepEqual(cashBack.fields.accountId, s("acct-citi-cash-back"));
  assert.deepEqual(cashBack.fields.description, s("lunch"));

  // A wallet whose name does not say "cash", so only the payment word could
  // take the word: mid-sentence it does not.
  const purse = { ...CASH_WALLET, institution: "Pocket", name: "Ethan's Purse" };
  const withdrawal = parseEntrySentence("cash withdrawal 100", { ...PAY_CONTEXT, accounts: [...ACCOUNTS, purse] });
  assert.deepEqual(withdrawal.fields.description, s("cash withdrawal"));
  assert.deepEqual(withdrawal.fields.accountId, d("acct-citi-cash-back"));
});
