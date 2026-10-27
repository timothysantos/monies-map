// Detectors 4 and 6: the account's statements against its ledger.
//
// A statement here is a statement checkpoint with a certificate from a
// completed import. A certificate with status `certified` proves the ledger
// matched that statement's balance when it was saved ("proven").
//
// - statement_gap: two statements with whole months between them in which the
//   account has entries but no statement of its own (the missing September
//   statement of a bank account).
// - the balance chain: for an account's last proven statements, the ledger
//   balance at each end date (the opening balance plus every completed entry
//   cleared up to it, exactly as the account's statement comparison adds it)
//   against the statement balance, in the same signs
//   (`normalizeStoredStatementBalanceMinor`). Proven statements matched when
//   saved, so a difference now means the ledger changed afterwards.
//   - the first differing statement is not the latest and the latest still
//     differs: statement_join (the later statement does not pick up where the
//     earlier one ended);
//   - the latest differs and nothing earlier did (or only the first of the
//     window): balance_mismatch, `high` when the entries added after the
//     statement was proven add up to the difference exactly, `check` when they
//     do not (an edit or a removal changed it, the cause is not provable here).
//   A difference that has since healed (the latest matches again) is silent.
import { normalizeAccountOpeningBalanceMinor, normalizeStoredStatementBalanceMinor } from "../app-repository-helpers";
import { IMPORTS_PATH, SETTINGS_PATH, accountLabel, accountPeople, clip, finding, money, monthName, monthsBetween, nextMonthKey, shortDate, shortId } from "./helpers";
import type { AccountFact, CheckupContext, CheckupEvidence, DetectedFinding } from "./types";

// How many of an account's latest proven statements the balance chain reads.
export const STATEMENT_CHAIN_LENGTH = 8;
// A gap is `high` only with at least this many entries in the missing month.
const GAP_HIGH_MIN_ENTRIES = 5;
// ... and an account whose statements run monthly: this many consecutive pairs elsewhere.
const GAP_HIGH_MIN_MONTHLY_PAIRS = 2;
// An entry created within this long after the certificate belongs to the import itself.
export const CERTIFICATE_GRACE_MINUTES = 1;

export interface StatementFact {
  accountId: string;
  month: string;
  startDate: string | null;
  endDate: string;
  // As stored (`account_balance_checkpoints.statement_balance_minor`).
  balanceMinor: number;
  // Certificate status `certified` on a completed import.
  proven: boolean;
  // When the newest certificate for the month was saved (stored timestamp).
  certifiedAt: string;
}

// The signed ledger movement of one proven statement's own stretch: entries
// cleared after the previous statement of the window ended (the first one:
// all of history) up to its own end date.
export interface StatementSegmentFact {
  accountId: string;
  month: string;
  netMinor: number;
  entryCount: number;
}

export interface MonthActivityFact {
  accountId: string;
  month: string;
  entryCount: number;
}

export interface ChainBreakFact {
  accountId: string;
  month: string;
}

// Entries created after an account's latest proven statement was saved and
// cleared on or before its end date (the read that explains a mismatch).
export interface LaterEntriesFact {
  accountId: string;
  entryCount: number;
  netMinor: number;
  sample: Array<{ id: string; description: string; date: string; amountMinor: number; entryType: string }>;
}

export interface StatementFacts {
  statements: StatementFact[];
  segments: StatementSegmentFact[];
  activity: MonthActivityFact[];
  chainBreaks: ChainBreakFact[];
  laterEntries: LaterEntriesFact[];
}

export interface ChainPoint {
  statement: StatementFact;
  ledgerBalanceMinor: number;
  statementBalanceMinor: number;
  deltaMinor: number;
}

// The last proven statements of one account with the ledger balance at each.
export function buildStatementChain(account: { kind: string; openingBalanceMinor: number }, statements: StatementFact[], segments: StatementSegmentFact[]): ChainPoint[] {
  const proven = statements
    .filter((statement) => statement.proven)
    .sort((left, right) => left.endDate.localeCompare(right.endDate) || left.month.localeCompare(right.month))
    .slice(-STATEMENT_CHAIN_LENGTH);
  const netByMonth = new Map(segments.map((segment) => [segment.month, segment.netMinor]));
  let ledger = normalizeAccountOpeningBalanceMinor(account.openingBalanceMinor, account.kind);
  return proven.map((statement) => {
    ledger += netByMonth.get(statement.month) ?? 0;
    const statementBalanceMinor = normalizeStoredStatementBalanceMinor(statement.balanceMinor, account.kind, ledger);
    return { statement, ledgerBalanceMinor: ledger, statementBalanceMinor, deltaMinor: ledger - statementBalanceMinor };
  });
}

function groupBy<T>(items: T[], keyOf: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  }
  return groups;
}

