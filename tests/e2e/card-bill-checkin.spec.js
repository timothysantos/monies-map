// The check-in reads a card's latest statement: a bill due within a week
// with no payment yet is a quick fix, and a late charge with no reversal is
// worth a look. A new card of Joyce's gets a statement through the real
// import (dates are relative to today, because the Worker's "today" is the
// real one), then her Summary says so.
import { expect, test } from "@playwright/test";

import { loadSummaryAccountPills, postJson, reseedDemo } from "./helpers.js";

function isoDay(offsetDays) {
  const date = new Date(Date.now() + 8 * 3_600_000);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function shortDay(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${weekday} ${date.getUTCDate()} ${month}`;
}

test("a card bill due in 3 days and an unreversed late charge reach the account pills and Joyce's check-in", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.route("**/api/ai-assist/financial-insight", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  await page.goto("/");
  await reseedDemo(page);
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: "Test Card",
    institution: "OCBC",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor: 0,
    ownerPersonId: "person-joyce",
    isJoint: false
  });
  const statementEnd = isoDay(-9);
  const dueDate = isoDay(3);
  const checkpoint = {
    accountId,
    accountName: "Test Card",
    checkpointMonth: statementEnd.slice(0, 7),
    statementStartDate: isoDay(-39),
    statementEndDate: statementEnd,
    statementBalanceMinor: 13315,
    paymentDueDate: dueDate,
    minimumPaymentMinor: 5000,
    notices: [{ code: "penalty_interest", annualRatePercent: 30.78 }],
    note: "Imported from OCBC credit card statement"
  };
  const rows = [
    { date: isoDay(-12), description: "SHOPEE SG MP", expense: "33.15", income: "", account: "Test Card", category: "Shopping", type: "expense", note: "" },
    { date: isoDay(-11), description: "LATE CHARGE", expense: "100.00", income: "", account: "Test Card", category: "Fees", type: "expense", note: "" }
  ];
  const preview = await postJson(page, "/api/imports/preview", {
    sourceLabel: "Test Card statement", sourceType: "pdf", rows, ownershipType: "direct", ownerName: "Joyce", statementCheckpoints: [checkpoint]
  });
  expect(preview.preview.statementReconciliations[0].status).toBe("matched");
  await postJson(page, "/api/imports/commit", {
    sourceLabel: "Test Card statement",
    sourceType: "pdf",
    parserKey: "ocbc_365_credit_card_pdf",
    statementCheckpoints: [checkpoint],
    statementControlRows: preview.preview.previewRows,
    statementReconciliations: preview.preview.statementReconciliations,
    rows: preview.preview.previewRows.filter((row) => row.commitStatus === "included")
  });

  const pills = await loadSummaryAccountPills(page, { view: "person-joyce" });
  const pill = pills.accountPills.find((item) => item.accountId === accountId);
  expect(pill.cardBill).toEqual({
    statementMonth: statementEnd.slice(0, 7),
    statementEndDate: statementEnd,
    paymentDueDate: dueDate,
    owedMinor: 13315,
    minimumMinor: 5000,
    paidSinceMinor: 0
  });
  expect(pill.unreversedCharges).toEqual([{ date: isoDay(-11), kind: "late_fee", amountMinor: 10000 }]);
  expect(pill.cardNotices).toEqual({ statementMonth: statementEnd.slice(0, 7), owedMinor: 13315, notices: [{ code: "penalty_interest", annualRatePercent: 30.78 }] });

  // Joyce's Summary leads with the bill.
  await page.goto(`/summary?view=person-joyce&month=${isoDay(0).slice(0, 7)}&scope=direct_plus_shared`);
  const insight = page.locator(".financial-insight-summary");
  await expect(insight.locator(".financial-insight-narrative")).toBeVisible({ timeout: 30_000 });
  const narrative = (await insight.innerText()).replace(/\s+/g, " ");
  const billLines = [
    `Your Test Card bill of $133.15 is due in 3 days (${shortDay(dueDate)}), and no payment to it is in the app yet.`,
    `$133.15 on your Test Card is due in 3 days (${shortDay(dueDate)}).`,
    `Your Test Card statement asks for $133.15, due in 3 days (${shortDay(dueDate)}).`,
    `Coming up: your Test Card bill of $133.15, due in 3 days (${shortDay(dueDate)}).`
  ];
  expect(billLines.some((line) => narrative.includes(line)), narrative).toBe(true);
  // The late charge and the penalty rate are in the full list.
  await insight.getByRole("button", { name: "See all insights" }).click();
  const all = (await insight.innerText()).replace(/\s+/g, " ");
  expect(all, all).toMatch(/Test Card (was charged a \$100\.00 late charge|from .* hasn't been reversed)|No reversal yet for a \$100\.00 late charge|The bank charged your Test Card a \$100\.00 late charge/);
  expect(all, all).toContain("30.78% a year");
  expect(all, all).toContain("$133.15");
  await insight.screenshot({ path: test.info().outputPath("card-bill-checkin.png") });
});
