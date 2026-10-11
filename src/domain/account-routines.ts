// What each bank account does every month, and what changed: the payments
// that leave it on a schedule (a GIRO, a standing PayNow), the income that
// arrives in it, and the bank's own charges. The Summary and Month check-in
// reads these facts from the account pills (DOMAIN.md "Account routine").
// Pure: the caller loads the accounts and their entries and passes today.
//
// Nothing here guesses spending. The one look ahead is the scheduled check:
// a recorded statement balance against payments that already repeat from
// the same account at the same amount (DOMAIN.md "Scheduled check").
import { addDays, addMonths, daysBetween, daysInMonth, monthsBetween } from "./money-signals/format";
import type {
  AccountChargeDto,
  AccountCheckpointDto,
  IncomeMovedDto,
  MissedPaymentDto,
  OwnTransferIncomeDto,
  UpcomingShortfallDto
} from "../types/dto";

// How far back the entries must go: three months of a pattern before a
// change, and the change itself (about seven months).
export const ROUTINE_WINDOW_DAYS = 200;
// A charge is talked about for this long after it was made.
export const ACCOUNT_CHARGE_LOOKBACK_DAYS = 120;
// A missed payment, money moved between own accounts and moved income stay
// relevant for this long.
const MISSED_FOLLOW_DAYS = 75;
const OWN_TRANSFER_FOLLOW_DAYS = 120;
const MOVED_FOLLOW_DAYS = 150;
// The scheduled check reads a statement no older than this, and looks this
// far ahead.
export const SCHEDULED_BALANCE_MAX_AGE_DAYS = 40;
export const SCHEDULED_LOOKAHEAD_DAYS = 31;
// A payment's day may drift this many days either side of its usual day.
const DAY_DRIFT = 5;
// Only income of at least this much counts as a regular credit (salary,
// not interest).
const REGULAR_CREDIT_MIN_MINOR = 50_000;
const OWN_TRANSFER_MIN_MINOR = 5_000;

export interface RoutineAccount {
  id: string;
  name: string;
  kind: string;
  ownerPersonId?: string;
  checkpointHistory?: AccountCheckpointDto[];
}

export interface RoutineEntryRow {
  id: string;
  account_id: string;
  transaction_date: string;
  description: string;
  amount_minor: number;
  entry_type: string;
  transfer_direction: string | null;
  transfer_group_id: string | null;
  category_name: string | null;
}

export interface AccountRoutineFacts {
  incomeMoved?: IncomeMovedDto;
  missedPayments?: MissedPaymentDto[];
  accountCharges?: AccountChargeDto[];
  ownTransfersAsIncome?: OwnTransferIncomeDto[];
  upcomingShortfall?: UpcomingShortfallDto;
}

export function accountRoutineWindowStart(today: string) {
  return addDays(today, -ROUTINE_WINDOW_DAYS);
}

// Words that say how money moved, not who to: dropped from a payee's name.
const RAIL_WORDS = new Set([
  "IBG", "GIRO", "COLL", "INWARD", "DR", "CR", "FAST", "PAYNOW", "PAYMENT", "PAYMENTS", "SALA", "SALARY", "TRANS",
  "TRANSACTION", "OTHR", "OTHER", "VIA", "FUND", "FUNDS", "TRANSFER", "TO", "FROM", "PL", "PTE", "LTD", "THE", "UEN",
  "MOBILE", "DEBIT", "CREDIT", "BILL", "INTERNET", "BANKING", "INB", "QR", "CODE", "MONTHLY", "SVC", "CHARGE"
]);
// Brands written in capitals keep them.
const KEEP_CAPS = new Set(["HDB", "IRAS", "CPF", "NTUC", "OCBC", "UOB", "DBS", "POSB", "HSBC", "SP", "M1"]);

function isCodeWord(word: string) {
  return (word.match(/\d/g)?.length ?? 0) >= 4 || /^\d+$/.test(word) || /^[A-Z]\d{3,}$/.test(word);
}

