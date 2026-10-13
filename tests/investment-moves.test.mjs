import assert from "node:assert/strict";
import test from "node:test";

import { findInvestmentMoves, sumInvestmentMoves } from "../src/domain/investment-moves.ts";
import { splitMoneyUse } from "../src/client/money-jobs-model.js";
import { listMoneyJobs } from "../src/client/money-jobs-model.js";
import { buildSavingsBarModel } from "../src/client/savings-bar-model.js";
import { buildSummaryLeadModel } from "../src/client/summary-lead-model.js";

// Owner decision d34 (DOMAIN.md "Money job"): a transfer into an account of
// kind Investment is invested, not kept; a transfer out of one back to a
// cash account is taken out of investments. Amounts are minor units (cents).

const INVESTMENT_IDS = new Set(["acc-endowus", "acc-ibkr"]);

function entry(id, accountId, overrides = {}) {
  return {
    id,
    accountId,
    date: "2026-05-10",
    description: id,
    categoryName: "Transfer",
    entryType: "transfer",
    amountMinor: 0,
    ...overrides
  };
}

// A linked pair: `from` out on one account, `to` in on the other.
function pair(id, fromAccountId, toAccountId, amountMinor, { fromOverrides = {}, toOverrides = {} } = {}) {
  const from = entry(`${id}-out`, fromAccountId, { transferDirection: "out", amountMinor, linkedTransfer: { transactionId: `${id}-in`, accountName: toAccountId, amountMinor, transactionDate: "2026-05-10" }, ...fromOverrides });
  const to = entry(`${id}-in`, toAccountId, { transferDirection: "in", amountMinor, linkedTransfer: { transactionId: `${id}-out`, accountName: fromAccountId, amountMinor, transactionDate: "2026-05-10" }, ...toOverrides });
  return [from, to];
}

const sum = (entries) => sumInvestmentMoves(entries, entries, INVESTMENT_IDS);
const ids = (moves) => ({ into: moves.into.map((item) => item.id), outOf: moves.outOf.map((item) => item.id) });

test("a transfer into an investment account counts as moved in, linked or not, once per pair", () => {
  const linked = pair("dbs-endowus", "acc-dbs", "acc-endowus", 150_000);
  const unlinked = entry("ibkr-topup", "acc-ibkr", { transferDirection: "in", amountMinor: 40_000 });
  assert.deepEqual(sum([...linked, unlinked]), { intoMinor: 190_000, outOfMinor: 0 });
  // The cash side of the pair adds nothing: the investment account's own entry decides.
  assert.deepEqual(ids(findInvestmentMoves([...linked, unlinked], [...linked, unlinked], INVESTMENT_IDS)), { into: ["dbs-endowus-in", "ibkr-topup"], outOf: [] });
});

test("a withdrawal: a transfer out of an investment account back to a cash account is taken out", () => {
  const withdrawal = pair("endowus-dbs", "acc-endowus", "acc-dbs", 60_000);
  assert.deepEqual(sum(withdrawal), { intoMinor: 0, outOfMinor: 60_000 });
  // Unlinked, the investment side still says money left investments.
  assert.deepEqual(sum([entry("ibkr-cashout", "acc-ibkr", { transferDirection: "out", amountMinor: 25_000 })]), { intoMinor: 0, outOfMinor: 25_000 });
});

test("a GIRO filed under Investments that is also linked to the investment account counts once", () => {
  // The cash side stayed an expense filed under Investments (it is in the
  // category share already); its investment side adds nothing more.
  const giro = pair("giro", "acc-dbs", "acc-endowus", 30_000, { fromOverrides: { entryType: "expense", transferDirection: undefined, categoryName: "Investments" } });
  assert.equal(sum(giro), undefined);
  // Linked as a transfer (the cash side is a transfer now, so not in the
  // category share), the investment side is the one count.
  const linkedGiro = pair("giro-linked", "acc-dbs", "acc-endowus", 30_000, { fromOverrides: { categoryName: "Investments" } });
  assert.deepEqual(sum(linkedGiro), { intoMinor: 30_000, outOfMinor: 0 });

  // Through the shared split: $300 filed under Investments plus its linked
  // investment side is $300 invested, not $600.
  const figures = splitMoneyUse({ incomeMinor: 500_000, spentMinor: 230_000, investedMinor: 30_000, ...moneyUseMoves(sum(giro)) });
  assert.deepEqual([figures.spending, figures.invested, figures.kept], [200_000, 30_000, 270_000]);
});

test("a transfer between two investment accounts moves nothing", () => {
  assert.equal(sum(pair("endowus-ibkr", "acc-endowus", "acc-ibkr", 80_000)), undefined);
});

test("a transfer between cash accounts stays neutral", () => {
  const cash = pair("dbs-ocbc", "acc-dbs", "acc-ocbc", 90_000);
  assert.equal(sum(cash), undefined);
  // An expense or income on an investment account (a fee, a dividend) is
  // spending or income as before, not a move.
  assert.equal(sum([
    entry("fee", "acc-endowus", { entryType: "expense", categoryName: "Fees", amountMinor: 1_200 }),
    entry("dividend", "acc-endowus", { entryType: "income", categoryName: "Extra Income", amountMinor: 3_400 })
  ]), undefined);
  // No investment accounts at all: nothing to look for.
  assert.equal(sumInvestmentMoves(pair("x", "acc-dbs", "acc-endowus", 10_000), [], new Set()), undefined);
});

