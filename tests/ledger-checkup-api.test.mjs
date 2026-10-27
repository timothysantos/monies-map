// The Ledger check-up through the real Worker and a real local D1 (docs/audits/
// ledger-checkup.md): each detector finds its seeded problem with the evidence a
// person needs and stays silent on the adversarial lookalikes, the report is
// read-only, a person's view and the household's agree on the scope, and
// "This is fine" holds until the evidence changes. Dates are relative to today.
import assert from "node:assert/strict";
import test from "node:test";

import { loadAccounts } from "../src/domain/app-repository-settings.ts";
import { buildLedgerCheckupDto } from "../src/domain/pages/ledger-checkup.ts";
import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase
} from "./support/d1-workspace.mjs";
import {
  ONE_CARD_FILE,
  LADYS_FILE,
  commitFile,
  createCards,
  previewFile,
  saveApplePayEntries
} from "./support/wrong-card-scenario.mjs";
import {
  JOYCE_CARD,
  SAVINGS,
  TIM_CARD,
  TODAY,
  categoryId,
  daysAgo,
  insertAccount,
  insertEntry,
  insertGroup,
  insertImport,
  insertImportRow,
  insertPlanRow,
  insertSettlementCheckpoint,
  insertSplitExpense,
  seedStatementMonths
} from "./support/ledger-checkup-seed.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function checkup(workspace, query = "") {
  const { status, payload } = await workspace.api(`/api/ledger-checkup${query}`);
  assert.equal(status, 200, JSON.stringify(payload).slice(0, 400));
  return payload;
}
const ofKind = (payload, kind) => payload.findings.filter((item) => item.kind === kind);

test("the report is read-only, ordered, and carries the whole finding model", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const groupId = await insertGroup(workspace.db);
  await insertSplitExpense(workspace.db, { groupId, date: daysAgo(30), amountMinor: 8000, description: "Dinner", linkedTransactionId: null });
  // The first request after rows are inserted behind the app's back runs its
  // own start-up repairs (a split batch for each new split); the report is
  // read-only from there on.
  await checkup(workspace);
  const before = await dumpDatabase(workspace.db);
  const payload = await checkup(workspace);
  assertSameDatabase(await dumpDatabase(workspace.db), before);

  assert.equal(payload.ok, true);
  assert.match(payload.generatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(Object.keys(payload.tierCounts).sort(), ["check", "high", "note"]);
  assert.deepEqual(payload.unavailableKinds, []);
  assert.deepEqual(payload.moreByKind, {});
  assert.equal(payload.dismissedCount, 0);
  for (const item of payload.findings) {
    assert.deepEqual(Object.keys(item).sort(), ["amountMinor", "currency", "dismissed", "evidence", "evidenceKey", "fix", "fixNote", "id", "kind", "occurredOn", "personIds", "summary", "tier", "title"]);
    assert.ok(item.fix || item.fixNote);
  }
  const tierRank = { high: 0, check: 1, note: 2 };
  const ranks = payload.findings.map((item) => tierRank[item.tier]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "needs fixing first, then worth checking, then good to know");
  assert.equal(payload.tierCounts.high + payload.tierCounts.check + payload.tierCounts.note, payload.findings.length);
});