function statementEvidence(point: ChainPoint, account: string, context: CheckupContext, note: string): CheckupEvidence {
  return {
    role: "statement",
    label: `${account} statement for ${monthName(point.statement.month, context.today)}`,
    date: point.statement.endDate,
    amountMinor: Math.abs(point.statementBalanceMinor),
    accountName: account,
    note
  };
}

export function detectStatementGaps(facts: StatementFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const activityByAccount = groupBy(facts.activity, (item) => item.accountId);
  const breaksByAccount = groupBy(facts.chainBreaks, (item) => item.accountId);
  for (const [accountId, statements] of groupBy(facts.statements, (item) => item.accountId)) {
    const account = context.accounts.get(accountId);
    if (!account || !account.isActive) {
      continue;
    }
    const months = [...new Set(statements.map((statement) => statement.month))].sort();
    const monthly = new Set(months);
    const monthlyPairs = months.filter((month) => monthly.has(nextMonthKey(month))).length;
    const activity = new Map((activityByAccount.get(accountId) ?? []).map((item) => [item.month, item.entryCount]));
    const label = accountLabel(context, accountId);
    for (let index = 0; index + 1 < months.length; index += 1) {
      const [before, after] = [months[index], months[index + 1]];
      const missing = monthsBetween(before, after).filter((month) => (activity.get(month) ?? 0) > 0);
      if (!missing.length) {
        continue;
      }
      const recordedBreak = (breaksByAccount.get(accountId) ?? []).some((item) => missing.includes(item.month));
      const entries = missing.reduce((sum, month) => sum + (activity.get(month) ?? 0), 0);
      // Sure when a removed statement is on record, or when exactly one month is
      // missing, it holds real activity, and the statements run monthly elsewhere.
      const isSure = recordedBreak
        || (monthsBetween(before, after).length === 1 && entries >= GAP_HIGH_MIN_ENTRIES && monthlyPairs >= GAP_HIGH_MIN_MONTHLY_PAIRS);
      const names = missing.map((month) => monthName(month, context.today));
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
      const [first, second] = [statements.find((item) => item.month === before)!, statements.find((item) => item.month === after)!];
      findings.push(finding({
        kind: "statement_gap",
        subject: `${accountId}:${missing.join(",")}`,
        tier: isSure ? "high" : "check",
        title: missing.length > 1 ? "Statements are missing" : "A statement is missing",
        summary: `${label} has a statement for ${monthName(before, context.today)} and one for ${monthName(after, context.today)}, but none for ${list}, a month it has ${entries} ${entries === 1 ? "entry" : "entries"} in. Until that statement is added, nothing proves those entries.`,
        evidence: [
          { role: "statement", label: `${label} statement for ${monthName(before, context.today)}`, date: first.endDate, accountName: label, note: "the one before the gap" },
          { role: "statement", label: `${label} statement for ${monthName(after, context.today)}`, date: second.endDate, accountName: label, note: "the one after the gap" },
          ...missing.map((month) => ({ role: "fact" as const, label: `${activity.get(month)} ${activity.get(month) === 1 ? "entry" : "entries"} in ${monthName(month, context.today)} with no statement`, accountName: label })),
          ...(recordedBreak ? [{ role: "fact" as const, label: "A statement for this month was removed earlier" }] : [])
        ],
        amountMinor: null,
        occurredOn: second.endDate,
        personIds: accountPeople(account),
        fix: { label: `Upload the missing ${label} statement in Imports`, path: IMPORTS_PATH },
        facts: [accountId, ...missing, entries, before, after]
      }));
    }
  }
  return findings;
}

// The first point of the chain that differs, and what the latest says.
function readChain(points: ChainPoint[]) {
  const latest = points[points.length - 1];
  const firstBreak = points.findIndex((point) => point.deltaMinor !== 0);
  return { latest, firstBreak };
}

export function detectStatementJoins(facts: StatementFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const segmentsByAccount = groupBy(facts.segments, (item) => item.accountId);
  for (const [accountId, statements] of groupBy(facts.statements, (item) => item.accountId)) {
    const account = context.accounts.get(accountId);
    if (!account || !account.isActive) {
      continue;
    }
    const points = buildStatementChain(account, statements, segmentsByAccount.get(accountId) ?? []);
    const { latest, firstBreak } = readChain(points);
    // Only a break in the middle of the window that the latest still carries:
    // the first window statement has no earlier one to join, and a healed
    // chain is fine.
    if (!latest || firstBreak <= 0 || firstBreak >= points.length - 1 || latest.deltaMinor === 0) {
      continue;
    }
    const broken = points[firstBreak];
    const previous = points[firstBreak - 1];
    // A month with no statement between them is the missing statement's
    // finding (statement_gap); a join is only judged between consecutive months.
    if (nextMonthKey(previous.statement.month) !== broken.statement.month) {
      continue;
    }
    const label = accountLabel(context, accountId);
    findings.push(finding({
      kind: "statement_join",
      subject: `${accountId}:${broken.statement.month}`,
      tier: "check",
      title: "Statements do not join up",
      summary: `${label} matched its ${monthName(previous.statement.month, context.today)} statement, but not the ${monthName(broken.statement.month, context.today)} one: the entries between them are ${money(Math.abs(broken.deltaMinor))} ${broken.deltaMinor > 0 ? "more" : "less"} than the statement shows, and the ${monthName(latest.statement.month, context.today)} statement is still ${money(Math.abs(latest.deltaMinor))} off.`,
      evidence: [
        statementEvidence(previous, label, context, "matched the entries"),
        statementEvidence(broken, label, context, `the entries come to ${money(broken.ledgerBalanceMinor)}, ${money(Math.abs(broken.deltaMinor))} ${broken.deltaMinor > 0 ? "more" : "less"}`),
        statementEvidence(latest, label, context, `still ${money(Math.abs(latest.deltaMinor))} off`)
      ],
      amountMinor: Math.abs(broken.deltaMinor),
      occurredOn: broken.statement.endDate,
      personIds: accountPeople(account),
      fix: { label: "Compare the statement in Settings", path: SETTINGS_PATH },
      facts: [accountId, broken.statement.month, broken.deltaMinor, latest.statement.month, latest.deltaMinor]
    }));
  }
  return findings;
}