test("a person view counts only its own entries, and still finds the other side among every entry", () => {
  const [, endowusIn] = pair("joyce-endowus", "acc-joyce-bank", "acc-endowus", 70_000);
  const [ibkrOut, ibkrIn] = pair("endowus-ibkr", "acc-endowus", "acc-ibkr", 20_000);
  const all = [endowusIn, ibkrOut, ibkrIn];
  // The view shows only the IBKR side: its other side (Endowus, another
  // investment account) is not in the view but is still not a move.
  assert.equal(sumInvestmentMoves([ibkrIn], all, INVESTMENT_IDS), undefined);
  assert.deepEqual(sumInvestmentMoves([endowusIn], all, INVESTMENT_IDS), { intoMinor: 70_000, outOfMinor: 0 });
});

// The page's investmentMoves as splitMoneyUse takes them.
function moneyUseMoves(moves) {
  return { movedIntoInvestmentsMinor: moves?.intoMinor ?? 0, takenFromInvestmentsMinor: moves?.outOfMinor ?? 0 };
}

test("the shared split: invested is the Investments category plus transfers in, less withdrawals; kept is what is left", () => {
  const figures = splitMoneyUse({
    incomeMinor: 1_000_000,
    // The lead's spend: $5,000 spending and $1,000 filed under Investments.
    spentMinor: 600_000,
    investedMinor: 100_000,
    movedIntoInvestmentsMinor: 200_000,
    takenFromInvestmentsMinor: 50_000,
    plannedInvestMinor: 300_000
  });
  assert.deepEqual(
    { spending: figures.spending, invested: figures.invested, takenFromInvestments: figures.takenFromInvestments, kept: figures.kept },
    { spending: 500_000, invested: 250_000, takenFromInvestments: 0, kept: 250_000 }
  );
  // The Invest job reads the same invested.
  assert.deepEqual(listMoneyJobs({ figures }).map(({ key, actualMinor, gapMinor }) => [key, actualMinor, gapMinor]), [["invest", 250_000, 50_000]]);
});

test("a month that took more out of investments than it put in: invested is zero and the rest is its own line", () => {
  const figures = splitMoneyUse({ incomeMinor: 1_000_000, spentMinor: 500_000, investedMinor: 100_000, takenFromInvestmentsMinor: 350_000 });
  assert.deepEqual(
    { spending: figures.spending, invested: figures.invested, takenFromInvestments: figures.takenFromInvestments, kept: figures.kept },
    // The withdrawal is neither income nor kept: kept is income less spending.
    { spending: 400_000, invested: 0, takenFromInvestments: 250_000, kept: 600_000 }
  );

  const model = buildSavingsBarModel({ figures });
  assert.deepEqual(model.segments.map(({ key, legend }) => [key, legend.amount, legend.percent]), [["spent", "$4,000", 40], ["kept", "$6,000", 60]]);
  assert.deepEqual(model.takenOut, { name: "Took out of investments", amount: "$2,500" });
  assert.equal(model.sentence, "You kept $6,000 of the $10,000 you earned (60%)");
  // Hidden money leaves the line out: it has no share to show instead.
  const hidden = buildSavingsBarModel({ figures, hidden: true, formatMoney: () => { throw new Error("hidden money must not be formatted"); } });
  assert.equal(hidden.takenOut, null);
  // A month that put more in than it took out has no such line.
  assert.equal(buildSavingsBarModel({ figures: splitMoneyUse({ incomeMinor: 1_000_000, spentMinor: 500_000, movedIntoInvestmentsMinor: 100_000, takenFromInvestmentsMinor: 40_000 }) }).takenOut, null);
});

test("the Summary lead reads the page's investmentMoves: Saved drops by what moved into investments", () => {
  const cards = [
    { label: "Planned income", amountMinor: 1_200_000 },
    { label: "Actual income", amountMinor: 1_000_000, tone: "in" },
    { label: "Planned spend", amountMinor: 900_000 },
    { label: "Actual spend", amountMinor: 600_000 },
    { label: "Savings target", amountMinor: 200_000 },
    { label: "Realized savings", amountMinor: 400_000 },
    { label: "Planned investments", amountMinor: 300_000 }
  ];
  const categoryShare = [{ label: "Investments", valueMinor: 100_000 }, { label: "Groceries", valueMinor: 500_000 }];
  const before = buildSummaryLeadModel(cards, { categoryShare });
  assert.deepEqual([before.figures.invested, before.saved.amountMinor, before.spent.amountMinor], [100_000, 400_000, 500_000]);

  const after = buildSummaryLeadModel(cards, { categoryShare, investmentMoves: { intoMinor: 200_000, outOfMinor: 0 } });
  // Spent and its plan are unchanged; the $2,000 moved in is invested, not kept.
  assert.deepEqual(
    [after.figures.invested, after.saved.amountMinor, after.spent.amountMinor, after.plannedSpendMinor],
    [300_000, 200_000, 500_000, 400_000]
  );
});