function words(description: string) {
  return String(description ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

// The same payee on every statement line: codes and reference numbers go.
export function payeeKey(description: string) {
  return words(description).filter((word) => !isCodeWord(word)).join(" ");
}

// The payee as a person would say it: "IBG GIRO COLL P0593192 IFAST
// FINANCIAL PL- P0593192" reads "Ifast Financial".
export function payeeName(description: string) {
  const named = words(description).filter((word) => !isCodeWord(word) && !RAIL_WORDS.has(word) && word.length > 1);
  return named.slice(0, 2).map((word) => (KEEP_CAPS.has(word) ? word : word[0] + word.slice(1).toLowerCase())).join(" ");
}

// The first word that names the payer, for matching the same income across
// accounts whose banks word it differently ("IBG GIRO SALA ENCOUNTERS..."
// and "GIRO - SALARY SALA ENCOUNTERS...").
function payerWord(description: string) {
  return words(description).find((word) => word.length >= 4 && !isCodeWord(word) && !RAIL_WORDS.has(word)) ?? "";
}

// A bank account's own charges: a charge for a payment that could not be
// made, and the account's monthly fee.
export function classifyAccountCharge(description: string): AccountChargeDto["kind"] | null {
  const text = words(description).join(" ");
  if (/\bSVC CHARGE\b|\bRETURNED\b|\bUNSUCCESSFUL\b|\bREJECTED?\b|\bINSUFFICIENT\b/.test(text)) {
    return "failed_payment";
  }
  if (/^(?:SERVICE CHARGE|FALL BELOW(?: FEE)?|BELOW MIN(?:IMUM)? BALANCE(?: FEE)?|MONTHLY (?:ACCOUNT )?FEE|ACCOUNT FEE)$/.test(text)) {
    return "account_fee";
  }
  return null;
}

const month = (date: string) => date.slice(0, 7);
const signed = (row: RoutineEntryRow) => (row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in") ? 1 : -1) * Math.abs(row.amount_minor);

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 1;
}

// The day a payment falls on in a month: its usual day, kept inside the month.
function dueDateIn(monthKey: string, usualDay: number) {
  return `${monthKey}-${String(Math.min(usualDay, daysInMonth(monthKey))).padStart(2, "0")}`;
}

interface Series {
  accountId: string;
  key: string;
  name: string;
  amountMinor: number;
  dates: string[];
  usualDay: number;
  // The latest unbroken run of months it appeared in.
  runMonths: number;
  lastMonth: string;
}

function buildSeries(accountId: string, rows: RoutineEntryRow[], keyOf: (row: RoutineEntryRow) => string): Series[] {
  const groups = new Map<string, RoutineEntryRow[]>();
  for (const row of rows) {
    const key = `${keyOf(row)}|${Math.abs(row.amount_minor)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const dates = group.map((row) => row.transaction_date).sort();
    const months = [...new Set(dates.map(month))].sort();
    let runMonths = 1;
    for (let index = months.length - 1; index > 0 && monthsBetween(months[index - 1], months[index]) === 1; index -= 1) {
      runMonths += 1;
    }
    return {
      accountId,
      key,
      name: payeeName(group[0].description),
      amountMinor: Math.abs(group[0].amount_minor),
      dates,
      usualDay: median(dates.map((date) => Number(date.slice(8, 10)))),
      runMonths,
      lastMonth: months.at(-1) ?? ""
    };
  });
}

// The day the data for an account reaches: its latest entry or statement end.
function dataReach(rows: RoutineEntryRow[], account: RoutineAccount) {
  const latestEntry = rows.reduce((latest, row) => (row.transaction_date > latest ? row.transaction_date : latest), "");
  const latestStatement = latestCheckpoint(account)?.statementEndDate ?? "";
  return latestStatement > latestEntry ? latestStatement : latestEntry;
}

function latestCheckpoint(account: RoutineAccount) {
  return [...(account.checkpointHistory ?? [])]
    .filter((checkpoint) => checkpoint.statementEndDate)
    .sort((left, right) => (right.statementEndDate ?? "").localeCompare(left.statementEndDate ?? ""))[0];
}

export function buildAccountRoutineFacts(input: {
  accounts: RoutineAccount[];
  transactions: RoutineEntryRow[];
  today: string;
}): Map<string, AccountRoutineFacts> {
  const banks = input.accounts.filter((account) => account.kind === "bank");
  const bankById = new Map(banks.map((account) => [account.id, account]));
  const rowsByAccount = new Map<string, RoutineEntryRow[]>();
  for (const row of input.transactions) {
    if (bankById.has(row.account_id) && row.transaction_date <= input.today) {
      rowsByAccount.set(row.account_id, [...(rowsByAccount.get(row.account_id) ?? []), row]);
    }
  }

  const perAccount = new Map<string, { rows: RoutineEntryRow[]; reach: string; debits: Series[]; credits: Series[]; charges: Array<RoutineEntryRow & { kind: AccountChargeDto["kind"] }> }>();
  for (const account of banks) {
    const rows = (rowsByAccount.get(account.id) ?? []).sort((left, right) => left.transaction_date.localeCompare(right.transaction_date));
    const charges = rows.flatMap((row) => {
      const kind = row.entry_type === "expense" ? classifyAccountCharge(row.description) : null;
      return kind ? [{ ...row, kind }] : [];
    });
    const chargeIds = new Set(charges.map((row) => row.id));
    const debits = buildSeries(account.id, rows.filter((row) => row.entry_type === "expense" && !chargeIds.has(row.id)), (row) => payeeKey(row.description));
    const credits = buildSeries(
      account.id,
      rows.filter((row) => row.entry_type === "income" && Math.abs(row.amount_minor) >= REGULAR_CREDIT_MIN_MINOR),
      (row) => payerWord(row.description)
    );
    perAccount.set(account.id, { rows, reach: dataReach(rows, account), debits, credits, charges });
  }

  const facts = new Map<string, AccountRoutineFacts>();
  const add = (accountId: string, patch: AccountRoutineFacts) => facts.set(accountId, { ...facts.get(accountId), ...patch });

  for (const account of banks) {
    const data = perAccount.get(account.id)!;
    const missed = findMissedPayments(data.debits, data.charges, data.reach, input.today);
    if (missed.length) {
      add(account.id, { missedPayments: missed });
    }
    const chargeCutoff = addDays(input.today, -ACCOUNT_CHARGE_LOOKBACK_DAYS);
    const accountCharges = data.charges
      .filter((row) => row.transaction_date >= chargeCutoff)
      .map((row) => ({ date: row.transaction_date, kind: row.kind, amountMinor: Math.abs(row.amount_minor), ...(row.kind === "failed_payment" && payeeName(row.description) ? { payee: payeeName(row.description) } : {}) }));
    if (accountCharges.length) {
      add(account.id, { accountCharges });
    }
    const shortfall = findUpcomingShortfall(account, data, input.today);
    if (shortfall) {
      add(account.id, { upcomingShortfall: shortfall });
    }
  }

  for (const [accountId, moved] of findMovedIncome(banks, perAccount, input.today)) {
    add(accountId, { incomeMoved: moved });
  }
  for (const [accountId, items] of findOwnTransfersAsIncome(banks, perAccount, input.today)) {
    add(accountId, { ownTransfersAsIncome: items });
  }
  return facts;
}

// A payment that came every month (3 in a row) did not come the next month,
// and the account was charged for a failed payment to the same payee near
// its usual day: the bank tried and could not pay it.
function findMissedPayments(
  debits: Series[],
  charges: Array<RoutineEntryRow & { kind: AccountChargeDto["kind"] }>,
  reach: string,
  today: string
): MissedPaymentDto[] {
  const used = new Set<string>();
  const missed: MissedPaymentDto[] = [];
  const failed = charges.filter((row) => row.kind === "failed_payment");
  for (const series of [...debits].sort((left, right) => right.amountMinor - left.amountMinor)) {
    if (series.runMonths < 3) {
      continue;
    }
    const nextMonth = addMonths(series.lastMonth, 1);
    const due = dueDateIn(nextMonth, series.usualDay);
    if (reach < addDays(due, 3) || addDays(due, MISSED_FOLLOW_DAYS) < today) {
      continue;
    }
    const payeeFirstWord = words(series.name)[0] ?? "";
    const charge = failed.find((row) => !used.has(row.id)
      && Math.abs(daysBetween(due, row.transaction_date)) <= DAY_DRIFT
      && payeeFirstWord.length >= 3
      && words(row.description).includes(payeeFirstWord));
    if (!charge) {
      continue;
    }
    used.add(charge.id);
    missed.push({ payee: series.name, amountMinor: series.amountMinor, dueDate: charge.transaction_date, chargeMinor: Math.abs(charge.amount_minor) });
  }
  return missed.sort((left, right) => right.amountMinor - left.amountMinor);
}

// A payment series still scheduled on an account: it ran at least two
// months in a row, and it either came in the latest month the data covers
// for it or the bank tried and failed to make it.
function isScheduled(series: Series, reach: string, missed: MissedPaymentDto[]) {
  if (series.runMonths < 2) {
    return false;
  }
  const bounced = missed.some((item) => item.payee === series.name && item.amountMinor === series.amountMinor);
  let latestDue = series.lastMonth;
  // The months after its last one whose due day the data already covers.
  while (dueDateIn(addMonths(latestDue, 1), series.usualDay) <= reach) {
    latestDue = addMonths(latestDue, 1);
  }
  const monthsWithoutIt = monthsBetween(series.lastMonth, latestDue);
  return monthsWithoutIt === 0 || (bounced && monthsWithoutIt === 1);
}

// The scheduled check: the latest statement balance, plus what is recorded
// since, against the payments still scheduled on the account and the
// income still arriving there, due within the next month. It speaks only
// when a payment cannot fit.
function findUpcomingShortfall(
  account: RoutineAccount,
  data: { rows: RoutineEntryRow[]; reach: string; debits: Series[]; credits: Series[]; charges: Array<RoutineEntryRow & { kind: AccountChargeDto["kind"] }> },
  today: string
): UpcomingShortfallDto | undefined {
  const checkpoint = latestCheckpoint(account);
  if (!checkpoint?.statementEndDate || daysBetween(checkpoint.statementEndDate, today) > SCHEDULED_BALANCE_MAX_AGE_DAYS) {
    return undefined;
  }
  const statementEndDate = checkpoint.statementEndDate;
  const missed = findMissedPayments(data.debits, data.charges, data.reach, today);
  const balanceMinor = checkpoint.statementBalanceMinor
    + data.rows.filter((row) => row.transaction_date > statementEndDate).reduce((total, row) => total + signed(row), 0);
  const horizon = addDays(today, SCHEDULED_LOOKAHEAD_DAYS);
  const events: Array<{ date: string; amountMinor: number; payee?: string }> = [];
  for (const [list, sign] of [[data.debits, -1], [data.credits, 1]] as const) {
    for (const series of list) {
      if (!isScheduled(series, data.reach, sign < 0 ? missed : [])) {
        continue;
      }
      // Due dates the data does not reach yet, up to a month from today.
      for (let monthKey = addMonths(series.lastMonth, 1); ; monthKey = addMonths(monthKey, 1)) {
        const due = dueDateIn(monthKey, series.usualDay);
        if (due > horizon) {
          break;
        }
        if (due > data.reach) {
          events.push({ date: due, amountMinor: sign * series.amountMinor, ...(sign < 0 ? { payee: series.name } : {}) });
        }
      }
    }
  }
  events.sort((left, right) => left.date.localeCompare(right.date) || right.amountMinor - left.amountMinor);
  let running = balanceMinor;
  for (const event of events) {
    running += event.amountMinor;
    if (event.amountMinor < 0 && running < 0) {
      // Every payment due up to that day, so the line can say what it holds
      // against what is asked of it.
      const payments = events
        .filter((item) => item.amountMinor < 0 && item.date <= event.date)
        .map((item) => ({ payee: item.payee ?? "", amountMinor: -item.amountMinor, dueDate: item.date }));
      const creditsMinor = events.filter((item) => item.amountMinor > 0 && item.date <= event.date).reduce((total, item) => total + item.amountMinor, 0);
      const dueMinor = payments.reduce((total, item) => total + item.amountMinor, 0);
      return {
        statementEndDate,
        statementBalanceMinor: checkpoint.statementBalanceMinor,
        balanceMinor,
        payments,
        shortMinor: dueMinor - balanceMinor - creditsMinor,
        firstShortDate: event.date
      };
    }
  }
  return undefined;
}

// Regular income (3 months in a row into one account) that now arrives in
// another of the same person's accounts, while the old account still has
// payments scheduled on it.
function findMovedIncome(
  banks: RoutineAccount[],
  perAccount: Map<string, { rows: RoutineEntryRow[]; reach: string; debits: Series[]; credits: Series[]; charges: Array<RoutineEntryRow & { kind: AccountChargeDto["kind"] }> }>,
  today: string
) {
  const moved = new Map<string, IncomeMovedDto>();
  const byOwner = new Map<string, RoutineAccount[]>();
  for (const account of banks) {
    if (account.ownerPersonId) {
      byOwner.set(account.ownerPersonId, [...(byOwner.get(account.ownerPersonId) ?? []), account]);
    }
  }
  for (const accounts of byOwner.values()) {
    const incomes = accounts.flatMap((account) => perAccount.get(account.id)!.rows
      .filter((row) => row.entry_type === "income" && Math.abs(row.amount_minor) >= REGULAR_CREDIT_MIN_MINOR)
      .map((row) => ({ row, account })));
    const byPayer = new Map<string, typeof incomes>();
    for (const item of incomes) {
      const word = payerWord(item.row.description);
      if (word) {
        byPayer.set(word, [...(byPayer.get(word) ?? []), item]);
      }
    }
    for (const items of byPayer.values()) {
      const sorted = [...items].sort((left, right) => left.row.transaction_date.localeCompare(right.row.transaction_date));
      const latest = sorted.at(-1);
      if (!latest) {
        continue;
      }
      const newAccount = latest.account;
      const firstInNew = sorted.findIndex((item, index) => item.account.id === newAccount.id && sorted.slice(index).every((rest) => rest.account.id === newAccount.id));
      const before = sorted.slice(0, firstInNew);
      const oldAccount = before.at(-1)?.account;
      if (!oldAccount || oldAccount.id === newAccount.id) {
        continue;
      }
      const lastThree = before.slice(-3);
      const oldMonths = [...new Set(lastThree.map((item) => month(item.row.transaction_date)))];
      if (lastThree.length < 3 || lastThree.some((item) => item.account.id !== oldAccount.id) || oldMonths.length < 3 || monthsBetween(oldMonths[0], oldMonths[2]) !== 2) {
        continue;
      }
      const movedSince = sorted[firstInNew].row.transaction_date;
      if (addDays(movedSince, MOVED_FOLLOW_DAYS) < today) {
        continue;
      }
      const old = perAccount.get(oldAccount.id)!;
      const missed = findMissedPayments(old.debits, old.charges, old.reach, today);
      const otherAccountPayees = new Set(accounts
        .filter((account) => account.id !== oldAccount.id)
        .flatMap((account) => perAccount.get(account.id)!.rows.filter((row) => row.transaction_date >= movedSince).map((row) => payeeName(row.description))));
      const stillHere = old.debits.filter((series) => (
        series.runMonths >= 2
        && monthsBetween(series.lastMonth, month(movedSince)) <= 1
        && !otherAccountPayees.has(series.name)
        && isScheduled(series, old.reach, missed)
      ));
      if (!stillHere.length) {
        continue;
      }
      const checkpoint = latestCheckpoint(oldAccount);
      moved.set(oldAccount.id, {
        payer: payeeName(latest.row.description),
        isSalary: /salary/i.test(latest.row.category_name ?? ""),
        toAccountId: newAccount.id,
        toAccountName: newAccount.name,
        movedSince,
        payments: stillHere
          .sort((left, right) => right.amountMinor - left.amountMinor)
          .map((series) => ({ payee: series.name, amountMinor: series.amountMinor })),
        ...(checkpoint?.statementEndDate ? { statementEndDate: checkpoint.statementEndDate, statementBalanceMinor: checkpoint.statementBalanceMinor } : {})
      });
    }
  }
  return moved;
}

// Income into one of a person's bank accounts while the same amount left
// another of their bank accounts as a transfer within three days, with the
// two not linked: money moving between their own accounts, counted as
// income.
function findOwnTransfersAsIncome(
  banks: RoutineAccount[],
  perAccount: Map<string, { rows: RoutineEntryRow[] }>,
  today: string
) {
  const result = new Map<string, OwnTransferIncomeDto[]>();
  const cutoff = addDays(today, -OWN_TRANSFER_FOLLOW_DAYS);
  const used = new Set<string>();
  for (const account of banks) {
    if (!account.ownerPersonId) {
      continue;
    }
    const siblings = banks.filter((other) => other.id !== account.id && other.ownerPersonId === account.ownerPersonId);
    for (const row of perAccount.get(account.id)!.rows) {
      if (row.entry_type !== "income" || row.transfer_group_id || row.transaction_date < cutoff || Math.abs(row.amount_minor) < OWN_TRANSFER_MIN_MINOR) {
        continue;
      }
      for (const sibling of siblings) {
        const out = perAccount.get(sibling.id)!.rows.find((candidate) => !used.has(candidate.id)
          && candidate.entry_type === "transfer" && candidate.transfer_direction === "out" && !candidate.transfer_group_id
          && Math.abs(candidate.amount_minor) === Math.abs(row.amount_minor)
          && Math.abs(daysBetween(candidate.transaction_date, row.transaction_date)) <= 3);
        if (out) {
          used.add(out.id);
          result.set(account.id, [...(result.get(account.id) ?? []), {
            entryId: row.id,
            fromEntryId: out.id,
            date: row.transaction_date,
            fromDate: out.transaction_date,
            amountMinor: Math.abs(row.amount_minor),
            categoryName: row.category_name ?? "",
            fromAccountName: sibling.name
          }]);
          break;
        }
      }
    }
  }
  return result;
}
