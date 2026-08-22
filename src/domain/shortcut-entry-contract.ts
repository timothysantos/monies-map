export const SHORTCUT_DESCRIPTION_MAX_LENGTH = 500;
export const SHORTCUT_NOTE_MAX_LENGTH = 2000;
export const SHORTCUT_CLIENT_VERSION_MAX_LENGTH = 80;

export interface ShortcutCreateBody {
  date?: string;
  description?: string;
  merchant?: string;
  name?: string;
  accountId?: string;
  accountName?: string;
  categoryName?: string;
  amountMinor?: number;
  amount?: number | string;
  currency?: string;
  entryType?: "expense" | "income" | "transfer";
  transferDirection?: "in" | "out";
  ownershipType?: "direct" | "shared";
  ownerName?: string;
  offsetsCategory?: boolean;
  note?: string;
  splitBasisPoints?: number;
  view?: string;
  requestId?: string;
  clientVersion?: string;
}

export interface NormalizedShortcutAmount {
  amountMinor: number;
  currency?: string;
}

type ParsedShortcutBody =
  | { ok: true; body: ShortcutCreateBody }
  | { ok: false; error: string };

const STRING_FIELDS = [
  "date",
  "description",
  "merchant",
  "name",
  "accountId",
  "accountName",
  "categoryName",
  "currency",
  "entryType",
  "transferDirection",
  "ownershipType",
  "ownerName",
  "note",
  "view",
  "requestId",
  "clientVersion"
] as const;

export function parseShortcutCreateBody(value: unknown): ParsedShortcutBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Shortcut request body must be a JSON object." };
  }

  const record = value as Record<string, unknown>;
  const invalidFields: string[] = STRING_FIELDS
    .filter((field) => record[field] != null && typeof record[field] !== "string");

  if (
    record.amount != null
    && typeof record.amount !== "string"
    && typeof record.amount !== "number"
  ) {
    invalidFields.push("amount");
  }
  if (record.amountMinor != null && typeof record.amountMinor !== "number") {
    invalidFields.push("amountMinor");
  }
  if (record.offsetsCategory != null && typeof record.offsetsCategory !== "boolean") {
    invalidFields.push("offsetsCategory");
  }
  if (record.splitBasisPoints != null && typeof record.splitBasisPoints !== "number") {
    invalidFields.push("splitBasisPoints");
  }

  if (invalidFields.length) {
    return {
      ok: false,
      error: `Invalid shortcut field types: ${invalidFields.join(", ")}.`
    };
  }

  if (
    typeof record.clientVersion === "string"
    && record.clientVersion.length > SHORTCUT_CLIENT_VERSION_MAX_LENGTH
  ) {
    return {
      ok: false,
      error: `Shortcut clientVersion must be ${SHORTCUT_CLIENT_VERSION_MAX_LENGTH} characters or fewer.`
    };
  }

  return { ok: true, body: record as ShortcutCreateBody };
}

export function normalizeShortcutAmount(
  amountMinor?: number,
  amount?: number | string
): NormalizedShortcutAmount | undefined {
  if (amountMinor != null) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      return undefined;
    }
    if (amount == null) {
      return { amountMinor };
    }
    const normalizedAmount = normalizeShortcutMajorAmount(amount);
    return normalizedAmount?.amountMinor === amountMinor
      ? { amountMinor, currency: normalizedAmount.currency }
      : undefined;
  }

  return normalizeShortcutMajorAmount(amount);
}

