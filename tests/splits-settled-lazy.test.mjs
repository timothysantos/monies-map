// The Splits page sends only the records outside settled sections; each
// settled section is a summary whose rows load on demand, and a group with
// one gets its whole-group facts counted in SQL (docs/flows/splits-flow.md,
// "Settled sections load on demand"). These tests prove the new page against
// the old one on real seeds: the old page is still buildable (the full
// projection over every record, as the page built it before), so every
// figure the Splits screen shows is compared number for number, and every
// section's lazily loaded rows must equal the rows the old page sent.
import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { loadPageShell } from "../src/domain/app-shell.ts";
import {
  loadSplitActivityHistory,
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitMatchCandidates,
  loadSplitSettlementCheckpoints,
  loadSplitSettlements
} from "../src/domain/app-repository-splits.ts";
import { buildSplitsPage } from "../src/domain/splits-projection.ts";
import { deriveGroupFigures, partitionActivityBySettlement } from "../src/domain/split-open-period.ts";
import { buildGroupFactsFromActivity } from "../src/domain/split-group-facts.ts";
import { splitActivityMatchesSearch } from "../src/domain/search-text.ts";
import { buildSplitsSignals } from "../src/domain/money-signals/splits-signals.ts";
import { splitCardLock } from "../src/client/split-card-lock.js";
import { buildSplitsSignals as buildSplitsSignalsBefore } from "./support/splits-signals-before.ts";
import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { SETTLED_HISTORY, seedSettledSplitHistory } from "./support/settled-split-history.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const VIEWS = ["household", "person-tim", "person-joyce"];
const MONTH = "2025-10";

