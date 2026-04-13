import {
  daysBetween,
  normalizeMatchText,
  textOverlapScore
} from "./entry-helpers";
import { getRowDateValue } from "./table-helpers";

export function getDefaultMonthSectionOpen() {
  return {
    income: false,
    planned_items: true,
    budget_buckets: true
  };
}

export function buildMonthMetricCards({ planSections, incomeRows, currentMonthSummary }) {
  const flatPlanRows = planSections.flatMap((section) => section.rows);
  const plannedSpendMinor = flatPlanRows.reduce((sum, row) => sum + row.plannedMinor, 0);
  const actualSpendMinor = currentMonthSummary?.realExpensesMinor
    ?? flatPlanRows.reduce((sum, row) => sum + row.actualMinor, 0);
  const savingsTargetMinor = flatPlanRows
    .filter((row) => row.label === "Savings")
    .reduce((sum, row) => sum + row.plannedMinor, 0);
  const plannedIncomeMinor = incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
  const remainingBudgetMinor = plannedIncomeMinor - plannedSpendMinor;
  const spendGapMinor = plannedSpendMinor - actualSpendMinor;

  return [
    {
      label: "Planned income",
      amountMinor: plannedIncomeMinor
    },
    {
      label: "Planned spend",
      amountMinor: plannedSpendMinor
    },
    {
      label: "Remaining budget",
      amountMinor: remainingBudgetMinor,
      tone: remainingBudgetMinor >= 0 ? "positive" : "negative",
      detail: remainingBudgetMinor >= 0 ? "To allocate" : "Overplanned"
    },
    {
      label: "Actual spend",
      amountMinor: actualSpendMinor,
      tone: actualSpendMinor > plannedSpendMinor ? "negative" : "positive"
    },
    {
      label: "Savings target",
      amountMinor: savingsTargetMinor
    },
    {
      label: "Spend gap",
      amountMinor: spendGapMinor,
      tone: spendGapMinor >= 0 ? "positive" : "negative",
      detail: "Planned minus actual"
    }
  ];
}

export function getVisibleMonthAccounts(accounts, viewId) {
  const activeAccounts = accounts.filter((account) => account.isActive);
  if (viewId === "household") {
    return activeAccounts;
  }

  return activeAccounts.filter((account) => account.isJoint || account.ownerPersonId === viewId);
}

export function getMonthSectionTotals(rows) {
  const plannedMinor = rows.reduce((sum, row) => sum + row.plannedMinor, 0);
  const actualMinor = rows.reduce((sum, row) => sum + row.actualMinor, 0);
  return {
    plannedMinor,
    actualMinor,
    varianceMinor: plannedMinor - actualMinor
  };
}

export function getPlanRowById(planSections, rowId) {
  return planSections.flatMap((section) => section.rows).find((row) => row.id === rowId);
}

export function buildPlanLinkCandidates({ row, householdMonthEntries, monthEntries, monthKey }) {
  if (!row) {
    return [];
  }

  const linkedIds = new Set(row.linkedEntryIds ?? []);
  const rowCategory = normalizeMatchText(row.categoryName);
  const rowAccount = normalizeMatchText(row.accountName);
  const rowLabel = normalizeMatchText(row.label);
  const rowDate = getRowDateValue(row, monthKey);
  const rowAmount = Number(row.plannedMinor ?? 0);
  const hints = row.planMatchHints ?? [];
  const uniqueEntries = new Map();

  for (const entry of [...(householdMonthEntries ?? []), ...(monthEntries ?? [])]) {
    if (entry.entryType === "expense") {
      uniqueEntries.set(entry.id, entry);
    }
  }

  return [...uniqueEntries.values()]
    .map((entry) => {
      const entryCategory = normalizeMatchText(entry.categoryName);
      const entryAccount = normalizeMatchText(entry.accountName);
      const entryDescription = normalizeMatchText(entry.description);
      const reasons = [];
      let score = 0;

      if (linkedIds.has(entry.id)) {
        score += 1000;
        reasons.push("linked");
      }

      if (rowCategory && entryCategory === rowCategory) {
        score += 45;
        reasons.push("same category");
      }

      if (rowAccount && entryAccount === rowAccount) {
        score += 25;
        reasons.push("same account");
      }

      if (rowAmount > 0 && entry.amountMinor > 0) {
        const amountGap = Math.abs(rowAmount - entry.amountMinor);
        if (amountGap === 0) {
          score += 40;
          reasons.push("same amount");
        } else if (amountGap <= Math.max(100, Math.round(rowAmount * 0.08))) {
          score += 24;
          reasons.push("near amount");
        }
      }

      if (rowLabel && textOverlapScore(rowLabel, entryDescription) >= 0.5) {
        score += 35;
        reasons.push("description looks similar");
      }

      for (const hint of hints) {
        const hintPattern = normalizeMatchText(hint.descriptionPattern);
        if (hintPattern && entryDescription.includes(hintPattern)) {
          score += 120;
          reasons.push("remembered description");
        }
        if (typeof hint.amountMinor === "number" && hint.amountMinor === entry.amountMinor) {
          score += 24;
          reasons.push("remembered amount");
        }
        if (hint.accountName && normalizeMatchText(hint.accountName) === entryAccount) {
          score += 14;
        }
      }

      if (rowDate) {
        const dateGap = Math.abs(daysBetween(entry.date, rowDate));
        if (dateGap <= 3) {
          score += 18;
          reasons.push("near planned date");
        } else if (dateGap <= 10) {
          score += 8;
        }
      }

      return {
        ...entry,
        matchScore: score,
        matchReasons: [...new Set(reasons.filter((reason) => reason !== "linked"))]
      };
    })
    .filter((entry) => linkedIds.has(entry.id) || entry.matchScore > 0 || !hints.length)
    .sort((left, right) => right.matchScore - left.matchScore || right.date.localeCompare(left.date) || left.description.localeCompare(right.description))
    .slice(0, 80);
}