test("duplicate ledger entries: the same bank row loaded twice is found; a bank's own repeat, certified, rolled-back and three-way rows are not", async (t) => {
  const { db, ...workspace } = await openSeededDatabase(t, template);
  const api = { db, ...workspace };
  const [importA, importB, rolledBack] = [await insertImport(db), await insertImport(db), await insertImport(db, { status: "rolled_back" })];
  const date = daysAgo(10);
  const pairAt = async (amountMinor, { first, second, hashes = ["h", "h"], certified = false }) => {
    const rowA = await insertImportRow(db, { importId: first, hash: `${amountMinor}-${hashes[0]}` });
    const rowB = await insertImportRow(db, { importId: second, hash: `${amountMinor}-${hashes[1]}`, index: 2 });
    return [
      await insertEntry(db, { date, amountMinor, description: `KOPITIAM CORNER ${amountMinor}`, importId: first, importRowId: rowA, certified }),
      await insertEntry(db, { date, amountMinor, description: `KOPITIAM CORNER ${amountMinor}`, importId: second, importRowId: rowB, certified })
    ];
  };
  const [reloadedA, reloadedB] = await pairAt(650, { first: importA, second: importB });
  await pairAt(700, { first: importA, second: importA });
  await pairAt(800, { first: importA, second: importB, certified: true });
  await pairAt(900, { first: importA, second: rolledBack });
  const [softA, softB] = await pairAt(1100, { first: importA, second: importB, hashes: ["x", "y"] });
  // Three copies of one charge: a series, never a pair.
  for (const id of [importA, importB, importA]) await insertEntry(db, { date, amountMinor: 1000, description: "KOPITIAM CORNER 1000", importId: id });
  // The same words and amount on another day or account.
  await insertEntry(db, { date: daysAgo(11), amountMinor: 650, description: "KOPITIAM CORNER 650", importId: importB });
  await insertEntry(db, { date, amountMinor: 650, description: "KOPITIAM CORNER 650", importId: importB, account: JOYCE_CARD });

  const payload = await checkup(api);
  const found = Object.fromEntries(ofKind(payload, "duplicate_entry").map((item) => [item.amountMinor, item]));
  assert.deepEqual(Object.keys(found).sort(), ["1100", "650"]);
  assert.equal(found[650].tier, "high");
  assert.equal(found[650].id, `duplicate_entry:${[reloadedA, reloadedB].sort().join("+")}`);
  assert.equal(found[650].evidence.length, 2);
  assert.match(found[650].summary, /is on UOB Savings twice and both came from the same line of the bank's file/);
  assert.deepEqual(found[650].personIds, ["person-tim"]);
  assert.equal(found[1100].tier, "check", "two imports but different row hashes");
  assert.ok(softA && softB);
});

test("duplicate split and settled-period error: the flight entered twice, inside and outside a settle-up", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const group = await insertGroup(db);
  const flightEntry = await insertEntry(db, { account: TIM_CARD, date: daysAgo(90), amountMinor: 105_184, description: "SINGAPORE AIRLINES SINGAPORE SG" });
  // The Okaeri shape: typed by hand and added again from the bank row, both inside a settle-up.
  const manual = await insertSplitExpense(db, { groupId: group, date: daysAgo(90), amountMinor: 105_184, description: "Flights to Okaeri" });
  const linked = await insertSplitExpense(db, { groupId: group, date: daysAgo(90), amountMinor: 105_184, description: "SINGAPORE AIRLINES SINGAPORE SG", linkedTransactionId: flightEntry });
  await insertSettlementCheckpoint(db, { date: daysAgo(60), recordIds: [manual, linked] });
  // A third copy that was deleted does not make it a series.
  await insertSplitExpense(db, { groupId: group, date: daysAgo(90), amountMinor: 105_184, description: "Flights", deletedAt: `${TODAY}T00:00:00Z` });
  // The same shape, still open, in another group: an ordinary duplicate.
  const openGroup = await insertGroup(db, { name: "Kitchen" });
  const openEntry = await insertEntry(db, { account: TIM_CARD, date: daysAgo(5), amountMinor: 24_000, description: "COURTS SINGAPORE SG" });
  const openManual = await insertSplitExpense(db, { groupId: openGroup, date: daysAgo(5), amountMinor: 24_000, description: "Courts blender" });
  const openLinked = await insertSplitExpense(db, { groupId: openGroup, date: daysAgo(5), amountMinor: 24_000, description: "COURTS SINGAPORE SG", linkedTransactionId: openEntry });
  // Two real dinners, each matched to its own bank row: never a finding.
  const dinnerGroup = await insertGroup(db, { name: "Dinners" });
  for (const name of ["one", "two"]) {
    const bankRow = await insertEntry(db, { account: TIM_CARD, date: daysAgo(8), amountMinor: 6_400, description: `SUSHI TEI ${name}` });
    await insertSplitExpense(db, { groupId: dinnerGroup, date: daysAgo(8), amountMinor: 6_400, description: "Sushi Tei dinner", linkedTransactionId: bankRow });
  }

  const payload = await checkup(workspace);
  const settled = ofKind(payload, "settled_period_error");
  assert.equal(settled.length, 1);
  assert.equal(settled[0].tier, "high");
  assert.equal(settled[0].id, `settled_period_error:${[manual, linked].sort().join("+")}`);
  assert.equal(settled[0].amountMinor, 52_592);
  assert.match(settled[0].summary, /Joyce was charged \$525\.92 too much/);
  assert.equal(settled[0].fix, null);
  assert.match(settled[0].fixNote, /No fix yet/);

  const open = ofKind(payload, "duplicate_split");
  assert.deepEqual(open.map((item) => item.id), [`duplicate_split:${[openManual, openLinked].sort().join("+")}`]);
  assert.equal(open[0].tier, "high");
  assert.equal(open[0].fix.path, `/splits?view=household&month=${daysAgo(5).slice(0, 7)}&split_group=${openGroup}`);
});