async function api(workspace, path) {
  const response = await workspace.fetch(path);
  const text = await response.text();
  assert.equal(response.status, 200, `${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function postJson(workspace, path, body) {
  const { status, payload } = await workspace.api(path, body);
  assert.equal(status, 200, `${path}: ${JSON.stringify(payload).slice(0, 300)}`);
  return payload;
}

// The Splits page as it was built before: every record, settled or not.
async function oldSplitsPage(db, selectedViewId, month) {
  const { categories, viewId, label, personNameById } = await loadPageShell(db, selectedViewId);
  const [groups, expenses, settlements, matches, checkpoints, history] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db),
    loadSplitSettlements(db),
    loadSplitMatchCandidates(db),
    loadSplitSettlementCheckpoints(db),
    loadSplitActivityHistory(db)
  ]);
  // As the page receives it (JSON drops undefined fields).
  return { viewId, label, page: JSON.parse(JSON.stringify(buildSplitsPage(viewId, groups, expenses, settlements, matches, categories, month, personNameById, checkpoints, history))) };
}

const isInSettledSection = (item) => Boolean(item.settlementCheckpointId) && item.settlementStatus === "settled" && !item.isArchived;

// The demo seed, plus: production's settled history (352 records, one
// matched SGD checkpoint), a group whose batch a settle-up closed, and an
// unpaid JPY simplification.
async function seedEverything(workspace) {
  const closed = await postJson(workspace, "/api/splits/groups/create", { name: "Closed lunch club", currency: "SGD", expenseSource: "mixed" });
  await postJson(workspace, "/api/splits/expenses/create", {
    groupId: closed.groupId, date: "2025-07-02", description: "Club lunch", categoryName: "Food & Drinks",
    payerPersonName: "Tim", amountMinor: 6000, splitAmountMinor: 3000, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  await postJson(workspace, "/api/splits/settlements/create", {
    groupId: closed.groupId, date: "2025-07-03", fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 3000,
    currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
  });
  await seedSettledSplitHistory(workspace.db);
  const tokyo = await postJson(workspace, "/api/splits/groups/create", { name: "Tokyo trip", currency: "JPY", expenseSource: "mixed" });
  for (const [description, date, amountMinor] of [["Tokyo ramen", "2025-06-10", 2400], ["Tokyo train", "2025-06-11", 1200], ["Tokyo ramen", "2025-06-12", 1800]]) {
    await postJson(workspace, "/api/splits/expenses/create", {
      groupId: tokyo.groupId, date, description, categoryName: "Food & Drinks", payerPersonName: "Joyce",
      amountMinor, splitAmountMinor: amountMinor / 2, currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
    });
  }
  const jpy = await postJson(workspace, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2025-06-30", currency: "JPY" });
  await postJson(workspace, "/api/splits/expenses/create", {
    groupId: tokyo.groupId, date: "2025-07-01", description: "Tokyo souvenirs", categoryName: "Shopping", payerPersonName: "Tim",
    amountMinor: 3000, splitAmountMinor: 1500, currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  return { closedGroupId: closed.groupId, tokyoGroupId: tokyo.groupId, jpyCheckpointId: jpy.checkpointId };
}

test("the Splits page sends no settled row, and every figure, section and loaded row equals the old page's", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const seeded = await seedEverything(workspace);
  const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
  let sectionsCompared = 0;
  let groupsWithFacts = 0;

  for (const viewId of VIEWS) {
    const fresh = await api(workspace, `/api/splits-page?view=${viewId}&month=${MONTH}`);
    const { page: old, label } = await oldSplitsPage(workspace.db, viewId, fresh.monthPage.month);
    const page = fresh.splitsPage;

    // Nothing a settlement covers travels with the page.
    assert.equal(page.activity.filter(isInSettledSection).length, 0, `${viewId}: no settled rows`);
    assert.ok(old.activity.filter(isInSettledSection).length >= (viewId === "household" ? SETTLED_HISTORY.coveredTotal : 1), `${viewId}: the old page sent them`);
    assert.deepEqual(page.activity, old.activity.filter((item) => !isInSettledSection(item)), `${viewId}: the open (and closed-batch) rows are the old page's`);
    assert.deepEqual(page.groups, old.groups, `${viewId}: tiles, balances, entry counts`);
    assert.deepEqual(page.matches, old.matches, `${viewId}: bank-match suggestions`);
    assert.deepEqual(page.settlementCheckpoints, old.settlementCheckpoints.map(({ includedRecordIds: _ids, ...checkpoint }) => checkpoint));
    assert.ok(page.settlementCheckpoints.every((checkpoint) => !("includedRecordIds" in checkpoint)), "record ids stay on the server");
    // The closed batch stays with the page (the archive sheet shows it).
    assert.ok(page.activity.some((item) => item.groupId === seeded.closedGroupId && item.isArchived));

    for (const group of old.groups) {
      const oldGroupActivity = old.activity.filter((item) => item.groupId === group.id);
      const newGroupActivity = page.activity.filter((item) => item.groupId === group.id);
      const oldSections = partitionActivityBySettlement(oldGroupActivity.filter((item) => !item.isArchived), old.settlementCheckpoints).sections;
      const newSections = (page.settledSections ?? []).filter((section) => section.groupId === group.id);
      assert.deepEqual(newSections, oldSections.map((section) => ({
        checkpointId: section.checkpointId,
        groupId: group.id,
        settlementDate: section.settlementDate,
        isPaid: section.isPaid,
        entryCount: section.entryCount,
        spendMinor: section.spendMinor,
        currency: section.items[0]?.currency ?? "SGD"
      })), `${viewId} ${group.name}: section summaries`);

      // Each section's rows, loaded on demand, are the rows the old page sent.
      for (const section of oldSections) {
        const rows = await api(workspace, `/api/splits/settled-rows?view=${viewId}&checkpoint=${encodeURIComponent(section.checkpointId)}&group=${encodeURIComponent(group.id)}`);
        assert.deepEqual(rows.items, section.items, `${viewId} ${group.name}: rows of ${section.checkpointId}`);
        assert.equal(rows.truncated, false);
        sectionsCompared += 1;
      }

      // The lead chip, its label and the donut read the open period.
      const before = deriveGroupFigures({ groupActivity: oldGroupActivity, shownActivity: oldGroupActivity.filter((item) => !item.isArchived), categories: [], viewId });
      const after = deriveGroupFigures({ groupActivity: newGroupActivity, shownActivity: newGroupActivity.filter((item) => !item.isArchived), categories: [], viewId });
      assert.equal(after.spendMinor, before.spendMinor, `${viewId} ${group.name}: chip`);
      assert.deepEqual(after.donutChart, before.donutChart, `${viewId} ${group.name}: donut`);
      assert.equal(after.hasSettledBefore || newSections.length > 0, before.hasSettledBefore, `${viewId} ${group.name}: "since last settle-up"`);

      // The whole-group facts are the old activity's, counted in SQL.
      if (newSections.length) {
        groupsWithFacts += 1;
        assert.deepEqual(page.groupFacts[group.id], buildGroupFactsFromActivity(oldGroupActivity, group.currency), `${viewId} ${group.name}: facts`);
      } else {
        assert.equal(page.groupFacts?.[group.id], undefined, `${viewId} ${group.name}: no facts without a settled section`);
      }

      // Every check-in line (balance, share of costs, Just for fun) reads
      // exactly as the old page's did, word for word and number for number.
      for (const today of ["2025-10-20", "2026-10-20"]) {
        const input = {
          audience: viewId === "household" ? "household" : "person",
          viewId,
          viewLabel: label,
          people,
          group: { id: group.id, name: group.name, balanceMinor: group.balanceMinor, currency: group.currency },
          pendingMatchCount: 0,
          settlementCheckpoints: old.settlementCheckpoints,
          today,
          formatMoney: (amountMinor) => `${group.currency} ${amountMinor}`
        };
        assert.deepEqual(
          buildSplitsSignals({ ...input, activity: newGroupActivity, facts: page.groupFacts?.[group.id] }),
          buildSplitsSignalsBefore({ ...input, activity: oldGroupActivity }),
          `${viewId} ${group.name} ${today}: check-in lines`
        );
      }
    }
  }
  // Big group, small group and Tokyo, in each view that sees them.
  assert.ok(sectionsCompared >= 9, `sections compared: ${sectionsCompared}`);
  assert.ok(groupsWithFacts >= 9, `groups with facts: ${groupsWithFacts}`);

  const tokyo = (await api(workspace, `/api/splits-page?view=person-tim&month=${MONTH}`)).splitsPage.settledSections.find((section) => section.groupId === seeded.tokyoGroupId);
  assert.deepEqual(tokyo, { checkpointId: seeded.jpyCheckpointId, groupId: seeded.tokyoGroupId, settlementDate: "2025-06-30", isPaid: false, entryCount: 3, spendMinor: 5400, currency: "JPY" });
});

