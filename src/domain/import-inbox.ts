import { nextMonthKey } from "./app-repository-helpers";
import type {
  AccountDto,
  ImportBatchDto,
  ImportInboxAccountDto,
  ImportInboxDto,
  ImportInboxExpectedFileDto,
  ImportInboxSessionDto
} from "../types/dto";

type BuildImportInboxInput = {
  accounts: AccountDto[];
  recentImports: ImportBatchDto[];
  pendingSplitMatchCount: number;
  now?: Date;
};

type SupportedImportProfile = {
  statementFileTypes: string[];
  activityFileTypes: string[];
  portalUrl?: string;
  downloadInstructions: string[];
};

const STATEMENT_ACCOUNT_KINDS = new Set(["bank", "credit_card"]);
const DEFAULT_STATEMENT_FILE_TYPES = ["PDF statement"];
const IMPORT_ACTIVITY_FRESH_DAYS = 14;

const SUPPORTED_IMPORT_PROFILES: Array<{
  institutionPattern: RegExp;
  profile: SupportedImportProfile;
}> = [
  {
    institutionPattern: /citi|citibank/i,
    profile: {
      statementFileTypes: ["PDF statement"],
      activityFileTypes: ["CSV current activity"],
      portalUrl: "https://www.citibank.com.sg/",
      downloadInstructions: [
        "Open Citi online banking.",
        "Download each missing credit-card statement PDF.",
        "Download current activity CSV only after required statements."
      ]
    }
  },
  {
    institutionPattern: /uob/i,
    profile: {
      statementFileTypes: ["PDF statement"],
      activityFileTypes: ["XLS current transactions"],
      portalUrl: "https://pib.uob.com.sg/",
      downloadInstructions: [
        "Open UOB Personal Internet Banking.",
        "Download each missing statement PDF for cards and accounts.",
        "Download current transactions XLS only after required statements."
      ]
    }
  },
  {
    institutionPattern: /ocbc/i,
    profile: {
      statementFileTypes: ["PDF statement"],
      activityFileTypes: ["CSV current activity"],
      portalUrl: "https://internet.ocbc.com/",
      downloadInstructions: [
        "Open OCBC Digital Banking.",
        "Download each missing card or account statement PDF.",
        "Download current activity CSV only after required statements."
      ]
    }
  },
  {
    institutionPattern: /hsbc/i,
    profile: {
      statementFileTypes: ["PDF statement with private OCR when image-only"],
      activityFileTypes: [],
      portalUrl: "https://www.hsbc.com.sg/online-banking/",
      downloadInstructions: [
        "Open HSBC Singapore online banking.",
        "Download the missing Visa statement PDF.",
        "Image-only PDFs are read with private browser OCR after drop."
      ]
    }
  }
];

export function buildImportInbox({
  accounts,
  recentImports,
  pendingSplitMatchCount,
  now = new Date()
}: BuildImportInboxInput): ImportInboxDto {
  const currentMonth = toMonthKey(now);
  const statementTargetMonth = previousMonthKey(currentMonth);
  const importCountByAccountName = buildImportCountByAccountName(recentImports);
  const activeStatementAccounts = accounts
    .filter((account) => account.isActive && STATEMENT_ACCOUNT_KINDS.has(account.kind))
    .sort(compareAccounts);

  const accountModels = activeStatementAccounts.map((account) => buildInboxAccount({
    account,
    importCountByAccountName,
    statementTargetMonth
  }));
  const expectedFiles = accountModels.flatMap((accountModel) => buildExpectedFilesForAccount({
    account: accountModel,
    sourceAccount: activeStatementAccounts.find((account) => account.id === accountModel.accountId)!,
    currentMonth,
    statementTargetMonth,
    now
  }));
  const sessions = buildInstitutionSessions(accountModels, expectedFiles);
  const reviewQueue = [...expectedFiles].sort(compareExpectedFileReviewOrder);
  const requiredFileCount = expectedFiles.filter((file) => file.priority === "required").length;
  const optionalFileCount = expectedFiles.filter((file) => file.priority === "optional").length;

  return {
    generatedAt: now.toISOString(),
    currentMonth,
    summary: {
      activeAccountCount: activeStatementAccounts.length,
      currentAccountCount: accountModels.filter((account) => account.status === "current").length,
      staleAccountCount: accountModels.filter((account) => account.status === "statement_due").length,
      requiredFileCount,
      optionalFileCount,
      institutionCount: sessions.filter((session) => session.status !== "current").length,
      pendingSplitMatchCount
    },
    sessions,
    reviewQueue,
    cleanup: {
      pendingSplitMatchCount,
      status: pendingSplitMatchCount > 0 ? "needs_review" : "clear",
      detail: pendingSplitMatchCount > 0
        ? `${pendingSplitMatchCount} split match${pendingSplitMatchCount === 1 ? "" : "es"} waiting after bank files are current.`
        : "No split cleanup is waiting."
    }
  };
}