test("settled period: the production shape, a duplicate copy deleted after the settle-up already counted it, is found with the person it overcharged", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const group = await insertGroup(db);
  const flight = await insertEntry(db, { account: TIM_CARD, date: daysAgo(120), amountMinor: 105_185, description: "SINGAPORE AIRLINES SINGAPORE SG" });
  const typedCopy = await insertSplitExpense(db, { groupId: group, date: daysAgo(120), amountMinor: 105_185, description: "Flights to Okaeri", shares: [["person-tim", 52_592], ["person-joyce", 52_593]], deletedAt: `${daysAgo(5)} 08:11:33` });
  const kept = await insertSplitExpense(db, { groupId: group, date: daysAgo(120), amountMinor: 105_185, description: "SINGAPORE AIRLINES SINGAPORE SG", linkedTransactionId: flight, shares: [["person-tim", 52_593], ["person-joyce", 52_592]] });
  // The settle-up that was made while both existed, matched to Joyce's payment; an earlier attempt was reopened.
  const settle = await insertSettlementCheckpoint(db, { date: daysAgo(60), recordIds: [typedCopy, kept] });
  await insertSettlementCheckpoint(db, { date: daysAgo(60), status: "reopened", recordIds: [typedCopy, kept] });

  const payload = await checkup(workspace);
  const found = ofKind(payload, "settled_period_error");
  assert.equal(found.length, 1);
  assert.equal(found[0].id, `settled_period_error:deleted:${typedCopy}`);
  assert.equal(found[0].tier, "high");
  assert.equal(found[0].amountMinor, 52_593);
  assert.match(found[0].summary, /was in Splits twice\. The extra copy was removed on .*, but the .* settle-up had already counted both\. Joyce was charged \$525\.93 too much\./);
  assert.deepEqual(found[0].personIds, ["person-joyce", "person-tim"]);
  assert.equal(found[0].fix, null);
  assert.deepEqual(ofKind(payload, "duplicate_split"), [], "the kept copy alone is not a duplicate");

  // Reopening the settle-up releases the record: nothing is counted any more.
  await db.prepare("UPDATE split_settlement_checkpoints SET status = 'reopened' WHERE id = ?").bind(settle).run();
  assert.deepEqual(ofKind(await checkup(workspace), "settled_period_error"), []);
});

