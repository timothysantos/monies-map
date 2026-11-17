import { buildCreateBody } from "./entry-draft";
import { convertForeignAmount, describeForeignAmount } from "./foreign-currency";
import type { AccountDto, EntryDraftDto } from "../types/dto";

// A typed or spoken amount in another currency ("coffee 35000 IDR cash") is
// treated like any foreign purchase (DOMAIN.md, "Foreign Currency Estimate"):
// the account's currency at the day's rate, with the original amount kept.
// The reader leaves the draft's amount missing and names the figure in
// `foreignAmount`; this fills it from a rate when there is one. With no
// rate the draft is returned as it came: no amount, and the card asks for
// the account-currency amount, so the foreign number is never shown or
// saved as the account's currency.
export async function applyForeignEstimate(
  db: D1Database,
  draft: EntryDraftDto,
  accounts: AccountDto[],
  options: { offline?: boolean } = {}
): Promise<EntryDraftDto> {
  const foreign = draft.foreignAmount;
  const accountId = draft.fields.accountId?.value;
  if (!foreign || foreign.estimate || draft.fields.amountMinor || !accountId) {
    return draft;
  }
  const account = accounts.find((candidate) => candidate.id === accountId);
  const accountCurrency = account?.currency?.toUpperCase();
  if (!account || !accountCurrency) {
    return draft;
  }
  if (accountCurrency === foreign.currency) {
    // Another wallet was chosen after the amount was read, one in the
    // currency the person wrote: the figure is already in its currency.
    return withAmount(draft, foreign.amountMinor);
  }
  let conversion;
  try {
    conversion = await convertForeignAmount(db, {
      amountMinor: foreign.amountMinor,
      fromCurrency: foreign.currency,
      toCurrency: accountCurrency,
      offline: options.offline
    });
  } catch {
    // No rate today and none saved lately: keep asking, in place.
    return draft;
  }
  const note = describeForeignAmount({
    originalAmountMinor: foreign.amountMinor,
    originalCurrency: foreign.currency,
    accountCurrency,
    conversion,
    cash: account.kind === "cash"
  });
  return withAmount(draft, conversion.amountMinor, { ...foreign, estimate: { amountMinor: conversion.amountMinor, accountCurrency, note } });
}

// The draft with its amount filled and the foreign question answered.
function withAmount(draft: EntryDraftDto, amountMinor: number, foreignAmount?: EntryDraftDto["foreignAmount"]): EntryDraftDto {
  const fields: EntryDraftDto["fields"] = { ...draft.fields, amountMinor: { value: amountMinor, source: "rule" } };
  const missing = draft.missing.filter((field) => field !== "amountMinor");
  const { createBody: _stale, foreignAmount: _foreign, ...rest } = draft;
  const next: EntryDraftDto = {
    ...rest,
    fields,
    ...(foreignAmount ? { foreignAmount } : {}),
    missing,
    questions: draft.questions.filter((question) => !(question.field === "amountMinor" && question.reason === "foreign_currency"))
  };
  const createBody = missing.length ? undefined : buildCreateBody(fields);
  return createBody ? { ...next, createBody } : next;
}