function normalizeShortcutMajorAmount(
  amount?: number | string
): NormalizedShortcutAmount | undefined {
  if (typeof amount === "number") {
    return normalizeMajorAmount(amount);
  }
  if (typeof amount !== "string") {
    return undefined;
  }

  const compact = amount.trim().normalize("NFKC").replace(/\s/gu, "");
  const numberMatches = compact.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (numberMatches.length !== 1) {
    return undefined;
  }

  const numericToken = numberMatches[0];
  const [wholePart, fractionalPart] = numericToken.split(".");
  if (
    (wholePart.includes(",") && !/^\d{1,3}(?:,\d{3})+$/.test(wholePart))
    || (fractionalPart != null && !/^\d{1,2}$/.test(fractionalPart))
  ) {
    return undefined;
  }

  const affixes = compact.replace(numericToken, "");
  const isParenthesized = compact.startsWith("(") && compact.endsWith(")");
  if (
    !/^[\p{L}\p{Sc}()+-]*$/u.test(affixes)
    || affixes.replace(/[()+-]/g, "").length > 4
    || ((affixes.includes("(") || affixes.includes(")")) && !isParenthesized)
    || (affixes.includes("+") && affixes.includes("-"))
    || (affixes.match(/-/g)?.length ?? 0) > 1
    || isParenthesized
    || affixes.includes("-")
  ) {
    return undefined;
  }

  const normalized = Number(numericToken.replace(/,/g, ""));
  const result = normalizeMajorAmount(normalized);
  if (!result) {
    return undefined;
  }

  const currency = detectShortcutAmountCurrency(affixes);
  const currencyAffix = affixes.replace(/[()+-]/g, "");
  if (currencyAffix && !currency) {
    return undefined;
  }

  return {
    ...result,
    currency
  };
}

export function normalizeShortcutCurrency(value?: string) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
}

export function normalizeShortcutDescription(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value
      .normalize("NFKC")
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!normalized) {
      continue;
    }
    return normalized.length <= SHORTCUT_DESCRIPTION_MAX_LENGTH ? normalized : undefined;
  }
  return undefined;
}

export function hasOversizedShortcutDescription(...values: unknown[]) {
  return values.some((value) => (
    typeof value === "string"
    && value.normalize("NFKC").replace(/\s+/gu, " ").trim().length > SHORTCUT_DESCRIPTION_MAX_LENGTH
  ));
}

export function normalizeShortcutNote(value?: string) {
  if (value == null) {
    return undefined;
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length <= SHORTCUT_NOTE_MAX_LENGTH ? normalized : undefined;
}

export function normalizeShortcutRequestId(value?: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length < 8 || normalized.length > 160) {
    return undefined;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(normalized) ? normalized : undefined;
}

export function normalizeShortcutDate(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const isoDate = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:(?:T|\s)(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/
  );
  if (
    isoDate
    && isValidShortcutDateParts(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]))
    && isValidShortcutTimeParts(isoDate)
  ) {
    return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  }

  const localizedDate = trimmed.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (!localizedDate) {
    return undefined;
  }

  const yearValue = Number(localizedDate[3]);
  const year = localizedDate[3].length === 2 ? 2000 + yearValue : yearValue;
  const first = Number(localizedDate[1]);
  const second = Number(localizedDate[2]);
  for (const { month, day } of [
    { month: second, day: first },
    { month: first, day: second }
  ]) {
    if (isValidShortcutDateParts(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return undefined;
}

export function isShortcutEntryType(value: unknown): value is "expense" | "income" | "transfer" {
  return value === "expense" || value === "income" || value === "transfer";
}

export function isShortcutTransferDirection(value: unknown): value is "in" | "out" {
  return value === "in" || value === "out";
}

export function isShortcutOwnershipType(value: unknown): value is "direct" | "shared" {
  return value === "direct" || value === "shared";
}

function normalizeMajorAmount(value: number): NormalizedShortcutAmount | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const scaled = value * 100;
  const amountMinor = Math.round(scaled);
  if (!Number.isSafeInteger(amountMinor) || Math.abs(scaled - amountMinor) > 1e-7) {
    return undefined;
  }
  return { amountMinor };
}

function detectShortcutAmountCurrency(affixes: string) {
  const currencyAffix = affixes.replace(/[()+-]/g, "").toUpperCase();
  if (/^[A-Z]{3}$/.test(currencyAffix)) {
    return currencyAffix;
  }
  if (currencyAffix === "S$" || currencyAffix === "SG$") {
    return "SGD";
  }
  if (currencyAffix === "US$") {
    return "USD";
  }
  return undefined;
}

function isValidShortcutDateParts(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function isValidShortcutTimeParts(match: RegExpMatchArray) {
  if (match[4] == null) {
    return true;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] == null ? 0 : Number(match[6]);
  const offsetHour = match[7] == null ? 0 : Number(match[7]);
  const offsetMinute = match[8] == null ? 0 : Number(match[8]);
  return hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59;
}