test("unmatched transfers: a clear pair, the same money filed as spending, fourteen with no partner as one note, and the ones that are not problems", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const date = daysAgo(30);
  // A clear pair that was never linked.
  const out = await insertEntry(db, { account: SAVINGS, date, amountMinor: 123_400, type: "transfer", direction: "out", description: "TRANSFER TO JOYCE" });
  const incoming = await insertEntry(db, { account: JOYCE_CARD, date: daysAgo(29), amountMinor: 123_400, type: "transfer", direction: "in", description: "TRANSFER FROM TIM" });
  // Same money, the other side filed as an expense.
  const outTwo = await insertEntry(db, { account: SAVINGS, date, amountMinor: 77_700, type: "transfer", direction: "out", description: "TRANSFER 2" });
  const incomeSide = await insertEntry(db, { account: JOYCE_CARD, date: daysAgo(28), amountMinor: 77_700, type: "income", description: "SOMETHING IN" });
  // A purchase of a round amount next to a transfer is a coincidence, not its other side.
  await insertEntry(db, { account: TIM_CARD, date: daysAgo(29), amountMinor: 66_600, type: "expense", description: "A PURCHASE" });
  const coincidence = await insertEntry(db, { account: SAVINGS, date: daysAgo(30), amountMinor: 66_600, type: "transfer", direction: "out", description: "TRANSFER 3" });
  // Fourteen monthly $450 transfers with no counterpart.
  const monthly = [];
  for (let month = 0; month < 14; month += 1) {
    monthly.push(await insertEntry(db, { account: SAVINGS, date: daysAgo(40 + month * 28), amountMinor: 45_000, type: "transfer", direction: "out", description: "FAST PAYMENT" }));
  }
  // Not problems: dismissed in the transfer review, already in a pair, too young, on an investment account.
  await insertEntry(db, { account: SAVINGS, date, amountMinor: 11_100, type: "transfer", direction: "out", transferDismissedAt: `${TODAY}T00:00:00Z` });
  await db.prepare("INSERT INTO transfer_groups (id, household_id) VALUES ('group-paired', 'household-1')").run();
  await insertEntry(db, { account: SAVINGS, date, amountMinor: 22_200, type: "transfer", direction: "out", transferGroupId: "group-paired" });
  await insertEntry(db, { account: SAVINGS, date: daysAgo(3), amountMinor: 33_300, type: "transfer", direction: "out" });
  const investment = await insertAccount(db, { kind: "investment", name: "Fund account" });
  await insertEntry(db, { account: investment, date, amountMinor: 44_400, type: "transfer", direction: "in" });

  const payload = await checkup(workspace);
  const transfers = ofKind(payload, "unmatched_transfer");
  const byId = Object.fromEntries(transfers.map((item) => [item.id, item]));
  const pairKey = `unmatched_transfer:${[out, incoming].sort().join("+")}`;
  assert.equal(byId[pairKey].tier, "high");
  assert.deepEqual(byId[pairKey].evidence.map((line) => line.note), ["money out", "money in"]);
  assert.equal(byId[pairKey].evidence[1].shortId, incoming.replace(/^[a-z]+-/, "").replace(/-/g, "").slice(0, 8));
  assert.equal(transfers.filter((item) => item.evidence.some((line) => line.amountMinor === 123_400)).length, 1, "the pair is one finding, not one for each side");
  assert.equal(byId[pairKey].amountMinor, null, "no money is wrong, so none is at stake");
  assert.equal(byId[`unmatched_transfer:${[outTwo, incomeSide].sort().join("+")}`].tier, "check");
  assert.equal(byId[`unmatched_transfer:${coincidence}`], undefined, "a lone transfer is a series note, never tied to a purchase");
  assert.equal(transfers.find((item) => item.amountMinor === 66_600).tier, "note");
  const series = transfers.filter((item) => item.tier === "note" && /UOB Savings/.test(item.summary) && item.amountMinor === 14 * 45_000);
  assert.equal(series.length, 1);
  assert.match(series[0].summary, /^14 transfers of \$450\.00 out of UOB Savings/);
  assert.equal(series[0].personIds[0], "person-tim");
  // The dismissed, paired, young and investment transfers never appear.
  const amounts = transfers.flatMap((item) => item.evidence.map((line) => line.amountMinor));
  for (const hidden of [11_100, 22_200, 33_300, 44_400]) assert.ok(!amounts.includes(hidden), `${hidden} must not be reported`);
  assert.ok(monthly.length === 14);
});

