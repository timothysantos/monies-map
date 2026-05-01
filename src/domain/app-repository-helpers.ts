import { getCurrentMonthKey } from "../lib/month";
import type {
  AccountDto,
  EntryDto,
  EntrySplitDto,
  ImportPreviewRowDto,
  MonthPlanRowDto,
  StatementCompareRowDto
} from "../types/dto";

export function normalizeAccountOpeningBalanceMinor(value: number, accountKind?: string | null) {
  if (accountKind === "credit_card") {
    // Credit-card inputs are bank-facing: positive means amount owed, negative
    // means a credit balance. Internally, owed balances are liabilities.
    return -value;
  }

  return value;
}

export function normalizeStatementBalanceInputMinor(value: number, accountKind?: string | null) {
  if (accountKind === "credit_card") {
    // Statement balances follow the same bank-facing convention as opening
    // balances, so a printed negative card balance becomes an internal credit.
    return -value;
  }

  return value;
}

export function normalizeStoredStatementBalanceMinor(
  value: number,
  accountKind?: string | null,
  computedBalanceMinor?: number
) {
  if (accountKind !== "credit_card") {
    return value;
  }

  const bankFacingStoredMinor = -value;
  const legacyInternalStoredMinor = value;
  if (computedBalanceMinor == null) {
    return bankFacingStoredMinor;
  }

  return Math.abs(computedBalanceMinor - legacyInternalStoredMinor) < Math.abs(computedBalanceMinor - bankFacingStoredMinor)
    ? legacyInternalStoredMinor
    : bankFacingStoredMinor;
}

export function computeCheckpointLedgerBalanceMinor(input: {
  openingBalanceMinor: number;
  checkpoint: {
    account_id: string;
    checkpoint_month: string;
    statement_start_date: string | null;
    statement_end_date: string | null;
  };
  rows: {
    account_id: string;
    cleared_date: string;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    amount_minor: number;
  }[];
}) {
  const statementEndDate = input.checkpoint.statement_end_date ?? getMonthEndDate(input.checkpoint.checkpoint_month);
  let balanceMinor = input.openingBalanceMinor;

  for (const row of input.rows) {
    if (row.account_id !== input.checkpoint.account_id || row.cleared_date > statementEndDate) {
      continue;
    }

    // Statement-start rows are still part of the balance baseline, but the export
    // presents them separately from the statement-cycle movement.
    balanceMinor += getSignedLedgerAmountMinor(row);
  }

  return balanceMinor;
}

export function getSignedLedgerAmountMinor(row: {
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  amount_minor: number;
}) {
  return row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
    ? Number(row.amount_minor)
    : -Number(row.amount_minor);
}

export function buildAccountHealth(input: {
  accountId: string;
  openingBalanceMinor: number;
  currentLedgerBalanceMinor: number;
  latestTransactionDate?: string;
  latestImportAt?: string;
  unresolvedTransferCount: number;
  checkpoint?: {
    account_id: string;
    checkpoint_month: string;
    statement_start_date: string | null;
    statement_end_date: string | null;
    statement_balance_minor: number;
    note: string | null;
  };
  accountKind?: string;
  checkpointLedgerNetMinor?: number;
  checkpointHistory?: AccountDto["checkpointHistory"];
}) {
  const checkpointComputedBalanceMinor = input.checkpoint
    ? input.checkpointLedgerNetMinor ?? input.openingBalanceMinor
    : undefined;
  const checkpointStatementBalanceMinor = input.checkpoint
    ? normalizeStoredStatementBalanceMinor(
      Number(input.checkpoint.statement_balance_minor ?? 0),
      input.accountKind,
      checkpointComputedBalanceMinor
    )
    : undefined;
  const checkpointDeltaMinor = input.checkpoint && checkpointComputedBalanceMinor != null
    ? checkpointComputedBalanceMinor - (checkpointStatementBalanceMinor ?? 0)
    : undefined;

  let reconciliationStatus: AccountDto["reconciliationStatus"];
  if (input.checkpoint) {
    reconciliationStatus = checkpointDeltaMinor === 0 ? "matched" : "mismatch";
  } else if (input.latestTransactionDate) {
    reconciliationStatus = "needs_checkpoint";
  }

  return {
    balanceMinor: input.currentLedgerBalanceMinor,
    latestTransactionDate: input.latestTransactionDate,
    latestImportAt: input.latestImportAt,
    unresolvedTransferCount: input.unresolvedTransferCount,
    latestCheckpointMonth: input.checkpoint?.checkpoint_month,
    latestCheckpointStartDate: input.checkpoint?.statement_start_date ?? undefined,
    latestCheckpointEndDate: input.checkpoint?.statement_end_date ?? undefined,
    latestCheckpointBalanceMinor: checkpointStatementBalanceMinor,
    latestCheckpointComputedBalanceMinor: checkpointComputedBalanceMinor,
    latestCheckpointDeltaMinor: checkpointDeltaMinor,
    latestCheckpointNote: input.checkpoint?.note ?? undefined,
    reconciliationStatus,
    checkpointHistory: input.checkpointHistory ?? []
  };
}