test("the page payload drops to the open rows plus a few hundred bytes per settled group", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  await seedSettledSplitHistory(workspace.db);
  for (const viewId of ["household", "person-tim"]) {
    const response = await workspace.fetch(`/api/splits-page?view=${viewId}&month=${MONTH}`);
    const text = await response.text();
    const { page: old } = await oldSplitsPage(workspace.db, viewId, MONTH);
    const oldBytes = JSON.stringify({ splitsPage: old }).length;
    const settledBytes = JSON.stringify(JSON.parse(text).splitsPage.settledSections).length + JSON.stringify(JSON.parse(text).splitsPage.groupFacts).length;
    console.log(`# ${viewId}: splits page ${text.length} B raw / ${gzipSync(text).length} B gzip (old page DTO ${oldBytes} B raw); settled summaries + facts ${settledBytes} B`);
    // Production's 352 settled records were ~300 kB of the page; now the
    // page is the open rows, the demo's other data, 2 summaries and 2 groups' facts.
    assert.ok(text.length < 25_000, `${viewId}: ${text.length} B`);
    assert.ok(settledBytes < 4_000, `${viewId}: settled part ${settledBytes} B`);
    assert.ok(oldBytes > 300_000, `${viewId}: the old page was ${oldBytes} B`);
  }
});