test("statements: a missing month, a statement that no longer matches (named entry and the same amount as the account's own comparison), and silence for the rest", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const bank = await insertAccount(db, { name: "Test Bank", kind: "bank", owner: "person-tim" });
  const archived = await insertAccount(db, { name: "Old Bank", kind: "bank", owner: "person-tim", active: false });
  const now = new Date(`${TODAY}T00:00:00Z`);
  const month = (offset) => {
    const value = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  // Statements for months -6..-4 and -2..-1 (month -3 is missing, with entries in it).
  const months = [month(6), month(5), month(4), month(2), month(1)];
  await seedStatementMonths(db, bank, months, { amounts: [100_000, -20_000, -10_000, -5_000, -3_000] });
  await insertEntry(db, { account: bank, date: `${month(3)}-10`, amountMinor: 1_500, createdAt: "2020-01-01 00:00:00" });
  for (let index = 0; index < 5; index += 1) {
    await insertEntry(db, { account: bank, date: `${month(3)}-${String(12 + index)}`, amountMinor: 100 + index, createdAt: "2020-01-01 00:00:00" });
  }
  await seedStatementMonths(db, archived, [month(3), month(1)], {});

  let payload = await checkup(workspace);
  const gaps = ofKind(payload, "statement_gap").filter((item) => item.id.startsWith(`statement_gap:${bank}`));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].id, `statement_gap:${bank}:${month(3)}`);
  assert.match(gaps[0].summary, /Test Bank has a statement for .* and one for .*, but none for .*, a month it has 6 entries in/);
  assert.equal(gaps[0].fix.path, "/imports");
  assert.equal(ofKind(payload, "statement_gap").filter((item) => item.id.includes(archived)).length, 0, "an archived account is not checked");
  assert.deepEqual(ofKind(payload, "balance_mismatch").filter((item) => item.id.includes(bank)), [], "the ledger still matches every statement");
  assert.deepEqual(ofKind(payload, "statement_join"), []);

  // The gap shows once, as a gap: the statement after it does not join the one before only because
  // a month is missing between them, so the same cause is not reported a second time as a broken join.
  assert.equal(ofKind(payload, "statement_join").length, 0);

  // Another account with consecutive statements: an entry added after the latest one was proven, dated inside it.
  const steady = await insertAccount(db, { name: "Steady Bank", kind: "bank", owner: "person-tim" });
  await seedStatementMonths(db, steady, [month(3), month(2), month(1)], { amounts: [50_000, -4_000, -3_000] });
  assert.deepEqual(ofKind(await checkup(workspace), "balance_mismatch").filter((item) => item.id.includes(steady)), [], "it matches while nothing has changed");
  const late = await insertEntry(db, { account: steady, date: `${month(1)}-20`, amountMinor: 2_000, type: "income", description: "LATE TRANSFER IN" });
  payload = await checkup(workspace);
  const mismatch = ofKind(payload, "balance_mismatch").filter((item) => item.id.includes(steady));
  assert.equal(mismatch.length, 1);
  assert.equal(mismatch[0].tier, "high");
  assert.equal(mismatch[0].amountMinor, 2_000);
  assert.equal(mismatch[0].evidence[1].shortId, late.replace(/^[a-z]+-/, "").replace(/-/g, "").slice(0, 8));
  assert.match(mismatch[0].summary, /now come to \$20\.00 more than the statement\. One entry added after that explains the difference exactly\./);

  // The account's own statement comparison (Settings) says the same difference.
  const account = (await loadAccounts(db)).find((item) => item.id === steady);
  assert.equal(Math.abs(account.latestCheckpointDeltaMinor), mismatch[0].amountMinor, "the check-up and Settings agree to the cent");
});

test("stale estimates: an old estimate a file of its card covers is found; a young one and one on a card with no file are soft or silent", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const covering = await insertImport(db, { importedAt: `${daysAgo(10)}T03:00:00Z`, label: "Card file" });
  // The card's own file lists a purchase either side of the estimate's day.
  await insertEntry(db, { account: TIM_CARD, date: daysAgo(50), postDate: daysAgo(49), amountMinor: 900, importId: covering, description: "GRAB* A-1 SINGAPORE SG" });
  await insertEntry(db, { account: TIM_CARD, date: daysAgo(20), postDate: daysAgo(19), amountMinor: 700, importId: covering, description: "GRAB* A-2 SINGAPORE SG" });
  const old = await insertEntry(db, { account: TIM_CARD, date: daysAgo(35), amountMinor: 1_320, description: "Grab* Bali", originalAmountMinor: 16_660_000, originalCurrency: "IDR" });
  const young = await insertEntry(db, { account: TIM_CARD, date: daysAgo(8), amountMinor: 1_000, description: "Grab* Bali two", originalAmountMinor: 12_000_000, originalCurrency: "IDR" });
  const noFile = await insertEntry(db, { account: JOYCE_CARD, date: daysAgo(35), amountMinor: 2_000, description: "Warung Bali", originalAmountMinor: 20_000_000, originalCurrency: "IDR" });
  // Matched estimates are not estimates any more: they carry the bank's import.
  await insertEntry(db, { account: TIM_CARD, date: daysAgo(36), amountMinor: 3_000, description: "Matched estimate", originalAmountMinor: 30_000_000, originalCurrency: "IDR", importId: covering });

  const payload = await checkup(workspace);
  const found = Object.fromEntries(ofKind(payload, "stale_estimate").map((item) => [item.id, item]));
  assert.deepEqual(Object.keys(found).sort(), [`stale_estimate:${noFile}`, `stale_estimate:${old}`].sort());
  assert.equal(found[`stale_estimate:${old}`].tier, "high");
  assert.match(found[`stale_estimate:${old}`].summary, /IDR 166,600\.00 at Grab\* Bali on .* is still only an estimate of \$13\.20/);
  assert.equal(found[`stale_estimate:${noFile}`].tier, "check");
  assert.ok(!found[`stale_estimate:${young}`]);
});