function buildInboxAccount({
  account,
  importCountByAccountName,
  statementTargetMonth
}: {
  account: AccountDto;
  importCountByAccountName: Map<string, number>;
  statementTargetMonth: string;
}): ImportInboxAccountDto {
  const hasImportHistory = (importCountByAccountName.get(account.name) ?? 0) > 0;
  const latestCertifiedMonth = account.latestCheckpointMonth;
  const status = latestCertifiedMonth && latestCertifiedMonth >= statementTargetMonth
    ? "current"
    : latestCertifiedMonth || hasImportHistory ? "statement_due" : "needs_setup";

  return {
    accountId: account.id,
    accountName: account.name,
    institution: account.institution,
    ownerLabel: account.ownerLabel,
    kind: account.kind,
    status,
    latestCertifiedMonth,
    latestActivityImportAt: account.latestImportAt,
    nextExpectedStatementMonth: latestCertifiedMonth
      ? nextMonthKey(latestCertifiedMonth)
      : undefined
  };
}

function buildExpectedFilesForAccount({
  account,
  sourceAccount,
  currentMonth,
  statementTargetMonth,
  now
}: {
  account: ImportInboxAccountDto;
  sourceAccount: AccountDto;
  currentMonth: string;
  statementTargetMonth: string;
  now: Date;
}): ImportInboxExpectedFileDto[] {
  const files: ImportInboxExpectedFileDto[] = [];
  const profile = getSupportedImportProfile(account.institution);
  const firstMissingStatementMonth = account.nextExpectedStatementMonth ?? statementTargetMonth;

  for (const month of enumerateMonths(firstMissingStatementMonth, statementTargetMonth)) {
    files.push({
      id: `${account.accountId}:${month}:statement`,
      institution: account.institution,
      accountId: account.accountId,
      accountName: account.accountName,
      ownerLabel: account.ownerLabel,
      sourceType: "pdf_statement",
      priority: "required",
      periodMonth: month,
      label: `${account.accountName} ${month} statement`,
      detail: `Download the ${month} PDF statement while signed in to ${account.institution}.`,
      supportedFileTypes: profile.statementFileTypes,
      reviewOrder: getMonthOrder(month) * 10
    });
  }

  if (profile.activityFileTypes.length && isActivityImportStale(sourceAccount.latestImportAt, now)) {
    files.push({
      id: `${account.accountId}:${currentMonth}:activity`,
      institution: account.institution,
      accountId: account.accountId,
      accountName: account.accountName,
      ownerLabel: account.ownerLabel,
      sourceType: "activity_export",
      priority: "optional",
      periodMonth: currentMonth,
      label: `${account.accountName} ${currentMonth} activity`,
      detail: `Optional: download current activity after required statements are collected.`,
      supportedFileTypes: profile.activityFileTypes,
      reviewOrder: getMonthOrder(currentMonth) * 10 + 1
    });
  }

  return files;
}

