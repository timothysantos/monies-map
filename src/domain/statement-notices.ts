// The bank's own notices about a card, printed on its statement (OCBC's
// "past due" reminder and its penalty interest rate). Only the notices the
// app knows how to say are kept, as the parser wrote them.
import type { StatementNoticeDto } from "../types/dto";

export function cleanStatementNotices(value: unknown): StatementNoticeDto[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((notice): StatementNoticeDto[] => {
    if (!notice || typeof notice !== "object") {
      return [];
    }
    const { code, annualRatePercent } = notice as { code?: unknown; annualRatePercent?: unknown };
    if (code === "past_due") {
      return [{ code }];
    }
    if (code === "penalty_interest" && typeof annualRatePercent === "number" && annualRatePercent > 0 && annualRatePercent < 100) {
      return [{ code, annualRatePercent }];
    }
    return [];
  });
}

// Stored as JSON on the statement checkpoint; nothing when there are none.
export function statementNoticesToJson(value: unknown) {
  const notices = cleanStatementNotices(value);
  return notices.length ? JSON.stringify(notices) : null;
}

export function statementNoticesFromJson(value: string | null | undefined): StatementNoticeDto[] {
  if (!value) {
    return [];
  }
  try {
    return cleanStatementNotices(JSON.parse(value));
  } catch {
    return [];
  }
}