test("plan: this month's overspent plan, a due bill with one paying entry, and a line with no category; a past month is left alone", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const today = "2026-10-27";
  const home = await categoryId(db, "Home");
  await insertPlanRow(db, { month: "2026-10", section: "income", label: "Salary", plannedMinor: 500_000 });
  await insertPlanRow(db, { month: "2026-10", label: "House loan", plannedMinor: 45_000, planDate: "2026-10-05", categoryId: home });
  await insertPlanRow(db, { month: "2026-10", section: "budget_buckets", label: "Food", plannedMinor: 520_000, categoryId: await categoryId(db, "Food & Drinks") });
  const noCategory = await insertPlanRow(db, { month: "2026-10", section: "budget_buckets", label: "Odds and ends", plannedMinor: 12_000, categoryId: null });
  await insertPlanRow(db, { month: "2026-08", section: "income", label: "Salary", plannedMinor: 100 });
  await insertPlanRow(db, { month: "2026-08", label: "Old plan", plannedMinor: 900_000, categoryId: home });
  const payment = await insertEntry(db, { account: SAVINGS, date: "2026-10-06", amountMinor: 45_000, description: "FAST PAYMENT HOUSE LOAN", categoryId: home });

  const report = await buildLedgerCheckupDto(db, { today });
  const kinds = report.findings.map((item) => item.id);
  const overspent = report.findings.find((item) => item.kind === "plan_overspent");
  assert.equal(overspent.id, "plan_overspent:2026-10");
  assert.equal(overspent.amountMinor, 45_000 + 520_000 + 12_000 - 500_000);
  assert.equal(overspent.tier, "check");
  const unpaid = report.findings.find((item) => item.kind === "plan_line_unpaid");
  assert.equal(unpaid.tier, "check");
  assert.equal(unpaid.evidence[1].shortId, payment.replace(/^[a-z]+-/, "").replace(/-/g, "").slice(0, 8));
  assert.ok(kinds.includes(`plan_line_no_category:${noCategory}`));
  assert.ok(!kinds.some((id) => id === "plan_overspent:2026-08"), "a past month is history");
  // Linking the payment to the bill removes the finding.
  const [{ id: billId }] = (await db.prepare("SELECT id FROM monthly_plan_rows WHERE label = 'House loan'").all()).results;
  await db.prepare("INSERT INTO monthly_plan_entry_links (id, monthly_plan_row_id, transaction_id) VALUES ('link-1', ?, ?)").bind(billId, payment).run();
  const linked = await buildLedgerCheckupDto(db, { today });
  assert.equal(linked.findings.some((item) => item.kind === "plan_line_unpaid"), false);
});

test("hygiene: Other with a rule behind it, a zero or far-future entry, and a quiet account; nothing for guesses", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const other = await categoryId(db, "Other");
  const food = await categoryId(db, "Food & Drinks");
  await db.prepare("INSERT INTO category_match_rules (id, household_id, pattern, category_id, priority, is_active) VALUES ('rule-zzkopi', 'household-1', 'ZZKOPI', ?, 10, 1)").bind(food).run();
  const ruled = await insertEntry(db, { account: SAVINGS, date: daysAgo(100), amountMinor: 650, description: "ZZKOPI CORNER SINGAPORE SG", categoryId: other });
  await insertEntry(db, { account: SAVINGS, date: daysAgo(100), amountMinor: 650, description: "QQWHATEVER SHOP SINGAPORE SG", categoryId: other });
  await insertEntry(db, { account: SAVINGS, date: daysAgo(20), amountMinor: 650, description: "ZZKOPI CORNER SINGAPORE SG", categoryId: other });
  const zero = await insertEntry(db, { account: SAVINGS, date: daysAgo(5), amountMinor: 0, description: "UNFINISHED" });
  const farFuture = await insertEntry(db, { account: SAVINGS, date: daysAgo(-120), amountMinor: 5_000, description: "TYPO YEAR" });
  const quiet = await insertAccount(db, { name: "Dusty Bank", kind: "bank" });
  await insertEntry(db, { account: quiet, date: daysAgo(200), amountMinor: 100 });
  const unused = await insertAccount(db, { name: "Never Used", kind: "bank" });

  const payload = await checkup(workspace);
  const ids = payload.findings.map((item) => item.id);
  assert.deepEqual(ids.filter((id) => id.startsWith("other_category:")), [`other_category:${ruled}`]);
  assert.ok(ids.includes(`odd_entry:${zero}`) && ids.includes(`odd_entry:${farFuture}`));
  assert.ok(ids.includes(`quiet_account:${quiet}`));
  assert.ok(!ids.includes(`quiet_account:${unused}`), "an account that never had an entry is new, not quiet");
});