// Accounts whose latest proven statement differs from the ledger and whose
// chain broke at that statement (the read that explains them is made for these).
export function accountsNeedingMismatchCause(facts: Pick<StatementFacts, "statements" | "segments">, accounts: ReadonlyMap<string, AccountFact>) {
  const segmentsByAccount = groupBy(facts.segments, (item) => item.accountId);
  const needing: Array<{ accountId: string; month: string; certifiedAt: string; endDate: string }> = [];
  for (const [accountId, statements] of groupBy(facts.statements, (item) => item.accountId)) {
    const account = accounts.get(accountId);
    if (!account || !account.isActive) {
      continue;
    }
    const points = buildStatementChain(account, statements, segmentsByAccount.get(accountId) ?? []);
    const { latest, firstBreak } = readChain(points);
    if (latest && latest.deltaMinor !== 0 && (firstBreak === 0 || firstBreak === points.length - 1)) {
      needing.push({ accountId, month: latest.statement.month, certifiedAt: latest.statement.certifiedAt, endDate: latest.statement.endDate });
    }
  }
  return needing;
}

export function detectBalanceMismatches(facts: StatementFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const segmentsByAccount = groupBy(facts.segments, (item) => item.accountId);
  const later = new Map(facts.laterEntries.map((item) => [item.accountId, item]));
  for (const [accountId, statements] of groupBy(facts.statements, (item) => item.accountId)) {
    const account = context.accounts.get(accountId);
    if (!account || !account.isActive) {
      continue;
    }
    const points = buildStatementChain(account, statements, segmentsByAccount.get(accountId) ?? []);
    const { latest, firstBreak } = readChain(points);
    if (!latest || latest.deltaMinor === 0 || !(firstBreak === 0 || firstBreak === points.length - 1)) {
      continue;
    }
    const label = accountLabel(context, accountId);
    const difference = Math.abs(latest.deltaMinor);
    const added = later.get(accountId);
    const explained = Boolean(added && added.entryCount > 0 && added.netMinor === latest.deltaMinor);
    const tier = explained ? "high" : "check";
    const direction = latest.deltaMinor > 0 ? "more" : "less";
    findings.push(finding({
      kind: "balance_mismatch",
      subject: `${accountId}:${latest.statement.month}`,
      tier,
      title: "The statement no longer matches",
      summary: explained
        ? `The ${monthName(latest.statement.month, context.today)} statement for ${label} matched when it was saved, but the entries up to ${shortDate(latest.statement.endDate, context.today)} now come to ${money(difference)} ${direction} than the statement. ${added!.entryCount === 1 ? "One entry" : `${added!.entryCount} entries`} added after that ${added!.entryCount === 1 ? "explains" : "explain"} the difference exactly.`
        : `The ${monthName(latest.statement.month, context.today)} statement for ${label} matched when it was saved, but the entries up to ${shortDate(latest.statement.endDate, context.today)} now come to ${money(difference)} ${direction} than the statement. Something was changed or removed after that.`,
      evidence: [
        statementEvidence(latest, label, context, `matched when saved; the entries now come to ${money(latest.ledgerBalanceMinor)}`),
        ...(explained ? added!.sample.map((entry) => ({ role: "entry" as const, label: clip(entry.description), shortId: shortId(entry.id), date: entry.date, amountMinor: entry.amountMinor, accountName: label, note: "added after the statement was saved" })) : [])
      ],
      amountMinor: difference,
      occurredOn: latest.statement.endDate,
      personIds: accountPeople(account),
      fix: { label: "Compare the statement in Settings", path: SETTINGS_PATH },
      facts: [accountId, latest.statement.month, latest.deltaMinor, added?.entryCount ?? 0, added?.netMinor ?? 0]
    }));
  }
  return findings;
}