export function findStatementCompareDuplicateGroups(rows: StatementCompareRowDto[]) {
  const groups = new Map<string, StatementCompareRowDto[]>();
  for (const row of rows) {
    const key = [
      row.date,
      row.signedAmountMinor,
      normalizeDescriptionForMatch(row.description)
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((rows) => ({ rows }))
    .sort((left, right) => (
      right.rows.length - left.rows.length
      || (left.rows[0]?.date ?? "").localeCompare(right.rows[0]?.date ?? "")
    ))
    .slice(0, 12);
}

export function getMonthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return [monthStart, nextMonth] as const;
}

export function getMonthEndDate(month: string) {
  const [, nextMonth] = getMonthBounds(month);
  const date = new Date(`${nextMonth}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function normalizeStatementDate(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function formatMoneyCsvMinor(valueMinor: number) {
  return (Number(valueMinor) / 100).toFixed(2);
}

export function escapeCsvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function hasSetIntersection(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) {
    return false;
  }

  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

export function buildPlanDate(month: string, dayLabel?: string) {
  if (!dayLabel || !/^\d+$/.test(dayLabel)) {
    return null;
  }

  return `${month}-${dayLabel.padStart(2, "0")}`;
}

export function inferMonthKeyFromPlanRow(id: string) {
  const match = id.match(/plan-(\d{4}-\d{2})-/);
  return match?.[1] ?? getCurrentMonthKey();
}

export function nextMonthKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftPlanDate(planDate: string | null, year: number, month: number) {
  if (!planDate) {
    return null;
  }

  const day = new Date(`${planDate}T00:00:00Z`).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildSnapshotRowsForScope(rows: MonthPlanRowDto[], personScope: string) {
  if (personScope === "household") {
    return rows;
  }

  return rows.filter((row) => (
    row.personId === personScope || row.splits.some((split) => split.personId === personScope)
  ));
}

export function sumVisibleExpenseMinor(entries: EntryDto[], personScope: string) {
  return entries.reduce((sum, entry) => {
    if (entry.entryType !== "expense") {
      return sum;
    }

    if (personScope === "household") {
      return sum + entry.amountMinor;
    }

    if (entry.ownershipType === "direct") {
      return entry.splits.some((split) => split.personId === personScope)
        ? sum + entry.amountMinor
        : sum;
    }

    const split = entry.splits.find((item) => item.personId === personScope);
    return split ? sum + split.amountMinor : sum;
  }, 0);
}

export function weekdayLabel(date: string) {
  return new Intl.DateTimeFormat("en-SG", {
    weekday: "short",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

export function mapAccountKind(kind: string) {
  switch (kind) {
    case "credit_card":
      return "credit_card";
    case "bank":
      return "bank";
    default:
      return "bank";
  }
}

export function normalizeImportRow(rawRow: Record<string, string>) {
  const entries = Object.entries(rawRow).reduce<Record<string, string>>((accumulator, [key, value]) => {
    accumulator[key.trim().toLowerCase()] = value.trim();
    return accumulator;
  }, {});

  const rawDate = firstDefined(entries, ["date", "transaction date", "posting date", "posted date"]);
  const description = firstDefined(entries, ["description", "details", "narrative", "merchant", "memo"]);
  const accountId = firstDefined(entries, ["accountid", "account id"]);
  const accountName = firstDefined(entries, ["account", "wallet", "account name", "source account"]);
  const categoryName = firstDefined(entries, ["category"]);
  const note = firstDefined(entries, ["note", "notes", "remarks"]);

  const signedAmount = parseMoneyToMinor(firstDefined(entries, ["amount", "transaction amount", "amt", "value"]));
  const debitAmount = parseMoneyToMinor(firstDefined(entries, ["expense", "debit", "withdrawal", "outflow"]));
  const creditAmount = parseMoneyToMinor(firstDefined(entries, ["income", "credit", "deposit", "inflow"]));
  const transferFlag = firstDefined(entries, ["type", "transaction type"])?.toLowerCase() === "transfer";

  let amountMinor = 0;
  let entryType: "expense" | "income" | "transfer" = "expense";
  let transferDirection: "in" | "out" | undefined;

  if (typeof signedAmount === "number") {
    amountMinor = Math.abs(signedAmount);
    entryType = signedAmount < 0 ? "expense" : "income";
  } else if (typeof debitAmount === "number" && debitAmount > 0) {
    amountMinor = debitAmount;
    entryType = "expense";
  } else if (typeof creditAmount === "number" && creditAmount > 0) {
    amountMinor = creditAmount;
    entryType = "income";
  }

  if (transferFlag) {
    entryType = "transfer";
    if (typeof creditAmount === "number" && creditAmount > 0) {
      transferDirection = "in";
    } else if (typeof debitAmount === "number" && debitAmount > 0) {
      transferDirection = "out";
    } else {
      transferDirection = typeof signedAmount === "number" && signedAmount >= 0 ? "in" : "out";
    }
  }

  const errors: string[] = [];
  const date = rawDate ? normalizeDateString(rawDate) : undefined;
  if (!date) {
    errors.push("missing date");
  }
  if (!description) {
    errors.push("missing description");
  }
  if (typeof amountMinor !== "number" || amountMinor <= 0) {
    errors.push("missing amount");
  }

  return {
    date,
    description,
    accountId,
    accountName,
    categoryName,
    note,
    amountMinor,
    entryType,
    transferDirection,
    errors
  };
}

export function firstDefined(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function parseMoneyToMinor(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return Math.round(parsed * 100);
}

export function normalizeDateString(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

export function extractTransactionDateHint(value?: string) {
  if (!value) {
    return undefined;
  }

  const explicitMatch = value.match(/\b(?:txn|transaction)\s+date\s*:?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\b/i);
  if (explicitMatch?.[1]) {
    return normalizeDateString(explicitMatch[1]);
  }

  return undefined;
}

export function buildImportRowHash(row: ImportPreviewRowDto) {
  return `${row.date}|${row.description}|${row.amountMinor}|${row.accountId ?? row.accountName ?? ""}|${row.entryType}`;
}

export function formatMoneyMinor(valueMinor: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD"
  }).format(valueMinor / 100);
}

export function daysBetween(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

export function diffDays(left: string, right: string) {
  return Math.abs(daysBetween(left, right));
}

export function countSharedTokens(left: string, right: string) {
  const leftTokens = new Set(normalizeDescriptionForMatch(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeDescriptionForMatch(right).split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

export function compareDescriptionSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeDescriptionForMatch(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeDescriptionForMatch(right).split(" ").filter(Boolean));
  const compactSimilarity = compareCompactDescriptionSimilarity(left, right);
  if (!leftTokens.size || !rightTokens.size) {
    return compactSimilarity;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return Math.max(compactSimilarity, overlap / Math.max(leftTokens.size, rightTokens.size));
}

function compareCompactDescriptionSimilarity(left: string, right: string) {
  const leftCompact = normalizeDescriptionForMatch(left).replaceAll(" ", "");
  const rightCompact = normalizeDescriptionForMatch(right).replaceAll(" ", "");
  if (!leftCompact || !rightCompact) {
    return 0;
  }

  if (leftCompact === rightCompact) {
    return 1;
  }

  const shorter = leftCompact.length < rightCompact.length ? leftCompact : rightCompact;
  const longer = leftCompact.length < rightCompact.length ? rightCompact : leftCompact;
  if (shorter.length >= 6 && longer.includes(shorter)) {
    return 0.9;
  }

  return 0;
}

export function normalizeDescriptionForMatch(value: string) {
  const canonicalized = value
    .toLowerCase()
    .replace(/\bcs\s+fresh\b/g, "cold storage")
    .replace(/\bcoldstorage\b/g, "cold storage")
    .replace(/\bcs\b/g, "cold storage");

  return canonicalized
    .replace(/\b(singapore|sg|applepay|apple\s+pay)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizePlanMatchHint(value: string) {
  return normalizeDescriptionForMatch(value);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function groupSplits<T extends { person_id: string; ratio_basis_points: number; amount_minor: number; display_name: string }>(
  rows: (T & Record<string, string>)[],
  keyName: string
) {
  const map = new Map<string, EntrySplitDto[]>();

  for (const row of rows) {
    const key = row[keyName] as string;
    const current = map.get(key) ?? [];
    current.push({
      personId: row.person_id,
      personName: row.display_name,
      ratioBasisPoints: row.ratio_basis_points,
      amountMinor: row.amount_minor
    });
    map.set(key, current);
  }

  return map;
}