test("wrong card: the Apple Pay entries left on the wrong card after their card's own file was loaded are HIGH, and removing them clears the finding", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  await createCards(workspace.api);
  await saveApplePayEntries(workspace);
  await commitFile(workspace.api, await previewFile(workspace.api, ONE_CARD_FILE, "CC_TXN_History_14Oct2026-onecard"), "CC_TXN_History_14Oct2026-onecard");
  const ladyPreview = await previewFile(workspace.api, LADYS_FILE, "CC_TXN_History_13Oct2026-ladys");
  // Kept: the person committed the card's file without removing the entries.
  await commitFile(workspace.api, ladyPreview, "CC_TXN_History_13Oct2026-ladys");

  const report = await buildLedgerCheckupDto(workspace.db, { today: "2026-10-27" });
  const found = report.findings.filter((item) => item.kind === "wrong_card_duplicate");
  assert.equal(found.length, 3);
  assert.deepEqual(found.map((item) => item.tier), ["high", "high", "high"]);
  assert.deepEqual(found.map((item) => item.amountMinor).sort((a, b) => a - b), [180, 784, 970]);
  assert.ok(found.every((item) => item.fix.path === "/imports" && /Lady's Card/.test(item.summary) && /One Card/.test(item.summary)));
  assert.ok(found.every((item) => item.evidence.some((line) => line.role === "fact" && /does not list it/.test(line.label))));

  // Ledger entries removed (what the Imports review does): nothing left to report.
  await workspace.db.prepare("DELETE FROM transactions WHERE external_reference LIKE 'shortcut:%'").run();
  assert.deepEqual((await buildLedgerCheckupDto(workspace.db, { today: "2026-10-27" })).findings.filter((item) => item.kind === "wrong_card_duplicate"), []);
});

test("wrong card: with no file of the card loaded after the day, or an entry the file lists, there is no finding", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  await createCards(workspace.api);
  await saveApplePayEntries(workspace);
  // Only the other card's file is loaded: the Lady's Card has no file that could have listed the entries.
  await commitFile(workspace.api, await previewFile(workspace.api, ONE_CARD_FILE, "CC_TXN_History_14Oct2026-onecard"), "CC_TXN_History_14Oct2026-onecard");
  const report = await buildLedgerCheckupDto(workspace.db, { today: "2026-10-27" });
  assert.deepEqual(report.findings.filter((item) => item.kind === "wrong_card_duplicate"), []);
});

test("a person's view keeps their findings and the shared ones; the household sees everything", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const joyce = await insertAccount(db, { name: "Joyce Bank", owner: "person-joyce" });
  const shared = await insertAccount(db, { name: "Joint Bank", owner: null, joint: true });
  const entries = {};
  for (const [index, [name, account]] of [["tim", SAVINGS], ["joyce", joyce], ["shared", shared]].entries()) {
    entries[name] = await insertEntry(db, { account, date: daysAgo(40), amountMinor: 987_601 + index, type: "transfer", direction: "out", description: `LONELY ${name}` });
  }
  const idsFor = async (query) => (await checkup(workspace, query)).findings.filter((item) => item.kind === "unmatched_transfer" && item.amountMinor >= 987_601 && item.amountMinor <= 987_603).map((item) => item.evidence[0].accountName).sort();
  assert.deepEqual(await idsFor(""), ["Joint Bank", "Joyce Bank", "UOB Savings"]);
  assert.deepEqual(await idsFor("?view=household"), ["Joint Bank", "Joyce Bank", "UOB Savings"]);
  assert.deepEqual(await idsFor("?view=person-tim"), ["Joint Bank", "UOB Savings"]);
  assert.deepEqual(await idsFor("?view=person-joyce"), ["Joint Bank", "Joyce Bank"]);
  const tim = await checkup(workspace, "?view=person-tim");
  assert.equal(tim.tierCounts.note + tim.tierCounts.check + tim.tierCounts.high, tim.findings.length, "the counts follow the view");
});