test("settled rows: household-scoped, view-filtered, ordered newest first, bounded, and carry their lock", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  await seedSettledSplitHistory(workspace.db);
  const h = SETTLED_HISTORY;
  // Another household's expense, listed in this household's checkpoint and
  // group by mistake, must never be read.
  await workspace.db.batch([
    workspace.db.prepare("INSERT INTO households (id, name) SELECT 'household-2', 'Neighbours' WHERE NOT EXISTS (SELECT 1 FROM households WHERE id = 'household-2')"),
    workspace.db.prepare(`INSERT INTO split_expenses (id, household_id, split_group_id, payer_person_id, expense_date, description, total_amount_minor, currency)
      VALUES ('foreign-exp', 'household-2', '${h.bigGroupId}', 'person-tim', '2025-03-03', 'Neighbours secret dinner', 99900, 'SGD')`),
    workspace.db.prepare(`INSERT INTO split_expense_shares (id, split_expense_id, person_id, ratio_basis_points, amount_minor) VALUES ('foreign-share', 'foreign-exp', 'person-tim', 10000, 99900)`),
    workspace.db.prepare(`INSERT INTO split_settlement_checkpoint_items (id, checkpoint_id, record_kind, record_id) VALUES ('cpi-foreign', '${h.checkpointId}', 'expense', 'foreign-exp')`)
  ]);

  const counting = countingDatabase(workspace.db);
  const env = { DB: counting.db, ...template.config.vars };
  const { default: worker } = await import("../src/index.ts");
  const call = async (path) => {
    const response = await worker.fetch(new Request(`http://127.0.0.1${path}`), env);
    assert.equal(response.status, 200);
    return response.json();
  };
  await call(`/api/splits/settled-rows?view=household&checkpoint=${h.checkpointId}&group=${h.bigGroupId}`);
  counting.reset();
  const household = await call(`/api/splits/settled-rows?view=household&checkpoint=${h.checkpointId}&group=${h.bigGroupId}`);
  const statements = counting.summary().statements;
  assert.ok(statements <= 8, `lazy rows: ${statements} round trips`);
  assert.ok(counting.calls.filter((entry) => /FROM split_expenses/.test(entry.sql) && /checkpoint_items/.test(entry.sql)).every((entry) => /LIMIT 2000/.test(entry.sql)), "the row reads are bounded");

  assert.equal(household.items.length, 287, "283 expenses and 4 settle-ups");
  assert.ok(!household.items.some((item) => item.id === "foreign-exp" || /Neighbours/.test(item.description)), "never another household's record");
  assert.ok(household.items.every((item) => item.groupId === h.bigGroupId && item.settlementCheckpointId === h.checkpointId && item.settlementStatus === "settled"));
  const order = household.items.map((item) => `${item.date}|${item.id}`);
  assert.deepEqual(order, [...order].sort((left, right) => right.localeCompare(left)), "newest first, then id");

  // A person sees only what they share in (here every expense is shared, and
  // the settle-ups are Joyce's to Tim).
  const tim = await call(`/api/splits/settled-rows?view=person-tim&checkpoint=${h.checkpointId}&group=${h.bigGroupId}`);
  assert.equal(tim.items.length, 287);
  assert.equal(tim.items.find((item) => item.kind === "settlement")?.viewerDirectionLabel, "you received");

  // The read-only card's lock and Undo come with the rows.
  const expense = tim.items.find((item) => item.kind === "expense");
  const lock = splitCardLock(expense, [{ id: h.checkpointId, settlementDate: h.settlementDate }]);
  assert.equal(lock.checkpointId, h.checkpointId);
  assert.equal(lock.canUndo, true);
  assert.match(lock.message, /^Simplified on .*Undo the simplification to change it\.$/);

  // Negative: an unknown checkpoint, another group, or a reopened checkpoint has no rows.
  assert.deepEqual((await call(`/api/splits/settled-rows?view=household&checkpoint=nope&group=${h.bigGroupId}`)).items, []);
  assert.equal((await call(`/api/splits/settled-rows?view=household&checkpoint=${h.checkpointId}&group=${h.smallGroupId}`)).items.length, 65);
  await workspace.db.prepare(`UPDATE split_settlement_checkpoints SET status = 'reopened' WHERE id = '${h.checkpointId}'`).run();
  assert.deepEqual((await call(`/api/splits/settled-rows?view=household&checkpoint=${h.checkpointId}&group=${h.bigGroupId}`)).items, []);
  const reopenedPage = await call(`/api/splits-page?view=household&month=${MONTH}`);
  assert.equal(reopenedPage.splitsPage.settledSections, undefined, "a reopened checkpoint has no section");
  assert.ok(reopenedPage.splitsPage.activity.filter((item) => item.groupId === h.bigGroupId).length >= 287 + 6);

  // Malformed requests are refused.
  const bad = await worker.fetch(new Request(`http://127.0.0.1/api/splits/settled-rows?view=household&checkpoint=${"x".repeat(201)}&group=g`), env);
  assert.equal(bad.status, 400);
  const missing = await worker.fetch(new Request("http://127.0.0.1/api/splits/settled-rows?view=household&checkpoint=only"), env);
  assert.equal(missing.status, 400);
});