function buildInstitutionSessions(
  accounts: ImportInboxAccountDto[],
  expectedFiles: ImportInboxExpectedFileDto[]
): ImportInboxSessionDto[] {
  const accountsByInstitution = groupBy(accounts, (account) => account.institution);
  const filesByInstitution = groupBy(expectedFiles, (file) => file.institution);

  return Array.from(accountsByInstitution.entries())
    .map(([institution, institutionAccounts]) => {
      const sessionFiles = (filesByInstitution.get(institution) ?? []).sort(compareExpectedFileDownloadOrder);
      const requiredFileCount = sessionFiles.filter((file) => file.priority === "required").length;
      const optionalFileCount = sessionFiles.filter((file) => file.priority === "optional").length;
      const profile = getSupportedImportProfile(institution);
      const status: ImportInboxSessionDto["status"] = requiredFileCount > 0
        ? "needs_files"
        : optionalFileCount > 0 ? "optional" : "current";
      return {
        institution,
        status,
        requiredFileCount,
        optionalFileCount,
        portalUrl: profile.portalUrl,
        downloadInstructions: profile.downloadInstructions,
        accounts: institutionAccounts.sort((left, right) => left.accountName.localeCompare(right.accountName)),
        expectedFiles: sessionFiles
      };
    })
    .sort((left, right) => {
      const leftRank = getSessionStatusRank(left.status);
      const rightRank = getSessionStatusRank(right.status);
      return leftRank - rightRank || left.institution.localeCompare(right.institution);
    });
}

function buildImportCountByAccountName(recentImports: ImportBatchDto[]) {
  const counts = new Map<string, number>();
  for (const importBatch of recentImports) {
    for (const accountName of importBatch.accountNames ?? []) {
      const normalizedName = normalizeAccountLabel(accountName);
      counts.set(normalizedName, (counts.get(normalizedName) ?? 0) + 1);
    }
  }
  return counts;
}

function normalizeAccountLabel(value: string) {
  return value.split(" - ")[0]?.trim() ?? value.trim();
}

function getSupportedImportProfile(institution: string): SupportedImportProfile {
  return SUPPORTED_IMPORT_PROFILES.find((item) => item.institutionPattern.test(institution))?.profile ?? {
    statementFileTypes: DEFAULT_STATEMENT_FILE_TYPES,
    activityFileTypes: [],
    downloadInstructions: [
      `Open ${institution} online banking.`,
      "Download the missing statement PDFs listed here.",
      "Drop the files without renaming them."
    ]
  };
}

function isActivityImportStale(latestImportAt: string | undefined, now: Date) {
  if (!latestImportAt) {
    return true;
  }

  const importedAt = new Date(latestImportAt);
  if (Number.isNaN(importedAt.getTime())) {
    return true;
  }

  return now.getTime() - importedAt.getTime() > IMPORT_ACTIVITY_FRESH_DAYS * 24 * 60 * 60 * 1000;
}

function enumerateMonths(startMonth: string, endMonth: string) {
  if (!isMonthKey(startMonth) || !isMonthKey(endMonth) || startMonth > endMonth) {
    return [];
  }

  const months = [];
  let cursor = startMonth;
  while (cursor <= endMonth) {
    months.push(cursor);
    cursor = nextMonthKey(cursor);
  }
  return months;
}

function previousMonthKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isMonthKey(value: string | undefined) {
  return Boolean(value?.match(/^\d{4}-\d{2}$/));
}

function getMonthOrder(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber;
}

function compareExpectedFileDownloadOrder(left: ImportInboxExpectedFileDto, right: ImportInboxExpectedFileDto) {
  return left.accountName.localeCompare(right.accountName)
    || left.periodMonth.localeCompare(right.periodMonth)
    || getPriorityRank(left.priority) - getPriorityRank(right.priority);
}

function compareExpectedFileReviewOrder(left: ImportInboxExpectedFileDto, right: ImportInboxExpectedFileDto) {
  return left.reviewOrder - right.reviewOrder
    || left.institution.localeCompare(right.institution)
    || left.accountName.localeCompare(right.accountName);
}

function compareAccounts(left: AccountDto, right: AccountDto) {
  return left.institution.localeCompare(right.institution)
    || left.name.localeCompare(right.name);
}

function getPriorityRank(priority: ImportInboxExpectedFileDto["priority"]) {
  return priority === "required" ? 0 : 1;
}

function getSessionStatusRank(status: ImportInboxSessionDto["status"]) {
  if (status === "needs_files") {
    return 0;
  }
  if (status === "optional") {
    return 1;
  }
  return 2;
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