test("This is fine: it holds for the same evidence, is lifted by changed evidence, undoes, and refuses what it should", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const base = { account: SAVINGS, amountMinor: 555_500, type: "transfer", direction: "out", description: "SERIES" };
  await insertEntry(db, { ...base, date: daysAgo(50) });
  const first = (await checkup(workspace)).findings.find((item) => item.kind === "unmatched_transfer" && item.amountMinor === 555_500);
  assert.equal(first.tier, "note");

  const dismissed = await workspace.api("/api/ledger-checkup/dismiss", { id: first.id, evidenceKey: first.evidenceKey });
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.payload));
  assert.deepEqual(dismissed.payload, { ok: true, id: first.id });
  const hidden = await checkup(workspace);
  assert.ok(!hidden.findings.some((item) => item.id === first.id));
  assert.equal(hidden.dismissedCount, 1);
  assert.equal(hidden.tierCounts.note, (await checkup(workspace, "?dismissed=1")).tierCounts.note, "dismissed findings are never counted");
  const shown = (await checkup(workspace, "?dismissed=1")).findings.find((item) => item.id === first.id);
  assert.equal(shown.dismissed, true);
  const audit = await db.prepare("SELECT action, entity_id FROM audit_events WHERE action = 'ledger_checkup_dismissed'").all();
  assert.deepEqual(audit.results.map((row) => row.entity_id), [first.id]);

  // Another transfer joins the series: the evidence changed, so it is back.
  await insertEntry(db, { ...base, date: daysAgo(45) });
  const back = (await checkup(workspace)).findings.find((item) => item.kind === "unmatched_transfer" && item.amountMinor === 2 * 555_500);
  assert.ok(back, "the series now has two transfers");
  assert.equal(back.dismissed, false);
  assert.notEqual(back.evidenceKey, first.evidenceKey);

  // Undo brings the original back when its evidence is current, and is refused for what is not dismissed.
  const undone = await workspace.api("/api/ledger-checkup/undo-dismiss", { id: first.id });
  assert.equal(undone.status, 200);
  assert.equal((await workspace.api("/api/ledger-checkup/undo-dismiss", { id: first.id })).status, 400);
  assert.equal((await checkup(workspace)).dismissedCount, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'ledger_checkup:dismissed:%'").first()).n, 0);

  // Negatives: malformed id or key, wrong methods, a cross-site write.
  for (const body of [{ id: "nonsense", evidenceKey: "abc" }, { id: "unknown_kind:abc", evidenceKey: "abc" }, { id: first.id, evidenceKey: "not hex!" }, { id: first.id }, { evidenceKey: "abc" }, { id: `odd_entry:${"x".repeat(300)}`, evidenceKey: "abc" }, { id: "odd_entry:a b", evidenceKey: "abc" }]) {
    const refused = await workspace.api("/api/ledger-checkup/dismiss", body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal(refused.payload.ok, false);
  }
  assert.equal((await workspace.api("/api/ledger-checkup/dismiss")).status, 405);
  assert.equal((await workspace.api("/api/ledger-checkup", {})).status, 405);
  assert.equal((await workspace.api("/api/ledger-checkup?view=" + encodeURIComponent("a b;drop"))).status, 400);
  const crossSite = await workspace.fetch("/api/ledger-checkup/dismiss", {
    method: "POST", headers: { "content-type": "application/json", "Sec-Fetch-Site": "cross-site" }, body: JSON.stringify({ id: first.id, evidenceKey: first.evidenceKey })
  });
  assert.equal(crossSite.status, 403);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'ledger_checkup:dismissed:%'").first()).n, 0, "nothing was written by any refused request");
});

test("This is fine is capped at 500 and the report tolerates a missing settings table", async (t) => {
  const { db, ...rest } = await openSeededDatabase(t, template);
  const workspace = { db, ...rest };
  const statements = Array.from({ length: 500 }, (_, index) => db.prepare("INSERT INTO app_settings (key, value_json) VALUES (?, ?)")
    .bind(`ledger_checkup:dismissed:odd_entry:full-${index}`, JSON.stringify({ evidenceKey: "abc", kind: "odd_entry" })));
  await db.batch(statements);
  const full = await workspace.api("/api/ledger-checkup/dismiss", { id: "odd_entry:one-more", evidenceKey: "abc" });
  assert.equal(full.status, 400);
  assert.match(full.payload.error, /Too many findings are marked as fine/);
  // An id that is already dismissed can still be updated while the list is full.
  assert.equal((await workspace.api("/api/ledger-checkup/dismiss", { id: "odd_entry:full-1", evidenceKey: "def" })).status, 200);

  await db.prepare("DROP TABLE app_settings").run();
  const payload = await checkup(workspace);
  assert.equal(payload.dismissedCount, 0, "no table, nothing dismissed, still a report");
});
