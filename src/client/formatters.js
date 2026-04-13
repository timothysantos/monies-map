const moneyFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD"
});

export function money(valueMinor) {
  return moneyFormatter.format(valueMinor / 100);
}

export function minorToDecimalString(valueMinor) {
  return (Number(valueMinor ?? 0) / 100).toFixed(2);
}

export function decimalStringToMinor(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  return Math.round(normalized * 100);
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatDateOnly(value) {
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function formatMonthLabel(value) {
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    year: "numeric"
  }).format(new Date(Number(year), Number(month) - 1, 1));
}

export function formatMinorInput(valueMinor) {
  return (valueMinor / 100).toFixed(2);
}

export function formatEditableMinorInput(valueMinor) {
  const numeric = Number(valueMinor ?? 0) / 100;
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

export function parseMoneyInput(value, fallback) {
  const normalized = Number(value.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(normalized)) {
    return fallback;
  }

  return Math.round(normalized * 100);
}

export function parseDraftMoneyInput(value) {
  const normalized = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed * 100);
}

export function formatCheckpointCoverage(item) {
  if (item.statementStartDate && item.statementEndDate) {
    return `${formatDateOnly(item.statementStartDate)} - ${formatDateOnly(item.statementEndDate)}`;
  }

  if (item.statementEndDate) {
    return `Through ${formatDateOnly(item.statementEndDate)}`;
  }

  return `${formatMonthLabel(item.month)} calendar month`;
}

export function buildCheckpointExportHref(accountId, checkpointMonth) {
  const params = new URLSearchParams({
    accountId,
    checkpointMonth
  });
  return `/api/accounts/checkpoints/export?${params.toString()}`;
}

export function getContentDispositionFilename(value) {
  if (!value) {
    return null;
  }

  const filenameStar = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (filenameStar?.[1]) {
    return decodeURIComponent(filenameStar[1].replaceAll('"', ""));
  }

  const filename = value.match(/filename="?([^";]+)"?/i);
  return filename?.[1] ?? null;
}

export function formatCheckpointStatementInputMinor(valueMinor, accountKind) {
  const displayMinor = accountKind === "credit_card" ? Math.abs(valueMinor) : valueMinor;
  return formatMinorInput(displayMinor);
}

export function formatCheckpointHistoryBalanceLine(item, accountKind) {
  if (accountKind === "credit_card") {
    return `Statement owed ${money(Math.abs(item.statementBalanceMinor))} • Ledger owed ${money(Math.abs(item.computedBalanceMinor))}`;
  }

  return `Statement ${money(item.statementBalanceMinor)} • Ledger ${money(item.computedBalanceMinor)}`;
}

export function formatStatementReconciliationLine(item) {
  if (item.projectedLedgerBalanceMinor == null) {
    return `Statement ${money(item.statementBalanceMinor)}`;
  }

  if (item.accountKind === "credit_card") {
    return `Statement owed ${money(Math.abs(item.statementBalanceMinor))} • Ledger owed ${money(Math.abs(item.projectedLedgerBalanceMinor))}`;
  }

  return `Statement ${money(item.statementBalanceMinor)} • Ledger ${money(item.projectedLedgerBalanceMinor)}`;
}