test("a deep link to a settled expense reads its section; an open one has none", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const h = await seedSettledSplitHistory(workspace.db);
  const settledId = "prod-shape-exp-0042";
  const byRecord = await api(workspace, `/api/splits/settled-rows?view=person-tim&record=${settledId}`);
  assert.equal(byRecord.checkpointId, h.checkpointId);
  assert.equal(byRecord.groupId, h.bigGroupId);
  assert.ok(byRecord.items.some((item) => item.id === settledId));
  assert.equal(byRecord.items.length, 287);

  // The open expense is in the page itself, so the link needs no section.
  const open = await api(workspace, "/api/splits/settled-rows?view=person-tim&record=prod-shape-exp-0355");
  assert.deepEqual(open.items, []);
  const page = await api(workspace, `/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.ok(page.splitsPage.activity.some((item) => item.id === "prod-shape-exp-0355"));
});

test("a search finds settled records on the server with the page's own rule", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const h = await seedSettledSplitHistory(workspace.db);
  // The first request settles the isolate (it gives older records a batch).
  await api(workspace, `/api/splits-page?view=person-tim&month=${MONTH}`);
  const { page: old } = await oldSplitsPage(workspace.db, "person-tim", MONTH);
  const oldSettled = old.activity.filter((item) => item.groupId === h.bigGroupId && isInSettledSection(item));

  for (const query of ["sushi tei", "ikea", "SUSHI", "45.", "Linked", "joyce paid", "receipt album 12"]) {
    const found = await api(workspace, `/api/splits/settled-search?view=person-tim&group=${h.bigGroupId}&q=${encodeURIComponent(query)}`);
    const expected = oldSettled.filter((item) => splitActivityMatchesSearch(item, query));
    assert.deepEqual(found.items, expected, `"${query}"`);
    assert.equal(found.truncated, false);
  }
  const sushi = await api(workspace, `/api/splits/settled-search?view=person-tim&group=${h.bigGroupId}&q=sushi`);
  assert.ok(sushi.items.length > 5);
  assert.ok(sushi.items.every((item) => item.settlementCheckpointId === h.checkpointId), "each match says which section it belongs to");

  // Negative: nothing matches, another group's records stay out, an empty
  // query reads nothing.
  assert.deepEqual((await api(workspace, `/api/splits/settled-search?view=person-tim&group=${h.bigGroupId}&q=zzqqxxnothing`)).items, []);
  const small = await api(workspace, `/api/splits/settled-search?view=person-tim&group=${h.smallGroupId}&q=sushi`);
  assert.ok(small.items.every((item) => item.groupId === h.smallGroupId));
  assert.deepEqual((await api(workspace, `/api/splits/settled-search?view=person-tim&group=${h.bigGroupId}&q=%20`)).items, []);
});

// The Just for fun lines now read counts (split-group-facts.ts) instead of
// every record. Random groups with ties, several currencies, zero amounts,
// unreadable names and settled records: the lines must read exactly as the
// old code's (tests/support/splits-signals-before.ts), whether the facts are
// counted from all the activity or come with the page beside the open part.
test("whole-group facts reproduce every check-in line of the old code on random groups", () => {
  let seed = 20261020;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const names = ["Sushi Tei", "IKEA", "GRAB*A-8XYZ123 SINGAPORE SG", "Taxi", "", "The Coffee Bean", "PAYNOW TRANSFER", "Groceries", "12345", "Dim sum"];
  const categories = ["Food & Drinks", "Other", "Taxi", " Groceries ", "Uncategorized", "Travel"];
  const methods = ["card", "cash", "bank", "other", "voucher"];
  const days = ["2025-01-04", "2025-01-05", "2025-02-14", "2025-02-15", "2025-03-01", "2026-01-02", "2026-01-02"];
  let compared = 0;
  for (let run = 0; run < 300; run += 1) {
    const groupCurrency = pick(["SGD", "SGD", "JPY", undefined]);
    const size = Math.floor(random() * 14);
    const activity = Array.from({ length: size }, (_, index) => {
      const kind = random() < 0.8 ? "expense" : "settlement";
      return {
        id: `r-${String(index).padStart(3, "0")}`,
        kind,
        settlementStatus: random() < 0.35 ? "settled" : "open",
        date: pick(days),
        description: kind === "expense" ? pick(names) : "Settle up",
        totalAmountMinor: pick([0, 500, 500, 1200, 3000, 3000, 9900]),
        paidByPersonName: pick(["Tim", "Joyce"]),
        categoryName: pick(categories),
        currency: pick(["SGD", "SGD", "JPY"]),
        paymentMethod: pick(methods),
        shares: [{ personId: "person-tim", amountMinor: 100 }]
      };
    }).sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
    const input = {
      audience: random() < 0.5 ? "household" : "person",
      viewId: "person-tim",
      viewLabel: "Tim",
      people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
      group: { id: "g", name: pick(["Japan trip", "Home", "Non-group expenses"]), balanceMinor: pick([0, 1500, -800]), currency: groupCurrency },
      pendingMatchCount: 0,
      settlementCheckpoints: [],
      today: pick(["2025-03-20", "2026-01-10"]),
      formatMoney: (amountMinor) => `$${amountMinor}`
    };
    const before = buildSplitsSignalsBefore({ ...input, activity });
    assert.deepEqual(buildSplitsSignals({ ...input, activity }), before, `run ${run}: facts counted from the activity`);
    const facts = buildGroupFactsFromActivity(activity, groupCurrency);
    const open = activity.filter((item) => item.settlementStatus !== "settled");
    assert.deepEqual(buildSplitsSignals({ ...input, activity: open, facts }), before, `run ${run}: open activity and the page's facts`);
    compared += before.length;
  }
  assert.ok(compared > 1500, `lines compared: ${compared}`);
});
